@echo off
REM Baut die Produktions-Web-App nach dist\ (einmal nach jedem Code-Update ausfuehren).
REM Liest die Supabase-Zugangsdaten aus .env (nicht im Git).
cd /d "%~dp0"
if not exist .env (
  echo FEHLER: .env fehlt. Kopie von .env.example anlegen und Supabase-URL/Key eintragen.
  pause
  exit /b 1
)
call npm install
call npx expo export --platform web --clear
if errorlevel 1 (
  echo Build fehlgeschlagen.
  pause
  exit /b 1
)
echo.
echo Fertig. Jetzt start-yami-web.bat starten.
pause
