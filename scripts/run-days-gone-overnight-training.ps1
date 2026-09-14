param(
  [string]$RecordingPath = 'E:\Train\2026-07-18 10-01-32.mkv',
  [string]$VideoStart = '2026-07-18T10:01:32+03:00',
  [int]$NegativeCount = 2000,
  [int]$OptimizationRounds = 160
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $projectRoot 'outputs\training\days-gone\20260718\manifest.json'
$trainingRoot = Split-Path -Parent $manifest
$python = 'C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$sessionId = 'training-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$logsRoot = Join-Path $trainingRoot 'logs'
$sessionLogDir = Join-Path $logsRoot $sessionId
$logFile = Join-Path $sessionLogDir 'console.log'

New-Item -ItemType Directory -Force -Path $sessionLogDir | Out-Null
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
    source = 'overnight-runner'
    status = $Status
    message = $Message
    data = $Data
  }
  $line = $event | ConvertTo-Json -Compress -Depth 10
  Add-Content -LiteralPath (Join-Path $sessionLogDir 'events.jsonl') -Value $line
  Add-Content -LiteralPath (Join-Path $sessionLogDir ($Bucket + '.jsonl')) -Value $line
}

$sessionMetadata = [ordered]@{
  schemaVersion = 1
  sessionId = $sessionId
  createdAt = (Get-Date).ToUniversalTime().ToString('o')
  recordingPath = $RecordingPath
  videoStart = $VideoStart
  negativeCount = $NegativeCount
  optimizationRounds = $OptimizationRounds
  manifest = $manifest
}
$sessionMetadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $sessionLogDir 'session.json')
Write-TrainingEvent -Bucket 'control' -Status 'run-started' -Message 'Days Gone overnight training started.' -Data $sessionMetadata

function Invoke-TrainingStep {
  param([string]$Label, [scriptblock]$Command)
  $phaseStarted = Get-Date
  $stamp = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  "[$stamp] $Label" | Tee-Object -FilePath $logFile -Append
  Write-TrainingEvent -Bucket 'control' -Status 'phase-started' -Message $Label
  try {
    $previousErrorActionPreference = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $Command 2>&1 | Tee-Object -FilePath $logFile -Append
    $nativeExitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorActionPreference
    if ($nativeExitCode -ne 0) { throw "$Label failed with exit code $nativeExitCode" }
    Write-TrainingEvent -Bucket 'control' -Status 'phase-completed' -Message $Label -Data @{
      durationSeconds = [Math]::Round(((Get-Date) - $phaseStarted).TotalSeconds, 3)
    }
  } catch {
    $ErrorActionPreference = 'Stop'
    Write-TrainingEvent -Bucket 'error' -Status 'phase-failed' -Message $Label -Data @{
      durationSeconds = [Math]::Round(((Get-Date) - $phaseStarted).TotalSeconds, 3)
      error = $_.Exception.Message
    }
    throw
  }
}

Push-Location $projectRoot
try {
  Invoke-TrainingStep 'Building replay manifest' {
    node scripts/build-days-gone-training-manifest.mjs $RecordingPath --video-start $VideoStart
  }
  Invoke-TrainingStep 'Extracting confirmed popup samples (resumable)' {
    node scripts/extract-days-gone-training-samples.mjs $manifest --kind confirmed --limit 0 --resume
  }
  Invoke-TrainingStep 'Extracting safe background samples (resumable)' {
    node scripts/extract-days-gone-training-negatives.mjs $manifest --count $NegativeCount --resume
  }
  Invoke-TrainingStep 'Optimizing popup-presence model' {
    & $python scripts/train_days_gone_popup_model.py $manifest --rounds $OptimizationRounds
  }
  Invoke-TrainingStep 'Validating Platinum Router' {
    npm.cmd run validate
  }
  Write-TrainingEvent -Bucket 'control' -Status 'run-completed' -Message 'Days Gone overnight training completed.' -Data @{
    modelFile = (Join-Path $trainingRoot 'models\top-right-popup-model.json')
  }
  $latestSession = [ordered]@{ sessionId = $sessionId; logDir = $sessionLogDir; completedAt = (Get-Date).ToUniversalTime().ToString('o') }
  $latestSession | ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $logsRoot 'latest-session.json')
  node scripts/summarize-days-gone-training-logs.mjs
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Overnight training complete" | Tee-Object -FilePath $logFile -Append
} finally {
  Pop-Location
  Remove-Item Env:DAYS_GONE_TRAINING_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:DAYS_GONE_TRAINING_SESSION_ID -ErrorAction SilentlyContinue
  Remove-Item Env:DAYS_GONE_TRAINING_LOG_DIR -ErrorAction SilentlyContinue
}
