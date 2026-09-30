@echo off
chcp 65001 >nul
title Rasokh - connect your domain
cd /d "%~dp0"

echo.
echo ===== Connect your domain to Rasokh =====
echo Run this once. After that, start.bat connects the domain by itself.
echo.

where cloudflared >nul 2>nul
if errorlevel 1 goto nocf

set "DOMAIN="
set /p DOMAIN=Type your domain without www, for example rusuokh.com: 
if "%DOMAIN%"=="" goto nodomain

echo.
echo [1/3] Cloudflare login
if exist "%USERPROFILE%\.cloudflared\cert.pem" (
  echo Already logged in to Cloudflare. Skipping.
) else (
  echo A browser page will open. Log in to Cloudflare, click %DOMAIN%, then Authorize.
  cloudflared tunnel login
  if errorlevel 1 goto fail
)

echo.
echo [2/3] Creating the tunnel "rasokh"...
cloudflared tunnel info rasokh >nul 2>nul
if errorlevel 1 (
  cloudflared tunnel create rasokh
  if errorlevel 1 goto fail
) else (
  echo The tunnel already exists. Skipping.
)

echo.
echo [3/3] Pointing %DOMAIN% and www.%DOMAIN% to the tunnel...
cloudflared tunnel route dns --overwrite-dns rasokh %DOMAIN%
if errorlevel 1 goto fail
cloudflared tunnel route dns --overwrite-dns rasokh www.%DOMAIN%
if errorlevel 1 goto fail

>.tunnel echo rasokh
>.domain echo %DOMAIN%

echo.
echo ===== Done =====
echo Close all Rasokh windows, then double-click start.bat.
echo Your site will open at https://%DOMAIN%
echo The first time can take a few minutes to work.
echo.
pause
exit /b 0

:nocf
echo Cloudflare is not installed. Open Command Prompt and run:
echo   winget install --id Cloudflare.cloudflared
echo Then close Command Prompt, and run this file again.
pause
exit /b 1

:nodomain
echo You did not type a domain.
pause
exit /b 1

:fail
echo.
echo ERROR: something went wrong. Take a screenshot of this window and send it.
pause
exit /b 1
