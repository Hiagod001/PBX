const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const publicDir = path.join(__dirname, "..", "public");
const appSource = fs.readFileSync(path.join(publicDir, "app.js"), "utf8");
const indexSource = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
const stylesSource = fs.readFileSync(path.join(publicDir, "styles.css"), "utf8");

test("live monitor keeps its dialog outside the one-second status render", () => {
  assert.match(indexSource, /id="monitorStatusContent"/);
  assert.match(indexSource, /id="monitorSpyPortal"/);
  assert.match(appSource, /monitorStatusContent\.innerHTML/);
  assert.match(appSource, /monitorSpyPortal\.innerHTML = renderMonitorSpyModal\(\)/);
});

test("live monitor audio plays without showing native duration controls", () => {
  assert.match(appSource, /<audio id="monitorSpyAudio" autoplay playsinline><\/audio>/);
  assert.doesNotMatch(appSource, /id="monitorSpyAudio"[^>]*controls/);
  assert.match(stylesSource, /\.monitor-spy-player audio\s*\{\s*display: none;/);
});

test("recording library exposes detailed call filters and keeps IVR audio separate", () => {
  assert.match(appSource, /data-recording-view="calls"/);
  assert.match(appSource, /data-recording-view="ivr"/);
  assert.match(appSource, /data-recording-filter="number"/);
  assert.match(appSource, /data-recording-filter="extension"/);
  assert.match(appSource, /data-recording-filter="queue"/);
  assert.match(appSource, /data-recording-filter="minDuration"/);
  assert.match(appSource, /data-recording-filter="maxDuration"/);
});

test("system and audit views keep technical detail progressive", () => {
  assert.match(appSource, /data-system-scope="\$\{key\}"/);
  assert.match(appSource, /data-audit-filter="q"/);
  assert.match(appSource, /data-audit-filter="group"/);
  assert.match(appSource, /<details class="audit-technical-details">/);
  assert.match(appSource, /Solicitacao SIP nao suportada foi recusada/);
  assert.match(stylesSource, /\.system-event-main > strong,[\s\S]*?overflow-wrap: anywhere;/);
});

test("desktop sidebar cannot create a horizontal scrollbar", () => {
  assert.match(stylesSource, /@media \(min-width: 821px\)[\s\S]*?\.sidebar,[\s\S]*?overflow-x: hidden;/);
  assert.match(stylesSource, /\.nav-tabs button span\s*\{[\s\S]*?text-overflow: ellipsis;/);
  assert.match(stylesSource, /\.app-shell:not\(\.sidebar-collapsed\) \.nav-tabs button::after\s*\{\s*content: none;/);
});

test("lucide refresh supplies the local icon catalog without blocking page rendering", () => {
  assert.match(appSource, /lucide\.createIcons\(\{ icons: lucide\.icons \}\)/);
  assert.doesNotMatch(appSource, /\.createIcons\(\);/);
  assert.match(appSource, /console\.warn\("Nao foi possivel atualizar os icones da interface\."/);
  assert.match(indexSource, /app\.js\?v=20260827-icons/);
});

test("background refreshes preserve unfinished form input", () => {
  assert.match(appSource, /function surfaceHasActiveEditor\(root\)/);
  assert.match(appSource, /function captureSurfaceDraft\(root\)/);
  assert.match(appSource, /function restoreSurfaceDraft\(root, snapshot\)/);
  assert.match(appSource, /function renderSurfaceInBackground\(root, render\)/);
  assert.match(appSource, /loadPbxStatus\(\{ background: true \}\)/);
  assert.match(appSource, /function renderDialerCampaignLiveData\(\)/);
  assert.match(appSource, /data-dialer-campaign-count/);
  assert.match(appSource, /data-dialer-campaign-rows/);
  assert.match(appSource, /loadDialerCampaigns\(\{ background: true \}\)/);
  assert.match(appSource, /loadOverviewData\(state\.overview\.date, \{ background: true \}\)/);
  assert.match(appSource, /loadExtensionStatus\(\{ background: true \}\)/);
  assert.match(appSource, /renderSurfaceInBackground\(pages\.overview, renderOverview\)/);
  assert.match(appSource, /renderSurfaceInBackground\(extensionRoot, renderExtensionPortal\)/);
  assert.match(appSource, /logs: renderLogs/);
  const backgroundRenderers = appSource.match(/const backgroundRenderers = \{([\s\S]*?)\n    \};/);
  assert.ok(backgroundRenderers);
  assert.doesNotMatch(backgroundRenderers[1], /security|reports/);
});
