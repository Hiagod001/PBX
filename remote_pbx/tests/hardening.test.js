const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { defaultConfig, normalizeConfig } = require("../src/store");
const { renderExtensions } = require("../src/asterisk");
const { validateConfig } = require("../src/validation");
const { monitorSipPassword } = require("../src/runtime-secrets");
const { app, _test } = require("../server");

function reportConfig() {
  const config = structuredClone(defaultConfig);
  config.extensions = [
    { ...config.extensions[0], number: "505", name: "Origem coincidente", department: "Cobranca" },
    { ...config.extensions[0], number: "701", name: "Atendente", department: "Suporte" }
  ];
  return config;
}

test("inbound caller id equal to an extension does not steal call ownership", () => {
  const config = reportConfig();
  const call = {
    src: "505",
    dst: "85",
    dcontext: "from-trunk",
    channel: "PJSIP/trunk-operadora-0001",
    dstchannel: "PJSIP/701-0002",
    lastdata: "Queue(85)"
  };
  const type = _test.inferReportType(call, config);
  assert.equal(type, "inbound");
  assert.equal(_test.inferReportExtension(call, config, type), "701");
});

test("CSV export neutralizes spreadsheet formulas", () => {
  assert.equal(_test.csvEscape("=HYPERLINK(\"https://example.invalid\")"), "\"'=HYPERLINK(\"\"https://example.invalid\"\")\"");
  assert.equal(_test.csvEscape("  +SUM(1,1)"), "\"'  +SUM(1,1)\"");
  assert.equal(_test.csvEscape("551199999999"), "551199999999");
});

test("PBX status is projected to the authorized extension scope", () => {
  const config = reportConfig();
  const status = {
    extensions: [{ number: "505" }, { number: "701" }],
    queues: [{ id: "85", agents: [{ number: "505" }, { number: "701" }], waiting: [{ callerId: "3199999999" }] }],
    activeChannels: [{ channel: "PJSIP/505-1" }, { channel: "PJSIP/701-2" }],
    waitingCalls: [],
    trunk: { server: "carrier.invalid" },
    logs: [{ message: "diagnostic" }]
  };
  const scoped = _test.pbxStatusForScope(status, config, { all: false, extensions: ["701"], departments: [] });
  assert.deepEqual(scoped.extensions.map((item) => item.number), ["701"]);
  assert.deepEqual(scoped.queues[0].agents.map((item) => item.number), ["701"]);
  assert.deepEqual(scoped.activeChannels.map((item) => item.channel), ["PJSIP/701-2"]);
  assert.equal(scoped.trunk, null);
  assert.deepEqual(scoped.logs, []);
});

test("recording path rejects Asterisk delimiters and traversal", () => {
  const comma = structuredClone(defaultConfig);
  comma.recording.path = "/var/spool/asterisk/monitor,command";
  assert.throws(() => validateConfig(comma), /Caminho de gravacao invalido/);

  const traversal = structuredClone(defaultConfig);
  traversal.recording.path = "/var/spool/asterisk/monitor/../tmp";
  assert.throws(() => validateConfig(traversal), /Caminho de gravacao invalido/);
});

test("generated recording filename uses only server-controlled unique id", () => {
  const dialplan = renderExtensions(structuredClone(defaultConfig));
  const recordingLine = dialplan.split("\n").find((line) => line.includes("Set(RECORDING_FILE="));
  assert.match(recordingLine, /FILTER\(0-9A-Za-z_,\$\{UNIQUEID\}\)/);
  assert.doesNotMatch(recordingLine, /ARG1|ARG2/);
});

test("production monitor endpoint refuses missing and former default secrets", () => {
  const previousEnvironment = process.env.NODE_ENV;
  const previousPassword = process.env.PBX_MONITOR_SIP_PASSWORD;
  try {
    process.env.NODE_ENV = "production";
    delete process.env.PBX_MONITOR_SIP_PASSWORD;
    assert.throws(() => monitorSipPassword(), /PBX_MONITOR_SIP_PASSWORD/);
    process.env.PBX_MONITOR_SIP_PASSWORD = "Monitor@12345";
    assert.throws(() => monitorSipPassword(), /PBX_MONITOR_SIP_PASSWORD/);
  } finally {
    if (previousEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousEnvironment;
    if (previousPassword === undefined) delete process.env.PBX_MONITOR_SIP_PASSWORD;
    else process.env.PBX_MONITOR_SIP_PASSWORD = previousPassword;
  }
});

test("frontend vendors icons locally and serializes extension refreshes", () => {
  const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  const indexSource = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");
  assert.doesNotMatch(`${appSource}\n${indexSource}`, /unpkg\.com|lucide@latest/);
  assert.match(appSource, /if \(state\.extensionStatusRefreshing\) return state\.extensionStatusRefreshing/);
  assert.ok(fs.statSync(path.join(__dirname, "..", "public", "vendor", "lucide.js")).size > 100000);
});

test("backup schedule uses the configured hour value", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  assert.match(source, /Math\.max\(backupIntervalHours, 1 \/ 60\) \* 60 \* 60 \* 1000/);
  assert.doesNotMatch(source, /setInterval\(backupDatabase, 60 \* 60 \* 1000\)/);
});

test("security defaults remove bootstrap credentials and protect generated Asterisk files", () => {
  const storeSource = fs.readFileSync(path.join(__dirname, "..", "src", "store.js"), "utf8");
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const applyRoot = fs.readFileSync(path.join(__dirname, "..", "scripts", "apply-root.sh"), "utf8");
  assert.doesNotMatch(storeSource, /admin123/);
  assert.match(serverSource, /contentSecurityPolicy:/);
  assert.match(serverSource, /app\.set\("trust proxy", trustedProxySetting\(\)\)/);
  assert.match(applyRoot, /install -o root -g asterisk -m 0640/);
});

test("configuration save and apply use one serialized endpoint", () => {
  const serverSource = fs.readFileSync(path.join(__dirname, "..", "server.js"), "utf8");
  const appSource = fs.readFileSync(path.join(__dirname, "..", "public", "app.js"), "utf8");
  assert.match(serverSource, /app\.patch\("\/api\/config\/apply"/);
  assert.match(serverSource, /withConfigMutationLock/);
  assert.match(serverSource, /await saveConfig\(previous\)\.catch/);
  assert.match(appSource, /method: "PATCH"/);
  assert.match(appSource, /_sectionRevisions/);
  assert.doesNotMatch(appSource.match(/async function saveConfig\(\)[\s\S]*?\n}\n/)[0], /renderAll\(\)/);
});

test("independent configuration sections can be merged without overwriting other modules", () => {
  const previous = structuredClone(defaultConfig);
  const nextIvr = { ...previous.ivr, name: "URA isolada" };
  const merged = _test.mergeConfigSections(previous, { ivr: nextIvr });
  assert.deepEqual(merged.keys, ["ivr"]);
  assert.equal(merged.config.ivr.name, "URA isolada");
  assert.deepEqual(merged.config.trunks, previous.trunks);

  const revisions = _test.configSectionRevisions(previous);
  assert.doesNotThrow(() => _test.assertSectionRevisions(previous, ["ivr"], "revision-antiga", revisions));
  assert.throws(
    () => _test.assertSectionRevisions(previous, ["ivr"], "revision-antiga", { ...revisions, ivr: "obsoleta" }),
    /mudaram em outra sessao/
  );
});

test("legacy main trunk data updates its matching trunk without replacing another provider", () => {
  const config = structuredClone(defaultConfig);
  config.outbound.defaultTrunk = "trunk-operadora";
  config.trunk = { ...config.trunk, id: "trunk-operadora", sipUser: "principal" };
  config.trunks = [
    { ...config.trunk, id: "trunk-2", name: "Operadora dois", sipUser: "secundario" },
    { ...config.trunk, id: "trunk-operadora", name: "Operadora principal", sipUser: "principal" }
  ];

  const normalized = normalizeConfig(config);
  assert.equal(normalized.trunks[0].id, "trunk-operadora");
  assert.equal(normalized.trunks.find((trunk) => trunk.id === "trunk-2").sipUser, "secundario");
  assert.equal(normalized.trunks.find((trunk) => trunk.id === "trunk-operadora").sipUser, "principal");
});

test("Asterisk apply is cross-process locked and skips unchanged files and audio conversions", () => {
  const applyRoot = fs.readFileSync(path.join(__dirname, "..", "scripts", "apply-root.sh"), "utf8");
  assert.match(applyRoot, /flock -w/);
  assert.match(applyRoot, /cmp -s "\$GENERATED_DIR\/\$config_file"/);
  assert.match(applyRoot, /PBX_APPLY_RELOADED=0/);
  assert.match(applyRoot, /-nt "\$audio_file"/);
});

test("standalone Asterisk generator loads production environment secrets", () => {
  const generator = fs.readFileSync(path.join(__dirname, "..", "scripts", "generate-configs.js"), "utf8");
  assert.match(generator, /require\("dotenv"\)\.config\(\)/);
});

test("IVR outcomes are parsed without confusing dialer metadata", () => {
  assert.deepEqual(_test.parseIvrOutcome("ivr:main:3"), { menu: "main", option: "3" });
  assert.deepEqual(_test.parseIvrOutcome("ivr:financeiro:timeout"), { menu: "financeiro", option: "timeout" });
  assert.deepEqual(_test.parseIvrOutcome("dialer:attempt:accepted:3199999999"), { menu: "", option: "" });
});

test("only known frontend paths are eligible for the SPA shell", () => {
  assert.equal(_test.spaRoutes.has("/resume"), true);
  assert.equal(_test.spaRoutes.has("/ura"), true);
  assert.equal(_test.spaRoutes.has("/.env"), false);
  assert.equal(_test.spaRoutes.has("/phpinfo.php"), false);
});

test("unknown pages and APIs return 404 instead of the frontend shell", async () => {
  const listener = await new Promise((resolve) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
  });
  const { port } = listener.address();
  try {
    const [known, unknown, unknownApi] = await Promise.all([
      fetch(`http://127.0.0.1:${port}/resume`),
      fetch(`http://127.0.0.1:${port}/.env`),
      fetch(`http://127.0.0.1:${port}/api/nao-existe`)
    ]);
    assert.equal(known.status, 200);
    assert.match(known.headers.get("content-type") || "", /text\/html/);
    assert.equal(unknown.status, 404);
    assert.equal(unknownApi.status, 404);
  } finally {
    await new Promise((resolve, reject) => listener.close((error) => error ? reject(error) : resolve()));
  }
});
