@echo off
setlocal
cd /d "%~dp0"
title Days Gone - Center Objective Cross-Match

echo Days Gone center-objective flurry scan
echo ======================================
echo.
echo This uses the saved Bacon and JamCar objective timestamps.
echo It scans from 2 seconds before through 12 seconds after each title,
echo retaining both the primary title retries and later secondary cards.
echo.
echo Completed run checkpoints are reused if this window is stopped, so the
echo scan can be launched again to resume. Add FORCE after the BAT name only
echo when you intentionally want to discard and rebuild all three checkpoints.
echo Platinum Router and OBS do not need to be running.
echo.

set "PYTHON=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%PYTHON%" goto missing_python

set "FORCE_ARG="
if /I "%~1"=="FORCE" set "FORCE_ARG=--force"

"%PYTHON%" ".\scripts\scan_days_gone_center_objective_windows.py" --fps 6 --before 2 --after 12 %FORCE_ARG%
if errorlevel 1 goto failed

echo.
echo Filtering tutorial, map, and objective-start false anchors...
"%PYTHON%" ".\scripts\summarize_days_gone_center_crossmatch.py"
if errorlevel 1 goto failed

echo.
echo CENTER OBJECTIVE SCAN COMPLETE.
echo.
echo Main cross-match:
echo outputs\training\days-gone\center-objective-crossmatch\result.json
echo.
echo Conservative reviewed cross-match:
echo outputs\training\days-gone\center-objective-crossmatch\reviewed-result.json
echo.
echo Resumable per-recording files are in the same folder.
pause
exit /b 0

:missing_python
echo ERROR: The bundled Python runtime was not found.
pause
exit /b 1

:failed
echo.
echo CENTER OBJECTIVE SCAN STOPPED WITH AN ERROR.
echo Launch this BAT again to reuse every completed recording checkpoint.
pause
exit /b 1
