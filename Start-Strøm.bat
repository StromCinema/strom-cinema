@echo off
setlocal

set "NODE_EXE=%~dp0node.exe"
set "SERVER=%~dp0plexus-server.cjs"

:: Launch the server in its OWN window instead of blocking here — that
:: window keeps showing the server's console log (same as before), but
:: this launcher script can now move on to open the browser instead of
:: waiting for the server process to exit.
IF EXIST "%NODE_EXE%" (
    start "Strom Server" "%NODE_EXE%" "%SERVER%"
) ELSE (
    node --version >nul 2>&1
    IF %ERRORLEVEL% NEQ 0 (
        echo.
        echo Node.js was not found on this machine.
        echo Please download and install it from: https://nodejs.org
        echo Then run this batch file again.
        echo.
        pause
        exit /b
    )
    start "Strom Server" node "%SERVER%"
)

:: Give the server a few seconds to finish booting before opening tabs,
:: so the browser doesn't land on it before it's actually listening.
timeout /t 3 /nobreak >nul

:: "start" with a URL hands it straight to the user's default browser —
:: works the same whether that's Edge, Chrome, Firefox, whatever.
start "" "http://localhost:5000"
start "" "http://localhost:5000/setup"

exit /b
