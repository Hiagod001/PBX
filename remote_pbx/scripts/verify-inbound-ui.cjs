const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const express = require("express");
const { chromium } = require(process.env.PBX_PLAYWRIGHT_MODULE || "playwright");
const { defaultConfig } = require("../src/store");

async function main() {
  const serverApp = express();
  serverApp.use(express.static(path.join(__dirname, "../public")));
  serverApp.get("*", (_req, res) => res.sendFile(path.join(__dirname, "../public/index.html")));
  const server = await new Promise((resolve) => {
    const listener = serverApp.listen(0, "127.0.0.1", () => resolve(listener));
  });
  let browser;
  try {
    browser = await chromium.launch({ headless: true, channel: "chrome" });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/api/**", (route) => route.fulfill({ contentType: "application/json", body: JSON.stringify({ user: null, extension: null, data: [], campaigns: [], audios: [] }) }));
    await page.goto(`http://127.0.0.1:${server.address().port}/ura`);
    await page.waitForFunction(() => typeof renderIvr === "function");
    const config = structuredClone(defaultConfig);
    config.trunk = { ...config.trunk, id: "trunk-operadora", name: "Operadora principal", inboundDestinationType: "ivr", inboundDestination: "main" };
    await page.evaluate((config) => {
      state.user = { username: "admin", role: "admin" };
      state.config = config;
      state.configBaseline = structuredClone(config);
      state.activeTab = "ivr";
      renderShell();
      pages.ivr.classList.add("active");
      renderIvr();
      iconRefresh();
    }, config);
    await page.locator("#newIvrRootBtn").click();
    assert.equal(await page.locator(".ivr-target-node").count(), 0);
    assert.equal(await page.locator(".ivr-flow-node[data-ivr-menu]").count(), 1);
    const outputDir = process.env.PBX_UI_SCREENSHOT_DIR;
    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true });
      await page.screenshot({ path: path.join(outputDir, "ura-clean.png") });
    }
    await page.locator("[data-add-ivr-option]").click();
    assert.equal(await page.locator(".ivr-option-node").count(), 1);
    assert.equal(await page.evaluate(() => state.config.ivr.options.length), config.ivr.options.length);
    await page.locator("#addIvrMenuBtn").click();
    assert.equal(await page.locator(".ivr-flow-node[data-ivr-menu]").count(), 2);
    await page.locator("[data-add-ivr-option]").first().click();
    const bounds = await page.locator(".ivr-flow-node[data-ivr-menu], .ivr-option-node").evaluateAll((nodes) => nodes.map((node) => ({ x: node.offsetLeft, y: node.offsetTop, width: node.offsetWidth, height: node.offsetHeight })));
    bounds.forEach((a, index) => bounds.slice(index + 1).forEach((b) => {
      assert.ok(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y, `Cards sobrepostos: ${JSON.stringify({ a, b })}`);
    }));
    if (outputDir) {
      fs.mkdirSync(outputDir, { recursive: true });
      await page.screenshot({ path: path.join(outputDir, "ura-edited.png") });
    }
    await page.evaluate(() => {
      collectConfig();
      state.activeTab = "routing";
      document.querySelectorAll(".tab-page").forEach((node) => node.classList.remove("active"));
      pages.routing.classList.add("active");
      renderRouting();
    });
    await page.locator("#addInboundBtn").click();
    const row = page.locator("[data-route-index]").last();
    await row.locator('[data-field="name"]').fill("Numero adicional");
    await row.locator('[data-field="did"]').fill("5511999999999");
    await row.locator('[data-destination-type]').selectOption("ivr");
    assert.ok(await row.locator('[data-destination-value] option').count() >= 2);
    await row.locator('[data-field="active"]').check();
    const route = await page.evaluate(() => { collectConfig(); return state.config.inboundRoutes.at(-1); });
    assert.equal(route.active, true);
    assert.equal(route.did, "5511999999999");
    assert.equal(route.trunkId, "trunk-operadora");
    await page.evaluate(() => document.documentElement.dataset.theme = "dark");
    if (outputDir) await page.screenshot({ path: path.join(outputDir, "inbound-routes-dark.png") });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => document.documentElement.dataset.theme = "light");
    if (outputDir) await page.screenshot({ path: path.join(outputDir, "inbound-routes-mobile.png") });
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.evaluate(() => {
      state.activeTab = "queues";
      document.querySelectorAll(".tab-page").forEach((node) => node.classList.remove("active"));
      pages.queues.classList.add("active");
      state.openQueueDetails.support = true;
      renderQueues();
    });
    const finalSelect = page.locator('[data-queue-index="0"] [data-key="fallbackDestination"]');
    await finalSelect.selectOption("");
    assert.equal(await page.evaluate(() => { collectConfig(); return state.config.queues[0].fallbackType; }), "none");
    assert.equal(await finalSelect.locator('option[value="support"]').count(), 0);
    assert.deepEqual(errors, []);
    console.log("UI OK: URA vazia, submenu sem sobreposicao, rotas editaveis, destinos finais e temas.");
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
