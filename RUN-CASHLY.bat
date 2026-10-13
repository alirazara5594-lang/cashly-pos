@echo off
setlocal
title Cashly POS
rem ======================================================================
rem  Cashly POS - starts the backend and the frontend with one double-click
rem
rem  Install these once:
rem    1. .NET 10 SDK    https://dotnet.microsoft.com/download/dotnet/10.0
rem    2. Node.js 20+    https://nodejs.org
rem    3. PostgreSQL     https://www.postgresql.org/download/windows/
rem       (note the password you give the "postgres" user while installing)
rem
rem  Keep this file in the cashly-pos folder, next to Pos.Api and pos-frontend.
rem ======================================================================

rem ---- Your PostgreSQL password and port. Change these to match your PostgreSQL. ----
rem      (If the password contains a % sign, write it as %%.)
set "DB_PASSWORD=12345678"
set "DB_PORT=5432"

cd /d "%~dp0"

if not exist "Pos.Api\Pos.Api.csproj" (
  echo This file must be inside the cashly-pos folder, next to Pos.Api and pos-frontend.
  pause
  exit /b 1
)

where dotnet >nul 2>nul
if errorlevel 1 (
  echo .NET SDK not found. Install the .NET 10 SDK:
  echo   https://dotnet.microsoft.com/download/dotnet/10.0
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo Node.js not found. Install Node.js 20 or newer:
  echo   https://nodejs.org
  pause
  exit /b 1
)

rem ---- Frontend packages: first run only ----
if not exist "pos-frontend\node_modules" (
  echo Installing frontend packages. First run only, this takes a few minutes...
  pushd pos-frontend
  call npm install
  if errorlevel 1 (
    popd
    echo npm install failed. Check your internet connection and run this file again.
    pause
    exit /b 1
  )
  popd
)

rem ---- Settings the backend reads (they override appsettings, nothing is edited) ----
set "ASPNETCORE_ENVIRONMENT=Development"
set "ConnectionStrings__DefaultConnection=Host=localhost;Port=%DB_PORT%;Database=cashly_pos_db;Username=postgres;Password=%DB_PASSWORD%"

echo.
echo Starting the backend  (http://localhost:5288) in a new window...
start "Cashly Backend" /D "%~dp0Pos.Api" cmd /k dotnet run --launch-profile http

echo Starting the frontend (http://localhost:5173) in a new window...
start "Cashly Frontend" /D "%~dp0pos-frontend" cmd /k npm run dev

rem ---- Wait for the backend to answer, then open the browser ----
echo.
echo Waiting for the backend. The first start builds the project and creates the
echo database, so it can take a few minutes...
set /a tries=0
:wait
curl -s -o nul http://localhost:5288/ >nul 2>nul
if not errorlevel 1 goto ready
set /a tries+=1
if %tries% geq 120 goto ready
timeout /t 5 /nobreak >nul
goto wait

:ready
start "" http://localhost:5173

echo.
echo ======================================================================
echo  Cashly POS is running:  http://localhost:5173
echo.
echo  First sign-in on a new database:
echo    click "Platform Admin", username: superadmin   PIN: 999999
echo.
echo  If the backend window shows a database error, open this file in
echo  Notepad and set DB_PASSWORD to your PostgreSQL password.
echo.
echo  To stop: close the "Cashly Backend" and "Cashly Frontend" windows.
echo ======================================================================
echo.
pause
