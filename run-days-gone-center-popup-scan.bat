@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\run-days-gone-center-popup-scan.ps1"
if errorlevel 1 (
  echo.
  echo Center-popup discovery stopped with an error. Existing chunks can be resumed.
  pause
  exit /b 1
)
echo.
echo Center-popup discovery finished successfully.
pause
