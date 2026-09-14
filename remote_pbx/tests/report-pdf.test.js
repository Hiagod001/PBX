const test = require("node:test");
const assert = require("node:assert/strict");

const { buildReportPdf, filterDescription } = require("../src/report-pdf");

function sampleCall(index) {
  return {
    startedAt: new Date(Date.UTC(2026, 8, 14, 12, index % 60)).toISOString(),
    protocol: `202600${String(index).padStart(4, "0")}`,
    source: "3431950817",
    destination: `3499000${String(index).padStart(4, "0")}`,
    extension: "777",
    typeLabel: "Saida",
    statusLabel: "Atendida",
    queue: "85",
    durationLabel: "1m 12s"
  };
}

test("builds a branded, paginated PDF containing every report row", async () => {
  const calls = Array.from({ length: 80 }, (_, index) => sampleCall(index));
  const pdf = await buildReportPdf({
    calls,
    dashboard: { total: 80, answered: 80, missed: 0, recordings: 70 },
    companyName: "UAI Telecom",
    filters: { dateStart: "2026-09-14", dateEnd: "2026-09-14", queue: "85" },
    requestedBy: "admin",
    roleLabel: "Administrador",
    generatedAt: new Date("2026-09-14T15:00:00Z")
  });
  const source = pdf.toString("latin1");
  assert.equal(source.slice(0, 8), "%PDF-1.3");
  assert.ok((source.match(/\/Type \/Page\b/g) || []).length >= 3);
  assert.ok(pdf.length > 10000);
});

test("describes active report filters in readable Portuguese", () => {
  assert.equal(filterDescription({ extension: "777", queue: "85" }), "Ramal: 777  |  Fila: 85");
  assert.equal(filterDescription({}), "Nenhum filtro adicional");
});
