@echo off
echo ============================================
echo   MLM - MultiloginX Manager - Build Script
echo ============================================
echo.

REM Check if Python is installed
python --version >nul 2>&1
if errorlevel 1 (
    echo ERROR: Python is not installed or not in PATH
    echo Download from: https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during install
    pause
    exit /b 1
)

echo [1/3] Installing dependencies...
pip install requests websocket-client keyboard pywin32 Pillow pyinstaller --quiet

echo [2/3] Building MLM.exe...
pyinstaller --onefile --windowed --name MLM --icon=ico.ico mlm.py 2>nul
if not exist "dist\MLM.exe" (
    echo Building without icon...
    pyinstaller --onefile --windowed --name MLM mlm.py
)

echo [3/3] Copying files...
if exist "dist\MLM.exe" (
    copy dist\MLM.exe . >nul
    copy config.ini dist\ >nul
    echo.
    echo ============================================
    echo   BUILD SUCCESS! MLM.exe is ready.
    echo   You can find it in this folder and dist\
    echo ============================================
) else (
    echo.
    echo BUILD FAILED. Check errors above.
)

echo.
pause
