[CmdletBinding()]
param(
  [string]$InstallDir = "",
  [string]$ServiceName = "Truss",
  [switch]$KeepFiles,
  [switch]$RemoveFiles
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)

  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-DefaultInstallDir {
  if ($env:ProgramFiles) {
    return (Join-Path $env:ProgramFiles "Truss")
  }

  return "C:\Program Files\Truss"
}

function Remove-UserPathEntry {
  param([string]$Entry)

  $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")

  if (-not $currentPath) {
    return
  }

  $nextEntries = $currentPath -split ";" |
    Where-Object { $_.Trim().Length -gt 0 -and $_.TrimEnd("\") -ine $Entry.TrimEnd("\") }

  [Environment]::SetEnvironmentVariable("Path", ($nextEntries -join ";"), "User")
}

function Get-TrussServiceInfo {
  $escapedServiceName = $ServiceName.Replace("'", "''")
  return Get-CimInstance Win32_Service -Filter "Name='$escapedServiceName'" -ErrorAction SilentlyContinue
}

function Resolve-ServiceExecutablePath {
  param([string]$PathName)

  if (-not $PathName) {
    return $null
  }

  if ($PathName -match '^"([^"]+)"') {
    return $Matches[1]
  }

  return ($PathName -split "\s+", 2)[0]
}

function Remove-TrussService {
  $serviceInfo = Get-TrussServiceInfo
  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

  if (-not $service) {
    return
  }

  if (-not (Test-IsAdministrator)) {
    throw "Run this uninstaller from an elevated PowerShell session to remove the existing Truss Windows service."
  }

  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
  }

  $serviceExe = if ($serviceInfo) {
    Resolve-ServiceExecutablePath -PathName ([string]$serviceInfo.PathName)
  } else {
    Join-Path $InstallDir "truss-service.exe"
  }

  if ($serviceExe -and (Test-Path -LiteralPath $serviceExe)) {
    & $serviceExe uninstall | Out-Null
  } else {
    sc.exe delete $ServiceName | Out-Null
  }
}

function Remove-TrayAutostart {
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

  if (Test-Path -Path $runKey) {
    Remove-ItemProperty -Path $runKey -Name "TrussTray" -ErrorAction SilentlyContinue
  }
}

function Stop-TrayProcess {
  Get-CimInstance Win32_Process |
    Where-Object { $_.CommandLine -like "*truss-tray.ps1*" -or $_.CommandLine -like "*truss-tray.vbs*" } |
    ForEach-Object {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
    }
}

function Remove-TrussShortcuts {
  $programsDir = [Environment]::GetFolderPath("Programs")

  if (-not $programsDir) {
    $programsDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
  }

  $trussMenu = Join-Path $programsDir "Truss"

  if (Test-Path -LiteralPath $trussMenu) {
    Remove-Item -LiteralPath $trussMenu -Recurse -Force
  }
}

function Remove-TrussContextMenu {
  $locations = @(
    "HKCU:\Software\Classes\Directory\shell\TrussSpawn",
    "HKCU:\Software\Classes\Directory\Background\shell\TrussSpawn"
  )

  foreach ($location in $locations) {
    if (Test-Path -Path $location) {
      Remove-Item -Path $location -Recurse -Force
    }
  }
}

function Remove-InstallDirectoryLater {
  param([string]$TargetDir)

  $cleanupScript = Join-Path $env:TEMP ("truss-remove-" + [Guid]::NewGuid().ToString("N") + ".ps1")
  $escapedTarget = $TargetDir.Replace("'", "''")

  Set-Content -LiteralPath $cleanupScript -Encoding UTF8 -Value @"
Start-Sleep -Seconds 2
Remove-Item -LiteralPath '$escapedTarget' -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath '$cleanupScript' -Force -ErrorAction SilentlyContinue
"@

  Start-Process `
    -FilePath (Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe") `
    -ArgumentList "-NoProfile -ExecutionPolicy Bypass -File `"$cleanupScript`"" `
    -WindowStyle Hidden
}

if ($env:OS -ne "Windows_NT") {
  throw "The Windows package uninstaller only runs on Windows."
}

if (-not $InstallDir) {
  $InstallDir = Resolve-DefaultInstallDir
}

Stop-TrayProcess
Remove-TrayAutostart
Remove-TrussService
Remove-UserPathEntry -Entry $InstallDir
Remove-TrussShortcuts
Remove-TrussContextMenu

if ($RemoveFiles -and -not $KeepFiles -and (Test-Path -LiteralPath $InstallDir)) {
  Remove-InstallDirectoryLater -TargetDir $InstallDir
}

Write-Host "Truss PATH entry, Start Menu shortcuts, tray autostart, and Windows service were removed."
