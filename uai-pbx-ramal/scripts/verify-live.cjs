const { _electron } = require(process.env.PBX_PLAYWRIGHT_MODULE || 'playwright');
const path = require('node:path');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
async function main() {
  let input=''; for await (const chunk of process.stdin) input+=chunk;
  const credentials=JSON.parse(Buffer.from(input.trim(),'base64').toString());
  assert.ok(credentials.length >= 2 && credentials.every(c=>/^997[123]$/.test(c.number)), 'Use isolated QA extensions only.');
  const profile=await fs.mkdtemp(path.join(os.tmpdir(),'uai-pbx-verify-'));
  const apps=[], pages=[];
  const outcomes=[];
  async function check(name, fn) { console.log('CHECK '+name); await fn(); outcomes.push(name); console.log('PASS '+name); }
  try {
    for(const [index, credential] of credentials.entries()) {
      const packaged=process.argv.includes('--packaged');
      const app=await _electron.launch({executablePath:path.resolve(__dirname,packaged?'../dist-installer/win-unpacked/UAI PBX Ramal.exe':'../node_modules/electron/dist/electron.exe'),args:[...(packaged?[]:[path.resolve(__dirname,'..')]),'--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],env:{...process.env,UAI_PBX_TEST_USER_DATA:path.join(profile,String(index)),UAI_PBX_TEST_HEADLESS:'1'}});
      apps.push(app); const page=await app.firstWindow(); pages.push(page);
      await page.waitForFunction(()=>!document.querySelector('#loginBtn').disabled);
      await page.locator('#extensionInput').fill(String(credential.number));
      await page.locator('#passwordInput').fill(String(credential.password || credential.secret));
      await page.locator('#loginBtn').click();
      await page.waitForFunction(()=>state.registrationStatus==='online',null,{timeout:45000}).catch(async e=>{throw Error(`Registration ${credential.number}: ${await page.locator('#loginMessage').innerText()} / ${await page.locator('#callMessage').innerText()}`);});
      console.log('PASS registration '+credential.number);
    }
    const [a,b]=pages;
    const call=async()=>{
      await a.locator('#numberInput').fill(String(credentials[1].number));
      await a.locator('#callBtn').click();
      await a.waitForFunction(()=>state.callPending||Boolean(state.session),null,{timeout:10000});
    };
    if (!process.env.PBX_MONITOR_QA) {
    await check('pause and authoritative status',async()=>{
      await b.evaluate(()=>startPause('Treinamento'));
      await b.waitForFunction(()=>paused===true);
      assert.equal(await b.evaluate(async()=> (await window.pbxAPI.status()).status.extension.paused),true);
    });
    await check('paused extension rejects incoming call',async()=>{
      await call();
      await a.waitForFunction(()=>!state.session&&!state.callPending,null,{timeout:35000});
      assert.equal(await b.evaluate(()=>Boolean(state.session)),false);
    });
    await check('resume pause',async()=>{
      await b.locator('#resumeOverlayBtn').click();
      await b.waitForFunction(()=>paused===false);
    });
    await check('ringing and cancel before answer',async()=>{
      await call();await b.waitForFunction(()=>state.incoming&&Boolean(state.session),null,{timeout:30000});
      await a.locator('#activeHangupBtn').click();
      await b.waitForFunction(()=>!state.session,null,{timeout:10000});
    });
    }
    await check('answer and bidirectional media packets',async()=>{
      await call();await b.waitForFunction(()=>state.incoming&&Boolean(state.session),null,{timeout:30000});
      await b.locator('#activeAnswerBtn').click();
      for(const p of [a,b]) {
        await p.waitForFunction(()=>state.session?.state==='Established',null,{timeout:20000});
        await p.waitForFunction(async()=>{
          const pc=state.session?.sessionDescriptionHandler?.peerConnection;
          if(!pc)return false;
          const stats=[...(await pc.getStats()).values()];
          return stats.some(s=>s.type==='inbound-rtp'&&s.packetsReceived>10)&&stats.some(s=>s.type==='outbound-rtp'&&s.packetsSent>10);
        },null,{timeout:20000});
        assert.ok((await p.evaluate(async()=> (await window.pbxAPI.status()).status.active)).length>0);
      }
    });
    await check('microphone mute and unmute',async()=>{
      await b.locator('#activeMuteBtn').click();
      assert.equal(await b.evaluate(()=>state.session.sessionDescriptionHandler.peerConnection.getSenders().filter(s=>s.track?.kind==='audio').every(s=>!s.track.enabled)),true);
      await b.locator('#activeMuteBtn').click();
      assert.equal(await b.evaluate(()=>state.session.sessionDescriptionHandler.peerConnection.getSenders().filter(s=>s.track?.kind==='audio').every(s=>s.track.enabled)),true);
    });
    await check('transport reconnect preserves an established call and bidirectional media',async()=>{
      await b.evaluate(async()=>{ window.qaLiveSession=state.session; window.qaLiveAgent=state.ua; await state.ua.transport.disconnect(); });
      await b.waitForFunction(()=>state.registrationStatus==='online'&&state.ua.transport.state==='Connected',null,{timeout:45000});
      assert.equal(await b.evaluate(()=>state.session===window.qaLiveSession&&state.ua===window.qaLiveAgent&&state.session.state==='Established'),true);
      for(const p of [a,b]) await p.waitForFunction(async()=>{
        const pc=state.session?.sessionDescriptionHandler?.peerConnection;
        if(!pc)return false;
        const stats=[...(await pc.getStats()).values()];
        return stats.some(x=>x.type==='inbound-rtp'&&x.packetsReceived>30)&&stats.some(x=>x.type==='outbound-rtp'&&x.packetsSent>30);
      },null,{timeout:15000});
    });
    if(pages[2]) {
      const c=pages[2];
      const consult=async()=>{
        await b.locator('#transferBtn').click();
        await b.locator('#transferTargetInput').fill(credentials[2].number);
        await b.locator('#confirmTransferBtn').click();
        await c.waitForFunction(()=>state.incoming&&Boolean(state.session),null,{timeout:15000});
      };
      await check('assisted transfer waits for answer and returns to client',async()=>{
        await consult();
        assert.equal(await b.locator('#completeTransferBtn').isDisabled(),true);
        await b.locator('#cancelTransferBtn').click();
        await c.waitForFunction(()=>!state.session,null,{timeout:10000});
        await b.waitForFunction(()=>assistedTransfer.phase==='idle');
        assert.equal(await a.evaluate(()=>state.session.state),'Established');
      });
      await check('assisted conversation and completed transfer',async()=>{
        if(await b.locator('#transferTargetInput').isVisible()) await b.locator('#transferBtn').click();
        await consult();
        await c.locator('#activeAnswerBtn').click();
        await b.waitForFunction(()=>assistedTransfer.phase==='consulting',null,{timeout:15000});
        await b.waitForFunction(async()=>{const s=[...(await assistedTransfer.consult.sessionDescriptionHandler.peerConnection.getStats()).values()];return s.some(x=>x.type==='inbound-rtp'&&x.packetsReceived>5)&&s.some(x=>x.type==='outbound-rtp'&&x.packetsSent>5)},null,{timeout:15000});
        await b.locator('#completeTransferBtn').click();
        await b.waitForFunction(()=>!state.session&&assistedTransfer.phase==='idle',null,{timeout:20000});
        for(const p of [a,c]) assert.equal(await p.evaluate(()=>state.session?.state),'Established');
        await c.waitForFunction(async()=>{const s=[...(await state.session.sessionDescriptionHandler.peerConnection.getStats()).values()];return s.some(x=>x.type==='inbound-rtp'&&x.packetsReceived>15)&&s.some(x=>x.type==='outbound-rtp'&&x.packetsSent>15)},null,{timeout:15000});
        await c.locator('#activeHangupBtn').click();
        await a.waitForFunction(()=>!state.session,null,{timeout:10000});
        await call();
        await b.waitForFunction(()=>state.incoming&&Boolean(state.session),null,{timeout:15000});
        await b.locator('#activeAnswerBtn').click();
        await b.waitForFunction(()=>state.session?.state==='Established',null,{timeout:15000});
      });
    }
    await check('hangup established call clears both endpoints',async()=>{
      if (process.env.PBX_MONITOR_QA) await require(process.env.PBX_MONITOR_QA)(pages, credentials);
      await b.locator('#activeHangupBtn').click();
      for(const p of pages)await p.waitForFunction(()=>!state.session&&!state.callPending,null,{timeout:10000});
    });
    await check('server hangup is idempotent after SIP ends',async()=>{
      for(const p of pages) assert.equal((await p.evaluate(()=>window.pbxAPI.hangup({}))).ok,true);
    });
    await check('SIP reconnect after transport disconnect',async()=>{
      await b.evaluate(()=>state.ua.transport.disconnect());
      await b.waitForFunction(()=>state.registrationStatus!=='online');
      await b.waitForFunction(()=>state.registrationStatus==='online',null,{timeout:45000});
    });
    await check('logout while paused clears pause on next login',async()=>{
      await b.evaluate(()=>startPause('Treinamento'));
      await b.evaluate(()=>document.querySelector('#logoutBtn').click());
      await b.locator('#loginBtn').waitFor({state:'visible'});
      await b.locator('#extensionInput').fill(String(credentials[1].number));
      await b.locator('#passwordInput').fill(credentials[1].secret||credentials[1].password);
      await b.locator('#loginBtn').click();
      await b.waitForFunction(()=>state.registrationStatus==='online',null,{timeout:45000});
      assert.equal(await b.evaluate(async()=> (await window.pbxAPI.status()).status.extension.paused),false);
    });
  } finally {
    for(const page of pages) {
      await page.evaluate(async()=>{await hangupCurrentCall();await window.pbxAPI.logout();await stopSoftphone();}).catch(()=>{});
    }
    for(const app of apps) await app.close().catch(()=>{});
    const resolved=path.resolve(profile);
    assert.equal(path.dirname(resolved),path.resolve(os.tmpdir()));
    assert.ok(path.basename(resolved).startsWith('uai-pbx-verify-'));
    await fs.rm(resolved,{recursive:true,force:true}).catch(()=>{});
  }
  console.log(JSON.stringify({passed:outcomes}));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
