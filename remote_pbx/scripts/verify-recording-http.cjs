const { chromium } = require(process.env.PBX_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { isSupervisionCall } = require('../src/supervision-recording');
async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('https://uaipbx.uaitelecom.com.br/');
    await page.locator('#loginForm [name=username]').fill('admin');
    await page.locator('#loginForm [name=password]').fill(process.env.PBX_ADMIN_PASSWORD);
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#appView').waitFor({ state: 'visible' });
    const calls = await (await page.request.get('https://uaipbx.uaitelecom.com.br/api/pbx/reports/calls?pageSize=200')).json();
    assert.ok(Array.isArray(calls.data));
    assert.equal(calls.data.filter(call => isSupervisionCall(call)).length, 0);
    const id = process.argv[2];
    assert.equal(calls.data.filter(call => call.uniqueId === id).length, 1);
    const base = `https://uaipbx.uaitelecom.com.br/api/pbx/recordings/${encodeURIComponent(id)}`;
    const play = await page.request.get(`${base}/play`);
    const download = await page.request.get(`${base}/download`);
    assert.equal(play.status(), 200);
    assert.equal(download.status(), 200);
    const audio = await play.body();
    assert.deepEqual(await download.body(), audio, 'play and download deliver exactly the same unified audio');
    assert.equal(audio.subarray(0, 4).toString(), 'RIFF');
    const range = await page.request.get(`${base}/play`, { headers: { Range: 'bytes=0-99' } });
    assert.equal(range.status(), 206);
    assert.deepEqual(await range.body(), audio.subarray(0, 100));
    console.log(JSON.stringify({ reportedCalls: calls.meta.total, supervisorCalls: 0, testCallRows: 1, bytes: audio.length, play: play.status(), download: download.status(), range: range.status(), filename: download.headers()['content-disposition'] }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
