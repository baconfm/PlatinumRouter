@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\run-days-gone-overnight-training.ps1" %*
if errorlevel 1 (
  echo.
  echo Training stopped with an error. See outputs\training\days-gone\20260718\overnight-training.log
  pause
  exit /b 1
)
echo.
echo Days Gone training complete.
pause
