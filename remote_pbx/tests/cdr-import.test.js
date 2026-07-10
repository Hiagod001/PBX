const test = require("node:test");
const assert = require("node:assert/strict");

process.env.PBX_DATABASE_ENABLED = "false";

const { hasLikelyCdrDate, parseCsvLine, rowFromColumns } = require("../scripts/import-cdr");

test("CSV parser preserves commas inside quoted fields", () => {
  assert.deepEqual(parseCsvLine('"caller, name","505","85"'), ["caller, name", "505", "85"]);
});

test("Asterisk CDR rows are mapped with their call identifiers", () => {
  const columns = Array(19).fill("");
  columns[1] = "505";
  columns[2] = "85";
  columns[4] = "Caller <505>";
  columns[9] = "2026-07-10 12:00:00";
  columns[12] = "42";
  columns[13] = "30";
  columns[14] = "ANSWERED";
  columns[16] = "unique-1";
  const row = rowFromColumns(columns);
  assert.equal(row.src, "505");
  assert.equal(row.dst, "85");
  assert.equal(row.uniqueid, "unique-1");
  assert.equal(row.billsec, 30);
  assert.equal(hasLikelyCdrDate(row.calldate), true);
});
