@echo off
REM Startet die fertig gebaute Web-App (dist\) im Restaurant-WLAN auf Port 8080.
REM Startet bei einem Absturz nach 5 Sekunden automatisch neu.
cd /d "%~dp0"
:loop
node scripts\serve-web.js >> web-server.log 2>&1
timeout /t 5 >nul
goto loop
