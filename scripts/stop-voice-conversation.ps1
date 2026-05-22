$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$RunDir = Join-Path $Root "data\run"
$PidFile = Join-Path $RunDir "voice-conversation.pid"
$StopFile = Join-Path $RunDir "voice-conversation.stop"

New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
"stop requested" | Set-Content -LiteralPath $StopFile -Encoding UTF8

if (Test-Path -LiteralPath $PidFile) {
  $VoicePid = [int](Get-Content -LiteralPath $PidFile -Raw)
  $Process = Get-Process -Id $VoicePid -ErrorAction SilentlyContinue
  if ($Process) {
    for ($i = 0; $i -lt 12; $i++) {
      Start-Sleep -Milliseconds 500
      $Process.Refresh()
      if ($Process.HasExited) {
        break
      }
    }
    $Process = Get-Process -Id $VoicePid -ErrorAction SilentlyContinue
    if ($Process) {
      Stop-Process -Id $VoicePid -Force -ErrorAction SilentlyContinue
    }
  }
}

Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $StopFile -Force -ErrorAction SilentlyContinue
Write-Output "JARVIS 持续语音对话已停止。"
