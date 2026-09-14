param(
  [string]$TrainFolder = 'E:\Train',
  [string]$RecordingPath = '',
  [double]$CollectibleFps = 1.0,
  [double]$IpcaFps = 1.0,
  [double]$DurationSeconds = 0,
  [switch]$Force,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runDirectory = Join-Path $projectRoot 'outputs\training\days-gone\tomorrow-preflight'
$logsRoot = Join-Path $runDirectory 'logs'
$sessionId = 'pickup-preflight-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$sessionLogDir = Join-Path $logsRoot $sessionId
$consoleLog = Join-Path $sessionLogDir 'console.log'
$eventsLog = Join-Path $sessionLogDir 'events.jsonl'
$latestSessionFile = Join-Path $logsRoot 'latest-session.json'
$manifestFile = Join-Path $runDirectory 'manifest.json'
$runFile = Join-Path $runDirectory 'run.json'
$reportJson = Join-Path $runDirectory 'preflight-report.json'
$reportText = Join-Path $runDirectory 'PRE-FLIGHT-REPORT.txt'

function Write-ConsoleLine {
  param([string]$Message)
  $line = "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Message"
  $line | Tee-Object -FilePath $consoleLog -Append
}

function Write-PreflightEvent {
  param([string]$Status, [string]$Message, [object]$Data = @{})
  $event = [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    sessionId = $sessionId
    bucket = 'pickup-preflight'
    status = $Status
    message = $Message
    data = $Data
  }
  Add-Content -LiteralPath $eventsLog -Value ($event | ConvertTo-Json -Compress -Depth 10)
}

function Set-LatestSession {
  param([string]$State, [string]$Message = '')
  [ordered]@{
    sessionId = $sessionId
    state = $State
    message = $Message
    logDir = $sessionLogDir
    runDirectory = $runDirectory
    recording = $RecordingPath
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  } | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $latestSessionFile -Encoding UTF8
}

function Invoke-NativeStep {
  param([string]$Label, [scriptblock]$Command)
  Write-ConsoleLine $Label
  Write-PreflightEvent 'phase-started' $Label
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $Command 2>&1 | Tee-Object -FilePath $consoleLog -Append
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($exitCode -ne 0) { throw "$Label failed with exit code $exitCode" }
  Write-PreflightEvent 'phase-completed' $Label
}

if (-not (Test-Path -LiteralPath $TrainFolder -PathType Container)) {
  throw "Train folder not found: $TrainFolder"
}

if (-not $RecordingPath) {
  $recording = Get-ChildItem -LiteralPath $TrainFolder -File |
    Where-Object { $_.Extension.ToLowerInvariant() -in @('.mkv', '.mp4', '.mov', '.avi') } |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
  if (-not $recording) { throw "No recording was found in $TrainFolder" }
  $RecordingPath = $recording.FullName
}

if (-not (Test-Path -LiteralPath $RecordingPath -PathType Leaf)) {
  throw "Recording not found: $RecordingPath"
}
$RecordingPath = (Resolve-Path -LiteralPath $RecordingPath).Path

$pythonCandidates = @(
  'C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe',
  (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
  (Get-Command py.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$python = $pythonCandidates | Select-Object -First 1
if (-not $python) { throw 'Python runtime not found.' }
if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) { throw 'Node.js runtime not found.' }
$ffmpeg = Get-ChildItem -LiteralPath (Join-Path $projectRoot 'outputs\tools\ffmpeg') -Recurse -Filter 'ffmpeg.exe' -File -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $ffmpeg) { throw 'Portable FFmpeg was not found under outputs\tools\ffmpeg.' }
$tesseract = 'C:\Program Files\Tesseract-OCR\tesseract.exe'
if (-not (Test-Path -LiteralPath $tesseract -PathType Leaf)) { throw 'Tesseract OCR was not found.' }
& $python -c 'import numpy; from PIL import Image'
if ($LASTEXITCODE -ne 0) { throw 'Python OCR dependencies are incomplete (NumPy or Pillow is missing).' }

New-Item -ItemType Directory -Force -Path $runDirectory,$logsRoot,$sessionLogDir | Out-Null
Set-LatestSession 'running'
Write-PreflightEvent 'run-started' 'Pickup-only replay preflight started.' @{
  recording = $RecordingPath
  collectibleFps = $CollectibleFps
  ipcaFps = $IpcaFps
  durationSeconds = $DurationSeconds
  centerOcr = 'disabled'
  force = [bool]$Force
  dryRun = [bool]$DryRun
}

Push-Location $projectRoot
try {
  Write-ConsoleLine "Recording: $RecordingPath"
  Write-ConsoleLine 'Live test scope: top-right collectibles/trophies + lower-left IPCA Tech'
  Write-ConsoleLine 'Excluded: every center-screen completion OCR and its classifier'
  if ($DurationSeconds -gt 0) {
    Write-ConsoleLine "Replay limit: first $DurationSeconds seconds"
  }

  if ($DryRun) {
    Write-ConsoleLine "Python: $python"
    Write-ConsoleLine "FFmpeg: $($ffmpeg.FullName)"
    Write-ConsoleLine "Tesseract: $tesseract"
    Write-ConsoleLine 'DRY RUN PASSED: recording and required runtimes are available.'
    Write-PreflightEvent 'run-completed' 'Dry-run dependency check passed.'
    Set-LatestSession 'dry-run-complete'
    return
  }

  $recordingChanged = $false
  $rebuildManifest = $Force -or -not (Test-Path -LiteralPath $manifestFile)
  if (-not $rebuildManifest) {
    $oldManifest = Get-Content -Raw -LiteralPath $manifestFile | ConvertFrom-Json
    $recordingChanged = $oldManifest.source.videoFile -ne $RecordingPath
    $rebuildManifest = $recordingChanged
  }
  if ($recordingChanged) {
    Write-ConsoleLine 'A newer recording replaced the previous preflight source; clearing only its old replay checkpoints.'
    @(
      'collectible-progress-part-1.json',
      'collectible-progress.json',
      'ipca-progress-part-1.json',
      'ipca-progress.json',
      'preflight-report.json',
      'PRE-FLIGHT-REPORT.txt'
    ) | ForEach-Object {
      $oldOutput = Join-Path $runDirectory $_
      if (Test-Path -LiteralPath $oldOutput) {
        Remove-Item -LiteralPath $oldOutput -Force
      }
    }
  }
  if ($rebuildManifest) {
    Invoke-NativeStep 'Building replay manifest' {
      node scripts\build-days-gone-training-manifest.mjs $RecordingPath --video-start '2000-01-01T00:00:00Z' --unlabeled --output $manifestFile
    }
  } else {
    Write-ConsoleLine 'Reusing manifest for this recording.'
  }

  $manifest = Get-Content -Raw -LiteralPath $manifestFile | ConvertFrom-Json
  $duration = [double]$manifest.video.durationSeconds
  $testedDuration = if ($DurationSeconds -gt 0) {
    [Math]::Min($duration, $DurationSeconds)
  } else {
    $duration
  }
  [ordered]@{
    schemaVersion = 1
    runId = 'tomorrow-preflight'
    runner = 'Bacon'
    label = 'Latest Days Gone pickup-only preflight recording'
    totalDurationSeconds = [Math]::Round($duration, 3)
    testDurationSeconds = [Math]::Round($testedDuration, 3)
    limitedDuration = [bool]($DurationSeconds -gt 0 -and $testedDuration -lt $duration)
    parts = @(
      [ordered]@{
        part = 1
        file = $RecordingPath
        durationSeconds = [Math]::Round($duration, 3)
        timelineOffsetSeconds = 0
      }
    )
  } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $runFile -Encoding UTF8

  $collectibleArguments = @('scripts\scan_days_gone_collectible_progress.py', $runDirectory, '--fps', ([string]$CollectibleFps))
  $ipcaArguments = @('scripts\scan_days_gone_ipca_progress.py', $runDirectory, '--fps', ([string]$IpcaFps))
  if ($DurationSeconds -gt 0) {
    $collectibleArguments += @('--duration', ([string]$testedDuration))
    $ipcaArguments += @('--duration', ([string]$testedDuration))
  }
  if ($Force) {
    $collectibleArguments += '--force'
    $ipcaArguments += '--force'
  }

  Invoke-NativeStep 'Scanning named collectibles and trophy toasts (top-right)' {
    & $python @collectibleArguments
  }
  Invoke-NativeStep 'Scanning IPCA Tech pickup toasts (lower-left)' {
    & $python @ipcaArguments
  }
  Invoke-NativeStep 'Building tomorrow-readiness report' {
    node scripts\build-days-gone-pickup-preflight-report.mjs --run-dir $runDirectory --output-json $reportJson --output-text $reportText
  }
  Invoke-NativeStep 'Validating Platinum Router configuration' {
    & npm.cmd run validate
  }

  $report = Get-Content -Raw -LiteralPath $reportJson | ConvertFrom-Json
  Write-ConsoleLine "FINAL RESULT: $($report.status)"
  Write-ConsoleLine "Named collectibles/trophies found: $($report.collectibles.detected)"
  Write-ConsoleLine "IPCA pickup popups found: $($report.ipca.detected)"
  Write-ConsoleLine "Report: $reportText"
  Write-PreflightEvent 'run-completed' 'Pickup-only replay preflight completed.' @{
    status = $report.status
    report = $reportText
  }
  Set-LatestSession 'complete' $report.status
} catch {
  $message = $_.Exception.Message
  Write-ConsoleLine "ERROR: $message"
  Write-PreflightEvent 'run-failed' $message
  Set-LatestSession 'failed' $message
  throw
} finally {
  Pop-Location
}
