#!/usr/bin/env bash
set -euo pipefail

output=$(realpath -m "${1:?Pass the output directory}")
cd "$(dirname "${BASH_SOURCE[0]}")/.."
version=$(node -p 'require("./package.json").version')
[[ $(node -p 'require("./src-tauri/tauri.conf.json").version') == "$version" ]]
[[ "${GITHUB_REF_TYPE:-}" != tag || "${GITHUB_REF_NAME:-}" == "v$version" ]]
: "${TAURI_SIGNING_PRIVATE_KEY:?A Tauri signing key is required}"

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
pin=3b12781fac1a22eda27ad0f08d0884ef816f24d7
engine="$work/stable-diffusion.cpp"
git init -q "$engine"
git -C "$engine" remote add origin https://github.com/leejet/stable-diffusion.cpp.git
git -C "$engine" fetch --depth 1 origin "$pin"
git -C "$engine" checkout --detach "$pin"
git -C "$engine" submodule update --init --depth 1 -- ggml
[[ $(git -C "$engine" rev-parse HEAD) == "$pin" ]]

# Use a known Vulkan header revision for the engine's newer optional features.
git clone --depth 1 --branch v1.4.350 https://github.com/KhronosGroup/Vulkan-Headers.git "$work/vulkan"
git clone --depth 1 --branch vulkan-sdk-1.4.350.1 https://github.com/KhronosGroup/SPIRV-Headers.git "$work/spirv"
cmake -S "$work/spirv" -B "$work/spirv-build" -G Ninja \
  -DSPIRV_HEADERS_ENABLE_TESTS=OFF -DCMAKE_INSTALL_PREFIX="$work/sdk"
cmake --install "$work/spirv-build"

engines="$PWD/src-tauri/linux-engines"
mkdir -p "$engines" "$output"
cp "$engine/LICENSE" "$engines/stable-diffusion.cpp-LICENSE.txt"
cp "$engine/ggml/LICENSE" "$engines/ggml-LICENSE.txt"
for kind in cpu vulkan; do
  args=(-DSD_VULKAN=OFF)
  if [[ "$kind" == vulkan ]]; then
    args=(-DSD_VULKAN=ON "-DVulkan_INCLUDE_DIR=$work/vulkan/include" "-DSPIRV-Headers_DIR=$work/sdk/share/cmake/SPIRV-Headers")
  fi
  cmake -S "$engine" -B "$work/$kind" -G Ninja -DCMAKE_BUILD_TYPE=Release \
    -DCMAKE_C_COMPILER_LAUNCHER=ccache -DCMAKE_CXX_COMPILER_LAUNCHER=ccache \
    -DCMAKE_CXX_FLAGS_RELEASE="-O2 -DNDEBUG" -DSD_BUILD_EXAMPLES=ON \
    -DSD_WEBP=OFF -DSD_WEBM=OFF -DGGML_NATIVE=OFF -DGGML_OPENMP=OFF \
    -DGGML_LLAMAFILE=OFF "${args[@]}"
  cmake --build "$work/$kind" --target sd-cli --parallel "${NOCTURNE_BUILD_JOBS:-4}"
  install -m 755 "$work/$kind/bin/sd-cli" "$engines/sd-cli-$kind"
  strip --strip-unneeded "$engines/sd-cli-$kind"
  "$engines/sd-cli-$kind" --help > "$work/$kind-help.txt" 2>&1
  grep -q -- '--diffusion-model' "$work/$kind-help.txt"
done

npm run tauri build -- --bundles deb
package="Nocturne-Studio_${version}_amd64.deb"
shopt -s nullglob
packages=(src-tauri/target/release/bundle/deb/*_"$version"_amd64.deb)
[[ ${#packages[@]} == 1 ]]
cp "${packages[0]}" "$output/$package"
# Linux package formats can be signed explicitly through the same Tauri updater key.
npm run tauri signer sign -- --app-version "$version" "$output/$package"
[[ "$(dpkg-deb --field "$output/$package" Architecture)" == amd64 ]]
[[ "$(dpkg-deb --field "$output/$package" Version)" == "$version" ]]
dpkg-deb -x "$output/$package" "$work/packaged"
test -x "$work/packaged/usr/bin/nocturne-studio"
cpu=$(find "$work/packaged/usr/lib" -type f -name sd-cli-cpu -print -quit)
gpu=$(find "$work/packaged/usr/lib" -type f -name sd-cli-vulkan -print -quit)
test -n "$cpu" && test -x "$cpu"
test -n "$gpu" && test -x "$gpu"
grep -q 'python3-venv' <(dpkg-deb --field "$output/$package" Depends)
jq -n --arg version "$version" \
  --arg url "https://github.com/Manixpcshot/nocturne-studio/releases/download/v$version/$package" \
  --rawfile signature "$output/$package.sig" \
  '{version:$version,platforms:{"linux-x86_64-deb":{url:$url,signature:($signature | sub("\\s+$";""))}}}' \
  > "$output/debian-updater.json"
