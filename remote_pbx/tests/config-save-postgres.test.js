const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { randomBytes } = require('node:crypto');
const { Client } = require('pg');

test('selective PostgreSQL saves preserve other modules, ordering and transaction rollback', {skip:!process.env.PBX_TEST_DATABASE_URL,timeout:20000}, async()=>{
 const client=new Client({connectionString:process.env.PBX_TEST_DATABASE_URL,statement_timeout:12000});
 const schema='pbx_config_test_'+process.pid+'_'+randomBytes(6).toString('hex');
 assert.match(schema,/^pbx_config_test_\d+_[a-f0-9]{12}$/);
 let created=false;
 await client.connect();
 try {
  await client.query(`CREATE SCHEMA "${schema}"`);created=true;
  await client.query(`SET search_path="${schema}"`);
  const calls=[];
  let afterSettingsRead=null;
  const execute=async(sql,params)=>{
    calls.push(sql);const result=await client.query(sql,params);
    if(afterSettingsRead&&sql==='SELECT key, value FROM pbx_settings') {const hook=afterSettingsRead;afterSettingsRead=null;await hook();}
    return result;
  };
  class TestPool {query(...args){return execute(...args)} async connect(){return {query:execute,release(){}}} on(){} }
  const filename=require.resolve('../src/db');
  const nativeRequire=createRequire(filename);
  const context={module:{exports:{}},__dirname:path.dirname(filename),console,process:{env:{PGHOST:'test',PBX_DATABASE_REQUIRED:'true'}},require:id=>id==='pg'?{Pool:TestPool}:nativeRequire(id)};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),context,{filename});
  const db=context.module.exports;
  const {defaultConfig,normalizeConfig}=require('../src/store');
  const plain=value=>JSON.parse(JSON.stringify(value));
  const normalized=value=>plain(normalizeConfig(plain(value)));
  const seed=normalized(structuredClone(defaultConfig));
  await db.saveConfig(seed);
  const base=normalized(await db.getConfig());
  assert.deepEqual(base.extensions,seed.extensions);
  const untouched=await client.query('SELECT id,xmin::text AS version FROM pbx_trunks ORDER BY id');
  let current=structuredClone(base);
  current.extensions[0].name='QA changed';
  await db.saveConfig(current,base);
  assert.deepEqual(normalized(await db.getConfig()),current);
  assert.deepEqual((await client.query('SELECT id,xmin::text AS version FROM pbx_trunks ORDER BY id')).rows,untouched.rows);
  const queueChange=structuredClone(current);
  queueChange.queues[0].members=[{number:'201',penalty:2,paused:true},'204'];
  await db.saveConfig(queueChange,current);
  const member=await client.query("SELECT penalty,paused FROM pbx_queue_members WHERE extension_number='201'");
  assert.deepEqual(member.rows[0],{penalty:2,paused:true});
  current=normalized(await db.getConfig());
  assert.deepEqual(current.queues[0].members,['201','204']);
  const reordered=structuredClone(current);
  reordered.outboundRules=Object.fromEntries(Object.entries(current.outboundRules).reverse());
  await db.saveConfig(reordered,current);current=reordered;
  assert.deepEqual(Object.keys((await db.getConfig()).outboundRules),Object.keys(current.outboundRules));
  const cleared=structuredClone(current);cleared.queues=[];cleared.ringGroups=[];cleared.ivr.options=[];
  await db.saveConfig(cleared,current);current=cleared;
  assert.deepEqual(normalized(await db.getConfig()),current);
  assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM pbx_queue_members')).rows[0].count,0);
  const countBefore=(await client.query('SELECT COUNT(*)::int AS count FROM pbx_config_snapshots')).rows[0].count;
  const callsBefore=calls.length;
  await db.saveConfig(structuredClone(current),current);
  assert.equal(calls.length,callsBefore);
  const invalid=structuredClone(current);invalid.extensions.push({...invalid.extensions[0]});
  await assert.rejects(db.saveConfig(invalid,current));
  assert.deepEqual(normalized(await db.getConfig()),current);
  assert.equal((await client.query('SELECT COUNT(*)::int AS count FROM pbx_config_snapshots')).rows[0].count,countBefore);
  await db.saveConfig(base);
  assert.deepEqual(normalized(await db.getConfig()),base);
  const writer=new Client({connectionString:process.env.PBX_TEST_DATABASE_URL,statement_timeout:12000});
  await writer.connect();
  try {
    await writer.query(`SET search_path="${schema}"`);
    afterSettingsRead=async()=>{
      await writer.query('BEGIN');
      await writer.query("UPDATE pbx_settings SET value=jsonb_set(value,'{name}',to_jsonb($1::text)) WHERE key='company'",['Concurrent company']);
      await writer.query("UPDATE pbx_trunks SET extra=jsonb_set(extra,'{name}',to_jsonb($1::text)) WHERE id=$2",['Concurrent trunk',base.trunks[0].id]);
      await writer.query('COMMIT');
    };
    const coherent=normalized(await db.getConfig());
    assert.equal(coherent.company.name,base.company.name);
    assert.deepEqual(coherent.trunks,base.trunks);
    const after=normalized(await db.getConfig());
    assert.equal(after.company.name,'Concurrent company');
    assert.equal(after.trunks.find(t=>t.id===base.trunks[0].id).name,'Concurrent trunk');
  } finally {await writer.query('ROLLBACK');await writer.end();}
  await db.saveConfig(base);
  const users={users:[{username:'qa',passwordHash:'test-only-hash',role:'user',permissions:{menus:{queues:true}}}]};
  await db.saveUsers(users);
  const storedUsers=plain(await db.getUsers());
  await assert.rejects(db.saveUsers({users:[users.users[0],users.users[0]]}));
  assert.deepEqual(plain(await db.getUsers()),storedUsers);
 } finally {
  if(created) await client.query(`DROP SCHEMA "${schema}" CASCADE`);
  await client.end();
 }
});
