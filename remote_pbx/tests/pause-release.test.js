const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
test('queue delivery guards persisted pause before dialing',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../src/asterisk.js'),'utf8');
 assert.match(source,/DB\(UAI_PAUSED\/\$\{EXTEN\}\)/);
 assert.match(source,/n\(paused\),NoOp\(Ramal pausado\)/);
});
test('pause changes serialize and invalidate the status cache',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const update=source.slice(source.indexOf('function updateExtensionPause'),source.indexOf('async function setExtensionPause'));
 assert.match(update,/pauseMutation\.catch/);
 assert.ok(update.indexOf('await runAsteriskControl')<update.indexOf('await setExtensionPause'));
 assert.match(update,/pbxStatusCache =/);
});
test('hangup reads fresh status and accepts already completed calls',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../server.js'),'utf8');
 const action=source.slice(source.indexOf('app.post("/api/extensions/action"'),source.indexOf('app.post("/api/change-password"'));
 assert.match(action,/readPbxStatus\(config, \{ fresh: true \}\)/);
 assert.match(action,/alreadyEnded: true/);
 assert.match(action,/requestedChannel && !ownedChannel/);
});
