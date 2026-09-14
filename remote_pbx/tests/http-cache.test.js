const test = require('node:test');
const assert = require('node:assert/strict');
const { staticCacheHeaders, privateApiHeaders } = require('../src/http-cache');

test('only versioned public assets receive a reusable cache lifetime', () => {
  for (const [file, query, expected] of [
    ['app.js', { v: 'release-1' }, 'public, max-age=86400, immutable'],
    ['app.js', {}, 'public, max-age=0, must-revalidate'],
    ['index.html', { v: 'release-1' }, 'public, max-age=0, must-revalidate'],
    ['config.json', { v: 'release-1' }, 'public, max-age=0, must-revalidate']
  ]) {
    staticCacheHeaders({ req: { query }, setHeader: (key, value) => {
      assert.equal(key, 'Cache-Control'); assert.equal(value, expected);
    } }, file);
  }
});

test('authenticated API responses cannot be stored by browsers or proxies', () => {
  let continued = false;
  privateApiHeaders({}, { setHeader: (key, value) => {
    assert.equal(key, 'Cache-Control'); assert.equal(value, 'private, no-store');
  } }, () => { continued = true; });
  assert.equal(continued, true);
});
