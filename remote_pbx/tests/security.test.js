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

test("dialer operator can use assigned modules but cannot elevate access", () => {
  const user = { role: "user", permissions: { menus: { dialer: true, queues: true, audios: true } } };
  for (const [method, path, body, expected] of [
    ["GET", "/api/dialer/campaigns", {}, true],
    ["POST", "/api/dialer/campaigns", {}, true],
    ["POST", "/api/ivr-audios", {}, true],
    ["GET", "/api/users", {}, false],
    ["PUT", "/api/users", {}, false],
    ["PUT", "/api/config/apply", {}, false],
    ["PATCH", "/api/config/apply", { sections: { queues: [] } }, true],
    ["PATCH", "/api/config/apply", { sections: { queues: [], security: {} } }, false],
    ["PATCH", "/api/config/apply", { sections: { extensions: [] } }, false]
  ]) {
    let allowed = false;
    _test.requireAdmin({ method, path, body, session: { user } }, responseStub(), () => { allowed = true; });
    assert.equal(allowed, expected, `${method} ${path} ${JSON.stringify(body)}`);
  }
  assert.equal(_test.hasMenuAccess({ session: { user } }, "users"), false);
  assert.equal(_test.hasMenuAccess({ session: { user } }, "status"), false);
  assert.equal(_test.canEditConfigSections({ session: { user: { role: "user" } } }, { queues: [] }), false);
});

test("management UI exposes only the assigned operator menus", () => {
  const fs = require("node:fs");
  const vm = require("node:vm");
  const source = fs.readFileSync(require("node:path").join(__dirname, "../public/app.js"), "utf8");
  const start = source.indexOf("function canAccessTab(");
  const end = source.indexOf("function firstAllowedTab", start);
  const declaration = source.match(/const adminOnlyTabs = new Set\([^;]+;/)[0];
  const context = { state: { user: { username: "operator", role: "user", permissions: { menus: { dialer: true, queues: true, audios: true } } } }, menuPermissions: Object.fromEntries(["dialer", "queues", "audios", "users", "security", "status", "reports"].map(x => [x, x])) };
  vm.runInNewContext(declaration + source.slice(start, end), context);
  for (const menu of ["dialer", "queues", "audios"]) assert.equal(context.canAccessTab(menu), true);
  for (const menu of ["users", "security", "status", "reports"]) assert.equal(context.canAccessTab(menu), false);
  assert.equal(source.includes('data-user-field="extension"'), false);
  assert.equal(source.includes('data-user-field="allowedExtensions"'), false);
});

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

test("management users can access all extensions without extension assignments", () => {
  const config = {
    extensions: [
      { number: "505", department: "Suporte" },
      { number: "701", department: "Financeiro" }
    ]
  };
  const supervisor = {
    session: { user: { role: "supervisor", allowedExtensions: ["505"], departments: [] } }
  };
  assert.equal(_test.userCanMonitorExtension(supervisor, config, "505"), true);
  assert.equal(_test.userCanMonitorExtension(supervisor, config, "701"), true);
  assert.equal(_test.userCanMonitorExtension({ session: { user: { role: "admin" } } }, config, "701"), true);
});

test("call intervention follows the monitor menu permission", () => {
  assert.equal(_test.userCanInterveneLiveCalls({ session: { user: { role: "admin" } } }), true);
  assert.equal(_test.userCanInterveneLiveCalls({ session: { user: { role: "supervisor", permissions: {} } } }), false);
  assert.equal(
    _test.userCanInterveneLiveCalls({ session: { user: { role: "user", permissions: { menus: { status: true } } } } }),
    true
  );
});
