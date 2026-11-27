const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const access = require("../public/access-policy");
const { listContacts } = require("../src/agenda");
const { _test } = require("../server");

test("formerly restricted menus require explicit individual grants", () => {
  for (const tab of ["extensions", "trunk", "routing", "ivr", "logs", "security", "audit", "users"]) {
    const actor = { session: { user: { role: "user", permissions: { menus: { [tab]: true } } } } };
    assert.equal(_test.hasMenuAccess(actor, tab), false);
    actor.session.user.permissions.menus[access.menuKey(tab)] = true;
    assert.equal(_test.hasMenuAccess(actor, tab), true);
    assert.equal(_test.hasMenuAccess(actor, "agenda"), false);
  }
  const req = { session: { user: { role: "supervisor", permissions: { menus: { agenda: true } } } },
    method: "POST", path: "/api/agenda/refresh" };
  const res = { status(code) { assert.equal(code, 403); return this; }, json() {} };
  _test.requireAdmin(req, res, () => assert.fail("Only an administrator can refresh the IXC directory"));
});

test("agenda searches accented names, formatted phones and CPF with stable pagination", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pbx-agenda-"));
  const file = path.join(dir, "contacts.sqlite");
  try {
    const db = new DatabaseSync(file);
    try {
      db.exec("CREATE TABLE contacts(phone TEXT PRIMARY KEY, name TEXT, cpf TEXT)");
      const add = db.prepare("INSERT INTO contacts VALUES (?,?,?)");
      for (let i = 0; i < 52; i++) add.run(String(31900000000 + i), "Cláudia " + i, String(11000000000 + i));
    } finally { db.close(); }
    const first = listContacts({search:"claudia"}, file);
    assert.equal(first.total, 52);
    assert.equal(first.contacts.length, 50);
    assert.equal(listContacts({page:100}, file).contacts.length, 2);
    assert.equal(listContacts({search:"(31) 90000-0013"}, file).contacts[0].name, "Cláudia 13");
    assert.equal(listContacts({search:"110.000.000-13"}, file).total, 1);
  } finally { fs.rmSync(dir, {recursive:true, force:true}); }
});
