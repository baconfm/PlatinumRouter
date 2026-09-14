param(
  [double]$CollectibleFps = 0.75,
  [double]$IpcaFps = 1.0,
  [double]$CenterFps = 8.0,
  [double]$CenterVisualThreshold = 0.30,
  [int]$CenterChunkSeconds = 1800,
  [switch]$Fresh,
  [switch]$DryRun
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$pythonCandidates = @(
  'C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe',
  (Get-Command python.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1),
  (Get-Command py.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1)
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }
$python = $pythonCandidates | Select-Object -First 1
if (-not $python) { throw 'Python runtime not found.' }

$runs = @(
  [ordered]@{ Id = 'jamcar-wr'; Label = 'JamCar WR' },
  [ordered]@{ Id = 'bacon-pb'; Label = 'Bacon PB' }
)
$sessionId = 'dual-overnight-rescan-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$logRoot = Join-Path $projectRoot (Join-Path 'outputs\training\days-gone\overnight-rescans' $sessionId)
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$eventsFile = Join-Path $logRoot 'events.jsonl'

function Write-Event {
  param([string]$Status, [string]$Message, [object]$Data = @{})
  $event = [ordered]@{
    at = (Get-Date).ToUniversalTime().ToString('o')
    sessionId = $sessionId
    bucket = 'dual-run-ocr-rescan'
    source = 'dual-overnight-rescan'
    status = $Status
    message = $Message
    data = $Data
  }
  Add-Content -LiteralPath $eventsFile -Value ($event | ConvertTo-Json -Compress -Depth 8)
  Write-Host "[$(Get-Date -Format 'HH:mm:ss')] $Message"
}

function Invoke-Scan {
  param([string]$Label, [string[]]$Arguments, [string]$LogName)
  Write-Event 'phase-started' $Label @{ arguments = $Arguments }
  if ($DryRun) {
    Write-Event 'phase-skipped' $Label @{ reason = 'dry-run' }
    return
  }
  $log = Join-Path $logRoot $LogName
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $python @Arguments 2>&1 | Tee-Object -FilePath $log
  $exitCode = $LASTEXITCODE
  $ErrorActionPreference = $previousPreference
  if ($exitCode -ne 0) { throw "$Label failed with exit code $exitCode. See $log" }
  Write-Event 'phase-completed' $Label @{ log = $log }
}

function Test-CompletedScan {
  param([string]$File, [double]$Fps)
  if ($Fresh -or -not (Test-Path -LiteralPath $File)) { return $false }
  try {
    $data = Get-Content -Raw -LiteralPath $File | ConvertFrom-Json
    return [Math]::Abs([double]$data.scan.fps - $Fps) -lt 0.0001
  } catch {
    return $false
  }
}

function Invoke-CenterRescan {
  param([System.Collections.IDictionary]$Run)
  $directory = Join-Path $projectRoot "outputs\training\days-gone\$($Run.Id)"
  $runData = Get-Content -Raw -LiteralPath (Join-Path $directory 'run.json') | ConvertFrom-Json
  $chunks = Join-Path $directory 'center-popup-rescan-chunks'
  New-Item -ItemType Directory -Force -Path $chunks | Out-Null
  $globalIndex = 0
  foreach ($part in $runData.parts) {
    $manifest = Join-Path $directory "manifests\part-$($part.part).json"
    if (-not (Test-Path -LiteralPath $manifest) -and $runData.parts.Count -eq 1) {
      $manifest = Join-Path $directory 'manifest.json'
    }
    $duration = [double]$part.durationSeconds
    $partOffset = [double]$part.timelineOffsetSeconds
    $chunkCount = [Math]::Ceiling($duration / $CenterChunkSeconds)
    for ($localIndex = 0; $localIndex -lt $chunkCount; $localIndex++) {
      $start = $localIndex * $CenterChunkSeconds
      $length = [Math]::Min($CenterChunkSeconds, $duration - $start)
      $output = Join-Path $chunks ('chunk-' + $globalIndex.ToString('0000') + '.json')
      if (Test-Path -LiteralPath $output) {
        Write-Event 'chunk-skipped' "$($Run.Label): reusing permissive center chunk $($globalIndex + 1)" @{ output = $output }
      } elseif ($DryRun) {
        Write-Event 'chunk-skipped' "$($Run.Label): permissive center chunk $($globalIndex + 1)" @{ reason = 'dry-run' }
      } else {
        Write-Event 'chunk-started' "$($Run.Label): permissive center chunk $($globalIndex + 1)" @{
          part = $part.part; start = $start; duration = $length
        }
        & $python scripts\scan_days_gone_center_popups.py $manifest `
          --start $start --duration $length --fps $CenterFps `
          --visual-threshold $CenterVisualThreshold --timeline-offset $partOffset --output $output 2>&1 |
          Tee-Object -FilePath (Join-Path $logRoot "$($Run.Id)-center.log") -Append
        if ($LASTEXITCODE -ne 0) { throw "$($Run.Label) center chunk $globalIndex failed." }
        Write-Event 'chunk-completed' "$($Run.Label): permissive center chunk $($globalIndex + 1)" @{ output = $output }
      }
      $globalIndex++
    }
  }
  if ($DryRun) { return }
  $rescan = Join-Path $directory 'center-popup-rescan.json'
  $base = Join-Path $directory 'center-popup-scan.json'
  $combined = Join-Path $directory 'center-popup-scan-combined.json'
  node scripts\merge-days-gone-center-popup-chunks.mjs $chunks $rescan
  if ($LASTEXITCODE -ne 0) { throw "$($Run.Label) center rescan merge failed." }
  node scripts\merge-days-gone-center-scan-files.mjs $combined $base $rescan
  if ($LASTEXITCODE -ne 0) { throw "$($Run.Label) combined center scan merge failed." }
  node scripts\train-days-gone-title-catalog.mjs $combined (Join-Path $directory 'models\completion-title-model.json')
  if ($LASTEXITCODE -ne 0) { throw "$($Run.Label) combined completion title match failed." }
}

Push-Location $projectRoot
try {
  Write-Event 'run-started' 'Eight-hour-class JamCar and PB OCR rescan started.' @{
    collectibleFps = $CollectibleFps
    ipcaFps = $IpcaFps
    centerFps = $CenterFps
    centerVisualThreshold = $CenterVisualThreshold
    runs = @($runs.Id)
    note = 'Runtime depends on CPU and storage; every completed per-part result is resumable.'
  }

  foreach ($run in $runs) {
    $directory = "outputs\training\days-gone\$($run.Id)"
    $collectibleOutput = Join-Path $directory 'collectible-progress.json'
    if (Test-CompletedScan $collectibleOutput $CollectibleFps) {
      Write-Event 'phase-skipped' "$($run.Label): denser collectible-title rescan" @{
        reason = 'matching-completed-output'; output = $collectibleOutput
      }
    } else {
      $collectibleArgs = @(
        'scripts\scan_days_gone_collectible_progress.py', $directory,
        '--fps', [string]$CollectibleFps, '--merge-existing'
      )
      if ($Fresh) { $collectibleArgs += '--force' }
      Invoke-Scan "$($run.Label): denser collectible-title rescan" $collectibleArgs "$($run.Id)-collectibles.log"
    }

    $ipcaOutput = Join-Path $directory 'ipca-progress.json'
    if (Test-CompletedScan $ipcaOutput $IpcaFps) {
      Write-Event 'phase-skipped' "$($run.Label): lower-left IPCA Tech rescan" @{
        reason = 'matching-completed-output'; output = $ipcaOutput
      }
    } else {
      $ipcaArgs = @('scripts\scan_days_gone_ipca_progress.py', $directory, '--fps', [string]$IpcaFps)
      if ($Fresh) { $ipcaArgs += '--force' }
      Invoke-Scan "$($run.Label): lower-left IPCA Tech rescan" $ipcaArgs "$($run.Id)-ipca.log"
    }

    Write-Event 'phase-started' "$($run.Label): permissive center completion rescan" @{}
    Invoke-CenterRescan $run
    Write-Event $(if ($DryRun) { 'phase-skipped' } else { 'phase-completed' }) `
      "$($run.Label): permissive center completion rescan" @{}
  }

  if (-not $DryRun) {
    npm.cmd run validate 2>&1 | Tee-Object -FilePath (Join-Path $logRoot 'validation.log')
    if ($LASTEXITCODE -ne 0) { throw 'Validation failed.' }
  }
  Write-Event 'run-completed' 'Dual overnight OCR rescan completed.' @{
    logs = $logRoot
    dashboard = 'run-comparison.html'
  }
} catch {
  Write-Event 'run-failed' 'Dual overnight OCR rescan failed.' @{ error = $_.Exception.Message }
  throw
} finally {
  Pop-Location
}
