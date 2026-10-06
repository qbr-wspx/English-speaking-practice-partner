$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

if (-not (Test-Path ".venv\Scripts\python.exe")) {
  python -m venv .venv
}

& ".venv\Scripts\python.exe" -m pip install --upgrade pip
& ".venv\Scripts\python.exe" -m pip install -r "backend\requirements.txt"
& ".venv\Scripts\python.exe" -m pip install -r "backend\requirements-build.txt"
npm install

Write-Host ""
Write-Host "Setup complete. Configure services: npm run configure; then start: npm run dev" -ForegroundColor Green
