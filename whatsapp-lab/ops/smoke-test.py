"""Run inside the VM. Checks auth/QR/call guards without placing a call."""
import http.cookiejar
import json
import pathlib
import urllib.error
import urllib.parse
import urllib.request

BASE = 'http://127.0.0.1:3098'
client = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def request(path, data=None, action=False):
    headers = {'x-lab-action': '1'} if action else {}
    if data is not None:
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
    req = urllib.request.Request(BASE + path, None if data is None else urllib.parse.urlencode(data).encode(), headers)
    try:
        with client.open(req, timeout=10) as response:
            return response.status, response.headers, response.read()
    except urllib.error.HTTPError as response:
        return response.code, response.headers, response.read()


assert request('/healthz')[0] == 200
for path in ('/api/status', '/api/qr'):
    assert request(path)[0] == 401, path
for path in ('/api/call', '/api/hangup'):
    assert request(path, {}, True)[0] == 401, path
assert request('/api/login', {'password': 'invalid-test-key'})[0] == 401
secret = pathlib.Path('/home/dokploy/whatsapp-lab/admin-secret').read_text().strip()
code, headers, _ = request('/api/login', {'password': secret})
del secret
assert code == 204
assert 'HttpOnly' in headers.get('Set-Cookie', '')
assert 'SameSite=Strict' in headers.get('Set-Cookie', '')
code, _, body = request('/api/status')
assert code == 200
status = json.loads(body)
assert 'secret' not in status and 'qr' not in status
assert request('/api/call', {})[0] == 401, 'Missing action header must be rejected'
if status['connection'] != 'connected':
    assert request('/api/call', {}, True)[0] == 409, 'Unpaired account must never start a call'
if status['connection'] == 'pairing':
    code, headers, body = request('/api/qr')
    assert code == 200 and 'image/svg+xml' in headers.get('Content-Type', '') and b'<svg' in body
assert request('/api/logout', {}, True)[0] == 204
assert request('/api/status')[0] == 401
print('PASS: health, restricted endpoints, login, cookie, CSRF, pairing guard, QR and logout; no call placed.')
