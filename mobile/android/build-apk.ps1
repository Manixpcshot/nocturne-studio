param(
    [Parameter(Mandatory)][string]$Sdk,
    [string]$EngineDir = (Join-Path $PSScriptRoot 'vendor/stable-diffusion.cpp'),
    [string]$Output = (Join-Path $PSScriptRoot 'build/Nocturne-Mobile.apk'),
    [string]$NativeBuild,
    [string]$BuildDirectory,
    [string]$VulkanBuild,
    [string]$VulkanHeaders,
    [string]$SpirvConfig,
    [string]$SigningKey,
    [ValidateSet('arm64-v8a', 'x86_64')][string]$Abi = 'arm64-v8a',
    [ValidateRange(1,16)][int]$Jobs = 5
)
$ErrorActionPreference = 'Stop'
$Sdk = (Resolve-Path $Sdk).Path
$Output = [System.IO.Path]::GetFullPath($Output)
$pin = '3b12781fac1a22eda27ad0f08d0884ef816f24d7'
$app = Join-Path $PSScriptRoot 'app/src/main'
$gradle = Get-Content (Join-Path $PSScriptRoot 'app/build.gradle') -Raw
$versionName = [regex]::Match($gradle, "versionName\s+'([^']+)'").Groups[1].Value
$versionCode = [regex]::Match($gradle, 'versionCode\s+(\d+)').Groups[1].Value
if (!$versionName -or !$versionCode) { throw 'Android version is missing from app/build.gradle.' }
$tools = Join-Path $Sdk 'build-tools/35.0.0'
$ndk = Join-Path $Sdk 'ndk/27.2.12479018'
$cmakeBin = Join-Path $Sdk 'cmake/3.31.6/bin'
$platform = Join-Path $Sdk 'platforms/android-35/android.jar'
$scratch = if ($BuildDirectory) { [System.IO.Path]::GetFullPath($BuildDirectory) } else { Join-Path $PSScriptRoot "build/$Abi" }
$projectJava = Join-Path $app 'java'
if ($env:JAVA_HOME) {
    $javaBin = Join-Path $env:JAVA_HOME 'bin'
    $javac = Join-Path $javaBin 'javac.exe'
    $jar = Join-Path $javaBin 'jar.exe'
    $keytool = Join-Path $javaBin 'keytool.exe'
} else {
    $javac = (Get-Command javac.exe).Source
    $jar = (Get-Command jar.exe).Source
    $keytool = (Get-Command keytool.exe).Source
}
function Invoke-Checked([string]$File, [string[]]$CommandArgs) {
    & $File @CommandArgs
    if ($LASTEXITCODE) { throw "Build command failed ($LASTEXITCODE): $File" }
}
if (!(Test-Path (Join-Path $EngineDir '.git'))) {
    New-Item -ItemType Directory -Force (Split-Path $EngineDir) | Out-Null
    Invoke-Checked git @('init', $EngineDir)
    Invoke-Checked git @('-C', $EngineDir, 'remote', 'add', 'origin', 'https://github.com/leejet/stable-diffusion.cpp.git')
    Invoke-Checked git @('-C', $EngineDir, 'fetch', '--depth', '1', 'origin', $pin)
    Invoke-Checked git @('-C', $EngineDir, 'checkout', '--detach', $pin)
}
$actualPin = & git -C $EngineDir rev-parse HEAD
if ($LASTEXITCODE -or $actualPin -ne $pin) { throw "The engine checkout must be at $pin." }
Invoke-Checked git @('-C', $EngineDir, 'submodule', 'update', '--init', '--depth', '1', '--', 'ggml')
$EngineDir = (Resolve-Path $EngineDir).Path
if ($VulkanHeaders -or $SpirvConfig) {
    if (!$VulkanHeaders -or !$SpirvConfig) { throw 'Both Vulkan headers and the SPIR-V CMake configuration are required.' }
    $ggml = Join-Path $EngineDir 'ggml'
    $vulkanPatch = Join-Path $PSScriptRoot 'patches/android-vulkan-promoted-features.patch'
    & git -C $ggml apply --reverse --check $vulkanPatch 2>$null
    if ($LASTEXITCODE) { Invoke-Checked git @('-C',$ggml,'apply',$vulkanPatch) }
}

$classes = Join-Path $scratch 'classes'
$dex = Join-Path $scratch 'dex'
$generated = Join-Path $scratch 'generated'
$payload = Join-Path $scratch 'payload'
$native = if ($NativeBuild) { [System.IO.Path]::GetFullPath($NativeBuild) } else { Join-Path $scratch 'native' }
$gpuNative = if ($VulkanBuild) { [System.IO.Path]::GetFullPath($VulkanBuild) } else { Join-Path $scratch 'vulkan' }
$lib = Join-Path $payload "lib/$Abi"
$resources = Join-Path $scratch 'resources.zip'
$base = Join-Path $scratch 'base.apk'
$aligned = Join-Path $scratch 'aligned.apk'
New-Item -ItemType Directory -Force $classes,$dex,$generated,$lib,(Split-Path $Output) | Out-Null

$nativeArgs = @('-Wno-deprecated','-S',"$app/cpp",'-G','Ninja',
    "-DCMAKE_MAKE_PROGRAM=$cmakeBin/ninja.exe","-DCMAKE_TOOLCHAIN_FILE=$ndk/build/cmake/android.toolchain.cmake",
    "-DANDROID_ABI=$Abi",'-DANDROID_PLATFORM=android-28','-DANDROID_STL=c++_static',
    '-DANDROID_SUPPORT_FLEXIBLE_PAGE_SIZES=ON',"-DNOCTURNE_ENGINE=$EngineDir",'-DCMAKE_BUILD_TYPE=Release')
Invoke-Checked "$cmakeBin/cmake.exe" ($nativeArgs + @('-B',$native,'-DNOCTURNE_VULKAN=OFF'))
Invoke-Checked "$cmakeBin/cmake.exe" @('--build',$native,'--target','nocturne_engine','--parallel',"$Jobs")
Copy-Item -LiteralPath "$native/libnocturne_engine.so" -Destination "$lib/libnocturne_engine.so" -Force
$llvm = Join-Path $ndk 'toolchains/llvm/prebuilt/windows-x86_64/bin'
Invoke-Checked "$llvm/llvm-strip.exe" @('--strip-unneeded',"$lib/libnocturne_engine.so")
if ($VulkanHeaders -or $SpirvConfig) {
    $glslc = "$ndk/shader-tools/windows-x86_64/glslc.exe"
    Invoke-Checked "$cmakeBin/cmake.exe" ($nativeArgs + @('-B',$gpuNative,'-DNOCTURNE_VULKAN=ON',
        "-DVulkan_INCLUDE_DIR=$VulkanHeaders","-DVulkan_GLSLC_EXECUTABLE=$glslc","-DSPIRV-Headers_DIR=$SpirvConfig"))
    Invoke-Checked "$cmakeBin/cmake.exe" @('--build',$gpuNative,'--target','nocturne_engine','--parallel',"$Jobs")
    Copy-Item -LiteralPath "$gpuNative/libnocturne_vulkan.so" -Destination "$lib/libnocturne_vulkan.so" -Force
    Invoke-Checked "$llvm/llvm-strip.exe" @('--strip-unneeded',"$lib/libnocturne_vulkan.so")
} elseif (Test-Path -LiteralPath "$lib/libnocturne_vulkan.so") {
    Remove-Item -LiteralPath "$lib/libnocturne_vulkan.so"
}

Invoke-Checked "$tools/aapt2.exe" @('compile','--dir',"$app/res",'-o',$resources)
Invoke-Checked "$tools/aapt2.exe" @('link','-I',$platform,'--manifest',"$app/AndroidManifest.xml",
    '--java',$generated,'-A',"$app/assets",'--min-sdk-version','28','--target-sdk-version','35',
    '--version-name',$versionName,'--version-code',$versionCode,'--rename-manifest-package','studio.nocturne.mobile',
    '--debug-mode','-o',$base,$resources)
$javaSources = @(Get-ChildItem -Path $projectJava,$generated -Filter '*.java' -Recurse | Select-Object -ExpandProperty FullName)
Invoke-Checked $javac (@('-encoding','UTF-8','--release','11','-classpath',$platform,'-d',$classes) + $javaSources)
$archive = Join-Path $scratch 'classes.jar'
Invoke-Checked $jar @('--create','--file',$archive,'-C',$classes,'.')
Invoke-Checked "$tools/d8.bat" @('--lib',$platform,'--min-api','28','--output',$dex,$archive)
Invoke-Checked $jar @('--update','--file',$base,'-C',$dex,'classes.dex','-C',$payload,'lib')
Invoke-Checked "$tools/zipalign.exe" @('-p','-f','4',$base,$aligned)

$key = if ($SigningKey) { (Resolve-Path -LiteralPath $SigningKey).Path } else { Join-Path $PSScriptRoot 'build/nocturne-debug.jks' }
if (!(Test-Path -LiteralPath $key)) {
    Invoke-Checked $keytool @('-genkeypair','-keystore',$key,'-storepass','android','-keypass','android',
        '-alias','androiddebugkey','-keyalg','RSA','-keysize','2048','-validity','10000',
        '-dname','CN=Nocturne Development, O=Nocturne, C=US')
}
Invoke-Checked "$tools/apksigner.bat" @('sign','--ks',$key,'--ks-pass','pass:android','--out',$Output,$aligned)
Invoke-Checked "$tools/apksigner.bat" @('verify','--verbose',$Output)
Write-Output "APK: $Output"
