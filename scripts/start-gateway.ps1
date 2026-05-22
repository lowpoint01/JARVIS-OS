$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Port = 31888
$LogDir = Join-Path $Root "data\logs"
$RunDir = Join-Path $Root "data\run"
$OutLog = Join-Path $LogDir "gateway.out.log"
$ErrLog = Join-Path $LogDir "gateway.err.log"
$WatchdogPidFile = Join-Path $RunDir "gateway.watchdog.pid"
$StopFile = Join-Path $RunDir "gateway.stop"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue

$Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1

if ($Listener) {
  Write-Output "JARVIS-OS 网关已在 http://127.0.0.1:$Port 监听（pid $($Listener.OwningProcess)）。"
  exit 0
}

$Process = Start-Process `
  -FilePath "powershell.exe" `
  -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-File", (Join-Path $PSScriptRoot "watch-gateway.ps1")) `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -PassThru

$Process.Id | Set-Content -LiteralPath $WatchdogPidFile -Encoding ASCII
Start-Sleep -Seconds 2

$Next = $null
for ($i = 0; $i -lt 30; $i++) {
  $Next = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($Next) {
    try {
      $Ready = Invoke-RestMethod "http://127.0.0.1:$Port/readyz" -TimeoutSec 2
      if ($Ready.ready) {
        break
      }
    } catch {
      Start-Sleep -Milliseconds 500
      continue
    }
  }
  Start-Sleep -Milliseconds 500
}

if (-not $Next) {
  Write-Output "JARVIS-OS 网关启动失败。请查看 $ErrLog"
  exit 1
}

try {
  $Ready = Invoke-RestMethod "http://127.0.0.1:$Port/readyz" -TimeoutSec 2
  if (-not $Ready.ready) {
    Write-Output "JARVIS-OS 网关端口已打开，但尚未就绪。请查看 $ErrLog"
    exit 1
  }
} catch {
  Write-Output "JARVIS-OS 网关端口已打开，但 /readyz 未响应。请查看 $ErrLog"
  exit 1
}

Write-Output "JARVIS-OS 网关已启动：http://127.0.0.1:$Port（pid $($Next.OwningProcess)，守护进程 pid $($Process.Id)）。"
