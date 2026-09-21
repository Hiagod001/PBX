const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { _test } = require("../server");

test("local date formatter is reused and respects timezone changes and midnight", () => {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = source.indexOf("let localDateFormatter;");
  const end = source.indexOf("async function allocateCallProtocol", start);
  let creations = 0;
  const context = { process: { env: {} }, Intl: { DateTimeFormat: function (...args) {
    creations++;
    return new Intl.DateTimeFormat(...args);
  } } };
  vm.runInNewContext(source.slice(start, end), context);
  assert.equal(context.localDateKey(new Date("2026-09-21T02:59:59Z")), "2026-09-20");
  assert.equal(context.localDateKey(new Date("2026-09-21T03:00:00Z")), "2026-09-21");
  assert.equal(creations, 1);
  context.process.env.TZ = "UTC";
  assert.equal(context.localDateKey(new Date("2026-09-21T02:59:59Z")), "2026-09-21");
  assert.equal(creations, 2);
});

test("optimized protocol matching preserves chronological ownership, scores and ties", () => {
  const start = Date.parse("2026-09-21T12:00:00Z");
  const calls = Array.from({ length: 200 }, (_, i) => ({
    id: i, startedAt: new Date(start + (199 - i) * 30000).toISOString(),
    extension: String(700 + i % 3), source: `3499000${i % 8}`,
    destination: String(700 + i % 3), type: "outbound", protocol: i % 29 === 0 ? `existing-${i}` : ""
  }));
  calls.push({ id: "invalid", startedAt: "invalid", extension: "700" });
  const events = Array.from({ length: 80 }, (_, i) => ({
    protocol: `protocol-${i}`, createdAt: new Date(start + i * 45000).toISOString(),
    extension: String(700 + i % 3), number: `3499000${i % 8}`, direction: "outbound"
  }));
  events.push({ ...events[0], protocol: "tied-later" });
  const expected = structuredClone(calls);
  const used = new Set();
  expected.slice().sort((a, b) => (Date.parse(a.startedAt) || 0) - (Date.parse(b.startedAt) || 0)).forEach((call) => {
    let best = -1;
    let score = -1;
    events.forEach((event, i) => {
      if (used.has(i)) return;
      const next = _test.protocolMatchScore(call, event);
      if (next > score) { best = i; score = next; }
    });
    if (best >= 0 && score >= 1000) { call.protocol = events[best].protocol; used.add(best); }
  });
  const actual = _test.attachCallProtocolEvents(structuredClone(calls), events);
  assert.deepEqual(actual, expected);
  assert.ok(actual.some((call) => call.protocol?.startsWith("protocol-")));
});

test("dialer schedules the next tick only after completion and continues after failure", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../server.js"), "utf8");
  const start = source.indexOf("function startDialerEngine()");
  const end = source.indexOf("async function readLogTail", start);
  const timers = [];
  let resolveTick;
  let calls = 0;
  const tick = () => {
    if (!tick.running) return Promise.resolve();
    calls++;
    if (calls === 2) return Promise.reject(new Error("temporary"));
    return new Promise((resolve) => { resolveTick = resolve; });
  };
  const context = { tickDialerCampaigns: tick, console: { error() {} }, setTimeout(fn) { timers.push(fn); return { unref() {} }; } };
  vm.runInNewContext(`${source.slice(start, end)}; startDialerEngine();`, context);
  const first = timers.shift()();
  assert.equal(calls, 1);
  assert.equal(timers.length, 0);
  resolveTick();
  await first;
  assert.equal(timers.length, 1);
  await timers.shift()();
  assert.equal(calls, 2);
  assert.equal(timers.length, 1);
  tick.running = false;
  await timers.shift()();
  assert.equal(timers.length, 0);
});

test("admin startup loads only the selected menu after configuration", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8");
  const start = source.indexOf("async function boot()");
  const end = source.indexOf("\napplyTheme();", start);
  const loaded = [];
  const context = {
    state: { activeTab: "dialer" },
    api: async (url) => url === "/api/me" ? { user: { role: "admin" } } : {},
    restoreViewPreferences() {}, renderShell() {}, updateTopbarActions() {},
    loadConfig: async () => { loaded.push("config"); },
    loadTabData: async (tab) => { loaded.push(tab); }
  };
  await vm.runInNewContext(`${source.slice(start, end)}; boot();`, context);
  assert.deepEqual(loaded, ["config", "dialer"]);
});

test("store initialization shares concurrent work and retries failures", async () => {
  const source = fs.readFileSync(path.join(__dirname, "../src/store.js"), "utf8");
  const start = source.indexOf("let storeInitialization = null;");
  const end = source.indexOf("async function initializeStore()", start);
  let attempts = 0;
  let rejectSetup;
  const initializeStore = () => {
    attempts++;
    return attempts === 1 ? new Promise((_, reject) => { rejectSetup = reject; }) : Promise.resolve();
  };
  const ensureStore = vm.runInNewContext(`${source.slice(start, end)}; ensureStore;`, { initializeStore });
  const first = ensureStore();
  assert.equal(ensureStore(), first);
  rejectSetup(new Error("temporary"));
  await assert.rejects(first, /temporary/);
  await ensureStore();
  await ensureStore();
  assert.equal(attempts, 2);
});
