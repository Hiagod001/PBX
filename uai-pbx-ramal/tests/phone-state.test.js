const test = require('node:test');
const assert = require('node:assert/strict');
const phone = require('../src/phone-state');
const states = { Established: 'active', Terminating: 'ending', Terminated: 'ended' };
test('top badge reflects registration, pause and the full call lifecycle', () => {
  const online = { registrationStatus: 'online' };
  assert.equal(phone.displayStatus(online).label, 'Online');
  assert.equal(phone.displayStatus(online, true).label, 'Em pausa');
  assert.equal(phone.displayStatus({ registrationStatus: 'connecting' }).label, 'Conectando');
  assert.equal(phone.displayStatus({}, true).label, 'Offline');
  assert.equal(phone.displayStatus({ ...online, dialStarting: true }).label, 'Chamando');
  assert.equal(phone.displayStatus({ ...online, callPending: true }).label, 'Chamando');
  assert.equal(phone.displayStatus({ ...online, session: {}, incoming: true }).label, 'Recebendo');
  assert.equal(phone.displayStatus({ ...online, session: {} }, true).label, 'Ocupado');
  assert.equal(phone.displayStatus({ ...online, session: null, callPending: false }).label, 'Online');
});
test('dial input accepts digits only and limits pasted numbers', () => {
  assert.equal(phone.sanitizeNumber('abc3499-1708282xyz'), '34991708282');
  assert.equal(phone.sanitizeNumber('9'.repeat(50)).length, 20);
  assert.equal(phone.sanitizeNumber('1'.repeat(50), 8).length, 8);
  assert.equal(phone.validateNumber('777'), '777');
  assert.throws(() => phone.validateNumber(''), /Informe o n\u00famero para ligar/);
  for (const value of ['abc', '777abc', '9'.repeat(21), '*#']) assert.throws(() => phone.validateNumber(value));
});
test('pause is blocked throughout call setup, ringing and connected states', () => {
  assert.equal(phone.callInProgress({}), false);
  assert.equal(phone.callInProgress({ dialStarting: true }), true);
  assert.equal(phone.callInProgress({ callPending: true }), true);
  assert.equal(phone.callInProgress({ session: {} }), true);
  assert.equal(phone.callInProgress({ session: null, callPending: false, dialStarting: false }), false);
});
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
