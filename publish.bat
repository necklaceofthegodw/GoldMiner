@echo off
setlocal
cd /d "%~dp0"
title Gold Miner - publish

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\publish.ps1" %*
if errorlevel 1 (
  echo.
  echo [ERROR] Preparing the publish folder failed.
  pause
  exit /b 1
)

pause
