# mineIt! demo: one command for demo day (Windows PowerShell): installs what's missing, builds the web app,
# and serves everything from http://localhost:8000 (phones on the same Wi-Fi use the LAN address).
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location "$root\api"
if (-not (Test-Path ".venv")) { python -m venv .venv }
.\.venv\Scripts\python -m pip install -q -r requirements.txt
Set-Location "$root\web"
if (-not (Test-Path "node_modules")) { npm ci }
npm run build
Set-Location "$root\api"
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -notmatch 'Loopback|vEthernet' -and $_.IPAddress -notmatch '^169' } | Select-Object -First 1).IPAddress
Write-Host ""
Write-Host "mineIt!  From mine! to paid and packed  (prototype demo)"
Write-Host "Seller desk:  http://localhost:8000/seller   (key: demo-seller-key unless SELLER_KEY is set)"
Write-Host "Phones:       http://${ip}:8000              (same Wi-Fi)"
Write-Host ""
.\.venv\Scripts\python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
