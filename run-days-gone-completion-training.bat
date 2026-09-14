@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "scripts\run-days-gone-completion-training.ps1"
if errorlevel 1 (
  echo.
  echo Completion training stopped with an error. Run check-days-gone-training-status.bat for details.
  pause
  exit /b 1
)
echo.
echo Completion training finished successfully.
pause
