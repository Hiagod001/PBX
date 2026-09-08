// Run on the PBX host after verify-monitor-live, with its completed test recording.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { unifiedRecording } = require('../src/supervision-recording');

function pcm(file) {
  return execFileSync('ffmpeg', ['-nostdin', '-v', 'error', '-i', file, '-f', 's16le', '-ar', '8000', '-ac', '1', '-'], { maxBuffer: 64 * 1024 * 1024 });
}
function toneWindows(buffer) {
  const hits = [];
  for (let offset = 0; offset + 1600 <= buffer.length; offset += 1600) {
    let re = 0, im = 0;
    for (let sample = 0; sample < 800; sample++) {
      const value = buffer.readInt16LE(offset + sample * 2) / 32768;
      re += value * Math.cos(2 * Math.PI * 1000 * sample / 8000);
      im += value * Math.sin(2 * Math.PI * 1000 * sample / 8000);
    }
    if (2 * Math.hypot(re, im) / 800 > 0.07) hits.push(offset / 16000);
  }
  return hits;
}
async function main() {
  const file = path.resolve(process.argv[2]);
  const directory = path.join(path.dirname(file), '.supervision');
  const tracks = (await fs.readdir(directory)).filter(name => name.startsWith(`${path.basename(file)}.spy-`) && name.endsWith('.wav'));
  assert.equal(tracks.length, 2, 'one microphone track for whisper and one for barge; none for listen');
  const output = await unifiedRecording(file, path.resolve(__dirname, '../data/recording-mixes'));
  assert.notEqual(output, file);
  assert.equal(await unifiedRecording(file, path.resolve(__dirname, '../data/recording-mixes')), output, 'cached output is stable');
  const original = pcm(file), combined = pcm(output);
  assert.equal(combined.length, original.length, 'mix preserves full call duration');
  assert.deepEqual(combined.subarray(0, 20 * 16000), original.subarray(0, 20 * 16000), 'normal conversation before supervision is preserved exactly');
  const mainHits = toneWindows(original), mixedHits = toneWindows(combined);
  assert.equal(mainHits.length, 0, 'original does not contain supervisor tone');
  assert.ok(mixedHits.length >= 16, 'combined recording contains both tone bursts');
  let groups = 0, last = -10;
  for (const time of mixedHits) { if (time - last > .3) groups++; last = time; }
  assert.equal(groups, 2, 'whisper and barge occur as two distinct segments');
  console.log(JSON.stringify({ duration: combined.length / 16000, microphoneTracks: tracks.length, originalToneWindows: mainHits.length, combinedToneWindows: mixedHits.length, segments: groups, toneTimes: mixedHits, output }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
