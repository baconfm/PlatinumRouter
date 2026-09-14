@echo off
setlocal
cd /d "%~dp0"
title Days Gone - Objective dashboard rescan

echo Days Gone objective-only dashboard rescan
echo =========================================
echo.
echo This rescans the newest Bacon recording and both JamCar recordings.
echo Only the center completion-title area is decoded and OCRed.
echo Map descriptions, tutorials, and objective-start cards are rejected.
echo Completed one-hour chunks are reusable if this window is stopped.
echo.
echo Platinum Router and OBS do not need to be running.
echo.

set "PYTHON=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%PYTHON%" goto missing_python

set "BACON_OUT=outputs\training\days-gone\objective-dashboard-rescan\bacon\result.json"
set "JAMCAR_OUT=outputs\training\days-gone\objective-dashboard-rescan\jamcar\result.json"
set "REVIEWED_OUT=outputs\training\days-gone\center-objective-crossmatch\reviewed-result.json"

echo [1/4] Rescanning Bacon objectives...
"%PYTHON%" ".\scripts\scan_days_gone_buffered_whole_run.py" --train-folder "E:\Train" --fps 60 --workers 8 --hwaccel d3d11va --center-only --output "%BACON_OUT%"
if errorlevel 1 goto failed_bacon

echo.
echo [2/4] Rescanning JamCar objectives...
"%PYTHON%" ".\scripts\scan_days_gone_buffered_jamcar.py" --folder "E:\Train\New folder" --fps 60 --workers 8 --hwaccel d3d11va --center-only --output "%JAMCAR_OUT%"
if errorlevel 1 goto failed_jamcar

echo.
echo [3/4] Building conservative dashboard comparison...
"%PYTHON%" ".\scripts\summarize_days_gone_center_crossmatch.py" --bacon-result "%BACON_OUT%" --jamcar-result "%JAMCAR_OUT%" --output "%REVIEWED_OUT%"
if errorlevel 1 goto failed_review

echo.
echo [4/4] Checking dashboard data...
call npm.cmd run validate
if errorlevel 1 goto failed_validation

echo.
echo OBJECTIVE DASHBOARD RESCAN COMPLETE.
echo.
echo Reviewed comparison:
echo %REVIEWED_OUT%
echo.
echo Refresh run-comparison.html to load the new trusted objective data.
pause
exit /b 0

:missing_python
echo ERROR: The bundled Python runtime was not found.
pause
exit /b 1

:failed_bacon
echo ERROR: Bacon objective scan stopped. Launch this BAT again to resume.
pause
exit /b 1

:failed_jamcar
echo ERROR: JamCar objective scan stopped. Bacon is complete; relaunch to resume JamCar.
pause
exit /b 1

:failed_review
echo ERROR: The scans completed, but reviewed dashboard data could not be built.
pause
exit /b 1

:failed_validation
echo ERROR: Reviewed data was built, but dashboard validation failed.
pause
exit /b 1
