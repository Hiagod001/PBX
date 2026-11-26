const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const policy = require("../public/trunk-policy");
const { defaultConfig, normalizeConfig } = require("../src/store");
const { renderExtensions, renderPjsip } = require("../src/asterisk");
const { validateConfig } = require("../src/validation");
const { _test } = require("../server");

function fixture() {
  const config = structuredClone(defaultConfig);
  config.trunk = { ...config.trunk, id: "algar", mainNumber: "38188100", usage: "inbound", sipServer: "192.0.2.10" };
  config.trunks = [
    { ...config.trunk, name: "Algar receptivo" },
    { ...defaultConfig.trunk, id: "outbound", name: "Saída", mainNumber: "3431950817", sipServer: "192.0.2.11", usage: "outbound" }
  ];
  config.outbound.defaultTrunk = "algar";
  config.inboundRoutes = [{ id: "algar-number", trunkId: "algar", did: "38188100", destinationType: "ivr", destination: "main" }];
  return config;
}

function context(text, id) {
  const start = text.indexOf(`[${id}]`);
  assert.ok(start >= 0, `Missing ${id}`);
  const end = text.indexOf("\n[", start);
  return text.slice(start, end < 0 ? undefined : end);
}

test("legacy trunks still allow entry and exit, and browser and server use the same policy", () => {
  assert.equal(policy.allows({}, "inbound"), true);
  assert.equal(policy.allows({}, "outbound"), true);
  const browser = {};
  vm.runInNewContext(fs.readFileSync(require.resolve("../public/trunk-policy"), "utf8"), browser);
  assert.equal(browser.PbxTrunkPolicy.allows({ usage: "inbound" }, "outbound"), false);
  assert.equal(normalizeConfig(structuredClone(defaultConfig)).trunks[0].usage, "both");
});

test("inbound-only number has its own entry while extension calls use a different trunk and caller ID", () => {
  const config = normalizeConfig(fixture());
  assert.equal(config.outbound.defaultTrunk, "outbound");
  const plan = renderExtensions(config);
  assert.match(plan, /^TRUNK_ENDPOINT=outbound$/m);
  assert.match(context(plan, "inbound-trunk-algar"), /38188100,1,Set\(__INBOUND_DID=\$\{EXTEN\}\)\n same => n,Goto\(inbound-route-algar-number,s,1\)/);
  const out = context(plan, `outbound-${config.extensions[0].number}`);
  assert.match(out, /Set\(CALLERID\(num\)=3431950817\)/);
  assert.doesNotMatch(out, /38188100|@algar/);
  assert.match(_test.previewOutboundDial(config, config.extensions[0].number, "31950861").dialString, /@outbound$/);
  assert.deepEqual(_test.configTrunks(config).map(t => t.id), ["outbound"]);
  assert.deepEqual(_test.normalizeDialerTrunkIds({ trunkIds: ["algar"] }, null, config), ["outbound"]);
});

test("an inbound-only installation cannot fall back to that trunk for extension calls or campaigns", () => {
  const raw = fixture();
  raw.trunks.pop();
  const config = normalizeConfig(raw);
  assert.equal(config.outbound.defaultTrunk, "");
  assert.equal(policy.outboundTrunk(config), null);
  assert.deepEqual(_test.configTrunks(config), []);
  assert.deepEqual(_test.normalizeDialerTrunkIds({}, null, config), []);
  const out = context(renderExtensions(config), `outbound-${config.extensions[0].number}`);
  assert.match(out, /Hangup\(21\)/);
  assert.doesNotMatch(out, /Dial\(/);
  assert.equal(_test.previewOutboundDial(config, config.extensions[0].number, "31950861").permitted, false);
});

test("outbound-only trunks reject entry and cannot be assigned an active inbound route", () => {
  const config = fixture();
  const pjsip = renderPjsip(config);
  assert.match(context(pjsip, "outbound"), /context=inbound-blocked/);
  assert.doesNotMatch(renderExtensions(config), /\[inbound-trunk-outbound\]/);
  config.inboundRoutes[0].trunkId = "outbound";
  assert.throws(() => validateConfig(config), /somente para saída/);
  config.inboundRoutes[0].active = false;
  assert.doesNotThrow(() => validateConfig(config));
});

test("pending carrier setup stays saved without registration or changes to existing outgoing calls", () => {
  const config = fixture();
  config.trunks[0].active = false;
  config.trunk.active = false;
  config.inboundRoutes[0].active = false;
  const normalized = normalizeConfig(config);
  assert.equal(normalized.outbound.defaultTrunk, "outbound");
  assert.equal(normalized.trunks.find(t => t.id === "algar").usage, "inbound");
  assert.doesNotMatch(renderPjsip(normalized), /\[algar(?:-registration)?\]/);
  config.trunks[0].usage = "anything";
  assert.throws(() => validateConfig(config), /Uso do tronco/);
});

test("IP-authenticated entry does not generate credentials or registration and keeps source identification", () => {
  const config = fixture();
  config.trunks[0].authMode = "ip";
  const pjsip = renderPjsip(config);
  assert.match(context(pjsip, "algar"), /context=inbound-trunk-algar/);
  assert.doesNotMatch(context(pjsip, "algar"), /outbound_auth|from_user/);
  assert.match(context(pjsip, "algar"), /^identify_by=ip$/m);
  assert.doesNotMatch(pjsip, /\[algar-auth\]|\[algar-registration\]/);
  assert.match(context(pjsip, "algar-identify"), /match=192\.0\.2\.10/);
  assert.match(context(pjsip, "algar-aor"), /qualify_frequency=30/);
  assert.match(pjsip, /\[outbound-registration\]/);
  assert.equal(_test.trunkRegistrationStates(config, []).algar, "ip");
  config.trunks[0].authMode = "registration";
  assert.match(renderPjsip(config), /\[algar-registration\]/);
  assert.equal(_test.trunkRegistrationStates(config, []).algar, "unregistered");
});

test("entry and outgoing selectors never list a trunk in the wrong direction", () => {
  const config = fixture();
  const source = fs.readFileSync(require.resolve("../public/app.js"), "utf8");
  const start = source.indexOf("function trunkChoices(");
  const end = source.indexOf("\nfunction ", start + 1);
  const sandbox = {
    PbxTrunkPolicy: policy, ensureConfigTrunks: () => config.trunks,
    trunkLabel: t => t.name, option: id => id + ","
  };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), sandbox);
  assert.equal(sandbox.trunkChoices("algar", "inbound"), "algar,");
  assert.equal(sandbox.trunkChoices("outbound", "outbound"), "outbound,");
});
