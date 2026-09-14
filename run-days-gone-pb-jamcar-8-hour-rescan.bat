@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - PB and JamCar Overnight OCR Rescan

echo.
echo Days Gone PB + JamCar overnight OCR rescan
echo ===========================================
echo This denser pass checks both complete recordings for:
echo   - missing collectible titles
echo   - IPCA Tech pickup text
echo   - a more permissive second center-screen pass for
echo     Hordes, infestations, ambush camps, NERO and camp-job titles
echo.
echo Expected runtime is roughly one overnight session, around 8 hours.
echo Exact time depends on CPU and disk speed.
echo Platinum Router does not need to be running.
echo Completed per-part results and detailed logs are kept automatically.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\run-days-gone-dual-overnight-rescan.ps1" %*
if errorlevel 1 (
  echo.
  echo The rescan stopped with an error.
  echo Existing results are safe; rerun this file after the error is resolved.
  echo Logs are under outputs\training\days-gone\overnight-rescans
  echo.
  pause
  exit /b 1
)

echo.
echo Both runs have been rescanned.
echo Refresh run-comparison.html to load the updated collectible data.
echo Logs are under outputs\training\days-gone\overnight-rescans
echo.
pause
