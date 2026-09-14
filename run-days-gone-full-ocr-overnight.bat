@echo off
setlocal
cd /d "%~dp0"
title Platinum Router - Days Gone Full OCR Overnight Training

echo Days Gone full OCR overnight training
echo Recording: E:\Train\2026-07-18 10-01-32.mkv
echo.
echo This run is resumable. Existing extracted samples and completed video chunks are reused.
echo You can check progress with check-days-gone-training-status.bat.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\scripts\run-days-gone-full-ocr-overnight.ps1" %*
if errorlevel 1 (
  echo.
  echo Full OCR training stopped with an error.
  echo Run check-days-gone-training-status.bat to see the failed phase and log folder.
  pause
  exit /b 1
)

echo.
echo Days Gone full OCR overnight training complete.
echo Run check-days-gone-training-status.bat for the final report location.
pause

