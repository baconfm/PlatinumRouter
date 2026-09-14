@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - Buffered OCR whole-run test

echo Days Gone buffered OCR - WHOLE RUN replay
echo ===========================================
echo.
echo This scans the newest recording directly inside E:\Train.
echo Recordings inside subfolders are ignored.
echo All three areas are inspected at 60 FPS:
echo   - top-right collectibles and trophy toasts
echo   - lower-left IPCA Tech pickups
echo   - center mission/activity completion titles
echo.
echo The run is processed in resumable one-hour chunks. If this is stopped,
echo launch this BAT again and completed chunks will be reused.
echo Platinum Router and OBS do not need to be running.
echo You may drag a specific recording onto this BAT file instead.
echo.

set "PYTHON=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%PYTHON%" goto missing_python

if "%~1"=="" (
  "%PYTHON%" ".\scripts\scan_days_gone_buffered_whole_run.py" --fps 60 --hwaccel d3d11va --workers 8
) else (
  "%PYTHON%" ".\scripts\scan_days_gone_buffered_whole_run.py" "%~1" --fps 60 --hwaccel d3d11va --workers 8
)
if errorlevel 1 goto failed

echo.
echo WHOLE-RUN TEST COMPLETE.
echo.
echo Combined results:
echo outputs\training\days-gone\buffered-whole-run-60fps\result.json
pause
exit /b 0

:missing_python
echo ERROR: The bundled Python runtime was not found.
pause
exit /b 1

:failed
echo.
echo WHOLE-RUN TEST STOPPED WITH AN ERROR.
echo Launch this BAT again to resume from the last completed hour.
pause
exit /b 1
