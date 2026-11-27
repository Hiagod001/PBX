const { test } = require("node:test");
const assert = require("node:assert/strict");
const { defaultConfig } = require("../src/store");
const { validateConfig } = require("../src/validation");

test("SIP network settings support host addresses, CIDRs and an empty list", () => {
  for (const allowedSipNetworks of [[], ["192.0.2.8", "192.0.2.0/24", "2001:db8::8", "2001:db8::/64"]]) {
    const config = structuredClone(defaultConfig);
    config.security.allowedSipNetworks = allowedSipNetworks;
    assert.doesNotThrow(() => validateConfig(config));
  }
});

test("invalid SIP network settings identify the field before the configuration is saved", () => {
  for (const invalid of ["example.com", "192.0.2.0/33", "2001:db8::/129", "fe80::1%eth0", "192.0.2.1/24/8"]) {
    const config = structuredClone(defaultConfig);
    config.security.allowedSipNetworks = [invalid];
    assert.throws(() => validateConfig(config), /Redes SIP permitidas/);
  }
});
