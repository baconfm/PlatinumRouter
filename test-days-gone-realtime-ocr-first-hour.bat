@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - Real-time OCR one-hour simulation

echo Days Gone OCR - ONE-HOUR LIVE SIMULATION
echo ==========================================
echo.
echo This replays the FIRST 60 MINUTES exactly like a live run:
echo   - all OCR areas are visually checked at 60 FPS
echo   - candidates enter the bounded OCR queue immediately
echo   - capture continues while OCR runs in the background
echo   - center completion flurries stop after their first match
echo   - queue delay, capture lag, drops and detections are logged
echo.
echo It runs at true 1.0x speed, so the test takes about one hour.
echo Platinum Router and OBS do not need to be running.
echo By default it uses the newest recording directly in E:\Train.
echo You can drag a specific recording onto this BAT instead.
echo.

set "PYTHON=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
set "OUTPUT=%CD%\outputs\training\days-gone\realtime-one-hour\result.json"

if not exist "%PYTHON%" goto missing_python

if "%~1"=="" (
  "%PYTHON%" ".\scripts\simulate_days_gone_realtime_ocr.py" --duration 3600 --fps 60 --playback-speed 1 --workers 8 --center-workers 2 --max-pending 256 --hwaccel d3d11va --output "%OUTPUT%"
) else (
  "%PYTHON%" ".\scripts\simulate_days_gone_realtime_ocr.py" "%~1" --duration 3600 --fps 60 --playback-speed 1 --workers 8 --center-workers 2 --max-pending 256 --hwaccel d3d11va --output "%OUTPUT%"
)
if errorlevel 1 goto failed

echo.
echo ONE-HOUR LIVE SIMULATION COMPLETE.
echo Results:
echo outputs\training\days-gone\realtime-one-hour\result.json
pause
exit /b 0

:missing_python
echo ERROR: The bundled Python runtime was not found.
pause
exit /b 1

:failed
echo.
echo ONE-HOUR LIVE SIMULATION STOPPED WITH AN ERROR.
echo A partial result may still be available in the results folder.
pause
exit /b 1
