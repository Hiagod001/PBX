const fs = require("node:fs");
const path = require("node:path");

function contactForExtension(extension, file = path.join(__dirname, "../data/ixc-contacts.sqlite")) {
  if (!extension?.channel) return null;
  const phone = String(extension.currentNumber || "").replace(/\D/g, "").replace(/^55(?=\d{10,11}$)/, "").replace(/^0(?=\d{10,11}$)/, "");
  if (!/^[1-9]\d[2-9]\d{7,8}$/.test(phone) || !fs.existsSync(file)) return null;
  let db;
  try {
    const { DatabaseSync } = require("node:sqlite");
    db = new DatabaseSync(file, { readOnly: true });
    const rows = db.prepare("SELECT name, cpf FROM contacts WHERE phone = ? LIMIT 2").all(phone);
    if (rows.length > 1) return { phone, shared: true };
    return rows.length === 1 ? { phone, name: rows[0].name, cpf: rows[0].cpf } : null;
  } catch (error) {
    if (!contactForExtension.lastWarning || Date.now() - contactForExtension.lastWarning > 300000) {
      contactForExtension.lastWarning = Date.now();
      console.warn("Índice de contatos IXC indisponível", error.code || "");
    }
    return null;
  } finally {
    db?.close();
  }
}
module.exports = { contactForExtension };
