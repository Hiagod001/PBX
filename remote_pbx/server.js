require("dotenv").config();
require("express-async-errors");

const fs = require("fs-extra");
const path = require("path");
const bcrypt = require("bcryptjs");
const express = require("express");
const session = require("express-session");
const PgSession = require("connect-pg-simple")(session);
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const morgan = require("morgan");
const multer = require("multer");
const { exec, execFile } = require("child_process");
const { promisify } = require("util");
const crypto = require("crypto");

const {
  ensureStore,
  getConfig,
  saveConfig,
  getUsers,
  saveUsers,
  generatedDir,
  ivrAudioDir,
  readPresenceHistory: readStoredPresenceHistory,
  appendPresenceEvents: appendStoredPresenceEvents,
  readAuditLog,
  writeRecordingAuditEvent,
  getReportCdrRows
} = require("./src/store");
const { generateAsteriskConfigs } = require("./src/asterisk");
const { validateConfig } = require("./src/validation");
const { monitorSipPassword } = require("./src/runtime-secrets");

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
const app = express();
const port = Number(process.env.PORT) || 3090;
const host = process.env.HOST || (process.env.NODE_ENV === "production" ? "127.0.0.1" : "0.0.0.0");
const playbackAudioExtensions = new Set([".wav", ".gsm", ".ulaw", ".alaw", ".sln16", ".mp3"]);
const browserRecordingExtensions = new Set([".wav", ".mp3", ".gsm"]);
const extensionPresence = new Map();
const extensionIdleSince = new Map();
const protocolCounterPath = path.join(__dirname, "data", "call-protocol.json");
const callProtocolsPath = path.join(__dirname, "data", "call-protocols.json");
const extensionPausePath = path.join(__dirname, "data", "extension-pauses.json");
const extensionPauseHistoryPath = path.join(__dirname, "data", "extension-pause-history.json");
const dialerCampaignsPath = path.join(__dirname, "data", "dialer-campaigns.json");
const dialerOutgoingDir = path.join(__dirname, "data", "dialer-outgoing");
const pauseReasons = new Set(["Cafezinho", "Almoço", "Treinamento", "Atendimento presencial"]);
let protocolCounterLock = Promise.resolve();
let dialerStoreLock = Promise.resolve();
let cdrImportRunning = false;
let databaseBackupRunning = false;
let logRotationRunning = false;
let configMutationLock = Promise.resolve();
let pbxStatusCache = { revision: "", expiresAt: 0, value: null, pending: null };
let reportCallsCache = { revision: "", expiresAt: 0, value: null, pending: null };
let recordingIndexCache = { key: "", expiresAt: 0, value: null, pending: null };

function withConfigMutationLock(task) {
  const current = configMutationLock.then(task, task);
  configMutationLock = current.catch(() => {});
  return current;
}

function databaseConnectionString() {
  return process.env.PBX_DATABASE_URL || process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING || "";
}

function sessionStore() {
  const conString = databaseConnectionString();
  if (!conString) {
    console.warn("[session] PostgreSQL nao configurado; sessoes serao mantidas somente em memoria.");
    return undefined;
  }
  return new PgSession({
    conString,
    tableName: "pbx_sessions",
    createTableIfMissing: true,
    pruneSessionInterval: 15 * 60
  });
}

function sessionSecret() {
  const configured = String(process.env.SESSION_SECRET || "");
  if (configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET precisa ter pelo menos 32 caracteres em producao.");
  console.warn("[session] Use SESSION_SECRET com pelo menos 32 caracteres fora do ambiente local.");
  return configured || "dev-secret-change-me";
}

function requestIsLoopback(req) {
  const address = String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
  return address === "127.0.0.1" || address === "::1";
}

function trustedProxySetting() {
  const configured = String(process.env.PBX_TRUST_PROXY || "").trim();
  if (!configured) return false;
  if (configured === "loopback") return "loopback";
  return configured.split(",").map((item) => item.trim()).filter(Boolean);
}

function enforceHttps(req, res, next) {
  const configured = String(process.env.PBX_REQUIRE_HTTPS || "").toLowerCase();
  const required = configured === "true" || (process.env.NODE_ENV === "production" && configured !== "false");
  if (!required || req.secure || requestIsLoopback(req)) return next();
  const publicUrl = String(process.env.PBX_PUBLIC_URL || "").replace(/\/$/, "");
  if ((req.method === "GET" || req.method === "HEAD") && publicUrl.startsWith("https://")) {
    return res.redirect(308, `${publicUrl}${req.originalUrl}`);
  }
  return res.status(426).json({ error: "Use a conexao HTTPS oficial do PBX" });
}

async function runMaintenanceScript(scriptName, timeout) {
  const scriptPath = path.join(__dirname, "scripts", scriptName);
  const { stdout, stderr } = await execFileAsync(process.execPath, [scriptPath], {
    cwd: __dirname,
    timeout,
    maxBuffer: 1024 * 1024
  });
  return `${stdout || ""}${stderr || ""}`.trim();
}

function startMaintenanceJobs() {
  const cdrInterval = Number(process.env.PBX_CDR_IMPORT_INTERVAL_MS || 60000);
  if (cdrInterval > 0) {
    const importCdr = async () => {
      if (cdrImportRunning) return;
      cdrImportRunning = true;
      try {
        const output = await runMaintenanceScript("import-cdr.js", 5 * 60 * 1000);
        if (output && !/: 0 linhas\.?$/i.test(output)) console.log(`[cdr] ${output}`);
      } catch (error) {
        console.error(`[cdr] Falha na importacao incremental: ${error.message}`);
      } finally {
        cdrImportRunning = false;
      }
    };
    setTimeout(importCdr, 5000).unref();
    setInterval(importCdr, Math.max(cdrInterval, 15000)).unref();
  }

  const backupIntervalHours = Number(process.env.PBX_BACKUP_INTERVAL_HOURS || 24);
  if (databaseConnectionString() && Number.isFinite(backupIntervalHours) && backupIntervalHours > 0) {
    const backupDatabase = async () => {
      if (databaseBackupRunning) return;
      databaseBackupRunning = true;
      try {
        const output = await runMaintenanceScript("backup-db.js", 20 * 60 * 1000);
        if (output) console.log(`[backup] ${output}`);
      } catch (error) {
        console.error(`[backup] Falha no backup do PostgreSQL: ${error.message}`);
      } finally {
        databaseBackupRunning = false;
      }
    };
    setTimeout(backupDatabase, 30000).unref();
    setInterval(backupDatabase, Math.max(backupIntervalHours, 1 / 60) * 60 * 60 * 1000).unref();
  }

  const rotateLogs = async () => {
    if (logRotationRunning) return;
    logRotationRunning = true;
    try {
      const output = await runMaintenanceScript("rotate-pbx-logs.js", 10 * 60 * 1000);
      if (output) console.log(`[logs] ${output}`);
    } catch (error) {
      console.error(`[logs] Falha na rotacao dos logs do PBX: ${error.message}`);
    } finally {
      logRotationRunning = false;
    }
  };
  setTimeout(rotateLogs, 60000).unref();
  setInterval(rotateLogs, 6 * 60 * 60 * 1000).unref();
}

function protocolYear(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || "America/Sao_Paulo",
    year: "numeric"
  }).format(date);
}

function localDateKey(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: process.env.TZ || "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

async function allocateCallProtocol() {
  protocolCounterLock = protocolCounterLock.catch(() => {}).then(async () => {
    const year = protocolYear();
    const current = (await fs.readJson(protocolCounterPath).catch(() => ({}))) || {};
    const next = Number(current[year] || 0) + 1;
    current[year] = next;
    await fs.ensureDir(path.dirname(protocolCounterPath));
    await fs.writeJson(protocolCounterPath, current, { spaces: 2 });
    return `${year}${String(next).padStart(6, "0")}`;
  });
  return protocolCounterLock;
}

async function readCallProtocolEvents() {
  const payload = (await fs.readJson(callProtocolsPath).catch(() => ({}))) || {};
  return Array.isArray(payload.events) ? payload.events : [];
}

async function recordCallProtocolEvent(event) {
  const current = await readCallProtocolEvents();
  const now = Date.now();
  const cutoff = now - 35 * 24 * 60 * 60 * 1000;
  const events = [
    ...current.filter((item) => (parseFlexibleDate(item.createdAt)?.getTime() || now) >= cutoff),
    {
      protocol: String(event.protocol || ""),
      extension: String(event.extension || "").replace(/[^\d]/g, ""),
      direction: String(event.direction || ""),
      number: String(event.number || "").replace(/[^\d#*]/g, ""),
      createdAt: new Date(now).toISOString()
    }
  ].filter((item) => item.protocol).slice(-20000);
  await fs.ensureDir(path.dirname(callProtocolsPath));
  await fs.writeJson(callProtocolsPath, { events }, { spaces: 2 });
  return events[events.length - 1];
}

async function readExtensionPauses() {
  return (await fs.readJson(extensionPausePath).catch(() => ({}))) || {};
}

async function readExtensionPauseHistory() {
  const payload = (await fs.readJson(extensionPauseHistoryPath).catch(() => ({ events: [] }))) || {};
  return { events: Array.isArray(payload.events) ? payload.events : [] };
}

async function appendExtensionPauseHistory(event) {
  const history = await readExtensionPauseHistory();
  history.events.push(event);
  history.events = history.events.slice(-50000);
  await fs.ensureDir(path.dirname(extensionPauseHistoryPath));
  await fs.writeJson(extensionPauseHistoryPath, history, { spaces: 2 });
}

function normalizePauseReason(reason) {
  const text = String(reason || "").trim();
  return pauseReasons.has(text) ? text : "Cafezinho";
}

async function setExtensionPause(number, paused, reason = "") {
  const key = String(number || "").replace(/[^\d]/g, "");
  if (!key) return null;
  const pauses = await readExtensionPauses();
  if (paused) {
    pauses[key] = {
      pauseId: pauses[key]?.pauseId || `pause-${Date.now()}-${key}`,
      paused: true,
      reason: normalizePauseReason(reason),
      startedAt: pauses[key]?.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
  } else {
    const current = pauses[key];
    if (current?.paused) {
      const endedAt = new Date();
      const started = parseFlexibleDate(current.startedAt) || endedAt;
      await appendExtensionPauseHistory({
        id: current.pauseId || `pause-${Date.now()}-${key}`,
        extension: key,
        reason: current.reason || "Pausa",
        startedAt: started.toISOString(),
        endedAt: endedAt.toISOString(),
        durationSeconds: Math.max(0, Math.round((endedAt.getTime() - started.getTime()) / 1000))
      });
    }
    delete pauses[key];
  }
  await fs.ensureDir(path.dirname(extensionPausePath));
  await fs.writeJson(extensionPausePath, pauses, { spaces: 2 });
  return pauses[key] || null;
}

async function syncStoredQueuePauses() {
  const pauses = await readExtensionPauses();
  const activePauses = Object.entries(pauses || {}).filter(([, pause]) => pause?.paused);
  await Promise.all(
    activePauses.map(([number, pause]) =>
      runAsteriskControl("queue-pause", number, { reason: pause.reason || "Pausa" }).catch((error) => {
        console.warn(`Falha ao sincronizar pausa do ramal ${number}:`, error.message);
      })
    )
  );
  return activePauses.length;
}

function pauseRecordFor(pauses, number, now = Date.now()) {
  const record = pauses?.[String(number || "")];
  if (!record?.paused) return null;
  const started = Date.parse(record.startedAt || "");
  const startedAt = Number.isFinite(started) ? started : now;
  const pauseSeconds = Math.max(0, Math.round((now - startedAt) / 1000));
  return {
    reason: record.reason || "Pausa",
    startedAt: new Date(startedAt).toISOString(),
    pauseSeconds,
    pauseDurationLabel: secondsToHuman(pauseSeconds)
  };
}

function updateExtensionPresence(number, registered, now = Date.now()) {
  const key = String(number || "");
  if (!key) return { onlineSince: "", onlineSeconds: 0, onlineDurationLabel: "-" };
  if (!registered) {
    const onlineSinceMs = extensionPresence.get(key);
    extensionPresence.delete(key);
    extensionIdleSince.delete(key);
    return {
      onlineSince: "",
      onlineSeconds: 0,
      onlineDurationLabel: "-",
      event: onlineSinceMs ? { extension: key, registered: false, at: new Date(now).toISOString() } : null
    };
  }
  const event = extensionPresence.has(key) ? null : { extension: key, registered: true, at: new Date(now).toISOString() };
  if (!extensionPresence.has(key)) extensionPresence.set(key, now);
  const onlineSinceMs = extensionPresence.get(key);
  const onlineSeconds = Math.max(0, Math.round((now - onlineSinceMs) / 1000));
  return {
    onlineSince: new Date(onlineSinceMs).toISOString(),
    onlineSeconds,
    onlineDurationLabel: secondsToHuman(onlineSeconds),
    event
  };
}

function extensionHasActiveCallForIdle(status, channel) {
  const normalized = String(status || "").trim().toLowerCase();
  return Boolean(channel) || ["busy", "ringing", "hold"].includes(normalized);
}

function updateExtensionIdle(number, registered, activeCall, now = Date.now(), onlineSince = "", lastActivityAt = "") {
  const key = String(number || "");
  if (!key) return { idleSeconds: null, idleTime: "", idleSince: "" };
  if (!registered) {
    extensionIdleSince.delete(key);
    return { idleSeconds: null, idleTime: "", idleSince: "" };
  }
  if (activeCall) {
    extensionIdleSince.set(key, now);
    return { idleSeconds: null, idleTime: "", idleSince: "" };
  }
  let idleSinceMs = extensionIdleSince.get(key);
  const lastActivityMs = Date.parse(lastActivityAt || "");
  if (!idleSinceMs) {
    const onlineSinceMs = Date.parse(onlineSince || "");
    idleSinceMs = Math.max(
      Number.isFinite(onlineSinceMs) && onlineSinceMs <= now ? onlineSinceMs : now,
      Number.isFinite(lastActivityMs) && lastActivityMs <= now ? lastActivityMs : 0
    );
    extensionIdleSince.set(key, idleSinceMs);
  } else if (Number.isFinite(lastActivityMs) && lastActivityMs <= now && lastActivityMs > idleSinceMs) {
    idleSinceMs = lastActivityMs;
    extensionIdleSince.set(key, idleSinceMs);
  }
  const idleSeconds = Math.max(0, Math.round((now - idleSinceMs) / 1000));
  return {
    idleSeconds,
    idleTime: secondsToHuman(idleSeconds),
    idleSince: new Date(idleSinceMs).toISOString()
  };
}

async function readPresenceHistory() {
  return readStoredPresenceHistory();
}

async function appendPresenceEvents(events = []) {
  await appendStoredPresenceEvents(events);
}

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      try {
        await fs.ensureDir(ivrAudioDir);
        cb(null, ivrAudioDir);
      } catch (error) {
        cb(error);
      }
    },
    filename: (_req, file, cb) => {
      const extension = path.extname(file.originalname || "").toLowerCase();
      const base = path
        .basename(file.originalname || "audio", extension)
        .normalize("NFKD")
        .replace(/[^\w.-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^-|-$/g, "")
        .toLowerCase();
      cb(null, `${base || "audio"}-${Date.now()}${extension}`);
    }
  }),
  limits: { fileSize: 20 * 1024 * 1024 }
});

function authFingerprint(user) {
  const value = {
    username: user?.username || "",
    passwordHash: user?.passwordHash || "",
    role: user?.role || "user",
    extension: user?.extension || "",
    departments: user?.departments || [],
    allowedExtensions: user?.allowedExtensions || [],
    permissions: user?.permissions || {},
    mustChangePassword: Boolean(user?.mustChangePassword)
  };
  return crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function extensionFingerprint(extension) {
  return crypto.createHash("sha256").update(JSON.stringify({
    number: String(extension?.number || ""),
    secret: String(extension?.secret || "")
  })).digest("hex");
}

function rejectSession(req, res, message) {
  req.session?.destroy(() => {});
  res.clearCookie("pbx.sid");
  return res.status(401).json({ error: message });
}

async function requireAuth(req, res, next) {
  if (!req.session?.user) return res.status(401).json({ error: "Nao autenticado" });
  const users = await getUsers();
  const current = (users.users || []).find((candidate) => candidate.username === req.session.user.username);
  if (!current || req.session.userAuthFingerprint !== authFingerprint(current)) {
    return rejectSession(req, res, "Sessao expirada apos alteracao de acesso. Entre novamente.");
  }
  req.session.user = publicUser(current);
  const passwordChangeRoutes = new Set(["/api/me", "/api/logout", "/api/change-password"]);
  if (current.mustChangePassword && !passwordChangeRoutes.has(req.path)) {
    return res.status(403).json({ error: "Troque a senha inicial antes de acessar o sistema", mustChangePassword: true });
  }
  return next();
}

function userRole(req) {
  return String(req.session?.user?.role || "user").toLowerCase();
}

function requireAdmin(req, res, next) {
  if (userRole(req) === "admin") return next();
  return res.status(403).json({ error: "Acao restrita a administradores" });
}

function requireSupervisor(req, res, next) {
  if (["admin", "supervisor"].includes(userRole(req))) return next();
  return res.status(403).json({ error: "Acao restrita a supervisores" });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => req.session.regenerate((error) => (error ? reject(error) : resolve())));
}

async function requireExtensionAuth(req, res, next) {
  if (!req.session?.extension) return res.status(401).json({ error: "Ramal nao autenticado" });
  const config = await getConfig();
  const current = (config.extensions || []).find((candidate) => String(candidate.number) === String(req.session.extension.number));
  if (!current || req.session.extensionAuthFingerprint !== extensionFingerprint(current)) {
    return rejectSession(req, res, "Sessao do ramal expirada apos alteracao de credencial. Entre novamente.");
  }
  req.session.extension = publicExtension(current);
  return next();
}

function publicUser(user) {
  return {
    username: user.username,
    role: user.role || (user.username === "admin" ? "admin" : "user"),
    extension: user.extension || "",
    departments: user.departments || [],
    allowedExtensions: user.allowedExtensions || [],
    permissions: user.permissions || {},
    mustChangePassword: Boolean(user.mustChangePassword)
  };
}

function publicExtension(extension) {
  return {
    number: String(extension.number || ""),
    name: extension.name || "",
    department: extension.department || "",
    extensionType: extension.extensionType || "Padrao",
    permissions: extension.permissions || []
  };
}

function configForUser(config, req) {
  if (userRole(req) === "admin") return config;
  const redacted = JSON.parse(JSON.stringify(config || {}));
  if (redacted.trunk) redacted.trunk.sipPassword = "";
  (redacted.trunks || []).forEach((trunk) => {
    trunk.sipPassword = "";
  });
  (redacted.extensions || []).forEach((extension) => {
    extension.secret = "";
  });
  if (redacted.voicemail) redacted.voicemail.defaultPin = "";
  return redacted;
}

function configRevision(config) {
  return crypto.createHash("sha256").update(JSON.stringify(config || {})).digest("hex").slice(0, 16);
}

const configurableSections = Object.freeze([
  "company",
  "trunk",
  "trunks",
  "extensions",
  "inboundRoutes",
  "ivr",
  "ringGroups",
  "queues",
  "outboundRules",
  "outbound",
  "businessHours",
  "recording",
  "voicemail",
  "security"
]);

function configSectionRevisions(config) {
  return Object.fromEntries(configurableSections.map((key) => [key, configRevision(config?.[key])]));
}

function withConfigRevision(config, sourceConfig = config) {
  return {
    ...(config || {}),
    _revision: configRevision(sourceConfig),
    _sectionRevisions: configSectionRevisions(sourceConfig)
  };
}

function stripConfigMetadata(input) {
  const clean = { ...(input || {}) };
  delete clean._revision;
  delete clean._sectionRevisions;
  return clean;
}

function mergeConfigSections(previous, sections) {
  if (!sections || typeof sections !== "object" || Array.isArray(sections)) {
    const error = new Error("Informe ao menos um modulo de configuracao para salvar.");
    error.status = 400;
    throw error;
  }
  const keys = Object.keys(sections);
  const invalid = keys.filter((key) => !configurableSections.includes(key));
  if (invalid.length) {
    const error = new Error(`Modulos de configuracao invalidos: ${invalid.join(", ")}`);
    error.status = 400;
    throw error;
  }
  if (!keys.length) return { config: previous, keys };
  return {
    config: { ...previous, ...Object.fromEntries(keys.map((key) => [key, sections[key]])) },
    keys
  };
}

function browserSipSettings(req, extension) {
  const hostHeader = req.get("host") || `${host}:${port}`;
  const hostname = hostHeader.split(":")[0] || "localhost";
  const sipDomain = process.env.BROWSER_SIP_DOMAIN || process.env.ASTERISK_PUBLIC_HOST || hostname;
  const browserUser = `web-${String(extension.number || "").replace(/[^\d]/g, "")}`;
  const wsServer =
    process.env.BROWSER_SIP_WS ||
    `${req.secure ? "wss" : "ws"}://${process.env.BROWSER_SIP_WS_HOST || hostname}:${process.env.BROWSER_SIP_WS_PORT || (req.secure ? "8089" : "8088")}${process.env.BROWSER_SIP_WS_PATH || "/ws"}`;

  return {
    uri: `sip:${browserUser}@${sipDomain}`,
    authorizationUsername: browserUser,
    password: String(extension.secret || ""),
    displayName: extension.name || String(extension.number || ""),
    domain: sipDomain,
    wsServer
  };
}

function monitorSipSettings(req) {
  const hostHeader = req.get("host") || `${host}:${port}`;
  const hostname = hostHeader.split(":")[0] || "localhost";
  const sipDomain = process.env.BROWSER_SIP_DOMAIN || process.env.ASTERISK_PUBLIC_HOST || hostname;
  const monitorUser = process.env.PBX_MONITOR_SIP_USER || "monitor-admin";
  const wsServer =
    process.env.BROWSER_SIP_WS ||
    `${req.secure ? "wss" : "ws"}://${process.env.BROWSER_SIP_WS_HOST || hostname}:${process.env.BROWSER_SIP_WS_PORT || (req.secure ? "8089" : "8088")}${process.env.BROWSER_SIP_WS_PATH || "/ws"}`;

  return {
    uri: `sip:${monitorUser}@${sipDomain}`,
    authorizationUsername: monitorUser,
    password: monitorSipPassword(),
    displayName: "Monitor PBX",
    domain: sipDomain,
    wsServer
  };
}

function extensionStatusFromPbx(status, extensionNumber) {
  const number = String(extensionNumber || "");
  const extension = (status.extensions || []).find((item) => String(item.number) === number) || null;
  const queues = (status.queues || [])
    .map((queue) => {
      const agent = (queue.agents || []).find((item) => String(item.number) === number);
      if (!agent) return null;
      return {
        id: queue.id,
        name: queue.name,
        callsWaiting: queue.callsWaiting,
        completed: queue.completed,
        abandoned: queue.abandoned,
        holdTimeLabel: queue.holdTimeLabel,
        agent
      };
    })
    .filter(Boolean);

  return {
    readAt: status.readAt,
    extension,
    queues,
    active: status.activeChannels?.filter((channel) => {
      const joined = [channel.channel, channel.bridgedTo, channel.extension, channel.callerId].join(" ");
      return new RegExp(`(?:PJSIP|SIP|Local)/(?:web-)?${number}(?:[-/@]|\\b)|\\b${number}\\b`, "i").test(joined);
    }) || []
  };
}

function playbackNameFromFilename(filename) {
  const extension = path.extname(filename || "").toLowerCase();
  const name = path.basename(filename || "", extension);
  return `custom/${name}`;
}

async function listIvrAudios() {
  await fs.ensureDir(ivrAudioDir);
  const files = await fs.readdir(ivrAudioDir);
  return files
    .filter((file) => playbackAudioExtensions.has(path.extname(file).toLowerCase()))
    .sort((left, right) => left.localeCompare(right, "pt-BR"))
    .map((file) => ({
      file,
      label: file,
      playback: playbackNameFromFilename(file),
      url: `/api/ivr-audios/file/${encodeURIComponent(file)}`
    }));
}

function clearDeletedIvrAudioReferences(config, playback) {
  if (!config?.ivr || !playback) return 0;
  let cleared = 0;
  const clearField = (target, field) => {
    if (target && target[field] === playback) {
      target[field] = "";
      cleared += 1;
    }
  };
  const menus = [config.ivr, ...(config.ivr.menus || [])];
  menus.forEach((menu) => {
    clearField(menu, "greeting");
    clearField(menu, "invalidAudio");
    clearField(menu, "timeoutAudio");
    (menu.options || []).forEach((option) => clearField(option, "announcement"));
  });
  (config.ivr.looseOptions || []).forEach((option) => clearField(option, "announcement"));
  return cleared;
}

function isStrongPassword(password) {
  return typeof password === "string" && password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password);
}

async function runAsteriskRead(command) {
  const helper = process.env.ASTERISK_READ_HELPER || "/opt/pbx-sip-admin/scripts/asterisk-read-root.sh";
  const { stdout } = await execFileAsync("sudo", ["-n", helper, command], { timeout: 8000, maxBuffer: 1024 * 1024 });
  return stdout || "";
}

async function runAsteriskControl(action, extensionNumber, payload = {}) {
  const extension = String(extensionNumber || "").replace(/[^\d]/g, "");
  if (!extension) throw new Error("Ramal invalido");

  const helper = process.env.ASTERISK_CONTROL_HELPER || "/opt/pbx-sip-admin/scripts/asterisk-control-root.sh";
  const args = [helper, action, extension];
  if (action === "queue-pause") args.push(String(payload.reason || "Pausa"));
  if (action === "hangup") args.push(String(payload.channel || ""));
  if (action === "originate") args.push(String(payload.number || ""));
  if (action === "hangup-admin") args.push(String(payload.channel || ""));
  if (action === "redirect") {
    args.push(String(payload.channel || ""));
    args.push(String(payload.target || ""));
  }
  if (action === "spy") args.push(String(payload.targetEndpoint || payload.target || ""));
  if (action === "spy-browser") {
    args.push(String(payload.targetEndpoint || payload.target || ""));
    args.push(String(payload.listenerEndpoint || ""));
    args.push(String(payload.mode || "listen"));
  }
  if (action === "dialer-call") args.push(String(payload.file || ""));

  const { stdout, stderr } = await execFileAsync("sudo", ["-n", ...args], { timeout: 8000, maxBuffer: 1024 * 1024 });
  return `${stdout || ""}${stderr || ""}`.trim();
}

function dialerId() {
  return `camp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeDialerNumber(value) {
  const number = String(value || "").replace(/[^\d]/g, "");
  if (number.length < 8 || number.length > 20) return "";
  return number;
}

function normalizeDialerNumbers(value) {
  const raw = Array.isArray(value) ? value.join("\n") : String(value || "");
  const numbers = raw
    .split(/[\s,;]+/)
    .map(normalizeDialerNumber)
    .filter(Boolean);
  return [...new Set(numbers)];
}

function safeDialerText(value, max = 80) {
  return String(value || "").replace(/[\r\n;]/g, " ").trim().slice(0, max);
}

function cleanDialerPlayback(value) {
  return String(value || "").replace(/[^a-zA-Z0-9_./-]/g, "").replace(/\.\./g, "").slice(0, 120);
}

function dialerDestinationExists(config, type, destination) {
  const key = String(destination || "");
  if (type === "queue") return (config.queues || []).some((queue) => String(queue.id) === key);
  if (type === "extension") return (config.extensions || []).some((ext) => String(ext.number) === key);
  return false;
}

function dialerDestinationOptions(config) {
  return {
    queues: (config.queues || []).map((queue, index) => ({
      id: queue.id,
      name: queue.name || queue.id || `Fila ${index + 1}`,
      number: queue.number || ""
    })),
    extensions: (config.extensions || []).map((ext) => ({
      number: ext.number,
      name: ext.name || ext.number
    }))
  };
}

function configTrunks(config) {
  const trunks = Array.isArray(config.trunks) && config.trunks.length ? config.trunks : [{ ...(config.trunk || {}), id: "trunk-operadora", name: "Operadora principal" }];
  return trunks
    .map((trunk, index) => ({
      ...(config.trunk || {}),
      ...trunk,
      id: safeDialerText(trunk.id || (index === 0 ? "trunk-operadora" : `trunk-${index + 1}`), 60).replace(/[^a-zA-Z0-9_.-]/g, "-") || "trunk-operadora",
      name: safeDialerText(trunk.name || trunk.label || trunk.mainNumber || trunk.sipUser || trunk.sipServer || (index === 0 ? "Operadora principal" : `Operadora ${index + 1}`), 80),
      active: trunk.active !== false
    }))
    .filter((trunk) => trunk.active !== false && trunk.sipServer);
}

function normalizeDialerTrunkIds(input, previous, config) {
  const available = configTrunks(config);
  const allowed = new Set(available.map((trunk) => trunk.id));
  const raw = Array.isArray(input.trunkIds)
    ? input.trunkIds
    : String(input.trunkIds || input.trunks || previous?.trunkIds?.join(",") || config.outbound?.defaultTrunk || available[0]?.id || "trunk-operadora").split(",");
  const selected = [...new Set(raw.map((item) => safeDialerText(item, 60).replace(/[^a-zA-Z0-9_.-]/g, "-")).filter((item) => allowed.has(item)))];
  return selected.length ? selected : [config.outbound?.defaultTrunk || available[0]?.id || "trunk-operadora"].filter(Boolean);
}

function normalizeDialerCampaign(input = {}, previous = null, config = {}) {
  const now = new Date().toISOString();
  const destinationType = String(input.destinationType || previous?.destinationType || "queue");
  const destination = safeDialerText(input.destination || previous?.destination || "", 40);
  const numbers = normalizeDialerNumbers(input.numbers || input.numberText || previous?.numbers?.map((item) => item.number).join("\n") || "");
  const previousByNumber = new Map((previous?.numbers || []).map((item) => [String(item.number), item]));
  const maxConcurrent = Math.min(Math.max(Number(input.maxConcurrent || previous?.maxConcurrent || 1), 1), 10);
  const retryAttempts = Math.min(Math.max(Number(input.retryAttempts || previous?.retryAttempts || 1), 1), 5);
  const intervalSeconds = Math.min(Math.max(Number(input.intervalSeconds || previous?.intervalSeconds || 8), 3), 3600);
  const responseTimeout = Math.min(Math.max(Number(input.responseTimeout || previous?.responseTimeout || 8), 3), 60);

  return {
    id: previous?.id || safeDialerText(input.id, 50) || dialerId(),
    name: safeDialerText(input.name || previous?.name || "Nova campanha", 80) || "Nova campanha",
    description: safeDialerText(input.description || previous?.description || "", 160),
    audio: cleanDialerPlayback(input.audio || previous?.audio || ""),
    digit: String(input.digit || previous?.digit || "1").replace(/[^\d]/g, "").slice(0, 1) || "1",
    destinationType: ["queue", "extension"].includes(destinationType) ? destinationType : "queue",
    destination,
    callerId: safeDialerText(input.callerId || previous?.callerId || config.trunk?.mainNumber || "", 40),
    trunkIds: normalizeDialerTrunkIds(input, previous, config),
    trunkMode: "roundRobin",
    nextTrunkIndex: Number(previous?.nextTrunkIndex || 0),
    maxConcurrent,
    retryAttempts,
    intervalSeconds,
    responseTimeout,
    status: previous?.status || "draft",
    nextDialAt: previous?.nextDialAt || "",
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    numbers: numbers.map((number) => {
      const old = previousByNumber.get(number) || {};
      return {
        number,
        status: old.status || "pending",
        attempts: Number(old.attempts || 0),
        lastAttemptAt: old.lastAttemptAt || "",
        lastResult: old.lastResult || "",
        trunkId: old.trunkId || ""
      };
    })
  };
}

function dialerStats(campaign) {
  const rows = campaign.numbers || [];
  return {
    total: rows.length,
    pending: rows.filter((item) => item.status === "pending").length,
    dialed: rows.filter((item) => ["queued", "dialed"].includes(item.status)).length,
    failed: rows.filter((item) => item.status === "failed").length,
    byTrunk: rows.reduce((acc, item) => {
      if (item.trunkId) acc[item.trunkId] = (acc[item.trunkId] || 0) + 1;
      return acc;
    }, {})
  };
}

function publicDialerCampaign(campaign) {
  return { ...campaign, stats: dialerStats(campaign), numberText: (campaign.numbers || []).map((item) => item.number).join("\n") };
}

async function readDialerCampaigns() {
  const payload = (await fs.readJson(dialerCampaignsPath).catch(() => ({ campaigns: [] }))) || {};
  return Array.isArray(payload.campaigns) ? payload.campaigns : [];
}

async function writeDialerCampaigns(campaigns) {
  await fs.ensureDir(path.dirname(dialerCampaignsPath));
  await fs.writeJson(dialerCampaignsPath, { campaigns }, { spaces: 2 });
  return campaigns;
}

async function updateDialerCampaigns(mutator) {
  dialerStoreLock = dialerStoreLock.catch(() => {}).then(async () => {
    const campaigns = await readDialerCampaigns();
    const next = await mutator(campaigns);
    await writeDialerCampaigns(next);
    return next;
  });
  return dialerStoreLock;
}

function asteriskCallFileValue(value) {
  return String(value || "").replace(/[\r\n]/g, " ").replace(/;/g, ",").trim();
}

function dialerCallFileContent(config, campaign, lead) {
  const trunk = String(lead.trunkId || campaign.trunkIds?.[0] || config.outbound?.defaultTrunk || "trunk-operadora").replace(/[^a-zA-Z0-9_.-]/g, "");
  const callerId = asteriskCallFileValue(campaign.callerId || config.trunk?.mainNumber || "Discador");
  return [
    `Channel: PJSIP/${lead.number}@${trunk}`,
    `CallerID: ${callerId}`,
    "MaxRetries: 0",
    "RetryTime: 60",
    "WaitTime: 45",
    "Context: dialer-interactive",
    "Extension: s",
    "Priority: 1",
    `Setvar: DIALER_CAMPAIGN_ID=${asteriskCallFileValue(campaign.id)}`,
    `Setvar: DIALER_TARGET=${asteriskCallFileValue(lead.number)}`,
    `Setvar: DIALER_TRUNK=${asteriskCallFileValue(trunk)}`,
    `Setvar: DIALER_AUDIO=${asteriskCallFileValue(campaign.audio)}`,
    `Setvar: DIALER_DIGIT=${asteriskCallFileValue(campaign.digit)}`,
    `Setvar: DIALER_DEST_TYPE=${asteriskCallFileValue(campaign.destinationType)}`,
    `Setvar: DIALER_DESTINATION=${asteriskCallFileValue(campaign.destination)}`,
    `Setvar: DIALER_TIMEOUT=${Number(campaign.responseTimeout) || 8}`,
    "Archive: yes",
    ""
  ].join("\n");
}

async function enqueueDialerCall(config, campaign, lead) {
  await fs.ensureDir(dialerOutgoingDir);
  const file = `${campaign.id}-${lead.number}-${Date.now()}.call`.replace(/[^a-zA-Z0-9_.-]/g, "-");
  const filePath = path.join(dialerOutgoingDir, file);
  await fs.writeFile(filePath, dialerCallFileContent(config, campaign, lead), "utf8");
  await runAsteriskControl("dialer-call", "700", { file: filePath });
}

async function tickDialerCampaigns() {
  if (!tickDialerCampaigns.running) return;
  const config = await getConfig().catch(() => null);
  if (!config) return;
  await updateDialerCampaigns(async (campaigns) => {
    const now = Date.now();
    for (const campaign of campaigns) {
      if (campaign.status !== "running") continue;
      if (campaign.nextDialAt && new Date(campaign.nextDialAt).getTime() > now) continue;
      const batch = (campaign.numbers || []).filter((lead) => lead.status === "pending" && Number(lead.attempts || 0) < Number(campaign.retryAttempts || 1)).slice(0, Number(campaign.maxConcurrent) || 1);
      if (!batch.length) {
        campaign.status = "done";
        campaign.updatedAt = new Date().toISOString();
        continue;
      }
      const availableTrunks = configTrunks(config).map((trunk) => trunk.id);
      const campaignTrunks = (campaign.trunkIds || []).filter((id) => availableTrunks.includes(id));
      const trunks = campaignTrunks.length ? campaignTrunks : [config.outbound?.defaultTrunk || availableTrunks[0] || "trunk-operadora"];
      for (const lead of batch) {
        try {
          const trunkIndex = Number(campaign.nextTrunkIndex || 0) % trunks.length;
          lead.trunkId = trunks[trunkIndex];
          campaign.nextTrunkIndex = (trunkIndex + 1) % trunks.length;
          await enqueueDialerCall(config, campaign, lead);
          lead.status = "dialed";
          lead.lastResult = `Chamada enviada pelo tronco ${lead.trunkId}`;
        } catch (error) {
          lead.status = Number(lead.attempts || 0) + 1 >= Number(campaign.retryAttempts || 1) ? "failed" : "pending";
          lead.lastResult = error.message || "Falha ao enviar chamada";
        }
        lead.attempts = Number(lead.attempts || 0) + 1;
        lead.lastAttemptAt = new Date().toISOString();
      }
      campaign.nextDialAt = new Date(Date.now() + (Number(campaign.intervalSeconds) || 8) * 1000).toISOString();
      campaign.updatedAt = new Date().toISOString();
    }
    return campaigns;
  });
}

function startDialerEngine() {
  tickDialerCampaigns.running = true;
  setInterval(() => tickDialerCampaigns().catch((error) => console.error("Falha no discador:", error.message)), 1000);
}

async function readLogTail(logPath, lines = 400) {
  if (!(await fs.pathExists(logPath))) return "";
  try {
    const { stdout } = await execFileAsync("tail", ["-n", String(lines), logPath], {
      timeout: 8000,
      maxBuffer: 1024 * 1024 * 4
    });
    return stdout || "";
  } catch {
    return "";
  }
}

function parseEndpointOutput(output) {
  const endpoints = [];
  let current = null;

  output.split("\n").forEach((line) => {
    const endpointMatch = line.match(/^\s*Endpoint:\s+(\S+)\s+(.+?)\s+(\d+\s+of\s+\S+)\s*$/);
    if (endpointMatch) {
      const endpointId = endpointMatch[1].split("/")[0];
      current = {
        id: endpointId,
        label: endpointMatch[1],
        state: endpointMatch[2].trim(),
        channels: endpointMatch[3],
        contacts: [],
        auth: "",
        aor: ""
      };
      endpoints.push(current);
      return;
    }

    if (!current) return;

    const authMatch = line.match(/^\s*(?:InAuth|I\/OAuth|OutAuth):\s+(\S+)/);
    if (authMatch) current.auth = authMatch[1];

    const aorMatch = line.match(/^\s*Aor:\s+(\S+)\s+(\d+)/);
    if (aorMatch) {
      current.aor = aorMatch[1];
      current.maxContacts = Number(aorMatch[2]);
    }

    const contactMatch = line.match(/^\s*Contact:\s+\S+\/(.+?)\s+[a-f0-9]+\s+(\S+)\s+([\d.]+|nan)/i);
    if (contactMatch) {
      current.contacts.push({
        uri: contactMatch[1].trim(),
        status: contactMatch[2],
        rtt: contactMatch[3]
      });
    }
  });

  return endpoints;
}

function isHealthyEndpointState(state) {
  const normalized = String(state || "").trim().toLowerCase();
  return ["available", "reachable", "registered", "not in use", "ringing", "on hold", "busy", "idle", "in use"].includes(normalized);
}

function hasHealthyEndpointContact(endpoint) {
  return (endpoint.contacts || []).some((contact) => /^(avail|available|reachable|ok)$/i.test(String(contact.status || "")));
}

function parseRegistrationsOutput(output) {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.includes("/") && !line.startsWith("<") && !line.startsWith("="))
    .map((line) => {
      const parts = line.split(/\s{2,}/).filter(Boolean);
      const registration = parts[0] || "";
      const auth = parts[1] || "";
      const statusText = parts.slice(2).join(" ");
      const status = (statusText.match(/^(\S+)/) || [])[1] || "";
      const expires = (statusText.match(/\(exp\.\s*([^)]+)\)/) || [])[1] || "";
      const server = (registration.match(/\/(.+)$/) || [])[1] || registration;
      return { id: registration.split("/")[0], server, auth, status, expires };
    });
}

function parseQueueSeconds(value) {
  const text = String(value || "").trim();
  const clock = text.match(/^(?:(\d+):)?(\d+):(\d+)$/);
  if (clock) return (Number(clock[1]) || 0) * 3600 + (Number(clock[2]) || 0) * 60 + (Number(clock[3]) || 0);
  const seconds = text.match(/(\d+)\s*s(?:ec|eg)?/i);
  return seconds ? Number(seconds[1]) : Number(text) || 0;
}

function queueMemberNumber(value) {
  const text = String(value || "");
  const number = (
    (text.match(/PJSIP\/web-([^/@\s-]+)/i) || [])[1] ||
    (text.match(/PJSIP\/([^/@-]+)/i) || [])[1] ||
    (text.match(/SIP\/web-([^/@\s-]+)/i) || [])[1] ||
    (text.match(/SIP\/([^/@-]+)/i) || [])[1] ||
    (text.match(/Local\/([^/@-]+)/i) || [])[1] ||
    (text.match(/\b(\d{2,})\b/) || [])[1] ||
    text
  );
  return String(number || "").replace(/^web-/, "");
}

function queueStatusFromText(value) {
  const text = String(value || "").toLowerCase();
  if (/paused|pausad/.test(text)) return { key: "paused", label: "Pausado", tone: "paused" };
  if (/ringing|tocando/.test(text)) return { key: "ringing", label: "Tocando", tone: "ringing" };
  if (/hold|espera/.test(text)) return { key: "hold", label: "Espera", tone: "ringing" };
  if (/not in use|idle|available|reachable|registered|dispon/.test(text)) return { key: "available", label: "Disponivel", tone: "available" };
  if (/in use|busy|ocupad/.test(text)) return { key: "busy", label: "Ligacao", tone: "busy" };
  if (/unavailable|unavail|invalid|unknown|nonqual|lagged|indispon/.test(text)) return { key: "unavailable", label: "Indisponivel", tone: "unavailable" };
  return { key: "unknown", label: value || "Nao verificado", tone: "unavailable" };
}

function stripAnsi(value) {
  return String(value || "").replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
}

function betterQueueAgent(current, candidate) {
  if (!current) return candidate;
  const score = (agent) => {
    if (!agent) return 0;
    if (agent.statusTone === "available") return 5;
    if (agent.statusTone === "ringing") return 4;
    if (agent.statusTone === "busy") return 3;
    if (agent.statusTone === "paused") return 2;
    return 1;
  };
  return score(candidate) >= score(current) ? candidate : current;
}

function endpointRegistered(endpoint = {}) {
  const state = String(endpoint.state || "").trim().toLowerCase();
  return hasHealthyEndpointContact(endpoint) || ((endpoint.contacts || []).length > 0 && isHealthyEndpointState(state)) || ["available", "reachable", "registered"].includes(state);
}

function mergedEndpointStatus(byId, number) {
  const key = String(number || "");
  const primary = byId.get(key) || byId.get(`${key}/${key}`) || {};
  const browser = byId.get(`web-${key}`) || byId.get(`web-${key}/${key}`) || {};
  const primaryRegistered = endpointRegistered(primary);
  const browserRegistered = endpointRegistered(browser);
  const preferred = browserRegistered && !primaryRegistered ? browser : primary;
  return {
    primary,
    browser,
    registered: primaryRegistered || browserRegistered,
    state: preferred.state || browser.state || "Nao carregado",
    channels: preferred.channels || primary.channels || browser.channels || "0 of inf",
    contacts: [...(primary.contacts || []), ...(browser.contacts || [])],
    preferred
  };
}

function parseQueueOutput(output) {
  const queues = [];
  let current = null;
  let section = "";

  String(output || "")
    .split("\n")
    .forEach((line) => {
      const trimmed = stripAnsi(line).trim();
      if (!trimmed) return;

      const headerMatch = trimmed.match(/^(\S+)\s+has\s+(\d+)\s+calls?.*?\s+in\s+'([^']+)'\s+strategy\s+\(([^)]*)\),\s*W:(\d+),\s*C:(\d+),\s*A:(\d+),\s*SL:([\d.]+)%.*?(?:within\s+(\d+)s)?/i);
      if (headerMatch) {
        const hold = (headerMatch[4].match(/(\d+)s\s+holdtime/i) || [])[1] || 0;
        const talk = (headerMatch[4].match(/(\d+)s\s+talktime/i) || [])[1] || 0;
        current = {
          id: headerMatch[1],
          name: headerMatch[1],
          strategy: headerMatch[3],
          callsWaiting: Number(headerMatch[2]) || 0,
          weight: Number(headerMatch[5]) || 0,
          completed: Number(headerMatch[6]) || 0,
          abandoned: Number(headerMatch[7]) || 0,
          serviceLevel: Number(headerMatch[8]) || 0,
          serviceLevelSeconds: Number(headerMatch[9]) || 0,
          holdTime: Number(hold) || 0,
          talkTime: Number(talk) || 0,
          agents: [],
          waiting: []
        };
        queues.push(current);
        section = "";
        return;
      }

      if (!current) return;
      if (/^Members:/i.test(trimmed)) {
        section = "members";
        return;
      }
      if (/^Callers:/i.test(trimmed)) {
        section = "callers";
        return;
      }
      if (/^No Members/i.test(trimmed) || /^No Callers/i.test(trimmed)) return;

      if (section === "members") {
        const interfaceName = (trimmed.match(/\((PJSIP\/[^)]+|SIP\/[^)]+|Local\/[^)]+)\)/i) || [])[1] || trimmed.split(/\s+/)[0] || "";
        const details = [...trimmed.matchAll(/\(([^)]*)\)/g)].map((match) => match[1]);
        const statusText = details.find((item) => /not in use|in use|busy|ringing|hold|unavailable|invalid|paused/i.test(item)) || trimmed;
        const pausedText = details.find((item) => /paused/i.test(item)) || "";
        const pauseSeconds = Number((pausedText.match(/paused was\s+(\d+)\s+secs?\s+ago/i) || [])[1] || 0);
        const callsTaken = (trimmed.match(/has taken\s+(\d+)\s+calls?/i) || [])[1];
        const status = queueStatusFromText(pausedText || statusText);
        current.agents.push({
          interface: interfaceName,
          number: queueMemberNumber(interfaceName),
          name: queueMemberNumber(interfaceName),
          penalty: (trimmed.match(/penalty\s+(\d+)/i) || [])[1] || "",
          status: status.key,
          statusLabel: status.label,
          statusTone: status.tone,
          callsTaken: callsTaken === undefined ? 0 : Number(callsTaken),
          loginTime: "",
          duration: "",
          flow: "",
          currentNumber: "",
          idleTime: "",
          pauseName: pausedText,
          pauseSeconds,
          pauseDurationLabel: pauseSeconds ? secondsToHuman(pauseSeconds) : "",
          pauseStartedAt: status.key === "paused" ? new Date(Date.now() - pauseSeconds * 1000).toISOString() : ""
        });
        return;
      }

      if (section === "callers") {
        const callerMatch = trimmed.match(/^(\d+)\.\s+(.+?)(?:\s+\((.*)\))?$/);
        if (!callerMatch) return;
        const meta = callerMatch[3] || "";
        const waitText = (meta.match(/wait:\s*([^,)]*)/i) || [])[1] || "";
        current.waiting.push({
          position: Number(callerMatch[1]) || current.waiting.length + 1,
          callerId: callerMatch[2].trim(),
          queue: current.id,
          wait: waitText,
          waitSeconds: parseQueueSeconds(waitText)
        });
      }
    });

  return queues;
}

function parseChannelOutput(output) {
  return String(output || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("!");
      return {
        channel: parts[0] || "",
        context: parts[1] || "",
        extension: parts[2] || "",
        state: parts[4] || "",
        application: parts[5] || "",
        data: parts[6] || "",
        callerId: parts[7] || "",
        duration: Number(parts[11]) || Number(parts[10]) || 0,
        bridgedTo: parts[12] || "",
        uniqueId: parts[parts.length - 2] || "",
        linkedId: parts[parts.length - 1] || ""
      };
    });
}

function activeChannelExtensionCandidates(channel, configuredNumbers = new Set()) {
  const rawCandidates = [
    queueMemberNumber(channel?.channel),
    queueMemberNumber(channel?.bridgedTo)
  ];
  const dataEndpoint = String(channel?.data || "").match(/(?:PJSIP|SIP|Local)\/(?:web-)?([^/@,\s-]+)/i);
  if (dataEndpoint) rawCandidates.push(dataEndpoint[1]);

  return [...new Set(rawCandidates.map(normalizeDigits).filter(Boolean))]
    .filter((number) => configuredNumbers.has(number));
}

function channelDialedNumber(channel) {
  const dataNumber = (
    String(channel?.data || "").match(/(?:PJSIP|SIP)\/0?(\d+)@/i) ||
    String(channel?.data || "").match(/(?:PJSIP|SIP|Local)\/0?(\d+)(?:[,/@]|\b)/i) ||
    []
  )[1] || "";
  return normalizeDigits(channel?.extension) || normalizeDigits(dataNumber);
}

function channelDisplayNumberCandidates(channel) {
  return [
    channelDialedNumber(channel),
    normalizeDigits(channel?.callerId),
    normalizeDigits(channel?.extension)
  ].filter(Boolean);
}

function bestExternalChannelNumber(candidates, extensionNumber = "", configuredNumbers = new Set()) {
  const member = normalizeDigits(extensionNumber);
  return candidates.find((number) => {
    const normalized = normalizeDigits(number);
    return normalized && normalized !== member && normalized.length >= 6 && !configuredNumbers.has(normalized);
  }) || "";
}

function bestOtherChannelNumber(candidates, extensionNumber = "") {
  const member = normalizeDigits(extensionNumber);
  return candidates.find((number) => {
    const normalized = normalizeDigits(number);
    return normalized && normalized !== member;
  }) || "";
}

function activeChannelDisplayNumber(channel, extensionNumber = "", linkedChannels = [], configuredNumbers = new Set()) {
  if (!channel) return "";
  const member = normalizeDigits(extensionNumber);
  const ownCandidates = channelDisplayNumberCandidates(channel);
  const peerCandidates = (linkedChannels || [])
    .filter((item) => item && (item.uniqueId !== channel.uniqueId || item.channel !== channel.channel))
    .flatMap(channelDisplayNumberCandidates);

  return (
    bestExternalChannelNumber(ownCandidates, member, configuredNumbers) ||
    bestExternalChannelNumber(peerCandidates, member, configuredNumbers) ||
    bestOtherChannelNumber(peerCandidates, member) ||
    bestOtherChannelNumber(ownCandidates, member) ||
    ""
  );
}

function activeChannelStatus(channel) {
  if (!channel) return null;
  const status = queueStatusFromText(channel.state || channel.application || "");
  return status.tone && status.tone !== "unavailable"
    ? status
    : { key: "busy", label: "Ligacao", tone: "busy" };
}

function monitorDisplayValue(value) {
  const text = String(value || "").trim();
  return text && text !== "-" ? text : "";
}

function relatedChannelsFor(channel, channelIndex = new Map()) {
  if (!channel) return [];
  const related = new Map();
  [channel.linkedId, channel.uniqueId].filter(Boolean).forEach((key) => {
    (channelIndex.get(key) || []).forEach((item) => {
      related.set(`${item.uniqueId || ""}:${item.channel || ""}`, item);
    });
  });
  return [...related.values()];
}

function parseCsvLine(line) {
  const columns = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      columns.push(current);
      current = "";
      continue;
    }

    current += char;
  }

  columns.push(current);
  return columns.map((value) => value.trim());
}

function parseRegistrationLogs(raw) {
  const interesting = /(Registration|registrar|REGISTER|Wrong password|No matching endpoint|Failed to authenticate|AOR|endpoint|SecurityEvent|SuccessfulAuth|ChallengeSent|InvalidAccountID|FailedACL)/i;
  return raw
    .split("\n")
    .filter((line) => interesting.test(line))
    .slice(-250)
    .reverse()
    .map((line) => {
      const match = line.match(/^\[([^\]]+)\]\s+(\S+)\[(\d+)\]\s+([^:]+):\s+(.*)$/);
      const message = match ? match[5] : line;
      const ip = (message.match(/(\d{1,3}(?:\.\d{1,3}){3})(?::(\d+))?/) || [])[1] || "";
      const extension =
        (message.match(/endpoint '([^']+)'/) || [])[1] ||
        (message.match(/<sip:([^@>]+)@/) || [])[1] ||
        (message.match(/AOR '([^']+)'/) || [])[1] ||
        "";
      const outcome = /Registered|added contact|created contact/i.test(message)
        ? "ok"
        : /failed|Wrong password|not found|No matching|syntax error|Dropping/i.test(message)
          ? "erro"
          : "info";
      return {
        time: match ? match[1].trim() : "",
        level: match ? match[2].replace(/\[\d+\]$/, "") : "",
        module: match ? match[4] : "",
        extension,
        ip,
        outcome,
        message
      };
    });
}

async function readRegistrationLogs() {
  const logPaths = [
    process.env.ASTERISK_MESSAGES_LOG || "/var/log/asterisk/messages.log",
    process.env.ASTERISK_SECURITY_LOG || "/var/log/asterisk/security.log"
  ];
  const chunks = await Promise.all(
    logPaths.map((logPath) => readLogTail(logPath, 500))
  );
  const raw = chunks.filter(Boolean).join("\n");
  return parseRegistrationLogs(raw);
}

async function readPbxStatusFresh(config) {
  const [endpointOutput, registrationOutput, queueOutput, channelOutput, logs, manualPauses, idleByExtension] = await Promise.all([
    runAsteriskRead("endpoints"),
    runAsteriskRead("registrations"),
    runAsteriskRead("queues").catch(() => ""),
    runAsteriskRead("channels").catch(() => ""),
    readRegistrationLogs(),
    readExtensionPauses(),
    buildExtensionIdleIndex(config).catch(() => new Map())
  ]);
  const endpoints = parseEndpointOutput(endpointOutput);
  const registrations = parseRegistrationsOutput(registrationOutput);
  const queueStats = parseQueueOutput(queueOutput);
  const activeChannels = parseChannelOutput(channelOutput);
  const byId = new Map(endpoints.map((endpoint) => [endpoint.id, endpoint]));
  const queueById = new Map(queueStats.map((queue) => [queue.id, queue]));
  const channelByExtension = new Map();
  const channelsByLinkedId = activeChannels.reduce((acc, channel) => {
    [channel.linkedId, channel.uniqueId].filter(Boolean).forEach((key) => {
      const items = acc.get(key) || [];
      items.push(channel);
      acc.set(key, items);
    });
    return acc;
  }, new Map());
  const readAt = Date.now();
  const configuredExtensionNumbers = new Set((config.extensions || []).map((extension) => String(extension.number)));
  const presenceEvents = [];

  activeChannels.forEach((channel) => {
    activeChannelExtensionCandidates(channel, configuredExtensionNumbers).forEach((extension) => {
      if (!channelByExtension.has(extension)) channelByExtension.set(extension, channel);
    });
  });

  const waitingChannelsByQueue = activeChannels.reduce((acc, channel) => {
    if (!/^Queue$/i.test(channel.application || "")) return acc;
    const queueId = String(channel.data || "").split(",")[0] || "";
    if (!queueId) return acc;
    const items = acc.get(queueId) || [];
    items.push(channel);
    acc.set(queueId, items);
    return acc;
  }, new Map());

  const extensions = config.extensions.map((extension) => {
    const endpoint = mergedEndpointStatus(byId, extension.number);
    const pause = pauseRecordFor(manualPauses, extension.number, readAt);
    const stats = idleByExtension.get(String(extension.number)) || {};
    const channel = channelByExtension.get(String(extension.number));
    const state = endpoint.state;
    const registered = endpoint.registered || Boolean(channel);
    const activePause = registered ? pause : null;
    const { event, ...presence } = updateExtensionPresence(extension.number, registered, readAt);
    if (event) presenceEvents.push(event);
    const endpointStatus = queueStatusFromText(channel?.state || state || "");
    const idle = updateExtensionIdle(
      extension.number,
      registered,
      extensionHasActiveCallForIdle(endpointStatus.key, channel),
      readAt,
      presence.onlineSince,
      stats.lastCallActivityAt
    );
    return {
      number: extension.number,
      name: extension.name,
      department: extension.department,
      state,
      registered,
      paused: Boolean(activePause),
      pauseReason: activePause?.reason || "",
      pauseSeconds: activePause?.pauseSeconds || 0,
      pauseDurationLabel: activePause?.pauseDurationLabel || "",
      pauseStartedAt: activePause?.startedAt || "",
      idleSeconds: idle.idleSeconds ?? null,
      idleTime: idle.idleTime || "",
      idleSince: idle.idleSince || "",
      lastInboundCallAt: "",
      callsMadeToday: stats.callsMadeToday || 0,
      callsReceivedToday: stats.callsReceivedToday || 0,
      ...presence,
      channels: endpoint.channels || "0 of inf",
      contacts: endpoint.contacts || [],
      channel: channel?.channel || "",
      duration: channel ? secondsToHuman(channel.duration) : "",
      currentNumber: activeChannelDisplayNumber(
        channel,
        extension.number,
        relatedChannelsFor(channel, channelsByLinkedId),
        configuredExtensionNumbers
      )
    };
  });

  [...extensionPresence.keys()].forEach((number) => {
    if (!configuredExtensionNumbers.has(number)) extensionPresence.delete(number);
  });
  [...extensionIdleSince.keys()].forEach((number) => {
    if (!configuredExtensionNumbers.has(number)) extensionIdleSince.delete(number);
  });

  const queues = (config.queues || []).map((queueConfig) => {
    const parsed = queueById.get(queueConfig.id) || {};
    const parsedAgents = parsed.agents || [];
    const parsedByNumber = parsedAgents.reduce((acc, agent) => {
      const key = String(agent.number);
      acc.set(key, betterQueueAgent(acc.get(key), agent));
      return acc;
    }, new Map());
    const configuredMembers = [...new Set((queueConfig.members || []).map(String).filter(Boolean))];
    const liveOnlyMembers = parsedAgents.map((agent) => String(agent.number)).filter((member) => !configuredMembers.includes(member));
    const allMembers = [...configuredMembers, ...liveOnlyMembers];
    const fallbackAgents = allMembers.map((member) => {
      const endpoint = mergedEndpointStatus(byId, member);
      const channel = channelByExtension.get(member);
      const parsedAgent = parsedByNumber.get(member) || {};
      const manualPause = pauseRecordFor(manualPauses, member, readAt);
      const stats = idleByExtension.get(String(member)) || {};
      const endpointRegistered = endpoint.registered || Boolean(channel);
      const { event, ...presence } = updateExtensionPresence(member, endpointRegistered, readAt);
      if (event) presenceEvents.push(event);
      const parsedStatus = queueStatusFromText(parsedAgent.statusLabel || parsedAgent.status || "");
      const endpointStatus = queueStatusFromText(channel?.state || endpoint.state || "Nao carregado");
      const activeManualPause = endpointRegistered ? manualPause : null;
      const channelStatus = activeChannelStatus(channel);
      const status =
        !endpointRegistered
          ? { key: "unavailable", label: "Offline", tone: "unavailable" }
          : channelStatus
          ? channelStatus
          : activeManualPause || parsedStatus.tone === "paused"
          ? { key: "paused", label: "Pausado", tone: "paused" }
          : parsedStatus.tone && parsedStatus.tone !== "unavailable"
            ? parsedStatus
            : endpointStatus.tone && endpointStatus.tone !== "unavailable"
              ? endpointStatus
              : { key: "available", label: "Disponivel", tone: "available" };
      const idle = updateExtensionIdle(
        member,
        endpointRegistered,
        extensionHasActiveCallForIdle(status.key, channel),
        readAt,
        presence.onlineSince,
        stats.lastCallActivityAt
      );
      const extension = config.extensions.find((item) => item.number === member) || {};
      return {
        interface: parsedAgent.interface || `PJSIP/${member}`,
        number: member,
        name: extension.name || member,
        penalty: parsedAgent.penalty || "",
        status: status.key,
        statusLabel: status.label,
        statusTone: status.tone,
        registered: endpointRegistered,
        sipState: endpoint.state || "Nao carregado",
        ...presence,
        callsTaken: Number(parsedAgent.callsTaken) || 0,
        loginTime: endpointRegistered ? presence.onlineDurationLabel : "-",
        channel: channel?.channel || "",
        duration: channel ? secondsToHuman(channel.duration) : monitorDisplayValue(parsedAgent.duration),
        flow: monitorDisplayValue(parsedAgent.flow) || channel?.application || "",
        currentNumber: channel
          ? activeChannelDisplayNumber(
              channel,
              member,
              relatedChannelsFor(channel, channelsByLinkedId),
              configuredExtensionNumbers
            )
          : monitorDisplayValue(parsedAgent.currentNumber),
        idleSeconds: idle.idleSeconds ?? null,
        idleTime: idle.idleTime || "",
        idleSince: idle.idleSince || "",
        lastInboundCallAt: "",
        lastCallActivityAt: stats.lastCallActivityAt || "",
        callsMadeToday: stats.callsMadeToday || 0,
        callsReceivedToday: stats.callsReceivedToday || 0,
        pauseName: activeManualPause?.reason || parsedAgent.pauseName || "",
        pauseReason: activeManualPause?.reason || "",
        pauseSeconds: activeManualPause?.pauseSeconds || Number(parsedAgent.pauseSeconds) || 0,
        pauseDurationLabel: activeManualPause?.pauseDurationLabel || parsedAgent.pauseDurationLabel || "",
        pauseStartedAt: activeManualPause?.startedAt || parsedAgent.pauseStartedAt || ""
      };
    });

    const agents = fallbackAgents.map((agent) => {
      const extension = config.extensions.find((item) => item.number === agent.number) || {};
      const channel = channelByExtension.get(agent.number);
      return {
        ...agent,
        name: extension.name || agent.name || agent.number,
        channel: agent.channel || channel?.channel || "",
        duration: channel ? secondsToHuman(channel.duration) : monitorDisplayValue(agent.duration),
        flow: monitorDisplayValue(agent.flow) || channel?.application || "",
        currentNumber: channel
          ? activeChannelDisplayNumber(
              channel,
              agent.number,
              relatedChannelsFor(channel, channelsByLinkedId),
              configuredExtensionNumbers
            )
          : monitorDisplayValue(agent.currentNumber),
        idleSeconds: agent.idleSeconds ?? null,
        idleTime: agent.idleTime || "",
        idleSince: agent.idleSince || "",
        lastInboundCallAt: agent.lastInboundCallAt || "",
        callsMadeToday: agent.callsMadeToday || 0,
        callsReceivedToday: agent.callsReceivedToday || 0,
        pauseReason: agent.pauseReason || "",
        pauseSeconds: Number(agent.pauseSeconds) || 0,
        pauseDurationLabel: agent.pauseDurationLabel || "",
        pauseStartedAt: agent.pauseStartedAt || ""
      };
    });

    const counts = agents.reduce(
      (total, agent) => {
        total[agent.statusTone] = (total[agent.statusTone] || 0) + 1;
        return total;
      },
      { available: 0, paused: 0, busy: 0, ringing: 0, unavailable: 0 }
    );

    return {
      id: queueConfig.id,
      name: queueConfig.name || parsed.name || queueConfig.id,
      strategy: parsed.strategy || queueConfig.strategy,
      callsWaiting: Number(parsed.callsWaiting) || 0,
      completed: Number(parsed.completed) || 0,
      abandoned: Number(parsed.abandoned) || 0,
      holdTime: Number(parsed.holdTime) || 0,
      holdTimeLabel: secondsToHuman(parsed.holdTime || 0),
      talkTime: Number(parsed.talkTime) || 0,
      talkTimeLabel: secondsToHuman(parsed.talkTime || 0),
      productivity: agents.length ? Math.round(((counts.available || 0) + (counts.busy || 0) + (counts.ringing || 0)) / agents.length * 100) : 0,
      serviceLevel: Number(parsed.serviceLevel) || 0,
      serviceLevelSeconds: Number(parsed.serviceLevelSeconds) || queueConfig.timeout || 0,
      counts,
      agents,
      waiting: (parsed.waiting || []).map((call, index) => {
        const channels = waitingChannelsByQueue.get(queueConfig.id) || [];
        const channel =
          channels.find((item) => String(item.callerId || "") && String(call.callerId || "").includes(String(item.callerId || ""))) ||
          channels[index] ||
          null;
        return {
          ...call,
          channel: channel?.channel || "",
          duration: channel?.duration || 0
        };
      })
    };
  });

  await appendPresenceEvents(presenceEvents);

  return {
    checkedAt: new Date().toISOString(),
    extensions,
    queues,
    waitingCalls: queues.flatMap((queue) => (queue.waiting || []).map((call) => ({ ...call, queueName: queue.name }))),
    activeChannels,
    trunk: {
      name: "trunk-operadora",
      server: config.trunk.sipServer,
      registration: registrations.find((item) => item.id === "trunk-operadora-registration") || null,
      endpoint: byId.get("trunk-operadora") || null
    },
    logs
  };
}

async function readPbxStatus(config, { fresh = false } = {}) {
  const revision = configRevision(config);
  const now = Date.now();
  const ttl = Math.max(250, Number(process.env.PBX_STATUS_CACHE_MS || 750));
  if (!fresh && pbxStatusCache.revision === revision) {
    if (pbxStatusCache.pending) return pbxStatusCache.pending;
    if (pbxStatusCache.value && pbxStatusCache.expiresAt > now) return pbxStatusCache.value;
  }
  const pending = readPbxStatusFresh(config);
  pbxStatusCache = { revision, expiresAt: 0, value: null, pending };
  try {
    const value = await pending;
    if (pbxStatusCache.pending === pending) {
      pbxStatusCache = { revision, expiresAt: Date.now() + ttl, value, pending: null };
    }
    return value;
  } catch (error) {
    if (pbxStatusCache.pending === pending) pbxStatusCache = { revision: "", expiresAt: 0, value: null, pending: null };
    throw error;
  }
}

async function readReports(sourceConfig = null) {
  const config = sourceConfig || await getConfig();
  const calls = await readPbxReportCalls(config, { skipRecordingScan: true });
  return calls.slice(-200).reverse().map((call) => ({
    callerId: call.callerId,
    source: call.source,
    destination: call.destination,
    context: call.context,
    channel: call.channel,
    destinationChannel: call.destinationChannel,
    lastApp: call.lastApp,
    lastData: call.lastData,
    startedAt: call.startedAt,
    answeredAt: call.answeredAt,
    endedAt: call.endedAt,
    duration: String(call.duration),
    billsec: String(call.billsec),
    disposition: call.disposition,
    amaflags: call.amaflags,
    accountCode: call.accountCode,
    uniqueId: call.uniqueId,
    userField: call.userField,
    protocol: call.protocol || "",
    sequence: call.sequence,
    extension: call.extension,
    extensionName: call.extensionName,
    department: call.department,
    type: call.type
  }));
}

async function findCdrPaths() {
  const cdrCandidates = [
    process.env.ASTERISK_CDR_CSV,
    "/var/log/asterisk/cdr-custom/Master.csv",
    "/var/log/asterisk/cdr-csv/Master.csv"
  ].filter(Boolean);
  const existing = await Promise.all(cdrCandidates.map(async (candidate) => ((await fs.pathExists(candidate)) ? candidate : "")));
  return [...new Set(existing.filter(Boolean))];
}

function parseFlexibleDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  const direct = new Date(text);
  if (!Number.isNaN(direct.getTime())) return direct;
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/);
  if (match) {
    const [, year, month, day, hour, minute, second] = match;
    const parsed = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

function isoDateTime(value) {
  const parsed = parseFlexibleDate(value);
  if (!parsed) return String(value || "");
  return parsed.toISOString();
}

function hasLikelyCdrDate(value) {
  return Boolean(parseFlexibleDate(value));
}

function secondsToHuman(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

async function buildExtensionIdleIndex(config) {
  const now = Date.now();
  const today = localDateKey(new Date(now));
  const extensions = (config.extensions || []).map((extension) => String(extension.number || "")).filter(Boolean);
  if (!extensions.length) return new Map();

  const calls = await readPbxReportCalls(config, { skipRecordingScan: true });
  const statsByExtension = new Map(extensions.map((number) => [number, { callsMadeToday: 0, callsReceivedToday: 0, lastCallActivityAt: "" }]));

  calls.forEach((call) => {
    const receivedAt = parseFlexibleDate(call.endedAt || call.answeredAt || call.startedAt || call.calldate);
    if (!receivedAt) return;
    const callDate = localDateKey(receivedAt);

    extensions.forEach((number) => {
      if (!protocolExtensionMatches(number, call)) return;
      const stats = statsByExtension.get(number) || { callsMadeToday: 0, callsReceivedToday: 0, lastCallActivityAt: "" };
      if (callDate === today) {
        if (call.type === "outbound") stats.callsMadeToday += 1;
        if (call.type === "inbound") stats.callsReceivedToday += 1;
      }
      const currentLastMs = Date.parse(stats.lastCallActivityAt || "") || 0;
      if (receivedAt.getTime() > currentLastMs) stats.lastCallActivityAt = receivedAt.toISOString();
      statsByExtension.set(number, stats);
    });
  });

  return new Map(
    extensions.map((number) => {
      const stats = statsByExtension.get(number) || { callsMadeToday: 0, callsReceivedToday: 0, lastCallActivityAt: "" };
      return [
        number,
        {
          idleSeconds: null,
          idleTime: "",
          lastInboundCallAt: "",
          ...stats
        }
      ];
    })
  );
}

function normalizeReportStatus(disposition) {
  const value = String(disposition || "").trim().toUpperCase();
  if (value === "ANSWERED") return "answered";
  if (value === "NO ANSWER" || value === "NOANSWER") return "no_answer";
  if (value === "BUSY") return "busy";
  if (value === "FAILED" || value === "CONGESTION" || value === "CHANUNAVAIL") return "failed";
  if (value === "CANCEL" || value === "CANCELLED" || value === "CANCELED") return "canceled";
  if (value === "REJECTED") return "rejected";
  return value ? value.toLowerCase().replace(/\s+/g, "_") : "unknown";
}

function reportStatusLabel(status) {
  return {
    answered: "Atendida",
    no_answer: "Nao atendida",
    busy: "Ocupada",
    failed: "Falhou",
    canceled: "Cancelada",
    rejected: "Rejeitada",
    unknown: "Desconhecida"
  }[status] || status;
}

function extensionNumbers(config) {
  return new Set((config.extensions || []).map((extension) => String(extension.number)));
}

function reportChannelExtensionCandidates(call) {
  return [call.channel, call.dstchannel, call.lastdata]
    .flatMap((value) => [...String(value || "").matchAll(/(?:PJSIP|SIP|Local)\/(?:web-)?([^/@,\s-]+)/gi)].map((match) => match[1]));
}

function inferReportExtension(call, config, type = inferReportType(call, config)) {
  const extensions = extensionNumbers(config);
  const topology = reportChannelExtensionCandidates(call);
  const candidates = type === "inbound"
    ? [call.dst, ...topology]
    : type === "outbound"
      ? [call.src, ...topology]
      : [call.src, call.dst, ...topology];
  return candidates.filter(Boolean).map(String).find((candidate) => extensions.has(candidate)) || "";
}

function inferReportType(call, config) {
  const extensions = extensionNumbers(config);
  const src = String(call.src || "");
  const dst = String(call.dst || "");
  const explicitDirection = String(call.direction || "").toLowerCase();
  if (["inbound", "outbound", "internal"].includes(explicitDirection)) return explicitDirection;
  const context = String(call.dcontext || "").toLowerCase();
  const channelName = String(call.channel || "").toLowerCase();
  const dstChannelName = String(call.dstchannel || "").toLowerCase();
  const lastData = String(call.lastdata || "").toLowerCase();
  const channel = `${channelName} ${dstChannelName} ${lastData}`;
  if (/(^|\/)trunk-|trunk-operadora|operadora/.test(channelName)) return "inbound";
  if (/inbound|entrada|ivr-|ringgroup|queue|support|from-trunk|trunk/.test(context)) return "inbound";
  if (/trunk-operadora|@trunk|from-internal|outbound|saida/.test(channel) || (extensions.has(src) && !extensions.has(dst))) return "outbound";
  if (extensions.has(src) && extensions.has(dst)) return "internal";
  if (extensions.has(src) || extensions.has(dst)) return extensions.has(src) && extensions.has(dst) ? "internal" : extensions.has(src) ? "outbound" : "inbound";
  return "inbound";
}

function inferTrunk(call, config) {
  const joined = `${call.channel || ""} ${call.dstchannel || ""} ${call.lastdata || ""} ${call.peeraccount || ""}`;
  const trunkMatch = joined.match(/(trunk-[\w.-]+|operadora[\w.-]*|PJSIP\/([^/@]+)@trunk-[\w.-]+)/i);
  if (trunkMatch) return trunkMatch[1].startsWith("PJSIP/") ? trunkMatch[2] : trunkMatch[1];
  return /trunk|from-trunk|inbound/.test(String(call.dcontext || "").toLowerCase()) ? (config.outbound?.defaultTrunk || "trunk-operadora") : "";
}

function inferQueue(call, config) {
  const joined = `${call.dcontext || ""} ${call.lastapp || ""} ${call.lastdata || ""} ${call.userfield || ""}`;
  const queue = (config.queues || []).find((item) => new RegExp(`\\b${item.id}\\b`, "i").test(joined) || new RegExp(`\\b${item.name}\\b`, "i").test(joined));
  return queue?.id || "";
}

function inferDid(call, type) {
  if (call.did) return call.did;
  if (type !== "inbound") return "";
  const dst = String(call.dst || "");
  return dst && !/^s$/i.test(dst) ? dst : "";
}

function reportDestinationForType(raw, type, extension) {
  if (type === "inbound" && extension) return extension;
  return raw.dst;
}

function extractCallProtocol(value) {
  const text = String(value || "");
  return (
    (text.match(/(?:^|[;,|\s])protocol=([0-9]{8,})/i) || [])[1] ||
    (text.match(/\b(20\d{8})\b/) || [])[1] ||
    ""
  );
}

function inferRecordingName(call) {
  const values = [call.recordingfile, call.userfield, call.lastdata].filter(Boolean);
  for (const value of values) {
    const text = String(value);
    const found = text.split(/[|,;]/).find((part) => browserRecordingExtensions.has(path.extname(part.trim()).toLowerCase()));
    if (found) return path.basename(found.trim());
  }
  return "";
}

function mapCdrColumns(columns, index, config) {
  const isAsteriskCsv = hasLikelyCdrDate(columns[9]) && !hasLikelyCdrDate(columns[8]);
  const raw = isAsteriskCsv
    ? {
        id: "",
        calldate: columns[9] || "",
        callerid: columns[4] || "",
        src: columns[1] || "",
        dst: columns[2] || "",
        dcontext: columns[3] || "",
        channel: columns[5] || "",
        dstchannel: columns[6] || "",
        lastapp: columns[7] || "",
        lastdata: columns[8] || "",
        start: columns[9] || "",
        answer: columns[10] || "",
        end: columns[11] || "",
        duration: Number(columns[12] || 0),
        billsec: Number(columns[13] || 0),
        disposition: columns[14] || "",
        amaflags: columns[15] || "",
        accountcode: columns[0] || "",
        uniqueid: columns[16] || "",
        linkedid: columns[16] || "",
        peeraccount: "",
        recordingfile: "",
        trunk: "",
        did: "",
        queue: "",
        direction: "",
        userfield: columns[17] || "",
        sequence: columns[18] || "",
        dialstatus: "",
        hangupcause: ""
      }
    : {
        id: "",
        calldate: columns[8] || columns[0] || "",
        callerid: columns[0] || "",
        src: columns[1] || "",
        dst: columns[2] || "",
        dcontext: columns[3] || "",
        channel: columns[4] || "",
        dstchannel: columns[5] || "",
        lastapp: columns[6] || "",
        lastdata: columns[7] || "",
        start: columns[8] || "",
        answer: columns[9] || "",
        end: columns[10] || "",
        duration: Number(columns[11] || 0),
        billsec: Number(columns[12] || 0),
        disposition: columns[13] || "",
        amaflags: columns[14] || "",
        accountcode: columns[15] || "",
        uniqueid: columns[16] || "",
        linkedid: columns[16] || "",
        peeraccount: "",
        recordingfile: "",
        trunk: "",
        did: "",
        queue: "",
        direction: "",
        userfield: columns[17] || "",
        sequence: columns[18] || "",
        dialstatus: columns[26] || "",
        hangupcause: columns[27] || ""
      };

  if (!isAsteriskCsv && columns.length >= 25) {
    raw.linkedid = columns[17] || raw.linkedid;
    raw.peeraccount = columns[18] || "";
    raw.recordingfile = columns[19] || "";
    raw.trunk = columns[20] || "";
    raw.did = columns[21] || "";
    raw.queue = columns[22] || "";
    raw.userfield = columns[23] || raw.userfield;
    raw.sequence = columns[24] || raw.sequence;
    raw.direction = columns[25] || "";
  } else if (!isAsteriskCsv && columns.length >= 22) {
    raw.recordingfile = columns[18] || "";
    raw.trunk = columns[19] || "";
    raw.did = columns[20] || "";
    raw.queue = columns[21] || "";
    raw.userfield = columns[22] || raw.userfield;
  }

  const status = normalizeReportStatus(raw.disposition);
  const type = inferReportType(raw, config);
  const extension = inferReportExtension(raw, config, type);
  const protocol = extractCallProtocol(raw.userfield) || extractCallProtocol(raw.accountcode);
  const destination = reportDestinationForType(raw, type, extension);
  const extensionInfo = (config.extensions || []).find((item) => item.number === extension) || {};
  const started = parseFlexibleDate(raw.start || raw.calldate);
  const ended = parseFlexibleDate(raw.end);
  const duration = Number(raw.duration) || (started && ended ? Math.max(0, Math.round((ended.getTime() - started.getTime()) / 1000)) : 0);
  const billsec = Number(raw.billsec) || 0;
  const waitsec = Math.max(0, duration - billsec);
  const recordingFile = inferRecordingName(raw);
  const uniqueId = raw.uniqueid || `${raw.start || raw.calldate}-${index}`;

  return {
    id: uniqueId || String(index),
    calldate: raw.calldate,
    callerId: raw.callerid,
    src: raw.src,
    dst: raw.dst,
    source: raw.src,
    destination,
    originalDestination: raw.dst,
    context: raw.dcontext,
    dcontext: raw.dcontext,
    channel: raw.channel,
    destinationChannel: raw.dstchannel,
    dstchannel: raw.dstchannel,
    lastApp: raw.lastapp,
    lastapp: raw.lastapp,
    lastData: raw.lastdata,
    lastdata: raw.lastdata,
    startedAt: isoDateTime(raw.start || raw.calldate),
    answeredAt: isoDateTime(raw.answer),
    endedAt: isoDateTime(raw.end),
    duration,
    durationLabel: secondsToHuman(duration),
    billsec,
    billsecLabel: secondsToHuman(billsec),
    waitsec,
    waitsecLabel: secondsToHuman(waitsec),
    disposition: raw.disposition,
    status,
    statusLabel: reportStatusLabel(status),
    type,
    typeLabel: { inbound: "Entrada", outbound: "Saida", internal: "Interna" }[type] || type,
    amaflags: raw.amaflags,
    accountCode: raw.accountcode,
    uniqueId,
    linkedId: raw.linkedid || raw.uniqueid || "",
    peeraccount: raw.peeraccount,
    recordingFile,
    hasRecording: Boolean(recordingFile),
    recordingExists: false,
    recordingPlayable: Boolean(recordingFile),
    extension,
    extensionName: extensionInfo.name || "",
    department: extensionInfo.department || "",
    trunk: raw.trunk || inferTrunk(raw, config),
    did: raw.did || inferDid(raw, type),
    queue: raw.queue || inferQueue(raw, config),
    protocol,
    direction: raw.direction || type,
    dialstatus: raw.dialstatus || "",
    hangupcause: raw.hangupcause || "",
    userField: raw.userfield,
    sequence: raw.sequence,
    sipCallId: (String(raw.userfield || "").match(/sip-call-id=([^;,]+)/i) || [])[1] || "",
    technicalLogs: []
  };
}

function mapDbCdrRow(row, index, config) {
  return mapCdrColumns([
    row.callerid || "",
    row.src || "",
    row.dst || "",
    row.dcontext || "",
    row.channel || "",
    row.dstchannel || "",
    row.lastapp || "",
    row.lastdata || "",
    row.start_at || row.calldate || "",
    row.answer_at || "",
    row.end_at || "",
    row.duration || 0,
    row.billsec || 0,
    row.disposition || "",
    row.amaflags || "",
    row.accountcode || "",
    row.uniqueid || "",
    row.linkedid || row.uniqueid || "",
    row.peeraccount || "",
    row.recordingfile || "",
    row.trunk || "",
    row.did || "",
    row.queue || "",
    row.userfield || "",
    row.sequence || "",
    row.direction || "",
    row.dialstatus || "",
    row.hangupcause || ""
  ].map((value) => value?.toISOString?.() || value), index, config);
}

function reportCallTime(call, field = "startedAt") {
  return parseFlexibleDate(call[field])?.getTime() || 0;
}

function protocolNumberMatches(eventNumber, candidates = []) {
  const eventDigits = normalizeDigits(eventNumber);
  if (!eventDigits) return true;
  return candidates.some((value) => {
    const candidate = normalizeDigits(value);
    if (!candidate) return false;
    if (eventDigits.length <= 4 || candidate.length <= 4) return eventDigits === candidate;
    return eventDigits === candidate || eventDigits.endsWith(candidate) || candidate.endsWith(eventDigits);
  });
}

function protocolExtensionMatches(extension, call) {
  const number = normalizeDigits(extension);
  if (!number) return false;
  const values = [
    call.extension,
    call.source,
    call.destination,
    call.originalDestination,
    call.src,
    call.dst
  ].map(normalizeDigits);
  if (values.includes(number)) return true;
  return new RegExp(`(?:PJSIP|SIP|Local)/(?:web-)?${number}(?:[-/@]|\\b)|\\b${number}\\b`, "i").test(
    `${call.channel || ""} ${call.destinationChannel || call.dstchannel || ""} ${call.lastData || call.lastdata || ""}`
  );
}

function protocolDirectionKey(value) {
  const text = String(value || "").toLowerCase();
  if (["saida", "saída", "outbound"].includes(text)) return "outbound";
  if (["entrada", "inbound"].includes(text)) return "inbound";
  if (["interna", "internal"].includes(text)) return "internal";
  return text;
}

function protocolMatchScore(call, event) {
  if (call.protocol) return -1;
  const callTime = reportCallTime(call);
  const eventTime = parseFlexibleDate(event.createdAt)?.getTime() || 0;
  if (!callTime || !eventTime) return -1;
  const distance = Math.abs(callTime - eventTime);
  if (distance > 12 * 60 * 1000) return -1;
  const extensionMatch = protocolExtensionMatches(event.extension, call);
  if (!extensionMatch) return -1;
  const numberMatch = protocolNumberMatches(event.number, [
    call.source,
    call.destination,
    call.originalDestination,
    call.src,
    call.dst,
    call.callerId,
    call.lastData,
    call.lastdata
  ]);
  const directionMatch = !event.direction || !call.type || protocolDirectionKey(event.direction) === protocolDirectionKey(call.type);
  return 1000 + (numberMatch ? 500 : 0) + (directionMatch ? 80 : 0) - Math.round(distance / 1000);
}

async function attachCallProtocols(calls) {
  const events = (await readCallProtocolEvents()).filter((event) => event.protocol);
  if (!events.length) return calls;
  const used = new Set();
  [...calls]
    .sort((left, right) => reportCallTime(left) - reportCallTime(right))
    .forEach((call) => {
      if (call.protocol) return;
      let best = null;
      let bestScore = -1;
      events.forEach((event, index) => {
        if (used.has(index)) return;
        const score = protocolMatchScore(call, event);
        if (score > bestScore) {
          best = { event, index };
          bestScore = score;
        }
      });
      if (best && bestScore >= 1000) {
        call.protocol = best.event.protocol;
        used.add(best.index);
      }
    });
  return calls;
}

function extensionCallMatcher(extensionNumber) {
  const number = String(extensionNumber || "").replace(/[^\d]/g, "");
  const endpointPattern = new RegExp(`(?:PJSIP|SIP)/(?:web-)?${number}(?:[-/@]|\\b)`, "i");
  const context = `from-${number}`;
  return (call) => {
    if (!number) return false;
    const values = [
      call.extension,
      call.source,
      call.destination,
      call.originalDestination,
      call.src,
      call.dst
    ].map((value) => String(value || ""));
    if (values.includes(number)) return true;
    if (String(call.context || call.dcontext || "") === context) return true;
    return endpointPattern.test(`${call.channel || ""} ${call.destinationChannel || call.dstchannel || ""} ${call.lastData || call.lastdata || ""}`);
  };
}

function compactExtensionCall(call) {
  const dialedThroughTrunk = (String(call.lastData || "").match(/PJSIP\/([^@,\s]+)@([^,\s]+)/i) || []);
  const browserOrigin = /PJSIP\/web-/i.test(`${call.channel || ""} ${call.destinationChannel || ""}`);
  const customerNumber = call.type === "inbound"
    ? call.callerId || call.source || call.src || ""
    : dialedThroughTrunk[1] || call.destination || call.originalDestination || call.dst || "";
  return {
    id: call.id,
    protocol: call.protocol || "",
    startedAt: call.startedAt,
    callerId: call.callerId || "",
    customerNumber,
    source: call.source,
    destination: call.destination,
    originalDestination: call.originalDestination,
    type: call.type,
    typeLabel: call.typeLabel,
    status: call.status,
    statusLabel: call.statusLabel,
    disposition: call.disposition,
    durationLabel: call.durationLabel,
    billsecLabel: call.billsecLabel,
    trunk: call.trunk || dialedThroughTrunk[2] || "",
    trunkDialedNumber: dialedThroughTrunk[1] || "",
    dialstatus: call.dialstatus || "",
    hangupcause: call.hangupcause || "",
    lastApp: call.lastApp,
    lastData: call.lastData,
    channel: call.channel,
    destinationChannel: call.destinationChannel,
    originEndpoint: browserOrigin ? "Navegador" : "Ramal SIP"
  };
}

async function readRecentExtensionCalls(config, extensionNumber, limit = 50) {
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const calls = await readPbxReportCalls(config, { skipRecordingScan: true });
  return calls
    .filter(extensionCallMatcher(extensionNumber))
    .filter((call) => reportCallTime(call) >= since)
    .sort((left, right) => reportCallTime(right) - reportCallTime(left))
    .slice(0, limit)
    .map(compactExtensionCall);
}

function isTechnicalCdrLeg(call) {
  const lastApp = String(call.lastApp || call.lastapp || "").toLowerCase();
  const hasDestinationChannel = Boolean(call.destinationChannel || call.dstchannel);
  if (lastApp === "hangup" && !hasDestinationChannel) return true;
  return !hasDestinationChannel && Number(call.duration) <= 0 && Number(call.billsec) <= 0;
}

function reportCallGroupKey(call) {
  return String(call.linkedId || call.uniqueId || call.id || "");
}

function reportCallRank(call) {
  let rank = 0;
  if (!isTechnicalCdrLeg(call)) rank += 1000;
  if (call.status === "answered") rank += 300;
  if (Number(call.billsec) > 0) rank += 180;
  if (Number(call.duration) > 0) rank += 120;
  if (call.destinationChannel || call.dstchannel) rank += 90;
  if (call.lastApp === "Dial" || call.lastapp === "Dial") rank += 70;
  if (call.lastApp === "Queue" || call.lastapp === "Queue") rank += 70;
  if (call.trunk) rank += 40;
  if (call.recordingFile) rank += 30;
  if (call.queue) rank += 20;
  return rank;
}

function mergeReportCallLegs(primary, secondary) {
  const started = [primary.startedAt, secondary.startedAt].filter(Boolean).sort((left, right) => reportCallTime({ startedAt: left }) - reportCallTime({ startedAt: right }))[0];
  const ended = [primary.endedAt, secondary.endedAt].filter(Boolean).sort((left, right) => reportCallTime({ startedAt: right }) - reportCallTime({ startedAt: left }))[0];
  const duration = Math.max(Number(primary.duration) || 0, Number(secondary.duration) || 0);
  const billsec = Math.max(Number(primary.billsec) || 0, Number(secondary.billsec) || 0);
  const waitsec = Math.max(0, duration - billsec);
  const extension = primary.extension || secondary.extension;
  const destination = primary.type === "inbound" && extension ? extension : (primary.destination || secondary.destination);

  return {
    ...primary,
    startedAt: started || primary.startedAt,
    endedAt: ended || primary.endedAt,
    destination,
    duration,
    durationLabel: secondsToHuman(duration),
    billsec,
    billsecLabel: secondsToHuman(billsec),
    waitsec,
    waitsecLabel: secondsToHuman(waitsec),
    answeredAt: primary.answeredAt || secondary.answeredAt,
    recordingFile: primary.recordingFile || secondary.recordingFile,
    hasRecording: Boolean(primary.recordingFile || secondary.recordingFile || primary.hasRecording || secondary.hasRecording),
    recordingPlayable: Boolean(primary.recordingPlayable || secondary.recordingPlayable),
    trunk: primary.trunk || secondary.trunk,
    did: primary.did || secondary.did,
    queue: primary.queue || secondary.queue,
    extension,
    extensionName: primary.extensionName || secondary.extensionName,
    department: primary.department || secondary.department,
    userField: primary.userField || secondary.userField,
    protocol: primary.protocol || secondary.protocol,
    sequence: primary.sequence || secondary.sequence,
    technicalLogs: [...(primary.technicalLogs || []), ...(secondary.technicalLogs || [])]
  };
}

function collapseReportCallLegs(calls) {
  const groups = new Map();

  calls.forEach((call) => {
    const key = reportCallGroupKey(call);
    if (!key) {
      groups.set(`single:${call.id}`, [call]);
      return;
    }
    const group = groups.get(key) || [];
    group.push(call);
    groups.set(key, group);
  });

  return [...groups.values()].map((group) => {
    if (group.length === 1) return group[0];

    const ranked = [...group].sort((left, right) => {
      const rankDiff = reportCallRank(right) - reportCallRank(left);
      if (rankDiff) return rankDiff;
      return reportCallTime(right) - reportCallTime(left);
    });

    return ranked.slice(1).reduce((primary, leg) => mergeReportCallLegs(primary, leg), ranked[0]);
  });
}

async function readPbxReportCallsFresh(config) {
  const databaseRows = await getReportCdrRows();
  if (databaseRows.length) {
    const calls = collapseReportCallLegs(databaseRows.map((row, index) => mapDbCdrRow(row, index, config)));
    await attachCallProtocols(calls);
    return calls;
  }

  const cdrPaths = await findCdrPaths();
  if (!cdrPaths.length) return [];

  const mappedCalls = [];
  for (const cdrPath of cdrPaths) {
    const raw = await fs.readFile(cdrPath, "utf8");
    const baseIndex = mappedCalls.length;
    raw
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .forEach((line, index) => {
        const columns = parseCsvLine(line);
        mappedCalls.push(mapCdrColumns(columns, baseIndex + index, config));
      });
  }
  const calls = collapseReportCallLegs(mappedCalls);
  await attachCallProtocols(calls);
  return calls;
}

async function readPbxReportCalls(config, options = {}) {
  const revision = configRevision(config);
  const now = Date.now();
  if (reportCallsCache.revision !== revision || reportCallsCache.expiresAt <= now) {
    if (!reportCallsCache.pending || reportCallsCache.revision !== revision) {
      const pending = readPbxReportCallsFresh(config);
      reportCallsCache = { revision, expiresAt: 0, value: null, pending };
      pending.then((value) => {
        if (reportCallsCache.pending === pending) reportCallsCache = { revision, expiresAt: Date.now() + 2000, value, pending: null };
      }).catch(() => {
        if (reportCallsCache.pending === pending) reportCallsCache = { revision: "", expiresAt: 0, value: null, pending: null };
      });
    }
  }
  const baseCalls = reportCallsCache.pending ? await reportCallsCache.pending : reportCallsCache.value || [];
  const calls = structuredClone(baseCalls);
  if (!options.skipRecordingScan) {
    const recordingIndex = await buildRecordingIndex(config);
    calls.forEach((call) => attachRecordingState(call, recordingIndex));
  }
  return calls;
}

async function buildRecordingIndexFresh(config) {
  const roots = [
    process.env.ASTERISK_RECORDING_PATH,
    config.recording?.path,
    "/var/spool/asterisk/monitor"
  ].filter(Boolean);
  const files = [];

  async function walk(directory, depth = 0) {
    if (depth > 4 || !(await fs.pathExists(directory))) return;
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(fullPath, depth + 1);
      const extension = path.extname(entry.name).toLowerCase();
      if (browserRecordingExtensions.has(extension)) files.push({ name: entry.name, path: fullPath, extension });
    }));
  }

  for (const root of [...new Set(roots)]) await walk(root);
  return files;
}

async function buildRecordingIndex(config) {
  const key = JSON.stringify([process.env.ASTERISK_RECORDING_PATH || "", config.recording?.path || ""]);
  const now = Date.now();
  if (recordingIndexCache.key === key) {
    if (recordingIndexCache.pending) return recordingIndexCache.pending;
    if (recordingIndexCache.value && recordingIndexCache.expiresAt > now) return recordingIndexCache.value;
  }
  const pending = buildRecordingIndexFresh(config);
  recordingIndexCache = { key, expiresAt: 0, value: null, pending };
  try {
    const value = await pending;
    if (recordingIndexCache.pending === pending) recordingIndexCache = { key, expiresAt: Date.now() + 5000, value, pending: null };
    return value;
  } catch (error) {
    if (recordingIndexCache.pending === pending) recordingIndexCache = { key: "", expiresAt: 0, value: null, pending: null };
    throw error;
  }
}

function attachRecordingState(call, recordingIndex) {
  const recordingFile = call.recordingFile ? path.basename(call.recordingFile) : "";
  const started = parseFlexibleDate(call.startedAt);
  const stamp = started
    ? `${started.getFullYear()}${String(started.getMonth() + 1).padStart(2, "0")}${String(started.getDate()).padStart(2, "0")}-${String(started.getHours()).padStart(2, "0")}${String(started.getMinutes()).padStart(2, "0")}`
    : "";
  const candidates = recordingIndex.filter((file) => {
    const name = file.name;
    if (recordingFile && name === recordingFile) return true;
    if (call.uniqueId && name.includes(call.uniqueId)) return true;
    if (stamp && name.includes(stamp) && call.source && name.includes(String(call.source)) && call.destination && name.includes(String(call.destination))) return true;
    if (stamp && name.includes(stamp) && call.extension && name.includes(String(call.extension))) return true;
    return false;
  });
  const found = candidates[0];
  call.recordingExists = Boolean(found);
  call.hasRecording = Boolean(found || recordingFile);
  call.recordingPlayable = Boolean(found && browserRecordingExtensions.has(found.extension));
  call.recordingFile = recordingFile || found?.name || "";
  call.recordingPath = found?.path || "";
  return call;
}

function userReportScope(req, config) {
  const user = req.session?.user || {};
  const role = user.role || (user.username === "admin" ? "admin" : "user");
  if (role === "admin") return { role, all: true, canListen: true, canDownload: true };
  if (role === "supervisor") {
    return {
      role,
      all: false,
      departments: user.departments || [],
      extensions: user.allowedExtensions || [],
      canListen: user.permissions?.listenRecordings !== false,
      canDownload: Boolean(user.permissions?.downloadRecordings)
    };
  }
  const ownExtension = user.extension || (config.extensions || []).find((extension) => extension.name === user.username)?.number || user.username;
  return {
    role,
    all: false,
    extensions: [ownExtension].filter(Boolean),
    departments: [],
    canListen: Boolean(user.permissions?.listenRecordings),
    canDownload: Boolean(user.permissions?.downloadRecordings)
  };
}

function userCanInterveneLiveCalls(req) {
  return userRole(req) === "admin" || Boolean(req.session?.user?.permissions?.interveneCalls);
}

function userCanMonitorExtension(req, config, extensionNumber) {
  const scope = userReportScope(req, config);
  if (scope.all) return true;
  const target = String(extensionNumber || "");
  const extension = (config.extensions || []).find((item) => String(item.number) === target);
  if (!extension) return false;
  if ((scope.extensions || []).map(String).includes(target)) return true;
  return (scope.departments || []).map(String).includes(String(extension.department || ""));
}

function allowedExtensionNumbers(config, scope) {
  if (scope.all) return new Set((config.extensions || []).map((extension) => String(extension.number)));
  const explicit = new Set((scope.extensions || []).map(String));
  const departments = new Set((scope.departments || []).map(String));
  return new Set((config.extensions || [])
    .filter((extension) => explicit.has(String(extension.number)) || departments.has(String(extension.department || "")))
    .map((extension) => String(extension.number)));
}

function configForReportScope(config, scope) {
  const allowed = allowedExtensionNumbers(config, scope);
  if (scope.all) return config;
  return { ...config, extensions: (config.extensions || []).filter((extension) => allowed.has(String(extension.number))) };
}

function pbxStatusForScope(status, config, scope) {
  if (scope.all) return status;
  const allowed = allowedExtensionNumbers(config, scope);
  const matchesAllowedExtension = (channel) => {
    const joined = [channel.channel, channel.extension, channel.callerId, channel.data].join(" ");
    return [...allowed].some((number) => new RegExp(`(?:PJSIP|SIP|Local)/(?:web-)?${number}(?:[-/@]|\\b)|\\b${number}\\b`, "i").test(joined));
  };
  const queues = (status.queues || [])
    .map((queue) => ({ ...queue, agents: (queue.agents || []).filter((agent) => allowed.has(String(agent.number))) }))
    .filter((queue) => queue.agents.length);
  return {
    ...status,
    extensions: (status.extensions || []).filter((extension) => allowed.has(String(extension.number))),
    queues,
    waitingCalls: queues.flatMap((queue) => (queue.waiting || []).map((call) => ({ ...call, queueName: queue.name }))),
    activeChannels: (status.activeChannels || []).filter(matchesAllowedExtension),
    trunk: null,
    logs: []
  };
}

function applyReportScope(calls, scope) {
  if (scope.all) return calls;
  const extensions = new Set((scope.extensions || []).map(String));
  const departments = new Set((scope.departments || []).map(String));
  return calls.filter((call) => {
    if (extensions.has(String(call.extension)) || extensions.has(String(call.source)) || extensions.has(String(call.destination))) return true;
    if (call.department && departments.has(String(call.department))) return true;
    return false;
  });
}

function recordingNamePart(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function recordingDownloadName(call = {}) {
  const started = parseFlexibleDate(call.startedAt);
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = started
    ? `${started.getFullYear()}-${pad(started.getMonth() + 1)}-${pad(started.getDate())}_${pad(started.getHours())}-${pad(started.getMinutes())}-${pad(started.getSeconds())}`
    : "sem-data";
  const type = { inbound: "entrada", outbound: "saida", internal: "interna" }[call.type] || "chamada";
  const party = call.type === "inbound"
    ? call.source || call.callerId || call.destination
    : call.type === "outbound"
      ? call.destination || call.callerId || call.source
      : call.destination || call.source || call.callerId;
  const extension = recordingNamePart(call.extension);
  const number = recordingNamePart(party);
  const uniqueId = recordingNamePart(call.uniqueId || call.id);
  const fileExtension = path.extname(call.recordingPath || call.recordingFile || "").toLowerCase() || ".wav";
  return [stamp, type, extension ? `ramal-${extension}` : "", number ? `numero-${number}` : "", uniqueId ? `id-${uniqueId}` : ""]
    .filter(Boolean)
    .join("_")
    .slice(0, 180) + fileExtension;
}

function parseReportFilters(query) {
  return {
    dateStart: String(query.dateStart || query.startDate || ""),
    dateEnd: String(query.dateEnd || query.endDate || ""),
    timeStart: String(query.timeStart || ""),
    timeEnd: String(query.timeEnd || ""),
    source: String(query.source || query.src || ""),
    destination: String(query.destination || query.dst || ""),
    number: String(query.number || ""),
    extension: String(query.extension || ""),
    extensionName: String(query.extensionName || ""),
    type: String(query.type || ""),
    status: String(query.status || ""),
    trunk: String(query.trunk || ""),
    queue: String(query.queue || ""),
    did: String(query.did || ""),
    minDuration: query.minDuration === undefined ? "" : String(query.minDuration),
    maxDuration: query.maxDuration === undefined ? "" : String(query.maxDuration),
    recording: String(query.recording || ""),
    protocol: String(query.protocol || ""),
    uniqueId: String(query.uniqueId || ""),
    callerId: String(query.callerId || ""),
    department: String(query.department || ""),
    q: String(query.q || query.search || "")
  };
}

function includesText(value, needle) {
  if (!needle) return true;
  return String(value || "").toLowerCase().includes(String(needle).toLowerCase());
}

function applyReportFilters(calls, filters) {
  const dateStart = filters.dateStart ? new Date(`${filters.dateStart}T00:00:00`) : null;
  const dateEnd = filters.dateEnd ? new Date(`${filters.dateEnd}T23:59:59`) : null;
  const minDuration = filters.minDuration !== "" ? Number(filters.minDuration) : null;
  const maxDuration = filters.maxDuration !== "" ? Number(filters.maxDuration) : null;
  const general = filters.q.trim().toLowerCase();

  return calls.filter((call) => {
    const started = parseFlexibleDate(call.startedAt);
    if (dateStart && (!started || started < dateStart)) return false;
    if (dateEnd && (!started || started > dateEnd)) return false;
    if (filters.timeStart || filters.timeEnd) {
      const time = started ? `${String(started.getHours()).padStart(2, "0")}:${String(started.getMinutes()).padStart(2, "0")}` : "";
      if (filters.timeStart && time < filters.timeStart) return false;
      if (filters.timeEnd && time > filters.timeEnd) return false;
    }
    if (!includesText(call.source, filters.source)) return false;
    if (!includesText(call.destination, filters.destination)) return false;
    if (filters.number && ![call.source, call.destination, call.callerId, call.did].some((value) => includesText(value, filters.number))) return false;
    if (!includesText(call.extension, filters.extension)) return false;
    if (!includesText(call.extensionName, filters.extensionName)) return false;
    if (filters.type && call.type !== filters.type) return false;
    if (filters.status && call.status !== filters.status) return false;
    if (!includesText(call.trunk, filters.trunk)) return false;
    if (!includesText(call.queue, filters.queue)) return false;
    if (!includesText(call.did, filters.did)) return false;
    if (minDuration !== null && call.duration < minDuration) return false;
    if (maxDuration !== null && call.duration > maxDuration) return false;
    if (filters.recording === "with" && !call.recordingExists) return false;
    if (filters.recording === "without" && call.recordingExists) return false;
    if (!includesText(call.protocol, filters.protocol)) return false;
    if (!includesText(call.uniqueId, filters.uniqueId)) return false;
    if (!includesText(call.callerId, filters.callerId)) return false;
    if (!includesText(call.department, filters.department)) return false;
    if (general) {
      const haystack = [
        call.startedAt,
        call.source,
        call.destination,
        call.extension,
        call.extensionName,
        call.typeLabel,
        call.statusLabel,
        call.trunk,
        call.queue,
        call.did,
        call.callerId,
        call.protocol,
        call.uniqueId,
        call.linkedId,
        call.userField
      ].join(" ").toLowerCase();
      if (!haystack.includes(general)) return false;
    }
    return true;
  });
}

function reportPeriodBounds(filters = {}) {
  const start = filters.dateStart ? new Date(`${filters.dateStart}T${filters.timeStart || "00:00"}:00`) : new Date(new Date().toLocaleDateString("en-CA") + "T00:00:00");
  const end = filters.dateEnd ? new Date(`${filters.dateEnd}T${filters.timeEnd || "23:59"}:59`) : new Date(new Date().toLocaleDateString("en-CA") + "T23:59:59");
  return {
    start: Number.isNaN(start.getTime()) ? new Date(new Date().toLocaleDateString("en-CA") + "T00:00:00") : start,
    end: Number.isNaN(end.getTime()) ? new Date() : end
  };
}

function overlapSeconds(startMs, endMs, periodStartMs, periodEndMs) {
  const from = Math.max(startMs, periodStartMs);
  const to = Math.min(endMs, periodEndMs);
  return Math.max(0, Math.round((to - from) / 1000));
}

async function presenceSummaryForFilters(config, filters = {}) {
  const history = await readPresenceHistory();
  const { start, end } = reportPeriodBounds(filters);
  const now = Date.now();
  const periodStartMs = start.getTime();
  const periodEndMs = Math.min(end.getTime(), now);
  const events = (history.events || [])
    .map((event) => ({ ...event, atMs: parseFlexibleDate(event.at)?.getTime() || 0 }))
    .filter((event) => event.extension && event.atMs && event.atMs <= periodEndMs)
    .sort((left, right) => left.atMs - right.atMs);

  return (config.extensions || []).map((extension) => {
    const number = String(extension.number || "");
    const extensionEvents = events.filter((event) => String(event.extension) === number);
    let online = false;
    let startedAt = null;
    let totalSeconds = 0;

    extensionEvents.forEach((event) => {
      if (event.atMs < periodStartMs) {
        online = Boolean(event.registered);
        startedAt = online ? periodStartMs : null;
        return;
      }

      if (event.registered) {
        if (!online) startedAt = event.atMs;
        online = true;
        return;
      }

      if (online && startedAt !== null) totalSeconds += overlapSeconds(startedAt, event.atMs, periodStartMs, periodEndMs);
      online = false;
      startedAt = null;
    });

    const currentOnlineSince = extensionPresence.get(number);
    if (currentOnlineSince && currentOnlineSince <= periodEndMs) {
      online = true;
      startedAt = startedAt ?? Math.max(currentOnlineSince, periodStartMs);
    }
    if (currentOnlineSince && online && startedAt !== null) totalSeconds += overlapSeconds(startedAt, periodEndMs, periodStartMs, periodEndMs);

    return {
      number,
      name: extension.name || "",
      department: extension.department || "",
      onlineSeconds: totalSeconds,
      onlineDurationLabel: secondsToHuman(totalSeconds),
      currentOnline: extensionPresence.has(number),
      periodStart: start.toISOString(),
      periodEnd: end.toISOString()
    };
  });
}

async function pauseSummaryForFilters(config, filters = {}) {
  const history = await readExtensionPauseHistory();
  const active = await readExtensionPauses();
  const { start, end } = reportPeriodBounds(filters);
  const periodStartMs = start.getTime();
  const periodEndMs = Math.min(end.getTime(), Date.now());
  const extensionByNumber = new Map((config.extensions || []).map((extension) => [String(extension.number), extension]));
  const closedEvents = (history.events || []).map((event) => ({ ...event, active: false }));
  const activeEvents = Object.entries(active || {})
    .filter(([, event]) => event?.paused)
    .map(([extension, event]) => ({
      id: event.pauseId || `active-${extension}`,
      extension,
      reason: event.reason || "Pausa",
      startedAt: event.startedAt || new Date().toISOString(),
      endedAt: "",
      durationSeconds: Math.max(0, Math.round((Date.now() - (parseFlexibleDate(event.startedAt)?.getTime() || Date.now())) / 1000)),
      active: true
    }));

  const events = [...closedEvents, ...activeEvents]
    .map((event) => {
      const started = parseFlexibleDate(event.startedAt);
      const ended = event.endedAt ? parseFlexibleDate(event.endedAt) : new Date();
      const durationSeconds = Number(event.durationSeconds) || Math.max(0, Math.round(((ended?.getTime() || Date.now()) - (started?.getTime() || Date.now())) / 1000));
      const extension = extensionByNumber.get(String(event.extension)) || {};
      return {
        ...event,
        startedAt: started ? started.toISOString() : event.startedAt,
        endedAt: event.active ? "" : ended?.toISOString() || event.endedAt,
        durationSeconds,
        durationLabel: secondsToHuman(durationSeconds),
        extensionName: extension.name || "",
        department: extension.department || ""
      };
    })
    .filter((event) => {
      const startedMs = parseFlexibleDate(event.startedAt)?.getTime() || 0;
      const endedMs = event.endedAt ? parseFlexibleDate(event.endedAt)?.getTime() || startedMs : Date.now();
      if (!startedMs) return false;
      if (endedMs < periodStartMs || startedMs > periodEndMs) return false;
      if (filters.extension && !includesText(event.extension, filters.extension)) return false;
      if (filters.department && !includesText(event.department, filters.department)) return false;
      return true;
    })
    .sort((left, right) => (parseFlexibleDate(right.startedAt)?.getTime() || 0) - (parseFlexibleDate(left.startedAt)?.getTime() || 0));

  const summaryMap = events.reduce((acc, event) => {
    const key = String(event.extension || "");
    const current = acc.get(key) || {
      extension: key,
      extensionName: event.extensionName || "",
      department: event.department || "",
      count: 0,
      totalSeconds: 0,
      reasons: {}
    };
    current.count += 1;
    current.totalSeconds += Number(event.durationSeconds) || 0;
    current.reasons[event.reason || "Pausa"] = (current.reasons[event.reason || "Pausa"] || 0) + 1;
    acc.set(key, current);
    return acc;
  }, new Map());

  const summary = [...summaryMap.values()].map((item) => ({
    ...item,
    totalLabel: secondsToHuman(item.totalSeconds),
    reasonList: Object.entries(item.reasons).map(([reason, count]) => `${reason}: ${count}`).join(", ")
  }));

  return { summary, events };
}

function sortReportCalls(calls, sortBy = "startedAt", sortDir = "desc") {
  const direction = sortDir === "asc" ? 1 : -1;
  return [...calls].sort((left, right) => {
    const a = left[sortBy] ?? "";
    const b = right[sortBy] ?? "";
    if (["duration", "billsec", "waitsec"].includes(sortBy)) return (Number(a) - Number(b)) * direction;
    if (sortBy === "startedAt") return ((parseFlexibleDate(a)?.getTime() || 0) - (parseFlexibleDate(b)?.getTime() || 0)) * direction;
    return String(a).localeCompare(String(b), "pt-BR") * direction;
  });
}

function groupCount(calls, keyGetter, limit = 10) {
  const groups = new Map();
  calls.forEach((call) => {
    const key = keyGetter(call) || "Nao informado";
    const current = groups.get(key) || { label: key, value: 0, duration: 0, billsec: 0 };
    current.value += 1;
    current.duration += Number(call.duration) || 0;
    current.billsec += Number(call.billsec) || 0;
    groups.set(key, current);
  });
  return [...groups.values()].sort((left, right) => right.value - left.value).slice(0, limit);
}

function buildDashboard(calls) {
  const answered = calls.filter((call) => call.status === "answered");
  const totalDuration = calls.reduce((sum, call) => sum + call.duration, 0);
  const totalBillsec = calls.reduce((sum, call) => sum + call.billsec, 0);
  return {
    total: calls.length,
    answered: answered.length,
    noAnswer: calls.filter((call) => call.status === "no_answer").length,
    missed: calls.filter((call) => ["no_answer", "failed", "canceled"].includes(call.status)).length,
    busy: calls.filter((call) => call.status === "busy").length,
    rejected: calls.filter((call) => call.status === "rejected").length,
    inbound: calls.filter((call) => call.type === "inbound").length,
    outbound: calls.filter((call) => call.type === "outbound").length,
    internal: calls.filter((call) => call.type === "internal").length,
    averageAnswerTime: answered.length ? Math.round(answered.reduce((sum, call) => sum + call.waitsec, 0) / answered.length) : 0,
    averageCallTime: calls.length ? Math.round(totalDuration / calls.length) : 0,
    totalDuration,
    totalBillsec,
    recordings: calls.filter((call) => call.recordingExists).length,
    topExtensions: groupCount(calls, (call) => call.extension ? `${call.extension} ${call.extensionName || ""}`.trim() : ""),
    topTrunks: groupCount(calls, (call) => call.trunk),
    peakHours: groupCount(calls, (call) => {
      const started = parseFlexibleDate(call.startedAt);
      return started ? `${String(started.getHours()).padStart(2, "0")}:00` : "";
    }, 6),
    generatedAt: new Date().toISOString()
  };
}

function buildChartData(calls) {
  return {
    byDay: groupCount(calls, (call) => String(call.startedAt || "").slice(0, 10), 60).sort((a, b) => a.label.localeCompare(b.label)),
    byHour: groupCount(calls, (call) => {
      const started = parseFlexibleDate(call.startedAt);
      return started ? `${String(started.getHours()).padStart(2, "0")}:00` : "";
    }, 24).sort((a, b) => a.label.localeCompare(b.label)),
    byExtension: groupCount(calls, (call) => call.extension ? `${call.extension} ${call.extensionName || ""}`.trim() : ""),
    byStatus: groupCount(calls, (call) => call.statusLabel),
    byTrunk: groupCount(calls, (call) => call.trunk),
    byType: groupCount(calls, (call) => call.typeLabel),
    averageDurationByDay: groupCount(calls, (call) => String(call.startedAt || "").slice(0, 10), 60)
      .map((item) => ({ label: item.label, value: item.value ? Math.round(item.duration / item.value) : 0 }))
      .sort((a, b) => a.label.localeCompare(b.label))
  };
}

function callExportRows(calls) {
  return calls.map((call) => ({
    Protocolo: call.protocol || "",
    "Data e hora": call.startedAt,
    Origem: call.source,
    Destino: call.destination,
    Ramal: call.extension,
    "Nome do ramal": call.extensionName,
    Tipo: call.typeLabel,
    Status: call.statusLabel,
    "Duracao total": call.durationLabel,
    "Tempo conversa": call.billsecLabel,
    "Tempo espera": call.waitsecLabel,
    "Tronco SIP": call.trunk,
    Fila: call.queue,
    DID: call.did,
    "Caller ID": call.callerId,
    "Unique ID": call.uniqueId,
    Gravacao: call.recordingExists ? "Disponivel" : "Sem gravacao"
  }));
}

function csvEscape(value) {
  let text = String(value ?? "");
  if (/^[\t\r]/.test(text) || /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
  return /[",\n;]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function rowsToCsv(rows) {
  const headers = Object.keys(rows[0] || {});
  return [
    headers.map(csvEscape).join(";"),
    ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(";"))
  ].join("\n");
}

function rowsToExcelXml(rows) {
  const headers = Object.keys(rows[0] || {});
  const xmlEscape = (value) => String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  const body = [
    `<Row>${headers.map((header) => `<Cell><Data ss:Type="String">${xmlEscape(header)}</Data></Cell>`).join("")}</Row>`,
    ...rows.map((row) => `<Row>${headers.map((header) => `<Cell><Data ss:Type="String">${xmlEscape(row[header])}</Data></Cell>`).join("")}</Row>`)
  ].join("");
  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
  <Worksheet ss:Name="Relatorios PBX"><Table>${body}</Table></Worksheet>
</Workbook>`;
}

function pdfEscape(value) {
  return String(value ?? "").replace(/[\\()]/g, "\\$&").replace(/\r?\n/g, " ");
}

function buildSimplePdf({ title, subtitle, lines }) {
  const contentLines = [
    "BT",
    "/F1 18 Tf",
    `50 790 Td (${pdfEscape(title)}) Tj`,
    "/F1 10 Tf",
    `0 -18 Td (${pdfEscape(subtitle)}) Tj`,
    ...lines.slice(0, 46).map((line) => `0 -14 Td (${pdfEscape(line).slice(0, 120)}) Tj`),
    "ET"
  ].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(contentLines)} >>\nstream\n${contentLines}\nendstream`
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return Buffer.from(pdf, "binary");
}

async function writeAuditEvent(req, call, action) {
  await writeRecordingAuditEvent({
    user: req.session?.user?.username || "",
    role: req.session?.user?.role || "",
    action,
    callId: call.id,
    uniqueId: call.uniqueId,
    source: call.source,
    destination: call.destination,
    ip: req.ip
  });
}

function auditUser(req) {
  return {
    user: req.session?.user?.username || req.session?.extension?.number || "",
    role: req.session?.user?.role || (req.session?.extension ? "extension" : ""),
    ip: req.ip
  };
}

function auditDiff(before, after, keys = []) {
  const allKeys = keys.length ? keys : [...new Set([...Object.keys(before || {}), ...Object.keys(after || {})])];
  return allKeys
    .filter((key) => JSON.stringify(before?.[key] ?? null) !== JSON.stringify(after?.[key] ?? null))
    .map((key) => ({
      field: key,
      before: sanitizeAuditValue(before?.[key] ?? null),
      after: sanitizeAuditValue(after?.[key] ?? null)
    }));
}

function sanitizeAuditValue(value, key = "") {
  if (/(password|secret|token|authorization|defaultpin)/i.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => sanitizeAuditValue(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitizeAuditValue(childValue, childKey)]));
  }
  return value;
}

async function writeSystemAuditEvent(req, action, payload = {}) {
  await writeRecordingAuditEvent({
    ...auditUser(req),
    action,
    label: payload.label || action,
    summary: payload.summary || "",
    details: payload.details || "",
    sections: payload.sections || [],
    before: sanitizeAuditValue(payload.before ?? null),
    after: sanitizeAuditValue(payload.after ?? null),
    changes: sanitizeAuditValue(payload.changes || []),
    target: payload.target || "",
    channel: payload.channel || "",
    file: payload.file || "",
    playback: payload.playback || "",
    clearedReferences: payload.clearedReferences || [],
    output: payload.output || "",
    at: new Date().toISOString()
  });
}

function activeChannelForMonitor(status, extensionNumber, channelName = "") {
  const cleanChannel = String(channelName || "").trim();
  if (cleanChannel) {
    const direct = (status.activeChannels || []).find((channel) => channel.channel === cleanChannel || channel.bridgedTo === cleanChannel);
    if (direct) return direct;
  }
  const number = String(extensionNumber || "").replace(/[^\d]/g, "");
  if (!number) return cleanChannel ? { channel: cleanChannel } : null;
  return (status.activeChannels || []).find((channel) => {
    const joined = [channel.channel, channel.bridgedTo, channel.extension, channel.callerId, channel.data].join(" ");
    return new RegExp(`(?:PJSIP|SIP|Local)/(?:web-)?${number}(?:[-/@]|\\b)|\\b${number}\\b`, "i").test(joined);
  }) || (cleanChannel ? { channel: cleanChannel } : null);
}

function spyEndpointForMonitor(status, extensionNumber) {
  const channel = activeChannelForMonitor(status, extensionNumber, "");
  const endpoint = String(channel?.channel || "").match(/(?:PJSIP|SIP)\/((?:web-)?\d+)(?:[-/@]|\b)/i);
  return endpoint?.[1] || String(extensionNumber || "").replace(/[^\d]/g, "");
}

function asteriskCommandFailed(output = "") {
  return /not a known channel|unable to create channel|no such channel|no such application|not registered|invalid|failed|falha|erro|indisponivel/i.test(String(output || ""));
}

function activeChannelsForMonitor(status, extensionNumber, channelName = "") {
  const primary = activeChannelForMonitor(status, extensionNumber, channelName);
  if (!primary?.channel) return [];
  const relatedIds = new Set([primary.uniqueId, primary.linkedId].filter(Boolean));
  const number = String(extensionNumber || "").replace(/[^\d]/g, "");
  const numberPattern = number ? new RegExp(`(?:PJSIP|SIP|Local)/(?:web-)?${number}(?:[-/@]|\\b)|\\b${number}\\b`, "i") : null;
  return (status.activeChannels || [])
    .filter((channel) => {
      if (channel.channel === primary.channel) return true;
      if (relatedIds.has(channel.uniqueId) || relatedIds.has(channel.linkedId)) return true;
      const joined = [channel.channel, channel.extension, channel.callerId, channel.data].join(" ");
      return numberPattern ? numberPattern.test(joined) : false;
    })
    .filter((channel, index, list) => channel.channel && list.findIndex((item) => item.channel === channel.channel) === index);
}

function channelsOwnedByExtension(status, config, extensionNumber) {
  const target = String(extensionNumber || "");
  const configured = extensionNumbers(config);
  const direct = (status.activeChannels || []).filter((channel) => activeChannelExtensionCandidates(channel, configured).includes(target));
  const relatedIds = new Set(direct.flatMap((channel) => [channel.uniqueId, channel.linkedId]).filter(Boolean));
  return (status.activeChannels || [])
    .filter((channel) => direct.includes(channel) || relatedIds.has(channel.uniqueId) || relatedIds.has(channel.linkedId))
    .filter((channel, index, list) => channel.channel && list.findIndex((item) => item.channel === channel.channel) === index);
}

function ownedChannelForRequest(status, config, extensionNumber, requestedChannel = "") {
  const owned = channelsOwnedByExtension(status, config, extensionNumber);
  const requested = String(requestedChannel || "").trim();
  if (!requested) return owned[0] || null;
  return owned.find((channel) => channel.channel === requested) || null;
}

async function reportDataForRequest(req, { includeRecordings = true } = {}) {
  const config = await getConfig();
  const scope = userReportScope(req, config);
  const filters = parseReportFilters(req.query || {});
  const calls = await readPbxReportCalls(config, { skipRecordingScan: !includeRecordings });
  const scoped = applyReportScope(calls, scope);
  const filtered = applyReportFilters(scoped, filters);
  return { config, scope, filters, calls: filtered };
}

async function readInboundCallLogs(config, scope) {
  const [calls, rawMessages] = await Promise.all([
    readReports(config),
    readLogTail(process.env.ASTERISK_MESSAGES_LOG || "/var/log/asterisk/messages.log", 500)
  ]);

  const inboundCdr = applyReportScope(calls, scope).filter((call) => call.type === "inbound" || /inbound|ivr-main|ringgroup|support/.test(call.context || ""));
  const rejected = rawMessages
    .split("\n")
    .filter((line) => /trunk-operadora: Call|inbound-trunk|extension 's' rejected|rejected because extension not found/i.test(line))
    .slice(-120)
    .reverse()
    .map((line) => {
      const match = line.match(/^\[([^\]]+)\]\s+\S+\[\d+\]\s+([^:]+):\s+(.*)$/);
      const message = match ? match[3] : line;
      const source = (message.match(/UDP:([^:)]+)/) || [])[1] || "";
      const destination = (message.match(/extension '([^']+)'/) || [])[1] || "";
      return {
        time: match ? match[1] : "",
        source,
        destination,
        status: /rejected/i.test(message) ? "REJEITADA" : "INFO",
        message
      };
    });

  return { cdr: inboundCdr, rejected: scope.all ? rejected : [] };
}

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function localAreaCode(config) {
  const configured = normalizeDigits(config.outbound?.areaCode || "");
  if (configured) return configured;
  return normalizeDigits(config.trunk?.mainNumber || "").slice(0, 2);
}

function localOutboundPrefix(config) {
  const nationalPrefix = normalizeDigits(config.outbound?.nationalPrefix || "");
  const areaCode = localAreaCode(config);
  return `${nationalPrefix}${areaCode}`;
}

function nationalPrefix(config) {
  return normalizeDigits(config.outbound?.nationalPrefix || "");
}

function previewOutboundDial(config, extensionNumber, rawNumber) {
  const dialed = normalizeDigits(rawNumber);
  const extension = (config.extensions || []).find((ext) => ext.number === extensionNumber) || config.extensions[0];
  const internal = (config.extensions || []).find((ext) => String(ext.number) === dialed);
  const queue = (config.queues || []).find((item, index) => String(item.number || item.extension || 600 + index) === dialed);
  const permissions = extension?.permissions || [];
  const areaCode = localAreaCode(config);
  let matchedRule = "";
  let matchedPattern = "";
  let normalized = dialed;

  if (internal) {
    return {
      extension: extension?.number || extensionNumber || "",
      dialed,
      matchedRule: "internal",
      matchedPattern: internal.number,
      normalized: dialed,
      permitted: true,
      targetType: "internal",
      targetLabel: internal.name || internal.number,
      dialString: `Ramal ${internal.number}`
    };
  }

  if (queue) {
    const queueIndex = (config.queues || []).indexOf(queue);
    const queueNumber = String(queue.number || queue.extension || 600 + Math.max(queueIndex, 0));
    return {
      extension: extension?.number || extensionNumber || "",
      dialed,
      matchedRule: "queue",
      matchedPattern: queueNumber || dialed,
      normalized: dialed,
      permitted: true,
      targetType: "queue",
      targetLabel: queue.name || queue.id || dialed,
      dialString: `Fila ${queueNumber || dialed}`
    };
  }

  const orderedRules = [
    ["local", config.outboundRules?.local?.patterns || []],
    ["mobile", config.outboundRules?.mobile?.patterns || []],
    ["ddd", config.outboundRules?.ddd?.patterns || []],
    ["international", config.outboundRules?.international?.patterns || []],
    ["special", config.outboundRules?.special?.patterns || []]
  ];

  function allow(rule) {
    return permissions.includes(rule);
  }

  if (allow("mobile") && /^\d{9}$/.test(dialed) && areaCode) {
    matchedRule = "mobile";
    matchedPattern = "_9XXXXXXXX";
    normalized = `${localOutboundPrefix(config)}${dialed}`;
  } else if (allow("mobile") && /^0\d{9}$/.test(dialed) && areaCode) {
    matchedRule = "mobile";
    matchedPattern = "_09XXXXXXXX";
    normalized = `${localOutboundPrefix(config)}${dialed.slice(1)}`;
  } else if (allow("ddd") && /^\d{10,11}$/.test(dialed) && !dialed.startsWith("0")) {
    matchedRule = "ddd";
    matchedPattern = dialed.length === 10 ? "_[1-9][1-9]XXXXXXXX" : "_[1-9][1-9]XXXXXXXXX";
    normalized = `${nationalPrefix(config)}${dialed}`;
  } else if (allow("ddd") && /^0\d{10,11}$/.test(dialed)) {
    matchedRule = "ddd";
    matchedPattern = dialed.length === 11 ? "_0[1-9][1-9]XXXXXXXX" : "_0[1-9][1-9]XXXXXXXXX";
    normalized = dialed;
  } else if (allow("ddd") && /^55\d{10,11}$/.test(dialed)) {
    matchedRule = "ddd";
    matchedPattern = dialed.length === 12 ? "_55[1-9][1-9]XXXXXXXX" : "_55[1-9][1-9]XXXXXXXXX";
    normalized = dialed.slice(2);
  } else if (allow("ddd") && /^055\d{10,11}$/.test(dialed)) {
    matchedRule = "ddd";
    matchedPattern = dialed.length === 13 ? "_055[1-9][1-9]XXXXXXXX" : "_055[1-9][1-9]XXXXXXXXX";
    normalized = dialed.slice(3);
  } else if (allow("local") && /^\d{7,8}$/.test(dialed) && areaCode) {
    matchedRule = "local";
    matchedPattern = dialed.length === 7 ? "_XXXXXXX" : "_XXXXXXXX";
    normalized = `${localOutboundPrefix(config)}${dialed}`;
  } else {
    for (const [rule, patterns] of orderedRules) {
      if (!allow(rule)) continue;
      for (const pattern of patterns) {
        const regex = new RegExp(
          "^" +
            pattern
              .replace(/^_/, "")
              .replace(/\./g, "\\d+")
              .replace(/X/g, "\\d")
              .replace(/\[1-9\]/g, "[1-9]")
              .replace(/\[0-9\]/g, "[0-9]") +
            "$"
        );
        if (regex.test(dialed)) {
          matchedRule = rule;
          matchedPattern = pattern;
          break;
        }
      }
      if (matchedRule) break;
    }
  }

  return {
    extension: extension?.number || extensionNumber || "",
    dialed,
    matchedRule,
    matchedPattern,
    normalized,
    permitted: Boolean(matchedRule),
    targetType: matchedRule ? "external" : "",
    targetLabel: "",
    dialString: matchedRule ? `PJSIP/${normalized}@${config.outbound?.defaultTrunk || "trunk-operadora"}` : ""
  };
}

async function readOutboundDiagnostics(config, extensionNumber, rawNumber) {
  const messagesPath = process.env.ASTERISK_MESSAGES_LOG || "/var/log/asterisk/messages.log";
  const rawMessages = await readLogTail(messagesPath, 500);
  const logs = rawMessages
    .split("\n")
    .filter((line) => /Unable to create channel of type 'PJSIP'|invalid URI|extension not found in context 'from-|res_pjsip_session\.c:.*Call .* from-|No route to destination/i.test(line))
    .slice(-160)
    .reverse()
    .map((line) => {
      const time = (line.match(/^\[([^\]]+)\]/) || [])[1] || "";
      const dialed = (line.match(/URI '([^']+)'/) || [])[1] || (line.match(/extension '([^']+)'/) || [])[1] || "";
      const extension = (line.match(/^\[[^\]]+\]\s+\S+\[\d+\]\[[^\]]+\]\s+\S+.*?(\d{3,5}): Call/) || [])[1] || (line.match(/Endpoint '([^']+)'/) || [])[1] || "";
      return {
        time,
        extension,
        dialed,
        status: /Unable|invalid URI|not found|No route/i.test(line) ? "erro" : "info",
        message: line.replace(/^\[[^\]]+\]\s+/, "")
      };
    });

  return {
    logs,
    preview: rawNumber ? previewOutboundDial(config, extensionNumber, rawNumber) : null
  };
}

app.set("trust proxy", trustedProxySetting());
app.use(enforceHttps);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      mediaSrc: ["'self'", "blob:"],
      connectSrc: ["'self'", "ws:", "wss:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'self'"],
      upgradeInsecureRequests: null
    }
  }
}));
app.use(morgan(process.env.NODE_ENV === "production" ? "combined" : "dev", {
  skip: (req) => req.path === "/api/pbx-status" || req.path === "/api/extensions/status"
}));
app.use(express.json({ limit: "1mb" }));
app.use(
  session({
    name: "pbx.sid",
    secret: sessionSecret(),
    store: sessionStore(),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production" ? true : "auto",
      maxAge: 1000 * 60 * 60 * 8
    }
  })
);

app.use(
  "/api/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false
  })
);
app.use(
  "/api/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    keyGenerator: (req) => `account:${String(req.body?.username || "").trim().toLowerCase() || "unknown"}`,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(
  "/api/extensions/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: true,
    legacyHeaders: false
  })
);
app.use(
  "/api/extensions/login",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    keyGenerator: (req) => `extension:${String(req.body?.extension || "").trim() || "unknown"}`,
    skipSuccessfulRequests: true,
    standardHeaders: true,
    legacyHeaders: false
  })
);

app.use(express.static(path.join(__dirname, "public")));

const expensiveApiLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 180,
  keyGenerator: (req) => `session:${req.session?.user?.username || req.sessionID || "anonymous"}`,
  standardHeaders: true,
  legacyHeaders: false
});
app.use(["/api/pbx/reports", "/api/pbx/recordings", "/api/pbx-status", "/api/reports", "/api/inbound-calls"], expensiveApiLimiter);

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};
  const users = await getUsers();
  const user = users.users.find((candidate) => candidate.username === username);

  if (!user || !(await bcrypt.compare(String(password || ""), user.passwordHash))) {
    return res.status(401).json({ error: "Usuario ou senha invalidos" });
  }

  await regenerateSession(req);
  req.session.user = publicUser(user);
  req.session.userAuthFingerprint = authFingerprint(user);
  return res.json({ user: req.session.user });
});

app.post("/api/logout", requireAuth, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("pbx.sid");
    res.json({ ok: true });
  });
});

app.get("/api/me", async (req, res) => {
  if (!req.session?.user) return res.json({ user: null });
  const users = await getUsers();
  const current = (users.users || []).find((candidate) => candidate.username === req.session.user.username);
  if (!current || req.session.userAuthFingerprint !== authFingerprint(current)) {
    req.session.destroy(() => {});
    res.clearCookie("pbx.sid");
    return res.json({ user: null });
  }
  req.session.user = publicUser(current);
  return res.json({ user: req.session.user });
});

app.post("/api/extensions/login", async (req, res) => {
  const { extension, password } = req.body || {};
  const config = await getConfig();
  const matched = (config.extensions || []).find((candidate) => String(candidate.number) === String(extension || "").trim());

  if (!matched || String(matched.secret || "") !== String(password || "")) {
    return res.status(401).json({ error: "Ramal ou senha invalidos" });
  }

  await regenerateSession(req);
  req.session.extension = publicExtension(matched);
  req.session.extensionAuthFingerprint = extensionFingerprint(matched);
  return res.json({ extension: req.session.extension });
});

app.post("/api/extensions/logout", requireExtensionAuth, async (req, res) => {
  const extensionNumber = req.session.extension?.number;
  if (extensionNumber) await setExtensionPause(extensionNumber, false).catch(() => null);
  delete req.session.extension;
  res.json({ ok: true });
});

app.get("/api/extensions/me", async (req, res) => {
  if (!req.session?.extension) return res.json({ extension: null });
  const config = await getConfig();
  const current = (config.extensions || []).find((candidate) => String(candidate.number) === String(req.session.extension.number));
  if (!current || req.session.extensionAuthFingerprint !== extensionFingerprint(current)) {
    req.session.destroy(() => {});
    res.clearCookie("pbx.sid");
    return res.json({ extension: null });
  }
  req.session.extension = publicExtension(current);
  return res.json({ extension: req.session.extension });
});

app.get("/api/extensions/portal", requireExtensionAuth, async (req, res) => {
  const config = await getConfig();
  const extension = (config.extensions || []).find((candidate) => String(candidate.number) === req.session.extension.number);
  if (!extension) return res.status(404).json({ error: "Ramal nao encontrado" });
  res.json({
    extension: publicExtension(extension),
    sip: browserSipSettings(req, extension),
    features: {
      transfer: true,
      hold: true,
      mute: true,
      queuePause: true,
      hangup: true
    }
  });
});

app.get("/api/extensions/status", requireExtensionAuth, async (req, res) => {
  const config = await getConfig();
  const status = await readPbxStatus(config);
  const extensionStatus = extensionStatusFromPbx(status, req.session.extension.number);
  extensionStatus.recentCalls = await readRecentExtensionCalls(config, req.session.extension.number);
  res.json(extensionStatus);
});

app.get("/api/extensions/dial-preview", requireExtensionAuth, async (req, res) => {
  const config = await getConfig();
  const preview = previewOutboundDial(config, req.session.extension.number, req.query.number || "");
  res.json(preview);
});

app.post("/api/extensions/protocol", requireExtensionAuth, async (req, res) => {
  const protocol = await allocateCallProtocol();
  const event = await recordCallProtocolEvent({
    protocol,
    extension: req.session.extension.number,
    direction: String(req.body?.direction || ""),
    number: normalizeDigits(req.body?.number || "")
  });
  res.json({
    protocol,
    extension: req.session.extension.number,
    direction: String(req.body?.direction || ""),
    number: normalizeDigits(req.body?.number || ""),
    createdAt: event.createdAt
  });
});

app.post("/api/extensions/call", requireExtensionAuth, async (req, res) => {
  const config = await getConfig();
  const rawNumber = normalizeDigits(req.body?.number || "");
  const internal = (config.extensions || []).find((extension) => String(extension.number) === rawNumber);
  const preview = previewOutboundDial(config, req.session.extension.number, rawNumber);

  if (!internal && !preview.permitted) {
    return res.status(400).json({ error: "Numero sem rota de saida para este ramal", preview });
  }

  try {
    const target = internal ? rawNumber : preview.dialed;
    const output = await runAsteriskControl("originate", req.session.extension.number, { number: target });
    res.json({ ok: true, output, target, preview, mode: "originate" });
  } catch (error) {
    res.status(503).json({ error: "Nao foi possivel originar a chamada no Asterisk", detail: error.message, preview });
  }
});

app.post("/api/extensions/transfer", requireExtensionAuth, async (req, res) => {
  const config = await getConfig();
  const target = String(req.body?.target || "").trim();
  const extension = (config.extensions || []).find((item) => String(item.number) === target);
  const queue = (config.queues || []).find((item) => String(item.id) === target || String(item.number) === target);
  const dialTarget = extension?.number || queue?.number || "";
  if (!dialTarget) return res.status(400).json({ error: "Informe um ramal ou fila de destino valido" });

  const status = await readPbxStatus(config);
  const requestedChannel = String(req.body?.channel || "").trim();
  const ownedChannel = ownedChannelForRequest(status, config, req.session.extension.number, requestedChannel);
  if (requestedChannel && !ownedChannel) return res.status(403).json({ error: "Canal fora da chamada ativa deste ramal" });
  const channel = String(ownedChannel?.channel || "").trim();
  if (!channel) return res.status(400).json({ error: "Nenhuma chamada ativa encontrada para transferir" });

  try {
    const output = await runAsteriskControl("redirect", req.session.extension.number, { channel, target: dialTarget });
    res.json({ ok: true, output, channel, target: dialTarget });
  } catch (error) {
    res.status(503).json({ error: "Nao foi possivel transferir a chamada", detail: error.message });
  }
});

app.post("/api/extensions/action", requireExtensionAuth, async (req, res) => {
  const { action, reason } = req.body || {};
  let { channel } = req.body || {};
  const allowed = new Set(["queue-pause", "queue-unpause", "hangup"]);
  if (!allowed.has(action)) return res.status(400).json({ error: "Acao invalida" });
  const pauseReason = action === "queue-pause" ? normalizePauseReason(reason) : reason;

  try {
    if (action === "hangup") {
      const config = await getConfig();
      const status = await readPbxStatus(config);
      const requestedChannel = String(channel || "").trim();
      const ownedChannel = ownedChannelForRequest(status, config, req.session.extension.number, requestedChannel);
      if (requestedChannel && !ownedChannel) return res.status(403).json({ error: "Canal fora da chamada ativa deste ramal" });
      channel = ownedChannel?.channel || "";
      if (!channel) return res.status(400).json({ error: "Nenhuma chamada ativa encontrada para encerrar" });
    }
    const output = await runAsteriskControl(action, req.session.extension.number, { reason: pauseReason, channel });
    let pause = null;
    if (action === "queue-pause") pause = await setExtensionPause(req.session.extension.number, true, pauseReason);
    if (action === "queue-unpause") await setExtensionPause(req.session.extension.number, false);
    res.json({ ok: true, output, pause });
  } catch (error) {
    res.status(503).json({ error: "Comando indisponivel no host Asterisk", detail: error.message });
  }
});

app.post("/api/change-password", requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (!isStrongPassword(newPassword)) {
    return res.status(400).json({ error: "Use pelo menos 8 caracteres com maiuscula, minuscula e numero." });
  }

  const users = await getUsers();
  const user = users.users.find((candidate) => candidate.username === req.session.user.username);
  if (!user || !(await bcrypt.compare(String(currentPassword || ""), user.passwordHash))) {
    return res.status(401).json({ error: "Senha atual invalida" });
  }

  user.passwordHash = await bcrypt.hash(newPassword, 12);
  user.mustChangePassword = false;
  user.updatedAt = new Date().toISOString();
  await saveUsers(users);
  req.session.user = publicUser(user);
  req.session.userAuthFingerprint = authFingerprint(user);
  res.json({ user: req.session.user });
});

app.get("/api/users", requireAuth, requireAdmin, async (req, res) => {
  const users = await getUsers();
  res.json({ users: (users.users || []).map(publicUser) });
});

app.put("/api/users", requireAuth, requireAdmin, async (req, res) => {
  const current = await getUsers();
  const incoming = Array.isArray(req.body?.users) ? req.body.users : [];
  const currentByUsername = new Map((current.users || []).map((user) => [user.username, user]));
  const nextUsers = [];

  for (const item of incoming) {
    const username = String(item.username || "").trim();
    if (!username) continue;
    const existing = currentByUsername.get(username) || {};
    const next = {
      ...existing,
      username,
      role: String(item.role || "user"),
      extension: String(item.extension || ""),
      departments: Array.isArray(item.departments) ? item.departments.map(String).filter(Boolean) : [],
      allowedExtensions: Array.isArray(item.allowedExtensions) ? item.allowedExtensions.map(String).filter(Boolean) : [],
      permissions: item.permissions && typeof item.permissions === "object" ? item.permissions : {},
      mustChangePassword: Boolean(item.mustChangePassword),
      createdAt: existing.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    const providedPassword = String(item.password || "").trim();
    if (providedPassword && !isStrongPassword(providedPassword)) {
      const error = new Error(`A senha do usuario ${username} precisa ter 8 caracteres, maiuscula, minuscula e numero`);
      error.status = 400;
      throw error;
    }
    if (providedPassword) next.passwordHash = await bcrypt.hash(providedPassword, 12);
    if (!next.passwordHash) {
      const error = new Error(`Informe uma senha inicial para o usuario ${username}`);
      error.status = 400;
      throw error;
    }
    nextUsers.push(next);
  }

  if (!nextUsers.some((user) => user.username === "admin")) {
    const admin = currentByUsername.get("admin");
    if (admin) nextUsers.unshift(admin);
  }
  await saveUsers({ users: nextUsers });
  const publicBeforeUsers = (current.users || []).map(publicUser);
  const publicAfterUsers = nextUsers.map(publicUser);
  await writeSystemAuditEvent(req, "users-update", {
    label: "Atualizou usuarios",
    summary: `${nextUsers.length} usuario(s) salvos`,
    before: publicBeforeUsers,
    after: publicAfterUsers,
    changes: auditDiff({ users: publicBeforeUsers }, { users: publicAfterUsers }, ["users"]),
    details: `Usuarios: ${nextUsers.map((user) => user.username).join(", ")}`
  });
  res.json({ users: nextUsers.map(publicUser) });
});

app.get("/api/audit", requireAuth, requireAdmin, async (req, res) => {
  const audit = await readAuditLog();
  res.json({ events: sanitizeAuditValue((audit.events || []).slice(-500).reverse()) });
});

app.get("/api/config", requireAuth, async (req, res) => {
  const config = await getConfig();
  res.json(withConfigRevision(configForUser(config, req), config));
});

app.get("/api/monitor/sip", requireAuth, requireSupervisor, async (req, res) => {
  const config = await getConfig();
  const scope = userReportScope(req, config);
  if (!scope.canListen) return res.status(403).json({ error: "Sem permissao para escuta de chamadas" });
  res.json({
    sip: monitorSipSettings(req),
    allowedModes: userCanInterveneLiveCalls(req) ? ["listen", "whisper", "barge"] : ["listen"]
  });
});

async function applyAsteriskConfig(config, existingFiles = null) {
  const generatedFiles = existingFiles || await generateAsteriskConfigs(config);
  const result = { generatedFiles, copied: false, reloaded: false, output: "" };
  if (process.env.ASTERISK_APPLY_CMD) {
    const { stdout, stderr } = await execAsync(process.env.ASTERISK_APPLY_CMD);
    result.output = `${stdout || ""}${stderr || ""}`.trim();
    result.copied = /PBX_APPLY_CHANGED=1/.test(result.output) || !/PBX_APPLY_CHANGED=0/.test(result.output);
    result.reloaded = /PBX_APPLY_RELOADED=1/.test(result.output) || !/PBX_APPLY_RELOADED=0/.test(result.output);
  } else {
    if (process.env.ASTERISK_CONFIG_DIR) {
      await fs.ensureDir(process.env.ASTERISK_CONFIG_DIR);
      await Promise.all(
        generatedFiles
          .filter((file) => file.endsWith(".conf"))
          .map((file) => fs.copy(file, path.join(process.env.ASTERISK_CONFIG_DIR, path.basename(file))))
      );
      result.copied = true;
    }
    if (process.env.ASTERISK_RELOAD_CMD) {
      const { stdout, stderr } = await execAsync(process.env.ASTERISK_RELOAD_CMD);
      result.reloaded = true;
      result.output = `${stdout || ""}${stderr || ""}`.trim();
    }
  }
  result.syncedPauses = await syncStoredQueuePauses();
  return result;
}

function configUpdateAudit(req, previous, saved, incoming) {
  const sections = Object.keys(incoming).filter((key) => JSON.stringify(previous?.[key]) !== JSON.stringify(saved?.[key]));
  return writeSystemAuditEvent(req, "config-update", {
    label: "Atualizou configuracao",
    summary: sections.length ? `Secoes alteradas: ${sections.join(", ")}` : "Nenhuma alteracao detectada",
    sections,
    before: Object.fromEntries(sections.map((key) => [key, previous?.[key] ?? null])),
    after: Object.fromEntries(sections.map((key) => [key, saved?.[key] ?? null])),
    changes: auditDiff(previous, saved, sections)
  });
}

function assertSectionRevisions(previous, keys, expectedRevision, expectedSections = {}) {
  const currentRevision = configRevision(previous);
  if (expectedRevision === currentRevision) return;

  const currentSections = configSectionRevisions(previous);
  const conflicts = keys.filter((key) => !expectedSections[key] || expectedSections[key] !== currentSections[key]);
  if (!conflicts.length) return;

  const error = new Error(`Os modulos ${conflicts.join(", ")} mudaram em outra sessao. Recarregue os dados antes de salvar novamente.`);
  error.status = 409;
  error.conflicts = conflicts;
  throw error;
}

async function saveAndApplyConfig(req, previous, incoming) {
  const startedAt = Date.now();
  const files = await generateAsteriskConfigs(incoming);
  let saved = null;
  try {
    saved = await saveConfig(incoming);
    const applied = await applyAsteriskConfig(saved, files);
    await configUpdateAudit(req, previous, saved, incoming);
    pbxStatusCache = { revision: "", expiresAt: 0, value: null, pending: null };
    return {
      config: withConfigRevision(saved),
      ...applied,
      durationMs: Date.now() - startedAt
    };
  } catch (error) {
    if (saved) {
      await saveConfig(previous).catch(() => null);
      await applyAsteriskConfig(previous).catch(() => null);
    } else {
      await generateAsteriskConfigs(previous).catch(() => null);
    }
    throw error;
  }
}

app.put("/api/config", requireAuth, requireAdmin, async (req, res) => {
  const response = await withConfigMutationLock(async () => {
    const previous = await getConfig();
    const expectedRevision = String(req.body?._revision || "");
    const incoming = stripConfigMetadata(req.body);
    if (expectedRevision && expectedRevision !== configRevision(previous)) {
      const error = new Error("A configuracao mudou em outra sessao. Recarregue a pagina antes de salvar novamente.");
      error.status = 409;
      throw error;
    }
    validateConfig(incoming);
    const files = await generateAsteriskConfigs(incoming);
    const saved = await saveConfig(incoming);
    await configUpdateAudit(req, previous, saved, incoming);
    return { config: withConfigRevision(saved), generatedFiles: files };
  });
  res.json(response);
});

app.post("/api/apply", requireAuth, requireAdmin, async (_req, res) => {
  const result = await withConfigMutationLock(async () => applyAsteriskConfig(await getConfig()));
  res.json(result);
});

app.put("/api/config/apply", requireAuth, requireAdmin, async (req, res) => {
  const response = await withConfigMutationLock(async () => {
    const previous = await getConfig();
    const expectedRevision = String(req.body?._revision || "");
    const incoming = stripConfigMetadata(req.body);
    if (expectedRevision && expectedRevision !== configRevision(previous)) {
      const error = new Error("A configuracao mudou em outra sessao. Recarregue a pagina antes de salvar novamente.");
      error.status = 409;
      throw error;
    }
    validateConfig(incoming);
    return saveAndApplyConfig(req, previous, incoming);
  });
  res.json(response);
});

app.patch("/api/config/apply", requireAuth, requireAdmin, async (req, res) => {
  const response = await withConfigMutationLock(async () => {
    const previous = await getConfig();
    const expectedRevision = String(req.body?._revision || "");
    const expectedSections = req.body?._sectionRevisions || {};
    const { config: incoming, keys } = mergeConfigSections(previous, req.body?.sections);
    if (!keys.length) return { config: withConfigRevision(previous), copied: false, reloaded: false, unchanged: true, durationMs: 0 };
    assertSectionRevisions(previous, keys, expectedRevision, expectedSections);
    validateConfig(incoming);
    return saveAndApplyConfig(req, previous, incoming);
  });
  res.json(response);
});

app.get("/api/pbx/reports/calls", requireAuth, async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(200, Math.max(10, Number(req.query.pageSize) || 25));
  const sortBy = String(req.query.sortBy || "startedAt");
  const sortDir = String(req.query.sortDir || "desc") === "asc" ? "asc" : "desc";
  const { scope, filters, calls } = await reportDataForRequest(req);
  const sorted = sortReportCalls(calls, sortBy, sortDir);
  const offset = (page - 1) * pageSize;
  const pageCalls = sorted.slice(offset, offset + pageSize).map((call) => {
    const { recordingPath, ...safeCall } = call;
    safeCall.recordingDownloadName = recordingDownloadName(call);
    return safeCall;
  });

  res.json({
    data: pageCalls,
    meta: {
      page,
      pageSize,
      total: sorted.length,
      pages: Math.max(1, Math.ceil(sorted.length / pageSize)),
      sortBy,
      sortDir,
      filters,
      permissions: {
        role: scope.role,
        canListenRecordings: scope.canListen,
        canDownloadRecordings: scope.canDownload
      }
    }
  });
});

app.get("/api/pbx/reports/calls/:id", requireAuth, async (req, res) => {
  const { calls, scope } = await reportDataForRequest(req);
  const call = calls.find((item) => item.id === req.params.id || item.uniqueId === req.params.id);
  if (!call) return res.status(404).json({ error: "Chamada nao encontrada" });
  const { recordingPath, ...safeCall } = call;
  safeCall.recordingDownloadName = recordingDownloadName(call);
  safeCall.timeline = [
    { label: "Inicio", at: safeCall.startedAt, description: `${safeCall.source || "-"} chamou ${safeCall.destination || "-"}` },
    safeCall.answeredAt ? { label: "Atendimento", at: safeCall.answeredAt, description: `Atendida apos ${safeCall.waitsecLabel}` } : null,
    safeCall.endedAt ? { label: "Fim", at: safeCall.endedAt, description: `Status final: ${safeCall.statusLabel}` } : null
  ].filter(Boolean);
  safeCall.recording = {
    available: Boolean(call.recordingExists),
    playable: Boolean(call.recordingPlayable && scope.canListen),
    canListen: Boolean(scope.canListen),
    canDownload: Boolean(scope.canDownload),
    playUrl: call.recordingExists && scope.canListen ? `/api/pbx/recordings/${encodeURIComponent(call.uniqueId)}/play` : "",
    downloadUrl: call.recordingExists && scope.canDownload ? `/api/pbx/recordings/${encodeURIComponent(call.uniqueId)}/download` : ""
  };
  res.json({ call: safeCall });
});

app.get("/api/pbx/reports/dashboard", requireAuth, async (req, res) => {
  const { calls, filters } = await reportDataForRequest(req);
  res.json({ dashboard: buildDashboard(calls), filters });
});

app.get("/api/pbx/reports/charts", requireAuth, async (req, res) => {
  const { calls, filters } = await reportDataForRequest(req);
  res.json({ charts: buildChartData(calls), filters });
});

app.get("/api/pbx/reports/presence", requireAuth, async (req, res) => {
  const config = await getConfig();
  const scope = userReportScope(req, config);
  const filters = parseReportFilters(req.query || {});
  const summary = await presenceSummaryForFilters(configForReportScope(config, scope), filters);
  res.json({ summary, filters });
});

app.get("/api/pbx/reports/pauses", requireAuth, async (req, res) => {
  const config = await getConfig();
  const scope = userReportScope(req, config);
  const filters = parseReportFilters(req.query || {});
  const result = await pauseSummaryForFilters(configForReportScope(config, scope), filters);
  res.json({ ...result, filters });
});

app.post("/api/pbx/monitor/action", requireAuth, requireSupervisor, async (req, res) => {
  const config = await getConfig();
  const action = String(req.body?.action || "");
  const channel = String(req.body?.channel || "").trim();
  const target = String(req.body?.target || "").trim();
  const listener = String(req.body?.listener || "").replace(/[^\d]/g, "");
  const mode = String(req.body?.mode || "listen").trim().toLowerCase();

  if (["spy", "spy-browser", "hangup-monitor-spy"].includes(action)) {
    const scope = userReportScope(req, config);
    if (!scope.canListen) return res.status(403).json({ error: "Sem permissao para escuta de chamadas" });
  }
  if (action === "spy-browser" && !["listen", "whisper", "barge"].includes(mode)) {
    return res.status(400).json({ error: "Modo de monitoramento invalido" });
  }

  try {
    if (action === "transfer-waiting") {
      if (!userCanInterveneLiveCalls(req)) return res.status(403).json({ error: "Sem permissao para intervir em chamadas" });
      const extension = (config.extensions || []).find((item) => String(item.number) === target);
      const queue = (config.queues || []).find((item) => String(item.id) === target || String(item.number) === target);
      const dialTarget = extension?.number || queue?.number || "";
      if (!channel || !dialTarget) return res.status(400).json({ error: "Informe canal e ramal/fila de destino validos" });
      const status = await readPbxStatus(config);
      const channelEntry = (status.activeChannels || []).find((item) => item.channel === channel);
      const owners = channelEntry ? activeChannelExtensionCandidates(channelEntry, extensionNumbers(config)) : [];
      const inScope = userRole(req) === "admin" || owners.some((number) => userCanMonitorExtension(req, config, number));
      if (!inScope) return res.status(403).json({ error: "Canal fora do escopo permitido para este supervisor" });
      const output = await runAsteriskControl("redirect", "00", { channel, target: dialTarget });
      await writeSystemAuditEvent(req, "monitor-transfer-waiting", {
        label: "Transferiu chamada em espera",
        summary: `Canal ${channel} transferido para ${dialTarget}`,
        channel,
        target: dialTarget,
        output,
        after: { channel, target: dialTarget }
      });
      return res.json({ ok: true, output });
    }

    if (action === "hangup-channel") {
      if (!userCanInterveneLiveCalls(req)) return res.status(403).json({ error: "Sem permissao para intervir em chamadas" });
      if (!target || !userCanMonitorExtension(req, config, target)) {
        return res.status(403).json({ error: "Ramal fora do escopo permitido para este supervisor" });
      }
      const status = await readPbxStatus(config);
      const requestedChannel = String(channel || "").trim();
      const activeChannel = ownedChannelForRequest(status, config, target, requestedChannel);
      if (requestedChannel && !activeChannel) return res.status(403).json({ error: "Canal fora da chamada ativa do ramal informado" });
      const relatedChannels = channelsOwnedByExtension(status, config, target);
      const channelToHangup = String(activeChannel?.channel || relatedChannels[0]?.channel || "").trim();
      const outputs = [];
      const channelsToHangup = relatedChannels.length ? relatedChannels.map((item) => item.channel) : channelToHangup ? [channelToHangup] : [];
      if (channelsToHangup.length) {
        for (const itemChannel of channelsToHangup) {
          outputs.push(await runAsteriskControl("hangup-admin", "00", { channel: itemChannel }).catch((error) => error.message));
        }
      } else if (target) {
        outputs.push(await runAsteriskControl("hangup", target, { channel: "" }).catch((error) => error.message));
      } else {
        return res.status(400).json({ error: "Nenhuma chamada ativa encontrada para desconectar" });
      }
      if (outputs.length && outputs.every(asteriskCommandFailed)) {
        return res.status(409).json({ error: "O Asterisk nao confirmou o encerramento da chamada", detail: outputs.join("\n"), channels: channelsToHangup });
      }
      await writeSystemAuditEvent(req, "monitor-hangup-channel", {
        label: "Desconectou chamada pelo monitor",
        summary: channelsToHangup.length
          ? `Canal ${channelsToHangup.join(", ")} desconectado${target ? ` do ramal ${target}` : ""}`
          : `Solicitado encerramento das chamadas do ramal ${target}`,
        channel: channelToHangup,
        target,
        output: outputs.join("\n"),
        before: relatedChannels.length ? relatedChannels : activeChannel || { channel: channelToHangup, target },
        after: { disconnected: true, channels: channelsToHangup, target }
      });
      return res.json({ ok: true, output: outputs.join("\n"), channel: channelToHangup, channels: channelsToHangup });
    }

    if (action === "spy-browser") {
      const targetExtension = (config.extensions || []).find((item) => String(item.number) === target);
      if (!targetExtension) return res.status(400).json({ error: "Informe o ramal monitorado" });
      if (!userCanMonitorExtension(req, config, target)) {
        return res.status(403).json({ error: "Ramal fora do escopo permitido para este supervisor" });
      }
      if (mode !== "listen" && !userCanInterveneLiveCalls(req)) {
        return res.status(403).json({ error: "Sem permissao para intervir em chamadas" });
      }
      const status = await readPbxStatus(config);
      const activeChannel = activeChannelForMonitor(status, target, "");
      if (!activeChannel?.channel) {
        return res.status(409).json({ error: "O ramal nao esta em uma chamada ativa" });
      }
      const targetEndpoint = spyEndpointForMonitor(status, target);
      const listenerEndpoint = process.env.PBX_MONITOR_SIP_USER || "monitor-admin";
      const output = await runAsteriskControl("spy-browser", "00", { targetEndpoint, listenerEndpoint, mode });
      if (asteriskCommandFailed(output)) {
        return res.status(409).json({ error: "O Asterisk nao conseguiu abrir o monitoramento no navegador", detail: output, targetEndpoint });
      }
      const auditByMode = {
        listen: { event: "monitor-spy", label: "Iniciou escuta no navegador", summary: "escutando" },
        whisper: { event: "monitor-whisper", label: "Iniciou sussurro ao operador", summary: "falando com o operador" },
        barge: { event: "monitor-barge", label: "Iniciou intervencao na chamada", summary: "falando com operador e cliente" }
      };
      const audit = auditByMode[mode];
      await writeSystemAuditEvent(req, audit.event, {
        label: audit.label,
        summary: `Monitor ${audit.summary} no ramal ${target} (${targetEndpoint})`,
        target,
        output,
        after: { listenerEndpoint, target, targetEndpoint, mode, activeChannel: activeChannel.channel }
      });
      return res.json({ ok: true, output, listenerEndpoint, target, targetEndpoint, mode });
    }

    if (action === "hangup-monitor-spy") {
      const listenerEndpoint = process.env.PBX_MONITOR_SIP_USER || "monitor-admin";
      const status = await readPbxStatus(config);
      const monitorChannels = (status.activeChannels || []).filter((item) => {
        const joined = [item.channel, item.data, item.callerId, item.extension].join(" ");
        return new RegExp(`(?:PJSIP|SIP|Local)/${listenerEndpoint}(?:[-/@]|\\b)|ChanSpy`, "i").test(joined);
      });
      const outputs = [];
      for (const item of monitorChannels) {
        outputs.push(await runAsteriskControl("hangup-admin", "00", { channel: item.channel }).catch((error) => error.message));
      }
      return res.json({ ok: true, channels: monitorChannels.map((item) => item.channel), output: outputs.join("\n") });
    }

    if (action === "spy") {
      const targetExtension = (config.extensions || []).find((item) => String(item.number) === target);
      const listenerExtension = (config.extensions || []).find((item) => String(item.number) === listener);
      if (!targetExtension || !listenerExtension) return res.status(400).json({ error: "Informe ramal monitorado e ramal que vai escutar" });
      if (!userCanMonitorExtension(req, config, target)) {
        return res.status(403).json({ error: "Ramal fora do escopo permitido para este supervisor" });
      }
      const status = await readPbxStatus(config);
      const targetEndpoint = spyEndpointForMonitor(status, target);
      const output = await runAsteriskControl("spy", listener, { targetEndpoint });
      await writeSystemAuditEvent(req, "monitor-spy", {
        label: "Iniciou escuta em tempo real",
        summary: `Ramal ${listener} escutando ramal ${target} (${targetEndpoint})`,
        target,
        output,
        after: { listener, target, targetEndpoint }
      });
      return res.json({ ok: true, output, listener, target, targetEndpoint });
    }

    return res.status(400).json({ error: "Acao invalida" });
  } catch (error) {
    return res.status(503).json({ error: "Comando indisponivel no host Asterisk", detail: error.message });
  }
});

app.get("/api/pbx/recordings/:uniqueid/exists", requireAuth, async (req, res) => {
  const { calls, scope } = await reportDataForRequest(req);
  const call = calls.find((item) => item.uniqueId === req.params.uniqueid || item.id === req.params.uniqueid);
  if (!call) return res.status(404).json({ error: "Chamada nao encontrada" });
  res.json({
    exists: Boolean(call.recordingExists),
    playable: Boolean(call.recordingPlayable && scope.canListen),
    canListen: Boolean(scope.canListen),
    canDownload: Boolean(scope.canDownload)
  });
});

app.get("/api/pbx/recordings/:uniqueid/play", requireAuth, async (req, res) => {
  const { calls, scope } = await reportDataForRequest(req);
  const call = calls.find((item) => item.uniqueId === req.params.uniqueid || item.id === req.params.uniqueid);
  if (!call) return res.status(404).json({ error: "Chamada nao encontrada" });
  if (!scope.canListen) return res.status(403).json({ error: "Sem permissao para escutar gravacoes" });
  if (!call.recordingPath || !(await fs.pathExists(call.recordingPath))) return res.status(404).json({ error: "Gravacao nao encontrada" });
  await writeAuditEvent(req, call, "listen");
  res.type(path.extname(call.recordingPath).toLowerCase() === ".mp3" ? "audio/mpeg" : "audio/wav");
  res.sendFile(call.recordingPath);
});

app.get("/api/pbx/recordings/:uniqueid/download", requireAuth, async (req, res) => {
  const { calls, scope } = await reportDataForRequest(req);
  const call = calls.find((item) => item.uniqueId === req.params.uniqueid || item.id === req.params.uniqueid);
  if (!call) return res.status(404).json({ error: "Chamada nao encontrada" });
  if (!scope.canDownload) return res.status(403).json({ error: "Sem permissao para baixar gravacoes" });
  if (!call.recordingPath || !(await fs.pathExists(call.recordingPath))) return res.status(404).json({ error: "Gravacao nao encontrada" });
  await writeAuditEvent(req, call, "download");
  res.download(call.recordingPath, recordingDownloadName(call));
});

app.get("/api/pbx/reports/export/csv", requireAuth, async (req, res) => {
  const { calls } = await reportDataForRequest(req);
  const rows = callExportRows(sortReportCalls(calls, String(req.query.sortBy || "startedAt"), String(req.query.sortDir || "desc")));
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="relatorios-pbx-${Date.now()}.csv"`);
  res.send(`\ufeff${rowsToCsv(rows)}`);
});

app.get("/api/pbx/reports/export/xlsx", requireAuth, async (req, res) => {
  const { calls } = await reportDataForRequest(req);
  const rows = callExportRows(sortReportCalls(calls, String(req.query.sortBy || "startedAt"), String(req.query.sortDir || "desc")));
  res.setHeader("Content-Type", "application/vnd.ms-excel; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="relatorios-pbx-${Date.now()}.xls"`);
  res.send(rowsToExcelXml(rows));
});

app.get("/api/pbx/reports/export/pdf", requireAuth, async (req, res) => {
  const { config, filters, calls } = await reportDataForRequest(req);
  const dashboard = buildDashboard(calls);
  const rows = callExportRows(sortReportCalls(calls, String(req.query.sortBy || "startedAt"), String(req.query.sortDir || "desc"))).slice(0, 36);
  const filterPeriod = `${filters.dateStart || "inicio"} ate ${filters.dateEnd || "agora"}`;
  const lines = [
    `Empresa: ${config.company?.name || "PBX Empresarial"}`,
    `Periodo analisado: ${filterPeriod}`,
    `Emitido em: ${new Date().toLocaleString("pt-BR")}`,
    `Total: ${dashboard.total} | Atendidas: ${dashboard.answered} | Perdidas: ${dashboard.missed} | Gravacoes: ${dashboard.recordings}`,
    "",
    "Chamadas",
    ...rows.map((row) => `${row.Protocolo || "-"} | ${row["Data e hora"]} | ${row.Origem} -> ${row.Destino} | ${row.Ramal} | ${row.Tipo} | ${row.Status} | ${row["Duracao total"]}`)
  ];
  const pdf = buildSimplePdf({ title: "Relatorios PBX", subtitle: `Periodo: ${filterPeriod}`, lines });
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="relatorios-pbx-${Date.now()}.pdf"`);
  res.send(pdf);
});

app.get("/api/reports", requireAuth, async (req, res) => {
  const config = await getConfig();
  const scope = userReportScope(req, config);
  res.json({ calls: applyReportScope(await readReports(config), scope) });
});

app.get("/api/inbound-calls", requireAuth, async (req, res) => {
  const config = await getConfig();
  res.json(await readInboundCallLogs(config, userReportScope(req, config)));
});

app.get("/api/pbx-status", requireAuth, async (req, res) => {
  const config = await getConfig();
  const status = await readPbxStatus(config);
  res.json(pbxStatusForScope(status, config, userReportScope(req, config)));
});

app.get("/api/registration-logs", requireAuth, requireAdmin, async (_req, res) => {
  res.json({ logs: await readRegistrationLogs() });
});

app.get("/api/outbound-diagnostics", requireAuth, requireAdmin, async (req, res) => {
  const config = await getConfig();
  const extensionNumber = String(req.query.ext || config.extensions?.[0]?.number || "201");
  const rawNumber = String(req.query.number || "");
  res.json(await readOutboundDiagnostics(config, extensionNumber, rawNumber));
});

app.get("/api/generated/:file", requireAuth, requireAdmin, async (req, res) => {
  const file = path.basename(req.params.file);
  const filePath = path.join(generatedDir, file);
  if (!(await fs.pathExists(filePath))) return res.status(404).json({ error: "Arquivo nao encontrado" });
  res.type("text/plain").send(await fs.readFile(filePath, "utf8"));
});

app.get("/api/ivr-audios", requireAuth, requireAdmin, async (_req, res) => {
  res.json({ audios: await listIvrAudios() });
});

app.get("/api/ivr-audios/file/:file", requireAuth, requireAdmin, async (req, res) => {
  const file = path.basename(req.params.file);
  const filePath = path.join(ivrAudioDir, file);
  if (!(await fs.pathExists(filePath))) return res.status(404).json({ error: "Audio nao encontrado" });
  res.sendFile(filePath);
});

app.delete("/api/ivr-audios/:file", requireAuth, requireAdmin, async (req, res) => {
  const file = path.basename(req.params.file || "");
  const extension = path.extname(file).toLowerCase();
  if (!file || !playbackAudioExtensions.has(extension)) return res.status(400).json({ error: "Audio invalido." });

  const filePath = path.join(ivrAudioDir, file);
  if (!(await fs.pathExists(filePath))) return res.status(404).json({ error: "Audio nao encontrado" });

  const playback = playbackNameFromFilename(file);
  const { saved, clearedReferences } = await withConfigMutationLock(async () => {
    const config = await getConfig();
    const references = clearDeletedIvrAudioReferences(config, playback);
    await fs.remove(filePath);
    const next = references ? await saveConfig(config) : config;
    if (references) await generateAsteriskConfigs(next);
    return { saved: next, clearedReferences: references };
  });

  await writeSystemAuditEvent(req, "ivr-audio-delete", {
    label: "Excluiu audio da URA",
    summary: `Audio ${file} removido`,
    file,
    playback,
    clearedReferences,
    before: { file, playback, references: clearedReferences },
    after: { deleted: true, file, playback }
  });

  res.json({
    ok: true,
    file,
    playback,
    clearedReferences,
    config: withConfigRevision(saved),
    audios: await listIvrAudios(),
    message: clearedReferences
      ? "Audio excluido e referencias removidas. Clique em Salvar e aplicar para atualizar o Asterisk."
      : "Audio excluido."
  });
});

app.post("/api/ivr-audios", requireAuth, requireAdmin, upload.single("audio"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Envie um arquivo de audio." });
  const extension = path.extname(req.file.filename || "").toLowerCase();
  if (!playbackAudioExtensions.has(extension)) {
    await fs.remove(req.file.path);
    return res.status(400).json({ error: "Formato invalido. Use wav, gsm, ulaw, alaw, sln16 ou mp3." });
  }
  res.json({
    ok: true,
    audio: {
      file: req.file.filename,
      label: req.file.filename,
      playback: playbackNameFromFilename(req.file.filename),
      url: `/api/ivr-audios/file/${encodeURIComponent(req.file.filename)}`
    },
    audios: await listIvrAudios(),
    message: "Audio enviado. Clique em Salvar e aplicar para copiar para o Asterisk."
  });
});

app.get("/api/dialer/campaigns", requireAuth, requireAdmin, async (_req, res) => {
  const config = await getConfig();
  const campaigns = await readDialerCampaigns();
  res.json({
    campaigns: campaigns.map(publicDialerCampaign),
    destinations: dialerDestinationOptions(config),
    trunks: configTrunks(config),
    audios: await listIvrAudios()
  });
});

app.post("/api/dialer/campaigns", requireAuth, requireAdmin, async (req, res) => {
  const config = await getConfig();
  const audios = await listIvrAudios();
  const id = safeDialerText(req.body?.id || "", 50);
  let savedCampaign = null;

  await updateDialerCampaigns(async (campaigns) => {
    const previous = id ? campaigns.find((item) => item.id === id) : null;
    const campaign = normalizeDialerCampaign(req.body || {}, previous, config);
    if (!campaign.audio || !audios.some((audio) => audio.playback === campaign.audio)) throw new Error("Selecione um audio valido para a campanha.");
    if (!dialerDestinationExists(config, campaign.destinationType, campaign.destination)) throw new Error("Selecione uma fila ou ramal valido para receber os atendimentos.");
    if (!campaign.trunkIds.length) throw new Error("Selecione pelo menos um tronco ativo para a campanha.");
    if (!campaign.numbers.length) throw new Error("Adicione pelo menos um numero para discar.");
    savedCampaign = campaign;
    return previous ? campaigns.map((item) => (item.id === previous.id ? campaign : item)) : [campaign, ...campaigns];
  });

  res.json({ campaign: publicDialerCampaign(savedCampaign), campaigns: (await readDialerCampaigns()).map(publicDialerCampaign) });
});

app.post("/api/dialer/campaigns/:id/start", requireAuth, requireAdmin, async (req, res) => {
  const config = await getConfig();
  const audios = await listIvrAudios();
  let campaign = null;
  await updateDialerCampaigns(async (campaigns) =>
    campaigns.map((item) => {
      if (item.id !== req.params.id) return item;
      if (!item.audio || !audios.some((audio) => audio.playback === item.audio)) throw new Error("Audio da campanha nao encontrado.");
      if (!dialerDestinationExists(config, item.destinationType, item.destination)) throw new Error("Destino da campanha nao encontrado.");
      if (!(item.trunkIds || []).some((id) => configTrunks(config).some((trunk) => trunk.id === id))) throw new Error("Nenhum tronco ativo selecionado para esta campanha.");
      campaign = { ...item, status: "running", nextDialAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      return campaign;
    })
  );
  if (!campaign) return res.status(404).json({ error: "Campanha nao encontrada." });
  res.json({ campaign: publicDialerCampaign(campaign), campaigns: (await readDialerCampaigns()).map(publicDialerCampaign) });
});

app.post("/api/dialer/campaigns/:id/pause", requireAuth, requireAdmin, async (req, res) => {
  let campaign = null;
  await updateDialerCampaigns(async (campaigns) =>
    campaigns.map((item) => {
      if (item.id !== req.params.id) return item;
      campaign = { ...item, status: "paused", updatedAt: new Date().toISOString() };
      return campaign;
    })
  );
  if (!campaign) return res.status(404).json({ error: "Campanha nao encontrada." });
  res.json({ campaign: publicDialerCampaign(campaign), campaigns: (await readDialerCampaigns()).map(publicDialerCampaign) });
});

app.post("/api/dialer/campaigns/:id/reset", requireAuth, requireAdmin, async (req, res) => {
  let campaign = null;
  await updateDialerCampaigns(async (campaigns) =>
    campaigns.map((item) => {
      if (item.id !== req.params.id) return item;
      campaign = {
        ...item,
        status: "draft",
        nextDialAt: "",
        updatedAt: new Date().toISOString(),
        numbers: (item.numbers || []).map((lead) => ({ ...lead, status: "pending", attempts: 0, lastAttemptAt: "", lastResult: "" }))
      };
      return campaign;
    })
  );
  if (!campaign) return res.status(404).json({ error: "Campanha nao encontrada." });
  res.json({ campaign: publicDialerCampaign(campaign), campaigns: (await readDialerCampaigns()).map(publicDialerCampaign) });
});

app.delete("/api/dialer/campaigns/:id", requireAuth, requireAdmin, async (req, res) => {
  let removed = null;
  await updateDialerCampaigns(async (campaigns) => {
    removed = campaigns.find((item) => item.id === req.params.id) || null;
    return campaigns.filter((item) => item.id !== req.params.id);
  });
  if (!removed) return res.status(404).json({ error: "Campanha nao encontrada." });
  res.json({ ok: true, campaigns: (await readDialerCampaigns()).map(publicDialerCampaign) });
});

app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, req, res, _next) => {
  console.error(`[http] ${req.method} ${req.originalUrl}:`, error);
  if (res.headersSent) return;
  const status = Number(error.status || error.statusCode) || 500;
  res.status(status).json({
    error: status >= 500 ? "Falha interna ao processar a solicitacao" : error.message,
    ...(Array.isArray(error.conflicts) ? { conflicts: error.conflicts } : {}),
    ...(process.env.NODE_ENV === "development" ? { detail: error.message } : {})
  });
});

async function startServer() {
  await ensureStore();
  const config = await getConfig();
  await generateAsteriskConfigs(config);
  await syncStoredQueuePauses();
  startDialerEngine();
  startMaintenanceJobs();
  return app.listen(port, host, () => {
    console.log(`PBX SIP Admin rodando em http://${host}:${port}`);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Falha ao iniciar PBX SIP Admin:", error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
  _test: {
    configForUser,
    configRevision,
    configSectionRevisions,
    mergeConfigSections,
    assertSectionRevisions,
    requireAdmin,
    requireSupervisor,
    applyReportFilters,
    csvEscape,
    inferReportExtension,
    inferReportType,
    parseReportFilters,
    pbxStatusForScope,
    recordingDownloadName,
    sanitizeAuditValue,
    userCanInterveneLiveCalls,
    userCanMonitorExtension,
    userRole
  }
};
