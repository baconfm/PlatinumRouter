@echo off
setlocal
cd /d "%~dp0"
title Days Gone - Jul 25 center objective recovery

echo Days Gone Jul 25 center-objective recovery scan
echo ================================================
echo.
echo Recording: E:\Train\2026-07-25 10-01-11.mkv
echo Scope: center completion cards only - no collectible or IPCA OCR.
echo Mode: high-recall short visual stages at 60 FPS.
echo Completed one-hour chunks are reusable if this window is stopped.
echo Platinum Router and OBS do not need to be running.
echo.

set "PYTHON=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "RECORDING=E:\Train\2026-07-25 10-01-11.mkv"
set "BACON_OUT=outputs\training\days-gone\jul25-center-recovery\bacon\result.json"
set "JAMCAR_OUT=outputs\training\days-gone\objective-dashboard-rescan\jamcar\result.json"
set "REVIEWED_OUT=outputs\training\days-gone\center-objective-crossmatch\reviewed-result.json"

if not exist "%PYTHON%" goto missing_python
if not exist "%RECORDING%" goto missing_recording
if not exist "%JAMCAR_OUT%" goto missing_jamcar

echo [1/3] Rescanning the complete Jul 25 recording...
"%PYTHON%" ".\scripts\scan_days_gone_buffered_whole_run.py" "%RECORDING%" --fps 60 --workers 8 --hwaccel d3d11va --center-only --center-segmented --output "%BACON_OUT%"
if errorlevel 1 goto failed_scan

echo.
echo [2/3] Rebuilding the reviewed Bacon versus JamCar objective data...
"%PYTHON%" ".\scripts\summarize_days_gone_center_crossmatch.py" --bacon-result "%BACON_OUT%" --jamcar-result "%JAMCAR_OUT%" --output "%REVIEWED_OUT%"
if errorlevel 1 goto failed_review

echo.
echo [3/3] Checking the dashboard data...
call npm.cmd run validate
if errorlevel 1 goto failed_validation

echo.
echo JUL 25 CENTER RECOVERY COMPLETE.
echo Refresh run-comparison.html to load the recovered objective timestamps.
echo.
echo Raw recovery: %BACON_OUT%
echo Reviewed comparison: %REVIEWED_OUT%
pause
exit /b 0

:missing_python
echo ERROR: The bundled Python runtime was not found.
pause
exit /b 1

:missing_recording
echo ERROR: The Jul 25 recording was not found at:
echo %RECORDING%
pause
exit /b 1

:missing_jamcar
echo ERROR: The existing JamCar center scan is missing:
echo %JAMCAR_OUT%
pause
exit /b 1

:failed_scan
echo ERROR: The center scan stopped. Run this BAT again to resume completed chunks.
pause
exit /b 1

:failed_review
echo ERROR: The scan completed, but reviewed comparison data could not be rebuilt.
pause
exit /b 1

:failed_validation
echo ERROR: Results were written, but dashboard validation failed.
pause
exit /b 1
