<#
.SYNOPSIS
    Registers the Cashly API as a Windows Service so it starts on boot and never needs a terminal.

.DESCRIPTION
    Why this is needed:

    `dotnet run` is a DEVELOPMENT command. It runs in the foreground, tied to the terminal that
    launched it, and reads Properties/launchSettings.json for its port. Close the window, log
    out or reboot and the API is gone — which is exactly the "it stops working when I reopen"
    problem this fixes.

    A Windows Service has none of those properties: it starts before anyone logs in, survives
    reboots, and restarts itself if it crashes.

    RUN THIS AS ADMINISTRATOR. Registering a service requires elevation.

.EXAMPLE
    # Right-click PowerShell -> Run as Administrator, then:
    .\install-service.ps1

.EXAMPLE
    # Point it at a different published folder
    .\install-service.ps1 -InstallPath 'D:\CashlyServer'
#>

[CmdletBinding()]
param(
    [string]$InstallPath = 'C:\CashlyServer',
    [string]$ServiceName = 'CashlyApi',
    [int]$Port = 5288
)

$ErrorActionPreference = 'Stop'

function Ok($m)   { Write-Host "   OK   $m" -ForegroundColor Green }
function Info($m) { Write-Host "`n>> $m" -ForegroundColor Cyan }
function Warn2($m){ Write-Host "   !    $m" -ForegroundColor Yellow }

# --- Elevation ---------------------------------------------------------------
# Checked first: everything below fails in confusing ways without it, and "access denied" from
# New-Service is far less clear than saying so upfront.
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()
           ).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host ""
    Write-Host "  This script must run as Administrator." -ForegroundColor Red
    Write-Host "  Close this window, right-click PowerShell, choose 'Run as Administrator',"
    Write-Host "  then run it again."
    Write-Host ""
    exit 1
}

$exe = Join-Path $InstallPath 'Pos.Api.exe'

Info "Checking the published build"
if (-not (Test-Path $exe)) {
    Write-Host "  Not found: $exe" -ForegroundColor Red
    Write-Host "  Publish it first:" -ForegroundColor Yellow
    Write-Host "    cd D:\Project\cashly-pos\Pos.Api"
    Write-Host "    dotnet publish -c Release -o `"$InstallPath`""
    exit 1
}
Ok "Found $exe"

$prodConfig = Join-Path $InstallPath 'appsettings.Production.json'
if (-not (Test-Path $prodConfig)) {
    # Without this the service starts and immediately dies: production refuses to boot without a
    # signing key, and a service failing at startup gives no visible error to the person waiting.
    Warn2 "appsettings.Production.json is missing — the service will not start without it."
    Warn2 "It needs at least a Jwt:Key and a ConnectionStrings:DefaultConnection."
    exit 1
}
Ok "Production configuration present"

Info "Checking PostgreSQL"
$pg = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pg) {
    if ($pg.Status -ne 'Running') { Start-Service $pg.Name; Ok "Started $($pg.Name)" }
    else { Ok "$($pg.Name) already running" }

    # The API depends on the database. Declaring it to the SCM means Windows starts Postgres
    # FIRST on boot — otherwise the API races it, loses, and sits there failed.
    $dependsOn = $pg.Name
} else {
    Warn2 "PostgreSQL service not found — the API will fail to reach its database."
    $dependsOn = $null
}

Info "Registering the service"
$existing = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
if ($existing) {
    Write-Host "   Service already exists — reinstalling to pick up the new build."
    if ($existing.Status -eq 'Running') { Stop-Service $ServiceName -Force }
    # sc.exe rather than Remove-Service, which only exists on newer PowerShell versions.
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
}

$params = @{
    Name           = $ServiceName
    BinaryPathName = "`"$exe`""
    DisplayName    = 'Cashly Business Host'
    Description    = 'Runs the Cashly ERP/POS API and serves terminals on this network.'
    StartupType    = 'Automatic'
}
if ($dependsOn) { $params['DependsOn'] = $dependsOn }
New-Service @params | Out-Null
Ok "Service '$ServiceName' registered (Automatic start)"

# --- Crash recovery ----------------------------------------------------------
# Restart after 5s, again after 10s, then every minute. A till that loses its host at 8pm on a
# Friday should not wait for someone to notice and log in.
& sc.exe failure $ServiceName reset= 86400 actions= restart/5000/restart/10000/restart/60000 | Out-Null
Ok "Auto-restart on failure configured"

Info "Opening port $Port for terminals on this network"
$ruleName = "Cashly API ($Port)"
if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
        -LocalPort $Port -Action Allow -Profile Private | Out-Null
    Ok "Firewall rule added (Private networks)"
} else {
    Ok "Firewall rule already present"
}

Info "Starting the service"
Start-Service $ServiceName

# Give the host a moment: it applies schema changes and seeds reference data on first boot.
$up = $false
foreach ($i in 1..20) {
    Start-Sleep -Seconds 3
    try {
        $r = Invoke-WebRequest -Uri "http://localhost:$Port/api/host/identity" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) { $up = $true; break }
    } catch { }
}

$lan = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1).IPAddress

Write-Host ""
if ($up) {
    Write-Host "  Cashly is running and will start automatically from now on." -ForegroundColor Green
    Write-Host ""
    Write-Host "    This PC     http://localhost:$Port"
    Write-Host "    Terminals   http://${lan}:$Port"
    Write-Host ""
    Write-Host "    Status      Get-Service $ServiceName"
    Write-Host "    Restart     Restart-Service $ServiceName"
    Write-Host "    Logs        Get-EventLog -LogName Application -Source $ServiceName -Newest 20"
} else {
    Write-Host "  The service was registered but is not answering yet." -ForegroundColor Yellow
    Write-Host "  Check it with:"
    Write-Host "    Get-Service $ServiceName"
    Write-Host "    Get-EventLog -LogName Application -Newest 20 | Format-List"
    Write-Host "  The usual cause is PostgreSQL not being reachable with the configured password."
}
Write-Host ""
