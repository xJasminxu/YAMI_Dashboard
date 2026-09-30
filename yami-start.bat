@echo off
cd /d C:\Users\Admin\Documents\GitHub\YAMI_Dashboard
set REACT_NATIVE_PACKAGER_HOSTNAME=192.168.2.208
:loop
call npx expo start --lan >> server.log 2>&1
timeout /t 5 >nul
goto loop No newline at end of file