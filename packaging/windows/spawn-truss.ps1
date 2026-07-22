[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Folder = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$trussExe = Join-Path $PSScriptRoot "truss.exe"

if (-not (Test-Path -LiteralPath $trussExe)) {
  throw "Could not find $trussExe."
}

Start-Process `
  -FilePath $trussExe `
  -ArgumentList "spawn `"$Folder`"" `
  -WorkingDirectory $Folder `
  -WindowStyle Hidden
