const fs=require('node:fs/promises'),native=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),express=require('../../remote_pbx/node_modules/express');
const {_electron}=require(process.env.PBX_PLAYWRIGHT_MODULE || 'playwright');
const {desktopUpdateRouter}=require('../../remote_pbx/src/desktop-updates');
const root=path.resolve(__dirname,'../..'),lab=path.join(root,'uai-pbx-ramal/.build/update-qa-20261127'),project=path.join(lab,'project'),feed=path.join(lab,'feed'),profile=path.join(lab,'profile'),installed=path.join(lab,'installed');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
async function run(executable,args,options={}){
 await new Promise((resolve,reject)=>{const child=spawn(executable,args,{cwd:project,windowsHide:true,stdio:'inherit',...options});child.on('error',reject);child.on('exit',c=>c===0?resolve():reject(Error('Command failed with exit '+c)))});
}
async function wait(fn,timeout=120000){const end=Date.now()+timeout;while(Date.now()<end){if(await fn())return;await sleep(500)}throw Error('QA condition timed out')}
(async()=>{
 await fs.mkdir(project,{recursive:true});await fs.mkdir(feed,{recursive:true});await fs.rm(path.join(lab,'stop'),{force:true});
 const web=express();web.use(express.json());
 let corrupt=true;
 web.get('/updates/latest.yml',async(_req,res)=>{let body=await fs.readFile(path.join(feed,'updates/latest.yml'),'utf8');if(corrupt)body=body.replace(/sha512: [^\n]+/g,'sha512: '+Buffer.alloc(64,1).toString('base64'));res.type('text/yaml').send(body)});
 web.use('/updates',desktopUpdateRouter(feed));
 web.post('/api/extensions/login',(_req,res)=>{res.setHeader('Set-Cookie','pbx.sid=qa-update-only; Max-Age=28800; HttpOnly; SameSite=Lax; Path=/');res.json({extension:{number:'9971',name:'QA atualizacao'}})});
 web.get('/api/extensions/me',(req,res)=>res.json({extension:req.headers.cookie?.includes('qa-update-only')?{number:'9971',name:'QA atualizacao'}:null}));
 web.get('/api/extensions/status',(_req,res)=>res.json({active:[],extension:{registered:false,paused:false},queues:[]}));
 web.get('/api/extensions/portal',(_req,res)=>res.json({extension:{number:'9971'},sip:{uri:'sip:9971@127.0.0.1',authorizationUsername:'9971',password:'qa-only',wsServer:'ws://127.0.0.1:1/ws',domain:'127.0.0.1'}}));
 const reuse=process.env.PBX_UPDATE_QA_REUSE==='1';
 const previous=reuse?JSON.parse(await fs.readFile(path.join(project,'package.json'),'utf8')):null;
 const server=web.listen(reuse?Number(new URL(previous.build.publish[0].url).port):0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 const address='http://127.0.0.1:'+server.address().port;
 let app,passed=false;
 try{
  if(!reuse){
  for(const dir of ['src','assets'])await fs.cp(path.join(root,'uai-pbx-ramal',dir),path.join(project,dir),{recursive:true});
  await fs.writeFile(path.join(project,'src/qa-entry.js'),`process.env.UAI_PBX_TEST_USER_DATA=${JSON.stringify(profile)};process.env.UAI_PBX_TEST_HEADLESS='1';process.env.UAI_PBX_TEST_UPDATES='1';process.env.UAI_PBX_TEST_UPDATE_URL=${JSON.stringify(address+'/updates/')};process.env.UAI_PBX_URL=${JSON.stringify(address)};require('./main');const fs=require('fs'),path=require('path'),{app,BrowserWindow}=require('electron');setInterval(async()=>{if(fs.existsSync(${JSON.stringify(path.join(lab,'stop'))})){app.quit();return;}const w=BrowserWindow.getAllWindows()[0];if(w){try{const info=await w.webContents.executeJavaScript('window.pbxAPI.server()');fs.writeFileSync(${JSON.stringify(path.join(lab,'running.json'))},JSON.stringify(info));}catch{}}},500);`);
  const source=JSON.parse(await fs.readFile(path.join(root,'uai-pbx-ramal/package.json'),'utf8'));
  const config={name:'uai-pbx-update-qa-20261127',version:'0.0.1',main:'src/qa-entry.js',description:'Isolated updater validation',dependencies:source.dependencies,build:{...source.build,appId:'br.com.uaitelecom.uaipbxramal.updateqa20261127',productName:'UAI PBX Update QA 20261127',publish:[{provider:'generic',url:address+'/updates/',useMultipleRangeRequest:false}],afterPack:undefined,afterAllArtifactBuild:undefined,nsis:{oneClick:true,perMachine:false,allowElevation:false,createDesktopShortcut:false,createStartMenuShortcut:false},directories:{output:path.join(lab,'v1')}}};
  config.build.electronVersion=source.devDependencies.electron;
  await fs.writeFile(path.join(project,'package.json'),JSON.stringify(config,null,2));
  await run('npm.cmd',['install','--omit=dev','--ignore-scripts','--no-audit','--no-fund'],{shell:true});
  const builder=path.join(root,'uai-pbx-ramal/node_modules/electron-builder/out/cli/cli.js');
  for(const version of ['0.0.1','0.0.2']){
   config.version=version;config.build.directories.output=path.join(lab,version==='0.0.1'?'v1':'v2');await fs.writeFile(path.join(project,'package.json'),JSON.stringify(config,null,2));
   await run(process.execPath,[builder,'--win','nsis','--x64','--projectDir',project,'--config.win.signAndEditExecutable=false','--publish','never']);
  }
  }
  const {createUpdateFeed}=require('./update-feed');
  await createUpdateFeed(path.join(lab,'v2/UAI PBX Update QA 20261127 Setup 0.0.2.exe'),'0.0.2',path.join(feed,'updates'));
  await run(path.join(lab,'v1/UAI PBX Update QA 20261127 Setup 0.0.1.exe'),['/S','/D='+installed]);
  await fs.rm(path.join(profile,'sip.log'),{force:true});
  app=await _electron.launch({executablePath:path.join(installed,'UAI PBX Update QA 20261127.exe'),args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream']});
  const page=await app.firstWindow();await page.waitForFunction(()=>window.pbxAPI&&document.querySelector('#loginBtn')?.disabled===false);
  await wait(async()=>{const log=await fs.readFile(path.join(profile,'sip.log'),'utf8').catch(()=> '');return /sha512 checksum mismatch/.test(log)&&(await page.evaluate(()=>window.pbxAPI.updateStatus())).phase==='error'},120000);
  await sleep(1000);
  assert.equal(await page.evaluate(()=>window.pbxAPI.installUpdate()).then(r=>r.ok),false);console.log('PASS checksum rejection prevents installation');
  await page.evaluate(async()=>{const r=await window.pbxAPI.login({extension:'9971',password:'qa-only'});state.extension=r.extension;state.callPending=true});
  corrupt=false;await page.evaluate(()=>window.pbxAPI.checkUpdate());
  await wait(async()=>(await page.evaluate(()=>window.pbxAPI.updateStatus())).phase==='ready',120000);
  assert.equal(await page.evaluate(()=>window.pbxAPI.installUpdate()).then(r=>r.ok),false);
  await sleep(65000);assert.equal((await app.evaluate(({app})=>app.getVersion())),'0.0.1');console.log('PASS automatic and manual installation are blocked during a call');
  await page.evaluate(()=>{state.callPending=false});await sleep(1500);
  await wait(async()=>{try{return JSON.parse(await fs.readFile(path.join(lab,'running.json'),'utf8')).version==='0.0.2'}catch{return false}},180000);
  const info=JSON.parse(await fs.readFile(path.join(lab,'running.json'),'utf8'));assert.equal(info.extension?.number,'9971');
  console.log('PASS actual silent NSIS upgrade, automatic relaunch and authenticated session restoration');
  passed=true;
  await fs.writeFile(path.join(lab,'stop'),'stop');await sleep(2500);
 }finally{
  await fs.writeFile(path.join(lab,'stop'),'stop');if(app)await app.close().catch(()=>{});await new Promise(r=>server.close(r));
  if(passed){
   await sleep(2500);
   await run(path.join(installed,'Uninstall UAI PBX Update QA 20261127.exe'),['/S']);
   assert.equal(path.dirname(path.resolve(lab)),path.resolve(root,'uai-pbx-ramal/.build'));
   assert.equal(path.basename(lab),'update-qa-20261127');
   await fs.rm(lab,{recursive:true,force:true,maxRetries:10,retryDelay:300});
   const cache=path.resolve(process.env.LOCALAPPDATA,'uai-pbx-update-qa-20261127-updater');
   assert.equal(path.dirname(cache),path.resolve(process.env.LOCALAPPDATA));
   await fs.rm(cache,{recursive:true,force:true,maxRetries:10,retryDelay:300});
  }
 }
})().catch(e=>{console.error(e.stack);process.exitCode=1});
