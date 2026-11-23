@echo off
setlocal
cd /d "%~dp0"
title Gold Miner

rem The portable Node.js bundled by publish.bat takes precedence over a system install.
if exist "%~dp0node\node.exe" set "PATH=%~dp0node;%PATH%"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found. The "node" folder is missing - prepare the package with publish.bat
  echo         or install Node.js 22.12+ ^(LTS recommended^).
  pause
  exit /b 1
)

if not exist "node_modules\vite\bin\vite.js" (
  echo [ERROR] The node_modules folder is missing. Prepare the package with publish.bat on a computer
  echo         with internet access and copy the whole publish folder.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo No build found - building the app...
  node node_modules\vite\bin\vite.js build
  if errorlevel 1 (
    echo [ERROR] Build failed.
    pause
    exit /b 1
  )
)

echo Gold Miner: http://localhost:4173
echo To stop the server, close this window or press Ctrl+C.
rem To share the game on the local network, add --host at the end of the line below.
node node_modules\vite\bin\vite.js preview --port 4173 --strictPort

pause
