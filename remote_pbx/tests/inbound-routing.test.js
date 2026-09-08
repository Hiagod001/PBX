const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { defaultConfig, normalizeConfig } = require("../src/store");
const { renderExtensions, renderModules } = require("../src/asterisk");
const { validateConfig } = require("../src/validation");

function configFixture() {
  const config = structuredClone(defaultConfig);
  config.trunks = [
    { ...config.trunk, id: "carrier-a", sipServer: "192.0.2.10", inboundDestinationType: "ivr", inboundDestination: "main" },
    { ...config.trunk, id: "carrier-b", sipServer: "192.0.2.11", inboundDestinationType: "none", inboundDestination: "" }
  ];
  config.inboundRoutes = [
    { id: "did-a", trunkId: "carrier-a", did: "551100001111", destinationType: "ivr", destination: "main" },
    { id: "did-b", trunkId: "carrier-b", did: "551100001111", destinationType: "queue", destination: "support" },
    { id: "default-b", trunkId: "carrier-b", did: "", destinationType: "none", destination: "" },
    { id: "disabled", trunkId: "carrier-a", did: "551100002222", active: false, destinationType: "none", destination: "" }
  ];
  return config;
}

function context(dialplan, id) {
  const start = dialplan.indexOf(`[${id}]`);
  assert.ok(start >= 0, `Missing context ${id}`);
  const end = dialplan.indexOf("\n[", start);
  return dialplan.slice(start, end < 0 ? undefined : end);
}

test("DID routing is scoped to each trunk with an independent default and disabled routes", () => {
  const config = configFixture();
  assert.doesNotThrow(() => validateConfig(config));
  const plan = renderExtensions(config);
  const a = context(plan, "inbound-trunk-carrier-a");
  const b = context(plan, "inbound-trunk-carrier-b");
  assert.match(a, /Goto\(inbound-route-did-a,s,1\)/);
  assert.doesNotMatch(a, /did-b|551100002222/);
  assert.match(b, /Goto\(inbound-route-did-b,s,1\)/);
  assert.match(b, /Goto\(inbound-route-default-b,s,1\)/);
  assert.match(a, /Goto\(inbound-route-trunk-carrier-a,s,1\)/);
  assert.match(context(plan, "inbound-route-default-b"), /Hangup\(\)/);
});

test("duplicate DIDs on the same trunk are rejected but may exist on different trunks", () => {
  const config = configFixture();
  config.inboundRoutes[1].trunkId = "carrier-a";
  assert.throws(() => validateConfig(config), /Numero de entrada no mesmo tronco duplicado/);
});

test("queue final destinations support another queue, none and unchanged legacy routing", () => {
  const config = configFixture();
  config.queues.push({ ...config.queues[0], id: "overflow", number: "601", fallbackType: "none", fallback: "" });
  config.queues[0].fallbackType = "queue";
  config.queues[0].fallback = "overflow";
  assert.doesNotThrow(() => validateConfig(config));
  const plan = renderExtensions(config);
  assert.match(context(plan, "queue-support"), /Gosub\(queue-overflow,s,1\)/);
  assert.match(context(plan, "queue-overflow"), /Hangup\(\)/);
  assert.match(context(plan, "ringgroup-reception"), /Goto\(internal,201,1\)/);
  config.queues[1].fallbackType = "queue";
  config.queues[1].fallback = "support";
  assert.throws(() => validateConfig(config), /Ciclo no destino final/);
  config.queues[1].fallback = "missing";
  assert.throws(() => validateConfig(config), /Fila de destino final nao encontrada/);
});

test("voicemail is absent from call flow even in legacy enabled configurations", () => {
  const config = configFixture();
  config.voicemail.enabled = true;
  config.extensions.forEach((extension) => { extension.voicemail = true; });
  assert.doesNotMatch(renderExtensions(config), /VoiceMail\(/i);
  assert.doesNotMatch(renderModules(), /^load = app_voicemail\.so$/m);
  const normalized = normalizeConfig(config);
  assert.equal(normalized.voicemail.enabled, false);
  assert.ok(normalized.extensions.every((extension) => extension.voicemail === false));
});

test("new IVRs start empty and show only explicitly added resources", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  const names = ["createIvrRootMenu", "ivrTargetCards", "ivrTargetCardByDestination"];
  const functions = names.map((name) => {
    const start = source.indexOf(`function ${name}(`);
    return source.slice(start, source.indexOf("\n}", start) + 2);
  }).join("\n");
  const cfg = configFixture();
  const sandbox = {
    state: { config: cfg },
    ensureIvrMenus: () => cfg.ivr.menus,
    ensureConfigTrunks: () => cfg.trunks,
    ensureHiddenTargetCards: () => sandbox.menu.hiddenTargetCards,
    ensureIvrTimeConditions: () => sandbox.menu.timeConditions,
    ensureIvrDuplicateTargetCards: () => sandbox.menu.duplicateTargetCards,
    currentIvrWorkspaceMenu: () => sandbox.menu,
    ensureIvrFlowLayout: () => sandbox.menu.flowLayout,
    trunkLabel: (trunk) => trunk.id
  };
  vm.createContext(sandbox);
  vm.runInContext(functions + "\nmenu = createIvrRootMenu();", sandbox);
  assert.equal(sandbox.menu.options.length, 0);
  assert.equal(sandbox.menu.timeConditions.length, 0);
  assert.equal(sandbox.menu.greeting, "");
  assert.equal(vm.runInContext("ivrTargetCards().length", sandbox), 0);
  sandbox.menu.flowLayout["queue:support"] = { x: 900, y: 90 };
  assert.equal(vm.runInContext("ivrTargetCards().length", sandbox), 1);
  assert.equal(cfg.trunks[0].inboundDestination, "main");
});
