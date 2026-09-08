const { chromium } = require(process.env.PBX_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
module.exports = async (phones, credentials) => {
  const browser = await chromium.launch({channel:'chrome',headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
  const page = await browser.newPage();
  page.on('response',async response=>{if(response.url().includes('/api/pbx/monitor/action')&&response.status()>=400)console.log('Monitor API error',await response.text());});
  const target = String(credentials[1].number);
  try {
    for (const phone of phones) await phone.evaluate(() => {
      const pc=state.session.sessionDescriptionHandler.peerConnection;
      pc.getSenders().forEach(s=>{if(s.track)s.track.enabled=false;});
      const ctx=new AudioContext();
      const analyser=ctx.createAnalyser();analyser.fftSize=2048;
      ctx.createMediaStreamSource(new MediaStream(pc.getReceivers().map(r=>r.track).filter(Boolean))).connect(analyser);
      window.qaMonitorAnalyser=analyser;window.qaMonitorContext=ctx;return ctx.resume();
    });
    await page.goto('https://uaipbx.uaitelecom.com.br/');
    await page.locator('#loginForm [name=username]').fill('admin');
    await page.locator('#loginForm [name=password]').fill(process.env.PBX_ADMIN_PASSWORD);
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#appView').waitFor({state:'visible'});
    await page.evaluate(()=>setActiveTab('status',{load:true}));
    await page.locator(`[data-monitor-spy="${target}"]`).first().click();
    await page.waitForFunction(()=>!state.monitorSpy.busy&&state.monitorSpy.status==='Pronta');
    for(const mode of ['listen','whisper','barge','listen']) {
      if(mode==='listen' && !await page.evaluate(()=>Boolean(state.monitorSpy.session))) await page.locator('#monitorSpyStartBtn').click();
      else await page.locator(`[data-monitor-spy-mode="${mode}"]`).click();
      await page.waitForFunction(mode=>state.monitorSpy.mode===mode&&state.monitorSpy.session?.state==='Established'&&!state.monitorSpy.busy,mode,{timeout:25000}).catch(async error=>{
        console.log(await page.evaluate(()=>({mode:state.monitorSpy.mode,session:state.monitorSpy.session?.state,busy:state.monitorSpy.busy,status:state.monitorSpy.status,output:state.monitorSpy.output})));
        throw error;
      });
      await page.waitForFunction(async()=>{
        const pc=state.monitorSpy.session?.sessionDescriptionHandler?.peerConnection;
        return pc&&[...(await pc.getStats()).values()].some(s=>s.type==='inbound-rtp'&&s.packetsReceived>20);
      },null,{timeout:10000});
      if (mode !== 'listen') await page.evaluate(async()=>{
        const ctx=new AudioContext();await ctx.resume();
        const oscillator=ctx.createOscillator();oscillator.frequency.value=1000;
        const gain=ctx.createGain();gain.gain.value=.15;
        const destination=ctx.createMediaStreamDestination();oscillator.connect(gain).connect(destination);oscillator.start();
        const sender=state.monitorSpy.session.sessionDescriptionHandler.peerConnection.getSenders().find(s=>s.track?.kind==='audio');
        if(!sender)throw Error('Missing supervisor microphone sender');
        await sender.replaceTrack(destination.stream.getAudioTracks()[0]);
        window.qaTone={ctx,oscillator};
      });
      await page.waitForTimeout(1200);
      const levels=[];
      for(const phone of phones)levels.push(await phone.evaluate(()=>{
        const samples=new Float32Array(window.qaMonitorAnalyser.fftSize);
        window.qaMonitorAnalyser.getFloatTimeDomainData(samples);
        return Math.sqrt(samples.reduce((sum,x)=>sum+x*x,0)/samples.length);
      }));
      if(mode==='whisper'){assert.ok(levels[1]>.01,'operator hears supervisor');assert.ok(levels[0]<.005,'other party cannot hear whisper');}
      if(mode==='barge')assert.ok(levels.every(x=>x>.01),'both parties hear intervention');
      if(mode==='listen')assert.ok(levels.every(x=>x<.005),'listen does not transmit');
      await page.evaluate(()=>{window.qaTone?.oscillator.stop();window.qaTone?.ctx.close();window.qaTone=null;});
      console.log('PASS audio isolation '+mode+' '+JSON.stringify(levels));
      await page.evaluate(()=>{window.qaAudio=document.querySelector('#monitorSpyAudio');renderMonitorSpyPortal();});
      assert.equal(await page.evaluate(()=>window.qaAudio===document.querySelector('#monitorSpyAudio')),true);
      for(const phone of phones) assert.equal(await phone.evaluate(()=>state.session?.state),'Established');
      console.log('PASS live monitor '+mode+' receives audio; call preserved');
    }
    await page.locator('#monitorSpyStopBtn').click();
    await page.waitForFunction(()=>!state.monitorSpy.session&&!state.monitorSpy.busy);
  } finally {
    await page.evaluate(()=>stopMonitorSpy()).catch(()=>{});
    await browser.close();
  }
};
