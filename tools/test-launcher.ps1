$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..\..')).Path
$linkPath = Join-Path $root '打开营销工作台.lnk'
$targetPath = Join-Path $root '启动营销工作台.cmd'

if (-not (Test-Path -LiteralPath $linkPath)) {
  throw '缺少真正的一键启动快捷方式：打开营销工作台.lnk'
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($linkPath)
$actual = [System.IO.Path]::GetFullPath($shortcut.TargetPath)
$expected = [System.IO.Path]::GetFullPath($targetPath)

if ($actual -ne $expected) {
  throw "快捷方式目标不正确。实际：$actual；预期：$expected"
}

if (-not (Test-Path -LiteralPath $shortcut.TargetPath)) {
  throw '快捷方式指向的启动脚本不存在'
}

Write-Host 'launcher contract passed'
