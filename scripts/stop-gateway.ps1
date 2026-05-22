$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Port = 31888
$RunDir = Join-Path $Root "data\run"
$WatchdogPidFile = Join-Path $RunDir "gateway.watchdog.pid"
$StopFile = Join-Path $RunDir "gateway.stop"

function Stop-Watchdog {
  if (Test-Path -LiteralPath $WatchdogPidFile) {
    $WatchdogPid = [int](Get-Content -LiteralPath $WatchdogPidFile -Raw)
    Stop-Process -Id $WatchdogPid -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $WatchdogPidFile -Force -ErrorAction SilentlyContinue
  }
}

function Wait-ListenerStopped {
  param([int]$TimeoutMs = 3500)
  $Deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $Deadline) {
    $Current = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
      Select-Object -First 1
    if (-not $Current) {
      return $true
    }
    Start-Sleep -Milliseconds 200
  }
  return $false
}

New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
"stop requested $(Get-Date -Format o)" | Set-Content -LiteralPath $StopFile -Encoding ASCII

$Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if (-not $Listener) {
  Stop-Watchdog
  Write-Output "JARVIS-OS 网关未在端口 $Port 运行。"
  exit 0
}

if (Wait-ListenerStopped) {
  Stop-Watchdog
  Write-Output "JARVIS-OS 网关已停止（pid $($Listener.OwningProcess)）。"
  exit 0
}

$Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
if (-not $Listener) {
  Stop-Watchdog
  Write-Output "JARVIS-OS 网关已停止。"
  exit 0
}

$Process = Get-CimInstance Win32_Process -Filter "ProcessId=$($Listener.OwningProcess)"
$RootPattern = [regex]::Escape($Root.Path)
if ($Process.CommandLine -notmatch "JARVIS-OS|src[\\/]gateway[\\/]server.ts|dist[\\/]gateway[\\/]server.js|$RootPattern") {
  Write-Output "拒绝停止 pid $($Listener.OwningProcess)：它看起来不像 JARVIS-OS。"
  exit 1
}

Stop-Process -Id $Listener.OwningProcess -Force
Start-Sleep -Milliseconds 700
Stop-Watchdog
Write-Output "JARVIS-OS 网关已停止（pid $($Listener.OwningProcess)）。"
