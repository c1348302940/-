#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'
$ruleName = 'Tianyu Marketing Workbench LAN 8787'

Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue |
  Remove-NetFirewallRule -ErrorAction SilentlyContinue

New-NetFirewallRule `
  -DisplayName $ruleName `
  -Direction Inbound `
  -Action Allow `
  -Protocol TCP `
  -LocalPort 8787 `
  -Profile Domain,Private `
  -RemoteAddress LocalSubnet `
  -EdgeTraversalPolicy Block | Out-Null

Write-Host 'Local subnet access to TCP 8787 is enabled.'
