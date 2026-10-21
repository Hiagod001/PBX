const test = require('node:test');
const assert = require('node:assert/strict');
const { ensurePanel } = require('../scripts/ensure-panel.cjs');

test('restores only PBX when persisted process list omitted it', async () => {
  let started;
  const pm2 = { list: cb => cb(null, [{ name: 'cameras-uai' }]), start: (options, cb) => { started = options; cb(); } };
  assert.equal(await ensurePanel(pm2, '/opt/pbx-sip-admin', '/usr/bin/node'), 'restored');
  assert.equal(started.name, 'pbx-UAI');
  assert.equal(started.cwd, '/opt/pbx-sip-admin');
  assert.equal(started.interpreter, '/usr/bin/node');
  assert.equal(started.autorestart, true);
});

test('does not duplicate running processes or override deliberate stops', async () => {
  for (const status of ['online', 'stopped', 'launching']) {
    const pm2 = { list: cb => cb(null, [{ name: 'pbx-UAI', pm2_env: { status } }]), start: () => assert.fail('unexpected restart') };
    assert.equal(await ensurePanel(pm2, '/opt/pbx-sip-admin', '/usr/bin/node'), 'present');
  }
});

test('fails closed on PM2 listing failure', async () => {
  const pm2 = { list: cb => cb(new Error('unavailable')), start: () => assert.fail('unexpected start') };
  await assert.rejects(ensurePanel(pm2, '/opt/pbx-sip-admin', '/usr/bin/node'), /unavailable/);
});
