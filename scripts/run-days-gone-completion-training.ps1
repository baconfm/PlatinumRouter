param(
  [string]$RecordingPath = 'E:\Train\2026-07-18 10-01-32.mkv',
  [string]$VideoStart = '2026-07-18T10:01:32+03:00',
  [int]$NegativeCount = 1500,
  [int]$OptimizationRounds = 160
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Join-Path $projectRoot 'outputs\training\days-gone\20260718\manifest.json'
$trainingRoot = Split-Path -Parent $manifest
$python = 'C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$sessionId = 'completion-training-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$logsRoot = Join-Path $trainingRoot 'logs'
$sessionLogDir = Join-Path $logsRoot $sessionId
$logFile = Join-Path $sessionLogDir 'console.log'

New-Item -ItemType Directory -Force -Path $sessionLogDir | Out-Null
$env:DAYS_GONE_TRAINING_ROOT = $trainingRoot
$env:DAYS_GONE_TRAINING_SESSION_ID = $sessionId
$env:DAYS_GONE_TRAINING_LOG_DIR = $sessionLogDir

function Write-TrainingEvent {
  param([string]$Bucket, [string]$Status, [string]$Message, [object]$Data = @{})
  $event = [ordered]@{ at = (Get-Date).ToUniversalTime().ToString('o'); sessionId = $sessionId; bucket = $Bucket;
    source = 'completion-training-runner'; status = $Status; message = $Message; data = $Data }
  $line = $event | ConvertTo-Json -Compress -Depth 10
  Add-Content -LiteralPath (Join-Path $sessionLogDir 'events.jsonl') -Value $line
  Add-Content -LiteralPath (Join-Path $sessionLogDir ($Bucket + '.jsonl')) -Value $line
}

$metadata = [ordered]@{ schemaVersion = 1; trainingTrack = 'completion'; sessionId = $sessionId;
  createdAt = (Get-Date).ToUniversalTime().ToString('o'); recordingPath = $RecordingPath; videoStart = $VideoStart;
  negativeCount = $NegativeCount; optimizationRounds = $OptimizationRounds; manifest = $manifest }
$metadata | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $sessionLogDir 'session.json')
Write-TrainingEvent 'control' 'run-started' 'Days Gone completion-screen training started.' $metadata

function Invoke-TrainingStep {
  param([string]$Label, [scriptblock]$Command)
  $phaseStarted = Get-Date
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $Label" | Tee-Object -FilePath $logFile -Append
  Write-TrainingEvent 'control' 'phase-started' $Label
  try {
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $Command 2>&1 | Tee-Object -FilePath $logFile -Append
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previous
    if ($exitCode -ne 0) { throw "$Label failed with exit code $exitCode" }
    Write-TrainingEvent 'control' 'phase-completed' $Label @{ durationSeconds = [Math]::Round(((Get-Date) - $phaseStarted).TotalSeconds, 3) }
  } catch {
    $ErrorActionPreference = 'Stop'
    Write-TrainingEvent 'error' 'phase-failed' $Label @{ durationSeconds = [Math]::Round(((Get-Date) - $phaseStarted).TotalSeconds, 3); error = $_.Exception.Message }
    throw
  }
}

Push-Location $projectRoot
try {
  Invoke-TrainingStep 'Building replay manifest' { node scripts/build-days-gone-training-manifest.mjs $RecordingPath --video-start $VideoStart }
  Invoke-TrainingStep 'Extracting completion-screen samples (resumable)' { node scripts/extract-days-gone-training-samples.mjs $manifest --kind completion --limit 0 --resume }
  Invoke-TrainingStep 'Extracting completion-screen backgrounds (resumable)' { node scripts/extract-days-gone-training-negatives.mjs $manifest --region completionAnchor --count $NegativeCount --resume }
  Invoke-TrainingStep 'OCR-labeling and optimizing completion model' { & $python scripts/train_days_gone_completion_model.py $manifest --rounds $OptimizationRounds }
  Invoke-TrainingStep 'Validating Platinum Router' { npm.cmd run validate }
  Write-TrainingEvent 'control' 'run-completed' 'Days Gone completion-screen training completed.' @{ modelFile = (Join-Path $trainingRoot 'models\completion-popup-model.json') }
  @{ sessionId = $sessionId; logDir = $sessionLogDir; completedAt = (Get-Date).ToUniversalTime().ToString('o') } |
    ConvertTo-Json -Depth 3 | Set-Content -LiteralPath (Join-Path $logsRoot 'latest-session.json')
  node scripts/summarize-days-gone-training-logs.mjs
  "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Completion training complete" | Tee-Object -FilePath $logFile -Append
} finally {
  Pop-Location
  Remove-Item Env:DAYS_GONE_TRAINING_ROOT -ErrorAction SilentlyContinue
  Remove-Item Env:DAYS_GONE_TRAINING_SESSION_ID -ErrorAction SilentlyContinue
  Remove-Item Env:DAYS_GONE_TRAINING_LOG_DIR -ErrorAction SilentlyContinue
}
