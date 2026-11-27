const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto');
const {publishDesktopRelease}=require('../scripts/publish-desktop-release');
test('release publishing validates checksums, keeps versioned files immutable and switches the feed last',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pbx-publish-')),stage=path.join(dir,'stage'),out=path.join(dir,'releases');
 const name='UAI-PBX-Ramal-Setup.exe';
 const prepare=async(version,body)=>{await fs.mkdir(path.join(stage,version),{recursive:true});await fs.writeFile(path.join(stage,version,name),body);await fs.writeFile(path.join(stage,version,name+'.blockmap'),'map');await fs.writeFile(path.join(stage,'latest.json'),JSON.stringify({version,sha256:createHash('sha256').update(body).digest('hex'),size:body.length,releasedAt:new Date().toISOString()}))};
 try{
  await prepare('1.0.13','MZtest');await publishDesktopRelease(stage,out);
  assert.match(await fs.readFile(path.join(out,'updates/latest.yml'),'utf8'),/1\.0\.13\/UAI-PBX/);
  assert.equal(await fs.readFile(path.join(out,name),'utf8'),'MZtest');
  await publishDesktopRelease(stage,out);
  await prepare('1.0.13','MZother');await assert.rejects(publishDesktopRelease(stage,out),/não pode ser substituída/);
  await prepare('1.0.12','MZolder');await assert.rejects(publishDesktopRelease(stage,out),/versão anterior/);
  await prepare('1.0.14','MZnext');await fs.writeFile(path.join(stage,'1.0.14',name),'MZtampered');await assert.rejects(publishDesktopRelease(stage,out),/não corresponde/);
  assert.match(await fs.readFile(path.join(out,'updates/latest.yml'),'utf8'),/version: 1\.0\.13/);
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
