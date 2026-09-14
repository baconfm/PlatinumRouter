@echo off
setlocal
cd /d "%~dp0"

set "PYTHON_EXE=C:\Users\Bacon\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if not exist "%PYTHON_EXE%" set "PYTHON_EXE=py"

echo.
echo Days Gone collectible progression scan
echo ======================================
echo This creates the data used by the scaled collectible comparison chart.
echo It also keeps unmatched OCR, confidence, duplicates, category totals,
echo and missing expected items so the scan can be improved without rerunning video.
echo The two recordings are scanned one after the other.
echo You do not need Platinum Router running while this works.
echo.

echo [1/2] Scanning JamCar WR...
"%PYTHON_EXE%" scripts\scan_days_gone_collectible_progress.py outputs\training\days-gone\jamcar-wr --fps 0.5
if errorlevel 1 goto :failed

echo.
echo [2/2] Scanning Bacon PB...
"%PYTHON_EXE%" scripts\scan_days_gone_collectible_progress.py outputs\training\days-gone\bacon-pb --fps 0.5
if errorlevel 1 goto :failed

echo.
echo Collectible progression data is ready.
echo Refresh run-comparison.html to display the chart.
echo.
pause
exit /b 0

:failed
echo.
echo The scan stopped with an error. Leave this window open or take a screenshot of the message above.
echo.
pause
exit /b 1
