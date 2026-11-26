const { _electron } = require(process.env.PBX_PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

async function main() {
  let input = ''; for await (const part of process.stdin) input += part;
  const credentials = JSON.parse(Buffer.from(input.trim(), 'base64').toString());
  assert.ok(credentials.length >= 2 && credentials.every(c => /^997[123]$/.test(c.number)), 'Use dedicated internal QA extensions 9971–9973 only.');
  const appDir = path.resolve(process.env.PBX_QA_APP_DIR || path.join(__dirname, '..'));
  const executablePath = process.env.PBX_QA_EXECUTABLE || path.resolve(__dirname, '../node_modules/electron/dist/electron.exe');
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'uai-pbx-benchmark-'));
  const apps = [], pages = [], samples = [];
  const started = Date.now();
  try {
    for (const [index, credential] of credentials.slice(0, 2).entries()) {
      const app = await _electron.launch({ executablePath, args: [...(process.argv.includes('--packaged')?[]:[appDir]), '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'], env: {...process.env, UAI_PBX_TEST_USER_DATA:path.join(profile,String(index)), UAI_PBX_TEST_HEADLESS:'1'} });
      apps.push(app);
      const page = await app.firstWindow(); pages.push(page);
      await page.waitForFunction(() => !document.querySelector('#loginBtn').disabled);
      await page.locator('#extensionInput').fill(credential.number);
      await page.locator('#passwordInput').fill(credential.secret);
      await page.locator('#loginBtn').click();
      await page.waitForFunction(() => state.registrationStatus === 'online', null, {timeout:45000});
      if (process.env.PBX_BENCHMARK_DIRECT_MEDIA === '1') await page.evaluate(async () => {
        const portal=state.portal;
        await stopSoftphone();
        state.portal=portal;
        state.portal.sip.iceServers=[];
        await startSoftphone();
      });
      await page.evaluate(() => {
        const record = (phase, details) => {
          if(window.benchmarkCall) (window.benchmarkCall.phases ||= []).push({phase,at:performance.now(),...details});
        };
        document.querySelector('#remoteAudio').addEventListener('playing',()=>record('audio-playing'));
        const capture = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        const NativePeer = window.RTCPeerConnection;
        window.RTCPeerConnection = new Proxy(NativePeer,{construct(target,args,newTarget){record('peer-create-start');const value=Reflect.construct(target,args,newTarget);record('peer-create-complete');return value}});
        navigator.mediaDevices.getUserMedia = async (...args) => {
          record('microphone-start');
          const stream=await capture(...args);
          record('microphone-ready'); return stream;
        };
        for (const method of ['setRemoteDescription','createAnswer','setLocalDescription']) {
          const original=RTCPeerConnection.prototype[method];
          RTCPeerConnection.prototype[method]=async function(...args) {
            record(method+'-start');
            if(method==='setLocalDescription') for(const event of ['icegatheringstatechange','iceconnectionstatechange','connectionstatechange']) this.addEventListener(event,()=>record(event,{ice:this.iceGatheringState,connection:this.connectionState}));
            const value=await original.apply(this,args);
            record(method+'-complete');return value;
          };
        }
        const original = state.ua.delegate.onInvite;
        state.ua.delegate.onInvite = async invitation => {
          window.benchmarkCall = { invitedAt:performance.now() };
          invitation.stateChange.addListener(next => {
            if (next === SIP.SessionState.Established) window.benchmarkCall.connectedAt = performance.now();
            if (next === SIP.SessionState.Terminated) window.benchmarkCall.endedAt = performance.now();
          });
          await original(invitation);
          window.benchmarkCall.invitationRenderedAt = performance.now();
        };
        document.addEventListener('click', event => {
          if (!window.benchmarkCall) return;
          if (event.target.closest('#activeAnswerBtn')) window.benchmarkCall.clickedAt = performance.now();
          if (event.target.closest('#activeHangupBtn')) window.benchmarkCall.hangupAt = performance.now();
        }, true);
      });
    }
    const [a,b] = pages;
    for (let round = 0; round < Number(process.env.PBX_BENCHMARK_ROUNDS || 5); round++) {
      await a.locator('#numberInput').fill(credentials[1].number);
      await a.locator('#callBtn').click();
      await b.waitForFunction(() => state.incoming && state.session && !document.querySelector('#activeAnswerBtn').classList.contains('hidden'), null, {timeout:20000});
      await b.locator('#activeAnswerBtn').click();
      for (const page of pages) await page.waitForFunction(() => state.session?.state === SIP.SessionState.Established, null, {timeout:15000});
      for (const page of pages) await page.waitForFunction(async () => {
        const pc = state.session?.sessionDescriptionHandler?.peerConnection;
        if (!pc) return false;
        const values = [...(await pc.getStats()).values()];
        return values.some(v => v.type === 'inbound-rtp' && v.packetsReceived > 5) && values.some(v => v.type === 'outbound-rtp' && v.packetsSent > 5);
      }, null, {timeout:15000});
      const media = await b.evaluate(() => {
        const pc=state.session.sessionDescriptionHandler.peerConnection;
        return { ...window.benchmarkCall, mediaAt:performance.now(), iceState:pc.iceConnectionState,remoteCandidates:pc.remoteDescription.sdp.split(/\r?\n/).filter(l=>l.startsWith('a=candidate:')) };
      });
      await b.locator('#activeHangupBtn').click();
      for (const page of pages) await page.waitForFunction(() => !state.session && !state.callPending, null, {timeout:10000});
      const end = await b.evaluate(() => window.benchmarkCall);
      samples.push({ answerMs:media.connectedAt-media.clickedAt, inviteRenderMs:media.invitationRenderedAt-media.invitedAt, hangupMs:end.endedAt-end.hangupAt, audioPlayingMs:(media.phases?.find(p=>p.phase==='audio-playing')?.at ?? NaN)-media.clickedAt, mediaMs:media.mediaAt-media.clickedAt, iceState:media.iceState,phases:media.phases,remoteCandidates:media.remoteCandidates });
      console.log('PASS internal call '+(round+1)+' answerMs='+Math.round(samples.at(-1).answerMs));
    }
    const summary = key => {
      const values=samples.map(s=>s[key]).sort((a,b)=>a-b);
      return {median:values[Math.floor(values.length/2)],p95:values[Math.min(values.length-1,Math.floor(values.length*.95))]};
    };
    const versions=await apps[0].evaluate(()=>process.versions);
    const report={at:new Date().toISOString(),elapsedMs:Date.now()-started,electron:versions.electron,chromium:versions.chrome,rounds:samples.length,answerMs:summary('answerMs'),inviteRenderMs:summary('inviteRenderMs'),hangupMs:summary('hangupMs'),samples};
    if (process.env.PBX_BENCHMARK_OUTPUT) await fs.writeFile(process.env.PBX_BENCHMARK_OUTPUT,JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {
    for (const page of pages) await page.evaluate(async()=>{await hangupCurrentCall();await window.pbxAPI.logout();await stopSoftphone();}).catch(()=>{});
    for (const app of apps) await app.close().catch(()=>{});
    const resolved=path.resolve(profile);
    if (path.dirname(resolved)!==path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('uai-pbx-benchmark-')) throw new Error('Refusing to remove an unexpected test profile path.');
    await fs.rm(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:200});
  }
}
main().catch(error=>{console.error(error.stack);process.exitCode=1});
