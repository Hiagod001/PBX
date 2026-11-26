const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
process.env.PBX_DATABASE_ENABLED='false';
const {app,_test}=require('../server');
const frontend=fs.readFileSync(require.resolve('../public/app.js'),'utf8');
const server=fs.readFileSync(require.resolve('../server'),'utf8');
const response=()=>({statusCode:200,status(code){this.statusCode=code;return this},json(body){this.body=body;return this}});
const user=menus=>({username:'operator',role:'user',permissions:{menus}});

test('recordings and IVR audio authorization are independent for every library operation',async()=>{
 for(const [menus,expected] of [[{audios:true},false],[{reports:true},false],[{ivrAudios:true},true],[{audios:true,ivrAudios:true},true],[{},false]]){
   for(const [method,url] of [['GET','/api/ivr-audios'],['GET','/api/ivr-audios/file/test.wav'],['POST','/api/ivr-audios'],['DELETE','/api/ivr-audios/test.wav']]){
     let allowed=false;const res=response();
     _test.requireAdmin({method,path:url,session:{user:user(menus)}},res,()=>{allowed=true});
     assert.equal(allowed,expected,method+' '+url+' '+JSON.stringify(menus));
     if(!expected)assert.equal(res.statusCode,403);
   }
 }
 const routes=app._router.stack.filter(item=>typeof item.route?.path==='string'&&item.route.path.startsWith('/api/ivr-audios'));
 assert.equal(routes.length,4);
 for(const route of routes){
   const res=response();let allowed=false;
   await route.route.stack[1].handle({method:'GET',path:'/api/ivr-audios',session:{user:user({audios:true})}},res,()=>{allowed=true});
   assert.equal(allowed,false);assert.equal(res.statusCode,403,'Missing library authorization '+route.route.path);
 }
});

test('report access alone does not grant recording playback or download',async()=>{
 let current;
 const context={getUsers:async()=>({users:[current]}),authFingerprint:()=> 'valid',publicUser:value=>value,hasMenuAccess:_test.hasMenuAccess,rejectSession:()=>assert.fail('Unexpected expired session')};
 vm.runInNewContext(server.slice(server.indexOf('async function requireAuth('),server.indexOf('function userRole(')),context);
 for(const menus of [{ivrAudios:true},{reports:true},{audios:true},{audios:true,ivrAudios:true}]){
   current=user(menus);
   const scope=_test.userReportScope({session:{user:current}},{});
   assert.equal(scope.canListen,menus.audios===true);assert.equal(scope.canDownload,menus.audios===true);
   for(const operation of ['exists','play','download']){
     let allowed=false;const res=response();
     await context.requireAuth({path:'/api/pbx/recordings/qa/'+operation,session:{user:current,userAuthFingerprint:'valid'}},res,()=>{allowed=true});
     assert.equal(allowed,menus.audios===true,operation+' '+JSON.stringify(menus));
     if(!allowed)assert.equal(res.statusCode,403);
   }
 }
});

test('frontend permissions distinguish both pages and recording navigation never requests IVR audio',async()=>{
 const context={state:{user:user({audios:true}),config:{}},loadRecordingLibrary:async()=>calls.push('recordings'),loadIvrAudios:async()=>calls.push('ivr'),renderAudios(){},renderIvrAudios(){},iconRefresh(){}};
 const calls=[];
 const declarations=frontend.match(/const menuPermissions = \{[\s\S]*?\n\};/)[0]+frontend.match(/const adminOnlyTabs = new Set\([^;]+;/)[0];
 vm.runInNewContext(declarations+frontend.slice(frontend.indexOf('function canAccessTab('),frontend.indexOf('function firstAllowedTab('))+frontend.slice(frontend.indexOf('async function fetchTabData('),frontend.indexOf('async function setActiveTab(')),context);
 assert.equal(context.canAccessTab('audios'),true);assert.equal(context.canAccessTab('ivrAudios'),false);
 await context.fetchTabData('audios');assert.deepEqual(calls,['recordings']);
 context.state.user=user({ivrAudios:true});
 assert.equal(context.canAccessTab('audios'),false);assert.equal(context.canAccessTab('ivrAudios'),true);
 calls.length=0;await context.fetchTabData('ivrAudios');assert.deepEqual(calls,['ivr']);
});

test('sidebar hides empty groups and restores each heading when an authorized item appears',()=>{
 const item=(heading,hidden)=>{const classes=new Set(hidden?['hidden']:[]);return {nextElementSibling:null,matches:s=>s==='.nav-group'?heading:!heading,classList:{contains:c=>classes.has(c),toggle:(c,on)=>on?classes.add(c):classes.delete(c)}}};
 const top=item(false,false),phone=item(true,false),audio=item(false,true),admin=item(true,false),users=item(false,true);
 const nodes=[top,phone,audio,admin,users];nodes.forEach((node,i)=>{node.nextElementSibling=nodes[i+1]||null});
 const root={querySelectorAll:()=>[phone,admin]};
 const context={};vm.runInNewContext(frontend.slice(frontend.indexOf('function updateNavigationGroups('),frontend.indexOf('function canAccessTab(')),context);
 context.updateNavigationGroups(root);assert.equal(phone.classList.contains('hidden'),true);assert.equal(admin.classList.contains('hidden'),true);
 audio.classList.toggle('hidden',false);context.updateNavigationGroups(root);assert.equal(phone.classList.contains('hidden'),false);assert.equal(admin.classList.contains('hidden'),true);
 users.classList.toggle('hidden',false);context.updateNavigationGroups(root);assert.equal(admin.classList.contains('hidden'),false);
 audio.classList.toggle('hidden',true);context.updateNavigationGroups(root);assert.equal(phone.classList.contains('hidden'),true);
});

test('ending or restricting a session clears cached audio pages',()=>{
 const context={state:{user:null,ivrAudios:[{url:'/private'}],recordingLibrary:{calls:[{id:'old'}]}},pages:{audios:{innerHTML:'old'},ivrAudios:{innerHTML:'old'}},canAccessTab:()=>false};
 vm.runInNewContext(frontend.slice(frontend.indexOf('function clearRestrictedAudioViews('),frontend.indexOf('function updateNavigationGroups(')),context);
 context.clearRestrictedAudioViews();
 assert.equal(context.state.ivrAudios.length,0);assert.equal(context.state.recordingLibrary.calls.length,0);assert.equal(context.pages.audios.innerHTML,'');assert.equal(context.pages.ivrAudios.innerHTML,'');
 assert.equal(context.state.recordingLibrary.requestId,1);
});

test('an old IVR request cannot repopulate audio after the user leaves the session',async()=>{
 let resolve;
 const context={state:{user:user({ivrAudios:true}),ivrAudios:[]},api:()=>new Promise(done=>{resolve=done}),canAccessTab:()=>true,renderIvrAudios:()=>assert.fail('Stale render'),iconRefresh(){}};
 vm.runInNewContext(frontend.slice(frontend.indexOf('async function loadIvrAudios('),frontend.indexOf('let dialerCampaignsRequest')),context);
 const pending=context.loadIvrAudios();context.state.user=null;
 resolve({audios:[{file:'stale.wav'}]});await pending;
 assert.equal(context.state.ivrAudios.length,0);
});
