const test = require("node:test");
const assert = require("node:assert/strict");

const { _test } = require("../server");

test("recording number filter matches either side of the call", () => {
  const calls = [
    { source: "3431950817", destination: "34991708282", callerId: "", did: "" },
    { source: "505", destination: "34999999999", callerId: "", did: "" }
  ];
  assert.deepEqual(_test.applyReportFilters(calls, _test.parseReportFilters({ number: "708282" })), [calls[0]]);
  assert.deepEqual(_test.applyReportFilters(calls, _test.parseReportFilters({ number: "505" })), [calls[1]]);
});

test("recording downloads receive a readable and unique filename", () => {
  const name = _test.recordingDownloadName({
    startedAt: "2026-07-14T12:20:42",
    type: "inbound",
    extension: "505",
    source: "34991708282",
    uniqueId: "1781098215.18",
    recordingFile: "raw-call.wav"
  });
  assert.equal(name, "2026-07-14_12-20-42_entrada_ramal-505_numero-34991708282_id-1781098215-18.wav");
});
