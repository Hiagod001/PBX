const test = require('node:test');
const assert = require('node:assert/strict');
const { configWritePlan, effectiveTrunks } = require('../src/config-write-plan');

const fixture = () => ({
  company:{name:'QA'}, trunk:{sipUser:'lab'},
  extensions:[{number:'9951',name:'Lab'}],
  queues:[{id:'qa',members:['9951']}], ivr:{id:'main',options:[]},
  inboundRoutes:[], ringGroups:[], outboundRules:{local:{patterns:['_XXXX']},mobile:{patterns:['_9XXXXXXX']}}
});

test('editing one extension leaves trunk, queue and IVR tables outside the write plan',()=>{
 const before=fixture(),next=structuredClone(before);next.extensions[0].name='Updated';
 const plan=configWritePlan(next,before);
 assert.deepEqual([...plan.groups],['extensions']);assert.deepEqual(plan.settings,[]);
 assert.deepEqual(plan.deleteTables,['pbx_extensions']);
});
test('queue and IVR removal include their child tables in dependency order',()=>{
 const before=fixture(),next=structuredClone(before);next.queues=[];next.ivr.options=[{digit:'1'}];
 assert.deepEqual(configWritePlan(next,before).deleteTables,['pbx_ivr_options','pbx_ivr_menus','pbx_queue_members','pbx_queues']);
});
test('settings update independently and unchanged saves require no database writes',()=>{
 const before=fixture(),next=structuredClone(before);next.company.name='Updated';
 const plan=configWritePlan(next,before);assert.deepEqual(plan.settings,['company']);assert.equal(plan.groups.size,0);
 const unchanged=configWritePlan(structuredClone(before),before);assert.equal(unchanged.groups.size,0);assert.deepEqual(unchanged.settings,[]);
});
test('legacy main trunk and outbound rule priority changes are detected',()=>{
 const before=fixture(),next=structuredClone(before);next.trunk.sipUser='updated';
 assert.deepEqual([...configWritePlan(next,before).groups],['trunks']);
 assert.equal(effectiveTrunks(next)[0].name,'Operadora principal');
 const reordered=structuredClone(before);reordered.outboundRules={mobile:before.outboundRules.mobile,local:before.outboundRules.local};
 assert.deepEqual([...configWritePlan(reordered,before).groups],['outboundRules']);
});
test('migrations and callers without a trusted previous snapshot keep the complete write path',()=>{
 const plan=configWritePlan(fixture());assert.equal(plan.full,true);assert.equal(plan.groups.size,7);assert.equal(plan.settings.length,6);
});

test('save-and-apply narrows the forward write and restores the full previous config on failure',async()=>{
 const fs=require('node:fs'),vm=require('node:vm');
 const source=fs.readFileSync(require.resolve('../server'),'utf8');
 const before=fixture(),next=structuredClone(before);next.extensions[0].name='Updated';
 const writes=[];let fail=false;
 const context={
  generateAsteriskConfigs:async()=>['generated'],
  saveConfig:async(...args)=>{writes.push(args);return args[0]},
  applyAsteriskConfig:async()=>{if(fail){fail=false;throw Error('apply failed')}return {reloaded:true}},
  configUpdateAudit:async()=>{},configForUser:c=>c,withConfigRevision:c=>c,pbxStatusCache:{}
 };
 vm.runInNewContext(source.slice(source.indexOf('async function saveAndApplyConfig('),source.indexOf('app.put("/api/config",')),context);
 await context.saveAndApplyConfig({},before,next);
 assert.equal(writes[0][1],before);
 writes.length=0;fail=true;
 await assert.rejects(context.saveAndApplyConfig({},before,next),/apply failed/);
 assert.equal(writes[0][1],before);assert.equal(writes[1][0],before);assert.equal(writes[1].length,1);
});
