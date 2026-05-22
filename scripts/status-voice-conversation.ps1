$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RunDir = Join-Path $Root "data\run"
$LogDir = Join-Path $Root "data\logs"
$PidFile = Join-Path $RunDir "voice-conversation.pid"
$OutLog = Join-Path $LogDir "voice-conversation.out.log"
$ErrLog = Join-Path $LogDir "voice-conversation.err.log"

$PidValue = $null
$Running = $false
if (Test-Path -LiteralPath $PidFile) {
  $PidValue = [int](Get-Content -LiteralPath $PidFile -Raw)
  $Running = [bool](Get-Process -Id $PidValue -ErrorAction SilentlyContinue)
}

[pscustomobject]@{
  running = $Running
  pid = $PidValue
  microphone = "Windows current default input device"
  speaker = "Windows current default output device"
  outLog = $OutLog
  errLog = $ErrLog
} | ConvertTo-Json -Depth 4
