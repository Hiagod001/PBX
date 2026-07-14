#!/usr/bin/env bash
set -euo pipefail

STATE_FILE="${UAI_PBX_WATCHDOG_STATE:-/run/uai-pbx-pjsip-watchdog.state}"
QUEUE_THRESHOLD="${UAI_PBX_WATCHDOG_THRESHOLD:-450}"
REQUIRED_OVERLOAD_CHECKS="${UAI_PBX_WATCHDOG_REQUIRED_CHECKS:-2}"
REQUIRED_STALL_CHECKS="${UAI_PBX_WATCHDOG_STALL_CHECKS:-3}"

if ! systemctl is-active --quiet asterisk; then
  logger -t uai-pbx-watchdog "Asterisk is inactive; leaving recovery to systemd"
  exit 0
fi

taskprocessors="$(asterisk -rx "core show taskprocessors" 2>/dev/null || true)"
read -r websocket_processed websocket_queued max_queue <<< "$({ printf '%s\n' "$taskprocessors"; } | awk '
  $1 ~ /^pjsip\/websocket-/ {
    processed += $2 + 0
    queued += $3 + 0
  }
  $1 ~ /^pjsip\/(distributor|websocket)-/ {
    queue = $3 + 0
    if (queue > max) max = queue
  }
  END { print processed + 0, queued + 0, max + 0 }
')"
max_socket_recv="$(ss -H -tn 2>/dev/null | awk '
  $4 ~ /:8088$/ {
    queued = $2 + 0
    if (queued > max) max = queued
  }
  END { print max + 0 }
')"
pending=$((websocket_queued + max_socket_recv))

mode=""
required_checks=0
if (( max_queue >= QUEUE_THRESHOLD )); then
  mode="overload"
  required_checks="$REQUIRED_OVERLOAD_CHECKS"
elif (( pending > 0 )); then
  mode="stalled"
  required_checks="$REQUIRED_STALL_CHECKS"
fi

if [[ -z "$mode" ]]; then
  rm -f "$STATE_FILE"
  exit 0
fi

previous_mode=""
previous_processed=0
previous_pending=0
checks=0
if [[ -f "$STATE_FILE" ]]; then
  read -r previous_mode previous_processed previous_pending checks < "$STATE_FILE" || true
fi

if [[ "$mode" == "overload" && "$previous_mode" == "overload" ]]; then
  checks=$((checks + 1))
elif [[ "$mode" == "stalled" && "$previous_mode" == "stalled" && "$websocket_processed" -eq "$previous_processed" && "$pending" -ge "$previous_pending" ]]; then
  checks=$((checks + 1))
else
  checks=1
fi
printf '%s %s %s %s\n' "$mode" "$websocket_processed" "$pending" "$checks" > "$STATE_FILE"
logger -t uai-pbx-watchdog "PJSIP $mode: max_queue=$max_queue websocket_queue=$websocket_queued socket_recv=$max_socket_recv check=$checks/$required_checks"

if (( checks < required_checks )); then
  exit 0
fi

active_channels="$(asterisk -rx "core show channels count" 2>/dev/null | awk '/active channels/ { print $1; exit }')"
active_channels="${active_channels:-0}"
if (( active_channels > 0 )); then
  logger -t uai-pbx-watchdog "Recovery deferred: $active_channels active channels"
  exit 0
fi

logger -t uai-pbx-watchdog "Restarting Asterisk after repeated PJSIP $mode with no active channels"
systemctl restart asterisk
rm -f "$STATE_FILE"
