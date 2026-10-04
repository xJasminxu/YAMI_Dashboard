@echo off
REM ============================================================================
REM  YAMI Web-Server: Autostart einrichten (einmalig ausfuehren, braucht Admin)
REM
REM  - Legt eine Windows-Aufgabe "YAMI Web-Server" an, die start-yami-web.bat
REM    beim Hochfahren startet - auch OHNE dass sich jemand anmeldet.
REM    Laeuft unsichtbar im Hintergrund, ohne Zeitlimit, auch im Akkubetrieb.
REM  - Oeffnet Port 8080 in der Windows-Firewall (privates Netzwerk), da beim
REM    Hintergrundstart kein "Zugriff zulassen"-Dialog erscheint.
REM  - Energieeinstellungen am Netzteil: kein Standby, Deckel zu = nichts tun,
REM    Schnellstart aus (sonst feuert der Hochfahr-Trigger nicht zuverlaessig).
REM
REM  Wieder entfernen:  schtasks /delete /tn "YAMI Web-Server" /f
REM ============================================================================
setlocal

REM --- Adminrechte anfordern, falls noetig ---
net session >nul 2>&1
if errorlevel 1 (
  echo Adminrechte werden angefordert...
  powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)

cd /d "%~dp0"
set "TASK=YAMI Web-Server"
set "SCRIPT=%~dp0start-yami-web.bat"
set "WORKDIR=%~dp0"

echo.
echo === YAMI Web-Server Autostart einrichten ===
echo Ordner: %WORKDIR%
echo.

REM --- Voraussetzungen pruefen ---
if not exist "%SCRIPT%" (
  echo FEHLER: start-yami-web.bat nicht gefunden.
  pause
  exit /b 1
)

where node >nul 2>&1
if errorlevel 1 (
  echo FEHLER: Node.js nicht gefunden. Bitte Node.js LTS von nodejs.org installieren.
  pause
  exit /b 1
)
for /f "delims=" %%N in ('where node') do (
  set "NODE_EXE=%%N"
  goto :nodefound
)
:nodefound
echo Node.js: %NODE_EXE%
echo %NODE_EXE% | findstr /i /c:"\Users\" >nul
if not errorlevel 1 (
  echo.
  echo WARNUNG: Node.js ist nur fuer diesen Benutzer installiert ^(z.B. nvm^).
  echo          Der Hintergrunddienst laeuft als SYSTEM und findet es dann evtl. nicht.
  echo          Empfehlung: Node.js LTS mit dem normalen Installer von nodejs.org
  echo          installieren ^(landet in C:\Program Files\nodejs^).
  echo.
)

if not exist "dist\index.html" (
  echo.
  echo HINWEIS: dist\index.html fehlt noch. Vor dem ersten Start build-web.bat ausfuehren,
  echo          sonst startet der Server, findet aber keine App.
  echo.
)

REM --- Geplante Aufgabe anlegen bzw. ueberschreiben ---
echo Lege Aufgabe "%TASK%" an...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference = 'Stop';" ^
  "$a = New-ScheduledTaskAction -Execute $env:SCRIPT -WorkingDirectory $env:WORKDIR;" ^
  "$t = New-ScheduledTaskTrigger -AtStartup; $t.Delay = 'PT30S';" ^
  "$p = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest;" ^
  "$s = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew;" ^
  "Register-ScheduledTask -TaskName $env:TASK -Action $a -Trigger $t -Principal $p -Settings $s -Description 'Startet den YAMI Web-Server (Port 8080) beim Hochfahren' -Force | Out-Null"
if errorlevel 1 (
  echo FEHLER: Aufgabe konnte nicht angelegt werden.
  pause
  exit /b 1
)
echo   OK

REM --- Firewall: Port 8080 im privaten Netzwerk freigeben ---
echo Firewall-Regel fuer Port 8080...
netsh advfirewall firewall delete rule name="YAMI Web-Server (8080)" >nul 2>&1
netsh advfirewall firewall add rule name="YAMI Web-Server (8080)" dir=in action=allow protocol=TCP localport=8080 profile=private,domain >nul
if errorlevel 1 (echo   WARNUNG: Firewall-Regel fehlgeschlagen) else (echo   OK)

REM --- Energieeinstellungen (nur am Netzteil) ---
echo Energieeinstellungen...
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
powercfg /setacvalueindex SCHEME_CURRENT SUB_BUTTONS LIDACTION 0
powercfg /setactive SCHEME_CURRENT
powercfg /hibernate off
echo   OK (kein Standby am Netzteil, Deckel zu = nichts tun, Schnellstart aus)

REM --- Netzwerktyp anzeigen (muss "Private" sein, sonst greift die Firewall-Regel nicht) ---
echo.
echo Aktuelles Netzwerk:
powershell -NoProfile -Command "Get-NetConnectionProfile | ForEach-Object { '  ' + $_.Name + '  ->  ' + $_.NetworkCategory }"
echo   Steht dort "Public", in den WLAN-Einstellungen auf "Privates Netzwerk" umstellen.

REM --- Optional direkt starten ---
echo.
echo Falls start-yami-web.bat gerade noch in einem Fenster laeuft, dieses vorher schliessen.
choice /c JN /m "Server jetzt im Hintergrund starten"
if errorlevel 2 goto :done
schtasks /run /tn "%TASK%" >nul
echo   Gestartet. Log: %WORKDIR%web-server.log

:done
echo.
echo Fertig. Ab jetzt startet der Server bei jedem Hochfahren automatisch.
echo Erreichbar unter http://^<IP-des-Laptops^>:8080
echo start-yami-web.bat NICHT zusaetzlich von Hand starten (Port waere doppelt belegt).
echo.
pause
