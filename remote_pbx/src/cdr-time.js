const offsetFormatters = new Map();

function sourceTimeZone() {
  return process.env.ASTERISK_CDR_TIMEZONE || process.env.TZ || "America/Sao_Paulo";
}

function cdrTimestamp(value, timeZone = sourceTimeZone()) {
  if (!value) return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.toISOString() : null;
  const text = String(value).trim();
  if (!text) return null;
  const local = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/);
  if (!local) {
    if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) return null;
    const instant = new Date(text);
    return Number.isFinite(instant.getTime()) ? instant.toISOString() : null;
  }
  const parts = local.slice(1, 7).map(Number);
  const milliseconds = Number((local[7] || "").padEnd(3, "0"));
  const wallTime = Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5], milliseconds);
  const date = new Date(wallTime);
  if ([date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate(), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds()].some((value, i) => value !== parts[i])) return null;
  let formatter = offsetFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
    offsetFormatters.set(timeZone, formatter);
  }
  let instant = wallTime;
  for (let pass = 0; pass < 3; pass += 1) {
    const zone = formatter.formatToParts(new Date(instant)).find((part) => part.type === "timeZoneName")?.value;
    const offset = zone?.match(/^GMT([+-])(\d{2}):(\d{2})$/);
    if (!offset && zone !== "GMT") throw new Error("Fuso de horário do CDR inválido.");
    const minutes = offset ? (Number(offset[2]) * 60 + Number(offset[3])) * (offset[1] === "+" ? 1 : -1) : 0;
    const corrected = wallTime - minutes * 60000;
    if (corrected === instant) break;
    instant = corrected;
  }
  return new Date(instant).toISOString();
}

module.exports = { cdrTimestamp, sourceTimeZone };
