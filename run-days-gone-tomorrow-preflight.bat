@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - Days Gone pickup OCR preflight

echo Days Gone pickup OCR preflight
echo ==============================
echo.
echo This tests the newest recording in E:\Train against tomorrow's live setup.
echo It scans named collectibles/trophies and IPCA Tech pickups.
echo Center-screen mission, horde, infestation, camp and checkpoint OCR is OFF.
echo Platinum Router does not need to be running during this replay.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\run-days-gone-pickup-preflight.ps1" %*
if errorlevel 1 (
  echo.
  echo PRE-FLIGHT STOPPED WITH AN ERROR.
  echo Completed scan checkpoints are kept, so rerunning can resume them.
  echo See outputs\training\days-gone\tomorrow-preflight\logs\latest-session.json
  pause
  exit /b 1
)

echo.
echo Preflight complete. The final report is:
echo outputs\training\days-gone\tomorrow-preflight\PRE-FLIGHT-REPORT.txt
pause

