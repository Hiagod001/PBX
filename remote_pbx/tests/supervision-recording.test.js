const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { isSupervisionCall, mixArguments, unifiedRecording } = require("../src/supervision-recording");
const { _test } = require("../server");
const { renderExtensions } = require("../src/asterisk");
const { defaultConfig } = require("../src/store");

test("report aggregation excludes spy CDRs before grouping, without discarding the original call", () => {
  const call = { id: "1", uniqueId: "1", linkedId: "1", lastapp: "Dial", channel: "PJSIP/web-701-abc" };
  assert.deepEqual(_test.collapseReportCallLegs([call, { ...call, id: "2", lastapp: "ChanSpy" }, { id: "3", channel: "PJSIP/monitor-admin-abc" }]), [call]);
});

test("dialplan records continuous main audio and only the supervisor microphone", () => {
  const plan = renderExtensions(structuredClone(defaultConfig));
  assert.match(plan, /Set\(__RECORDING_FILE=/);
  assert.match(plan, /MixMonitor\([^\n]+RECORDING_FILE\},,\/bin\/date/);
  assert.match(plan, /MixMonitor\(,r\(\$\{PBX_SPY_AUDIO\}\)/);
  assert.match(plan, /DB_DELETE\(UAI_SUPERVISION/);
  assert.doesNotMatch(plan, /include\s*=>\s*pbx-supervision/);
});

test("supervision legs are separate from business calls, including historical CDRs", () => {
  for (const call of [{ lastapp: "ChanSpy" }, { lastApp: "ExtenSpy" }, { channel: "PJSIP/monitor-admin-00000abc" }, { dcontext: "pbx-supervision" }, { userField: "pbx-supervision" }]) {
    assert.equal(isSupervisionCall(call), true);
  }
  assert.equal(isSupervisionCall({ channel: "PJSIP/custom-monitor-abcdef" }, "custom-monitor"), true);
  assert.equal(isSupervisionCall({ channel: "PJSIP/web-701-abc", dstchannel: "PJSIP/monitor-admin-abc", lastdata: "ChanSpy", lastapp: "Dial" }), false);
});

test("merge aligns supervisor input without duplicating or attenuating the main audio", () => {
  const args = mixArguments({ file: "/main.wav", started: 1000 }, [{ file: "/mic.wav", started: 2500 }, { file: "/early.wav", started: 900 }], "/output.wav");
  assert.match(args[args.indexOf("-filter_complex") + 1], /adelay=1500:all=1/);
  assert.match(args[args.indexOf("-filter_complex") + 1], /atrim=start=0.1,asetpts=PTS-STARTPTS/);
  assert.match(args[args.indexOf("-filter_complex") + 1], /duration=first:normalize=0/);
});

test("legacy recordings remain available and unfinished supervisor audio is never silently omitted", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "pbx-recording-"));
  try {
    const file = path.join(root, "main.wav");
    assert.equal(await unifiedRecording(file, path.join(root, "cache")), file);
    await fs.mkdir(path.join(root, ".supervision"));
    await fs.writeFile(path.join(root, ".supervision", "main.wav.spy-123.wav"), "partial");
    await assert.rejects(unifiedRecording(file, path.join(root, "cache")));
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
