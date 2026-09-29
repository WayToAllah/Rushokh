@echo off
chcp 65001 >nul
title Rasokh - website
cd /d "%~dp0"

echo.
echo ===== Rasokh =====
echo.
echo [1/3] Getting the latest version from GitHub...
git pull --ff-only
if errorlevel 1 echo WARNING: could not get updates. Starting the version you already have.

echo.
echo [2/3] Installing packages...
call npm install --no-audit --no-fund
if errorlevel 1 goto npmfail
node db/ensure-seed.js

where cloudflared >nul 2>nul
if errorlevel 1 goto nocloud
echo.
echo Opening the public link in a new window...
start "Rasokh - public link" cmd /k cloudflared tunnel --url http://localhost:4000
:nocloud

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
