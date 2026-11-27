const test = require('node:test'), assert = require('node:assert/strict'), { EventEmitter } = require('node:events');
const { createUpdateManager } = require('../src/update-manager');
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
test('phone updates block calls and assisted transfers, while a reconnecting idle phone can still update', () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/renderer.js'), 'utf8');
  const context = { PhoneState: require('../src/phone-state'), state: { softphoneStarting: Promise.resolve() }, assistedTransfer: { phase: 'idle' } };
  vm.runInNewContext(source.slice(source.indexOf('function updateIsBusy('), source.indexOf('function showUpdateStatus(')), context);
  assert.equal(context.updateIsBusy(), false);
  context.state.callPending = true; assert.equal(context.updateIsBusy(), true);
  context.state.callPending = false; context.state.session = {}; assert.equal(context.updateIsBusy(), true);
  context.state.session = null; context.assistedTransfer.phase = 'consulting'; assert.equal(context.updateIsBusy(), true);
});
test('preparing an update can stop an already terminated registration without an unregister exception', async () => {
  const fs = require('node:fs'), vm = require('node:vm');
  const source = fs.readFileSync(require.resolve('../src/renderer.js'), 'utf8'); let stopped = 0;
  const context = { state: { sipGeneration: 1, registerer: { state: 'Terminated', unregister() { assert.fail('Terminated registration must not unregister'); } }, ua: { async stop() { stopped++; } } }, finishSipOperation: async (_label, pending) => pending };
  vm.runInNewContext(source.slice(source.indexOf('async function disposeSipStack('), source.indexOf('async function startSoftphone(')), context);
  await context.disposeSipStack(true); assert.equal(stopped, 1); assert.equal(context.state.ua, null); assert.equal(context.state.registerer, null); assert.equal(context.state.sipGeneration, 2);
});
function fixture(overrides = {}) {
  let now = 100000, installs = 0, prepares = 0, timers = new Map(), next = 0;
  const updater = Object.assign(new EventEmitter(), { checkForUpdates: async () => {}, quitAndInstall: (silent, restart) => { assert.equal(silent, true); assert.equal(restart, true); installs++; } });
  const manager = createUpdateManager({ updater, clock: () => now, setTimer: (fn, ms) => { const id = ++next; timers.set(id, { at: now + ms, fn }); return id; }, clearTimer: id => timers.delete(id), prepare: async () => { prepares++; return true; }, ...overrides });
  manager.start();
  const advance = async ms => { const end = now + ms; for (;;) { const due = [...timers].filter(([,v]) => v.at <= end).sort((a,b) => a[1].at - b[1].at)[0]; if (!due) break; now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush(); } now = end; await flush(); };
  return { updater, manager, advance, installs: () => installs, prepares: () => prepares };
}
test('downloads automatically but never installs on an uncontrolled app quit', () => {
  const f = fixture(); assert.equal(f.updater.autoDownload, true); assert.equal(f.updater.autoInstallOnAppQuit, false); assert.equal(f.updater.allowDowngrade, false); f.manager.stop();
});
test('busy, unknown and stale phone activity prevent installation', async () => {
  const f = fixture(); f.updater.emit('update-downloaded', { version: '1.0.14' });
  assert.equal(await f.manager.install(), false); f.manager.activity({ busy: true }); assert.equal(await f.manager.install(), false);
  f.manager.activity({ busy: false }); await f.advance(11000); assert.equal(await f.manager.install(), false); assert.equal(f.prepares(), 0); f.manager.stop();
});
test('only stable idle time allows automatic installation, after both independent call checks', async () => {
  let serverChecks = 0, marked = 0;
  const f = fixture({ serverIdle: async () => { serverChecks++; return true; }, beforeInstall: async () => { marked++; } });
  f.updater.emit('update-downloaded', { version: '1.0.14' });
  for (let i = 0; i < 65; i++) { f.manager.activity({ busy: false }); await f.advance(1000); }
  assert.equal(f.installs(), 1); assert.equal(serverChecks, 1); assert.equal(marked, 1); assert.equal(f.prepares(), 1); f.manager.stop();
});
test('an incoming call during the server check prevents installation', async () => {
  let resolve; const f = fixture({ serverIdle: () => new Promise(done => { resolve = done; }) });
  f.updater.emit('update-downloaded', { version: '1.0.14' }); f.manager.activity({ busy: false });
  const pending = f.manager.install(); f.manager.activity({ busy: true }); resolve(true);
  assert.equal(await pending, false); assert.equal(f.prepares(), 0); assert.equal(f.installs(), 0); f.manager.stop();
});
test('a final renderer refusal or unavailable server leaves the app running', async () => {
  for (const overrides of [{ prepare: async () => false }, { serverIdle: async () => false }, { serverIdle: async () => { throw Error('network'); } }]) {
    const f = fixture(overrides); f.updater.emit('update-downloaded', { version: '1.0.14' }); f.manager.activity({ busy: false });
    assert.equal(await f.manager.install(), false); assert.equal(f.installs(), 0); f.manager.stop();
  }
});
test('shutdown during update preparation cancels installation', async () => {
  let resolve, cancelled = 0; const f = fixture({ prepare: () => new Promise(done => { resolve = done; }), cancelPrepare: () => { cancelled++; } });
  f.updater.emit('update-downloaded', { version: '1.0.14' }); f.manager.activity({ busy: false });
  const pending = f.manager.install(); await flush(); f.manager.stop(); resolve(true);
  assert.equal(await pending, false); assert.equal(f.installs(), 0); assert.equal(cancelled, 1);
});
test('a failed partial preparation resumes the phone, and shutdown while persisting the restart marker still prevents installation', async () => {
  let cancelled = 0;
  const failed = fixture({ prepare: async () => false, cancelPrepare: () => { cancelled++; } });
  failed.updater.emit('update-downloaded', { version: '1.0.14' }); failed.manager.activity({ busy: false });
  assert.equal(await failed.manager.install(), false); assert.equal(cancelled, 1); failed.manager.stop();
  let shutdown;
  const f = fixture({ beforeInstall: async () => shutdown(), cancelPrepare: () => { cancelled++; } });
  shutdown = () => f.manager.stop();
  f.updater.emit('update-downloaded', { version: '1.0.14' }); f.manager.activity({ busy: false });
  assert.equal(await f.manager.install(), false); assert.equal(f.installs(), 0); assert.equal(cancelled, 2);
});
test('simultaneous update checks and install clicks share their operation', async () => {
  let finish, checks = 0; const f = fixture(); f.updater.checkForUpdates = () => { checks++; return new Promise(done => { finish = done; }); };
  const first = f.manager.check(), second = f.manager.check(); assert.equal(first, second); await flush(); assert.equal(checks, 1); finish(); await first;
  f.updater.emit('update-downloaded', { version: '1.0.14' }); f.manager.activity({ busy: false });
  await Promise.all([f.manager.install(), f.manager.install()]); assert.equal(f.installs(), 1); f.manager.stop();
});
test('installer errors release the prepared phone and keep the downloaded update for another attempt', async () => {
  let cancelled = 0; const f = fixture({ cancelPrepare: () => { cancelled++; } });
  f.updater.emit('update-downloaded', { version: '1.0.14' }); f.manager.activity({ busy: false }); await f.manager.install();
  f.updater.emit('error', Error('spawn failed')); await flush(); assert.equal(cancelled, 1); assert.equal(f.manager.getState().phase, 'ready'); f.manager.stop();
});
