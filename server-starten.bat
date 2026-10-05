@echo off
REM ============================================================================
REM  YAMI Web-Server starten
REM  - Ist der Autostart eingerichtet (autostart-einrichten.bat), wird die
REM    Aufgabe "YAMI Web-Server" gestartet: laeuft unsichtbar im Hintergrund.
REM  - Sonst startet start-yami-web.bat in einem eigenen, minimierten Fenster.
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

if not exist "dist\index.html" (
  echo FEHLER: dist\index.html fehlt. Zuerst build-web.bat ausfuehren.
  echo.
  if /i not "%~1"=="nopause" pause
  exit /b 1
)

powershell -NoProfile -Command "if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo Der Server laeuft bereits auf Port 8080. Neu starten: server-neustarten.bat
  echo.
  if /i not "%~1"=="nopause" pause
  exit /b 0
)

echo Starte YAMI Web-Server...
schtasks /query /tn "YAMI Web-Server" >nul 2>&1
if errorlevel 1 (
  start "YAMI Web-Server" /min cmd /c "%~dp0start-yami-web.bat"
) else (
  schtasks /run /tn "YAMI Web-Server" >nul
)

REM Bis zu 15 Sekunden warten, bis Port 8080 lauscht.
powershell -NoProfile -Command ^
  "for ($i = 0; $i -lt 15; $i++) { if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { Write-Host '  OK, Server laeuft. Log: web-server.log'; exit 0 }; Start-Sleep -Seconds 1 };" ^
  "Write-Host '  WARNUNG: Server antwortet nicht. Bitte web-server.log pruefen.'; exit 1"

echo.
if /i not "%~1"=="nopause" pause
