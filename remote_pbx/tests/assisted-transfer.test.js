const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../public/assisted-transfer');

function fixture() {
  const calls = [], states = [], audio = [];
  let next;
  const original = {
    state: 'Established',
    invite: async options => { calls.push(options.sessionDescriptionHandlerOptions.hold ? 'hold' : 'resume'); options.requestDelegate.onAccept(); },
    refer: async (session, options) => { calls.push('refer'); original.notification = options; },
    bye: async () => { calls.push('bye-original'); original.state = 'Terminated'; }
  };
  class Inviter {
    constructor() { next = this; this.state = 'Initial'; this.stateChange = { addListener: listener => this.listener = listener }; }
    async invite() { calls.push('consult'); this.state = 'Establishing'; }
    async cancel() { calls.push('cancel'); this.change('Terminated'); }
    async bye() { calls.push('bye-consult'); this.change('Terminated'); }
    change(state) { this.state = state; this.listener(state); }
  }
  const SIP = { SessionState: { Initial: 'Initial', Establishing: 'Establishing', Established: 'Established', Terminated: 'Terminated' }, UserAgent: { makeURI: value => value }, Inviter };
  const controller = create({ SIP, getSession: () => original, getAgent: () => ({}), getDomain: () => 'test.invalid', audio: session => audio.push(session), changed: state => states.push(state), report: error => { throw error; } });
  return { controller, original, calls, audio, states, get next() { return next; } };
}

test('consult holds original; completion waits for successful NOTIFY', async () => {
  const f = fixture();
  await f.controller.start('777');
  assert.deepEqual(f.calls, ['hold', 'consult']);
  await assert.rejects(f.controller.complete());
  f.next.change('Established');
  assert.equal(f.audio[0], f.next);
  const completion = f.controller.complete();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.calls.includes('bye-original'), false);
  f.original.notification.onNotify({ request: { body: 'SIP/2.0 200 OK' }, accept: async () => {} });
  await completion;
  assert.equal(f.controller.phase, 'idle');
  assert.ok(f.calls.includes('bye-original'));
});

test('cancel ends consultation and resumes original audio', async () => {
  const f = fixture();
  await f.controller.start('777');
  await f.controller.cancel();
  assert.deepEqual(f.calls, ['hold', 'consult', 'cancel', 'resume']);
  assert.equal(f.audio[0], f.original);
});

test('rejected transfer leaves both calls available and supports return', async () => {
  const f = fixture();
  await f.controller.start('777'); f.next.change('Established');
  const completion = f.controller.complete();
  f.original.notification.onNotify({ request: { body: 'SIP/2.0 486 Busy Here' }, accept: async () => {} });
  await assert.rejects(completion);
  assert.equal(f.controller.phase, 'consulting');
  assert.equal(f.calls.includes('bye-original'), false);
  await f.controller.cancel();
});

test('invalid target and duplicate consultation do not place extra calls', async () => {
  const f = fixture();
  await assert.rejects(f.controller.start('abc'));
  assert.deepEqual(f.calls, []);
  await f.controller.start('777');
  await assert.rejects(f.controller.start('778'));
  await f.controller.cancel();
});

test('unanswered consultation restores original call', async () => {
  const f = fixture();
  await f.controller.start('777'); f.next.change('Terminated');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.controller.phase, 'idle');
  assert.deepEqual(f.calls, ['hold', 'consult', 'resume']);
});
