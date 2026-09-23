<#
.SYNOPSIS
    Installs Cashly on a Windows machine as an ERP host, a POS terminal, or both.

.DESCRIPTION
    There is one application and one database schema. What this script decides is the ROLE this
    particular machine plays:

      ERP        A back-office workstation. Runs the API and PostgreSQL for the business, and
                 serves POS terminals on the LAN. No till on this machine.

      POS        A cashier terminal. Runs no database of its own — it connects to a business
                 host by Business ID and finishes setup with a pairing code.

      ERPPOS     A single computer that does both. The common case for a small restaurant:
                 one PC, one database, till at the front and accounts in the back.

    The same installer, the same binaries. The role is written to appsettings.Production.json,
    and the application reads it at startup.

.EXAMPLE
    # Small restaurant, everything on one PC
    .\install-cashly.ps1 -InstallType ERPPOS -DbPassword 'choose-a-strong-one'

.EXAMPLE
    # Office PC that will serve three tills, syncing to head office in the cloud
    .\install-cashly.ps1 -InstallType ERP -DbPassword 'x' -CloudUrl 'https://api.cashly.pk' -BusinessId 'ANXWPQ'

.EXAMPLE
    # A till connecting to the office PC above
    .\install-cashly.ps1 -InstallType POS -HostAddress '192.168.1.50'
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet('ERP', 'POS', 'ERPPOS')]
    [string]$InstallType,

    # --- Host installs (ERP / ERPPOS) ---
    [string]$DbPassword,
    [string]$DbName = 'cashly_pos_db',
    [string]$DbUser = 'postgres',
    [int]$Port = 5288,

    # --- Cloud link. Omit entirely for a shop that runs with no head office and no subscription. ---
    [string]$CloudUrl,
    [string]$BusinessId,
    [string]$SyncKey,
    [int]$SyncIntervalMinutes = 5,

    # --- POS installs ---
    [string]$HostAddress,

    [string]$InstallPath = 'C:\Program Files\Cashly',
    [switch]$SkipFirewall
)

$ErrorActionPreference = 'Stop'

function Write-Step($msg) { Write-Host "`n>> $msg" -ForegroundColor Cyan }
function Write-Ok($msg)   { Write-Host "   OK  $msg" -ForegroundColor Green }
function Write-Warn2($msg){ Write-Host "   !   $msg" -ForegroundColor Yellow }

$isHost = $InstallType -in @('ERP', 'ERPPOS')

Write-Host @"

  Cashly Installer
  ----------------
  Install type : $InstallType
  Machine      : $env:COMPUTERNAME
"@ -ForegroundColor White

# --- Validate the combination before touching the machine -------------------
# Catching a contradictory argument set now is far kinder than half-installing and failing later.
if ($isHost -and -not $DbPassword) {
    throw "-DbPassword is required for an $InstallType install (this machine runs the database)."
}
if ($InstallType -eq 'POS' -and -not $HostAddress) {
    throw "-HostAddress is required for a POS install (the address of the PC running the business host)."
}
if ($CloudUrl -and -not $BusinessId) {
    Write-Warn2 "CloudUrl given without BusinessId — sync will stay idle until a Business ID is set."
}

# --- 1. Prerequisites -------------------------------------------------------
Write-Step "Checking prerequisites"

$dotnet = Get-Command dotnet -ErrorAction SilentlyContinue
if (-not $dotnet) {
    throw "The .NET runtime was not found. Install the ASP.NET Core Runtime 10 and run this again."
}
Write-Ok ".NET runtime present"

if ($isHost) {
    $pg = Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue | Select-Object -First 1
    if (-not $pg) {
        Write-Warn2 "PostgreSQL service not found."
        Write-Warn2 "Install PostgreSQL 16, then re-run. The installer does not bundle it because a"
        Write-Warn2 "shop that already runs Postgres must not get a second copy on the same box."
        throw "PostgreSQL is required for an $InstallType install."
    }
    if ($pg.Status -ne 'Running') {
        Write-Warn2 "PostgreSQL is installed but stopped — starting it."
        Start-Service $pg.Name
    }
    Write-Ok "PostgreSQL running ($($pg.Name))"
}

# --- 2. Install files -------------------------------------------------------
Write-Step "Installing to $InstallPath"
if (-not (Test-Path $InstallPath)) { New-Item -ItemType Directory -Path $InstallPath -Force | Out-Null }
Write-Ok "Install directory ready"

# --- 3. Configuration -------------------------------------------------------
# The whole point of the installer: write the one file that tells this machine what it is.
Write-Step "Writing configuration"

$hostMode = if ($isHost) { 'BusinessHost' } else { 'Client' }

$config = [ordered]@{
    Host = [ordered]@{
        Mode = $hostMode
        # ERP  -> back office only, no till on this machine
        # POS  -> till only
        # Hybrid -> both, which is what ERPPOS means
        Surface = switch ($InstallType) { 'ERP' { 'Erp' } 'POS' { 'Pos' } 'ERPPOS' { 'Hybrid' } }
        Port = $Port
    }
}

if ($isHost) {
    $config['ConnectionStrings'] = [ordered]@{
        DefaultConnection = "Host=localhost;Port=5432;Database=$DbName;Username=$DbUser;Password=$DbPassword"
    }
    # A per-install signing key. Shipping a fixed one would mean every Cashly install in the
    # country could mint tokens for every other.
    $jwtKey = [Convert]::ToBase64String((1..48 | ForEach-Object { Get-Random -Maximum 256 }))
    $config['Jwt'] = [ordered]@{ Key = $jwtKey }
}

if ($CloudUrl) {
    $config['Host']['CloudUrl'] = $CloudUrl
    $config['Host']['SyncIntervalMinutes'] = $SyncIntervalMinutes
    if ($BusinessId) { $config['Host']['BusinessId'] = $BusinessId }
    if ($SyncKey)    { $config['Host']['SyncKey']    = $SyncKey }
}

if ($InstallType -eq 'POS') {
    # A POS holds no database and no signing key. All it needs is where to find its host; the
    # pairing code entered on first launch is what actually authorises it.
    $config['Host']['ConnectTo'] = "http://${HostAddress}:${Port}"
}

$configPath = Join-Path $InstallPath 'appsettings.Production.json'
$config | ConvertTo-Json -Depth 6 | Out-File -FilePath $configPath -Encoding utf8
Write-Ok "Wrote $configPath"

# --- 4. Firewall ------------------------------------------------------------
# Only a host needs to accept connections. A till makes outbound calls and should not be
# listening for anything.
if ($isHost -and -not $SkipFirewall) {
    Write-Step "Opening port $Port for LAN terminals"
    $ruleName = "Cashly API ($Port)"
    if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
        New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Protocol TCP `
            -LocalPort $Port -Action Allow -Profile Private | Out-Null
        Write-Ok "Firewall rule added (Private networks only)"
    } else {
        Write-Ok "Firewall rule already present"
    }
    Write-Warn2 "Scoped to Private networks on purpose. If the shop's Wi-Fi is marked Public in"
    Write-Warn2 "Windows, terminals will not reach this host until that is corrected."
}

# --- 5. Service -------------------------------------------------------------
if ($isHost) {
    Write-Step "Registering the Cashly service"
    $exe = Join-Path $InstallPath 'Pos.Api.exe'
    if (Test-Path $exe) {
        $svc = Get-Service -Name 'CashlyApi' -ErrorAction SilentlyContinue
        if ($svc) {
            Write-Ok "Service already registered — restarting"
            Restart-Service CashlyApi
        } else {
            New-Service -Name 'CashlyApi' -BinaryPathName "`"$exe`"" `
                -DisplayName 'Cashly Business Host' -StartupType Automatic `
                -Description 'Runs the Cashly API and serves POS terminals on this network.' | Out-Null
            Start-Service CashlyApi
            Write-Ok "Service registered and started"
        }
    } else {
        Write-Warn2 "Pos.Api.exe not found in $InstallPath — copy the published build there, then:"
        Write-Warn2 "  New-Service -Name CashlyApi -BinaryPathName '$exe' -StartupType Automatic"
    }
}

# --- 6. What to do next -----------------------------------------------------
$lan = (Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } |
        Select-Object -First 1).IPAddress

Write-Host "`n  Done.`n" -ForegroundColor Green

switch ($InstallType) {
    'ERPPOS' {
        Write-Host @"
  This PC now runs everything: database, back office and till.

  1. Open  http://localhost:$Port  and complete the setup wizard.
  2. To add more tills later, generate a pairing code in
     Settings -> Device Activation and enter it on the other machine.

  This machine's LAN address is $lan — that is what other terminals connect to.
"@
    }
    'ERP' {
        Write-Host @"
  This PC is the business host. It runs the back office; it has no till.

  1. Open  http://localhost:$Port  and complete the setup wizard.
  2. Register this machine: Settings -> Business Host. Note the Business ID it gives you.
  3. On each till, run:
       .\install-cashly.ps1 -InstallType POS -HostAddress $lan
     then enter the Business ID and a pairing code.

  LAN address: $lan
"@
    }
    'POS' {
        Write-Host @"
  This till is configured to reach its host at http://${HostAddress}:${Port}.

  1. Open  http://localhost:5173  (or the Cashly shortcut).
  2. Enter the Business ID from the office PC.
  3. Enter the pairing code generated in Settings -> Device Activation.

  If the till cannot find the host, check that both machines are on the same
  network and that the host's network is marked Private in Windows.
"@
    }
}
Write-Host ""
