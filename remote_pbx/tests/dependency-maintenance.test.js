const test = require('node:test');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const path = require('node:path');
const http = require('node:http');
const zlib = require('node:zlib');
const load = createRequire(path.join(process.env.PBX_DEPENDENCY_TEST_ROOT || path.resolve(__dirname, '..'), 'package.json'));

async function withServer(app, run) {
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try { await run(`http://127.0.0.1:${server.address().port}`); }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('compressed JSON and malformed trailing data cannot terminate the API process', async () => {
  const app = load('express')();
  app.use(load('express').json({limit:'1mb'}));
  app.post('/', (req, res) => res.json(req.body));
  app.get('/health', (_req, res) => res.json({ok:true}));
  app.use((err, _req, res, _next) => res.status(err.status || 400).json({error:true}));
  await withServer(app, async base => {
    for (const [encoding, compress] of [['gzip',zlib.gzipSync],['deflate',zlib.deflateSync]]) {
      const compressed = compress(Buffer.from('{"number":"9971"}'));
      const send = body => fetch(base, {method:'POST',headers:{'Content-Type':'application/json','Content-Encoding':encoding},body,signal:AbortSignal.timeout(2000)});
      const valid = await send(compressed);
      assert.equal(valid.status,200);
      assert.deepEqual(await valid.json(),{number:'9971'});
      const malformed = await send(Buffer.concat([compressed,Buffer.from('trailing-invalid-data')]));
      assert.ok([200,400].includes(malformed.status));
      await malformed.arrayBuffer();
      await new Promise(resolve => setTimeout(resolve,50));
      assert.equal((await fetch(base+'/health')).status,200);
    }
  });
});

test('multipart parser rejects overflowing indexes while accepting ordinary audio uploads', async () => {
  const app = load('express')();
  const multer = load('multer');
  app.post('/', multer({limits:{fileSize:1024}}).single('audio'), (req,res)=>res.json({name:req.body.name,size:req.file?.size}));
  app.use((err,_req,res,_next)=>res.status(400).json({code:err.code}));
  await withServer(app, async base => {
    const valid=new FormData();valid.set('name','Áudio de teste');valid.set('audio',new Blob(['RIFFtest'],{type:'audio/wav'}),'test.wav');
    const accepted=await fetch(base,{method:'POST',body:valid});
    assert.equal(accepted.status,200);assert.deepEqual(await accepted.json(),{name:'Áudio de teste',size:8});
    const bad=new FormData();bad.append('items[4294967294]','x');bad.append('items[]','y');
    const rejected=await fetch(base,{method:'POST',body:bad,signal:AbortSignal.timeout(2000)});
    assert.equal(rejected.status,400);
    assert.ok(['LIMIT_FIELD_ARRAY_INDEX','INVALID_FIELD_NAME'].includes((await rejected.json()).code));
    const oversized=new FormData();oversized.set('audio',new Blob([Buffer.alloc(1025)]),'large.wav');
    const limited=await fetch(base,{method:'POST',body:oversized});
    assert.equal(limited.status,400);assert.equal((await limited.json()).code,'LIMIT_FILE_SIZE');
  });
});

test('proxy subnet trust and query parsing preserve their boundaries',()=>{
  const proxy=load('proxy-addr');
  for(const subnet of ['::ffff:10.0.0.0/8','::/1']) assert.equal(proxy.compile(subnet)('203.0.113.10',0),false);
  const ordinary=proxy.compile('10.0.0.0/8');
  assert.equal(ordinary('10.1.2.3',0),true);assert.equal(ordinary('203.0.113.10',0),false);
  const qs=load('qs');
  const parsed=qs.parse('item[constructor][isBuffer]=invalid',{allowPrototypes:true});
  assert.doesNotThrow(()=>qs.stringify(parsed));
  assert.deepEqual(qs.parse('queue=equipamentos&limit=20'),{queue:'equipamentos',limit:'20'});
});

test('access logs escape quoted headers and Unicode line separators',async()=>{
  let log='';const app=load('express')();
  app.use(load('morgan')('combined',{stream:{write:line=>{log+=line;}}}));
  app.get('/',(_req,res)=>res.json({ok:true}));
  await withServer(app,async base=>{
    await new Promise((resolve,reject)=>{
      http.get(base,{headers:{'User-Agent':'test"quoted\x85injected'}},res=>{res.resume();res.on('end',resolve)}).on('error',reject);
    });
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(log.includes('\x85'),false);
    assert.ok(log.includes('test\\"quoted'));
    assert.equal(log.trimEnd().split('\n').length,1);
  });
});
