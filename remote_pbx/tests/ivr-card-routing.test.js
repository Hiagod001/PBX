const test = require("node:test");
const assert = require("node:assert/strict");
const { defaultConfig } = require("../src/store");
const { renderExtensions } = require("../src/asterisk");
const { validateConfig } = require("../src/validation");

test("a submenu reached directly answers and exposes only its own keys and configured extensions", () => {
  const config = structuredClone(defaultConfig);
  config.ivr.menus = [{
    id: "secondary", allowDirectDial: true,
    options: [{ digit: "1", destinationType: "ivr", destination: "main" }]
  }];
  const section = renderExtensions(config).split("[ivr-secondary]")[1].split("\n[")[0];
  assert.match(section, /Answer\(\)/);
  assert.match(section, /exten => 201,1,Goto\(internal,201,1\)/);
  assert.match(section, /Goto\(ivr-main,s,1\)/);
  assert.doesNotMatch(section, /include => internal/);
});

test("independent schedules may share a queue but cannot link to a missing target or route in circles", () => {
  const config = structuredClone(defaultConfig);
  const hours = (id) => ({ id, inDestinationType: "queue", inDestination: "support" });
  const a = hours("weekdays");
  const b = hours("weekend");
  config.ivr.timeConditions = [a, b];
  assert.doesNotThrow(() => validateConfig(config));
  Object.assign(a, { outDestinationType: "timeCondition", outDestination: b.id });
  Object.assign(b, { outDestinationType: "timeCondition", outDestination: a.id });
  assert.throws(() => validateConfig(config), /ciclo/);
  b.outDestination = "missing";
  assert.throws(() => validateConfig(config), /destino não encontrado/);
});
