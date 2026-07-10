#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Este helper precisa rodar como root." >&2
  exit 1
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

mkdir -p "$BACKUP_DIR"
for config_file in "${CONFIG_FILES[@]}"; do
  [ -f "/etc/asterisk/$config_file" ] && cp -a "/etc/asterisk/$config_file" "$BACKUP_DIR/$config_file"
done
[ -f /etc/fail2ban/jail.d/asterisk.local ] && cp -a /etc/fail2ban/jail.d/asterisk.local "$BACKUP_DIR/fail2ban-asterisk.local"

restore_previous_config() {
  echo "Restaurando configuracao anterior do Asterisk..." >&2
  for config_file in "${CONFIG_FILES[@]}"; do
    [ -f "$BACKUP_DIR/$config_file" ] && install -m 0644 "$BACKUP_DIR/$config_file" "/etc/asterisk/$config_file"
  done
  [ -f "$BACKUP_DIR/fail2ban-asterisk.local" ] && install -m 0644 "$BACKUP_DIR/fail2ban-asterisk.local" /etc/fail2ban/jail.d/asterisk.local
  /usr/sbin/asterisk -rx "core reload" >/dev/null 2>&1 || true
}

for config_file in "${CONFIG_FILES[@]}"; do
  install -m 0644 "$GENERATED_DIR/$config_file" "/etc/asterisk/$config_file"
done
install -m 0644 "$GENERATED_DIR/fail2ban-asterisk.local" /etc/fail2ban/jail.d/asterisk.local

mkdir -p /var/spool/asterisk/monitor /var/log/asterisk/cdr-custom "${ASTERISK_SOUND_DIRS[@]}"
if compgen -G "$IVR_AUDIO_DIR/*" > /dev/null; then
  for sound_dir in "${ASTERISK_SOUND_DIRS[@]}"; do
    install -m 0644 "$IVR_AUDIO_DIR"/* "$sound_dir/"
    for audio_file in "$IVR_AUDIO_DIR"/*.mp3; do
      [ -e "$audio_file" ] || continue
      base_name="$(basename "$audio_file" .mp3)"
      /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -c:a pcm_s16le "$sound_dir/${base_name}.wav" >/dev/null 2>&1
      /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -f alaw "$sound_dir/${base_name}.alaw" >/dev/null 2>&1
      /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -f mulaw "$sound_dir/${base_name}.ulaw" >/dev/null 2>&1
      /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -c:a pcm_s16le -f s16le "$sound_dir/${base_name}.sln" >/dev/null 2>&1
    done
  done
fi
chown -R asterisk:asterisk /var/spool/asterisk/monitor /var/log/asterisk/cdr-custom "${ASTERISK_SOUND_DIRS[@]}"
if command -v setfacl >/dev/null 2>&1 && id "$APP_USER" >/dev/null 2>&1; then
  setfacl -m "u:${APP_USER}:--x" /var/spool/asterisk
  setfacl -m "u:${APP_USER}:r-x" /var/spool/asterisk/monitor
  setfacl -R -m "u:${APP_USER}:r-X" /var/spool/asterisk/monitor
  setfacl -d -m "u:${APP_USER}:r-X" /var/spool/asterisk/monitor
else
  chmod o+x /var/spool/asterisk
  chmod o+rx /var/spool/asterisk/monitor
fi

reload_output="$(/usr/sbin/asterisk -rx "core reload" 2>&1)" || {
  echo "$reload_output" >&2
  restore_previous_config
  exit 3
}
if printf '%s' "$reload_output" | grep -Eqi '(^|[^a-z])(error|failed|invalid|unable)([^a-z]|$)'; then
  echo "$reload_output" >&2
  restore_previous_config
  exit 3
fi

/usr/sbin/asterisk -rx "module reload app_queue.so" >/dev/null 2>&1 || true
/usr/sbin/asterisk -rx "voicemail reload" >/dev/null 2>&1 || true
if [ "${PBX_RESTART_ASTERISK_ON_APPLY:-false}" = "true" ]; then
  systemctl restart asterisk
fi
if ! /usr/sbin/asterisk -rx "core show version" >/dev/null 2>&1; then
  restore_previous_config
  systemctl restart asterisk || true
  exit 4
fi

fail2ban-client reload >/dev/null 2>&1 || true
find "$BACKUP_BASE" -mindepth 1 -maxdepth 1 -type d -mtime +30 -exec rm -rf -- {} + 2>/dev/null || true

echo "Configuracoes aplicadas ao Asterisk sem reinicio. Backup: $BACKUP_DIR"
