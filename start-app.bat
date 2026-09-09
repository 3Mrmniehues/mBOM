@echo off
setlocal
cd /d "%~dp0"

set PORT=8791
set URL=http://localhost:%PORT%

rem Optional: write the Excel/query JSON file to a shared drive so others can
rem read it. Prefer setting export_json in config.ini; uncomment the next line
rem only for a quick one-off override (it wins over config.ini).
rem set BOM_EXPORT_PATH=Z:\Shared\mBOM\bom-data.json

rem If the server is already listening, just open the browser. Starting a
rem second copy on the same port causes requests to land on whichever
rem process answers first, which looks like random loading errors.
netstat -ano | findstr /r /c:"LISTENING" | findstr /c:"127.0.0.1:%PORT%" >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    call :open_app
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
call :open_app
exit /b 0

rem ---------------------------------------------------------------------------
rem Open the app. If Google Chrome is installed, launch it in "app mode"
rem (--app=), which gives a clean, standalone window (no tabs/address bar) that
rem looks like a desktop app and carries the app's own icon. Otherwise fall
rem back to the default browser.
rem ---------------------------------------------------------------------------
:open_app
set "CHROME="
for %%P in (
    "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
    "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
    "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do if not defined CHROME if exist "%%~P" set "CHROME=%%~P"

rem Fall back to the registry (App Paths) in case Chrome is installed elsewhere.
if not defined CHROME (
    for /f "tokens=2*" %%A in ('reg query "HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do set "CHROME=%%B"
)
if not defined CHROME (
    for /f "tokens=2*" %%A in ('reg query "HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| findstr /i "REG_SZ"') do set "CHROME=%%B"
)

if defined CHROME (
    start "" "%CHROME%" --app=%URL%
) else (
    start "" %URL%
)
goto :eof
