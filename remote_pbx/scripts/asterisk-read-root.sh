#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  endpoints)
    /usr/sbin/asterisk -rx "pjsip show endpoints"
    ;;
  registrations)
    /usr/sbin/asterisk -rx "pjsip show registrations"
    ;;
  contacts)
    /usr/sbin/asterisk -rx "pjsip show contacts"
    ;;
  queues)
    /usr/sbin/asterisk -rx "queue show"
    ;;
  channels)
    /usr/sbin/asterisk -rx "core show channels concise"
    ;;
  *)
    echo "Uso: $0 endpoints|registrations|contacts|queues|channels" >&2
    exit 64
    ;;
esac
