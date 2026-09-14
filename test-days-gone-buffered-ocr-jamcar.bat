@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - JamCar whole-run OCR scan

echo Days Gone buffered OCR - JamCar two-part run
echo =============================================
echo.
echo This scans these recordings from E:\Train\New folder:
echo   Days Gone 100%% Speedrun pt.1
echo   Days Gone 100%% Speedrun pt.2
echo.
echo Both parts are joined into one continuous 15h29m timeline.
echo Achievements/trophies are explicitly excluded because JamCar's VOD
echo does not contain PlayStation trophy popups.
echo.
echo The scan runs in resumable one-hour chunks at 60 FPS. If interrupted,
echo launch this BAT again and it will continue from completed chunks.
echo Platinum Router and OBS do not need to be running.
echo.

set "PYTHON=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%PYTHON%" goto missing_python

"%PYTHON%" ".\scripts\scan_days_gone_buffered_jamcar.py" --folder "E:\Train\New folder" --fps 60 --hwaccel d3d11va --workers 8
if errorlevel 1 goto failed

echo.
echo JAMCAR WHOLE-RUN SCAN COMPLETE.
echo.
echo Combined results:
echo outputs\training\days-gone\jamcar-buffered-whole-run-60fps\result.json
echo.
echo Comparison against Bacon July 25:
echo outputs\training\days-gone\jamcar-buffered-whole-run-60fps\comparison-vs-bacon-july25.json
pause
exit /b 0

:missing_python
echo ERROR: The bundled Python runtime was not found.
pause
exit /b 1

:failed
echo.
echo JAMCAR SCAN STOPPED WITH AN ERROR.
echo Launch this BAT again to resume from the last completed hour.
pause
exit /b 1
