@echo off
chcp 65001 >nul
title Rasokh - website
cd /d "%~dp0"

echo.
echo Getting the latest version from GitHub...
git pull --ff-only
if errorlevel 1 echo WARNING: could not get updates. Starting the version you already have.

rem Everything else lives in scripts\start-site.cmd, so this file never has to change.
call "%~dp0scripts\start-site.cmd"
