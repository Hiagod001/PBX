const test = require('node:test');
const assert = require('node:assert/strict');
const phone = require('../src/phone-state');
const states = { Established: 'active', Terminating: 'ending', Terminated: 'ended' };
test('hangup uses the correct SIP operation for each stage', () => {
  assert.equal(phone.terminationAction(null, states), null);
  assert.equal(phone.terminationAction({ state: 'ended' }, states), null);
  assert.equal(phone.terminationAction({ state: 'ending' }, states), null);
  assert.equal(phone.terminationAction({ state: 'active', reject() {} }, states), 'bye');
  assert.equal(phone.terminationAction({ state: 'ringing', reject() {} }, states), 'reject');
  assert.equal(phone.terminationAction({ state: 'calling' }, states), 'cancel');
});
test('extension pause state takes priority over stale queue status', () => {
  assert.equal(phone.pauseFromStatus({ extension: { paused: false }, queues: [{ agent: { paused: true } }] }).paused, false);
  assert.equal(phone.pauseFromStatus({ extension: { paused: true } }).paused, true);
  assert.equal(phone.pauseFromStatus({ queues: [{ agent: { paused: true } }] }).paused, true);
});
test('paused and busy extensions reject incoming calls', () => {
  assert.equal(phone.rejectInvitation({ paused: true }), true);
  assert.equal(phone.rejectInvitation({ busy: true, callback: true }), true);
  assert.equal(phone.rejectInvitation({ stopping: true, callback: true }), true);
  assert.equal(phone.rejectInvitation({ paused: true, callback: true }), false);
  assert.equal(phone.rejectInvitation({}), false);
});
