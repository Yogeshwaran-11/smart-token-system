@echo off
title Smart Token Queue System Launcher
echo ========================================================
echo   Smart Token Queue Management System Launcher
echo ========================================================
echo.

:: Check if backend directory exists
if not exist "backend" (
    echo [ERROR] "backend" folder not found. Please run this script in the root folder of the project.
    pause
    exit /b
)

cd backend

:: Check if virtual environment exists
if not exist "venv" (
    echo [ERROR] Virtual environment not found. Please verify python is installed and dependencies are built.
    pause
    exit /b
)

echo [1/2] Starting Python FastAPI backend server...
:: Run uvicorn in a separate console window so log output is visible and easily closeable
start "Smart Token Backend Server" cmd /k "venv\Scripts\uvicorn app.main:app"

:: Wait for uvicorn to initialize
echo Waiting for server to initialize...
timeout /t 3 >nul

echo [2/2] Opening Control Hub in default browser...
:: Launch the unified Control Hub landing page
start http://127.0.0.1:8000/static/index.html

echo.
echo ========================================================
echo   System launched successfully!
echo   To stop the server, close the separate server window.
echo ========================================================
echo.
pause
