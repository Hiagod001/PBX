#!/usr/bin/env bash
set -euo pipefail

pkill -f "node server.js" || true
echo "PBX SIP Admin parado."
