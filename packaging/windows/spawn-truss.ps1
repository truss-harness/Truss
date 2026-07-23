[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [string]$Folder = (Get-Location).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$resolvedFolder = (Resolve-Path -LiteralPath $Folder).Path
& (Join-Path $PSScriptRoot "open-truss.ps1") -NoLaunch

$body = @{
  messageId = $null
  sessionId = $null
  workspacePath = $resolvedFolder
} | ConvertTo-Json
$response = Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:7805/api/workspaces/launch" `
  -ContentType "application/json" `
  -Body $body `
  -TimeoutSec 20

if (-not $response.url) {
  throw "The Truss service did not return a workspace URL."
}

Start-Process ([string]$response.url)
