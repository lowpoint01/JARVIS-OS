$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Port = 31888
$LogDir = Join-Path $Root "data\logs"
$RunDir = Join-Path $Root "data\run"
$OutLog = Join-Path $LogDir "gateway.out.log"
$ErrLog = Join-Path $LogDir "gateway.err.log"
$WatchLog = Join-Path $LogDir "gateway.watchdog.log"
$ChildPidFile = Join-Path $RunDir "gateway.child.pid"
$WatchdogPidFile = Join-Path $RunDir "gateway.watchdog.pid"
$StopFile = Join-Path $RunDir "gateway.stop"

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null
New-Item -ItemType Directory -Force -Path $RunDir | Out-Null
$PID | Set-Content -LiteralPath $WatchdogPidFile -Encoding ASCII

function Write-WatchLog($Message) {
  Add-Content -LiteralPath $WatchLog -Value "[$(Get-Date -Format o)] $Message"
}

function Stop-Listener {
  $Listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
  if ($Listener) {
    Stop-Process -Id $Listener.OwningProcess -Force -ErrorAction SilentlyContinue
  }
}

Write-WatchLog "watchdog started"

while ($true) {
  if (Test-Path -LiteralPath $StopFile) {
    Write-WatchLog "stop requested before launch"
    break
  }

  Write-WatchLog "starting gateway"
  $Child = Start-Process `
    -FilePath "pnpm.cmd" `
    -ArgumentList @("dev:gateway") `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -RedirectStandardOutput $OutLog `
    -RedirectStandardError $ErrLog `
    -PassThru

  $Child.Id | Set-Content -LiteralPath $ChildPidFile -Encoding ASCII

  while (-not $Child.HasExited) {
    if (Test-Path -LiteralPath $StopFile) {
      Write-WatchLog "stop requested; stopping gateway"
      Stop-Listener
      Stop-Process -Id $Child.Id -Force -ErrorAction SilentlyContinue
      break
    }
    Start-Sleep -Seconds 2
    try {
      $Child.Refresh()
    } catch {
      break
    }
  }

  if (Test-Path -LiteralPath $StopFile) {
    break
  }

  $ExitCode = $Child.ExitCode
  Write-WatchLog "gateway exited with code $ExitCode; restarting in 2s"
  Start-Sleep -Seconds 2
}

Remove-Item -LiteralPath $ChildPidFile -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $WatchdogPidFile -Force -ErrorAction SilentlyContinue
Write-WatchLog "watchdog stopped"
