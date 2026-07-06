require("dotenv").config();

const fs = require("fs-extra");
const { ensureDatabase, query } = require("../src/db");

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && quoted && next === '"') {
      current += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function nullable(value) {
  const text = String(value || "").trim();
  return text || null;
}

function number(value) {
  return Number(value) || 0;
}

function hasLikelyCdrDate(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(text)) return true;
  return !Number.isNaN(new Date(text).getTime());
}

function rowFromColumns(columns) {
  const isAsteriskCsv = hasLikelyCdrDate(columns[9]) && !hasLikelyCdrDate(columns[8]);
  const row = isAsteriskCsv
    ? {
        callerid: nullable(columns[4]),
        src: nullable(columns[1]),
        dst: nullable(columns[2]),
        dcontext: nullable(columns[3]),
        channel: nullable(columns[5]),
        dstchannel: nullable(columns[6]),
        lastapp: nullable(columns[7]),
        lastdata: nullable(columns[8]),
        calldate: nullable(columns[9]),
        start_at: nullable(columns[9]),
        answer_at: nullable(columns[10]),
        end_at: nullable(columns[11]),
        duration: number(columns[12]),
        billsec: number(columns[13]),
        disposition: nullable(columns[14]),
        amaflags: nullable(columns[15]),
        accountcode: nullable(columns[0]),
        uniqueid: nullable(columns[16]),
        linkedid: nullable(columns[16]),
        peeraccount: null,
        recordingfile: null,
        trunk: null,
        did: null,
        queue: null,
        direction: null,
        userfield: nullable(columns[17]),
        sequence: nullable(columns[18])
      }
    : {
        callerid: nullable(columns[0]),
        src: nullable(columns[1]),
        dst: nullable(columns[2]),
        dcontext: nullable(columns[3]),
        channel: nullable(columns[4]),
        dstchannel: nullable(columns[5]),
        lastapp: nullable(columns[6]),
        lastdata: nullable(columns[7]),
        calldate: nullable(columns[8] || columns[0]),
        start_at: nullable(columns[8]),
        answer_at: nullable(columns[9]),
        end_at: nullable(columns[10]),
        duration: number(columns[11]),
        billsec: number(columns[12]),
        disposition: nullable(columns[13]),
        amaflags: nullable(columns[14]),
        accountcode: nullable(columns[15]),
        uniqueid: nullable(columns[16]),
        linkedid: nullable(columns[16]),
        peeraccount: null,
        recordingfile: null,
        trunk: null,
        did: null,
        queue: null,
        direction: nullable(columns[25]),
        userfield: nullable(columns[17]),
        sequence: nullable(columns[18])
      };

  if (!isAsteriskCsv && columns.length >= 25) {
    row.linkedid = nullable(columns[17]) || row.linkedid;
    row.peeraccount = nullable(columns[18]);
    row.recordingfile = nullable(columns[19]);
    row.trunk = nullable(columns[20]);
    row.did = nullable(columns[21]);
    row.queue = nullable(columns[22]);
    row.userfield = nullable(columns[23]) || row.userfield;
    row.sequence = nullable(columns[24]) || row.sequence;
  } else if (!isAsteriskCsv && columns.length >= 22) {
    row.recordingfile = nullable(columns[18]);
    row.trunk = nullable(columns[19]);
    row.did = nullable(columns[20]);
    row.queue = nullable(columns[21]);
    row.userfield = nullable(columns[22]) || row.userfield;
  }

  return row;
}

async function importRow(row) {
  await query(
    `INSERT INTO pbx_cdr
     (calldate, start_at, answer_at, end_at, callerid, src, dst, dcontext, channel, dstchannel, lastapp, lastdata,
      duration, billsec, disposition, amaflags, accountcode, uniqueid, linkedid, peeraccount, recordingfile,
      trunk, did, queue, direction, userfield, sequence, raw)
     VALUES
     ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28)
     ON CONFLICT (uniqueid) DO UPDATE SET
       calldate = EXCLUDED.calldate,
       start_at = EXCLUDED.start_at,
       answer_at = EXCLUDED.answer_at,
       end_at = EXCLUDED.end_at,
       callerid = EXCLUDED.callerid,
       src = EXCLUDED.src,
       dst = EXCLUDED.dst,
       dcontext = EXCLUDED.dcontext,
       channel = EXCLUDED.channel,
       dstchannel = EXCLUDED.dstchannel,
       lastapp = EXCLUDED.lastapp,
       lastdata = EXCLUDED.lastdata,
       duration = EXCLUDED.duration,
       billsec = EXCLUDED.billsec,
       disposition = EXCLUDED.disposition,
       amaflags = EXCLUDED.amaflags,
       accountcode = EXCLUDED.accountcode,
       linkedid = EXCLUDED.linkedid,
       peeraccount = EXCLUDED.peeraccount,
       recordingfile = EXCLUDED.recordingfile,
       trunk = EXCLUDED.trunk,
       did = EXCLUDED.did,
       queue = EXCLUDED.queue,
       direction = EXCLUDED.direction,
       userfield = EXCLUDED.userfield,
       sequence = EXCLUDED.sequence,
       raw = EXCLUDED.raw`,
    [
      row.calldate,
      row.start_at,
      row.answer_at,
      row.end_at,
      row.callerid,
      row.src,
      row.dst,
      row.dcontext,
      row.channel,
      row.dstchannel,
      row.lastapp,
      row.lastdata,
      row.duration,
      row.billsec,
      row.disposition,
      row.amaflags,
      row.accountcode,
      row.uniqueid,
      row.linkedid,
      row.peeraccount,
      row.recordingfile,
      row.trunk,
      row.did,
      row.queue,
      row.direction,
      row.userfield,
      row.sequence,
      JSON.stringify(row)
    ]
  );
}

async function main() {
  const explicitPath = process.argv[2] || process.env.ASTERISK_CDR_CSV;
  const cdrCandidates = explicitPath
    ? [explicitPath]
    : ["/var/log/asterisk/cdr-custom/Master.csv", "/var/log/asterisk/cdr-csv/Master.csv"];
  if (!(await ensureDatabase())) throw new Error("Configure DATABASE_URL ou PGHOST/PGDATABASE para importar CDR.");
  const cdrPaths = [];
  for (const candidate of cdrCandidates) {
    if (await fs.pathExists(candidate)) cdrPaths.push(candidate);
  }
  if (!cdrPaths.length) throw new Error(`Arquivo CDR nao encontrado: ${cdrCandidates.join(" ou ")}`);

  let imported = 0;
  for (const cdrPath of cdrPaths) {
    const lines = (await fs.readFile(cdrPath, "utf8")).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      const row = rowFromColumns(parseCsvLine(line));
      if (!row.calldate || !hasLikelyCdrDate(row.calldate)) continue;
      await importRow(row);
      imported += 1;
    }
  }
  console.log(`CDR importado para pbx_cdr: ${imported} linhas.`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
}).then(() => process.exit(0));
