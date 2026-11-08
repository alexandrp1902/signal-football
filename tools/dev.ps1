param([int]$ServerPort = 5101, [int]$ClientPort = 5174, [int]$RunSeconds = 0)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$children = @()
$previousPort = $env:CATS_SERVER_PORT

function Assert-PortFree([int]$Port) {
    $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $Port)
    try { $listener.Start() } catch { throw "Port $Port is already occupied. No existing process was stopped." }
    finally { $listener.Stop() }
}
function Stop-OwnedProcess([System.Diagnostics.Process]$Owned) {
    try {
        $live = Get-Process -Id $Owned.Id -ErrorAction SilentlyContinue
        if (-not $live -or $live.StartTime -ne $Owned.StartTime) { return }
        $descendants = @(Get-CimInstance Win32_Process -Filter "ParentProcessId=$($Owned.Id)" -ErrorAction SilentlyContinue)
        foreach ($item in $descendants) {
            $child = Get-Process -Id $item.ProcessId -ErrorAction SilentlyContinue
            if ($child -and $child.StartTime -ge $Owned.StartTime) { Stop-OwnedProcess $child }
        }
        Stop-Process -InputObject $live -ErrorAction SilentlyContinue
    } catch { Write-Warning "Could not stop owned PID $($Owned.Id): $_" }
}

Push-Location $projectRoot
try {
    if ($ServerPort -eq $ClientPort -or $ServerPort -lt 1024 -or $ServerPort -gt 65535 -or $ClientPort -lt 1024 -or $ClientPort -gt 65535) { throw 'Choose two different ports between 1024 and 65535' }
    Assert-PortFree $ServerPort
    Assert-PortFree $ClientPort
    & dotnet build server/CatsFootball.Server -c Debug
    if ($LASTEXITCODE -ne 0) { throw 'Server build failed' }
    if (-not (Test-Path -LiteralPath 'client/node_modules/vite/bin/vite.js')) {
        & npm.cmd --prefix client ci --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    }
    $runDirectory = Join-Path $projectRoot ('.local/run-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
    $serverDll = Join-Path $projectRoot 'server/CatsFootball.Server/bin/Debug/net10.0/CatsFootball.Server.dll'
    $viteScript = Join-Path $projectRoot 'client/node_modules/vite/bin/vite.js'
    $env:CATS_SERVER_PORT = [string]$ServerPort
    # Direct dotnet and node children make ownership and shutdown explicit; no visible helper windows.
    $serverProcess = Start-Process -FilePath (Get-Command dotnet.exe).Source -ArgumentList @(('"' + $serverDll + '"'), '--urls', "http://0.0.0.0:$ServerPort") -WorkingDirectory $projectRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDirectory 'server.log') -RedirectStandardError (Join-Path $runDirectory 'server.err.log')
    $children += $serverProcess
    $viteProcess = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList @(('"' + $viteScript + '"'), '--host', '0.0.0.0', '--port', [string]$ClientPort, '--strictPort') -WorkingDirectory (Join-Path $projectRoot 'client') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $runDirectory 'client.log') -RedirectStandardError (Join-Path $runDirectory 'client.err.log')
    $children += $viteProcess
    $children | ForEach-Object { [pscustomobject]@{ pid = $_.Id; started = $_.StartTime.ToString('o') } } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $runDirectory 'pids.json') -Encoding UTF8
    $ready = $false
    for ($attempt = 0; $attempt -lt 60; $attempt++) {
        foreach ($p in $children) { if ($p.HasExited) { throw "PID $($p.Id) exited. Read logs: $runDirectory" } }
        try {
            $health = Invoke-RestMethod "http://127.0.0.1:$ServerPort/health" -TimeoutSec 1
            $page = Invoke-WebRequest "http://127.0.0.1:$ClientPort" -UseBasicParsing -TimeoutSec 1
            if ($health.status -eq 'ready' -and $page.StatusCode -eq 200) { $ready = $true; break }
        } catch { Start-Sleep -Milliseconds 250 }
    }
    if (-not $ready) { throw "Servers did not become ready. Read logs: $runDirectory" }
    Write-Host "PC: http://localhost:$ClientPort"
    Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
        Where-Object { $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)' -and $_.InterfaceAlias -notmatch 'VPN|ZeroTier|vEthernet|Loopback|VirtualBox|VMware' } |
        ForEach-Object { Write-Host "Wi-Fi: http://$($_.IPAddress):$ClientPort" }
    Write-Host "Health: http://localhost:$ServerPort/health"
    Write-Host "Logs/PIDs: $runDirectory"
    Write-Host 'Ctrl+C stops only the processes owned by this run.'
    $watch = [System.Diagnostics.Stopwatch]::StartNew()
    while ($RunSeconds -le 0 -or $watch.Elapsed.TotalSeconds -lt $RunSeconds) {
        foreach ($p in $children) { if ($p.HasExited) { throw "PID $($p.Id) exited. Read logs: $runDirectory" } }
        Start-Sleep -Milliseconds 250
    }
} finally {
    foreach ($p in $children) { Stop-OwnedProcess $p }
    $env:CATS_SERVER_PORT = $previousPort
    Pop-Location
}
