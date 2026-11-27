#!/bin/bash
set -euo pipefail
root=/home/dokploy/pbx-validation
account=$root/data/asterisk-config/manager.d/pbx-capture.conf
runtime=$(docker volume inspect -f '{{.Mountpoint}}' pbx-validation-runtime)
umask 077
if [[ ! -f "$account" ]]; then
  temp=$(mktemp "${account}.XXXXXX")
  { echo '[pbx-capture]'; echo "secret=$(openssl rand -hex 32)"; echo 'deny=0.0.0.0/0'; echo 'permit=127.0.0.1/32'; echo 'read=none'; echo 'write=none'; } > "$temp"
  chown --reference="$root/data/asterisk-config/manager.conf" "$temp"
  chmod 640 "$temp"
  mv "$temp" "$account"
fi
install -m 755 "$(dirname "$0")/queue-capture.py" /usr/local/libexec/pbx-queue-capture.py
cat > /etc/systemd/system/pbx-queue-capture.socket <<EOF
[Unit]
Description=PBX waiting call capture
RequiresMountsFor=$runtime
[Socket]
ListenStream=$runtime/pbx-queue-capture.sock
SocketMode=0600
SocketUser=1001
Accept=yes
RemoveOnStop=yes
[Install]
WantedBy=sockets.target
EOF
cat > /etc/systemd/system/pbx-queue-capture@.service <<EOF
[Unit]
Description=PBX waiting call capture request
[Service]
DynamicUser=yes
StandardInput=socket
StandardOutput=socket
StandardError=journal
LoadCredential=account:$account
ExecStart=/usr/bin/python3 /usr/local/libexec/pbx-queue-capture.py
RuntimeMaxSec=8
NoNewPrivileges=yes
EOF
chmod 644 /etc/systemd/system/pbx-queue-capture{.socket,@.service}
systemctl daemon-reload
docker exec pbx-validation-jlmjrm-asterisk-1 asterisk -rx 'manager reload'
systemctl enable --now pbx-queue-capture.socket
