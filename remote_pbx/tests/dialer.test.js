const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { _test } = require("../server");
const { renderModules } = require("../src/asterisk");

test("loads the Asterisk modules required by call files and DTMF events", () => {
  const modules = renderModules();
  assert.match(modules, /^load = pbx_spool\.so$/m);
  assert.match(modules, /^load = app_userevent\.so$/m);
});

test("grants the application read-only access to archived call results", () => {
  const helper = fs.readFileSync(path.join(__dirname, "..", "scripts", "asterisk-control-root.sh"), "utf8");
  assert.match(helper, /setfacl -m "u:\$\{APP_USER\}:r--" "\$TMP"/);
  assert.doesNotMatch(helper, /chmod\s+0?644\s+"\$TMP"/);
});

test("normalizes and deduplicates dialer numbers", () => {
  assert.deepEqual(_test.normalizeDialerNumbers("(31) 99999-0000\n31999990000;123"), ["31999990000"]);
});

test("call file carries a private attempt correlation id", () => {
  const content = _test.dialerCallFileContent(
    { trunk: { mainNumber: "3431950000" }, outbound: { defaultTrunk: "trunk-main" } },
    {
      id: "camp-test",
      callerId: "3431950000",
      trunkIds: ["trunk-main"],
      audio: "custom/test",
      digit: "1",
      destinationType: "queue",
      destination: "support",
      responseTimeout: 8
    },
    { number: "31999990000", trunkId: "trunk-main", attemptId: "dlr-test123" }
  );

  assert.match(content, /^Account: dlr-test123$/m);
  assert.match(content, /^Setvar: DIALER_ATTEMPT_ID=dlr-test123$/m);
  assert.match(content, /^Archive: yes$/m);
});

test("parses archived call file results", () => {
  assert.equal(_test.parseDialerArchiveStatus("Channel: PJSIP/test\nStatus: Completed\n"), "completed");
  assert.equal(_test.parseDialerArchiveStatus("Status: Expired\r\n"), "expired");
  assert.equal(_test.parseDialerArchiveStatus("Channel: PJSIP/test\n"), "");
});

test("classifies accepted, busy and unanswered calls", () => {
  assert.equal(_test.dialerResultFromReport({ userField: "dialer:dlr-a:accepted:3199", disposition: "ANSWERED" }, "completed").status, "accepted");
  assert.equal(_test.dialerResultFromReport({ disposition: "BUSY" }, "completed").status, "busy");
  assert.equal(_test.dialerResultFromReport(null, "expired").status, "no_answer");
  assert.equal(_test.dialerResultFromReport({ disposition: "FAILED" }, "completed").status, "failed");
});

test("audit snapshot excludes customer phone numbers", () => {
  const snapshot = _test.dialerAuditSnapshot({
    id: "camp-a",
    name: "Teste",
    status: "draft",
    numbers: [{ number: "31999990000" }],
    trunkIds: ["trunk-main"]
  });
  assert.equal(snapshot.totalNumbers, 1);
  assert.doesNotMatch(JSON.stringify(snapshot), /31999990000/);
});

test("schedules only allowed retries and then records the final result", () => {
  const campaign = { retryAttempts: 2, intervalSeconds: 8 };
  const lead = { status: "queued", attempts: 1, callFile: "dlr-a.call" };
  _test.finishDialerLead(campaign, lead, { status: "no_answer", label: "Nao atendeu", retryable: true }, 1_000);
  assert.equal(lead.status, "pending");
  assert.equal(lead.nextAttemptAt, new Date(9_000).toISOString());

  lead.status = "queued";
  lead.attempts = 2;
  lead.callFile = "dlr-b.call";
  _test.finishDialerLead(campaign, lead, { status: "no_answer", label: "Nao atendeu", retryable: true }, 2_000);
  assert.equal(lead.status, "no_answer");
  assert.equal(lead.nextAttemptAt, "");
});

test("reports real campaign progress instead of queued calls as complete", () => {
  const stats = _test.dialerStats({
    numbers: [
      { status: "pending" },
      { status: "queued" },
      { status: "accepted" },
      { status: "answered" },
      { status: "no_answer" },
      { status: "busy" },
      { status: "failed" }
    ]
  });

  assert.deepEqual(
    { total: stats.total, pending: stats.pending, inProgress: stats.inProgress, accepted: stats.accepted, completed: stats.completed },
    { total: 7, pending: 1, inProgress: 1, accepted: 1, completed: 5 }
  );
});
