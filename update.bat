@echo off
chcp 65001 >nul
title Rasokh - update
cd /d "%~dp0"

echo.
echo Getting the latest version from GitHub...
git pull --ff-only
if errorlevel 1 goto pullfail

call npm install --no-audit --no-fund
if errorlevel 1 goto npmfail

echo.
echo ===== Update done =====
echo If the website window is open, it restarted by itself with the new version.
echo If it is closed, double-click start.bat
echo.
pause
exit /b 0

:pullfail
echo.
echo ERROR: could not get the update.
echo If you edited any file in this folder by hand, that can block the update.
echo Take a screenshot of this window and send it.
pause
exit /b 1

:npmfail
echo.
echo ERROR: npm install failed. Take a screenshot of this window and send it.
pause
exit /b 1
