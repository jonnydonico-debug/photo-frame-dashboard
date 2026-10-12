#!/bin/bash
# Home HQ installer for the Mac mini.
#   bash install.sh                       install or update, start at login, keep running
#   bash install.sh --tunnel-token TOKEN  also connect your Cloudflare Tunnel (sabadorks.com)
#   bash install.sh --uninstall           stop it and remove the login item (keeps your data)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HQ="$HOME/HomeHQ"
APP="$HQ/app"
LABEL="com.homehq.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PORT="${PORT:-8787}"
TUNNEL_TOKEN=""

say() { printf '\033[1m▸ %s\033[0m\n' "$*"; }
die() { printf '\033[31m✕ %s\033[0m\n' "$*" >&2; exit 1; }

while [ $# -gt 0 ]; do
  case "$1" in
    --tunnel-token) TUNNEL_TOKEN="${2:-}"; shift 2 ;;
    --uninstall)
      launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
      rm -f "$PLIST"; say "Stopped Home HQ. Your data is still in $HQ/data."; exit 0 ;;
    *) die "Unknown option $1" ;;
  esac
done

[ "$(uname)" = "Darwin" ] || die "Run this on the Mac mini."

# ---------------------------------------------------------------- Node.js
export PATH="$HQ/node/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  # No Homebrew or admin password needed: use the official Node.js 22 LTS build, checked against
  # nodejs.org's published SHA-256, unpacked into ~/HomeHQ/node.
  ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH="x64"
  BASE="https://nodejs.org/dist/latest-v22.x"
  say "Downloading Node.js 22 LTS ($ARCH) from nodejs.org…"
  SUMS="$(curl -fsSL "$BASE/SHASUMS256.txt")" || die "Couldn't reach nodejs.org. Check the internet connection."
  LINE="$(printf '%s\n' "$SUMS" | grep "darwin-$ARCH.tar.gz$" | head -1)"
  [ -n "$LINE" ] || die "No Node.js build found for darwin-$ARCH"
  FILE="${LINE##* }"; SUM="${LINE%% *}"
  TMP="$(mktemp -d)"
  curl -fL --progress-bar "$BASE/$FILE" -o "$TMP/$FILE"
  [ "$(shasum -a 256 "$TMP/$FILE" | cut -d' ' -f1)" = "$SUM" ] || die "Node.js download failed its checksum. Try again."
  mkdir -p "$HQ"; rm -rf "$HQ/node"
  tar -xzf "$TMP/$FILE" -C "$TMP" && mv "$TMP/${FILE%.tar.gz}" "$HQ/node"
  rm -rf "$TMP"
fi
NODE="$(command -v node)"
NODE_MAJOR="$("$NODE" -p 'process.versions.node.split(".")[0]')"
[ "$NODE_MAJOR" -ge 18 ] || die "Node $NODE_MAJOR is too old. Remove it or update it, then run this again."
say "Using Node $("$NODE" -v) at $NODE"

# ---------------------------------------------------------------- files
say "Installing to $HQ"
mkdir -p "$APP" "$HQ/data" "$HQ/logs" "$HQ/bin"
rm -rf "$APP.new"; mkdir -p "$APP.new"
cp -R "$HERE/app/." "$APP.new/"
rm -rf "$APP.old"; [ -d "$APP" ] && mv "$APP" "$APP.old"; mv "$APP.new" "$APP"; rm -rf "$APP.old"
cp "$HERE/homehq" "$HQ/bin/homehq"; chmod +x "$HQ/bin/homehq"
if [ -d "$HOME/.hermes" ]; then
  mkdir -p "$HOME/.hermes/skills/home-hq"; cp "$HERE/hermes-skill/SKILL.md" "$HOME/.hermes/skills/home-hq/SKILL.md"
  say "Added the Home HQ skill to Hermes"
else
  mkdir -p "$HQ/hermes-skill"; cp "$HERE/hermes-skill/SKILL.md" "$HQ/hermes-skill/SKILL.md"
fi

# ---------------------------------------------------------------- launch agent (runs in your login session so Shortcuts/HomeKit work)
say "Setting Home HQ to start at login"
mkdir -p "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>$APP/server/server.mjs</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PORT</key><string>$PORT</string>
    <key>HOMEHQ_DATA</key><string>$HQ/data</string>
    <key>PATH</key><string>$HQ/node/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>WorkingDirectory</key><string>$APP</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ProcessType</key><string>Interactive</string>
  <key>StandardOutPath</key><string>$HQ/logs/server.log</string>
  <key>StandardErrorPath</key><string>$HQ/logs/server.log</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/$LABEL"

for i in 1 2 3 4 5 6 7 8 9 10; do
  curl -fs "http://localhost:$PORT/api/me" >/dev/null 2>&1 && break; sleep 1
done
curl -fs "http://localhost:$PORT/api/me" >/dev/null 2>&1 || die "Server didn't start. See $HQ/logs/server.log"

# ---------------------------------------------------------------- Cloudflare Tunnel (optional)
if [ -n "$TUNNEL_TOKEN" ]; then
  command -v cloudflared >/dev/null 2>&1 || { say "Installing cloudflared…"; brew install cloudflared; }
  say "Connecting the Cloudflare Tunnel (asks for your Mac password)…"
  sudo cloudflared service uninstall >/dev/null 2>&1 || true
  sudo cloudflared service install "$TUNNEL_TOKEN"
fi

# ---------------------------------------------------------------- done
HOST="$(scutil --get LocalHostName 2>/dev/null || hostname -s).local"
IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
echo
say "Home HQ is running."
echo "   Dashboard:  http://$HOST:$PORT/     ${IP:+(or http://$IP:$PORT/)}"
echo "   Admin:      http://$HOST:$PORT/admin"
[ -f "$HQ/data/FIRST-RUN-PIN.txt" ] && echo "   $(cat "$HQ/data/FIRST-RUN-PIN.txt" | head -1)"
echo "   Agent CLI:  $HQ/bin/homehq summary"
echo "   Logs:       $HQ/logs/server.log"
echo
echo "   For the picture frame, point the kiosk app at http://${IP:-$HOST}:$PORT/"
echo "   Keep the Mac mini awake: System Settings → Energy → Prevent automatic sleeping."
