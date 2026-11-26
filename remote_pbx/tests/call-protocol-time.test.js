const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
process.env.PBX_DATABASE_ENABLED = "false";
process.env.ASTERISK_CDR_TIMEZONE = "America/Sao_Paulo";
const { cdrTimestamp, importRow } = require("../scripts/import-cdr");
const { historyStart, historyFilters, keepHistoryTime } = require("../src/call-history");
const { _test } = require("../server");

test("CDR local dates become explicit instants before being passed to PostgreSQL", async () => {
  let values;
  await importRow({ calldate: "2026-11-26 16:48:42", start_at: "2026-11-26 16:48:42", answer_at: "2026-11-26 16:48:47", end_at: "2026-11-26 16:48:55" }, async (_sql, params) => { values = params; });
  assert.deepEqual(values.slice(0, 4), ["2026-11-26T19:48:42.000Z", "2026-11-26T19:48:42.000Z", "2026-11-26T19:48:47.000Z", "2026-11-26T19:48:55.000Z"]);
  assert.equal(cdrTimestamp("2026-11-26T19:48:42Z"), "2026-11-26T19:48:42.000Z");
  assert.equal(cdrTimestamp("2026-11-26T16:48:42-03:00"), "2026-11-26T19:48:42.000Z");
  assert.equal(cdrTimestamp("2026-11-26 16:48:42", "UTC"), "2026-11-26T16:48:42.000Z");
  assert.equal(cdrTimestamp("2026-02-30 16:48:42"), null);
  assert.equal(cdrTimestamp(""), null);
});

test("an extension call receives its original protocol after the CDR time is normalized", () => {
  const config = { extensions: [{ number: "777" }] };
  const event = { protocol: "2026000331", extension: "777", direction: "saida", number: "34999990000", createdAt: "2026-11-26T19:48:41.043Z" };
  const raw = { uniqueid: "call-time-regression", src: "3431950000", dst: "999990000", channel: "PJSIP/web-777-00000001", direction: "outbound", disposition: "NO ANSWER" };
  const old = _test.mapDbCdrRow({ ...raw, calldate: "2026-11-26T16:48:42.000Z" }, 0, config);
  assert.equal(_test.attachCallProtocolEvents([old], [event])[0].protocol, "");
  const corrected = _test.mapDbCdrRow({ ...raw, calldate: cdrTimestamp("2026-11-26 16:48:42") }, 0, config);
  assert.equal(_test.attachCallProtocolEvents([corrected], [event])[0].protocol, event.protocol);
});

test("history cutoff preserves today's calls and survives a fresh import or older report query", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pbx-history-"));
  const file = path.join(dir, "policy.json");
  try {
    assert.equal(await historyStart(file), "");
    await fs.writeFile(file, JSON.stringify({ since: "2026-11-26T03:00:00Z" }));
    const since = await historyStart(file);
    assert.equal(keepHistoryTime(cdrTimestamp("2026-11-25 23:59:59"), since), false);
    assert.equal(keepHistoryTime(cdrTimestamp("2026-11-26 00:00:00"), since), true);
    assert.equal(keepHistoryTime(cdrTimestamp("2026-11-26 16:48:42"), since), true);
    assert.deepEqual(historyFilters({ uniqueId: "current", dateStart: "2026-01-01T00:00:00Z" }, since), { uniqueId: "current", dateStart: since });
    assert.equal(historyFilters({ dateStart: "2026-11-27T03:00:00Z" }, since).dateStart, "2026-11-27T03:00:00Z");
    await fs.writeFile(file, '{"since":"invalid"}');
    await assert.rejects(historyStart(file));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test("rapid calls with identical final CDR timestamps keep their own protocols", () => {
  const calls = [
    { id: "1795722494.19416", uniqueId: "1795722494.19416", startedAt: "2026-11-26T19:48:26Z", extension: "777", destination: "34999990000", type: "outbound" },
    { id: "1795722506.19420", uniqueId: "1795722506.19420", startedAt: "2026-11-26T19:48:26Z", extension: "777", destination: "34999990000", type: "outbound" }
  ];
  const events = [
    { protocol: "2026000329", extension: "777", direction: "saida", number: "34999990000", createdAt: "2026-11-26T19:48:14.047Z" },
    { protocol: "2026000330", extension: "777", direction: "saida", number: "34999990000", createdAt: "2026-11-26T19:48:26.538Z" }
  ];
  _test.attachCallProtocolEvents(calls, events);
  assert.deepEqual(calls.map(call => call.protocol), ["2026000329", "2026000330"]);
});

test("a long call keeps its protocol when the final CDR starts at hangup", () => {
  const call = { id: "1795722494.19416", uniqueId: "1795722494.19416", startedAt: "2026-11-26T20:48:14Z", extension: "777", destination: "34999990000", type: "outbound" };
  const event = { protocol: "2026000329", extension: "777", direction: "saida", number: "34999990000", createdAt: "2026-11-26T19:48:14.047Z" };
  assert.equal(_test.attachCallProtocolEvents([call], [event])[0].protocol, event.protocol);
});

test("parallel protocol requests retain unique counters and all events, and corrupted counters fail closed", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pbx-protocol-"));
  try {
    const source = await fs.readFile(require.resolve("../server"), "utf8");
    const context = {
      fs: require("fs-extra"), path, Date, process, Promise,
      protocolYear: () => "2026", parseFlexibleDate: (text) => new Date(text),
      historyStart: async () => "", keepHistoryTime,
      protocolCounterPath: path.join(dir, "counter.json"), callProtocolsPath: path.join(dir, "events.json"),
      protocolCounterLock: Promise.resolve(), protocolEventLock: Promise.resolve()
    };
    vm.runInNewContext(source.slice(source.indexOf("async function allocateCallProtocol()"), source.indexOf("async function readExtensionPauses()")), context);
    const protocols = await Promise.all(Array.from({ length: 40 }, async () => {
      const protocol = await context.allocateCallProtocol();
      await context.recordCallProtocolEvent({ protocol, extension: "777", direction: "saida", number: "34999990000" });
      return protocol;
    }));
    assert.equal(new Set(protocols).size, 40);
    assert.equal(JSON.parse(await fs.readFile(context.protocolCounterPath, "utf8"))["2026"], 40);
    assert.equal(JSON.parse(await fs.readFile(context.callProtocolsPath, "utf8")).events.length, 40);
    await fs.writeFile(context.protocolCounterPath, "invalid-json");
    await assert.rejects(context.allocateCallProtocol());
    assert.equal(await fs.readFile(context.protocolCounterPath, "utf8"), "invalid-json");
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
