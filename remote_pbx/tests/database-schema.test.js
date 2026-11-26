const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { ensureSchema } = require('../src/database-schema');

function database({fingerprint,exists=true,fail=false}={}) {
  const queries=[];
  const client={release(){queries.push('release')},async query(sql,params){
    queries.push(sql);
    if(sql.includes('to_regclass'))return {rows:[{exists}]};
    if(sql.startsWith('SELECT fingerprint'))return {rows:fingerprint?[{fingerprint}]:[]};
    if(sql==='SCHEMA'&&fail)throw new Error('DDL failed');
    if(sql.startsWith('INSERT INTO pbx_schema_version'))fingerprint=params[0];
    return {rows:[]};
  }};
  return {queries,pool:{query:client.query,async connect(){queries.push('connect');return client}}};
}

test('unchanged schema skips DDL and its table locks on importer and application startup', async () => {
  const d=database({fingerprint:createHash('sha256').update('SCHEMA').digest('hex')});
  assert.equal(await ensureSchema(d.pool,'SCHEMA'),false);
  assert.equal(d.queries.length,2);
  assert.ok(!d.queries.includes('connect'));
});

test('new schema is serialized, applied once and committed with its fingerprint', async () => {
  const d=database({exists:false});
  assert.equal(await ensureSchema(d.pool,'SCHEMA'),true);
  assert.ok(d.queries.indexOf('SELECT pg_advisory_xact_lock(786482104)') < d.queries.indexOf('SCHEMA'));
  assert.ok(d.queries.includes('COMMIT'));
  assert.equal(d.queries.at(-1),'release');
});

test('a failed migration rolls back and never records a successful schema version', async () => {
  const d=database({fail:true});
  await assert.rejects(ensureSchema(d.pool,'SCHEMA'),/DDL failed/);
  assert.ok(d.queries.includes('ROLLBACK'));
  assert.ok(!d.queries.some(q=>q.startsWith('INSERT INTO pbx_schema_version')));
  assert.equal(d.queries.at(-1),'release');
});
