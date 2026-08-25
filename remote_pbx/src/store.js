const fs = require("fs-extra");
const path = require("path");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("./db");

const rootDir = path.join(__dirname, "..");
const dataDir = path.join(rootDir, "data");
const generatedDir = path.join(rootDir, "generated", "asterisk");
const ivrAudioDir = path.join(dataDir, "ivr-audio");
const configPath = path.join(dataDir, "config.json");
const usersPath = path.join(dataDir, "users.json");
const presenceHistoryPath = path.join(dataDir, "extension-presence.json");
const auditLogPath = path.join(dataDir, "recording-audit.json");

function mergeOutboundRules(config) {
  const providedRules = config.outboundRules || {};
  return Object.fromEntries(
    Object.entries(defaultConfig.outboundRules).map(([ruleName, ruleConfig]) => [
      ruleName,
      {
        ...ruleConfig,
        ...(providedRules[ruleName] || {}),
        patterns: [...new Set([...(ruleConfig.patterns || []), ...(((providedRules[ruleName] || {}).patterns || []))])]
      }
    ])
  );
}

function normalizeTrunkId(value, fallback = "trunk-operadora") {
  const clean = String(value || "").trim().replace(/[^a-zA-Z0-9_.-]/g, "-").replace(/-+/g, "-");
  return clean || fallback;
}

function normalizeTrunk(item = {}, index = 0) {
  const id = normalizeTrunkId(item.id || item.endpoint || (index === 0 ? "trunk-operadora" : `trunk-${index + 1}`), index === 0 ? "trunk-operadora" : `trunk-${index + 1}`);
  return {
    ...defaultConfig.trunk,
    ...item,
    id,
    name: String(item.name || item.label || (index === 0 ? "Operadora principal" : `Operadora ${index + 1}`)).trim(),
    port: Number(item.port) || 5060,
    transport: ["udp", "tcp", "tls"].includes(item.transport) ? item.transport : "udp",
    codecs: Array.isArray(item.codecs) ? item.codecs : String(item.codecs || "alaw,ulaw").split(",").map((codec) => codec.trim()).filter(Boolean),
    simultaneousCalls: Number(item.simultaneousCalls) || 4,
    inboundDestinationType: item.inboundDestinationType || "",
    inboundDestination: item.inboundDestination || "",
    active: item.active !== false
  };
}

function normalizeTrunks(config = {}) {
  const base = Array.isArray(config.trunks) && config.trunks.length ? config.trunks : [{ ...(config.trunk || {}), id: "trunk-operadora", name: "Operadora principal" }];
  const trunks = base.map((item, index) => normalizeTrunk(item, index));
  if (config.trunk && Object.keys(config.trunk).length) {
    const main = normalizeTrunk({ ...config.trunk, id: trunks[0]?.id || "trunk-operadora", name: trunks[0]?.name || "Operadora principal" }, 0);
    if (trunks.length) trunks[0] = { ...trunks[0], ...main };
    else trunks.push(main);
  }
  return trunks;
}

const defaultConfig = {
  company: {
    name: "PBX Empresarial",
    timezone: "America/Sao_Paulo"
  },
  trunk: {
    mainNumber: "",
    sipUser: "",
    sipPassword: "",
    sipServer: "",
    port: 5060,
    transport: "udp",
    codecs: ["alaw", "ulaw"],
    simultaneousCalls: 4
  },
  trunks: [],
  extensions: [
    {
      number: "201",
      name: "Recepcao",
      department: "Recepcao",
      secret: "Rcp-201-8f47A2",
      voicemail: true,
      recordCalls: true,
      permissions: ["local", "mobile"],
      blockExtension: false,
      bridgeMode: false,
      temporary: false,
      monthlyQuotaValue: 0,
      monthlyQuotaMinutes: 0,
      timeoutLimit: 0,
      extensionType: "Padrao",
      dialGroup: "PADRAO",
      pickupGroup: "-",
      costCenter: "Padrao"
    },
    {
      number: "202",
      name: "Financeiro",
      department: "Financeiro",
      secret: "Fin-202-4b92C7",
      voicemail: true,
      recordCalls: true,
      permissions: ["local", "mobile", "ddd"],
      blockExtension: false,
      bridgeMode: false,
      temporary: false,
      monthlyQuotaValue: 0,
      monthlyQuotaMinutes: 0,
      timeoutLimit: 0,
      extensionType: "Padrao",
      dialGroup: "PADRAO",
      pickupGroup: "-",
      costCenter: "Padrao"
    },
    {
      number: "203",
      name: "Comercial",
      department: "Comercial",
      secret: "Com-203-5d61E9",
      voicemail: true,
      recordCalls: true,
      permissions: ["local", "mobile", "ddd"],
      blockExtension: false,
      bridgeMode: false,
      temporary: false,
      monthlyQuotaValue: 0,
      monthlyQuotaMinutes: 0,
      timeoutLimit: 0,
      extensionType: "Padrao",
      dialGroup: "PADRAO",
      pickupGroup: "-",
      costCenter: "Padrao"
    },
    {
      number: "204",
      name: "Suporte",
      department: "Suporte",
      secret: "Sup-204-3c58F1",
      voicemail: true,
      recordCalls: true,
      permissions: ["local", "mobile", "ddd"],
      blockExtension: false,
      bridgeMode: false,
      temporary: false,
      monthlyQuotaValue: 0,
      monthlyQuotaMinutes: 0,
      timeoutLimit: 0,
      extensionType: "Padrao",
      dialGroup: "PADRAO",
      pickupGroup: "-",
      costCenter: "Padrao"
    },
    {
      number: "205",
      name: "Diretoria",
      department: "Diretoria",
      secret: "Dir-205-9a73H6",
      voicemail: true,
      recordCalls: true,
      permissions: ["local", "mobile", "ddd", "international", "special"],
      blockExtension: false,
      bridgeMode: false,
      temporary: false,
      monthlyQuotaValue: 0,
      monthlyQuotaMinutes: 0,
      timeoutLimit: 0,
      extensionType: "Padrao",
      dialGroup: "PADRAO",
      pickupGroup: "-",
      costCenter: "Padrao"
    }
  ],
  inboundRoutes: [
    {
      id: "main",
      name: "Entrada principal",
      did: "",
      destinationType: "extension",
      destination: "700"
    }
  ],
  ivr: {
    id: "main",
    name: "URA principal",
    active: true,
    greeting: "custom/ura-principal",
    greetingDescription: "Bem-vindo. Digite 1 para Comercial, 2 para Financeiro, 3 para Suporte ou 0 para Recepcao.",
    invalidAudio: "",
    timeoutAudio: "",
    timeoutSeconds: 20,
    allowDirectDial: false,
    menuRepeat: 3,
    timeoutDestination: "201",
    invalidDestination: "201",
    menus: [],
    looseOptions: [],
    timeConditions: [],
    hiddenTargetCards: [],
    flowLayout: {},
    options: [
      { digit: "1", label: "Comercial", description: "Encaminha para o Comercial.", announcement: "", destinationType: "extension", destination: "203" },
      { digit: "2", label: "Financeiro", description: "Encaminha para o Financeiro.", announcement: "", destinationType: "extension", destination: "202" },
      { digit: "3", label: "Suporte", description: "Encaminha para a fila do Suporte.", announcement: "", destinationType: "queue", destination: "support" },
      { digit: "0", label: "Recepcao", description: "Encaminha para a Recepcao.", announcement: "", destinationType: "ringGroup", destination: "reception" }
    ]
  },
  ringGroups: [
    {
      id: "reception",
      name: "Grupo Recepcao",
      strategy: "ringall",
      members: ["201"],
      timeout: 25,
      fallback: "201"
    }
  ],
  queues: [
    {
      id: "support",
      number: "600",
      name: "Fila Suporte",
      strategy: "ringall",
      members: ["204"],
      timeout: 20,
      maxWait: 300,
      fallback: "201"
    }
  ],
  outboundRules: {
    local: {
      label: "Local",
      patterns: ["_XXXXXXX", "_XXXXXXXX"]
    },
    mobile: {
      label: "Celular",
      patterns: ["_9XXXXXXXX", "_09XXXXXXXX"]
    },
    ddd: {
      label: "DDD",
      patterns: [
        "_[1-9][1-9]XXXXXXXX",
        "_[1-9][1-9]XXXXXXXXX",
        "_[1-9][1-9]9XXXXXXXX",
        "_55[1-9][1-9]XXXXXXXX",
        "_55[1-9][1-9]XXXXXXXXX",
        "_0[1-9][1-9]XXXXXXXX",
        "_0[1-9][1-9]XXXXXXXXX",
        "_0[1-9][1-9]9XXXXXXXX",
        "_055[1-9][1-9]XXXXXXXX",
        "_055[1-9][1-9]XXXXXXXXX"
      ]
    },
    international: {
      label: "Internacional",
      patterns: ["_00X."]
    },
    special: {
      label: "Especiais",
      patterns: ["_0800X.", "_0300X.", "_0500X."]
    }
  },
  outbound: {
    defaultTrunk: "trunk-operadora",
    dialPrefix: "",
    stripDigits: 0,
    areaCode: "",
    prependAreaCodeToLocal: true,
    nationalPrefix: "0",
    emergencyEnabled: true,
    emergencyNumbers: ["190", "192", "193"],
    notes: "Selecione o tronco padrao e salve/aplique para as saidas usarem esse tronco."
  },
  businessHours: {
    enabled: true,
    timezone: "America/Sao_Paulo",
    weekdays: ["mon", "tue", "wed", "thu", "fri"],
    start: "08:00",
    end: "18:00",
    afterHoursDestinationType: "extension",
    afterHoursDestination: "700"
  },
  recording: {
    enabled: true,
    format: "wav",
    path: "/var/spool/asterisk/monitor"
  },
  voicemail: {
    enabled: true,
    emailDomain: "empresa.local",
    defaultPin: "123456"
  },
  security: {
    requireStrongPasswords: true,
    blockInternationalByDefault: true,
    fail2banEnabled: true,
    firewallEnabled: true,
    tlsEnabled: false,
    srtpEnabled: false,
    publicAddress: "",
    allowedSipNetworks: ["192.168.0.0/16", "10.0.0.0/8"],
    localNetworks: ["192.168.0.0/16", "10.0.0.0/8"],
    rtpPortStart: 10000,
    rtpPortEnd: 20000
  }
};

async function ensureStore() {
  await fs.ensureDir(dataDir);
  await fs.ensureDir(generatedDir);
  await fs.ensureDir(ivrAudioDir);

  if (!(await fs.pathExists(configPath))) {
    const initialConfig = JSON.parse(JSON.stringify(defaultConfig));
    initialConfig.extensions = initialConfig.extensions.map((extension) => ({
      ...extension,
      secret: `Ext-${extension.number}-${crypto.randomBytes(8).toString("hex")}`
    }));
    await fs.writeJson(configPath, initialConfig, { spaces: 2 });
  }

  if (!(await fs.pathExists(usersPath))) {
    const initialPassword = String(process.env.PBX_INITIAL_ADMIN_PASSWORD || "");
    if (!initialPassword) {
      throw new Error("Defina PBX_INITIAL_ADMIN_PASSWORD para criar o primeiro administrador.");
    }
    const passwordHash = await bcrypt.hash(initialPassword, 12);
    await fs.writeJson(
      usersPath,
      {
        users: [
          {
            username: "admin",
            passwordHash,
            mustChangePassword: true,
            createdAt: new Date().toISOString()
          }
        ]
      },
      { spaces: 2 }
    );
  }

  if (await db.ensureDatabase()) {
    const [databaseConfig, databaseUsers] = await Promise.all([
      db.getConfig(),
      db.getUsers()
    ]);
    if (!databaseConfig) await db.saveConfig(await readConfigJson());
    if (!databaseUsers) await db.saveUsers(await readUsersJson());
  }
}

async function readConfigJson() {
  const config = await fs.readJson(configPath);
  return normalizeConfig(config);
}

function normalizeConfig(config) {
  const extensionTemplate = defaultConfig.extensions[0];
  const trunks = normalizeTrunks(config);
  const defaultTrunk = trunks.find((trunk) => trunk.id === config.outbound?.defaultTrunk)?.id || trunks[0]?.id || "trunk-operadora";
  return {
    ...defaultConfig,
    ...config,
    trunk: { ...defaultConfig.trunk, ...(trunks[0] || {}), ...(config.trunk || {}) },
    trunks,
    outbound: { ...defaultConfig.outbound, ...(config.outbound || {}), defaultTrunk },
    ivr: { ...defaultConfig.ivr, ...(config.ivr || {}) },
    recording: { ...defaultConfig.recording, ...(config.recording || {}) },
    businessHours: { ...defaultConfig.businessHours, ...(config.businessHours || {}) },
    voicemail: { ...defaultConfig.voicemail, ...(config.voicemail || {}) },
    security: { ...defaultConfig.security, ...(config.security || {}) },
    outboundRules: mergeOutboundRules(config),
    extensions: (config.extensions || defaultConfig.extensions).map((extension) => ({
      ...extensionTemplate,
      ...extension
    }))
  };
}

async function getConfig() {
  await ensureStore();
  const databaseConfig = await db.getConfig();
  if (databaseConfig) return normalizeConfig(databaseConfig);
  return readConfigJson();
}

async function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeJson(temporaryPath, value, { spaces: 2 });
  await fs.move(temporaryPath, filePath, { overwrite: true });
}

async function saveConfig(config) {
  await ensureStore();
  const merged = normalizeConfig(config);
  const databaseEnabled = await db.ensureDatabase();
  if (databaseEnabled) await db.saveConfig(merged);
  try {
    await writeJsonAtomic(configPath, merged);
  } catch (error) {
    if (!databaseEnabled) throw error;
    console.warn(`[store] Configuracao salva no PostgreSQL, mas o espelho JSON falhou: ${error.message}`);
  }
  return merged;
}

async function readUsersJson() {
  return fs.readJson(usersPath);
}

async function getUsers() {
  await ensureStore();
  const databaseUsers = await db.getUsers();
  return databaseUsers || readUsersJson();
}

async function saveUsers(users) {
  await ensureStore();
  const databaseEnabled = await db.ensureDatabase();
  if (databaseEnabled) await db.saveUsers(users);
  try {
    await writeJsonAtomic(usersPath, users);
  } catch (error) {
    if (!databaseEnabled) throw error;
    console.warn(`[store] Usuarios salvos no PostgreSQL, mas o espelho JSON falhou: ${error.message}`);
  }
}

async function readPresenceHistory() {
  await ensureStore();
  const databaseHistory = await db.readPresenceHistory();
  if (databaseHistory) return databaseHistory;
  if (!(await fs.pathExists(presenceHistoryPath))) return { events: [] };
  return fs.readJson(presenceHistoryPath).catch(() => ({ events: [] }));
}

async function appendPresenceEvents(events = []) {
  const cleanEvents = events.filter(Boolean);
  if (!cleanEvents.length) return;
  await ensureStore();
  if (await db.appendPresenceEvents(cleanEvents)) return;
  const history = await readPresenceHistory();
  history.events = [...(history.events || []), ...cleanEvents].slice(-100000);
  await fs.writeJson(presenceHistoryPath, history, { spaces: 2 });
}

async function readAuditLog() {
  await ensureStore();
  const databaseEvents = await db.readRecordingAuditEvents?.(500);
  if (databaseEvents) return { events: databaseEvents };
  if (!(await fs.pathExists(auditLogPath))) return { events: [] };
  return fs.readJson(auditLogPath).catch(() => ({ events: [] }));
}

async function writeRecordingAuditEvent(event) {
  await ensureStore();
  if (await db.writeRecordingAuditEvent(event)) return;
  const audit = await readAuditLog();
  audit.events = audit.events || [];
  audit.events.push({
    ...event,
    accessedAt: new Date().toISOString()
  });
  audit.events = audit.events.slice(-5000);
  await fs.writeJson(auditLogPath, audit, { spaces: 2 });
}

async function getReportCdrRows() {
  await ensureStore();
  return db.getCdrRows();
}

module.exports = {
  rootDir,
  dataDir,
  generatedDir,
  ivrAudioDir,
  configPath,
  usersPath,
  presenceHistoryPath,
  auditLogPath,
  defaultConfig,
  ensureStore,
  getConfig,
  saveConfig,
  getUsers,
  saveUsers,
  readPresenceHistory,
  appendPresenceEvents,
  readAuditLog,
  writeRecordingAuditEvent,
  getReportCdrRows
};
