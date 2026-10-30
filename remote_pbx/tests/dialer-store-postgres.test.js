const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { Client } = require('pg');
const { createDialerStore } = require('../src/dialer-store');

test('PostgreSQL campaign migration, incremental updates and rollback', { skip: !process.env.PBX_TEST_DATABASE_URL }, async () => {
  const client = new Client({ connectionString: process.env.PBX_TEST_DATABASE_URL, statement_timeout: 10000 });
  await client.connect();
  try {
    // Every test table is temporary; public production tables are never changed.
    await client.query('SET search_path=pg_temp');
    const schema = fs.readFileSync(require.resolve('../src/postgres-schema.sql'), 'utf8');
    await client.query(schema.slice(schema.indexOf('CREATE TABLE IF NOT EXISTS pbx_dialer_state'), schema.indexOf('CREATE INDEX IF NOT EXISTS idx_pbx_cdr_call_key')).replaceAll('CREATE TABLE IF NOT EXISTS', 'CREATE TEMP TABLE'));
    let changedLeads = 0;
    const database = {
      ensureDatabase: async () => true,
      transaction: async task => {
        await client.query('BEGIN');
        try {
          const result = await task({ query: (sql, params) => {
            if (sql.startsWith('INSERT INTO pbx_dialer_leads')) changedLeads += JSON.parse(params[1]).length;
            return client.query(sql, params);
          } });
          await client.query('COMMIT');
          return result;
        } catch (error) { await client.query('ROLLBACK'); throw error; }
      }
    };
    const legacy = [{ id: 'test-a', name: 'Temporary test', numbers: [{ number: '100', status: 'pending' }, { number: '101', status: 'pending' }] }, { id: 'test-b', numbers: [] }];
    const store = createDialerStore(database, async () => structuredClone(legacy));
    assert.deepEqual(await store.read(), legacy);
    const next = structuredClone(legacy);
    next[0].numbers[1].status = 'answered';
    changedLeads = 0;
    await store.write(next);
    assert.equal(changedLeads, 1);
    assert.deepEqual(await store.read(), next);
    await assert.rejects(store.write([{ id: null, numbers: [] }]));
    assert.deepEqual(await store.read(), next);
    next[0].numbers.pop();
    await store.write([next[0]]);
    const reopened = createDialerStore(database, async () => { throw new Error('must not reimport'); });
    assert.deepEqual(await reopened.read(), [next[0]]);
    await reopened.write([]);
    assert.deepEqual(await createDialerStore(database, async () => legacy).read(), []);
  } finally { await client.end(); }
});
