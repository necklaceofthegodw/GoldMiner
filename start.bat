@echo off
setlocal
cd /d "%~dp0"
title Gold Miner

where node >nul 2>nul
if errorlevel 1 (
  echo [BLAD] Nie znaleziono Node.js. Zainstaluj Node.js 22.12+ ^(zalecane LTS^).
  pause
  exit /b 1
)

if not exist "node_modules\vite" (
  echo [BLAD] Brak folderu node_modules. Uruchom "npm ci" na komputerze z internetem i skopiuj caly folder.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo Brak builda - buduje aplikacje...
  call npx vite build
  if errorlevel 1 (
    echo [BLAD] Build nie powiodl sie.
    pause
    exit /b 1
  )
)

echo Gold Miner: http://localhost:4173
echo Aby zatrzymac serwer, zamknij to okno lub nacisnij Ctrl+C.
rem Aby udostepnic gre w sieci lokalnej, dodaj --host na koncu ponizszej linii.
call npx vite preview --port 4173 --strictPort

pause
