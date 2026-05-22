$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Port = 31888
$WatchdogPidFile = Join-Path $Root "data\run\gateway.watchdog.pid"
$Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
  Select-Object -First 1
$WatchdogPid = $null
if (Test-Path -LiteralPath $WatchdogPidFile) {
  $WatchdogPid = [int](Get-Content -LiteralPath $WatchdogPidFile -Raw)
}

if (-not $Listener) {
  Write-Output "JARVIS-OS 网关未运行。"
  exit 1
}

try {
  $Ready = Invoke-RestMethod "http://127.0.0.1:$Port/readyz"
  $Health = Invoke-RestMethod "http://127.0.0.1:$Port/health"
  $Self = Invoke-RestMethod "http://127.0.0.1:$Port/self/diagnose"
  $SelfModel = Invoke-RestMethod "http://127.0.0.1:$Port/self/model"
} catch {
  [pscustomobject]@{
    running = $true
    url = "http://127.0.0.1:$Port"
    pid = $Listener.OwningProcess
    ready = $false
    error = $_.Exception.Message
  } | ConvertTo-Json -Depth 5
  exit 1
}

[pscustomobject]@{
  running = $true
  url = "http://127.0.0.1:$Port"
  pid = $Listener.OwningProcess
  watchdogPid = $WatchdogPid
  ready = $Ready.ready
  uptimeMs = $Ready.uptimeMs
  tools = $Health.components.tools.detail
  actions = $Health.components.actions.detail
  notifications = $Health.components.notifications.detail
  reminders = $Health.components.reminders.detail
  memory = $Health.components.memory.detail
  world = $Health.components.world.detail
  reflection = $Health.components.reflection.detail
  voice = $Health.components.voice.detail
  initiative = $Health.components.initiative.ok
  perception = $Health.components.perception.ok
  self = $Self.summary
  selfOk = $Self.ok
  selfPosture = $SelfModel.posture
  stabilityScore = $SelfModel.stabilityScore
} | ConvertTo-Json -Depth 5
