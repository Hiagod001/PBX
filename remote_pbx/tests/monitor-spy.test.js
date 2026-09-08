const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {_test}=require('../server');
test('supervisor selects the operator endpoint, not the caller referencing that operator',()=>{
 const status={activeChannels:[{channel:'PJSIP/web-581-0000001b',extension:'505',data:'Dial PJSIP/web-505'},{channel:'PJSIP/web-505-0000001c',extension:'',callerId:'505'}]};
 assert.equal(_test.spyEndpointForMonitor(status,'505'),'web-505');
 assert.equal(_test.spyEndpointForMonitor(status,'581'),'web-581');
});
test('spy helper targets the exact channel and registered browser contact',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../scripts/asterisk-control-root.sh'),'utf8');
 assert.match(source,/SPY_OPTIONS="quwbES"/);
 assert.match(source,/SPY_OPTIONS="quBbES"/);
 assert.match(source,/PJSIP\/\$\{LISTENER\}\/\$\{CONTACT_URI\}/);
 assert.match(source,/module load app_chanspy\.so/);
});
