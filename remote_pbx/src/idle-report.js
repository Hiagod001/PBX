const { DatabaseSync } = require("node:sqlite");
const path = require("node:path");

const dayFormat = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo" });
const dayOf = ms => dayFormat.format(ms);
const interval = 15000;

function openLedger(filename = path.join(__dirname, "../data/idle-report.sqlite")) {
  const db = new DatabaseSync(filename, {timeout: 1000});
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS collection (id INTEGER PRIMARY KEY CHECK(id=1), first_ms INTEGER, last_ms INTEGER);
    CREATE TABLE IF NOT EXISTS days (
      day TEXT NOT NULL, extension TEXT NOT NULL, observed_ms INTEGER NOT NULL,
      online_ms INTEGER NOT NULL, idle_ms INTEGER NOT NULL, PRIMARY KEY(day,extension)
    ) WITHOUT ROWID;`);
  const cursor = db.prepare("SELECT first_ms, last_ms FROM collection WHERE id=1");
  const save = db.prepare(`INSERT INTO days VALUES (?,?,?,?,?) ON CONFLICT(day,extension) DO UPDATE SET
    observed_ms=observed_ms+excluded.observed_ms, online_ms=online_ms+excluded.online_ms, idle_ms=idle_ms+excluded.idle_ms`);
  let previous;

  function sample(snapshot) {
    if (!snapshot?.idleObservedAt) { previous = null; return; }
    const at = snapshot.idleObservedAt;
    if (previous && at <= previous.at) return;
    const current = new Map(snapshot.extensions.map(e => [String(e.number), e]));
    db.exec("BEGIN IMMEDIATE");
    try {
      const last = cursor.get()?.last_ms || 0;
      if (at > last) {
        if (previous && at - previous.at <= interval * 3) {
          let start = Math.max(last, previous.at);
          // Each interval belongs to the state observed at its beginning.
          while (start < at) {
            const day = dayOf(start);
            let end = at;
            if (dayOf(at - 1) !== day) {
              let low = start, high = at;
              while (high - low > 1) {
                const mid = Math.floor((low + high) / 2);
                if (dayOf(mid) === day) low = mid; else high = mid;
              }
              end = high;
            }
            const duration = end - start;
            for (const [number, e] of previous.extensions) {
              if (current.has(number)) save.run(day, number, duration, e.registered ? duration : 0,
                e.registered && e.captureReady ? duration : 0);
            }
            start = end;
          }
        }
        db.prepare("INSERT INTO collection VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET last_ms=excluded.last_ms").run(at, at);
      }
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); previous = null; throw error; }
    previous = {at, extensions:current};
  }

  function report(extensions, from, to) {
    const rows = db.prepare("SELECT * FROM days WHERE day BETWEEN ? AND ? ORDER BY day DESC").all(from,to);
    const byNumber = new Map(extensions.map(e => [String(e.number), {
      number:String(e.number), name:e.name, department:e.department, daily:[], onlineMs:0, idleMs:0, daysOnline:0
    }]));
    for (const row of rows) {
      const ext = byNumber.get(row.extension);
      if (!ext) continue;
      ext.daily.push({day:row.day, onlineMs:row.online_ms, idleMs:row.idle_ms, observedMs:row.observed_ms});
      ext.onlineMs += row.online_ms;
      ext.idleMs += row.idle_ms;
      if (row.online_ms > 0) ext.daysOnline++;
    }
    const agents = [...byNumber.values()].map(e => ({...e,
      averageMs:e.daysOnline ? Math.round(e.idleMs/e.daysOnline) : null,
      percent:e.onlineMs ? Math.round(e.idleMs/e.onlineMs*1000)/10 : null
    })).sort((a,b) => (b.averageMs ?? -1)-(a.averageMs ?? -1) || a.number.localeCompare(b.number,"pt-BR",{numeric:true}));
    return {agents, firstMs:cursor.get()?.first_ms || null, from, to};
  }
  return {sample,report,close:()=>db.close()};
}

let ledger;
function getLedger() { return ledger ||= openLedger(); }
function start(readStatus) {
  let lastWarning = 0;
  async function tick() {
    try { getLedger().sample(await readStatus()); }
    catch (error) {
      ledger?.sample(null);
      if (Date.now()-lastWarning > 60000) { lastWarning=Date.now(); console.error("Coleta de ociosidade:",error.message); }
    } finally {setTimeout(tick, interval).unref();}
  }
  void tick();
}
module.exports = {openLedger, getLedger, start, dayOf};

