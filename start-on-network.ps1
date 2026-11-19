# Starts the WFX knowledge server so other computers on the same Wi-Fi/LAN can open it.
# Run from this folder:  powershell -ExecutionPolicy Bypass -File .\start-on-network.ps1
$ip = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -like '192.168.*' -or $_.IPAddress -like '10.*' } | Select-Object -First 1).IPAddress
Write-Host "Share this link:  http://${ip}:8787/"
$env:WFX_HOST = '0.0.0.0'
npm run kb:server
