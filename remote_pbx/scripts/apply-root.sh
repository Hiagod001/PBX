#!/usr/bin/env bash
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "Este helper precisa rodar como root." >&2
  exit 1
fi

PROJECT_DIR="/opt/pbx-sip-admin"
GENERATED_DIR="$PROJECT_DIR/generated/asterisk"
IVR_AUDIO_DIR="$PROJECT_DIR/data/ivr-audio"
APP_USER="${PBX_APP_USER:-$(stat -c %U "$PROJECT_DIR" 2>/dev/null || echo agenda)}"
ASTERISK_SOUND_DIRS=(
  "/var/lib/asterisk/sounds/custom"
  "/usr/share/asterisk/sounds/custom"
  "/usr/share/asterisk/sounds/en/custom"
)

install -m 0644 "$GENERATED_DIR/pjsip.conf" /etc/asterisk/pjsip.conf
install -m 0644 "$GENERATED_DIR/extensions.conf" /etc/asterisk/extensions.conf
install -m 0644 "$GENERATED_DIR/queues.conf" /etc/asterisk/queues.conf
install -m 0644 "$GENERATED_DIR/voicemail.conf" /etc/asterisk/voicemail.conf
install -m 0644 "$GENERATED_DIR/cdr.conf" /etc/asterisk/cdr.conf
install -m 0644 "$GENERATED_DIR/cdr_custom.conf" /etc/asterisk/cdr_custom.conf
install -m 0644 "$GENERATED_DIR/rtp.conf" /etc/asterisk/rtp.conf
install -m 0644 "$GENERATED_DIR/http.conf" /etc/asterisk/http.conf
install -m 0644 "$GENERATED_DIR/modules.conf" /etc/asterisk/modules.conf
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

systemctl restart fail2ban || true
systemctl restart asterisk
asterisk -rx "dialplan reload" || true
asterisk -rx "module reload app_queue.so" || true
asterisk -rx "voicemail reload" || true

echo "Configuracoes aplicadas ao Asterisk."
