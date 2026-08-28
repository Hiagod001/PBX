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

test("light and dark themes share the refined Flow-inspired PBX system", () => {
  assert.match(indexSource, /styles\.css\?v=20260828-overview-width-2/);
  assert.match(stylesSource, /--sidebar: #e5ebf3;/);
  assert.match(stylesSource, /html\[data-theme="dark"\][\s\S]*?--sidebar: #111113;/);
  assert.match(stylesSource, /--accent: #991b1b;/);
  assert.match(stylesSource, /--page: #09090b;/);
  assert.match(stylesSource, /--surface: #18181b;/);
  assert.match(stylesSource, /--muted: #a1a1aa;/);
  assert.match(stylesSource, /--success-ink:/);
  assert.match(stylesSource, /--warning-soft:/);
  assert.match(stylesSource, /--danger-ink:/);
  assert.match(stylesSource, /--placeholder:/);
  assert.match(stylesSource, /html\[data-theme="dark"\][\s\S]*?--muted-strong:/);
  assert.match(stylesSource, /input::placeholder,[\s\S]*?color: var\(--placeholder\);/);
  assert.match(stylesSource, /\.system-event-row\.error \.system-event-icon[\s\S]*?var\(--danger-soft\)/);
  assert.match(stylesSource, /\.nav-tabs button\.active,[\s\S]*?background: var\(--nav-active-bg\);/);
  assert.match(stylesSource, /\.command-queue-card header,[\s\S]*?background: var\(--surface-elevated\);/);
  assert.match(stylesSource, /\.command-search input,[\s\S]*?background: var\(--control-bg\);/);
  assert.match(stylesSource, /\.tab-page \.table-wrap th[\s\S]*?background: var\(--table-head\);/);
  assert.match(stylesSource, /\.strategy-distribution-row > svg[\s\S]*?background: var\(--surface-elevated\);/);
});

test("strategic overview fills the available workspace width", () => {
  assert.match(stylesSource, /\.strategy-overview\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);[\s\S]*?width: 100%;/);
  assert.match(stylesSource, /\.strategy-overview > \*\s*\{[\s\S]*?grid-column: 1;[\s\S]*?width: 100%;/);
  assert.match(stylesSource, /\.command-center\.strategy-overview > \*\s*\{[\s\S]*?grid-column: 1 \/ -1;[\s\S]*?width: 100%;/);
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
