@echo off
setlocal

set "ROOT=%~dp0"
set "APP_DIR=%ROOT%"
set "PORT=%~1"

if "%PORT%"=="" set "PORT=8080"

if exist "%ROOT%PlatinumRouter-main\index.html" (
  set "APP_DIR=%ROOT%PlatinumRouter-main"
)

cd /d "%APP_DIR%" || (
  echo Failed to open app directory:
  echo %APP_DIR%
  pause
  exit /b 1
)

if not exist "index.html" (
  echo Could not find index.html in:
  echo %APP_DIR%
  pause
  exit /b 1
)

if not exist "scripts\router_server.py" (
  echo Could not find scripts\router_server.py in:
  echo %APP_DIR%
  pause
  exit /b 1
)

set "PYTHON_CMD="

where python >nul 2>nul
if not errorlevel 1 set "PYTHON_CMD=python"

if "%PYTHON_CMD%"=="" (
  where py >nul 2>nul
  if not errorlevel 1 set "PYTHON_CMD=py -3"
)

if "%PYTHON_CMD%"=="" (
  echo Python was not found on PATH.
  echo Install Python and enable "Add python.exe to PATH", then run this file again.
  pause
  exit /b 1
)

set "URL=http://localhost:%PORT%/index.html"

title Platinum Router Local Server
echo Platinum Router
echo ==============================
echo.
echo App folder:
echo %APP_DIR%
echo.
echo Python:
%PYTHON_CMD% --version
echo.
echo Opening:
echo %URL%
echo.
echo Press Ctrl+C in this window to stop the server.
echo Local save API enabled for editor and run exports.
echo.

start "" "%URL%"
%PYTHON_CMD% scripts\router_server.py --host 127.0.0.1 --port %PORT%

echo.
echo Server stopped.
pause
