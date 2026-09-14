@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - Buffered OCR first-hour test

echo Days Gone buffered OCR - first-hour replay
echo ============================================
echo.
echo This scans every frame of the FIRST 60 MINUTES of the newest recording
echo in E:\Train and never reuses an older test checkpoint:
echo   - top-right collectibles and trophy toasts: 60 FPS
echo   - lower-left IPCA Tech pickups:             60 FPS
echo   - center mission/activity completion titles: 60 FPS
echo.
echo Platinum Router and OBS do not need to be running.
echo You may drag a specific recording onto this BAT file instead.
echo The video is decoded once. Text episodes are buffered first, then up to
echo three strong frames from each episode are tried without delaying capture.
echo.

if "%~1"=="" goto auto_recording

echo Testing supplied recording:
echo %~1
echo.
set "RECORDING_ARG=%~1"
goto run_test

:auto_recording
echo Testing the newest recording in E:\Train...
echo.
set "RECORDING_ARG="

:run_test
if "%RECORDING_ARG%"=="" (
  "C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" ".\scripts\scan_days_gone_buffered_first_hour.py" --duration 3600 --fps 60 --hwaccel d3d11va --workers 8
) else (
  "C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" ".\scripts\scan_days_gone_buffered_first_hour.py" "%RECORDING_ARG%" --duration 3600 --fps 60 --hwaccel d3d11va --workers 8
)
if errorlevel 1 goto failed

goto finished

:failed
echo.
echo TEST STOPPED WITH AN ERROR.
echo Review the error shown above.
pause
exit /b 1

:finished
echo.
echo FIRST-HOUR TEST COMPLETE.
echo.
echo Results:
echo outputs\training\days-gone\buffered-first-hour-60fps\result.json
pause
