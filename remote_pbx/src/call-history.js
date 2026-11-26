const fs = require("fs-extra");
const path = require("path");
const policyPath = path.join(__dirname, "..", "data", "call-history-policy.json");

async function historyStart(file = policyPath) {
  const policy = await fs.readJson(file).catch((error) => {
    if (error.code === "ENOENT") return {};
    throw error;
  });
  if (!policy.since) return "";
  const since = new Date(policy.since);
  if (!Number.isFinite(since.getTime())) throw new Error("Data inicial do histórico de chamadas inválida.");
  return since.toISOString();
}

function historyFilters(filters, since) {
  if (!since) return { ...filters };
  const requested = Date.parse(filters.dateStart || "");
  return { ...filters, dateStart: Number.isFinite(requested) && requested > Date.parse(since) ? filters.dateStart : since };
}

function keepHistoryTime(time, since) {
  return !since || (Number.isFinite(Date.parse(time)) && Date.parse(time) >= Date.parse(since));
}

module.exports = { historyStart, historyFilters, keepHistoryTime };
