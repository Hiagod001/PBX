"""Local-only SSH tunnel. Authenticate interactively; verify the known host key."""
import argparse
import getpass
import select
import socketserver
import paramiko

parser = argparse.ArgumentParser()
parser.add_argument('--host', default='131.0.112.27')
parser.add_argument('--user', default='nocadmin')
parser.add_argument('--port', type=int, default=3098)
args = parser.parse_args()
ssh = paramiko.SSHClient()
ssh.load_system_host_keys()
ssh.set_missing_host_key_policy(paramiko.RejectPolicy())
password = getpass.getpass('VM password: ')
ssh.connect(args.host, username=args.user, password=password, look_for_keys=False, allow_agent=False, timeout=15)
del password
ssh.get_transport().set_keepalive(15)


class Handler(socketserver.BaseRequestHandler):
    def handle(self):
        channel = ssh.get_transport().open_channel('direct-tcpip', ('127.0.0.1', 3098), self.request.getpeername())
        try:
            while True:
                ready, _, _ = select.select([self.request, channel], [], [], 30)
                for source in ready:
                    data = source.recv(65536)
                    if not data:
                        return
                    (channel if source is self.request else self.request).sendall(data)
        finally:
            channel.close()


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


try:
    with Server(('127.0.0.1', args.port), Handler) as server:
        print(f'LAB_READY http://127.0.0.1:{args.port}', flush=True)
        server.serve_forever()
finally:
    ssh.close()
