@echo off
setlocal
cd /d "%~dp0"

set PORT=8791
set URL=http://localhost:%PORT%

rem If the server is already listening, just open the browser. Starting a
rem second copy on the same port causes requests to land on whichever
rem process answers first, which looks like random loading errors.
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:"127.0.0.1:%PORT%" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    start "" %URL%
    exit /b 0
)

rem Run the server with the windowless build of Python (pythonw / pyw) so no
rem console window is left behind after this script exits. Fall back to the
rem normal console build if it isn't available.
set PY=
set WINDOWLESS=1
where pyw >nul 2>nul && set PY=pyw
if not defined PY where pythonw >nul 2>nul && set PY=pythonw
if not defined PY (
    set WINDOWLESS=0
    where py >nul 2>nul && set PY=py
)
if not defined PY (
    set WINDOWLESS=0
    where python >nul 2>nul && set PY=python
)

if not defined PY (
    echo.
    echo Could not find Python. Install Python 3.8 or newer from python.org
    echo and make sure it is on your PATH, then run this file again.
    echo.
    pause
    exit /b 1
)

if "%WINDOWLESS%"=="1" (
    rem pythonw has no console at all, so this leaves nothing on screen.
    start "" %PY% server.py
) else (
    rem No windowless Python found; minimise the server window instead.
    start "Project Selector Server" /min %PY% server.py
)

rem Wait for the server to accept connections before opening the browser,
rem instead of guessing with a fixed delay.
for /l %%i in (1,1,20) do (
    netstat -ano | findstr /r /c:"LISTENING" | findstr /c:"127.0.0.1:%PORT%" >nul 2>nul
    if not errorlevel 1 goto ready
    ping 127.0.0.1 -n 2 >nul
)

echo.
echo The server did not start within 20 seconds.
echo To see why, open a command prompt in this folder and run:
echo     python server.py
echo.
pause
exit /b 1

:ready
start "" %URL%
exit /b 0
