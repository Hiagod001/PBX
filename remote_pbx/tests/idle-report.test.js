const {test} = require("node:test");
const assert = require("node:assert/strict");
const {openLedger} = require("../src/idle-report");

test("daily idle time splits at São Paulo midnight and includes busy online days in the mean", () => {
  const ledger = openLedger(":memory:");
  const start = Date.parse("2026-11-27T02:59:45Z");
  const ext = {number:"777",name:"Teste"};
  const record = (seconds,registered,captureReady) => ledger.sample({
    idleObservedAt:start+seconds*1000, extensions:[{...ext,registered,captureReady}]
  });
  try {
    record(0,true,true); record(20,true,false); record(40,false,false);
    record(55,false,false); record(55,false,false);
    record(86400+30,true,false); record(86400+45,true,false);
    const [e] = ledger.report([ext], "2026-11-26","2026-11-28").agents;
    assert.deepEqual(e.daily.map(d=>[d.day,d.onlineMs,d.idleMs]),[
      ["2026-11-28",15000,0],["2026-11-27",25000,5000],["2026-11-26",15000,15000]
    ]);
    assert.equal(e.daysOnline,3);
    assert.equal(e.averageMs,6667);
    assert.equal(e.percent,36.4);
    assert.deepEqual(ledger.report([], "2026-11-26","2026-11-28").agents,[]);
  } finally {ledger.close();}
});

test("an unavailable snapshot does not fill the missing interval", () => {
  const ledger = openLedger(":memory:");
  const extensions=[{number:"201",registered:true,captureReady:true}];
  const start = Date.parse("2026-11-27T16:00:00Z");
  try {
    ledger.sample({idleObservedAt:start,extensions});
    ledger.sample(null);
    ledger.sample({idleObservedAt:start+15000,extensions});
    assert.equal(ledger.report(extensions,"2026-11-27","2026-11-27").agents[0].averageMs,null);
    ledger.sample({idleObservedAt:start+30000,extensions});
    assert.equal(ledger.report(extensions,"2026-11-27","2026-11-27").agents[0].idleMs,15000);
  } finally {ledger.close();}
});

