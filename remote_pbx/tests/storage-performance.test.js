const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { createCdrMapper } = require('../src/cdr-mapper');

test('historical CDR queries have no silent cap and bind selection parameters', async () => {
  const source = fs.readFileSync(require.resolve('../src/db'), 'utf8');
  const code = source.slice(source.indexOf('async function getCdrRows'), source.indexOf('module.exports ='));
  const queries = [];
  const ctx = { query: async (sql, params) => { queries.push({ sql, params }); return { rows: [{ uniqueid: 'old' }] }; } };
  vm.runInNewContext(code, ctx);
  assert.equal((await ctx.getCdrRows())[0].uniqueid, 'old');
  assert.doesNotMatch(queries[0].sql, /LIMIT/i);
  await ctx.getCdrRows({ uniqueId: "a' OR true--", dateStart: '2026-01-01' });
  assert.ok(queries[1].sql.includes('uniqueid = $1'));
  assert.ok(queries[1].sql.includes('linkedid'));
  assert.ok(!queries[1].sql.includes("OR true"));
  assert.equal(queries[1].params[0], "a' OR true--");
});

test('CDR mapping reuses unchanged rows, isolates mutations and invalidates updates/config', async () => {
  let mapped = 0;
  const mapper = createCdrMapper(row => { mapped++; return { id: row.uniqueid, value: row.value, technicalLogs: [] }; }, { batchSize: 1 });
  const rows = [{ uniqueid: '1', value: 1 }, { uniqueid: '2', value: 2 }];
  const first = await mapper(rows, {}, 'a');
  first[0].technicalLogs.push('private');
  first[0].value = 99;
  const second = await mapper(rows, {}, 'a');
  assert.equal(mapped, 2);
  assert.equal(second[0].value, 1);
  assert.equal(second[0].technicalLogs.length, 0);
  rows[0].value = 3;
  assert.equal((await mapper(rows, {}, 'a'))[0].value, 3);
  assert.equal(mapped, 3);
  await mapper(rows, {}, 'b');
  assert.equal(mapped, 5);
});

for (const type of ['recording', 'reports']) test(`${type} ignores out-of-order filter responses`, async () => {
  const source = fs.readFileSync(require.resolve('../public/app.js'), 'utf8');
  const recording = type === 'recording';
  const start = source.indexOf(recording ? 'async function loadRecordingLibrary(' : 'async function loadReports(');
  const end = source.indexOf(recording ? 'async function loadReports(' : 'function collectUsersFromDom(', start);
  const pending = [];
  const data = { meta: {}, filters: {} };
  const ctx = {
    state: { activeTab: 'audios', recordingLibrary: data, pbxReports: data },
    recordingFilterParams: () => new URLSearchParams(), reportFilterParams: () => new URLSearchParams(),
    api: () => new Promise(resolve => pending.push(resolve)),
    renderAudios() {}, renderReports() {}, iconRefresh() {}
  };
  vm.runInNewContext(source.slice(start, end), ctx);
  const load = recording ? ctx.loadRecordingLibrary : ctx.loadReports;
  const a = load();
  const size = pending.length;
  const b = load();
  for (const resolve of pending.slice(size)) resolve({ data: [{ id: 'new' }] });
  await b;
  for (const resolve of pending.slice(0, size)) resolve({ data: [{ id: 'old' }] });
  await a;
  assert.equal(data.calls[0].id, 'new');
  assert.equal(data.loading, false);
});

test('live monitor returns immediately while historical statistics are pending', () => {
  const source = fs.readFileSync(require.resolve('../server'), 'utf8');
  const code = source.slice(source.indexOf('function monitorHistoricalStats'), source.indexOf('async function buildExtensionIdleIndex'));
  const previous = new Map([['777', { callsMadeToday: 3 }]]);
  const ctx = { extensionIdleCache: { key: 'v:today', value: previous }, configRevision: () => 'v', localDateKey: () => 'today', buildExtensionIdleIndex: () => new Promise(() => {}) };
  vm.runInNewContext(code, ctx);
  assert.equal(ctx.monitorHistoricalStats({}), previous);
  ctx.configRevision = () => 'new';
  assert.equal(ctx.monitorHistoricalStats({}).size, 0);
});
