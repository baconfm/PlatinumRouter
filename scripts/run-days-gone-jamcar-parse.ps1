param(
  [string]$TrainFolder = 'E:\Train',
  [string]$RunId = 'jamcar-wr',
  [string]$Runner = 'JamCar',
  [string]$RunLabel = 'Days Gone 100% world record comparison source',
  [string]$Part1Name = 'Days Gone 100% Speedrun pt.1 (1080p_30fps_H264-128kbit_AAC).mp4',
  [string]$Part2Name = 'Days Gone 100% Speedrun pt.2 (1080p_30fps_H264-128kbit_AAC).mp4',
  [string]$Part1Pattern = '',
  [string]$Part2Pattern = '',
  [int]$ChunkSeconds = 1800,
  [double]$FramesPerSecond = 6,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$trainingRoot = Join-Path $projectRoot (Join-Path 'outputs\training\days-gone' $RunId)
$manifestDir = Join-Path $trainingRoot 'manifests'
$chunksDir = Join-Path $trainingRoot 'center-popup-chunks'
$logsRoot = Join-Path $trainingRoot 'logs'
$sessionId = $RunId + '-parse-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$sessionLogDir = Join-Path $logsRoot $sessionId
$consoleLog = Join-Path $sessionLogDir 'console.log'
$eventsLog = Join-Path $sessionLogDir 'events.jsonl'
$latestSessionFile = Join-Path $logsRoot 'latest-session.json'

function Resolve-Recording {
  param([string]$Name, [string]$Pattern, [string]$PartLabel)
  if ($Pattern) {
    $matches = @(Get-ChildItem -LiteralPath $TrainFolder -File -Filter $Pattern)
    if ($matches.Count -ne 1) {
      throw "$PartLabel pattern must identify exactly one recording; found $($matches.Count): $Pattern"
    }
    return $matches[0].FullName
  }
  return Join-Path $TrainFolder $Name
}

$part1 = Resolve-Recording $Part1Name $Part1Pattern 'Part 1'
$part2 = Resolve-Recording $Part2Name $Part2Pattern 'Part 2'
$parts = @(
  [ordered]@{ index = 1; file = $part1; manifest = (Join-Path $manifestDir 'part-1.json') },
  [ordered]@{ index = 2; file = $part2; manifest = (Join-Path $manifestDir 'part-2.json') }
)

$pythonCandidates = @(
  'C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe',
  (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
  (Get-Command py.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$python = $pythonCandidates | Select-Object -First 1

foreach ($part in $parts) {
  if (-not (Test-Path -LiteralPath $part.file)) { throw "Recording part not found: $($part.file)" }
}
if (-not $python) { throw 'Python runtime not found.' }

New-Item -ItemType Directory -Force -Path $trainingRoot,$manifestDir,$chunksDir,$sessionLogDir | Out-Null
$env:DAYS_GONE_TRAINING_ROOT = $trainingRoot
$env:DAYS_GONE_TRAINING_SESSION_ID = $sessionId
$env:DAYS_GONE_TRAINING_LOG_DIR = $sessionLogDir

function Write-ConsoleLine {
  param([string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  $line | Tee-Object -FilePath $consoleLog -Append
}

function Write-ParseEvent {
  param([string]$Status, [string]$Message, [object]$Data = @{})
  $event = [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    sessionId = $sessionId
    bucket = 'external-run-parse'
    source = 'days-gone-multipart-runner'
    status = $Status
    message = $Message
    data = $Data
  }
  Add-Content -LiteralPath $eventsLog -Value ($event | ConvertTo-Json -Compress -Depth 10)
}

function Invoke-NativeStep {
  param([string]$Label, [scriptblock]$Command)
  Write-ConsoleLine $Label
  Write-ParseEvent 'phase-started' $Label
  if ($DryRun) {
    Write-ParseEvent 'phase-skipped' $Label @{ reason = 'dry-run' }
    return
  }
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $Command 2>&1 | Tee-Object -FilePath $consoleLog -Append
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($exitCode -ne 0) { throw "$Label failed with exit code $exitCode" }
  Write-ParseEvent 'phase-completed' $Label
}

$latest = [ordered]@{
  sessionId = $sessionId
  logDir = $sessionLogDir
  state = 'running'
  updatedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$latest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $latestSessionFile
Write-ParseEvent 'run-started' "$Runner multipart run parsing started." @{
  runId = $RunId
  runner = $Runner
  runLabel = $RunLabel
  parts = @($parts | ForEach-Object { $_.file })
  chunkSeconds = $ChunkSeconds
  framesPerSecond = $FramesPerSecond
  dryRun = [bool]$DryRun
}

Push-Location $projectRoot
try {
  foreach ($part in $parts) {
    if (-not (Test-Path -LiteralPath $part.manifest)) {
      Invoke-NativeStep "Building manifest for Part $($part.index)" {
        node scripts\build-days-gone-training-manifest.mjs $part.file --video-start '2000-01-01T00:00:00Z' --unlabeled --output $part.manifest
      }
    } else {
      Write-ConsoleLine "Reusing Part $($part.index) manifest"
      Write-ParseEvent 'phase-skipped' "Building manifest for Part $($part.index)" @{ reason = 'manifest-exists'; manifest = $part.manifest }
    }
  }

  if ($DryRun) {
    Write-ConsoleLine 'Dry run complete; no video chunks were scanned.'
  } else {
    $timelineOffset = 0.0
    $globalChunkIndex = 0
    $runParts = @()
    foreach ($part in $parts) {
      $manifestData = Get-Content -Raw -LiteralPath $part.manifest | ConvertFrom-Json
      $duration = [double]$manifestData.video.durationSeconds
      $chunkCount = [Math]::Ceiling($duration / $ChunkSeconds)
      $partOffset = $timelineOffset
      $runParts += [ordered]@{
        part = $part.index
        file = $part.file
        durationSeconds = [Math]::Round($duration, 3)
        timelineOffsetSeconds = [Math]::Round($partOffset, 3)
      }
      for ($localIndex = 0; $localIndex -lt $chunkCount; $localIndex++) {
        $localStart = $localIndex * $ChunkSeconds
        $localDuration = [Math]::Min($ChunkSeconds, $duration - $localStart)
        $chunkFile = Join-Path $chunksDir ('chunk-' + $globalChunkIndex.ToString('0000') + '.json')
        if (Test-Path -LiteralPath $chunkFile) {
          Write-ConsoleLine "Reusing completed Part $($part.index) chunk $($localIndex + 1)/$chunkCount"
          Write-ParseEvent 'chunk-skipped' 'Completed multipart chunk already exists.' @{
            part = $part.index; localIndex = $localIndex; globalIndex = $globalChunkIndex; output = $chunkFile
          }
        } else {
          Write-ConsoleLine "Scanning Part $($part.index), chunk $($localIndex + 1)/$chunkCount at local $localStart seconds"
          Write-ParseEvent 'chunk-started' 'Scanning multipart center-popup chunk.' @{
            part = $part.index; localIndex = $localIndex; globalIndex = $globalChunkIndex
            localStart = $localStart; timelineOffset = $partOffset; duration = $localDuration
          }
          $previousPreference = $ErrorActionPreference
          $ErrorActionPreference = 'Continue'
          & $python scripts\scan_days_gone_center_popups.py $part.manifest `
            --start $localStart --duration $localDuration --fps $FramesPerSecond `
            --timeline-offset $partOffset --output $chunkFile 2>&1 |
            Tee-Object -FilePath $consoleLog -Append
          $exitCode = $LASTEXITCODE
          $ErrorActionPreference = $previousPreference
          if ($exitCode -ne 0) { throw "Part $($part.index) chunk $localIndex failed with exit code $exitCode" }
          Write-ParseEvent 'chunk-completed' 'JamCar center-popup chunk completed.' @{
            part = $part.index; localIndex = $localIndex; globalIndex = $globalChunkIndex; output = $chunkFile
          }
        }
        $globalChunkIndex++
      }
      $timelineOffset += $duration
    }

    $runManifest = [ordered]@{
      schemaVersion = 1
      createdAt = (Get-Date).ToUniversalTime().ToString('o')
      runner = $Runner
      runKind = $RunLabel
      totalDurationSeconds = [Math]::Round($timelineOffset, 3)
      parts = $runParts
    }
    $runManifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $trainingRoot 'run.json')

    Invoke-NativeStep 'Merging both parts into one continuous completion timeline' {
      node scripts\merge-days-gone-center-popup-chunks.mjs $chunksDir (Join-Path $trainingRoot 'center-popup-scan.json')
    }
    Invoke-NativeStep 'Matching detected titles against the Days Gone catalogue' {
      node scripts\train-days-gone-title-catalog.mjs (Join-Path $trainingRoot 'center-popup-scan.json') (Join-Path $trainingRoot 'models\completion-title-model.json')
    }
    Invoke-NativeStep 'Validating Platinum Router after parsing' {
      npm.cmd run validate
    }
  }

  $latest.state = if ($DryRun) { 'dry-run' } else { 'complete' }
  $latest.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  $latest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $latestSessionFile
  Write-ParseEvent 'run-completed' "$Runner multipart run parsing completed." @{
    scan = (Join-Path $trainingRoot 'center-popup-scan.json')
    titleModel = (Join-Path $trainingRoot 'models\completion-title-model.json')
  }
  Write-ConsoleLine $(if ($DryRun) { "$Runner parse dry run complete" } else { "$Runner parse complete" })
} catch {
  $latest.state = 'failed'
  $latest.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  $latest['error'] = $_.Exception.Message
  $latest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $latestSessionFile
  Write-ParseEvent 'run-failed' "$Runner multipart run parsing failed." @{ error = $_.Exception.Message }
  throw
} finally {
  Pop-Location
  Remove-Item Env:DAYS_GONE_TRAINING_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:DAYS_GONE_TRAINING_SESSION_ID -ErrorAction SilentlyContinue
  Remove-Item Env:DAYS_GONE_TRAINING_LOG_DIR -ErrorAction SilentlyContinue
}
