#!/bin/bash
#
# Point this Mac's *.ximi.offline hostnames at the XIMI offline server.
#
# Use on performer/scout/control Macs whenever the server's IP changes.
# Double-click in Finder, or run from Terminal:
#
#   scripts/set-ximi-server-ip.command                 # asks for the IP
#   scripts/set-ximi-server-ip.command 192.168.1.20    # sets it directly
#   scripts/set-ximi-server-ip.command 127.0.0.1       # on the server Mac itself
#   scripts/set-ximi-server-ip.command --remove        # remove the entries
#
# Only the block between the "ximi offline" markers in /etc/hosts is touched.
# A backup of the previous file is kept at /etc/hosts.ximi-backup.

set -euo pipefail

# Must match the names in certs/ximi.offline.ext
HOSTNAMES="control.ximi.offline performer.ximi.offline scout.ximi.offline output.ximi.offline server.ximi.offline livekit.ximi.offline turn.ximi.offline"

BEGIN_MARK="# >>> ximi offline (managed by set-ximi-server-ip.command)"
END_MARK="# <<< ximi offline"

# HOSTS_FILE can be overridden for testing; DNS caches are only flushed for the real one
HOSTS_FILE="${HOSTS_FILE:-/etc/hosts}"

# Set when the IP was typed at the prompt (always the case when double-clicked
# in Finder): keep the Terminal window open at the end so the result is readable.
XIMI_PROMPTED="${XIMI_PROMPTED:-}"

pause_if_double_clicked() {
  if [[ -n "$XIMI_PROMPTED" && -t 0 ]]; then
    read -r -p "Press Return to close." _ || true
  fi
}

fail() {
  echo "Error: $*" >&2
  pause_if_double_clicked
  exit 1
}

valid_ipv4() {
  local ip=$1 IFS=.
  local -a parts
  [[ $ip =~ ^[0-9]{1,3}(\.[0-9]{1,3}){3}$ ]] || return 1
  read -r -a parts <<<"$ip"
  for p in "${parts[@]}"; do
    ((10#$p <= 255)) || return 1
  done
}

current_ip() {
  awk -v b="$BEGIN_MARK" -v e="$END_MARK" '
    $0 == b { inside = 1; next }
    $0 == e { inside = 0 }
    inside && $1 !~ /^#/ { print $1; exit }
  ' "$HOSTS_FILE"
}

# ---- read the IP (argument or prompt) ---------------------------------------

ARG="${1:-}"
if [[ -z "$ARG" ]]; then
  CURRENT="$(current_ip || true)"
  echo "XIMI offline server address for this Mac"
  [[ -n "$CURRENT" ]] && echo "Currently: $CURRENT"
  read -r -p "New server IP (e.g. 192.168.1.20, or 127.0.0.1 on the server itself): " ARG
  ARG="${ARG//[[:space:]]/}"
  XIMI_PROMPTED=1
fi

if [[ "$ARG" != "--remove" ]] && ! valid_ipv4 "$ARG"; then
  fail "'$ARG' is not an IPv4 address like 192.168.1.20"
fi

# ---- get admin rights for /etc/hosts -----------------------------------------

if [[ ! -w "$HOSTS_FILE" ]]; then
  echo "Admin password needed to edit $HOSTS_FILE"
  exec sudo XIMI_PROMPTED="$XIMI_PROMPTED" HOSTS_FILE="$HOSTS_FILE" "$0" "$ARG"
fi

# ---- rewrite the managed block -----------------------------------------------

[[ "$HOSTS_FILE" == /etc/hosts ]] && cp -p "$HOSTS_FILE" /etc/hosts.ximi-backup

TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

# everything except an existing managed block
awk -v b="$BEGIN_MARK" -v e="$END_MARK" '
  $0 == b { skip = 1; next }
  $0 == e { skip = 0; next }
  !skip { print }
' "$HOSTS_FILE" >"$TMP"

if [[ "$ARG" != "--remove" ]]; then
  # keep one blank line before the block
  [[ -n "$(tail -c 1 "$TMP")" ]] && echo >>"$TMP"
  {
    echo "$BEGIN_MARK"
    echo "$ARG $HOSTNAMES"
    echo "$END_MARK"
  } >>"$TMP"
fi

# write in place so /etc/hosts keeps its owner and permissions
cat "$TMP" >"$HOSTS_FILE"

# ---- apply immediately ----------------------------------------------------------

if [[ "$HOSTS_FILE" == /etc/hosts ]]; then
  dscacheutil -flushcache
  killall -HUP mDNSResponder 2>/dev/null || true
fi

if [[ "$ARG" == "--remove" ]]; then
  echo "Removed the XIMI offline entries from $HOSTS_FILE."
else
  echo "Done: *.ximi.offline -> $ARG"
  if [[ "$HOSTS_FILE" == /etc/hosts ]]; then
    RESOLVED="$(dscacheutil -q host -a name control.ximi.offline 2>/dev/null | awk '/ip_address/ { print $2; exit }')"
    echo "Check: control.ximi.offline resolves to ${RESOLVED:-?}"
  fi
  echo
  echo "Next:"
  echo " - Reload any open XIMI tabs (browsers cache addresses for about a minute)."
  if [[ "$ARG" != "127.0.0.1" ]]; then
    echo " - On the server Mac: if its IP changed, restart LiveKit there, or"
    echo "   audio/video won't connect even though pages load."
  fi
fi

pause_if_double_clicked
