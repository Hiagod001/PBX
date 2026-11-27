const fs = require("node:fs/promises");
const path = require("node:path");

const data = path.join(__dirname,"..","data");
const uuid = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const attemptPattern = /^(?:wa|dlr)-[0-9a-f-]{12,50}$/;

async function request(route, body) {
  const token = (await fs.readFile(path.join(data,"crm-integration.key"),"utf8")).trim();
  const res = await fetch("https://campanhas.uaitelecom.com.br/backend/pbx/"+route,{
    method:body?"POST":"GET", redirect:"error",signal:AbortSignal.timeout(8000),
    headers:{Authorization:"Bearer "+token,"Content-Type":"application/json"},
    ...(body?{body:JSON.stringify(body)}:{})
  });
  if (!res.ok) throw new Error("O Uai Campanhas não conseguiu concluir a solicitação ("+res.status+").");
  return res.json();
}

function callVars(campaign,lead) {
  return [
    "Setvar: __UAI_ATTEMPT="+(attemptPattern.test(lead.attemptId)?lead.attemptId:""),
    "Setvar: __UAI_PHONE="+String(lead.number).replace(/\D/g,""),
    "Setvar: __UAI_MAILING="+(uuid.test(campaign.crmMailingId)?campaign.crmMailingId:""),
    "Setvar: __UAI_LEAD="+(uuid.test(lead.crmLeadId)?lead.crmLeadId:"")
  ];
}

function startWorker({acknowledge,markConnected}) {
  const { DatabaseSync } = require("node:sqlite");
  let queue, ast, lastError=0;
  async function tick() {
    try {
      if (!ast) ast=new DatabaseSync("/var/lib/asterisk/astdb.sqlite3",{readOnly:true});
      if (!queue) {
        const db=new DatabaseSync(path.join(data,"crm-delivery.sqlite"));
        db.exec("create table if not exists delivery (key text primary key, payload text not null, retry integer default 0, due integer default 0)");
        queue=db;
      }
      for (const family of ["UAI_CONNECT","UAI_END"]) {
        const rows=ast.prepare("select key,value from astdb where key glob ? limit 32").all("/"+family+"/*");
        for(const row of rows) {
          const attempt=row.key.split("/").pop();
          if (!attemptPattern.test(attempt)) continue;
          const [epoch,extension,mailing,lead,phone,ended] = row.value.split("|");
          const event={attempt,extension,mailing,lead,phone,start:Number(epoch),end:ended?Number(ended):null};
          queue.prepare("insert or ignore into delivery(key,payload) values(?,?)").run(row.key,JSON.stringify(event));
          await acknowledge(family,attempt);
        }
      }
      for(const row of queue.prepare("select * from delivery where due<=unixepoch() order by rowid limit 32").all()){
        const event=JSON.parse(row.payload);
        try {
          await markConnected(event);
          if(event.mailing && event.lead) await request("events",event);
          queue.prepare("delete from delivery where key=?").run(row.key);
        } catch(error) {
          queue.prepare("update delivery set retry=retry+1,due=unixepoch()+? where key=?").run(Math.min(300,2**Math.min(row.retry+1,9)),row.key);
          if(Date.now()-lastError>60000){lastError=Date.now();console.error("Entrega ao Campanhas pendente:",error.message);}
        }
      }
    } catch(error) {
      if(Date.now()-lastError>60000){lastError=Date.now();console.error("Leitura de atendimentos do Discador:",error.message);}
    } finally {setTimeout(tick,1500).unref();}
  }
  void tick();
}
// AstDB is also read by Asterisk before it rings a device. Keep the last
// confirmed holds across a CRM outage or a restart of the web process.
let ast;
let lastBusy = new Set();
function holds() {
  const { DatabaseSync } = require("node:sqlite");
  if (!ast) {
    ast = new DatabaseSync("/var/lib/asterisk/astdb.sqlite3", { readOnly: true, timeout: 120 });
  }
  return ast.prepare("select key,value from astdb where key glob '/UAI_DESK/*' or key glob '/UAI_WRAP/*'").all();
}
function busyExtensions() {
  lastBusy = new Set(holds().map(row => row.key.split("/")[2]));
  return lastBusy;
}
let syncedAt = 0;
function startAvailability(control, invalidate) {
  let warnedAt = 0;
  async function sync() {
    try {
      const rows = holds();
      lastBusy = new Set(rows.map(row => row.key.split("/")[2]));
      const pending = rows.filter(r => r.key.startsWith("/UAI_WRAP/")).slice(0,128);
      const desk = new Set(rows.filter(r => r.key.startsWith("/UAI_DESK/")).map(r => r.key.split("/")[2]));
      const {busy, delivered} = await request("availability", {attempts: pending.map(r => r.value)});
      if (!Array.isArray(busy) || !busy.every(n => /^\d{2,8}$/.test(n)) || !Array.isArray(delivered)) throw new Error("Resposta de disponibilidade inválida");
      const next = new Set(busy);
      for (const n of next) if (!desk.has(n)) await control("crm-busy",n);
      for (const n of desk) if (!next.has(n)) await control("crm-free",n);
      for (const row of pending) if (delivered.includes(row.value)) await control("crm-delivered",row.key.split("/")[2],{attempt:row.value});
      if (pending.length || busy.length !== desk.size || busy.some(n=>!desk.has(n))) invalidate();
      syncedAt = Date.now();
    } catch (error) {
      if (Date.now()-warnedAt>60000) {warnedAt=Date.now(); console.error("Disponibilidade do Campanhas:", error.message);}
    } finally { setTimeout(sync,2500).unref(); }
  }
  void sync();
}
module.exports={request,callVars,startWorker,uuid,busyExtensions,lastBusyExtensions:()=>lastBusy,startAvailability,availabilityFresh:()=>Date.now()-syncedAt<15000};
