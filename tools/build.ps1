param([string]$Configuration = 'Release')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
Push-Location $projectRoot
try {
    & dotnet restore server/CatsFootball.sln --locked-mode
    if ($LASTEXITCODE -ne 0) { throw 'Locked NuGet restore failed' }
    & npm.cmd --prefix client ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
    & npm.cmd --prefix client run build
    if ($LASTEXITCODE -ne 0) { throw 'Client build failed' }
    & dotnet build server/CatsFootball.sln -c $Configuration --no-restore
    if ($LASTEXITCODE -ne 0) { throw 'Server build failed; stop running instances before rebuilding' }
} finally { Pop-Location }
