#!/usr/bin/env bash
set -euo pipefail

SIP_PORT="${SIP_PORT:-5060}"
RTP_START="${RTP_START:-10000}"
RTP_END="${RTP_END:-20000}"

sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full'
sudo ufw allow "${SIP_PORT}/udp"
sudo ufw allow "${SIP_PORT}/tcp"
sudo ufw allow "${RTP_START}:${RTP_END}/udp"
sudo ufw --force enable
sudo ufw status numbered
