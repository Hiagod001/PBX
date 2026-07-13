#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="${UAI_PBX_WATCHDOG_STATE:-/run/uai-pbx-pjsip-watchdog.overloaded}"
QUEUE_THRESHOLD="${UAI_PBX_WATCHDOG_THRESHOLD:-450}"
REQUIRED_CHECKS="${UAI_PBX_WATCHDOG_REQUIRED_CHECKS:-2}"

if ! systemctl is-active --quiet asterisk; then
  logger -t uai-pbx-watchdog "Asterisk is inactive; leaving recovery to systemd"
  exit 0
fi

taskprocessors="$(asterisk -rx "core show taskprocessors" 2>/dev/null || true)"
max_queue="$({ printf '%s\n' "$taskprocessors"; } | awk '
  $1 ~ /^pjsip\/(distributor|websocket)-/ {
    queue = $3 + 0
    if (queue > max) max = queue
  }
  END { print max + 0 }
')"

if (( max_queue < QUEUE_THRESHOLD )); then
  rm -f "$STATE_FILE"
  exit 0
fi

checks=0
if [[ -f "$STATE_FILE" ]]; then
  read -r checks < "$STATE_FILE" || checks=0
fi
checks=$((checks + 1))
printf '%s\n' "$checks" > "$STATE_FILE"
logger -t uai-pbx-watchdog "PJSIP queue overloaded: depth=$max_queue check=$checks/$REQUIRED_CHECKS"

if (( checks < REQUIRED_CHECKS )); then
  exit 0
fi

active_channels="$(asterisk -rx "core show channels count" 2>/dev/null | awk '/active channels/ { print $1; exit }')"
active_channels="${active_channels:-0}"
if (( active_channels > 0 )); then
  logger -t uai-pbx-watchdog "Recovery deferred: $active_channels active channels"
  exit 0
fi

logger -t uai-pbx-watchdog "Restarting Asterisk after repeated PJSIP overload with no active channels"
systemctl restart asterisk
rm -f "$STATE_FILE"
