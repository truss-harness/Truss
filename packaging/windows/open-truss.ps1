[CmdletBinding()]
param(
  [string]$ServiceName = "Truss",
  [int]$Port = 7805,
  [switch]$NoWait
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
      Assert-TrussHealthUsesCurrentUserHome -Content $response.Content
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
  $userProfile = [Environment]::GetFolderPath("UserProfile")

  if (-not $userProfile) {
    $userProfile = $HOME
  }

  return (Join-Path (Join-Path $userProfile ".truss") "truss.db")
}

function Assert-TrussHealthUsesCurrentUserHome {
  param([string]$Content)

  try {
    $payload = $Content | ConvertFrom-Json
    $databasePath = [string]$payload.session.conversationScope.databasePath
  } catch {
    return
  }

  if (-not $databasePath) {
    return
  }

  $expectedDatabasePath = Resolve-ExpectedTrussDatabasePath

  if ($databasePath.TrimEnd("\") -ine $expectedDatabasePath.TrimEnd("\")) {
    throw "Truss on port $Port is using $databasePath instead of $expectedDatabasePath. Stop the old machine-wide Truss service, then start Truss again."
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

function Start-TrussProcessFallback {
  param([int]$FallbackPort)

  $trussExe = Join-Path $PSScriptRoot "truss.exe"

  if (-not (Test-Path -LiteralPath $trussExe)) {
    throw "Could not find $trussExe."
  }

  Start-Process `
    -FilePath $trussExe `
    -ArgumentList "spawn --no-autolaunch --port $FallbackPort" `
    -WorkingDirectory $PSScriptRoot `
    -WindowStyle Hidden
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
        if (-not (Test-TrussHealth -HealthPort $Port)) {
          Start-TrussProcessFallback -FallbackPort $Port
        }
      }
    }
  } else {
    Start-TrussProcessFallback -FallbackPort $Port
  }

  if (-not $NoWait) {
    [void](Wait-ForTruss -HealthPort $Port)
  }
}

Start-Process "http://127.0.0.1:$Port/"
