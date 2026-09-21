@echo off
echo ===================================================
echo Starting Cashly POS Backend (.NET 10 API)
echo URL: http://localhost:5288
echo ===================================================
cd /d "%~dp0Pos.Api"
set ASPNETCORE_ENVIRONMENT=Development
dotnet run --launch-profile http
pause
