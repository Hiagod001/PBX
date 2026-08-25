#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."

npm run generate
APP_USER="${PBX_APP_USER:-${SUDO_USER:-$(id -un)}}"

sudo install -o root -g asterisk -m 0640 generated/asterisk/pjsip.conf /etc/asterisk/pjsip.conf
sudo install -o root -g asterisk -m 0640 generated/asterisk/extensions.conf /etc/asterisk/extensions.conf
sudo install -o root -g asterisk -m 0640 generated/asterisk/queues.conf /etc/asterisk/queues.conf
sudo install -o root -g asterisk -m 0640 generated/asterisk/voicemail.conf /etc/asterisk/voicemail.conf
sudo install -o root -g asterisk -m 0640 generated/asterisk/cdr.conf /etc/asterisk/cdr.conf
sudo install -o root -g asterisk -m 0640 generated/asterisk/cdr_custom.conf /etc/asterisk/cdr_custom.conf
sudo install -o root -g asterisk -m 0640 generated/asterisk/rtp.conf /etc/asterisk/rtp.conf
sudo install -o root -g asterisk -m 0640 generated/asterisk/modules.conf /etc/asterisk/modules.conf
sudo install -m 0644 generated/asterisk/fail2ban-asterisk.local /etc/fail2ban/jail.d/asterisk.local

ASTERISK_SOUND_DIRS=(
  "/var/lib/asterisk/sounds/custom"
  "/usr/share/asterisk/sounds/custom"
  "/usr/share/asterisk/sounds/en/custom"
)

sudo mkdir -p /var/spool/asterisk/monitor
sudo mkdir -p /var/log/asterisk/cdr-custom
sudo mkdir -p "${ASTERISK_SOUND_DIRS[@]}"
if compgen -G "data/ivr-audio/*" > /dev/null; then
  for sound_dir in "${ASTERISK_SOUND_DIRS[@]}"; do
    sudo install -m 0644 data/ivr-audio/* "$sound_dir/"
    for audio_file in data/ivr-audio/*.mp3; do
      [ -e "$audio_file" ] || continue
      base_name="$(basename "$audio_file" .mp3)"
      sudo /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -c:a pcm_s16le "$sound_dir/${base_name}.wav" >/dev/null 2>&1
      sudo /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -f alaw "$sound_dir/${base_name}.alaw" >/dev/null 2>&1
      sudo /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -f mulaw "$sound_dir/${base_name}.ulaw" >/dev/null 2>&1
      sudo /usr/bin/ffmpeg -y -i "$audio_file" -ac 1 -ar 8000 -c:a pcm_s16le -f s16le "$sound_dir/${base_name}.sln" >/dev/null 2>&1
    done
  done
fi
sudo chown -R asterisk:asterisk /var/spool/asterisk/monitor
sudo chown -R asterisk:asterisk /var/log/asterisk/cdr-custom
sudo chown -R asterisk:asterisk "${ASTERISK_SOUND_DIRS[@]}"
if command -v setfacl >/dev/null 2>&1; then
  sudo setfacl -m "u:${APP_USER}:--x" /var/spool/asterisk
  sudo setfacl -m "u:${APP_USER}:r-x" /var/spool/asterisk/monitor
  sudo setfacl -R -m "u:${APP_USER}:r-X" /var/spool/asterisk/monitor
  sudo setfacl -d -m "u:${APP_USER}:r-X" /var/spool/asterisk/monitor
else
  sudo chmod o+x /var/spool/asterisk
  sudo chmod o+rx /var/spool/asterisk/monitor
fi

sudo systemctl restart fail2ban || true
if ! PJSIP_RELOAD_OUTPUT="$(sudo asterisk -rx "module reload res_pjsip.so" 2>&1)"; then
  printf '%s\n' "$PJSIP_RELOAD_OUTPUT" >&2
  sudo systemctl restart asterisk
elif printf '%s' "$PJSIP_RELOAD_OUTPUT" | grep -Eqi 'no such command|not found|error|failed|invalid|unable'; then
  printf '%s\n' "$PJSIP_RELOAD_OUTPUT" >&2
  sudo systemctl restart asterisk
fi
sudo asterisk -rx "dialplan reload" || true
sudo asterisk -rx "module reload app_queue.so" || true
sudo asterisk -rx "voicemail reload" || true

echo "Configuracoes aplicadas ao Asterisk."
