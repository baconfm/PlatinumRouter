@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - Real-time OCR whole-run replay

echo Days Gone OCR - REAL-TIME WHOLE-RUN SIMULATION
echo ===============================================
echo.
echo This uses the newest recording directly inside E:\Train.
echo Recordings inside subfolders are ignored.
echo.
echo It behaves like the live router:
echo   - all OCR areas are visually gated at 60 FPS
echo   - candidates enter a bounded OCR queue immediately
echo   - capture never waits for slow OCR
echo   - center completion flurries are chronological and stop on first match
echo   - queue delay, capture lag, drops and detections are logged
echo.
echo IMPORTANT: this deliberately runs at true 1.0x playback speed.
echo A 15-hour recording takes about 15 hours, plus final queue drain.
echo Platinum Router and OBS do not need to be running.
echo You may drag a specific recording onto this BAT instead.
echo.

set "PYTHON=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%PYTHON%" goto missing_python

if "%~1"=="" (
  "%PYTHON%" ".\scripts\simulate_days_gone_realtime_ocr.py" --fps 60 --playback-speed 1 --workers 8 --max-pending 256 --hwaccel d3d11va
) else (
  "%PYTHON%" ".\scripts\simulate_days_gone_realtime_ocr.py" "%~1" --fps 60 --playback-speed 1 --workers 8 --max-pending 256 --hwaccel d3d11va
)
if errorlevel 1 goto failed

echo.
echo REAL-TIME REPLAY COMPLETE.
echo Results:
echo outputs\training\days-gone\realtime-live-replay\result.json
echo outputs\training\days-gone\realtime-live-replay\LIVE-REPLAY-REPORT.txt
pause
exit /b 0

:missing_python
echo ERROR: The bundled Python runtime was not found.
pause
exit /b 1

:failed
echo.
echo REAL-TIME REPLAY STOPPED WITH AN ERROR.
echo A partial checkpoint may still be available in the results folder.
pause
exit /b 1
