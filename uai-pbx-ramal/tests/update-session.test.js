const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const { updateSession } = require('../src/update-session');
test('only a recent genuine upgrade may resume the existing server session, without storing credentials', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'pbx-update-session-'));
  try {
    let now = 1000;
    const old = updateSession(dir, '1.0.13', () => now), next = updateSession(dir, '1.0.14', () => now);
    await old.mark(true); assert.deepEqual(Object.keys(JSON.parse(await fs.readFile(path.join(dir, 'pending-update-session.json'), 'utf8'))).sort(), ['at','loggedIn','version']);
    assert.equal(await old.consume(), false);
    await old.mark(true); assert.equal(await next.consume(), true); assert.equal(await next.consume(), false);
    await old.mark(false); assert.equal(await next.consume(), false);
    await old.mark(true); now += 900001; assert.equal(await next.consume(), false);
    await fs.writeFile(path.join(dir, 'pending-update-session.json'), 'broken'); assert.equal(await next.consume(), false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
