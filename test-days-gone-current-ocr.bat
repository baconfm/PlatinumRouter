@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - Current Days Gone OCR tester

echo Current Days Gone OCR tester
echo ============================
echo.
echo This replays the newest recording in E:\Train through the CURRENT
echo pickup-only scanner:
echo   - named collectibles and trophy toasts
echo   - IPCA Tech pickup text
echo   - center mission/activity OCR remains OFF
echo   - only the FIRST 60 MINUTES are tested
echo.
echo Sampling is intentionally denser than the older preflight:
echo   collectibles: 2 frames/second
echo   IPCA region:   4 frames/second
echo.
echo Completed scan phases are reusable. Platinum Router and OBS do not need to be running.
echo You may also drag a specific recording onto this BAT file.
echo.

if "%~1"=="" goto auto_recording

echo Testing supplied recording:
echo %~1
echo.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\run-days-gone-pickup-preflight.ps1" -RecordingPath "%~1" -CollectibleFps 2 -IpcaFps 4 -DurationSeconds 3600
goto finished

:auto_recording
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\run-days-gone-pickup-preflight.ps1" -CollectibleFps 2 -IpcaFps 4 -DurationSeconds 3600

:finished
if errorlevel 1 (
  echo.
  echo TEST STOPPED WITH AN ERROR.
  echo Completed phase checkpoints were kept. Run this same BAT again to resume.
  echo Latest status:
  echo outputs\training\days-gone\tomorrow-preflight\logs\latest-session.json
  pause
  exit /b 1
)

echo.
echo TEST COMPLETE.
echo.
echo Read this first:
echo outputs\training\days-gone\tomorrow-preflight\PRE-FLIGHT-REPORT.txt
echo.
echo Detailed machine-readable results:
echo outputs\training\days-gone\tomorrow-preflight\preflight-report.json
pause
