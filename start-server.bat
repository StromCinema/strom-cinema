@echo off
title Strom Cinema Server
cls

echo  ==========================================
echo   Strom Cinema ^| Media Server
echo  ==========================================
echo.
echo  Finding your local IP address...
echo.

for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /i "IPv4" ^| findstr /v "127.0.0.1"') do (
  set IP=%%a
  goto :found
)

:found
set IP=%IP: =%
echo  Server address to enter in the app:
echo.
echo    %IP%:5000
echo.
echo  ==========================================
echo.
echo  Starting server... (keep this window open)
echo.

node plexus-server.cjs

echo.
echo  Server stopped or crashed. Press any key to close.
pause >nul
