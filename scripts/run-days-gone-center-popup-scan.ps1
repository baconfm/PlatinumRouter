param(
  [int]$ChunkSeconds = 1800,
  [double]$FramesPerSecond = 6
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$trainingRoot = Join-Path $projectRoot 'outputs\training\days-gone\20260718'
$manifest = Join-Path $trainingRoot 'manifest.json'
$chunksDir = Join-Path $trainingRoot 'center-popup-chunks'
$logsRoot = Join-Path $trainingRoot 'logs'
$python = 'C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$sessionId = 'center-scan-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + ([guid]::NewGuid().ToString('N').Substring(0, 6))
$logDir = Join-Path $logsRoot $sessionId
$consoleLog = Join-Path $logDir 'console.log'
New-Item -ItemType Directory -Force -Path $chunksDir,$logDir | Out-Null

function Write-Event([string]$Bucket, [string]$Status, [string]$Message, [object]$Data = @{}) {
  $event = [ordered]@{ at = (Get-Date).ToUniversalTime().ToString('o'); sessionId = $sessionId; bucket = $Bucket;
    source = 'center-popup-scan-runner'; status = $Status; message = $Message; data = $Data }
  $line = $event | ConvertTo-Json -Compress -Depth 10
  Add-Content -LiteralPath (Join-Path $logDir 'events.jsonl') -Value $line
  Add-Content -LiteralPath (Join-Path $logDir ($Bucket + '.jsonl')) -Value $line
}

$manifestData = Get-Content -Raw -LiteralPath $manifest | ConvertFrom-Json
$totalSeconds = [Math]::Ceiling([double]$manifestData.video.durationSeconds)
$chunkCount = [Math]::Ceiling($totalSeconds / $ChunkSeconds)
$metadata = [ordered]@{ schemaVersion = 1; trainingTrack = 'center-popup-discovery'; sessionId = $sessionId;
  manifest = $manifest; totalSeconds = $totalSeconds; chunkSeconds = $ChunkSeconds; chunkCount = $chunkCount; fps = $FramesPerSecond }
$metadata | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $logDir 'session.json')
Write-Event 'control' 'run-started' 'Days Gone center-popup discovery started.' $metadata

Push-Location $projectRoot
try {
  for ($index = 0; $index -lt $chunkCount; $index++) {
    $start = $index * $ChunkSeconds
    $duration = [Math]::Min($ChunkSeconds, $totalSeconds - $start)
    $chunkFile = Join-Path $chunksDir ('chunk-' + $index.ToString('0000') + '.json')
    if (Test-Path -LiteralPath $chunkFile) {
      Write-Event 'control' 'chunk-skipped' 'Completed center-popup chunk already exists.' @{ index = $index; start = $start; output = $chunkFile }
      continue
    }
    Write-Event 'control' 'phase-started' 'Scanning center-popup chunk.' @{ index = $index; chunks = $chunkCount; start = $start; duration = $duration }
    "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] Chunk $($index + 1)/$chunkCount at $start seconds" | Tee-Object -FilePath $consoleLog -Append
    $previous = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    & $python scripts\scan_days_gone_center_popups.py $manifest --start $start --duration $duration --fps $FramesPerSecond --output $chunkFile 2>&1 |
      Tee-Object -FilePath $consoleLog -Append
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previous
    if ($exitCode -ne 0) { throw "Center-popup chunk $index failed with exit code $exitCode" }
    Write-Event 'control' 'phase-completed' 'Center-popup chunk completed.' @{ index = $index; chunks = $chunkCount; output = $chunkFile }
  }
  node scripts\merge-days-gone-center-popup-chunks.mjs $chunksDir (Join-Path $trainingRoot 'center-popup-scan.json') 2>&1 |
    Tee-Object -FilePath $consoleLog -Append
  if ($LASTEXITCODE -ne 0) { throw 'Center-popup chunk merge failed.' }
  npm.cmd run validate 2>&1 | Tee-Object -FilePath $consoleLog -Append
  if ($LASTEXITCODE -ne 0) { throw 'Project validation failed.' }
  Write-Event 'control' 'run-completed' 'Days Gone center-popup discovery completed.' @{ output = (Join-Path $trainingRoot 'center-popup-scan.json') }
} catch {
  Write-Event 'error' 'run-failed' 'Days Gone center-popup discovery failed.' @{ error = $_.Exception.Message }
  throw
} finally {
  Pop-Location
}
