$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot
Write-Host 'Lingo Studio - configure services for this Windows account' -ForegroundColor Cyan
Write-Host 'DeepSeek: https://platform.deepseek.com/api_keys'
Write-Host 'Bailian (Beijing): https://bailian.console.aliyun.com/'
Write-Host 'Enable Qwen-Audio-3.1-ASR-Flash-Streaming and CosyVoice; obtain a Beijing API key and Workspace ID.'
Write-Host 'Secrets are encrypted locally; they are not included in the installer.'
function Read-Secret([string]$label) {
  $value = Read-Host $label -AsSecureString
  return [System.Net.NetworkCredential]::new('', $value).Password
}
$env:LINGO_CONFIG_DEEPSEEK = Read-Secret 'DeepSeek API Key (Enter to reuse existing key)'
$env:LINGO_CONFIG_DASHSCOPE = Read-Secret 'Bailian Beijing API Key'
$workspaceInput = (Read-Host 'Bailian Workspace ID or Beijing Base URL (Enter to reuse)').Trim()
if ($workspaceInput -match '^https://') {
  $workspaceHost = ([Uri]$workspaceInput).Host
  if (-not $workspaceHost.EndsWith('.cn-beijing.maas.aliyuncs.com')) { throw 'Use the Beijing Base URL from the API Key page.' }
  $workspaceInput = $workspaceHost.Replace('.cn-beijing.maas.aliyuncs.com', '')
}
$env:LINGO_CONFIG_WORKSPACE = $workspaceInput
try {
  & node node_modules/electron/cli.js scripts/configure-services.cjs
  if ($LASTEXITCODE -ne 0) { throw 'Configuration or verification failed. Check the service results above.' }
} finally {
  Remove-Item Env:LINGO_CONFIG_DEEPSEEK -ErrorAction SilentlyContinue
  Remove-Item Env:LINGO_CONFIG_DASHSCOPE -ErrorAction SilentlyContinue
  Remove-Item Env:LINGO_CONFIG_WORKSPACE -ErrorAction SilentlyContinue
}
