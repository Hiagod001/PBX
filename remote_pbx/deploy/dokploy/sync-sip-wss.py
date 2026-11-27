#!/usr/bin/env python3
"""Publish the PBX WebSocket admission policy to Traefik's watched directory."""
import ipaddress
import json
import os
from pathlib import Path
import stat
import sys
import tempfile

CONFIG = Path("/etc/dokploy/pbx-validation/data/app/config.json")
TARGET = Path("/etc/dokploy/traefik/dynamic/pbx-sip-networks.yml")


def policy(values):
    if not isinstance(values, list):
        raise ValueError("A lista de redes SIP é inválida.")
    sources = []
    for value in values:
        if not isinstance(value, str) or "%" in value:
            raise ValueError("Rede SIP inválida.")
        cidr = str(ipaddress.ip_network(value.strip(), strict=False))
        if cidr not in sources:
            sources.append(cidr)
    router = {
        "rule": "(Host(`uaipbx.uaitelecom.com.br`) || Host(`pbx-teste.131.0.112.27.sslip.io`)) && PathPrefix(`/ws`)",
        "priority": 210,
        "entryPoints": ["websecure"],
        "tls": {"certResolver": "letsencrypt"},
        "service": "noop@internal",
    }
    http = {"routers": {"pbx-sip-networks": router}}
    if sources:
        router.update(service="pbx-validation@docker", middlewares=["pbx-sip-networks"])
        http["middlewares"] = {"pbx-sip-networks": {"ipAllowList": {"sourceRange": sources}}}
    return {"http": http}


def publish(document, target):
    content = json.dumps(document, indent=2) + "\n"  # JSON is also valid YAML.
    if target.exists() and target.read_text() == content:
        return
    fd, name = tempfile.mkstemp(dir=target.parent, suffix=".tmp")
    temp = Path(name)
    try:
        with os.fdopen(fd, "w") as f:
            f.write(content)
            f.flush()
            os.fsync(f.fileno())
            os.fchmod(f.fileno(), 0o644)
        os.replace(temp, target)
    finally:
        temp.unlink(missing_ok=True)


def main():
    try:
        with os.fdopen(os.open(CONFIG, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)) as f:
            if not stat.S_ISREG(os.fstat(f.fileno()).st_mode):
                raise ValueError("Configuração do PBX inválida.")
            document = policy(json.load(f)["security"]["allowedSipNetworks"])
    except (OSError, KeyError, TypeError, ValueError):
        publish(policy([]), TARGET)
        print("Configuração SIP indisponível ou inválida. Novos registros WebSocket bloqueados.", file=sys.stderr)
        return 1
    publish(document, TARGET)
    return 0


if __name__ == "__main__":
    sys.exit(main())
