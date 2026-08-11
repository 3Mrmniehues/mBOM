@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

set PORT=8791

rem Ask the server to stop gracefully so it writes the Excel/query JSON
rem snapshot on the way down. A forced kill (below) can't run that final write.
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://localhost:%PORT%/api/shutdown' -Method Post -TimeoutSec 5 | Out-Null } catch {}" >nul 2>nul

rem Give it a few seconds to finish writing and release the port.
for /l %%i in (1,1,10) do (
    netstat -ano | findstr /r /c:"LISTENING" | findstr /c:"127.0.0.1:%PORT%" >nul 2>nul
    if errorlevel 1 (
        echo Project Selector server stopped.
        ping 127.0.0.1 -n 2 >nul
        exit /b 0
    )
    ping 127.0.0.1 -n 2 >nul
)

rem Still listening (e.g. an older build without the shutdown route, or a hung
rem process) - force-kill whatever holds the port. No final JSON write happens
rem in this path.
set FOUND=0
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:"LISTENING" ^| findstr /c:"127.0.0.1:%PORT%"') do (
    taskkill /pid %%p /f >nul 2>nul
    if not errorlevel 1 set FOUND=1
)

if "!FOUND!"=="1" (
    echo Project Selector server stopped ^(forced^).
) else (
    echo Project Selector server was not running.
)

rem ping, not timeout: timeout fails outright if stdin is redirected.
ping 127.0.0.1 -n 3 >nul
exit /b 0
