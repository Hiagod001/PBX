const test = require('node:test');
const assert = require('node:assert/strict');
const { singleFlight, protocolTracker } = require('../src/call-control');

test('simultaneous answer clicks accept a SIP invitation exactly once and allow retry after failure', async () => {
  let calls=0, release;
  const accept=singleFlight(async()=>{calls++;await new Promise(resolve=>release=resolve)});
  const session={};
  const first=accept(session), second=accept(session);
  assert.equal(first,second);
  await Promise.resolve();
  assert.equal(calls,1);
  release(); await first;
  let attempts=0;
  const retry=singleFlight(async()=>{if(++attempts===1)throw new Error('microphone unavailable');return true});
  await assert.rejects(retry(session),/microphone/);
  assert.equal(await retry(session),true);
});

test('protocol allocation runs in the background and an ended call cannot update a later call', async () => {
  const pending=[], applied=[];
  let id=0;
  const tracker=protocolTracker({request:()=>new Promise(resolve=>pending.push(resolve)),apply:value=>applied.push(value),createId:()=>String(++id)});
  const first=tracker.start({number:'9971'});
  tracker.clear();
  const second=tracker.start({number:'9972'});
  pending[0]({protocol:{protocol:'old'}}); await first;
  assert.deepEqual(applied,[]);
  pending[1]({protocol:{protocol:'current'}}); await second;
  assert.deepEqual(applied,['current']);
});

test('a failed protocol response retries with the same idempotency key when the server supports it', async () => {
  const keys=[],applied=[];
  const tracker=protocolTracker({request:async payload=>{keys.push(payload.requestId);if(keys.length===1)throw new Error('response lost');return {protocol:{protocol:'2026000100'}}},apply:value=>applied.push(value),createId:()=> 'same-call-uuid',retry:()=>true,delay:async()=>{}});
  await tracker.start({number:'9971'});
  assert.deepEqual(keys,['same-call-uuid','same-call-uuid']);
  assert.deepEqual(applied,['2026000100']);
});

test('legacy servers are not retried and ending a call cancels a pending protocol retry', async () => {
  let reads=0,errors=0;
  const tracker=protocolTracker({request:async()=>{reads++;throw new Error('failed')},apply:()=>assert.fail(),failed:()=>errors++,createId:()=> 'id'});
  await tracker.start({});
  assert.equal(reads,1); assert.equal(errors,1);
  let release;
  const cancel=protocolTracker({request:async()=>{reads++;throw new Error('failed')},apply:()=>assert.fail(),failed:()=>assert.fail(),createId:()=> 'id',retry:()=>true,delay:()=>new Promise(resolve=>release=resolve)});
  const operation=cancel.start({});
  await Promise.resolve();await Promise.resolve();
  cancel.clear();release();await operation;
  assert.equal(reads,2);
});
