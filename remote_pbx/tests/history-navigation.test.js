const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { _test } = require('../server');

test('campaign history prefers original customer over trunk caller ID after queue delivery', () => {
  for (const outcome of ['answered', 'accepted']) {
    const call = _test.compactExtensionCall({ type: 'inbound', callerId: '34999990000', source: 'trunk-2', destination: '777', userField: `dialer:dlr-test:${outcome}:34912345678` });
    assert.equal(call.customerNumber, '34912345678');
    assert.equal(call.destination, '777');
  }
  assert.equal(_test.compactExtensionCall({ type: 'inbound', callerId: '34912345678' }).customerNumber, '34912345678');
  assert.equal(_test.compactExtensionCall({ type: 'outbound', destination: '34912345678' }).customerNumber, '34912345678');
});

test('rapid navigation shares loads and briefly reuses completed report data', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const code = source.slice(source.indexOf('const tabDataRequests ='), source.indexOf('function animateTabData'));
  let resolve, requests = 0;
  let now = 10000;
  const busy = [];
  const context = { Date: { now: () => now }, pages: { reports: { setAttribute: (name, value) => busy.push(value) } }, state: { user: { username: 'admin' } }, fetchTabData: () => { requests++; return new Promise(r => { resolve = r; }); } };
  vm.runInNewContext(code, context);
  const a = context.loadTabData('reports');
  assert.equal(context.loadTabData('reports'), a);
  assert.equal(requests, 1);
  resolve(); await a;
  await context.loadTabData('reports');
  assert.equal(requests, 1);
  now += 5001;
  const b = context.loadTabData('reports');
  assert.equal(requests, 2);
  resolve(); await b;
  assert.deepEqual(busy, ['true', 'false', 'true', 'false']);
});

test('navigation animation respects reduced motion and never animates a stale menu', () => {
  const source = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
  const code = source.slice(source.indexOf('function animateTabData'), source.indexOf('async function fetchTabData'));
  let reduced = true, animations = 0;
  const context = { state: { activeTab: 'reports' }, window: { matchMedia: () => ({ matches: reduced }) }, pages: { reports: { animate: () => animations++ } } };
  vm.runInNewContext(code, context);
  context.animateTabData('reports');
  assert.equal(animations, 0);
  reduced = false;
  context.animateTabData('dialer');
  assert.equal(animations, 0);
  context.animateTabData('reports');
  assert.equal(animations, 1);
});
