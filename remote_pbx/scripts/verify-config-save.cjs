const { chromium } = require(process.env.PBX_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');

async function main() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.goto('https://uaipbx.uaitelecom.com.br/');
    await page.locator('#loginForm [name=username]').fill('admin');
    await page.locator('#loginForm [name=password]').fill(process.env.PBX_ADMIN_PASSWORD);
    await page.locator('#loginForm button[type=submit]').click();
    await page.locator('#appView').waitFor({ state: 'visible' });
    const api = 'https://uaipbx.uaitelecom.com.br/api';
    const before = await (await page.request.get(`${api}/config`)).json();
    // Exercise persistence and application with the current configuration, without
    // changing routing, credentials or a field another administrator is editing.
    const response = await page.request.put(`${api}/config/apply`, { data: before });
    assert.equal(response.status(), 200, await response.text());
    const result = await response.json();
    const after = await (await page.request.get(`${api}/config`)).json();
    assert.equal(after._revision, before._revision, 'configuration contents remain unchanged');
    assert.equal(result.config._revision, after._revision);
    console.log(JSON.stringify({ status: response.status(), persisted: true, unchanged: true, durationMs: result.durationMs, reloaded: result.reloaded }));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
