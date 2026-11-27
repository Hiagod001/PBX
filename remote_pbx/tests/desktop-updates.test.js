const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),express=require('express');
const {desktopUpdateRouter}=require('../src/desktop-updates');
test('public updater serves a fresh feed and immutable ranged installers without exposing other paths',async()=>{
 const directory=await fs.mkdtemp(path.join(os.tmpdir(),'pbx-updates-'));
 let server;
 try{
  await fs.mkdir(path.join(directory,'updates/1.0.13'),{recursive:true});
  await fs.writeFile(path.join(directory,'updates/latest.yml'),'version: 1.0.13\n');
  await fs.writeFile(path.join(directory,'updates/1.0.13/UAI-PBX-Ramal-Setup.exe'),'MZtestinstaller');
  const app=express();app.use('/updates',desktopUpdateRouter(directory));
  server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const url='http://127.0.0.1:'+server.address().port+'/updates';
  const feed=await fetch(url+'/latest.yml');assert.equal(feed.status,200);assert.equal(feed.headers.get('cache-control'),'no-store');assert.match(await feed.text(),/1\.0\.13/);
  const partial=await fetch(url+'/1.0.13/UAI-PBX-Ramal-Setup.exe',{headers:{Range:'bytes=0-1'}});assert.equal(partial.status,206);assert.equal(await partial.text(),'MZ');assert.match(partial.headers.get('cache-control'),/immutable/);
  for(const route of ['/1.0.13/users.json','/no-version/UAI-PBX-Ramal-Setup.exe','/1.0.99/UAI-PBX-Ramal-Setup.exe','/1.0.13/%2e%2e%2fusers.json']){
   const result=await fetch(url+route);assert.equal(result.status,404);assert.doesNotMatch(await result.text(),new RegExp(directory.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  }
 }finally{if(server)await new Promise(resolve=>server.close(resolve));await fs.rm(directory,{recursive:true,force:true});}
});
