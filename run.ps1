$BridgeArgs = $args
$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path $PSScriptRoot
$script = Join-Path $PSScriptRoot "bridge.mjs"
$bundledNodeDir = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin"
if (Test-Path $bundledNodeDir) {
  $env:PATH = "$bundledNodeDir;$env:PATH"
}

$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) {
  & $nodeCommand.Source $script @BridgeArgs
  exit $LASTEXITCODE
}

$bundledNode = Join-Path $bundledNodeDir "node.exe"
if (Test-Path $bundledNode) {
  & $bundledNode $script @BridgeArgs
  exit $LASTEXITCODE
}

Write-Error "Node.js was not found. Install Node.js 20+ or run this from Codex desktop with bundled runtime dependencies."
