@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - New run and JamCar full OCR

echo Days Gone full OCR - newest run plus JamCar WR
echo ================================================
echo.
echo Phase 1 scans the newest recording directly inside E:\Train.
echo Phase 2 scans both JamCar files inside E:\Train\New folder.
echo.
echo Both scans use the center-flurry first-title buffer at 60 FPS:
echo   - frames are retained in chronological order
echo   - the first recognized completion title wins
echo   - later cards in that flurry are discarded after a match
echo   - the event keeps the capture timestamp, not the OCR-finish time
echo.
echo Work is saved in one-hour chunks. You can stop this window and launch
echo this BAT again to resume. Do not run another full buffered scanner at
echo the same time because both jobs share their resumable output folders.
echo Platinum Router and OBS do not need to be running.
echo.

set "PYTHON=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%PYTHON%" goto missing_python

echo [1/2] Scanning newest Bacon recording...
"%PYTHON%" ".\scripts\scan_days_gone_buffered_whole_run.py" --train-folder "E:\Train" --fps 60 --hwaccel d3d11va --workers 8
if errorlevel 1 goto failed_bacon

echo.
echo [2/2] Scanning JamCar's two-part run...
"%PYTHON%" ".\scripts\scan_days_gone_buffered_jamcar.py" --folder "E:\Train\New folder" --fps 60 --hwaccel d3d11va --workers 8
if errorlevel 1 goto failed_jamcar

echo.
echo BOTH FULL SCANS COMPLETE.
echo.
echo New run:
echo outputs\training\days-gone\buffered-whole-run-60fps\result.json
echo.
echo JamCar WR:
echo outputs\training\days-gone\jamcar-buffered-whole-run-60fps\result.json
echo.
echo Automatic comparison:
echo outputs\training\days-gone\jamcar-buffered-whole-run-60fps\comparison-vs-bacon-july25.json
pause
exit /b 0

:missing_python
echo ERROR: The bundled Python runtime was not found.
pause
exit /b 1

:failed_bacon
echo.
echo NEW-RUN SCAN STOPPED WITH AN ERROR.
echo Launch this BAT again to resume from its last completed one-hour chunk.
pause
exit /b 1

:failed_jamcar
echo.
echo JAMCAR SCAN STOPPED WITH AN ERROR.
echo The new-run scan is complete. Launch this BAT again to resume JamCar;
echo the completed new-run chunks will be reused rather than scanned again.
pause
exit /b 1
