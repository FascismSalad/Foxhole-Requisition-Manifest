@echo off
echo Stopping Foxhole Logistics server on port 8000...
echo.

set FOUND=0

for /f "tokens=5" %%P in ('netstat -ano ^| findstr ":8000" ^| findstr "LISTENING"') do (
    echo Killing process ID %%P
    taskkill /F /PID %%P >nul 2>nul
    set FOUND=1
)

if %FOUND%==0 (
    echo No server was found running on port 8000.
) else (
    echo Server stopped.
)
