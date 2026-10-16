param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$appDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$port = 8787
$localUrl = "http://127.0.0.1:$port/"

function Test-Workbench {
  try {
    $response = Invoke-RestMethod -Uri ($localUrl + 'api/health') -TimeoutSec 2
    return $response.ok -eq $true
  } catch {
    return $false
  }
}

function Get-PortListener {
  foreach ($line in (& netstat.exe -ano -p tcp)) {
    if ($line -match '^\s*TCP\s+(\S+):8787\s+\S+\s+LISTENING\s+(\d+)\s*$') {
      return [pscustomobject]@{ Address = $Matches[1]; Pid = [int]$Matches[2] }
    }
  }
  return $null
}

function Get-LanAddress {
  $addresses = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
    Where-Object {
      $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
      -not [System.Net.IPAddress]::IsLoopback($_) -and
      -not $_.ToString().StartsWith('169.254.')
    }
  $preferred = $addresses | Where-Object {
    $value = $_.ToString()
    $value.StartsWith('10.') -or $value.StartsWith('192.168.') -or $value -match '^172\.(1[6-9]|2\d|3[01])\.'
  } | Select-Object -First 1
  if ($preferred) { return $preferred.ToString() }
  if ($addresses) { return $addresses[0].ToString() }
  throw 'No LAN IPv4 address was found.'
}

try {
  $listener = Get-PortListener
  if ($listener -and $listener.Address -notin @('0.0.0.0', '[::]', '::')) {
    $process = Get-Process -Id $listener.Pid -ErrorAction Stop
    if ($process.ProcessName -ne 'node') {
      throw "Port $port is used by another process (PID $($listener.Pid))."
    }
    Stop-Process -Id $listener.Pid
    for ($attempt = 0; $attempt -lt 20 -and (Get-PortListener); $attempt++) {
      Start-Sleep -Milliseconds 250
    }
    if (Get-PortListener) { throw "The previous service did not release port $port." }
    $listener = $null
  }

  if (-not $listener) {
    $node = Get-Command node.exe -ErrorAction Stop
    $env:HOST = '0.0.0.0'
    $env:PORT = [string]$port
    Start-Process -FilePath $node.Source -ArgumentList 'server.js' -WorkingDirectory $appDir -WindowStyle Hidden | Out-Null

    $ready = $false
    for ($attempt = 0; $attempt -lt 30; $attempt++) {
      Start-Sleep -Milliseconds 500
      if (Test-Workbench) { $ready = $true; break }
    }
    if (-not $ready) { throw "The team service did not start on port $port." }
  }

  $listener = Get-PortListener
  if (-not $listener -or $listener.Address -notin @('0.0.0.0', '[::]', '::')) {
    throw 'The service is not listening in LAN mode.'
  }

  $lanUrl = "http://$(Get-LanAddress):$port/"
  if (-not $NoBrowser) { Start-Process -FilePath $localUrl | Out-Null }
  Write-Host "Team workbench ready: $lanUrl"
  Write-Host 'Keep this computer powered on, connected, and awake.'
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
