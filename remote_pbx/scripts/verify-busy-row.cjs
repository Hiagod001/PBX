const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PBX_PLAYWRIGHT_MODULE || 'playwright');
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<div id="tab-status"><section class="command-queue-card"><table><tbody><tr class="compact-agent-row busy"><td class="compact-agent-name"><strong>Operador</strong><span>505</span></td><td class="call-duration">2m 10s</td><td>581</td></tr></tbody></table></section><table class="agent-table"><tbody><tr class="agent-row busy"><td class="agent-identity"><strong>581</strong><span>Operador</span></td><td>Em chamada</td></tr></tbody></table></div>');
    for (const file of ['styles.css', 'workspace.css']) await page.addStyleTag({ content: fs.readFileSync(path.join(__dirname, '../public', file), 'utf8') });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => document.documentElement.dataset.theme = theme, theme);
      const expected = theme === 'dark' ? 'rgb(84, 35, 50)' : 'rgb(245, 199, 205)';
      const colors = await page.locator('tr.busy > td').evaluateAll(cells => cells.map(cell => getComputedStyle(cell).backgroundColor));
      assert.ok(colors.every(color => color === expected));
      await page.locator('.compact-agent-row').evaluate(row => row.className = 'compact-agent-row available');
      assert.notEqual(await page.locator('.compact-agent-row > td').first().evaluate(cell => getComputedStyle(cell).backgroundColor), expected);
      await page.locator('.compact-agent-row').evaluate(row => row.className = 'compact-agent-row busy');
      if (process.env.PBX_UI_SCREENSHOT_DIR) await page.screenshot({path:path.join(process.env.PBX_UI_SCREENSHOT_DIR, `busy-${theme}.png`)});
    }
    console.log('PASS busy highlights every cell in both monitor layouts/themes and clears on status change');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
