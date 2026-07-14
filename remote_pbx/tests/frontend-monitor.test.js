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
