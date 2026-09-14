@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - Priority OCR one-hour stress test at 4x

echo Days Gone OCR - PRIORITY QUEUE 4X TEST
echo ======================================
echo.
echo This scans the FIRST 60 MINUTES at four times playback speed:
echo   - top-right collectibles/trophies and IPCA use 6 real-time workers
echo   - center flurries are captured at 60 FPS and use 2 background workers
echo   - center retries cannot occupy the pickup workers
echo   - all detections retain their original video timestamps
echo.
echo Ideal capture time is about 15 minutes, followed by final backlog drain.
echo By default it uses the newest recording directly in E:\Train.
echo You can drag a specific recording onto this BAT instead.
echo.

set "PYTHON=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "OUTPUT=%CD%\outputs\training\days-gone\priority-realtime-one-hour-4x\result.json"

if not exist "%PYTHON%" goto missing_python

if "%~1"=="" (
  "%PYTHON%" ".\scripts\simulate_days_gone_realtime_ocr.py" --duration 3600 --fps 60 --playback-speed 4 --workers 8 --center-workers 2 --max-pending 256 --hwaccel d3d11va --output "%OUTPUT%"
) else (
  "%PYTHON%" ".\scripts\simulate_days_gone_realtime_ocr.py" "%~1" --duration 3600 --fps 60 --playback-speed 4 --workers 8 --center-workers 2 --max-pending 256 --hwaccel d3d11va --output "%OUTPUT%"
)
if errorlevel 1 goto failed

echo.
echo PRIORITY OCR 4X TEST COMPLETE.
echo Results:
echo outputs\training\days-gone\priority-realtime-one-hour-4x\result.json
pause
exit /b 0

:missing_python
echo ERROR: The bundled Python runtime was not found.
pause
exit /b 1

:failed
echo.
echo PRIORITY OCR 4X TEST STOPPED WITH AN ERROR.
echo A partial result may still be available in the results folder.
pause
exit /b 1
