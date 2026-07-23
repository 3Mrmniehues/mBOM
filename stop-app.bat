@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set PORT=8791
set FOUND=0

rem The server runs windowless (see start-app.bat), so stop it by finding
rem whatever process is listening on its port.
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr /c:"127.0.0.1:%PORT%"') do (
    taskkill /pid %%p /f >nul 2>nul
    if not errorlevel 1 set FOUND=1
)

if "!FOUND!"=="1" (
    echo Project Selector server stopped.
) else (
    echo Project Selector server was not running.
)

rem ping, not timeout: timeout fails outright if stdin is redirected.
ping 127.0.0.1 -n 3 >nul
exit /b 0
