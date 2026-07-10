const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PBX_DATABASE_ENABLED = "false";

const { _test } = require("../server");

function responseStub() {
  return {
    statusCode: 200,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    }
  };
}

test("administrative middleware blocks regular users", () => {
  const response = responseStub();
  let nextCalled = false;
  _test.requireAdmin({ session: { user: { role: "user" } } }, response, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, false);
  assert.equal(response.statusCode, 403);
});

test("administrative middleware allows administrators", () => {
  const response = responseStub();
  let nextCalled = false;
  _test.requireAdmin({ session: { user: { role: "admin" } } }, response, () => {
    nextCalled = true;
  });
  assert.equal(nextCalled, true);
  assert.equal(response.statusCode, 200);
});

test("non-admin configuration never exposes telephony secrets", () => {
  const config = {
    trunk: { sipUser: "operator", sipPassword: "trunk-secret" },
    trunks: [{ id: "main", sipPassword: "secondary-secret" }],
    extensions: [{ number: "505", secret: "extension-secret" }],
    voicemail: { defaultPin: "1234" }
  };
  const result = _test.configForUser(config, { session: { user: { role: "supervisor" } } });
  assert.equal(result.trunk.sipPassword, "");
  assert.equal(result.trunks[0].sipPassword, "");
  assert.equal(result.extensions[0].secret, "");
  assert.equal(result.voicemail.defaultPin, "");
  assert.equal(config.extensions[0].secret, "extension-secret");
});

test("audit payloads redact nested credentials", () => {
  const result = _test.sanitizeAuditValue({
    trunk: { sipPassword: "secret" },
    extension: { secret: "secret" },
    safe: "visible"
  });
  assert.equal(result.trunk.sipPassword, "[redacted]");
  assert.equal(result.extension.secret, "[redacted]");
  assert.equal(result.safe, "visible");
});
