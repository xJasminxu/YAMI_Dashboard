@echo off
REM ============================================================================
REM  YAMI Web-Server stoppen
REM  - Beendet die Autostart-Aufgabe "YAMI Web-Server" (falls eingerichtet)
REM  - Beendet ein von Hand gestartetes start-yami-web.bat samt Node-Server
REM  Der Autostart bleibt eingerichtet: nach dem naechsten Hochfahren laeuft der
REM  Server wieder. Dauerhaft abschalten: autostart-entfernen.bat
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

echo Stoppe YAMI Web-Server...
schtasks /query /tn "YAMI Web-Server" >nul 2>&1
if not errorlevel 1 schtasks /end /tn "YAMI Web-Server" >nul 2>&1

REM Zuerst die Neustart-Schleife (cmd mit start-yami-web.bat), dann Node selbst,
REM sonst startet die Schleife den Server nach 5 Sekunden wieder.
powershell -NoProfile -Command ^
  "$p = Get-CimInstance Win32_Process;" ^
  "$loop = $p | Where-Object { $_.Name -eq 'cmd.exe' -and $_.CommandLine -match 'start-yami-web' };" ^
  "$node = $p | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'serve-web' };" ^
  "foreach ($x in @($loop) + @($node)) { if ($x) { Stop-Process -Id $x.ProcessId -Force -ErrorAction SilentlyContinue } };" ^
  "Start-Sleep -Seconds 1;" ^
  "if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) { Write-Host '  WARNUNG: Port 8080 ist noch belegt.'; exit 1 } else { Write-Host '  OK, Server ist gestoppt.' }"

echo.
if /i not "%~1"=="nopause" pause
