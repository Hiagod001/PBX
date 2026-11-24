const test = require("node:test");
const assert = require("node:assert/strict");
const { WhatsAppDialer, whatsappNumber, whatsappCallFile, whatsappOutcome } = require("../src/whatsapp-dialer");
const { renderExtensions, renderModules } = require("../src/asterisk");
const { defaultConfig } = require("../src/store");
const id = "d6cf5f8e-03ac-44b3-91ae-39f34e7b206c";
function fixture() {
  const campaign = { id: "wa-test", transport: "whatsapp", status: "running", destinationType: "extension", destination: "777", intervalSeconds: 3,
    retryAttempts: 1, numbers: [{ number: "3431950861", status: "pending", attempts: 0 }] };
  let data = [campaign];
  const dialer = new WhatsAppDialer({
    readCampaigns: async () => structuredClone(data),
    updateCampaigns: async (mutate) => { data = await mutate(structuredClone(data)); },
    enqueue: async () => {}, finish: (_c, lead, outcome) => { lead.status = outcome.status; lead.lastResult = outcome.label; },
    reports: async () => [], reportForAttempt: () => null
  });
  dialer.settings = async () => ({ audioSocketAddress: "127.0.0.1:3099" });
  dialer.status = async () => ({ connected: true, busy: false });
  return { dialer, data: () => data, config: { extensions: [{ number: "777" }] } };
}

test("WhatsApp preserves the exact phone, never invents a ninth digit, and rejects unsafe call-file values", () => {
  assert.equal(whatsappNumber("34 3195-0861"), "553431950861");
  assert.equal(whatsappNumber("553491660149"), "553491660149");
  assert.throws(() => whatsappNumber("123"));
  const campaign = { id: "wa-test", destinationType: "queue", destination: "equipamentos" };
  const lead = { number: "3431950861", waCallId: id, attemptId: `wa-${id}` };
  const file = whatsappCallFile(campaign, lead);
  assert.match(file, /^Channel: AudioSocket\/127\.0\.0\.1:3099\/.+\/c\(slin\)$/m);
  assert.match(file, /^CallerID: WhatsApp <553431950861>$/m);
  assert.match(file, /^Context: dialer-whatsapp$/m);
  assert.doesNotMatch(file, /DIALER_AUDIO|DIALER_DIGIT/);
  assert.throws(() => whatsappCallFile({ ...campaign, destination: "queue\nChannel: other" }, lead));
  assert.throws(() => whatsappCallFile(campaign, lead, "attacker:9099"));
});

test("a timed-out dispatch is reconciled with the same durable id instead of dialing twice", async () => {
  const { dialer, data, config } = fixture();
  let posts = 0, remote;
  dialer.request = async (route, options) => {
    if (options?.method === "POST") {
      posts++; assert.equal(data()[0].numbers[0].status, "queued");
      remote = { ...options.body, phase: "ringing" }; throw new Error("timeout after acceptance");
    }
    return remote;
  };
  await dialer.tick(config); await dialer.tick(config);
  assert.equal(posts, 1);
  assert.equal(data()[0].numbers[0].attempts, 1);
  assert.equal(data()[0].numbers[0].waCallId, remote.id);
});

test("callbacks are serialized and attach only after recipient acceptance, including while paused", async () => {
  const { dialer, data, config } = fixture();
  let bridges = 0;
  dialer.request = async () => ({});
  dialer.enqueue = async () => { bridges++; };
  await dialer.tick(config);
  const lead = data()[0].numbers[0]; data()[0].status = "paused";
  const record = { id: lead.waCallId, number: "553431950861", phase: "ringing" };
  await dialer.event(record, config); assert.equal(bridges, 0);
  record.phase = "answered";
  await Promise.all([dialer.event(record, config), dialer.event(record, config)]);
  assert.equal(bridges, 1);
  assert.equal(data()[0].numbers[0].waBridgeSubmitted, true);
});

test("one linked WhatsApp account cannot dispatch two campaigns concurrently", async () => {
  const { dialer, data, config } = fixture();
  data().push({ ...structuredClone(data()[0]), id: "wa-test-2" });
  let posts = 0;
  dialer.request = async (_route, opts) => { if (opts?.method === "POST") posts++; return { phase: "ringing" }; };
  await dialer.tick(config); await dialer.tick(config);
  assert.equal(posts, 1);
  assert.equal(data().flatMap((c) => c.numbers).filter((l) => l.status === "queued").length, 1);
});

test("busy before sending does not consume an attempt and pause prevents a new dispatch", async () => {
  const { dialer, data, config } = fixture();
  dialer.request = async () => { throw Object.assign(new Error("busy"), { status: 409 }); };
  await dialer.tick(config);
  assert.equal(data()[0].numbers[0].status, "pending");
  assert.equal(data()[0].numbers[0].attempts, 0);
  data()[0].status = "paused";
  dialer.request = async () => { assert.fail("paused campaign must not dial"); };
  await dialer.tick(config);
});

test("WhatsApp results distinguish recipient answer from an actual agent conversation", () => {
  assert.equal(whatsappOutcome({ result: "completed", answered_at: 123 }).status, "answered");
  assert.equal(whatsappOutcome({ result: "completed", answered_at: 123 }, true).status, "accepted");
  assert.equal(whatsappOutcome({ result: "no_answer" }).status, "no_answer");
  assert.equal(whatsappOutcome({ result: "interrupted" }).retryable, false);
  assert.equal(whatsappOutcome({ result: "not_registered" }).retryable, false);
  assert.deepEqual(whatsappOutcome({ result: "declined" }), {status:"canceled",label:"A pessoa recusou a ligação no WhatsApp",retryable:false});
  assert.equal(whatsappOutcome({ result: "busy" }).status, "busy");
  assert.equal(whatsappOutcome({ result: "ended_before_answer" }).status, "canceled");
});

test("late imported agent results correct the report without dialing the customer again", async () => {
  const {dialer,data,config}=fixture();
  Object.assign(data()[0].numbers[0],{status:"answered",attempts:1,attemptId:`wa-${id}`,completedAt:new Date().toISOString()});
  data()[0].status="done";
  dialer.acceptedAttempt=async()=>true;
  dialer.request=async()=>assert.fail("late result must not make a new call");
  await dialer.tick(config);
  assert.equal(data()[0].numbers[0].status,"accepted");
  assert.equal(data()[0].numbers[0].attempts,1);
});

test("WhatsApp reports and extension history show the customer phone instead of the socket or agent", () => {
  const { _test } = require("../server");
  const call = _test.mapDbCdrRow({
    uniqueid: "wa-report", src: "553431950861", dst: "s", channel: `AudioSocket/127.0.0.1:3099/${id}`,
    dstchannel: "PJSIP/web-777-00000001", userfield: `dialer:wa-${id}:answered:553431950861:whatsapp;dialer:wa-${id}:accepted:553431950861:whatsapp`,
    direction: "outbound", trunk: "WhatsApp", accountcode: `wa-${id}`, disposition: "ANSWERED"
  }, 0, { ...defaultConfig, extensions: [{ number: "777", name: "Hiago" }] });
  assert.equal(call.destination, "553431950861");
  assert.equal(call.trunk, "WhatsApp");
  assert.equal(_test.compactExtensionCall(call).customerNumber, "553431950861");
});

test("WhatsApp dialplan records calls and routes only to the exact queue without audio or DTMF", () => {
  const config = structuredClone(defaultConfig);
  const extensions = renderExtensions(config);
  const context = extensions.split("[dialer-whatsapp]")[1].split("[wa-agent-connected]")[0];
  assert.match(context, /Gosub\(record-call/);
  assert.match(context, /Queue\(.+,tT,,,\d+,,,wa-agent-connected\)/);
  assert.doesNotMatch(context, /Background\(|Playback\(|WaitExten\(|Gosub\(queue-/);
  assert.match(extensions, /CDR\(userfield\)=dialer:\$\{WA_ATTEMPT_ID\}:accepted:/);
  assert.match(renderModules(), /load = chan_audiosocket.so/);
});
