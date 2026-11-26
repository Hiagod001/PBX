const test = require('node:test');
const assert = require('node:assert/strict');
const { snapshotCache } = require('../src/snapshot-cache');

test('concurrent config readers share work and cannot mutate another request snapshot', async () => {
  let reads=0, time=100;
  const cache=snapshotCache(async()=>({version:++reads,nested:{enabled:true}}),{now:()=>time,ttlMs:1000});
  const values=await Promise.all(Array.from({length:32},()=>cache.read()));
  assert.equal(reads,1);
  values[0].nested.enabled=false;
  assert.equal(values[1].nested.enabled,true);
  assert.equal((await cache.read()).nested.enabled,true);
  time=1101;
  assert.equal((await cache.read()).version,2);
});

test('saving config invalidates in-flight reads without allowing them to replace the saved version', async () => {
  let resolveOld, count=0;
  const cache=snapshotCache(()=>++count===1 ? new Promise(resolve=>{resolveOld=resolve}) : Promise.resolve({version:2}));
  const old=cache.read();
  await Promise.resolve();
  cache.invalidate();
  assert.equal((await cache.read()).version,2);
  resolveOld({version:1});
  assert.equal((await old).version,1);
  assert.equal((await cache.read()).version,2);
});

test('failed configuration reads are retried instead of being cached as missing data', async () => {
  let count=0;
  const cache=snapshotCache(async()=>{if(++count===1)throw new Error('temporary failure');return {ok:true}});
  await assert.rejects(cache.read(),/temporary/);
  assert.equal((await cache.read()).ok,true);
});
