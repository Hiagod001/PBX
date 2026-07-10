#!/usr/bin/env bash
set -euo pipefail

sudo apt update
sudo apt install -y asterisk fail2ban ufw
sudo systemctl enable --now asterisk
sudo systemctl enable --now fail2ban

echo "Asterisk e Fail2Ban instalados."
