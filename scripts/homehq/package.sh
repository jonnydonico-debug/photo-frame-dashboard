#!/bin/bash
# Builds HomeHQ-installer.tar.gz: the dashboard (served straight from source), server, CLI and Hermes skill.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="${1:-$ROOT/HomeHQ-installer.tar.gz}"
T="$(mktemp -d)"; P="$T/HomeHQ-installer"
mkdir -p "$P/app"
cd "$ROOT/dashboard"
cp -R index.html admin.html js css public server "$P/app/"
cp "$ROOT/scripts/homehq/install-macos.sh" "$P/install.sh"
cp "$ROOT/scripts/homehq/homehq" "$P/homehq"
cp -R "$ROOT/scripts/homehq/hermes-skill" "$P/hermes-skill"
cp "$ROOT/scripts/homehq/README.md" "$P/README.md"
chmod +x "$P/install.sh" "$P/homehq"
tar -czf "$OUT" -C "$T" HomeHQ-installer
rm -rf "$T"
echo "$OUT"
