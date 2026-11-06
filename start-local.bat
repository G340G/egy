@echo off
cd /d "%~dp0"
where py >nul 2>nul
if errorlevel 1 (
  echo Python 3 is required. Install Python 3, then run this file again.
  pause
  exit /b 1
)
start "EPISTASSI local server" cmd /k "cd /d ""%~dp0"" && py -3 -m http.server 8765 --bind 127.0.0.1"
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8765/
