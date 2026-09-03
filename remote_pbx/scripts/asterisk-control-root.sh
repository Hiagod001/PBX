#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
EXTENSION="${2:-}"
VALUE="${3:-}"
EXTRA="${4:-}"
MODE="${5:-listen}"

if ! [[ "$EXTENSION" =~ ^[0-9]{2,8}$ ]]; then
  echo "Ramal invalido." >&2
  exit 2
fi

channel_belongs_to_extension() {
  local channel="$1"
  /usr/sbin/asterisk -rx "core show channels concise" | awk -F'!' -v channel="$channel" -v ext="$EXTENSION" '
    $1 == channel { requested_linked = $NF }
    $1 ~ ("^(PJSIP/(web-)?" ext "[-/]|Local/" ext "@)") { owned[$NF] = 1; if ($1 == channel) direct = 1 }
    END { exit !(direct || (requested_linked != "" && owned[requested_linked])) }
  '
}

case "$ACTION" in
  queue-pause)
    /usr/sbin/asterisk -rx "queue pause member Local/${EXTENSION}@queue-member/n"
    /usr/sbin/asterisk -rx "queue pause member PJSIP/${EXTENSION}" >/dev/null 2>&1 || true
    /usr/sbin/asterisk -rx "queue pause member PJSIP/web-${EXTENSION}" >/dev/null 2>&1 || true
    ;;
  queue-unpause)
    /usr/sbin/asterisk -rx "queue unpause member Local/${EXTENSION}@queue-member/n"
    /usr/sbin/asterisk -rx "queue unpause member PJSIP/${EXTENSION}" >/dev/null 2>&1 || true
    /usr/sbin/asterisk -rx "queue unpause member PJSIP/web-${EXTENSION}" >/dev/null 2>&1 || true
    ;;
  hangup)
    CHANNEL="${VALUE:-}"
    if [[ -z "$CHANNEL" ]]; then
      /usr/sbin/asterisk -rx "core show channels concise" \
        | awk -F'!' -v ext="$EXTENSION" '$1 ~ ("^(PJSIP/(web-)?" ext "[-/]|Local/" ext "@)") { print $1 }' \
        | while IFS= read -r MATCHED_CHANNEL; do
            [[ -n "$MATCHED_CHANNEL" ]] && /usr/sbin/asterisk -rx "channel request hangup ${MATCHED_CHANNEL//\"/}"
          done
      exit 0
    fi
    if ! channel_belongs_to_extension "$CHANNEL"; then
      echo "Canal invalido para este ramal." >&2
      exit 2
    fi
    /usr/sbin/asterisk -rx "channel request hangup ${CHANNEL//\"/}"
    ;;
  hangup-admin)
    CHANNEL="${VALUE:-}"
    if [[ -z "$CHANNEL" || "$CHANNEL" == *'"'* || "$CHANNEL" == *';'* || "$CHANNEL" == *'`'* ]]; then
      echo "Canal invalido." >&2
      exit 2
    fi
    /usr/sbin/asterisk -rx "channel request hangup ${CHANNEL}"
    ;;
  redirect)
    CHANNEL="${VALUE:-}"
    TARGET="$(printf '%s' "${EXTRA:-}" | tr -cd '[:digit:]#*')"
    if [[ -z "$CHANNEL" || "$CHANNEL" == *'"'* || "$CHANNEL" == *';'* || "$CHANNEL" == *'`'* || ! "$TARGET" =~ ^[0-9#*]{2,20}$ ]]; then
      echo "Canal ou destino invalido." >&2
      exit 2
    fi
    if [[ "$EXTENSION" != "00" ]] && ! channel_belongs_to_extension "$CHANNEL"; then
      echo "Canal invalido para este ramal." >&2
      exit 2
    fi
    /usr/sbin/asterisk -rx "channel redirect ${CHANNEL} internal,${TARGET},1"
    ;;
  spy)
    TARGET="$(printf '%s' "${VALUE:-}" | tr -cd '[:alnum:]_-')"
    if [[ -z "$TARGET" || ! "$TARGET" =~ ^(web-)?[0-9]{2,8}$ ]]; then
      echo "Ramal monitorado invalido." >&2
      exit 2
    fi
    /usr/sbin/asterisk -rx "channel originate Local/${EXTENSION}@internal application ChanSpy PJSIP/${TARGET},q"
    ;;
  spy-browser)
    TARGET="$(printf '%s' "${VALUE:-}" | tr -cd '[:alnum:]_-')"
    LISTENER="$(printf '%s' "${EXTRA:-}" | tr -cd '[:alnum:]_-')"
    MODE="$(printf '%s' "${MODE:-listen}" | tr '[:upper:]' '[:lower:]' | tr -cd '[:alpha:]-')"
    if [[ -z "$TARGET" || ! "$TARGET" =~ ^(web-)?[0-9]{2,8}$ || -z "$LISTENER" || ! "$LISTENER" =~ ^[a-zA-Z0-9_-]{3,40}$ ]]; then
      echo "Escuta do navegador invalida." >&2
      exit 2
    fi
    case "$MODE" in
      listen) SPY_OPTIONS="qbES" ;;
      whisper) SPY_OPTIONS="qwbES" ;;
      barge) SPY_OPTIONS="qBbES" ;;
      *)
        echo "Modo de monitoramento invalido." >&2
        exit 2
        ;;
    esac
    if ! /usr/sbin/asterisk -rx "core show application ChanSpy" >/dev/null 2>&1; then
      echo "Modulo ChanSpy indisponivel." >&2
      exit 3
    fi
    /usr/sbin/asterisk -rx "channel originate PJSIP/${LISTENER} application ChanSpy PJSIP/${TARGET},${SPY_OPTIONS}"
    ;;
  originate)
    TARGET="$(printf '%s' "${VALUE:-}" | tr -cd '[:digit:]#*')"
    if [[ -z "$TARGET" || ! "$TARGET" =~ ^[0-9#*]{2,20}$ ]]; then
      echo "Numero de destino invalido." >&2
      exit 2
    fi
    /usr/sbin/asterisk -rx "channel originate PJSIP/web-${EXTENSION} extension ${TARGET}@from-${EXTENSION}"
    ;;
  dialer-call)
    APP_DIR="$(find /home/agenda -maxdepth 3 -type d -name PBX | head -n 1)"
    BASE_DIR="$(realpath -m "${APP_DIR}/data/dialer-outgoing")"
    CALLFILE="$(realpath -m "${VALUE:-}")"
    if [[ -z "$APP_DIR" || ! -f "$CALLFILE" || "$CALLFILE" != "$BASE_DIR"/*.call ]]; then
      echo "Arquivo de discador invalido." >&2
      exit 2
    fi
    DEST="/var/spool/asterisk/outgoing/$(basename "$CALLFILE")"
    TMP="$(mktemp /var/spool/asterisk/.dialer.XXXXXX)"
    APP_USER="$(stat -c %U "$APP_DIR")"
    install -o asterisk -g asterisk -m 0640 "$CALLFILE" "$TMP"
    if command -v setfacl >/dev/null 2>&1 && id "$APP_USER" >/dev/null 2>&1; then
      setfacl -m "u:${APP_USER}:r--" "$TMP"
    fi
    mv "$TMP" "$DEST"
    rm -f "$CALLFILE"
    ;;
  *)
    echo "Acao invalida." >&2
    exit 2
    ;;
esac
