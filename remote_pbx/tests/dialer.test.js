const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { _test } = require("../server");
const { defaultConfig } = require("../src/store");
const { renderQueues } = require("../src/asterisk");
const { renderModules, renderPjsip, renderExtensions, outboundNumberTarget } = require("../src/asterisk");

test("loads the Asterisk modules required by call files and DTMF events", () => {
  const modules = renderModules();
  assert.match(modules, /^load = pbx_spool\.so$/m);
  assert.match(modules, /^load = app_userevent\.so$/m);
});

test("grants the application read-only access to archived call results", () => {
  const helper = fs.readFileSync(path.join(__dirname, "..", "scripts", "asterisk-control-root.sh"), "utf8");
  assert.match(helper, /mktemp \/var\/spool\/asterisk\/\.dialer\.XXXXXX/);
  assert.doesNotMatch(helper, /mktemp \/var\/spool\/asterisk\/outgoing\//);
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
  assert.equal(_test.dialerResultFromReport(null, "expired").status, "failed");
  assert.equal(_test.dialerResultFromReport({ disposition: "FAILED" }, "completed").status, "failed");
});

test("prefers the accepted CDR when an earlier answered CDR has the same attempt", () => {
  const reports = [
    { accountCode: "dlr-same", disposition: "ANSWERED", userField: "dialer:dlr-same:answered:3499" },
    { accountCode: "dlr-same", disposition: "ANSWERED", userField: "dialer:dlr-same:accepted:3499" }
  ];
  const report = _test.dialerReportForAttempt(reports, "dlr-same");
  assert.match(report.userField, /:accepted:/);
  assert.equal(_test.dialerResultFromReport(report, "completed").status, "accepted");
});

test("keeps the newest report rows regardless of database row order", () => {
  const reports = Array.from({ length: 205 }, (_, index) => ({ startedAt: new Date(Date.UTC(2026, 8, 1, 0, index)).toISOString(), id: index }));
  const recent = _test.recentReportCalls(reports, 200);
  assert.equal(recent[0].id, 204);
  assert.equal(recent.at(-1).id, 5);
});

test("does not replace an empty database user field with the linked call id", () => {
  const call = _test.mapDbCdrRow({
    calldate: new Date("2026-09-14T15:19:49.000Z"),
    start_at: new Date("2026-09-14T15:19:49.000Z"),
    uniqueid: "1789399189.522",
    linkedid: "1789399176.519",
    userfield: ""
  }, 0, defaultConfig);
  assert.equal(call.linkedId, "1789399176.519");
  assert.equal(call.userField, "");
});

test("normalizes Asterisk channel suffixes to configured report trunks", () => {
  const config = structuredClone(defaultConfig);
  config.trunks = [
    { id: "trunk-operadora", sipServer: "192.0.2.10" },
    { id: "trunk-2", sipServer: "192.0.2.11" }
  ];

  assert.equal(_test.normalizeReportTrunk("PJSIP/trunk-2-00000107", config), "trunk-2");
  assert.equal(_test.normalizeReportTrunk("trunk-operadora-000000f7", config), "trunk-operadora");
  assert.equal(_test.normalizeReportTrunk("PJSIP/777-00000108", config), "");

  const call = _test.mapDbCdrRow({
    calldate: new Date("2026-09-14T15:19:49.000Z"),
    channel: "PJSIP/trunk-2-00000107",
    trunk: "trunk-2-00000107",
    uniqueid: "report-trunk-test"
  }, 0, config);
  assert.equal(call.trunk, "trunk-2");
});

test("trunk chart omits internal calls without a trunk", () => {
  const chart = _test.buildChartData([
    { trunk: "trunk-operadora", startedAt: "2026-09-14T10:00:00.000Z", duration: 10, billsec: 5 },
    { trunk: "", startedAt: "2026-09-14T10:01:00.000Z", duration: 10, billsec: 5 }
  ]);
  assert.deepEqual(chart.byTrunk.map((item) => item.label), ["trunk-operadora"]);
});

test("keeps accepted dialer metadata when call legs are grouped", () => {
  const [call] = _test.collapseReportCallLegs([
    { id: "agent", linkedId: "linked-1", userField: "linked-1", status: "answered", billsec: 30, duration: 35, destinationChannel: "PJSIP/705", lastApp: "Dial" },
    { id: "customer", linkedId: "linked-1", userField: "dialer:dlr-grouped:accepted:3499", status: "no_answer", billsec: 3, duration: 3, destinationChannel: "Local/705", lastApp: "Queue" }
  ]);
  assert.equal(call.userField, "dialer:dlr-grouped:accepted:3499");
});

test("queues keep dialer callers waiting while busy agents are skipped", () => {
  const output = renderQueues({ queues: [{ id: "85", strategy: "ringall", timeout: 20, members: ["777", "505"] }] });
  assert.match(output, /autofill=yes/);
  assert.match(output, /joinempty=yes/);
  assert.match(output, /leavewhenempty=no/);
  assert.match(output, /ringinuse=no/);
  assert.match(output, /member => Local\/777@queue-member\/n,1,777,hint:777@queue-state/);
  assert.match(output, /member => Local\/505@queue-member\/n,1,505,hint:505@queue-state/);
});

test("dialer accepts negotiated trunk DTMF and waits at least 15 seconds", () => {
  const config = structuredClone(defaultConfig);
  config.trunks = [{ id: "trunk-main", active: true, sipServer: "192.0.2.10", sipUser: "1000", sipPassword: "secret", codecs: ["alaw", "ulaw"] }];
  assert.match(renderPjsip(config), /\[trunk-main\][\s\S]*dtmf_mode=auto/);
  const dialplan = renderExtensions(config);
  assert.match(dialplan, /Set\(PJSIP_DTMF_MODE\(\)=inband\)/);
  assert.match(dialplan, /WaitExten\(\$\{DIALER_TIMEOUT\}\)/);
  const callFile = _test.dialerCallFileContent(config, { responseTimeout: 8, trunkIds: ["trunk-main"] }, { number: "34991708282" });
  assert.match(callFile, /^Setvar: DIALER_TIMEOUT=15$/m);
  const endpoints = renderPjsip({ ...config, extensions: [{ ...config.extensions[0], number: "777" }] });
  assert.match(endpoints, /\[777\][\s\S]*device_state_busy_at=1/);
  assert.match(endpoints, /\[web-777\][\s\S]*device_state_busy_at=1/);
});

test("expired archives preserve the actual call result", () => {
  for (const disposition of ["FAILED", "CONGESTION", "CHANUNAVAIL", "REJECTED"]) {
    assert.equal(_test.dialerResultFromReport({ disposition }, "expired").status, "failed");
  }
  assert.equal(_test.dialerResultFromReport({ disposition: "NO ANSWER" }, "expired").status, "no_answer");
  assert.equal(_test.dialerResultFromReport({ disposition: "ANSWERED" }, "expired").status, "answered");
});

test("campaign calls apply outbound numbering while retaining the original target", () => {
  const config = { outbound: { nationalPrefix: "0", areaCode: "34" } };
  const content = _test.dialerCallFileContent(config, { trunkIds: ["trunk-main"] }, { number: "34991708282" });
  assert.match(content, /^Channel: PJSIP\/034991708282@trunk-main$/m);
  assert.match(content, /^Setvar: DIALER_TARGET=34991708282$/m);
  assert.equal(outboundNumberTarget(config, "034991708282"), "034991708282");
  assert.equal(outboundNumberTarget(config, "991708282"), "034991708282");
  assert.equal(outboundNumberTarget(config, "0991708282"), "034991708282");
  assert.equal(outboundNumberTarget(config, "38221234"), "03438221234");
  assert.equal(outboundNumberTarget(config, "5534991708282"), "34991708282");
  assert.equal(outboundNumberTarget(config, "05534991708282"), "34991708282");
  assert.equal(outboundNumberTarget({}, "34991708282"), "34991708282");
  assert.equal(outboundNumberTarget({ outbound: { areaCode: "34", prependAreaCodeToLocal: false } }, "991708282"), "991708282");
  assert.equal(outboundNumberTarget({ outbound: { dialPrefix: "55", stripDigits: 1 } }, "034991708282"), "5534991708282");
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

test("campaign list stays compact and detailed report groups failures and trunks", () => {
  const campaign = {
    id: "camp-1", name: "Teste", status: "paused",
    numbers: [
      { number: "34990000001", status: "failed", attempts: 2, lastResult: "Sem rota", trunkId: "trunk-2" },
      { number: "34990000002", status: "accepted", attempts: 1, lastResult: "Atendida", trunkId: "trunk-main" },
      { number: "34990000003", status: "failed", attempts: 2, lastResult: "Sem rota", trunkId: "trunk-2" }
    ]
  };
  const listItem = _test.publicDialerCampaign(campaign);
  assert.equal(listItem.numbers, undefined);
  assert.equal(listItem.stats.total, 3);
  const report = _test.dialerCampaignReport(campaign);
  assert.deepEqual(report.reasons[0], { label: "Sem rota", count: 2 });
  assert.ok(report.byTrunk.some((row) => row.trunk === "trunk-2" && row.status === "failed" && row.count === 2));
  assert.equal(report.numbers.length, 3);
});

test("queue inference never treats dialer timeout or audio filename as Retenção", () => {
  const config = { queues: [{ id: "15", name: "RETENÇÃO" }, { id: "DIscador-equipamento", name: "Equipamentos" }] };
  assert.equal(_test.inferQueue({ dcontext: "dialer-interactive", lastapp: "WaitExten", lastdata: "15" }, config), "");
  assert.equal(_test.inferQueue({ dcontext: "dialer-interactive", lastapp: "BackGround", lastdata: "custom/audio-15" }, config), "");
  assert.equal(_test.inferQueue({ dcontext: "dialer-interactive", lastapp: "Queue", lastdata: "DIscador-equipamento,tT" }, config), "DIscador-equipamento");
  assert.equal(_test.inferQueue({ dcontext: "queue-15", lastapp: "Dial" }, config), "15");
});

test("trunk cards distinguish configuration from live SIP registration", () => {
  const config = { trunks: [
    { id: "trunk-operadora", active: true },
    { id: "trunk-2", active: true },
    { id: "trunk-disabled", active: false }
  ] };
  const registrations = [
    { id: "trunk-operadora-registration", status: "Registered" },
    { id: "trunk-2-registration", status: "Rejected" },
    { id: "trunk-disabled-registration", status: "Registered" }
  ];
  assert.deepEqual(_test.trunkRegistrationStates(config, registrations), {
    "trunk-operadora": "registered", "trunk-2": "rejected", "trunk-disabled": "disabled"
  });
  assert.equal(_test.trunkRegistrationStates(config, [])["trunk-operadora"], "unregistered");
});
