$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RunDir = Join-Path $Root "data\run"
$LogDir = Join-Path $Root "data\logs"
$PidFile = Join-Path $RunDir "voice-conversation.pid"
$StopFile = Join-Path $RunDir "voice-conversation.stop"
$OutLog = Join-Path $LogDir "voice-conversation.out.log"
$ErrLog = Join-Path $LogDir "voice-conversation.err.log"

New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (Test-Path -LiteralPath $PidFile) {
  $ExistingPid = [int](Get-Content -LiteralPath $PidFile -Raw)
  $Existing = Get-Process -Id $ExistingPid -ErrorAction SilentlyContinue
  if ($Existing) {
    Write-Output "JARVIS 持续语音对话已在运行（pid $ExistingPid）。"
    exit 0
  }
}

Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue

try {
  Invoke-RestMethod "http://127.0.0.1:31888/readyz" -TimeoutSec 2 | Out-Null
} catch {
  & (Join-Path $PSScriptRoot "start-gateway.ps1")
}

$Process = Start-Process `
  -FilePath "node.exe" `
  -ArgumentList @((Join-Path $PSScriptRoot "voice-conversation.mjs")) `
  -WorkingDirectory $Root `
  -WindowStyle Hidden `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog `
  -PassThru

$Process.Id | Set-Content -LiteralPath $PidFile -Encoding ASCII
Start-Sleep -Seconds 2
$Process.Refresh()

if ($Process.HasExited) {
  Write-Output "JARVIS 持续语音对话启动失败。请查看 $ErrLog"
  exit 1
}

Write-Output "JARVIS 持续语音对话已启动（pid $($Process.Id)）。"
Write-Output "麦克风：Windows 当前默认输入设备。"
Write-Output "扬声器：Windows 当前默认输出设备。"
Write-Output "停止命令：pnpm voice:stop"
