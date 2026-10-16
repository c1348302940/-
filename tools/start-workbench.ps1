param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$appDir = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$url = 'http://127.0.0.1:8787/'

function Test-Workbench {
  try {
    $response = Invoke-RestMethod -Uri ($url + 'api/health') -TimeoutSec 2
    return $response.ok -eq $true
  } catch {
    return $false
  }
}

try {
  if (-not (Test-Workbench)) {
    $node = Get-Command node.exe -ErrorAction Stop
    Start-Process -FilePath $node.Source -ArgumentList 'server.js' -WorkingDirectory $appDir -WindowStyle Hidden | Out-Null

    $ready = $false
    for ($attempt = 0; $attempt -lt 20; $attempt++) {
      Start-Sleep -Milliseconds 500
      if (Test-Workbench) { $ready = $true; break }
    }
    if (-not $ready) {
      throw 'The local service did not start. Check whether port 8787 is already in use.'
    }
  }

  if (-not $NoBrowser) { Start-Process -FilePath $url | Out-Null }
  Write-Host "Workbench ready: $url"
  exit 0
} catch {
  Write-Error $_.Exception.Message
  exit 1
}
