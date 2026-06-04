@echo off
title HYBRID FRAMEWORK - MASTER LAUNCHER 🚀
color 0B

:MENU
cls
echo ===================================================
echo        HYBRID FRAMEWORK - CONTROL CENTER
echo ===================================================
echo.
echo  [1] CLEAN & START DEVELOPMENT (Hot Reload)
echo  [2] CLEAN & START PRODUCTION CLUSTER (4 Workers)
echo  [3] CLEAN ONLY (Kill Processes & Delete dist)
echo  [4] EXIT
echo.
set /p choice="Select an option (1-4): "

if "%choice%"=="1" goto DEV
if "%choice%"=="2" goto PROD
if "%choice%"=="3" goto CLEAN_ONLY
if "%choice%"=="4" exit
goto MENU

:: --- SUBROUTINES (توابع کمکی) ---

:CLEAN_ALL
echo.
echo [1/3] Killing all running processes...
echo -------------------------------------
:: بستن نرم PM2
call pm2 stop all >nul 2>&1
call pm2 delete all >nul 2>&1
call pm2 kill >nul 2>&1

:: بستن اجباری Node.js و PM2 (بی‌صدا)
taskkill /F /IM node.exe /T >nul 2>&1
taskkill /F /IM pm2.exe /T >nul 2>&1
:: نکته: بستن Redis اختیاری است. اگر می‌خواهید کش بماند، این خط را غیرفعال نگه دارید.
:: taskkill /F /IM redis-server.exe /T >nul 2>&1

echo [OK] Processes terminated.

echo.
echo [2/3] Cleaning temporary files...
echo -------------------------------------
if exist dist (
    rmdir /s /q dist
    echo [OK] 'dist' folder cleaned.
) else (
    echo [INFO] No 'dist' folder found.
)
goto :eof

:START_REDIS
:: چک کردن اینکه آیا Redis باز است یا نه
tasklist /FI "IMAGENAME eq redis-server.exe" 2>NUL | find /I /N "redis-server.exe">NUL
if "%ERRORLEVEL%"=="1" (
    echo [INFO] Starting Redis...
    :: اجرای Redis در پنجره جدید و کوچک
    start "Redis Server" /MIN cmd /k "cd /d %~dp0Redis && redis-server.exe redis.conf"
    timeout /t 2 >nul
) else (
    echo [INFO] Redis is already running.
)
goto :eof

:: --- MAIN MODES ---

:CLEAN_ONLY
call :CLEAN_ALL
echo.
echo [SUCCESS] Cleanup Complete.
pause
goto MENU

:DEV
call :CLEAN_ALL
echo.
echo [3/3] Starting DEVELOPMENT Mode...
echo -------------------------------------
:: تنظیم متغیر محیطی (مستقیم، بدون start)
set NODE_ENV=development
echo [INFO] Environment set to: DEVELOPMENT

call :START_REDIS

echo [INFO] Starting App with Hot-Reload...
echo [TIP]  Save any file to auto-restart!
echo.
:: اجرای مستقیم npm run dev
call npm run dev
pause
goto MENU

:PROD
call :CLEAN_ALL
echo.
echo [3/3] Starting PRODUCTION CLUSTER...
echo -------------------------------------
set NODE_ENV=production
echo [INFO] Environment set to: PRODUCTION

echo [BUILD] Compiling TypeScript...
call npm run build

call :START_REDIS

echo [INFO] Launching PM2 Cluster...
call pm2 start ecosystem.config.js
echo.
echo ===================================================
echo  CLUSTER IS READY!
echo  Monitor logs using:  pm2 logs
echo  Dashboard:           pm2 monit
echo ===================================================
pause
goto MENU