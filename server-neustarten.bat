@echo off
REM ============================================================================
REM  YAMI Web-Server neu starten (z.B. nach build-web.bat)
REM ============================================================================
setlocal
REM --- Adminrechte anfordern, falls noetig (der Autostart-Dienst laeuft als SYSTEM) ---
net session >nul 2>&1
if errorlevel 1 (
  echo Adminrechte werden angefordert...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
cd /d "%~dp0"

call "%~dp0server-stoppen.bat" nopause
call "%~dp0server-starten.bat" nopause
pause
