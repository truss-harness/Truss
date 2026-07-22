[CmdletBinding()]
param(
  [string]$OutputRoot,
  [string]$WinSWPath,
  [string]$WinSWVersion = "2.12.0",
  [switch]$SkipWinSWDownload,
  [switch]$BuildInstaller,
  [string]$InnoSetupCompiler = "iscc.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..\..")).Path

if (-not $OutputRoot) {
  $OutputRoot = Join-Path $repoRoot "dist\windows"
}

$packageJson = Get-Content -LiteralPath (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json
$version = [string]$packageJson.version
$stageRoot = Join-Path $OutputRoot "Truss"
$zipPath = Join-Path $OutputRoot "truss-windows-x64-$version.zip"

function Assert-ChildPath {
  param(
    [string]$Child,
    [string]$Parent
  )

  $resolvedChild = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Child)
  $resolvedParent = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Parent)

  if (-not $resolvedChild.StartsWith($resolvedParent, [StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to modify $resolvedChild because it is outside $resolvedParent."
  }
}

function Invoke-NativeCommand {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  & $FilePath @Arguments

  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
  }
}

function Convert-ToInstallerBitmap {
  param(
    [string]$SourceImage,
    [string]$DestinationBmp,
    [int]$TargetWidth,
    [int]$TargetHeight,
    [ValidateSet("Contain", "Cover")]
    [string]$Fit = "Contain"
  )

  Add-Type -AssemblyName PresentationCore
  Add-Type -AssemblyName WindowsBase

  $sourceStream = $null
  $destinationStream = $null

  try {
    $sourceStream = [System.IO.File]::OpenRead($SourceImage)
    $decoder = [System.Windows.Media.Imaging.BitmapDecoder]::Create(
      $sourceStream,
      [System.Windows.Media.Imaging.BitmapCreateOptions]::PreservePixelFormat,
      [System.Windows.Media.Imaging.BitmapCacheOption]::Default
    )
    $sourceFrame = $decoder.Frames[0]

    $scaleX = $TargetWidth / $sourceFrame.PixelWidth
    $scaleY = $TargetHeight / $sourceFrame.PixelHeight
    $scale = if ($Fit -eq "Contain") { [Math]::Min($scaleX, $scaleY) } else { [Math]::Max($scaleX, $scaleY) }

    $scaledWidth = $sourceFrame.PixelWidth * $scale
    $scaledHeight = $sourceFrame.PixelHeight * $scale
    $offsetX = ($TargetWidth - $scaledWidth) / 2
    $offsetY = ($TargetHeight - $scaledHeight) / 2

    $visual = [System.Windows.Media.DrawingVisual]::new()
    $context = $visual.RenderOpen()

    try {
      $background = [System.Windows.Media.SolidColorBrush]::new([System.Windows.Media.Colors]::White)
      $context.DrawRectangle($background, $null, [System.Windows.Rect]::new(0, 0, $TargetWidth, $TargetHeight))
      $context.DrawImage($sourceFrame, [System.Windows.Rect]::new($offsetX, $offsetY, $scaledWidth, $scaledHeight))
    } finally {
      $context.Close()
    }

    $renderBitmap = [System.Windows.Media.Imaging.RenderTargetBitmap]::new(
      $TargetWidth,
      $TargetHeight,
      96,
      96,
      [System.Windows.Media.PixelFormats]::Pbgra32
    )
    $renderBitmap.Render($visual)

    $encoder = [System.Windows.Media.Imaging.BmpBitmapEncoder]::new()
    $encoder.Frames.Add([System.Windows.Media.Imaging.BitmapFrame]::Create($renderBitmap))

    $destinationStream = [System.IO.File]::OpenWrite($DestinationBmp)
    $encoder.Save($destinationStream)
  } finally {
    if ($destinationStream) {
      $destinationStream.Dispose()
    }

    if ($sourceStream) {
      $sourceStream.Dispose()
    }
  }
}

function New-IcoFileFromPng {
  param(
    [string]$SourcePng,
    [string]$DestinationIco
  )

  Add-Type -AssemblyName System.Drawing

  $sourceImage = $null
  $iconImages = @()

  try {
    $sourceImage = [System.Drawing.Image]::FromFile($SourcePng)

    foreach ($size in @(16, 32, 48, 256)) {
      $bitmap = [System.Drawing.Bitmap]::new($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
      $graphics = [System.Drawing.Graphics]::FromImage($bitmap)
      $pngStream = [System.IO.MemoryStream]::new()

      try {
        $graphics.Clear([System.Drawing.Color]::Transparent)
        $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $graphics.DrawImage($sourceImage, 0, 0, $size, $size)
        $bitmap.Save($pngStream, [System.Drawing.Imaging.ImageFormat]::Png)

        $iconImages += [pscustomobject]@{
          Size = $size
          Bytes = $pngStream.ToArray()
        }
      } finally {
        $pngStream.Dispose()
        $graphics.Dispose()
        $bitmap.Dispose()
      }
    }
  } finally {
    if ($sourceImage) {
      $sourceImage.Dispose()
    }
  }

  $iconStream = [System.IO.File]::Open($DestinationIco, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
  $writer = [System.IO.BinaryWriter]::new($iconStream)

  try {
    $writer.Write([UInt16]0)
    $writer.Write([UInt16]1)
    $writer.Write([UInt16]$iconImages.Count)

    $imageOffset = 6 + (16 * $iconImages.Count)

    foreach ($iconImage in $iconImages) {
      $dimension = if ($iconImage.Size -ge 256) { [byte]0 } else { [byte]$iconImage.Size }

      $writer.Write($dimension)
      $writer.Write($dimension)
      $writer.Write([byte]0)
      $writer.Write([byte]0)
      $writer.Write([UInt16]1)
      $writer.Write([UInt16]32)
      $writer.Write([UInt32]$iconImage.Bytes.Length)
      $writer.Write([UInt32]$imageOffset)

      $imageOffset += $iconImage.Bytes.Length
    }

    foreach ($iconImage in $iconImages) {
      $writer.Write([byte[]]$iconImage.Bytes)
    }
  } finally {
    $writer.Dispose()
  }
}

function Resolve-InnoSetupCompiler {
  param(
    [string]$Compiler
  )

  if (Test-Path -LiteralPath $Compiler -PathType Leaf) {
    return (Resolve-Path -LiteralPath $Compiler).Path
  }

  $command = Get-Command -Name $Compiler -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($command) {
    return $command.Source
  }

  $candidateRoots = @(
    ${env:ProgramFiles(x86)},
    $env:ProgramFiles
  ) | Where-Object { $_ }

  foreach ($root in $candidateRoots) {
    foreach ($version in @("6", "5")) {
      $candidate = Join-Path $root "Inno Setup $version\ISCC.exe"
      if (Test-Path -LiteralPath $candidate -PathType Leaf) {
        return $candidate
      }
    }
  }

  throw @"
Inno Setup compiler was not found.

Install Inno Setup 6 from https://jrsoftware.org/isinfo.php, add ISCC.exe to PATH, or pass an explicit compiler path:
powershell -NoProfile -ExecutionPolicy Bypass -File packaging\windows\build-package.ps1 -BuildInstaller -InnoSetupCompiler "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
"@
}

Push-Location $repoRoot

try {
  Invoke-NativeCommand -FilePath "bun" -Arguments @("run", "compile:windows")

  New-Item -ItemType Directory -Path $OutputRoot -Force | Out-Null
  Assert-ChildPath -Child $stageRoot -Parent $OutputRoot

  if (Test-Path -LiteralPath $stageRoot) {
    Remove-Item -LiteralPath $stageRoot -Recurse -Force
  }

  New-Item -ItemType Directory -Path $stageRoot -Force | Out-Null

  Copy-Item -LiteralPath (Join-Path $repoRoot "dist\truss.exe") -Destination $stageRoot -Force
  Copy-Item -LiteralPath (Join-Path $repoRoot "public") -Destination $stageRoot -Recurse -Force
  Copy-Item -LiteralPath (Join-Path $repoRoot "icon.png") -Destination $stageRoot -Force
  New-IcoFileFromPng -SourcePng (Join-Path $repoRoot "icon.png") -DestinationIco (Join-Path $stageRoot "truss.ico")

  try {
    Convert-ToInstallerBitmap `
      -SourceImage (Join-Path $repoRoot "logo.webp") `
      -DestinationBmp (Join-Path $stageRoot "truss-wizard.bmp") `
      -TargetWidth 164 `
      -TargetHeight 314 `
      -Fit Contain

    Convert-ToInstallerBitmap `
      -SourceImage (Join-Path $repoRoot "icon.png") `
      -DestinationBmp (Join-Path $stageRoot "truss-wizard-small.bmp") `
      -TargetWidth 55 `
      -TargetHeight 55 `
      -Fit Cover
  } catch {
    Write-Warning "Could not generate installer wizard images: $_"
  }

  Copy-Item -LiteralPath (Join-Path $repoRoot "README.md") -Destination $stageRoot -Force
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot "README.md") -Destination (Join-Path $stageRoot "WINDOWS-INSTALL.md") -Force

  $camoufoxDir = Join-Path $stageRoot "camoufox"
  Write-Host "Downloading bundled Camoufox browser to $camoufoxDir..."
  Invoke-NativeCommand -FilePath "bun" -Arguments @("run", "src\server\cli\download-camoufox.ts", $camoufoxDir)

  Write-Host "Bundling Camoufox launcher bridge to $stageRoot..."
  Invoke-NativeCommand -FilePath "bun" -Arguments @("run", "src\server\cli\bundle-launcher.ts", $stageRoot)

  @(
    "install-truss.ps1",
    "uninstall-truss.ps1",
    "open-truss.ps1",
    "spawn-truss.ps1",
    "truss-tray.vbs",
    "truss-tray.ps1",
    "truss-service.xml"
  ) | ForEach-Object {
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot $_) -Destination $stageRoot -Force
  }

  $serviceWrapper = Join-Path $stageRoot "truss-service.exe"

  if ($WinSWPath) {
    Copy-Item -LiteralPath $WinSWPath -Destination $serviceWrapper -Force
  } elseif (-not $SkipWinSWDownload) {
    $winSwUrl = "https://github.com/winsw/winsw/releases/download/v$WinSWVersion/WinSW-x64.exe"
    Invoke-WebRequest -Uri $winSwUrl -OutFile $serviceWrapper
  } else {
    Write-Warning "Skipping WinSW download. Copy WinSW-x64.exe to truss-service.exe before installing the service."
  }

  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }

  Compress-Archive -Path (Join-Path $stageRoot "*") -DestinationPath $zipPath -Force

  if ($BuildInstaller) {
    $resolvedInnoSetupCompiler = Resolve-InnoSetupCompiler -Compiler $InnoSetupCompiler
    Invoke-NativeCommand `
      -FilePath $resolvedInnoSetupCompiler `
      -Arguments @(
        "/DSourceDir=$stageRoot",
        "/DAppVersion=$version",
        (Join-Path $PSScriptRoot "truss.iss")
      )
  }

  Write-Host "Windows package staged at $stageRoot."
  Write-Host "Windows zip written to $zipPath."
} finally {
  Pop-Location
}
