param([Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
$Output = [IO.Path]::GetFullPath($Output)
$repo = Split-Path $PSScriptRoot
Push-Location $repo
try {
    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
    $config = Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
    if ($config.version -ne $version) { throw 'Windows version mismatch between package.json and Tauri.' }
    npm.cmd run tauri build
    if ($LASTEXITCODE) { throw 'Tauri build failed.' }

    $release = 'src-tauri/target/release'
    $installer = Join-Path $release "bundle/nsis/Nocturne Studio_${version}_x64-setup.exe"
    $portable = Join-Path $Output "Nocturne-Studio-${version}-Portable"
    $resources = Join-Path $portable 'resources'
    New-Item -ItemType Directory -Force $resources | Out-Null
    Copy-Item -LiteralPath $installer -Destination (Join-Path $Output "Nocturne-Studio-${version}-Setup.exe")
    Copy-Item -LiteralPath "$release/nocturne-studio.exe", 'src-tauri/icons/icon.ico' -Destination $portable
    foreach ($path in $config.bundle.resources.PSObject.Properties.Name) {
        Copy-Item -LiteralPath (Join-Path 'src-tauri' $path) -Destination $portable
        Copy-Item -LiteralPath (Join-Path 'src-tauri' $path) -Destination $resources
    }
    Compress-Archive -LiteralPath $portable -DestinationPath "$portable.zip" -Force
} finally {
    Pop-Location
}
