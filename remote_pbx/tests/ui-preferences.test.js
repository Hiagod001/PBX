const test = require('node:test');
const assert = require('node:assert/strict');
const prefs = require('../public/ui-preferences');

test('preferences store only whitelisted display options and isolate users', () => {
  const data = new Map();
  const storage = { getItem: key => data.get(key), setItem: (key, value) => data.set(key, value) };
  prefs.write(storage, 'admin', { reportSize: 50, password: 'never-store', config: { secret: true } });
  assert.equal(prefs.read(storage, 'admin').reportSize, 50);
  assert.equal(prefs.read(storage, 'other').reportSize, 25);
  assert.doesNotMatch([...data.values()].join(), /password|never-store|config|secret/);
});

test('invalid values and blocked storage fall back to safe defaults', () => {
  assert.equal(prefs.clean({ reportSize: 100000 }).reportSize, 25);
  const storage = { getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); } };
  assert.equal(prefs.read(storage, 'admin').reportSize, 25);
  assert.doesNotThrow(() => prefs.write(storage, 'admin', {}));
});
