const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

test('transfer ownership uses shared LinkedID and rejects unrelated or ended calls', { skip: process.platform === 'win32' }, () => {
  const source = fs.readFileSync(path.join(__dirname, '../scripts/asterisk-control-root.sh'), 'utf8');
  const functions = source.slice(source.indexOf('channel_belongs_to_extension()'), source.indexOf('\ncase "$ACTION"'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pbx-transfer-test-'));
  try {
    const script = path.join(dir, 'test.sh');
    const fixture = `
set -euo pipefail
EXTENSION=705
mock_asterisk() {
  case "$2" in
    'core show channels concise')
      printf '%s\\n' 'PJSIP/trunk-operadora-000000be!Up!1789390000.1' 'PJSIP/web-705-000000bf!Up!1789390000.2' 'PJSIP/999-000000c0!Up!1789390000.3'
      ;;
    'core show channel PJSIP/trunk-operadora-000000be') echo 'LinkedID: shared-call' ;;
    'core show channel PJSIP/web-705-000000bf') echo 'LinkedID: shared-call' ;;
    'core show channel PJSIP/999-000000c0') echo 'LinkedID: unrelated-call' ;;
    *) return 1 ;;
  esac
}
${functions.replaceAll('/usr/sbin/asterisk', 'mock_asterisk')}
channel_belongs_to_extension PJSIP/trunk-operadora-000000be
channel_belongs_to_extension PJSIP/web-705-000000bf
if channel_belongs_to_extension PJSIP/999-000000c0; then exit 10; fi
if channel_belongs_to_extension PJSIP/missing-000000ff; then exit 11; fi
EXTENSION=70
if channel_belongs_to_extension PJSIP/trunk-operadora-000000be; then exit 12; fi
EXTENSION=999
if channel_belongs_to_extension PJSIP/trunk-operadora-000000be; then exit 13; fi
`;
    fs.writeFileSync(script, fixture);
    const result = spawnSync('bash', [script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
