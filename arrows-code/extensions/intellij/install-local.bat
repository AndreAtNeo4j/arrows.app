@echo off
setlocal
set "DIR=%~dp0"

call "%DIR%gradlew.bat" -p "%DIR%" :plugin:buildPlugin || exit /b 1

echo.
echo [install-local] Packaged: %DIR%plugin\build\distributions\plugin.zip
echo [install-local] Install: IDE ^> Settings ^> Plugins ^> (gear) Install Plugin from Disk... ^> pick the zip, then restart.
echo [install-local] Or run a sandbox IDE with it loaded: "%DIR%gradlew.bat" :plugin:runIde
