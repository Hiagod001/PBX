"""Handle one request from the web container over a private systemd socket."""
import configparser
import json
import os
import re
import socket
import sys


def ami_action(stream, **fields):
    packet = "".join(f"{name}: {value}\r\n" for name, value in fields.items()) + "\r\n"
    stream.write(packet.encode())
    response = {}
    while True:
        line = stream.readline(4096)
        if not line:
            raise ConnectionError()
        if line == b"\r\n":
            return response
        key, _, value = line.decode().partition(":")
        response[key] = value.strip()


def withdraw(request):
    queue, channel, target = (request[key] for key in ("queue", "channel", "target"))
    if not (re.fullmatch(r"[\w.-]{1,80}", queue, re.ASCII)
            and re.fullmatch(r"[A-Za-z0-9_/;@.+:-]{1,240}", channel)
            and re.fullmatch(r"[0-9]{1,16}", target)):
        return "invalid"
    account = configparser.ConfigParser()
    account.read(os.path.join(os.environ["CREDENTIALS_DIRECTORY"], "account"))
    with socket.create_connection(("127.0.0.1", 5038), timeout=3) as conn:
        with conn.makefile("rwb", buffering=0) as stream:
            if not stream.readline(256).startswith(b"Asterisk Call Manager/"):
                raise ConnectionError()
            login = ami_action(stream, Action="Login", Username="pbx-capture",
                               Secret=account["pbx-capture"]["secret"], Events="off")
            if login.get("Response") != "Success":
                return "unavailable"
            result = ami_action(stream, Action="QueueWithdrawCaller", Queue=queue,
                                Caller=channel, WithdrawInfo=target)
            if result.get("Response") == "Success":
                return "requested"
            if any(msg in result.get("Message", "") for msg in ("No such caller", "Already requested", "No such queue")):
                return "gone"
            return "unavailable"


try:
    status = withdraw(json.loads(sys.stdin.buffer.readline(1024)))
except (OSError, KeyError, ValueError, TypeError):
    status = "unavailable"
print(status, flush=True)
