$ErrorActionPreference = "Stop"

$currentPid = $PID
$targets = @()
try {
  $targets = Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $currentPid -and (
        $_.CommandLine -like "*rayban-whatsapp-codex-bridge*run.ps1*" -or
        $_.CommandLine -like "*rayban-whatsapp-codex-bridge*bridge.mjs*" -or
        $_.CommandLine -like "*RaybanWhatsAppCodexBridge\profile*" -or
        $_.CommandLine -like "*start-whatsapp-bridge.ps1*"
      )
    }
} catch {
  Write-Error "Could not inspect bridge processes: $($_.Exception.Message)"
}

if (-not $targets) {
  Write-Host "Bridge is not running."
  exit 0
}

$targets | Select-Object ProcessId, Name | Format-Table -AutoSize
$targets | ForEach-Object {
  Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
}

Write-Host "Stopped bridge-owned processes."
