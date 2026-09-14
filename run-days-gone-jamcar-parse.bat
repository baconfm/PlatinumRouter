@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - Parse JamCar Days Gone WR

echo Parse JamCar's two-part Days Gone 100%% run
echo.
echo Input folder: E:\Train
echo Output: outputs\training\days-gone\jamcar-wr
echo.
echo The scan is resumable in 30-minute video chunks.
echo Part 2 timestamps will continue from the end of Part 1.
echo You may close the Platinum Router server while this runs.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\run-days-gone-jamcar-parse.ps1" %*
if errorlevel 1 (
  echo.
  echo JamCar parsing stopped with an error.
  echo The next run will reuse every completed chunk.
  echo Check outputs\training\days-gone\jamcar-wr\logs\latest-session.json for details.
  pause
  exit /b 1
)

echo.
echo JamCar parsing complete.
echo Results are in outputs\training\days-gone\jamcar-wr
pause
