<#
.SYNOPSIS
  Start the API and the UI on this machine, no containers.

.EXAMPLE
  .\run.ps1            # install what's missing, then run both
  .\run.ps1 -SetupOnly # only install

  Docker is the reliable path (see docker-compose.yml); this one is faster to
  iterate against and renders on your own CPU rather than a container's.
#>
[CmdletBinding()]
param([switch]$SetupOnly)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

$venv = Join-Path $PSScriptRoot ".venv"
$py = Join-Path $venv "Scripts\python.exe"
$uvicorn = Join-Path $venv "Scripts\uvicorn.exe"

function Step($text) { Write-Host "`n==> $text" -ForegroundColor DarkYellow }

if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
  throw "python 3.10+ is required and was not found on PATH"
}
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "node 18+ is required and was not found on PATH"
}
if (-not (Get-Command ffmpeg -ErrorAction SilentlyContinue)) {
  Write-Host "warning: ffmpeg is not on PATH - renders will fail." -ForegroundColor Yellow
  Write-Host "         winget install Gyan.FFmpeg" -ForegroundColor Yellow
}

if (-not (Test-Path $venv)) {
  Step "creating .venv"
  python -m venv $venv
}

Step "installing python dependencies"
& $py -m pip install --quiet --upgrade pip
& $py -m pip install --quiet -r backend\requirements.txt

$probe = @'
import sys
from pathlib import Path
from playwright.sync_api import sync_playwright
with sync_playwright() as pw:
    sys.exit(0 if Path(pw.chromium.executable_path).exists() else 1)
'@
$probe | & $py - 2>$null
if ($LASTEXITCODE -ne 0) {
  Step "downloading chromium (once, ~150 MB)"
  & $py -m playwright install chromium
}

if (-not (Test-Path frontend\node_modules)) {
  Step "installing frontend dependencies"
  Push-Location frontend
  npm install
  Pop-Location
}

if ($SetupOnly) { Step "setup complete"; exit 0 }

Step "starting the API on :8000"
$api = Start-Process -FilePath $uvicorn `
  -ArgumentList "app.main:create_app", "--factory", "--reload", "--host", "127.0.0.1", "--port", "8000" `
  -WorkingDirectory (Join-Path $PSScriptRoot "backend") -PassThru -NoNewWindow

try {
  Step "starting the UI on http://localhost:5173"
  Push-Location frontend
  npm run dev
} finally {
  Pop-Location
  if ($api -and -not $api.HasExited) {
    Step "stopping the API"
    Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
  }
}
