const {_electron}=require(process.env.PBX_PLAYWRIGHT_MODULE||'playwright');
const path=require('node:path');
(async()=>{
 const target=process.argv[2];if(!/^\d{8,15}$/.test(target||''))throw Error('Provide an authorized test destination.');
 let input='';for await(const chunk of process.stdin)input+=chunk;
 const credential=JSON.parse(Buffer.from(input.trim(),'base64').toString())[0];
 const app=await _electron.launch({executablePath:path.resolve(__dirname,'../dist-installer/win-unpacked/UAI PBX Ramal.exe'),args:['--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],env:{...process.env,UAI_PBX_TEST_USER_DATA:path.resolve(__dirname,'../.build/qa-external')}});
 let page;
 try {
  page=await app.firstWindow();await page.waitForFunction(()=>!document.querySelector('#loginBtn').disabled);
  await page.locator('#extensionInput').fill(String(credential.number));
  await page.locator('#passwordInput').fill(credential.secret);
  await page.locator('#loginBtn').click();await page.waitForFunction(()=>state.registrationStatus==='online',null,{timeout:45000});
  await page.locator('#numberInput').fill(target);await page.locator('#callBtn').click();
  await page.waitForFunction(()=>state.callPending||Boolean(state.session));
  console.log('External test originated');
  await page.waitForTimeout(25000);
  console.log(JSON.stringify(await page.evaluate(async()=>{
   const pc=state.session?.sessionDescriptionHandler?.peerConnection;
   const stats=pc?[...(await pc.getStats()).values()]:[];
   return {session:state.session?.state||null,message:document.querySelector('#callMessage').textContent,media:stats.filter(s=>['inbound-rtp','outbound-rtp'].includes(s.type)).map(s=>({type:s.type,packetsReceived:s.packetsReceived,packetsSent:s.packetsSent}))};
  })));
 }finally{
  if(page)await page.evaluate(async()=>{await hangupCurrentCall();await window.pbxAPI.logout();await stopSoftphone();}).catch(()=>{});
  await app.close();
 }
})().catch(e=>{console.error(e.message);process.exitCode=1;});
