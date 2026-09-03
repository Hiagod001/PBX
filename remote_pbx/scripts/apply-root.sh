#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Este helper precisa rodar como root." >&2
  exit 1
fi

LOCK_FILE="${PBX_ASTERISK_APPLY_LOCK:-/run/lock/uai-pbx-apply.lock}"
exec 9>"$LOCK_FILE"
if ! flock -w "${PBX_ASTERISK_APPLY_LOCK_TIMEOUT:-45}" 9; then
  echo "Outra aplicacao de configuracao do PBX ainda esta em andamento." >&2
  exit 5
fi

PROJECT_DIR="${PBX_PROJECT_DIR:-${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}}"
PROJECT_DIR="$(realpath -e "$PROJECT_DIR")"
GENERATED_DIR="$PROJECT_DIR/generated/asterisk"
IVR_AUDIO_DIR="$PROJECT_DIR/data/ivr-audio"
APP_USER="${PBX_APP_USER:-$(stat -c %U "$PROJECT_DIR" 2>/dev/null || echo agenda)}"
BACKUP_BASE="${PBX_ASTERISK_BACKUP_DIR:-/var/backups/uai-pbx/asterisk}"
BACKUP_DIR="$BACKUP_BASE/$(date +%Y%m%d-%H%M%S)"
CONFIG_FILES=(
  "pjsip.conf"
  "extensions.conf"
  "queues.conf"
  "voicemail.conf"
  "cdr.conf"
  "cdr_custom.conf"
  "rtp.conf"
  "http.conf"
  "modules.conf"
)
ASTERISK_SOUND_DIRS=(
  "/var/lib/asterisk/sounds/custom"
  "/usr/share/asterisk/sounds/custom"
  "/usr/share/asterisk/sounds/en/custom"
)

for config_file in "${CONFIG_FILES[@]}"; do
  if [ ! -s "$GENERATED_DIR/$config_file" ]; then
    echo "Configuracao gerada ausente ou vazia: $config_file" >&2
    exit 2
  fi
done

CHANGED_FILES=()
MISSING_BEFORE=()
for config_file in "${CONFIG_FILES[@]}"; do
  if [ ! -f "/etc/asterisk/$config_file" ] || ! cmp -s "$GENERATED_DIR/$config_file" "/etc/asterisk/$config_file"; then
    CHANGED_FILES+=("$config_file")
    [ -f "/etc/asterisk/$config_file" ] || MISSING_BEFORE+=("$config_file")
  fi
done

FAIL2BAN_CHANGED=0
if [ -s "$GENERATED_DIR/fail2ban-asterisk.local" ] && { [ ! -f /etc/fail2ban/jail.d/asterisk.local ] || ! cmp -s "$GENERATED_DIR/fail2ban-asterisk.local" /etc/fail2ban/jail.d/asterisk.local; }; then
  FAIL2BAN_CHANGED=1
fi

if [ "${#CHANGED_FILES[@]}" -gt 0 ] || [ "$FAIL2BAN_CHANGED" -eq 1 ]; then
  mkdir -p "$BACKUP_DIR"
  for config_file in "${CHANGED_FILES[@]}"; do
    [ -f "/etc/asterisk/$config_file" ] && cp -a "/etc/asterisk/$config_file" "$BACKUP_DIR/$config_file"
  done
  if [ "$FAIL2BAN_CHANGED" -eq 1 ] && [ -f /etc/fail2ban/jail.d/asterisk.local ]; then
    cp -a /etc/fail2ban/jail.d/asterisk.local "$BACKUP_DIR/fail2ban-asterisk.local"
  fi
fi

reload_asterisk_configs() {
  local changed=" ${CHANGED_FILES[*]} "
  if [[ "$changed" == *" modules.conf "* ]]; then
    if ! /usr/sbin/asterisk -rx "module show like pbx_spool.so" | grep -q '^pbx_spool\.so'; then
      /usr/sbin/asterisk -rx "module load pbx_spool.so"
    fi
    if ! /usr/sbin/asterisk -rx "module show like app_userevent.so" | grep -q '^app_userevent\.so'; then
      /usr/sbin/asterisk -rx "module load app_userevent.so"
    fi
  fi
  if [[ "$changed" == *" pjsip.conf "* || "$changed" == *" rtp.conf "* || "$changed" == *" http.conf "* || "$changed" == *" modules.conf "* ]]; then
    /usr/sbin/asterisk -rx "module reload res_pjsip.so"
  fi
  if [[ "$changed" == *" extensions.conf "* ]]; then
    /usr/sbin/asterisk -rx "dialplan reload"
  fi
  if [[ "$changed" == *" queues.conf "* ]]; then
    /usr/sbin/asterisk -rx "module reload app_queue.so"
  fi
  if [[ "$changed" == *" voicemail.conf "* ]]; then
    /usr/sbin/asterisk -rx "voicemail reload"
  fi
  if [[ "$changed" == *" cdr.conf "* || "$changed" == *" cdr_custom.conf "* ]]; then
    /usr/sbin/asterisk -rx "module reload cdr_custom.so"
  fi
  return 0
}

restore_previous_config() {
  echo "Restaurando configuracao anterior do Asterisk..." >&2
  for config_file in "${CHANGED_FILES[@]}"; do
    [ -f "$BACKUP_DIR/$config_file" ] && install -o root -g asterisk -m 0640 "$BACKUP_DIR/$config_file" "/etc/asterisk/$config_file"
  done
  for config_file in "${MISSING_BEFORE[@]}"; do
    [ -f "$BACKUP_DIR/$config_file" ] || rm -f -- "/etc/asterisk/$config_file"
  done
  [ -f "$BACKUP_DIR/fail2ban-asterisk.local" ] && install -m 0644 "$BACKUP_DIR/fail2ban-asterisk.local" /etc/fail2ban/jail.d/asterisk.local
  reload_asterisk_configs >/dev/null 2>&1 || systemctl restart asterisk || true
}

for config_file in "${CHANGED_FILES[@]}"; do
  install -o root -g asterisk -m 0640 "$GENERATED_DIR/$config_file" "/etc/asterisk/$config_file"
done
if [ "$FAIL2BAN_CHANGED" -eq 1 ]; then
  install -m 0644 "$GENERATED_DIR/fail2ban-asterisk.local" /etc/fail2ban/jail.d/asterisk.local
fi

mkdir -p /var/spool/asterisk/monitor /var/spool/asterisk/outgoing_done /var/log/asterisk/cdr-custom "${ASTERISK_SOUND_DIRS[@]}"
if compgen -G "$IVR_AUDIO_DIR/*" > /dev/null; then
  for sound_dir in "${ASTERISK_SOUND_DIRS[@]}"; do
    for audio_file in "$IVR_AUDIO_DIR"/*; do
      [ -e "$audio_file" ] || continue
      target_file="$sound_dir/$(basename "$audio_file")"
      if [ ! -f "$target_file" ] || ! cmp -s "$audio_file" "$target_file"; then
        install -m 0644 "$audio_file" "$target_file"
      fi
    done
    for audio_file in "$IVR_AUDIO_DIR"/*.mp3; do
      [ -e "$audio_file" ] || continue
      base_name="$(basename "$audio_file" .mp3)"
      [ -f "$sound_dir/${base_name}.wav" ] && [ "$sound_dir/${base_name}.wav" -nt "$audio_file" ] || /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -c:a pcm_s16le "$sound_dir/${base_name}.wav" >/dev/null 2>&1
      [ -f "$sound_dir/${base_name}.alaw" ] && [ "$sound_dir/${base_name}.alaw" -nt "$audio_file" ] || /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -f alaw "$sound_dir/${base_name}.alaw" >/dev/null 2>&1
      [ -f "$sound_dir/${base_name}.ulaw" ] && [ "$sound_dir/${base_name}.ulaw" -nt "$audio_file" ] || /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -f mulaw "$sound_dir/${base_name}.ulaw" >/dev/null 2>&1
      [ -f "$sound_dir/${base_name}.sln" ] && [ "$sound_dir/${base_name}.sln" -nt "$audio_file" ] || /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -c:a pcm_s16le -f s16le "$sound_dir/${base_name}.sln" >/dev/null 2>&1
    done
  done
fi
chown -R asterisk:asterisk /var/spool/asterisk/monitor /var/log/asterisk/cdr-custom "${ASTERISK_SOUND_DIRS[@]}"
chown asterisk:asterisk /var/spool/asterisk/outgoing_done
if command -v setfacl >/dev/null 2>&1 && id "$APP_USER" >/dev/null 2>&1; then
  setfacl -m "u:${APP_USER}:--x" /var/spool/asterisk
  setfacl -m "u:${APP_USER}:r-x" /var/spool/asterisk/monitor
  setfacl -R -m "u:${APP_USER}:r-X" /var/spool/asterisk/monitor
  setfacl -d -m "u:${APP_USER}:r-X" /var/spool/asterisk/monitor
  setfacl -m "u:${APP_USER}:r-x" /var/spool/asterisk/outgoing /var/spool/asterisk/outgoing_done
  setfacl -d -m "u:${APP_USER}:r-X" /var/spool/asterisk/outgoing_done
else
  chmod o+x /var/spool/asterisk
  chmod o+rx /var/spool/asterisk/monitor
  chmod o+rx /var/spool/asterisk/outgoing /var/spool/asterisk/outgoing_done
fi

reload_output="$(reload_asterisk_configs 2>&1)" || {
  echo "$reload_output" >&2
  restore_previous_config
  exit 3
}
if printf '%s' "$reload_output" | grep -Eqi 'no such command|not found|(^|[^a-z])(error|failed|invalid|unable)([^a-z]|$)'; then
  echo "$reload_output" >&2
  restore_previous_config
  exit 3
fi

if [ "${PBX_RESTART_ASTERISK_ON_APPLY:-false}" = "true" ]; then
  systemctl restart asterisk
fi
if ! /usr/sbin/asterisk -rx "core show version" >/dev/null 2>&1; then
  restore_previous_config
  systemctl restart asterisk || true
  exit 4
fi

if [ "$FAIL2BAN_CHANGED" -eq 1 ]; then
  fail2ban-client reload >/dev/null 2>&1 || true
fi
find "$BACKUP_BASE" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf -- {} + 2>/dev/null || true

if [ "${#CHANGED_FILES[@]}" -gt 0 ]; then
  echo "PBX_APPLY_CHANGED=1"
  echo "PBX_APPLY_RELOADED=1"
  echo "Configuracoes alteradas: ${CHANGED_FILES[*]}. Backup: $BACKUP_DIR"
else
  echo "PBX_APPLY_CHANGED=$FAIL2BAN_CHANGED"
  echo "PBX_APPLY_RELOADED=0"
  echo "Configuracao do Asterisk ja estava atualizada."
fi
