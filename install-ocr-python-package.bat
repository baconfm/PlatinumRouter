@echo off
setlocal

echo Installing Python OCR helper package...
echo.

where python >nul 2>nul
if errorlevel 1 (
  echo Python was not found on PATH.
  echo Install Python and enable "Add python.exe to PATH", then run this file again.
  pause
  exit /b 1
)

python -m pip install --upgrade pip
python -m pip install pillow pytesseract

echo.
echo Python OCR packages installed.
echo If Platinum Router still says no local OCR engine is found, install the Tesseract OCR app too.
pause
