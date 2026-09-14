@echo off
setlocal
cd /d "%~dp0"
node ".\scripts\show-days-gone-training-status.mjs"
echo.
pause
