@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=py"

echo.
echo Days Gone July 18 collectible progression scan
echo ===============================================
echo Run this after the current Bacon PB scan finishes.
echo It performs the same fresh full-video pass used for the other runs.
echo The trusted historical OCR export is kept separately as a reference.
echo You do not need Platinum Router running.
echo.

"%PYTHON_EXE%" scripts\scan_days_gone_collectible_progress.py outputs\training\days-gone\20260718 --fps 0.5 --output outputs\training\days-gone\20260718\collectible-progress-scanned.json
if errorlevel 1 goto :failed

echo.
echo July 18 fresh scan is ready.
echo Send me the result screen so I can compare it with the historical OCR data.
echo.
pause
exit /b 0

:failed
echo.
echo The scan stopped with an error. Leave this window open or take a screenshot.
echo.
pause
exit /b 1
