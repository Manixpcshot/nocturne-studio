param([Parameter(Mandatory)][string]$Output)
$ErrorActionPreference = 'Stop'
$Output = [IO.Path]::GetFullPath($Output)
$repo = Split-Path $PSScriptRoot
Push-Location $repo
try {
    $version = (Get-Content package.json -Raw | ConvertFrom-Json).version
    $config = Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json
    if ($config.version -ne $version) { throw 'Windows version mismatch between package.json and Tauri.' }
    if (!$env:TAURI_SIGNING_PRIVATE_KEY) { throw 'Windows updater signing key is missing.' }
    npm.cmd run tauri build
    if ($LASTEXITCODE) { throw 'Tauri build failed.' }

    $release = 'src-tauri/target/release'
    $installer = Join-Path $release "bundle/nsis/Nocturne Studio_${version}_x64-setup.exe"
    $portable = Join-Path $Output "Nocturne-Studio-${version}-Portable"
    $resources = Join-Path $portable 'resources'
    New-Item -ItemType Directory -Force $resources | Out-Null
    Copy-Item -LiteralPath $installer -Destination (Join-Path $Output "Nocturne-Studio-${version}-Setup.exe")
    $installerName = "Nocturne-Studio-$version-Setup.exe"
    $signature = (Get-Content -LiteralPath "$installer.sig" -Raw).Trim()
    if (!$signature) { throw 'Windows updater signature is missing.' }
    Copy-Item -LiteralPath "$installer.sig" -Destination (Join-Path $Output "$installerName.sig")
    $manifest = @{ version = $version; platforms = @{
        'windows-x86_64' = @{ signature = $signature
            url = "https://github.com/Manixpcshot/nocturne-studio/releases/download/v$version/$installerName" }
    }}
    [IO.File]::WriteAllText((Join-Path $Output 'latest.json'), ($manifest | ConvertTo-Json -Depth 4))
    New-Item -ItemType File -Force (Join-Path $portable 'nocturne.portable') | Out-Null
    Copy-Item -LiteralPath "$release/nocturne-studio.exe", 'src-tauri/icons/icon.ico' -Destination $portable
    foreach ($path in $config.bundle.resources.PSObject.Properties.Name) {
        Copy-Item -LiteralPath (Join-Path 'src-tauri' $path) -Destination $portable
        Copy-Item -LiteralPath (Join-Path 'src-tauri' $path) -Destination $resources
    }
    Compress-Archive -LiteralPath $portable -DestinationPath "$portable.zip" -Force
} finally {
    Pop-Location
}
