@echo off
rem Called by start.bat after getting the latest version.
cd /d "%~dp0.."

echo.
echo ===== Rasokh =====
echo.
echo [1/3] Installing packages...
call npm install --no-audit --no-fund
if errorlevel 1 goto npmfail
node db/ensure-seed.js

echo.
echo [2/3] Public link...
where cloudflared >nul 2>nul
if errorlevel 1 goto nocloud
if exist ".tunnel" goto named

echo Opening a temporary public link in a new window.
echo To use your own domain instead, run setup-domain.bat once.
start "Rasokh - public link" cmd /k cloudflared tunnel --url http://localhost:4000
goto site

:named
set /p TUNNEL=<.tunnel
set /p DOMAIN=<.domain
echo Connecting https://%DOMAIN% in a new window. Keep that window open too.
start "Rasokh - %DOMAIN%" cmd /k cloudflared tunnel run --url http://localhost:4000 %TUNNEL%
goto site

:nocloud
echo Cloudflare is not installed, so the site works on this computer only.

:site
echo.
echo [3/3] Starting the website on http://localhost:4000
echo Keep this window open. When there is an update, double-click update.bat
echo and the website restarts by itself.
echo.
node --watch server.js
pause
exit /b 0

:npmfail
echo.
echo ERROR: npm install failed. Take a screenshot of this window and send it.
pause
exit /b 1
