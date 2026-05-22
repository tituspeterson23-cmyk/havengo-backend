@echo off
set PATH=%PATH%;C:\Program Files\nodejs
cd /d "%~dp0"
echo Starting server for quick test...
node server.js
echo Server exited with code %ERRORLEVEL%
pause
