@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - Parse My Days Gone PB

echo Parse the two-part Days Gone PB recording
echo.
echo Input folder: E:\Train
echo Output: outputs\training\days-gone\bacon-pb
echo.
echo The scan is resumable in 30-minute video chunks.
echo Part 2 timestamps will continue from the end of Part 1.
echo Trophy popups in this recording remain available for the later trophy pass.
echo You may close the Platinum Router server while this runs.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\run-days-gone-jamcar-parse.ps1" -RunId "bacon-pb" -Runner "Bacon" -RunLabel "Days Gone Platinum plus 100 percent PB comparison source" -Part1Pattern "Platinum in One Sitting Former World Record*.mkv" -Part2Pattern "Part 2 - Platinum + 100%% Former World Record*.mkv" %*
if errorlevel 1 (
  echo.
  echo PB parsing stopped with an error.
  echo The next run will reuse every completed chunk.
  echo Check outputs\training\days-gone\bacon-pb\logs\latest-session.json for details.
  pause
  exit /b 1
)

echo.
echo PB parsing complete.
echo Results are in outputs\training\days-gone\bacon-pb
pause
