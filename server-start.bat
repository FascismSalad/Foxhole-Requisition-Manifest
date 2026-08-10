@echo off
cd /d "%~dp0"

echo Starting Foxhole Logistics server...
echo.

set PYTHON_CMD=
where python >nul 2>nul
if %errorlevel%==0 set PYTHON_CMD=python
if not defined PYTHON_CMD (
    where python3 >nul 2>nul
    if %errorlevel%==0 set PYTHON_CMD=python3
)

if not defined PYTHON_CMD (
    echo Python was not found on this machine.
    echo Install it from https://www.python.org/downloads/ ^(check "Add python.exe to PATH" during setup^), then run this file again.
    pause
    goto :eof
)

call :open_incognito
%PYTHON_CMD% -m http.server 8000
goto :eof

:open_incognito
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles%\Google\Chrome\Application\chrome.exe" --incognito http://localhost:8000
    goto :eof
)
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" (
    start "" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" --incognito http://localhost:8000
    goto :eof
)
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" --inprivate http://localhost:8000
    goto :eof
)
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" (
    start "" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" --inprivate http://localhost:8000
    goto :eof
)
if exist "%ProgramFiles%\Mozilla Firefox\firefox.exe" (
    start "" "%ProgramFiles%\Mozilla Firefox\firefox.exe" -private-window http://localhost:8000
    goto :eof
)
if exist "%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe" (
    start "" "%ProgramFiles(x86)%\Mozilla Firefox\firefox.exe" -private-window http://localhost:8000
    goto :eof
)

echo No Chrome, Edge, or Firefox install found for a private window - opening normally instead.
start "" http://localhost:8000
goto :eof