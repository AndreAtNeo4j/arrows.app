#!/usr/bin/env sh
# Package the Arrows IntelliJ plugin into an installable zip.
set -e
DIR="$(cd "$(dirname "$0")" && pwd)"

"$DIR/gradlew" -p "$DIR" :plugin:buildPlugin

ZIP="$DIR/plugin/build/distributions/plugin.zip"
echo ""
echo "[install-local] Packaged: $ZIP"
echo "[install-local] Install: IDE > Settings > Plugins > (gear) Install Plugin from Disk... > pick the zip, then restart."
echo "[install-local] Or run a sandbox IDE with it loaded: \"$DIR/gradlew\" :plugin:runIde"
