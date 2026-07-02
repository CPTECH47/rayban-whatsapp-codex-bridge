$ErrorActionPreference = "Stop"

$appRoot = Join-Path $env:LOCALAPPDATA "RaybanWhatsAppCodexBridge"
$logDir = Join-Path $appRoot "logs"
$runLog = Join-Path $logDir "bridge.log"
$errLog = Join-Path $logDir "bridge.err.log"

$processes = @()
try {
  $processes = Get-CimInstance Win32_Process |
    Where-Object {
      $_.CommandLine -like "*rayban-whatsapp-codex-bridge*run.ps1*" -or
      $_.CommandLine -like "*rayban-whatsapp-codex-bridge*bridge.mjs*" -or
      $_.CommandLine -like "*RaybanWhatsAppCodexBridge\profile*" -or
      $_.CommandLine -like "*start-whatsapp-bridge.ps1*"
    }
} catch {
  Write-Warning "Could not inspect bridge processes: $($_.Exception.Message)"
}

if ($processes) {
  Write-Host "Bridge processes:"
  $processes | Select-Object ProcessId, Name | Format-Table -AutoSize
} else {
  Write-Host "Bridge is not running."
}

Write-Host ""
Write-Host "Recent log:"
if (Test-Path $runLog) {
  Get-Content -Path $runLog -Tail 40
} else {
  Write-Host "No run log found at $runLog"
}

if ((Test-Path $errLog) -and ((Get-Item $errLog).Length -gt 0)) {
  Write-Host ""
  Write-Host "Recent errors:"
  Get-Content -Path $errLog -Tail 40
}
