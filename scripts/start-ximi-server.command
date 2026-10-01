#!/bin/bash
#
# Start XIMI offline on this (server) Mac: LiveKit, Caddy, the XIMI server
# and the Control / Performer / Scout / Output apps.
#
# Double-click in Finder, or run from Terminal:
#
#   scripts/start-ximi-server.command              # build, then start
#   scripts/start-ximi-server.command --no-build   # start without rebuilding
#
# Runs in this Terminal window with live logs. Ctrl-C (or closing the window)
# stops everything.
#
# One-time setup this expects (see certs/README.md):
#   - Homebrew: caddy, livekit;  Node 20+ (nvm is fine);  pnpm via corepack
#   - apps/*/.env.offline and apps/server/.env.offline (copy the .example files)
#   - this Mac resolves *.ximi.offline to itself:
#       scripts/set-ximi-server-ip.command 127.0.0.1

set -uo pipefail

BUILD=1
[[ "${1:-}" == "--no-build" ]] && BUILD=0

cd "$(dirname "$0")/.." || exit 1
ROOT="$PWD"

# ask "prompt" var: read an answer from the terminal; empty if there is none
ask() {
  if : 2>/dev/null </dev/tty; then
    read -r -p "$1" "$2" </dev/tty
  else
    eval "$2=''"
  fi
}

fail() {
  echo
  echo "Error: $*" >&2
  echo
  ask "Press Return to close." _
  exit 1
}

# ---- environment: Homebrew + Node (Finder/SSH shells don't load these) --------

[[ -x /opt/homebrew/bin/brew ]] && eval "$(/opt/homebrew/bin/brew shellenv)"
[[ -x /usr/local/bin/brew ]] && eval "$(/usr/local/bin/brew shellenv)"
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
# shellcheck disable=SC1091
[[ -s "$NVM_DIR/nvm.sh" ]] && . "$NVM_DIR/nvm.sh" >/dev/null
export COREPACK_ENABLE_DOWNLOAD_PROMPT=0

for tool in node pnpm caddy livekit-server; do
  command -v "$tool" >/dev/null || fail "'$tool' not found. Install it first (see the header of this script)."
done
NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
((NODE_MAJOR >= 20)) || fail "Node 20 or newer needed, found $(node -v)."

# ---- configuration ------------------------------------------------------------------

missing=()
for f in apps/server/.env.offline apps/control/.env.offline apps/performer/.env.offline \
  apps/scout/.env.offline apps/output/.env.offline; do
  [[ -f "$f" ]] || missing+=("$f")
done
((${#missing[@]} == 0)) || fail "Missing settings: ${missing[*]}
Copy each from the matching .env.offline.example and fill it in."

grep -qE '^LIVEKIT_SECRET=.+' apps/server/.env.offline ||
  fail "apps/server/.env.offline has no LIVEKIT_SECRET."

for f in certs/ximi.offline.crt certs/ximi.offline.key certs/ximi-ca.crt; do
  [[ -f "$f" ]] || fail "Missing $f (see certs/README.md)."
done

resolved="$(dscacheutil -q host -a name server.ximi.offline 2>/dev/null | awk '/ip_address/ { print $2; exit }')"
if [[ "$resolved" != "127.0.0.1" ]]; then
  echo "Warning: server.ximi.offline resolves to '${resolved:-nothing}' on this Mac, not 127.0.0.1."
  echo "         Run: scripts/set-ximi-server-ip.command 127.0.0.1"
  echo
fi

# ---- already running? -------------------------------------------------------------

PORTS=(443 4000 7880 3100 3200 3300 3400)
busy_pids() {
  for p in "${PORTS[@]}"; do lsof -nP -t -iTCP:"$p" -sTCP:LISTEN 2>/dev/null; done | sort -u
}

pids="$(busy_pids)"
if [[ -n "$pids" ]]; then
  echo "XIMI (or something else) is already using its ports:"
  for p in "${PORTS[@]}"; do
    lsof -nP -iTCP:"$p" -sTCP:LISTEN 2>/dev/null | awk -v p="$p" 'NR > 1 { printf "  port %-5s %s (pid %s)\n", p, $1, $2; exit }'
  done
  ask "Stop them and restart XIMI? [y/N] " answer
  [[ "$answer" =~ ^[Yy] ]] || fail "Not started."

  # the turbo runner from an earlier start, then whatever still holds the ports
  pkill -f "turbo run livekit:offline caddy:offline start:offline" 2>/dev/null || true
  sleep 2
  pids="$(busy_pids)"
  [[ -n "$pids" ]] && kill $pids 2>/dev/null
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [[ -z "$(busy_pids)" ]] && break
    sleep 1
  done
  [[ -z "$(busy_pids)" ]] || fail "Could not free the ports. Check: lsof -nP -iTCP -sTCP:LISTEN"
  echo "Stopped."
  echo
fi

# ---- build and start ------------------------------------------------------------------

if ((BUILD)); then
  echo "Building apps with .env.offline settings..."
  pnpm build:offline || fail "Build failed (see above)."
  echo
fi

LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || echo '?')"
cat <<EOF
Starting XIMI offline from $ROOT

  Control    https://control.ximi.offline
  Performer  https://performer.ximi.offline
  Scout      https://scout.ximi.offline
  Health     https://server.ximi.offline/health

  Performer Macs point at this server with:
    set-ximi-server-ip.command $LAN_IP

  Ctrl-C or close this window to stop.

EOF

exec pnpm offline
