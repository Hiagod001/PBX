const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { create, registerConfirmed, restoreTransport } = require('../public/sip-recovery');
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function timers() {
  let now = 1000, next = 0;
  const jobs = new Map();
  return {
    clock: () => now, random: () => 0,
    setTimer(fn, ms) { const id = ++next; jobs.set(id, { at: now + ms, fn }); return id; },
    clearTimer(id) { jobs.delete(id); },
    async advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...jobs].filter(([,v]) => v.at <= end).sort((a,b) => a[1].at-b[1].at)[0];
        if (!due) break;
        now = due[1].at; jobs.delete(due[0]); due[1].fn(); await flush();
      }
      now = end; await flush();
    },
    count: () => jobs.size
  };
}
function emitter() {
  const listeners = new Set();
  return { addListener: fn => listeners.add(fn), removeListener: fn => listeners.delete(fn), emit: v => [...listeners].forEach(fn => fn(v)), size: () => listeners.size };
}

test('recovery keeps retrying after long outages, with capped delay, and confirms online', async () => {
  const time = timers(), states = []; let calls = 0, online = false;
  const phone = create({ ...time, enabled: () => true, healthy: () => online, status: s => states.push(s), connect: async () => { if (++calls <= 8) throw Error('offline'); online = true; } });
  await assert.rejects(phone.start());
  await time.advance(180000);
  assert.equal(calls, 9); assert.equal(states.at(-1), 'online');
  phone.stop(); assert.equal(time.count(), 0);
});

test('concurrent checks and disconnect events share one registration', async () => {
  const time = timers(); let finish, calls = 0, online = false;
  const phone = create({ ...time, enabled: () => true, healthy: () => online, connect: () => { calls++; return new Promise(resolve => { finish = () => { online = true; resolve(); }; }); } });
  const first = phone.start(), second = phone.ensure();
  phone.schedule('transport'); phone.check('online', true); await flush();
  assert.equal(first, second); assert.equal(calls, 1);
  finish(); await first; phone.stop();
});

test('a silent broken connection is probed and forcibly reconnected after missing acknowledgement', async () => {
  const time = timers(), forces = []; let calls = 0;
  const phone = create({ ...time, enabled: () => true, healthy: () => true, probeMs: 10000, connect: async ({ force }) => { forces.push(force); if (++calls === 1) throw Error('no reply'); } });
  await phone.start(); await time.advance(10000); await time.advance(2000);
  assert.deepEqual(forces, [false, true]); phone.stop();
});

test('returning online bypasses the previous long retry delay', async () => {
  const time = timers(); let calls = 0, online = false;
  const phone = create({ ...time, enabled: () => true, healthy: () => online, connect: async () => { calls++; if (calls < 5) throw Error('offline'); online = true; } });
  await assert.rejects(phone.start()); await time.advance(17000);
  assert.equal(calls, 4); phone.check('network returned', true); await time.advance(0);
  assert.equal(calls, 5); assert.equal(online, true); phone.stop();
});

test('logout cancels retries and stale asynchronous completions cannot update another session', async () => {
  const time = timers(), states = []; let finish, online = false;
  const phone = create({ ...time, enabled: () => true, healthy: () => online, status: s => states.push(s), connect: () => new Promise(resolve => { finish = resolve; }) });
  const pending = phone.start(); await flush(); phone.stop();
  const before = states.length; finish(); await pending; await time.advance(120000);
  assert.equal(states.length, before); assert.equal(time.count(), 0);
});

test('REGISTER must receive a fresh success response even when the old local state says Registered', async () => {
  let accept; const events = emitter(); let done = false;
  const reg = { state: 'Registered', waitingChange: events, register: async options => { accept = options.requestDelegate.onAccept; } };
  const pending = registerConfirmed(reg).then(() => { done = true; });
  await flush(); assert.equal(done, false); accept(); await pending; assert.equal(done, true); assert.equal(events.size(), 0);
});

test('registration rejection and missing responses fail, while an existing pending REGISTER is reused', async () => {
  const events = emitter();
  await assert.rejects(registerConfirmed({ state: 'Registered', waitingChange: events, register: async () => {} }, { timeoutMs: 5 }), /não confirmou/);
  await assert.rejects(registerConfirmed({ waitingChange: events, register: async o => o.requestDelegate.onReject() }), /recusou/);
  const reg = { state: 'Unregistered', waiting: true, waitingChange: events, register: () => assert.fail('duplicate REGISTER') };
  const pending = registerConfirmed(reg); reg.state = 'Registered'; events.emit(false); await pending; assert.equal(events.size(), 0);
});

test('transport recovery preserves the same user agent and active call instead of stopping either', async () => {
  const call = { media: 'live' }, actions = [];
  const ua = { state: 'Started', call, stop: () => assert.fail('must preserve calls'), transport: { state: 'Connected', disconnect: async () => { actions.push('disconnect'); ua.transport.state = 'Disconnected'; } }, reconnect: async () => { actions.push('reconnect'); ua.transport.state = 'Connected'; } };
  await restoreTransport(ua, { force: true }); assert.deepEqual(actions, ['disconnect', 'reconnect']); assert.equal(ua.call, call);
  await assert.rejects(restoreTransport(ua, { valid: () => false }), /cancelada/);
});

test('the distributed phone loads recovery and matches the launcher copy when available', () => {
  const appRoot = path.join(__dirname, '..');
  assert.match(fs.readFileSync(path.join(appRoot, 'public/index.html'), 'utf8'), /script src="\/sip-recovery\.js/);
  const launcher = path.join(appRoot, '../uai-pbx-ramal/src');
  if (fs.existsSync(launcher)) {
    assert.equal(fs.readFileSync(path.join(appRoot, 'public/sip-recovery.js'), 'utf8'), fs.readFileSync(path.join(launcher, 'sip-recovery.js'), 'utf8'));
    assert.match(fs.readFileSync(path.join(launcher, 'renderer.html'), 'utf8'), /script src="sip-recovery\.js/);
    const app = fs.readFileSync(path.join(launcher, 'renderer.js'), 'utf8');
    assert.doesNotMatch(app, /aguardando encerramento da chamada/);
    assert.match(app, /sipRecovery\.check\("computador retomado", true\)/);
  }
});