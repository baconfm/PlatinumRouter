param(
  [string]$RecordingPath = 'E:\Train\2026-07-18 10-01-32.mkv',
  [string]$VideoStart = '2026-07-18T10:01:32+03:00',
  [int]$PopupNegativeCount = 2500,
  [int]$CompletionNegativeCount = 1800,
  [int]$OptimizationRounds = 240,
  [int]$ChunkSeconds = 1800,
  [double]$FramesPerSecond = 6,
  [switch]$SkipCenterDiscovery,
  [switch]$Fresh,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$trainingRoot = Join-Path $projectRoot 'outputs\training\days-gone\20260718'
$manifest = Join-Path $trainingRoot 'manifest.json'
$chunksDir = Join-Path $trainingRoot 'center-popup-chunks'
$logsRoot = Join-Path $trainingRoot 'logs'
$sessionId = 'full-ocr-overnight-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$sessionLogDir = Join-Path $logsRoot $sessionId
$consoleLog = Join-Path $sessionLogDir 'console.log'
$eventsLog = Join-Path $sessionLogDir 'events.jsonl'

$pythonCandidates = @(
  'C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe',
  (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
  (Get-Command py.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$python = $pythonCandidates | Select-Object -First 1

if (-not (Test-Path -LiteralPath $RecordingPath)) {
  throw "Recording not found: $RecordingPath"
}
if (-not $python) {
  throw 'Python runtime not found. Open this task in Codex once so the bundled workspace runtime is installed.'
}

New-Item -ItemType Directory -Force -Path $trainingRoot,$chunksDir,$sessionLogDir | Out-Null
$resumePhaseIds = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
$resumeSessionId = ''
$latestSessionFile = Join-Path $logsRoot 'latest-session.json'
if (-not $Fresh -and -not $DryRun -and (Test-Path -LiteralPath $latestSessionFile)) {
  try {
    $previousLatest = Get-Content -Raw -LiteralPath $latestSessionFile | ConvertFrom-Json
    if ($previousLatest.state -in @('failed', 'running') -and (Test-Path -LiteralPath $previousLatest.logDir)) {
      $previousMetadataFile = Join-Path $previousLatest.logDir 'session.json'
      $previousEventsFile = Join-Path $previousLatest.logDir 'events.jsonl'
      $previousMetadata = Get-Content -Raw -LiteralPath $previousMetadataFile | ConvertFrom-Json
      if ($previousMetadata.trainingTrack -eq 'full-ocr-overnight' -and
          $previousMetadata.recordingPath -eq $RecordingPath -and
          -not $previousMetadata.dryRun -and
          (Test-Path -LiteralPath $previousEventsFile)) {
        Get-Content -LiteralPath $previousEventsFile | ForEach-Object {
          try {
            $event = $_ | ConvertFrom-Json
            $phaseId = [string]$event.data.phaseId
            $resumableSkip = $event.status -eq 'phase-skipped' -and $event.data.reason -eq 'previous-session-checkpoint'
            if ($phaseId -and ($event.status -eq 'phase-completed' -or $resumableSkip)) {
              [void]$resumePhaseIds.Add($phaseId)
            }
          } catch {
            # Ignore an incomplete final log line from an interrupted process.
          }
        }
        $resumeSessionId = [string]$previousLatest.sessionId
      }
    }
  } catch {
    $resumePhaseIds.Clear()
    $resumeSessionId = ''
  }
}
$env:DAYS_GONE_TRAINING_ROOT = $trainingRoot
$env:DAYS_GONE_TRAINING_SESSION_ID = $sessionId
$env:DAYS_GONE_TRAINING_LOG_DIR = $sessionLogDir

function Write-TrainingEvent {
  param(
    [string]$Bucket,
    [string]$Status,
    [string]$Message,
    [object]$Data = @{}
  )
  $event = [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    sessionId = $sessionId
    bucket = $Bucket
    source = 'full-ocr-overnight-runner'
    status = $Status
    message = $Message
    data = $Data
  }
  $line = $event | ConvertTo-Json -Compress -Depth 12
  Add-Content -LiteralPath $eventsLog -Value $line
  Add-Content -LiteralPath (Join-Path $sessionLogDir ($Bucket + '.jsonl')) -Value $line
}

function Write-ConsoleLine {
  param([string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  $line | Tee-Object -FilePath $consoleLog -Append
}

function Invoke-TrainingStep {
  param(
    [string]$Id,
    [string]$Label,
    [scriptblock]$Command
  )
  $started = Get-Date
  Write-ConsoleLine $Label
  if ($resumePhaseIds.Contains($Id)) {
    Write-TrainingEvent 'control' 'phase-skipped' $Label @{ phaseId = $Id; reason = 'previous-session-checkpoint'; resumedFrom = $resumeSessionId }
    return
  }
  Write-TrainingEvent 'control' 'phase-started' $Label @{ phaseId = $Id }
  if ($DryRun) {
    Write-TrainingEvent 'control' 'phase-skipped' $Label @{ phaseId = $Id; reason = 'dry-run' }
    return
  }
  try {
    $previousPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $Command 2>&1 | Tee-Object -FilePath $consoleLog -Append
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousPreference
    if ($exitCode -ne 0) { throw "$Label failed with exit code $exitCode" }
    Write-TrainingEvent 'control' 'phase-completed' $Label @{
      phaseId = $Id
      durationSeconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 3)
    }
  } catch {
    $ErrorActionPreference = 'Stop'
    Write-TrainingEvent 'error' 'phase-failed' $Label @{
      phaseId = $Id
      durationSeconds = [Math]::Round(((Get-Date) - $started).TotalSeconds, 3)
      error = $_.Exception.Message
    }
    throw
  }
}

$metadata = [ordered]@{
  schemaVersion = 1
  trainingTrack = 'full-ocr-overnight'
  sessionId = $sessionId
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  recordingPath = $RecordingPath
  videoStart = $VideoStart
  popupNegativeCount = $PopupNegativeCount
  completionNegativeCount = $CompletionNegativeCount
  optimizationRounds = $OptimizationRounds
  chunkSeconds = $ChunkSeconds
  framesPerSecond = $FramesPerSecond
  skipCenterDiscovery = [bool]$SkipCenterDiscovery
  fresh = [bool]$Fresh
  dryRun = [bool]$DryRun
  resumedFrom = $resumeSessionId
  resumedPhaseIds = @($resumePhaseIds)
  manifest = $manifest
}
$metadata | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $sessionLogDir 'session.json')
$latestSession = [ordered]@{
  sessionId = $sessionId
  logDir = $sessionLogDir
  state = 'running'
  updatedAt = (Get-Date).ToUniversalTime().ToString('o')
}
$latestSession | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $logsRoot 'latest-session.json')
Write-TrainingEvent 'control' 'run-started' 'Days Gone full OCR overnight training started.' $metadata

Push-Location $projectRoot
try {
  Invoke-TrainingStep 'manifest' 'Building replay manifest' {
    node scripts\build-days-gone-training-manifest.mjs $RecordingPath --video-start $VideoStart --output $manifest
  }
  Invoke-TrainingStep 'popup-positives' 'Extracting confirmed top-right popup samples (resumable)' {
    node scripts\extract-days-gone-training-samples.mjs $manifest --kind confirmed --limit 0 --resume
  }
  Invoke-TrainingStep 'popup-negatives' 'Extracting top-right background samples (resumable)' {
    node scripts\extract-days-gone-training-negatives.mjs $manifest --count $PopupNegativeCount --resume
  }
  Invoke-TrainingStep 'popup-model' 'Optimizing top-right popup gate' {
    & $python scripts\train_days_gone_popup_model.py $manifest --rounds $OptimizationRounds
  }
  Invoke-TrainingStep 'completion-positives' 'Extracting center completion samples (resumable)' {
    node scripts\extract-days-gone-training-samples.mjs $manifest --kind completion --limit 0 --resume
  }
  Invoke-TrainingStep 'completion-negatives' 'Extracting center completion backgrounds (resumable)' {
    node scripts\extract-days-gone-training-negatives.mjs $manifest --region completionAnchor --count $CompletionNegativeCount --resume
  }
  Invoke-TrainingStep 'completion-model' 'OCR-labeling and optimizing the center completion gate' {
    & $python scripts\train_days_gone_completion_model.py $manifest --rounds $OptimizationRounds
  }

  if ($resumePhaseIds.Contains('center-discovery')) {
    Write-ConsoleLine 'Scanning all center-popup video chunks (resumable)'
    Write-TrainingEvent 'control' 'phase-skipped' 'Scanning all center-popup video chunks (resumable)' @{
      phaseId = 'center-discovery'; reason = 'previous-session-checkpoint'; resumedFrom = $resumeSessionId
    }
  } elseif (-not $SkipCenterDiscovery) {
    if ($DryRun) {
      Write-ConsoleLine 'Scanning all center-popup video chunks (resumable)'
      Write-TrainingEvent 'control' 'phase-skipped' 'Scanning all center-popup video chunks (resumable)' @{ phaseId = 'center-discovery'; reason = 'dry-run' }
    } else {
      $manifestData = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
      $totalSeconds = [Math]::Ceiling([double]$manifestData.video.durationSeconds)
      $chunkCount = [Math]::Ceiling($totalSeconds / $ChunkSeconds)
      Write-TrainingEvent 'control' 'phase-started' 'Scanning all center-popup video chunks (resumable)' @{
        phaseId = 'center-discovery'; chunkCount = $chunkCount; totalSeconds = $totalSeconds
      }
      for ($index = 0; $index -lt $chunkCount; $index++) {
        $start = $index * $ChunkSeconds
        $duration = [Math]::Min($ChunkSeconds, $totalSeconds - $start)
        $chunkFile = Join-Path $chunksDir ('chunk-' + $index.ToString('0000') + '.json')
        if (Test-Path -LiteralPath $chunkFile) {
          Write-TrainingEvent 'control' 'chunk-skipped' 'Completed center-popup chunk already exists.' @{
            phaseId = 'center-discovery'; index = $index; chunks = $chunkCount; output = $chunkFile
          }
          continue
        }
        Write-ConsoleLine "Center scan chunk $($index + 1)/$chunkCount at $start seconds"
        Write-TrainingEvent 'control' 'chunk-started' 'Scanning center-popup chunk.' @{
          phaseId = 'center-discovery'; index = $index; chunks = $chunkCount; start = $start; duration = $duration
        }
        $previousPreference = $ErrorActionPreference
        $ErrorActionPreference = 'Continue'
        & $python scripts\scan_days_gone_center_popups.py $manifest --start $start --duration $duration --fps $FramesPerSecond --output $chunkFile 2>&1 |
          Tee-Object -FilePath $consoleLog -Append
        $exitCode = $LASTEXITCODE
        $ErrorActionPreference = $previousPreference
        if ($exitCode -ne 0) { throw "Center-popup chunk $index failed with exit code $exitCode" }
        Write-TrainingEvent 'control' 'chunk-completed' 'Center-popup chunk completed.' @{
          phaseId = 'center-discovery'; index = $index; chunks = $chunkCount; output = $chunkFile
        }
      }
      Write-TrainingEvent 'control' 'phase-completed' 'Scanning all center-popup video chunks (resumable)' @{
        phaseId = 'center-discovery'; chunkCount = $chunkCount
      }
    }
  } else {
    Write-TrainingEvent 'control' 'phase-skipped' 'Center-popup discovery skipped by request.' @{ phaseId = 'center-discovery' }
  }

  Invoke-TrainingStep 'merge-center-scan' 'Merging center-popup discovery chunks' {
    node scripts\merge-days-gone-center-popup-chunks.mjs $chunksDir (Join-Path $trainingRoot 'center-popup-scan.json')
  }
  Invoke-TrainingStep 'title-catalog' 'Rebuilding the named completion-title catalogue' {
    node scripts\train-days-gone-title-catalog.mjs (Join-Path $trainingRoot 'center-popup-scan.json') (Join-Path $trainingRoot 'models\completion-title-model.json')
  }
  Invoke-TrainingStep 'completion-replay' 'Simulating live mission, Horde, camp, NERO, ambush, and infestation OCR' {
    & $python scripts\simulate_days_gone_live_replay.py --intervals '100,125,150' --base-fps 20 --output (Join-Path $trainingRoot 'simulations\full-overnight-completion-replay.json')
  }
  Invoke-TrainingStep 'collectible-replay' 'Simulating all collectible OCR pickups' {
    & $python scripts\simulate_days_gone_collectible_run.py --intervals '100,125,150' --base-fps 20 --limit 0 --output (Join-Path $trainingRoot 'simulations\full-overnight-collectible-replay.json')
  }
  Invoke-TrainingStep 'ipca-replay' 'Simulating IPCA Tech OCR pickups' {
    & $python scripts\simulate_days_gone_ipca_pickups.py --workers 2 --output (Join-Path $trainingRoot 'simulations\full-overnight-ipca-replay.json')
  }
  Invoke-TrainingStep 'validation' 'Validating Platinum Router data and OCR logic' {
    npm.cmd run validate
  }
  Invoke-TrainingStep 'report' 'Summarizing structured training logs' {
    node scripts\summarize-days-gone-training-logs.mjs $trainingRoot
  }

  $finalStatus = if ($DryRun) { 'dry-run-completed' } else { 'run-completed' }
  $finalMessage = if ($DryRun) { 'Days Gone full OCR overnight dry run completed.' } else { 'Days Gone full OCR overnight training completed.' }
  Write-TrainingEvent 'control' $finalStatus $finalMessage @{
    completionReplay = (Join-Path $trainingRoot 'simulations\full-overnight-completion-replay.json')
    collectibleReplay = (Join-Path $trainingRoot 'simulations\full-overnight-collectible-replay.json')
    ipcaReplay = (Join-Path $trainingRoot 'simulations\full-overnight-ipca-replay.json')
    analysis = (Join-Path $trainingRoot 'training-log-analysis.json')
  }
  $latestSession.state = if ($DryRun) { 'dry-run' } else { 'complete' }
  $latestSession.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  $latestSession | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $logsRoot 'latest-session.json')
  Write-ConsoleLine $(if ($DryRun) { 'Full OCR overnight dry run complete' } else { 'Full OCR overnight training complete' })
} catch {
  Write-TrainingEvent 'error' 'run-failed' 'Days Gone full OCR overnight training failed.' @{ error = $_.Exception.Message }
  $latestSession.state = 'failed'
  $latestSession.updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  $latestSession['error'] = $_.Exception.Message
  $latestSession | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $logsRoot 'latest-session.json')
  throw
} finally {
  Pop-Location
  Remove-Item Env:DAYS_GONE_TRAINING_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:DAYS_GONE_TRAINING_SESSION_ID -ErrorAction SilentlyContinue
  Remove-Item Env:DAYS_GONE_TRAINING_LOG_DIR -ErrorAction SilentlyContinue
}
