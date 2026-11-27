const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{createHash}=require('node:crypto'),yaml=require('js-yaml');
const {createUpdateFeed}=require('../scripts/update-feed');
test('generated release feed matches immutable installer bytes and retains the blockmap',async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pbx-feed-'));
 try{
  const exe=path.join(dir,'test.exe');await fs.writeFile(exe,'MZtest');await fs.writeFile(exe+'.blockmap','blocks');
  await createUpdateFeed(exe,'1.0.13',path.join(dir,'updates'));
  const feed=yaml.load(await fs.readFile(path.join(dir,'updates/latest.yml'),'utf8'));
  assert.equal(feed.version,'1.0.13');assert.equal(feed.files[0].url,'1.0.13/UAI-PBX-Ramal-Setup.exe');
  const bytes=await fs.readFile(path.join(dir,'updates',feed.files[0].url));assert.equal(feed.sha512,createHash('sha512').update(bytes).digest('base64'));assert.equal(feed.files[0].size,bytes.length);
  assert.equal(await fs.readFile(path.join(dir,'updates',feed.files[0].url+'.blockmap'),'utf8'),'blocks');
  const metadata=JSON.parse(await fs.readFile(path.join(dir,'updates/latest.json'),'utf8'));assert.equal(metadata.sha256,createHash('sha256').update(bytes).digest('hex'));
  await assert.rejects(createUpdateFeed(exe,'../escape',path.join(dir,'updates')));
 }finally{await fs.rm(dir,{recursive:true,force:true})}
});
