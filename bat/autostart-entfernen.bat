@echo off
REM ============================================================================
REM  YAMI Web-Server: Autostart entfernen
REM  Loescht die Aufgabe "YAMI Web-Server", die autostart-einrichten.bat angelegt
REM  hat. Ab dann startet der Server beim Hochfahren NICHT mehr von selbst.
REM  Ein gerade laufender Server laeuft weiter (stoppen: server-stoppen.bat).
REM  Wieder einschalten: autostart-einrichten.bat
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

schtasks /query /tn "YAMI Web-Server" >nul 2>&1
if errorlevel 1 (
  echo Autostart ist nicht eingerichtet, nichts zu tun.
  echo.
  pause
  exit /b 0
)

schtasks /delete /tn "YAMI Web-Server" /f >nul
if errorlevel 1 (
  echo FEHLER: Aufgabe konnte nicht geloescht werden.
) else (
  echo OK, Autostart entfernt.
)
echo.
choice /c JN /m "Server jetzt auch stoppen"
if errorlevel 2 goto :done
call "%~dp0server-stoppen.bat" nopause

:done
echo.
pause
