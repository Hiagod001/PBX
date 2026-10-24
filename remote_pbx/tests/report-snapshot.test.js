const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

test('concurrent report requests enrich once and return isolated copies', async () => {
  const source = fs.readFileSync(require.resolve('../server'), 'utf8');
  const code = source.slice(source.indexOf('const reportRecordingSnapshots ='), source.indexOf('async function buildRecordingIndexFresh'));
  let scans = 0;
  let index = [];
  const base = [{ id: '1', technicalLogs: [] }];
  const context = {
    Date, structuredClone,
    reportCallsCache: { revision: 'same', expiresAt: Date.now() + 60000, value: base },
    configRevision: () => 'same',
    buildRecordingIndex: async () => index,
    attachRecordingState: call => { scans++; call.recordingExists = true; return call; },
    recentReportCalls: (calls, limit) => calls.slice(0, limit)
  };
  vm.runInNewContext(code, context);
  const [a, b] = await Promise.all([context.readPbxReportCalls({}), context.readPbxReportCalls({})]);
  assert.equal(scans, 1);
  a[0].technicalLogs.push('private');
  assert.equal(b[0].technicalLogs.length, 0);
  assert.equal(base[0].recordingExists, undefined);
  index = [];
  await context.readPbxReportCalls({});
  assert.equal(scans, 2);
});
