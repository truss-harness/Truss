[CmdletBinding()]
param(
  [string]$InstallDir = "",
  [string]$PackageRoot = $PSScriptRoot,
  [string]$ServiceName = "Truss",
  [switch]$InstallService,
  [switch]$SkipFileCopy,
  [switch]$NoService,
  [switch]$NoTrayAutostart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = [Security.Principal.WindowsPrincipal]::new($identity)

  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Resolve-DefaultInstallDir {
  if ($env:LOCALAPPDATA) {
    return (Join-Path $env:LOCALAPPDATA "Programs\Truss")
  }

  return (Join-Path $HOME "AppData\Local\Programs\Truss")
}

function Copy-TrussPackage {
  param(
    [string]$Source,
    [string]$Destination
  )

  $resolvedSource = (Resolve-Path -LiteralPath $Source).Path
  $resolvedDestination = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Destination)

  if ($resolvedSource -ieq $resolvedDestination) {
    return
  }

  New-Item -ItemType Directory -Path $resolvedDestination -Force | Out-Null

  Get-ChildItem -LiteralPath $resolvedSource -Force |
    Where-Object { $_.Name -ne "logs" } |
    ForEach-Object {
      Copy-Item -LiteralPath $_.FullName -Destination $resolvedDestination -Recurse -Force
    }
}

function Add-UserPathEntry {
  param([string]$Entry)

  $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $pathEntries = @($currentPath -split ";" | Where-Object { $_.Trim().Length -gt 0 })
  $alreadyPresent = $pathEntries | Where-Object { $_.TrimEnd("\") -ieq $Entry.TrimEnd("\") }

  if (-not $alreadyPresent) {
    $nextPath = (@($pathEntries) + $Entry) -join ";"
    [Environment]::SetEnvironmentVariable("Path", $nextPath, "User")
  }

  if (($env:Path -split ";") -notcontains $Entry) {
    $env:Path = "$Entry;$env:Path"
  }
}

function New-TrussShortcut {
  param(
    [string]$Path,
    [string]$TargetPath,
    [string]$Arguments,
    [string]$WorkingDirectory,
    [string]$Description,
    [string]$IconLocation
  )

  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($Path)
  $shortcut.TargetPath = $TargetPath
  $shortcut.Arguments = $Arguments
  $shortcut.WorkingDirectory = $WorkingDirectory
  $shortcut.Description = $Description
  $shortcut.IconLocation = $IconLocation
  $shortcut.Save()
}

function Resolve-TrussShortcutIcon {
  param([string]$TargetDir)

  $iconPath = Join-Path $TargetDir "truss.ico"

  if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
    return "$iconPath,0"
  }

  $trussExe = Join-Path $TargetDir "truss.exe"
  return "$trussExe,0"
}

function Resolve-TrayLauncher {
  param([string]$TargetDir)

  $trayLauncher = Join-Path $TargetDir "truss-tray.vbs"

  if (-not (Test-Path -LiteralPath $trayLauncher -PathType Leaf)) {
    throw "Missing tray launcher: $trayLauncher."
  }

  return $trayLauncher
}

function Resolve-WScript {
  $wscript = Join-Path $env:SystemRoot "System32\wscript.exe"

  if (-not (Test-Path -LiteralPath $wscript -PathType Leaf)) {
    throw "Missing Windows Script Host executable: $wscript."
  }

  return $wscript
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
  param([object]$ServiceInfo)

  $service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

  if (-not $service) {
    return
  }

  if ($service.Status -ne "Stopped") {
    Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
    $service.WaitForStatus("Stopped", [TimeSpan]::FromSeconds(30))
  }

  $serviceExe = Resolve-ServiceExecutablePath -PathName ([string]$ServiceInfo.PathName)

  if ($serviceExe -and (Test-Path -LiteralPath $serviceExe -PathType Leaf)) {
    & $serviceExe uninstall | Out-Null
  } else {
    sc.exe delete $ServiceName | Out-Null
  }
}

function Remove-ConflictingMachineService {
  $serviceInfo = Get-TrussServiceInfo

  if (-not $serviceInfo) {
    return
  }

  if (-not (Test-IsAdministrator)) {
    throw "A machine-wide Truss service is already installed as $($serviceInfo.StartName). Uninstall it from an elevated PowerShell session before installing Truss for the current user."
  }

  Write-Warning "Removing existing machine-wide Truss service before installing the per-user package."
  Remove-TrussService -ServiceInfo $serviceInfo
}

function Install-TrussService {
  param([string]$TargetDir)

  $serviceExe = Join-Path $TargetDir "truss-service.exe"
  $serviceConfig = Join-Path $TargetDir "truss-service.xml"

  if (-not (Test-Path -LiteralPath $serviceExe)) {
    throw "Missing WinSW service wrapper: $serviceExe. Rebuild with bun run package:windows or copy WinSW-x64.exe to truss-service.exe."
  }

  if (-not (Test-Path -LiteralPath $serviceConfig)) {
    throw "Missing service config: $serviceConfig."
  }

  $existingService = Get-TrussServiceInfo

  if ($existingService) {
    Remove-TrussService -ServiceInfo $existingService
  }

  & $serviceExe install | Out-Null

  if ($LASTEXITCODE -ne 0) {
    throw "WinSW failed to install the $ServiceName service."
  }

  Set-Service -Name $ServiceName -StartupType Automatic
  Start-Service -Name $ServiceName
}

function Install-TrussShortcuts {
  param([string]$TargetDir)

  $programsDir = [Environment]::GetFolderPath("Programs")

  if (-not $programsDir) {
    $programsDir = Join-Path $env:APPDATA "Microsoft\Windows\Start Menu\Programs"
  }

  $trussMenu = Join-Path $programsDir "Truss"
  New-Item -ItemType Directory -Path $trussMenu -Force | Out-Null

  $powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $wscript = Resolve-WScript
  $trayLauncher = Resolve-TrayLauncher -TargetDir $TargetDir
  $shortcutIcon = Resolve-TrussShortcutIcon -TargetDir $TargetDir

  New-TrussShortcut `
    -Path (Join-Path $trussMenu "Truss.lnk") `
    -TargetPath $powershell `
    -Arguments "-NoProfile -ExecutionPolicy Bypass -File `"$TargetDir\open-truss.ps1`"" `
    -WorkingDirectory $TargetDir `
    -Description "Open the Truss main view" `
    -IconLocation $shortcutIcon

  New-TrussShortcut `
    -Path (Join-Path $trussMenu "Truss Tray.lnk") `
    -TargetPath $wscript `
    -Arguments "`"$trayLauncher`"" `
    -WorkingDirectory $TargetDir `
    -Description "Start the Truss tray helper" `
    -IconLocation $shortcutIcon
}

function Install-TrayAutostart {
  param([string]$TargetDir)

  $wscript = Resolve-WScript
  $trayLauncher = Resolve-TrayLauncher -TargetDir $TargetDir
  $command = "`"$wscript`" `"$trayLauncher`""
  $runKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"

  New-Item -Path $runKey -Force | Out-Null
  New-ItemProperty -Path $runKey -Name "TrussTray" -Value $command -PropertyType String -Force | Out-Null
  Start-Process -FilePath $wscript -ArgumentList "`"$trayLauncher`"" -WorkingDirectory $TargetDir -WindowStyle Hidden
}

function Install-TrussContextMenu {
  param([string]$TargetDir)

  $spawnScript = Join-Path $TargetDir "spawn-truss.ps1"

  if (-not (Test-Path -LiteralPath $spawnScript -PathType Leaf)) {
    throw "Missing spawn helper: $spawnScript."
  }

  $powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $iconPath = Join-Path $TargetDir "truss.ico"
  $command = '"' + $powershell + '" -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $spawnScript + '" "%V"'

  $locations = @(
    "HKCU:\Software\Classes\Directory\shell\TrussSpawn",
    "HKCU:\Software\Classes\Directory\Background\shell\TrussSpawn"
  )

  foreach ($location in $locations) {
    New-Item -Path $location -Force | Out-Null
    New-ItemProperty -Path $location -Name "(Default)" -Value "Spawn Truss agent here" -PropertyType String -Force | Out-Null

    if (Test-Path -LiteralPath $iconPath -PathType Leaf) {
      New-ItemProperty -Path $location -Name "Icon" -Value $iconPath -PropertyType String -Force | Out-Null
    }

    $commandKey = Join-Path $location "command"
    New-Item -Path $commandKey -Force | Out-Null
    New-ItemProperty -Path $commandKey -Name "(Default)" -Value $command -PropertyType String -Force | Out-Null
  }
}

if ($env:OS -ne "Windows_NT") {
  throw "The Windows package installer only runs on Windows."
}

if (-not $InstallDir) {
  $InstallDir = Resolve-DefaultInstallDir
}

if ($NoService) {
  $InstallService = $false
}

if ($InstallService -and -not (Test-IsAdministrator)) {
  throw "Run this installer from an elevated PowerShell session when using -InstallService."
}

if (-not $InstallService) {
  Remove-ConflictingMachineService
}

if (-not $SkipFileCopy) {
  Copy-TrussPackage -Source $PackageRoot -Destination $InstallDir
}

New-Item -ItemType Directory -Path (Join-Path $InstallDir "logs") -Force | Out-Null

if ($InstallService) {
  Install-TrussService -TargetDir $InstallDir
}

Add-UserPathEntry -Entry $InstallDir
Install-TrussShortcuts -TargetDir $InstallDir
Install-TrussContextMenu -TargetDir $InstallDir

if (-not $NoTrayAutostart) {
  Install-TrayAutostart -TargetDir $InstallDir
}

Write-Host "Truss installed to $InstallDir."
Write-Host "The truss command is available for the current user after opening a new terminal."
Write-Host "Open the main view from Start Menu > Truss > Truss or the tray icon."
Write-Host "Right-click any folder or empty folder background to spawn a Truss agent there."
