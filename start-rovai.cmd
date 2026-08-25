@echo off
setlocal EnableExtensions
title Rovai AI Local Launcher

set "ROVAI_CHECK_ONLY=0"
set "ROVAI_EXIT_CODE=1"
set "ROVAI_POWERSHELL=%~dp0scripts\start-rovai.ps1"

if /I "%~1"=="--check" (
  set "ROVAI_CHECK_ONLY=1"
  shift
)
if not "%~1"=="" (
  echo [Rovai] Unsupported argument: %~1
  echo [Rovai] Usage: start-rovai.cmd [--check]
  goto :failed
)

if not exist "%ROVAI_POWERSHELL%" (
  echo [Rovai] Missing launcher script: %ROVAI_POWERSHELL%
  goto :failed
)
where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [Rovai] Windows PowerShell is required but was not found.
  goto :failed
)

if "%ROVAI_CHECK_ONLY%"=="1" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROVAI_POWERSHELL%" -Check
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%ROVAI_POWERSHELL%"
)
set "ROVAI_EXIT_CODE=%ERRORLEVEL%"
if not "%ROVAI_EXIT_CODE%"=="0" goto :failed
goto :done

:failed
if "%ROVAI_CHECK_ONLY%"=="0" pause

:done
endlocal & exit /b %ROVAI_EXIT_CODE%
