const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

test('WebRTC is prepared before registration without capturing the microphone or opening media connections', async()=>{
  let peers=0,offers=0,closed=0;
  const context={webRtcWarmup:null,performance:{now:()=>100},sipLog:()=>{},RTCPeerConnection:class {
    constructor(options){peers++;assert.deepEqual(Array.from(options.iceServers),[])}
    addTransceiver(kind){assert.equal(kind,'audio')}
    async createOffer(){offers++;return {type:'offer',sdp:''}}
    close(){closed++}
  }};
  const source=fs.readFileSync(require('node:path').join(__dirname,'../src/renderer.js'),'utf8');
  const start=source.indexOf('function warmWebRtc()');
  vm.runInNewContext(source.slice(start,source.indexOf('\nfunction ',start+1)),context);
  const first=context.warmWebRtc(),second=context.warmWebRtc();
  assert.equal(first,second);
  await first;
  assert.equal(peers,1);assert.equal(offers,1);assert.equal(closed,1);
  assert.ok(source.indexOf('await warmWebRtc();') < source.indexOf('await SipRecovery.registerConfirmed(registerer,'));
});
