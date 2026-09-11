const { chromium } = require(process.env.PBX_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let id, page;
  try {
    page = await browser.newPage();
    await page.goto('https://uaipbx.uaitelecom.com.br');
    await page.locator('#loginForm [name=username]').fill('admin');
    await page.locator('#loginForm [name=password]').fill(process.env.PBX_ADMIN_PASSWORD);
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#appView').waitFor({ state: 'visible' });
    await page.evaluate(() => setActiveTab('dialer', { load: true }));
    const form = page.locator('#dialerCampaignForm');
    await form.locator('[name=name]').fill(`QA salvar ${Date.now()}`);
    const audio = await form.locator('[name=audio] option').evaluateAll(options => options.find(o => o.value)?.value);
    await form.locator('[name=audio]').selectOption(audio);
    await form.locator('[name=numbers]').fill('34991708282');
    const responsePromise = page.waitForResponse(r => r.url().endsWith('/api/dialer/campaigns') && r.request().method() === 'POST');
    await form.locator('[type=submit]').click();
    const response = await responsePromise;
    const body = await response.json();
    id = body.campaign?.id;
    assert.equal(response.status(), 200, JSON.stringify(body));
    assert.ok(id);
    assert.notEqual(body.campaign.status, 'running');
    const listing = await (await page.request.get('https://uaipbx.uaitelecom.com.br/api/dialer/campaigns')).json();
    assert.ok(listing.campaigns.some(c => c.id === id));
    console.log('PASS submit button creates and persists a non-running campaign');
  } finally {
    if (id) {
      const removed = await page.request.delete(`https://uaipbx.uaitelecom.com.br/api/dialer/campaigns/${encodeURIComponent(id)}`);
      assert.equal(removed.status(), 200);
      console.log('PASS test campaign removed; no dialing started');
    }
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
