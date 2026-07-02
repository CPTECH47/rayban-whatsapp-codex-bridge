$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path $PSScriptRoot
$appRoot = Join-Path $env:LOCALAPPDATA "RaybanWhatsAppCodexBridge"
$logDir = Join-Path $appRoot "logs"
$runLog = Join-Path $logDir "bridge.log"
$errLog = Join-Path $logDir "bridge.err.log"
$runnerScript = Join-Path $PSScriptRoot "run.ps1"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

$existing = @()
try {
  $existing = Get-CimInstance Win32_Process |
    Where-Object {
      $_.ProcessId -ne $PID -and (
        $_.CommandLine -like "*rayban-whatsapp-codex-bridge*run.ps1*" -or
        $_.CommandLine -like "*rayban-whatsapp-codex-bridge*bridge.mjs*" -or
        $_.CommandLine -like "*RaybanWhatsAppCodexBridge\profile*" -or
        $_.CommandLine -like "*start-whatsapp-bridge.ps1*"
      )
    }
} catch {
  Write-Warning "Could not inspect existing bridge processes: $($_.Exception.Message)"
}

if ($existing) {
  Write-Host "Bridge already appears to be running:"
  $existing | Select-Object ProcessId, Name | Format-Table -AutoSize
  Write-Host "Use .\stop.ps1 first if you want to restart it."
  exit 0
}

"" | Set-Content -LiteralPath $runLog
"" | Set-Content -LiteralPath $errLog

Start-Process powershell `
  -WindowStyle Hidden `
  -WorkingDirectory $repoRoot `
  -ArgumentList @("-ExecutionPolicy", "Bypass", "-File", $runnerScript) `
  -RedirectStandardOutput $runLog `
  -RedirectStandardError $errLog

Start-Sleep -Seconds 5

Write-Host "Bridge start requested."
Write-Host "Log: $runLog"
Get-Content -Path $runLog -Tail 30 -ErrorAction SilentlyContinue
Get-Content -Path $errLog -Tail 30 -ErrorAction SilentlyContinue
