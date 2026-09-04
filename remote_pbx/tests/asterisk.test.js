const test = require("node:test");
const assert = require("node:assert/strict");

const { defaultConfig } = require("../src/store");
const { renderPjsip, renderExtensions, renderQueues, renderModules } = require("../src/asterisk");

function queueConfig() {
  const config = structuredClone(defaultConfig);
  config.extensions = [{ ...config.extensions[0], number: "505", name: "Operador" }];
  config.queues = [{ id: "85", number: "85", name: "Suporte", strategy: "ringall", timeout: 20, maxWait: 45, members: ["505"], fallback: "505" }];
  config.ringGroups = [{ id: "recepcao", name: "Recepcao", timeout: 25, members: ["505"], fallback: "505" }];
  config.inboundRoutes = [];
  config.ivr = {
    ...config.ivr,
    id: "main",
    active: true,
    options: [{ digit: "1", label: "Operador", destinationType: "extension", destination: "505" }],
    menus: [{
      id: "secondary",
      name: "URA secundaria",
      active: true,
      greeting: "",
      timeoutSeconds: 12,
      menuRepeat: 2,
      options: [{ digit: "2", label: "Fila", destinationType: "queue", destination: "85" }],
      timeConditions: []
    }]
  };
  return config;
}

test("queue members expose aggregate SIP device state", () => {
  const config = queueConfig();
  const queues = renderQueues(config);
  const dialplan = renderExtensions(config);
  assert.match(queues, /member => Local\/505@queue-member\/n,1,505,hint:505@queue-state/);
  assert.match(dialplan, /\[queue-state\]/);
  assert.match(dialplan, /exten => 505,hint,PJSIP\/505&PJSIP\/web-505/);
});

test("PJSIP keeps a warm worker pool for registration traffic", () => {
  const pjsip = renderPjsip(queueConfig());
  assert.match(pjsip, /\[system\]/);
  assert.match(pjsip, /threadpool_initial_size=16/);
  assert.match(pjsip, /threadpool_max_size=64/);
  assert.match(pjsip, /\[transport-ws\]/);
  assert.doesNotMatch(pjsip, /\[transport-wss\]/);
});

test("live call monitoring loads ChanSpy on every Asterisk start", () => {
  assert.match(renderModules(), /load = app_chanspy\.so/);
});

test("queue dialplan refuses to return a call to its originating extension", () => {
  const dialplan = renderExtensions(queueConfig());
  assert.match(dialplan, /CALLERID\(num\).*EXTEN.*\?self/);
  assert.match(dialplan, /Hangup\(21\)/);
});

test("separate IVRs keep independent options", () => {
  const dialplan = renderExtensions(queueConfig());
  const mainStart = dialplan.indexOf("[ivr-main]");
  const secondaryStart = dialplan.indexOf("[ivr-secondary]");
  assert.ok(mainStart >= 0);
  assert.ok(secondaryStart > mainStart);
  const mainBlock = dialplan.slice(mainStart, secondaryStart);
  const secondaryBlock = dialplan.slice(secondaryStart);
  assert.match(mainBlock, /exten => 1,1/);
  assert.doesNotMatch(mainBlock, /exten => 2,1/);
  assert.match(secondaryBlock, /exten => 2,1/);
  assert.match(mainBlock, /Set\(CDR\(userfield\)=ivr:main:1\)/);
  assert.match(secondaryBlock, /Set\(CDR\(userfield\)=ivr:secondary:2\)/);
  assert.match(secondaryBlock, /Set\(TIMEOUT\(response\)=12\)/);
  assert.match(secondaryBlock, /Set\(IVR_MAX_ATTEMPTS=2\)/);
});

test("queues enforce max wait and the dialer reuses the queue context", () => {
  const dialplan = renderExtensions(queueConfig());
  assert.match(dialplan, /Queue\(85,tT,,,45\)/);
  assert.match(dialplan, /Gosub\(queue-\$\{DIALER_DESTINATION\},s,1\)/);
});

test("ring groups honor the configured timeout", () => {
  const dialplan = renderExtensions(queueConfig());
  const ringGroupStart = dialplan.indexOf("[ringgroup-recepcao]");
  const queueStart = dialplan.indexOf("[queue-85]", ringGroupStart);
  const ringGroupBlock = dialplan.slice(ringGroupStart, queueStart);
  assert.match(ringGroupBlock, /Dial\([^\n]+,25,tT\)/);
  assert.doesNotMatch(ringGroupBlock, /Dial\([^\n]+,60,tT\)/);
});
