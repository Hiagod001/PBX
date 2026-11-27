const fs = require("node:fs");
const path = require("node:path");

const data = path.resolve(__dirname, "../data");
const index = path.join(data, "ixc-contacts.sqlite");
const marker = path.join(data, "ixc-refresh.request");
let requestedAt = 0;

function refreshStatus() {
  const updatedAt = fs.statSync(index, { throwIfNoEntry: false })?.mtime;
  const refreshing = fs.existsSync(marker);
  return { updatedAt, refreshing, failed: !refreshing && requestedAt > (updatedAt?.getTime() || 0) };
}

function requestRefresh() {
  try {
    fs.writeFileSync(marker, "", { flag: "wx", mode: 0o600 });
    requestedAt = Date.now();
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  return refreshStatus();
}

function listContacts(query, file = index) {
  const { DatabaseSync } = require("node:sqlite");
  const search = String(query.search || "").trim().slice(0, 100);
  const digits = search.replace(/\D/g, "");
  const numeric = digits && !/\p{L}/u.test(search);
  const filter = !search ? "" : numeric ? " WHERE instr(phone, ?) OR instr(cpf, ?)" : " WHERE instr(fold(name), ?)";
  const fold = text => text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const args = !search ? [] : numeric ? [digits, digits] : [fold(search)];
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.function("fold", { deterministic: true }, fold);
    const total = db.prepare("SELECT count(*) AS n FROM contacts" + filter).get(...args).n;
    const pages = Math.max(1, Math.ceil(total / 50));
    const page = Math.min(pages, Math.max(1, parseInt(query.page, 10) || 1));
    const contacts = db.prepare("SELECT name,phone,cpf FROM contacts" + filter + " ORDER BY name COLLATE NOCASE,phone LIMIT 50 OFFSET ?").all(...args, (page - 1) * 50);
    return { contacts, page, pages, total };
  } finally {
    db.close();
  }
}

module.exports = { listContacts, requestRefresh, refreshStatus };
