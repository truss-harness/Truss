[CmdletBinding()]
param(
  [string]$ServiceName = "Truss",
  [int]$Port = 7805,
  [switch]$NoWait,
  [switch]$NoLaunch
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-TrussHealth {
  param([int]$HealthPort)

  try {
    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "http://127.0.0.1:$HealthPort/api/health" `
      -TimeoutSec 1

    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      Assert-TrussHealthUsesServiceHome -Content $response.Content
      return $true
    }
  } catch {
    if ($_.Exception.Message -like "Truss on port *") {
      throw
    }

    return $false
  }

  return $false
}

function Resolve-ExpectedTrussDatabasePath {
  $programData = if ($env:ProgramData) { $env:ProgramData } else { "C:\ProgramData" }
  return (Join-Path (Join-Path $programData "Truss") "truss.db")
}

function Assert-TrussHealthUsesServiceHome {
  param([string]$Content)

  try {
    $payload = $Content | ConvertFrom-Json
    $databasePath = [string]$payload.session.conversationScope.databasePath
  } catch {
    throw "Truss on port $Port is not the required global Truss Windows service. Stop the other process and start the Truss service."
  }

  if ($payload.session.appName -ne "Truss" -or $payload.session.serviceMode -ne $true -or -not $databasePath) {
    throw "Truss on port $Port is not the required global Truss Windows service. Stop the other process and start the Truss service."
  }

  $expectedDatabasePath = Resolve-ExpectedTrussDatabasePath

  if ($databasePath.TrimEnd("\") -ine $expectedDatabasePath.TrimEnd("\")) {
    throw "Truss on port $Port is not the required global Truss Windows service. Stop the other process and start the Truss service."
  }
}

function Wait-ForTruss {
  param([int]$HealthPort)

  for ($attempt = 0; $attempt -lt 40; $attempt += 1) {
    if (Test-TrussHealth -HealthPort $HealthPort) {
      return $true
    }

    Start-Sleep -Milliseconds 500
  }

  return $false
}

function Get-TrussServiceForCurrentInstall {
  $escapedServiceName = $ServiceName.Replace("'", "''")
  $serviceInfo = Get-CimInstance Win32_Service -Filter "Name='$escapedServiceName'" -ErrorAction SilentlyContinue

  if (-not $serviceInfo) {
    return $null
  }

  $serviceExe = Join-Path $PSScriptRoot "truss-service.exe"
  $escapedServiceExe = [System.Management.Automation.WildcardPattern]::Escape($serviceExe)

  if ($serviceInfo.PathName -notlike "*$escapedServiceExe*") {
    return $null
  }

  return Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
}

if (-not (Test-TrussHealth -HealthPort $Port)) {
  $service = Get-TrussServiceForCurrentInstall

  if ($service) {
    if ($service.Status -ne "Running") {
      try {
        Start-Service -Name $ServiceName
      } catch {
        throw "The required Truss Windows service could not be started. Start it from an elevated shell or reinstall Truss."
      }
    }
  } else {
    throw "The required Truss Windows service is not installed. Reinstall Truss from an elevated shell."
  }

  if (-not $NoWait) {
    if (-not (Wait-ForTruss -HealthPort $Port)) {
      throw "The required Truss Windows service did not become ready on port $Port."
    }
  }
}

if (-not $NoLaunch) {
  Start-Process "http://127.0.0.1:$Port/"
}
