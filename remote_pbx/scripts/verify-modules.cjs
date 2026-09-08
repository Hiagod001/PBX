const assert=require('node:assert/strict');
const path=require('node:path');
const express=require('express');
const {chromium}=require(process.env.PBX_PLAYWRIGHT_MODULE||'playwright');
const {defaultConfig}=require('../src/store');
(async()=>{
 const app=express();app.use(express.static(path.join(__dirname,'../public')));
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const browser=await chromium.launch({headless:true,channel:'chrome'});
 try {
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/**',r=>r.fulfill({contentType:'application/json',body:JSON.stringify({user:null,data:[],campaigns:[],audios:[]})}));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.evaluate(config=>{
   state.user={username:'admin',role:'admin'};state.config=config;state.configBaseline=structuredClone(config);renderShell();renderAll();
  },structuredClone(defaultConfig));
  for(const theme of ['light','dark'])for(const tab of ['overview','status','extensions','queues','trunk','routing','ivr','dialer','audios','security','logs','reports','audit','users']) {
   await page.evaluate(({tab,theme})=>{state.activeTab=tab;applyTheme(theme);syncActiveTabUi();},{tab,theme});
   assert.ok(await page.locator(`#tab-${tab}`).isVisible(),tab+' visible');
   assert.ok((await page.locator(`#tab-${tab}`).innerText()).trim().length>0,tab+' nonempty');
   console.log('PASS '+theme+' '+tab);
  }
  await page.evaluate(()=>{state.activeTab='extensions';syncActiveTabUi();});
  assert.ok(await page.locator('[data-save-config="extensions"]').count());
  const field=page.locator('#tab-extensions [data-field="name"]').first();
  await field.fill('QA draft A');
  let release; const gate=new Promise(r=>release=r); let request;
  await page.route('**/api/config/apply',async route=>{
   request=route.request().postDataJSON(); await gate;
   const config=structuredClone(defaultConfig);Object.assign(config,request.sections);
   await route.fulfill({contentType:'application/json',body:JSON.stringify({config,reloaded:false})});
  });
  await page.locator('[data-save-config="extensions"]').first().click();
  await page.waitForFunction(()=>state.configSaving);
  await field.fill('QA draft B');release();
  await page.waitForFunction(()=>!state.configSaving);
  assert.deepEqual(Object.keys(request.sections),['extensions']);
  assert.equal(await field.inputValue(),'QA draft B');
  assert.equal(await page.evaluate(()=>state.config.extensions[0].name),'QA draft B');
  assert.equal(await page.evaluate(()=>state.configBaseline.extensions[0].name),'QA draft A');
  assert.deepEqual(errors,[]);
  console.log('PASS scoped save and typing during request preserves unsaved draft');
 }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
