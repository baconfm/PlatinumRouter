@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - Full live-behavior OCR simulation

echo Days Gone OCR - FULL LIVE-RUN SIMULATION
echo =========================================
echo.
echo This scans the complete recording as closely as possible to a live run:
echo   - true 1.0x wall-clock playback
echo   - every OCR region visually checked at 60 FPS
echo   - 6 workers reserved for collectibles, trophies and IPCA Tech
echo   - 2 isolated workers process captured center flurries in the background
echo   - capture never waits for OCR
echo   - a bounded queue prevents unlimited memory growth
echo   - original video timestamps are retained for delayed matches
echo   - a recoverable checkpoint is written every five video minutes
echo.
echo A 15-hour recording takes approximately 15 hours plus final queue drain.
echo Platinum Router and OBS do not need to be running.
echo By default this uses the newest recording directly in E:\Train.
echo Recordings inside subfolders are ignored.
echo You can drag a specific recording onto this BAT instead.
echo.

set "PYTHON=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "OUTPUT=%CD%\outputs\training\days-gone\priority-realtime-full-run\result.json"

if not exist "%PYTHON%" goto missing_python

if "%~1"=="" (
  "%PYTHON%" ".\scripts\simulate_days_gone_realtime_ocr.py" --fps 60 --playback-speed 1 --workers 8 --center-workers 2 --max-pending 256 --hwaccel d3d11va --output "%OUTPUT%"
) else (
  "%PYTHON%" ".\scripts\simulate_days_gone_realtime_ocr.py" "%~1" --fps 60 --playback-speed 1 --workers 8 --center-workers 2 --max-pending 256 --hwaccel d3d11va --output "%OUTPUT%"
)
if errorlevel 1 goto failed

echo.
echo FULL LIVE-RUN SIMULATION COMPLETE.
echo Results:
echo outputs\training\days-gone\priority-realtime-full-run\result.json
echo outputs\training\days-gone\priority-realtime-full-run\LIVE-REPLAY-REPORT.txt
pause
exit /b 0

:missing_python
echo ERROR: The bundled Python runtime was not found.
pause
exit /b 1

:failed
echo.
echo FULL LIVE-RUN SIMULATION STOPPED WITH AN ERROR.
echo The latest five-minute checkpoint should still be available.
pause
exit /b 1
