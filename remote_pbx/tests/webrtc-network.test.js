const test=require('node:test');
const assert=require('node:assert/strict');
const {renderRtp}=require('../src/asterisk');
const {defaultConfig}=require('../src/store');

test('public-media deployments can advertise only routable ICE addresses without changing RTP ports',()=>{
  const previous=process.env.PBX_WEBRTC_ICE_PERMIT;
  try {
    delete process.env.PBX_WEBRTC_ICE_PERMIT;
    assert.doesNotMatch(renderRtp(defaultConfig),/ice_deny/);
    process.env.PBX_WEBRTC_ICE_PERMIT='203.0.113.10/32';
    const config=renderRtp(defaultConfig);
    assert.match(config,/ice_deny=0\.0\.0\.0\/0/);
    assert.match(config,/ice_deny=::\/0/);
    assert.match(config,/ice_permit=203\.0\.113\.10\/32/);
    assert.match(config,/rtpstart=10000/);
    process.env.PBX_WEBRTC_ICE_PERMIT='203.0.113.10/33';
    assert.throws(()=>renderRtp(defaultConfig),/inválida/);
  } finally {if(previous===undefined)delete process.env.PBX_WEBRTC_ICE_PERMIT;else process.env.PBX_WEBRTC_ICE_PERMIT=previous}
});
