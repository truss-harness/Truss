[CmdletBinding()]
param(
  [string]$ServiceName = "Truss",
  [int]$Port = 7805
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($env:OS -ne "Windows_NT") {
  throw "The Truss tray helper only runs on Windows."
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class TrussTrayNativeMethods
{
    [DllImport("user32.dll", SetLastError = true)]
    public static extern bool DestroyIcon(IntPtr handle);
}
"@

$mutexCreated = $false
$mutex = [System.Threading.Mutex]::new($true, "TrussTray", [ref]$mutexCreated)

if (-not $mutexCreated) {
  return
}

$notifyIcon = $null
$icon = $null
$bitmap = $null
$iconHandle = [IntPtr]::Zero

function Show-TrayMessage {
  param(
    [string]$Title,
    [string]$Message,
    [System.Windows.Forms.ToolTipIcon]$IconKind = [System.Windows.Forms.ToolTipIcon]::Info
  )

  if ($script:notifyIcon) {
    $script:notifyIcon.ShowBalloonTip(3000, $Title, $Message, $IconKind)
  }
}

function Invoke-TrussOpen {
  try {
    & (Join-Path $PSScriptRoot "open-truss.ps1") -ServiceName $ServiceName -Port $Port
  } catch {
    Show-TrayMessage `
      -Title "Truss" `
      -Message $_.Exception.Message `
      -IconKind ([System.Windows.Forms.ToolTipIcon]::Error)
  }
}

function Test-TrussHealth {
  try {
    $response = Invoke-WebRequest `
      -UseBasicParsing `
      -Uri "http://127.0.0.1:$Port/api/health" `
      -TimeoutSec 1

    if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
      Assert-TrussHealthUsesServiceHome -Content $response.Content
      return $true
    }

    return $false
  } catch {
    if ($_.Exception.Message -like "Truss on port *") {
      throw
    }

    return $false
  }
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

function Start-TrussBackend {
  param([switch]$Silent)

  try {
    if (Test-TrussHealth) {
      if (-not $Silent) {
        Show-TrayMessage -Title "Truss" -Message "Truss is already running."
      }

      return
    }

    $service = Get-TrussServiceForCurrentInstall

    if (-not $service) {
      throw "The required Truss Windows service is not installed. Reinstall Truss from an elevated shell."
    }
    if ($service.Status -ne "Running") {
      Start-Service -Name $ServiceName
    } else {
      throw "The Truss Windows service is running but is not responding on port $Port."
    }

    if (-not $Silent) {
      Show-TrayMessage -Title "Truss" -Message "Truss is running."
    }
  } catch {
    Show-TrayMessage `
      -Title "Truss" `
      -Message $_.Exception.Message `
      -IconKind ([System.Windows.Forms.ToolTipIcon]::Error)
  }
}

function Stop-TrussBackend {
  try {
    $service = Get-TrussServiceForCurrentInstall

    if (-not $service) {
      throw "The required Truss Windows service is not installed."
    }
    Stop-Service -Name $ServiceName -ErrorAction Stop

    Show-TrayMessage -Title "Truss" -Message "Truss stopped."
  } catch {
    Show-TrayMessage `
      -Title "Truss" `
      -Message $_.Exception.Message `
      -IconKind ([System.Windows.Forms.ToolTipIcon]::Error)
  }
}

function Restart-TrussBackend {
  try {
    $service = Get-TrussServiceForCurrentInstall

    if (-not $service) {
      throw "The required Truss Windows service is not installed."
    }
    Restart-Service -Name $ServiceName -ErrorAction Stop

    Show-TrayMessage -Title "Truss" -Message "Truss restarted."
  } catch {
    Show-TrayMessage `
      -Title "Truss" `
      -Message $_.Exception.Message `
      -IconKind ([System.Windows.Forms.ToolTipIcon]::Error)
  }
}

function Open-TrussFolder {
  $dialog = [System.Windows.Forms.FolderBrowserDialog]::new()
  $dialog.Description = "Choose a folder to open with Truss."
  $dialog.ShowNewFolderButton = $true

  try {
    if ($dialog.ShowDialog() -ne [System.Windows.Forms.DialogResult]::OK) {
      return
    }

    & (Join-Path $PSScriptRoot "spawn-truss.ps1") -Folder $dialog.SelectedPath
  } catch {
    Show-TrayMessage `
      -Title "Open folder in Truss" `
      -Message $_.Exception.Message `
      -IconKind ([System.Windows.Forms.ToolTipIcon]::Error)
  } finally {
    $dialog.Dispose()
  }
}

try {
  [System.Windows.Forms.Application]::EnableVisualStyles()

  $iconPath = Join-Path $PSScriptRoot "icon.png"

  if (Test-Path -LiteralPath $iconPath) {
    $bitmap = [System.Drawing.Bitmap]::FromFile($iconPath)
    $iconHandle = $bitmap.GetHicon()
    $icon = [System.Drawing.Icon]::FromHandle($iconHandle)
  } else {
    $icon = [System.Drawing.SystemIcons]::Application
  }

  $script:notifyIcon = [System.Windows.Forms.NotifyIcon]::new()
  $notifyIcon = $script:notifyIcon
  $notifyIcon.Icon = $icon
  $notifyIcon.Text = "Truss"
  $notifyIcon.Visible = $true

  $menu = [System.Windows.Forms.ContextMenuStrip]::new()

  $openItem = $menu.Items.Add("Open Truss")
  $openItem.add_Click({ Invoke-TrussOpen })

  $openFolderItem = $menu.Items.Add("Browse Folder and Open in Truss...")
  $openFolderItem.add_Click({ Open-TrussFolder })

  [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())

  $startItem = $menu.Items.Add("Start Truss")
  $startItem.add_Click({ Start-TrussBackend })

  $restartItem = $menu.Items.Add("Restart Truss")
  $restartItem.add_Click({ Restart-TrussBackend })

  $stopItem = $menu.Items.Add("Stop Truss")
  $stopItem.add_Click({ Stop-TrussBackend })

  [void]$menu.Items.Add([System.Windows.Forms.ToolStripSeparator]::new())

  $exitItem = $menu.Items.Add("Exit Tray")
  $exitItem.add_Click({ [System.Windows.Forms.Application]::Exit() })

  $notifyIcon.ContextMenuStrip = $menu
  $notifyIcon.add_DoubleClick({ Invoke-TrussOpen })

  Start-TrussBackend -Silent

  [System.Windows.Forms.Application]::Run()
} finally {
  if ($notifyIcon) {
    $notifyIcon.Visible = $false
    $notifyIcon.Dispose()
  }

  if ($icon -and $icon -ne [System.Drawing.SystemIcons]::Application) {
    $icon.Dispose()
  }

  if ($bitmap) {
    $bitmap.Dispose()
  }

  if ($iconHandle -ne [IntPtr]::Zero) {
    [void][TrussTrayNativeMethods]::DestroyIcon($iconHandle)
  }

  $mutex.ReleaseMutex()
  $mutex.Dispose()
}
