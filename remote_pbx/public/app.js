const MONITOR_REFRESH_MS = 1000;
const BACKGROUND_STATUS_REFRESH_MS = 15000;
const WEB_SIP_REGISTER_EXPIRES_SECONDS = 8 * 60 * 60;
const WEBRTC_ICE_GATHERING_TIMEOUT_MS = 750;
const PAUSE_REASONS = ["Cafezinho", "Almoço", "Treinamento", "Atendimento presencial"];
const CONFIG_SECTION_KEYS = [
  "company", "trunk", "trunks", "extensions", "inboundRoutes", "ivr", "ringGroups",
  "queues", "outboundRules", "outbound", "businessHours", "recording", "voicemail", "security"
];

function storedTheme() {
  try {
    return localStorage.getItem("pbx-theme") === "dark" ? "dark" : "light";
  } catch (_error) {
    return "light";
  }
}

function storedSidebarCollapsed() {
  try {
    return localStorage.getItem("pbx-sidebar-collapsed") === "true";
  } catch (_error) {
    return false;
  }
}

function saveSidebarCollapsed(collapsed) {
  try {
    localStorage.setItem("pbx-sidebar-collapsed", collapsed ? "true" : "false");
  } catch (_error) {
    // Preferencia visual local.
  }
}

const MONITOR_COMPACT_STORAGE_KEY = "pbx-monitor-compact";
const compactMonitorFieldOptions = [
  ["calls", "Feitas/recebidas"],
  ["duration", "Duração atual"],
  ["number", "Número em ligação"],
  ["pause", "Pausa"],
  ["idle", "Tempo ocioso"],
  ["online", "Tempo online"]
];
const compactMonitorStatusOptions = [
  ["available", "Disponível"],
  ["ringing", "Tocando"],
  ["busy", "Ocupado"],
  ["paused", "Pausa"],
  ["unavailable", "Offline"]
];
const MONITOR_SPY_MODES = Object.freeze({
  listen: { label: "Escutar", actionLabel: "Iniciar escuta", liveLabel: "Escuta ao vivo", icon: "headphones", microphone: false },
  whisper: { label: "Sussurrar", actionLabel: "Iniciar sussurro", liveLabel: "Sussurro ao vivo", icon: "message-circle", microphone: true },
  barge: { label: "Intervir", actionLabel: "Iniciar intervencao", liveLabel: "Intervencao ao vivo", icon: "messages-square", microphone: true }
});
let monitorSpyPreparation = null;

function defaultMonitorCompactSettings() {
  return {
    view: "compact",
    settingsOpen: false,
    queueSearch: "",
    hiddenQueues: [],
    fields: { calls: true, duration: true, number: true, pause: true, idle: true, online: false },
    statuses: { available: true, ringing: true, busy: true, paused: true, unavailable: true }
  };
}

function storedMonitorCompactSettings() {
  try {
    const parsed = JSON.parse(localStorage.getItem(MONITOR_COMPACT_STORAGE_KEY) || "{}");
    const defaults = defaultMonitorCompactSettings();
    return {
      ...defaults,
      ...parsed,
      fields: { ...defaults.fields, ...(parsed.fields || {}) },
      statuses: { ...defaults.statuses, ...(parsed.statuses || {}) },
      hiddenQueues: Array.isArray(parsed.hiddenQueues) ? parsed.hiddenQueues.map(String) : []
    };
  } catch (_error) {
    return defaultMonitorCompactSettings();
  }
}

function saveMonitorCompactSettings() {
  try {
    const { settingsOpen: _settingsOpen, queueSearch: _queueSearch, ...persisted } = state.monitorCompact || {};
    localStorage.setItem(MONITOR_COMPACT_STORAGE_KEY, JSON.stringify(persisted));
  } catch (_error) {
    // Preferencias locais podem falhar em navegadores restritos.
  }
}

function todayKey() {
  return new Date().toLocaleDateString("en-CA");
}

function initialExtensionCallState(overrides = {}) {
  return {
    ua: null,
    registerer: null,
    registrationStatus: "offline",
    stopping: false,
    session: null,
    status: "desconectado",
    message: "",
    dialNumber: "",
    transferTarget: "",
    muted: false,
    speakerMuted: false,
    volume: 85,
    audioSettingsOpen: false,
    audioOutputs: [],
    audioInputs: [],
    callDeviceId: "",
    micDeviceId: "",
    held: false,
    incoming: false,
    currentNumber: "",
    currentDirection: "",
    currentProtocol: "",
    startedAt: null,
    endedAt: null,
    lastDialPreview: null,
    autoAnswerNext: false,
    activeHistoryId: null,
    ringtoneContext: null,
    ringtoneTimer: null,
    ringtoneNodes: [],
    desktopNotification: null,
    consultSession: null,
    consultTarget: "",
    consultStatus: "",
    queuePaused: false,
    pauseStartedAt: null,
    pauseQueues: [],
    pauseReason: "",
    pauseReasonPickerOpen: false,
    floatingPhoneOpen: false,
    floatingPhoneX: null,
    floatingPhoneY: null,
    floatingPhoneWidth: 360,
    floatingPhoneHeight: 620,
    phonePipWindow: null,
    history: [],
    ...overrides
  };
}

const state = {
  user: null,
  extensionSession: null,
  extensionPortal: null,
  extensionStatus: null,
  extensionStatusRefreshing: null,
  extensionCall: initialExtensionCallState(),
  config: null,
  configBaseline: null,
  theme: storedTheme(),
  sidebarCollapsed: storedSidebarCollapsed(),
  activeTab: "overview",
  overview: {
    date: todayKey(),
    queue: "",
    extension: "",
    search: "",
    calls: [],
    dashboard: {}
  },
  reports: [],
  pbxReports: {
    calls: [],
    dashboard: null,
    charts: null,
    presence: [],
    pauses: { summary: [], events: [] },
    meta: { page: 1, pageSize: 25, total: 0, pages: 1, sortBy: "startedAt", sortDir: "desc", permissions: {} },
    filtersOpen: false,
    compactOpen: { presence: false, pauses: false, charts: false, calls: true },
    loading: false,
    filters: {}
  },
  recordingLibrary: {
    view: "calls",
    calls: [],
    meta: { page: 1, pageSize: 20, total: 0, pages: 1, permissions: {} },
    filters: {},
    filtersOpen: false,
    loading: false
  },
  systemView: { scope: "all" },
  auditView: { page: 1, pageSize: 20, filters: {} },
  users: [],
  auditEvents: [],
  monitorSpy: { open: false, target: "", mode: "listen", output: "", status: "", busy: false, ua: null, registerer: null, session: null, sip: null, allowedModes: null },
  monitorCompact: storedMonitorCompactSettings(),
  inboundCalls: { cdr: [], rejected: [] },
  pbxStatus: null,
  trunkRegistrationStates: {},
  pbxStatusRefreshing: false,
  ivrFullscreen: false,
  ivrBuilderOpen: new URLSearchParams(window.location.search).has("edit"),
  ivrEditingMenuId: new URLSearchParams(window.location.search).get("edit") || "main",
  ivrLinkSource: null,
  ivrDrag: null,
  ivrCanvasPan: null,
  floatingPhoneDrag: null,
  floatingPhoneResize: null,
  ivrContextMenu: null,
  generatedPreview: "",
  outboundDiagnostics: { logs: [], preview: null },
  ivrAudios: [],
  dialerCampaigns: [],
  dialerDestinations: { queues: [], extensions: [] },
  dialerTrunks: [],
  dialerTrunkHealth: {},
  dialerEditingId: "",
  dialerEditorOpen: false,
  dialerEditingNew: false,
  ivrZoom: 1,
  ivrViewport: null,
  ivrViewports: {},
  editingExtensionIndex: null,
  editingExtensionNew: false,
  editingTrunkIndex: null,
  editingTrunkNew: false,
  editingQueueIndex: null,
  editingQueueNew: false,
  editingRouteIndex: null,
  editingRouteNew: false,
  editingUserIndex: null,
  editingUserNew: false,
  openExtensionDetails: {},
  openQueueDetails: {}
};

const pages = {
  overview: document.querySelector("#tab-overview"),
  status: document.querySelector("#tab-status"),
  trunk: document.querySelector("#tab-trunk"),
  extensions: document.querySelector("#tab-extensions"),
  routing: document.querySelector("#tab-routing"),
  ivr: document.querySelector("#tab-ivr"),
  dialer: document.querySelector("#tab-dialer"),
  audios: document.querySelector("#tab-audios"),
  ivrAudios: document.querySelector("#tab-ivrAudios"),
  queues: document.querySelector("#tab-queues"),
  security: document.querySelector("#tab-security"),
  logs: document.querySelector("#tab-logs"),
  reports: document.querySelector("#tab-reports"),
  audit: document.querySelector("#tab-audit"),
  users: document.querySelector("#tab-users")
};
const monitorStatusContent = document.querySelector("#monitorStatusContent");
const monitorSpyPortal = document.querySelector("#monitorSpyPortal");

const titleByTab = {
  overview: "Visao Geral",
  status: "Monitor de Filas",
  trunk: "Troncos",
  extensions: "Ramais",
  routing: "Rotas e regras",
  ivr: "URAs",
  dialer: "Discador",
  audios: "Gravações",
  ivrAudios: "Áudios da URA",
  queues: "Filas de atendimento",
  security: "Seguranca",
  logs: "Sistema",
  reports: "Relatorios",
  audit: "Auditoria",
  users: "Usuarios"
};

const subtitleByTab = {
  overview: "Indicadores, tendencias e desempenho do atendimento",
  status: "Acompanhamento em tempo real de filas e agentes",
  trunk: "Conexoes com as operadoras de telefonia",
  extensions: "Cadastro, presenca e recursos dos ramais",
  routing: "Regras de entrada, saida e permissoes",
  ivr: "Fluxos de atendimento automatico",
  dialer: "Campanhas e chamadas de saida",
  audios: "Pesquisa, reproducao e organizacao das gravacoes",
  ivrAudios: "Mensagens usadas no atendimento automático e nas campanhas",
  queues: "Equipes, estrategias e distribuicao de chamadas",
  security: "Protecao e politicas do ambiente",
  logs: "Saude, conectividade e eventos do PBX",
  reports: "Indicadores e historico operacional",
  audit: "Rastreabilidade das alteracoes",
  users: "Acessos e permissoes administrativas"
};

const menuPermissions = {
  overview: "overview",
  reports: "reports",
  status: "status",
  trunk: "trunk",
  extensions: "extensions",
  routing: "routing",
  ivr: "ivr",
  dialer: "dialer",
  audios: "audios",
  ivrAudios: "ivrAudios",
  queues: "queues",
  logs: "logs",
  security: "security",
  audit: "audit",
  users: "users"
};

const userMenuGroups = [
  {
    label: "Operacao",
    icon: "activity",
    tabs: ["overview", "status", "reports", "audios", "queues", "extensions", "dialer"]
  },
  {
    label: "Telefonia",
    icon: "phone",
    tabs: ["trunk", "routing", "ivr", "ivrAudios"]
  },
  {
    label: "Governanca",
    icon: "shield-check",
    tabs: ["logs", "security", "audit", "users"]
  }
];

const adminOnlyTabs = new Set(["trunk", "extensions", "routing", "ivr", "logs", "security", "audit", "users"]);

const tabRoutes = {
  overview: "/resume",
  reports: "/reports",
  status: "/monitor",
  trunk: "/trunk",
  extensions: "/extensions",
  routing: "/routes",
  ivr: "/ura",
  dialer: "/dialer",
  audios: "/audios",
  ivrAudios: "/audios-ura",
  queues: "/queues",
  logs: "/logs",
  security: "/security",
  audit: "/audit",
  users: "/users"
};

const routeTabs = {
  "/": "overview",
  "/resume": "overview",
  "/resumo": "overview",
  "/overview": "overview",
  "/reports": "reports",
  "/relatorios": "reports",
  "/monitor": "status",
  "/status": "status",
  "/trunk": "trunk",
  "/troncos": "trunk",
  "/extensions": "extensions",
  "/ramais": "extensions",
  "/routes": "routing",
  "/rotas": "routing",
  "/routing": "routing",
  "/ura": "ivr",
  "/ivr": "ivr",
  "/dialer": "dialer",
  "/discador": "dialer",
  "/audios": "audios",
  "/audios-ura": "ivrAudios",
  "/queues": "queues",
  "/filas": "queues",
  "/logs": "logs",
  "/security": "security",
  "/seguranca": "security",
  "/audit": "audit",
  "/auditoria": "audit",
  "/users": "users",
  "/usuarios": "users"
};

const permissionLabels = {
  local: "Local",
  mobile: "Celular",
  ddd: "DDD",
  international: "Internacional",
  special: "Especiais"
};

const extensionTypeOptions = ["Padrao", "Softphone", "Telefone IP", "Recepcao", "Diretoria", "Temporario"];
const dialGroupOptions = ["PADRAO", "RECEPCAO", "GERAL", "GESTAO", "SUPORTE"];
const pickupGroupOptions = ["-", "RECEPCAO", "GERAL", "SUPORTE"];
const costCenterOptions = ["Padrao", "Recepcao", "Financeiro", "Comercial", "Suporte", "Diretoria"];
const departmentOptions = ["Recepcao", "Financeiro", "Comercial", "Suporte", "Diretoria", "Geral"];

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
}

function surfaceHasActiveEditor(root) {
  const active = document.activeElement;
  return Boolean(root && active && root.contains(active) && active.matches("input, textarea, select, [contenteditable='true']"));
}

function captureSurfaceDraft(root) {
  if (!root) return null;
  const controls = $all("input, textarea, select", root);
  const activeIndex = controls.indexOf(document.activeElement);
  return {
    controls: controls.map((control) => ({
      tag: control.tagName,
      type: control.type || "",
      value: control.type === "file" ? null : control.value,
      checked: Boolean(control.checked),
      selectedValues: control.multiple ? Array.from(control.selectedOptions).map((option) => option.value) : null
    })),
    details: $all("details", root).map((detail) => detail.open),
    activeIndex,
    selectionStart: activeIndex >= 0 && typeof controls[activeIndex].selectionStart === "number" ? controls[activeIndex].selectionStart : null,
    selectionEnd: activeIndex >= 0 && typeof controls[activeIndex].selectionEnd === "number" ? controls[activeIndex].selectionEnd : null,
    scrollX: window.scrollX,
    scrollY: window.scrollY
  };
}

function restoreSurfaceDraft(root, snapshot) {
  if (!root || !snapshot) return;
  const controls = $all("input, textarea, select", root);
  snapshot.controls.forEach((saved, index) => {
    const control = controls[index];
    if (!control || control.tagName !== saved.tag || (control.type || "") !== saved.type) return;
    if (["checkbox", "radio"].includes(control.type)) control.checked = saved.checked;
    else if (control.multiple && saved.selectedValues) {
      const selected = new Set(saved.selectedValues);
      Array.from(control.options).forEach((option) => {
        option.selected = selected.has(option.value);
      });
    } else if (saved.value !== null) control.value = saved.value;
  });
  $all("details", root).forEach((detail, index) => {
    if (snapshot.details[index] !== undefined) detail.open = snapshot.details[index];
  });
  const active = controls[snapshot.activeIndex];
  if (active) {
    active.focus({ preventScroll: true });
    if (snapshot.selectionStart !== null && typeof active.setSelectionRange === "function") {
      const length = String(active.value || "").length;
      active.setSelectionRange(Math.min(snapshot.selectionStart, length), Math.min(snapshot.selectionEnd ?? snapshot.selectionStart, length));
    }
  }
  window.scrollTo(snapshot.scrollX, snapshot.scrollY);
}

function renderSurfaceInBackground(root, render) {
  if (!root || surfaceHasActiveEditor(root)) return false;
  const draft = captureSurfaceDraft(root);
  render();
  restoreSurfaceDraft(root, draft);
  iconRefresh();
  return true;
}

function iconRefresh() {
  $all("[data-upload-dialer-audio]").forEach(button => button.classList.toggle("hidden", !canAccessTab("ivrAudios")));
  persistViewPreferences();
  installLocalSaveActions();
  window.installRecordSearch?.(state.user?.username || "");
  window.installFieldHelp?.();
  const lucide = window.lucide;
  if (!lucide?.createIcons || !lucide.icons) return;
  try {
    lucide.createIcons({ icons: lucide.icons });
  } catch (error) {
    console.warn("Nao foi possivel atualizar os icones da interface.", error);
  }
}

function restoreViewPreferences() {
  if (!state.user?.username || !window.PbxViewPreferences) return;
  try {
    const prefs = window.PbxViewPreferences.read(localStorage, state.user.username);
    state.pbxReports.meta.pageSize = prefs.reportSize;
    state.recordingLibrary.meta.pageSize = prefs.recordingSize;
    state.pbxReports.filtersOpen = prefs.reportFiltersOpen;
    state.recordingLibrary.filtersOpen = prefs.recordingFiltersOpen;
    state.pbxReports.compactOpen = prefs.compactOpen;
  } catch { /* Restricted browsers can still use the default layout. */ }
}

function persistViewPreferences() {
  if (!state.user?.username || !window.PbxViewPreferences) return;
  try {
    window.PbxViewPreferences.write(localStorage, state.user.username, {
      reportSize: state.pbxReports.meta.pageSize,
      recordingSize: state.recordingLibrary.meta.pageSize,
      reportFiltersOpen: state.pbxReports.filtersOpen,
      recordingFiltersOpen: state.recordingLibrary.filtersOpen,
      compactOpen: state.pbxReports.compactOpen
    });
  } catch { /* Never interrupt an operation because a preference cannot be saved. */ }
}

function installLocalSaveActions() {
  if (!state.config) return;
  const surfaces = {
    extensions: { label: "Salvar ramais", selector: "[data-extension-card][data-entity-editor]" },
    trunk: { label: "Salvar troncos", selector: "[data-trunk-card][data-entity-editor]" },
    queues: { label: "Salvar filas", selector: "[data-queue-index][data-entity-editor]" },
    routing: { label: "Salvar rotas", selector: "[data-route-index][data-entity-editor]" },
    security: { label: "Salvar configuracao", selector: ".panel" }
  };
  Object.entries(surfaces).forEach(([tab, { label, selector }]) => {
    if (!pages[tab] || !canAccessTab(tab)) return;
    $all(selector, pages[tab]).forEach((card) => {
      if (!card.querySelector("input, select, textarea") || card.querySelector(":scope > .local-save-bar")) return;
      const bar = document.createElement("div");
      bar.className = "local-save-bar";
      bar.innerHTML = `<span class="local-save-status" role="status"></span><button type="button" class="secondary-btn compact" data-save-config="${tab}"><i data-lucide="save"></i>${label}</button>`;
      card.append(bar);
    });
  });
}

function applyTheme(theme = state.theme) {
  state.theme = theme === "dark" ? "dark" : "light";
  document.documentElement.dataset.theme = state.theme;
  const pipWindow = phonePipWindow();
  if (pipWindow) pipWindow.document.documentElement.dataset.theme = state.theme;
  try {
    localStorage.setItem("pbx-theme", state.theme);
  } catch (_error) {
    // Navegadores em modo restrito podem bloquear localStorage.
  }

  $all("#themeToggleBtn, #extensionThemeToggleBtn").forEach((button) => {
    const dark = state.theme === "dark";
    button.innerHTML = button.id === "themeToggleBtn"
      ? `<i data-lucide="${dark ? "sun" : "moon"}"></i>`
      : `<i data-lucide="${dark ? "sun" : "moon"}"></i><span>${dark ? "Claro" : "Escuro"}</span>`;
    button.title = dark ? "Usar modo claro" : "Usar modo escuro";
    button.setAttribute("aria-label", button.title);
  });
  iconRefresh();
}

function toggleTheme() {
  applyTheme(state.theme === "dark" ? "light" : "dark");
}

function setMessage(message, tone = "info") {
  const target = $("#statusMessage");
  target.textContent = message || "";
  target.style.color = tone === "ok" ? "var(--green)" : "var(--red-700)";
  $all(".local-save-status", pages[state.activeTab] || document).forEach((node) => {
    node.textContent = message || "";
    node.dataset.tone = tone;
  });
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && state.user && !String(path).startsWith("/api/extensions/")) {
      state.user = null;
      state.config = null;
      state.configBaseline = null;
      renderShell();
      const loginMessage = $("#loginMessage");
      if (loginMessage) loginMessage.textContent = "Sua sessao expirou. Entre novamente para continuar.";
    }
    const error = new Error(data.error || "Falha na requisicao");
    error.detail = data.detail;
    error.data = data;
    error.status = response.status;
    throw error;
  }
  return data;
}

function isExtensionAuthError(error) {
  return error?.status === 401 && /ramal/i.test(String(error.message || error.data?.error || ""));
}

function showExtensionLogin(message = "") {
  $("#loginForm")?.classList.add("hidden");
  $("#extensionLoginForm")?.classList.remove("hidden");
  $("#adminLoginModeBtn")?.classList.remove("active");
  $("#extensionLoginModeBtn")?.classList.add("active");
  const target = $("#extensionLoginMessage");
  if (target) target.textContent = message;
  iconRefresh();
}

async function stopExtensionClientPhone() {
  extensionSipRecovery.stop();
  state.extensionCall.stopping = true;
  stopIncomingRingtone();
  await terminateSipSession(state.extensionCall.consultSession).catch(() => {});
  await terminateSipSession(state.extensionCall.session).catch(() => {});
  if (state.extensionCall.registerer) await state.extensionCall.registerer.unregister().catch(() => {});
  if (state.extensionCall.ua) await state.extensionCall.ua.stop().catch(() => {});
}

function notifyExtensionLogoutOnClose() {
  if (!state.extensionSession) return;
  extensionSipRecovery.stop();
  state.extensionCall.stopping = true;
  state.extensionCall.registerer?.unregister?.().catch?.(() => {});
  state.extensionCall.ua?.stop?.().catch?.(() => {});
  const payload = new Blob(["{}"], { type: "application/json" });
  if (navigator.sendBeacon?.("/api/extensions/logout", payload)) return;
  fetch("/api/extensions/logout", {
    method: "POST",
    body: "{}",
    headers: { "Content-Type": "application/json" },
    keepalive: true
  }).catch(() => {});
}

async function resetExtensionSessionAfterAuthError(message = "Sessao do ramal expirou. Faca login novamente.") {
  await stopExtensionClientPhone().catch(() => {});
  state.extensionSession = null;
  state.extensionPortal = null;
  state.extensionStatus = null;
  state.extensionCall = initialExtensionCallState();
  renderShell();
  showExtensionLogin(message);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function readArray(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function cleanId(value, fallback = "item") {
  return String(value || fallback)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "") || fallback;
}

function uniqueQueueId(baseValue) {
  const base = cleanId(baseValue, `fila-${(state.config?.queues || []).length + 1}`);
  const used = new Set((state.config?.queues || []).map((queue) => String(queue.id || "")));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

function queueDialNumber(queue, index = 0) {
  return String(queue?.number || queue?.extension || 600 + index);
}

function nextQueueDialNumber() {
  const used = new Set([
    ...(state.config?.extensions || []).map((ext) => String(ext.number || "")),
    ...(state.config?.queues || []).map((queue, index) => queueDialNumber(queue, index))
  ]);
  let number = 600;
  while (used.has(String(number))) number += 1;
  return String(number);
}

function queueDialNumberConflict(number, ignoreIndex = -1) {
  const value = String(number || "").trim();
  if (!value) return false;
  if ((state.config?.extensions || []).some((ext) => String(ext.number || "") === value)) return true;
  return (state.config?.queues || []).some((queue, index) => index !== ignoreIndex && queueDialNumber(queue, index) === value);
}

function queueLabel(queue, index = 0) {
  const number = queueDialNumber(queue, index);
  return `${number} ${queue.name || queue.id}`;
}

function validateQueueDialNumbers() {
  const used = new Map((state.config?.extensions || []).map((ext) => [String(ext.number || ""), `ramal ${ext.number}`]));
  for (const [index, queue] of (state.config?.queues || []).entries()) {
    const number = queueDialNumber(queue, index);
    if (!number) return `Informe o ramal da fila ${queue.name || queue.id}.`;
    if (used.has(number)) return `O ramal de fila ${number} ja esta em uso por ${used.get(number)}.`;
    used.set(number, `fila ${queue.name || queue.id}`);
  }
  return "";
}

function localDateKey(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}/.test(String(value))) return String(value).slice(0, 10);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString("en-CA");
}

function inferTargetExtension(call) {
  const configured = new Set((state.config?.extensions || []).map((extension) => String(extension.number || "")));
  const normalize = (value) => String(value || "").replace(/^web-/, "").replace(/[^\d]/g, "");
  const candidates = [
    call.extension,
    call.destination,
    call.originalDestination,
    call.dst,
    call.source,
    call.src
  ].map(normalize);
  [call.channel, call.destinationChannel, call.lastData, call.data].forEach((value) => {
    const text = String(value || "");
    const matches = [...text.matchAll(/(?:PJSIP|SIP|Local)\/(?:web-)?(\d+)/gi)];
    matches.forEach((match) => candidates.push(normalize(match[1])));
    const mailbox = text.match(/\b(\d+)@default\b/i);
    if (mailbox) candidates.push(normalize(mailbox[1]));
  });
  return candidates.find((candidate) => configured.has(candidate)) || "";
}

function queueFilterTokens(queue, index = 0) {
  return [...new Set([
    queue?.id,
    queue?.number,
    queue?.extension,
    queueDialNumber(queue, index)
  ].map((value) => String(value || "").trim()).filter(Boolean))];
}

function selectedOverviewQueue() {
  const selected = String(state.overview.queue || "");
  if (!selected) return null;
  return (state.config?.queues || [])
    .map((queue, index) => ({ queue, index, tokens: queueFilterTokens(queue, index) }))
    .find((item) => item.tokens.includes(selected)) || null;
}

function overviewQueueMemberNumbers(queue = {}) {
  return new Set((queue.members || []).map((member) => String(member || "").trim()).filter(Boolean));
}

function callMatchesOverviewQueue(call, queueItem) {
  if (!queueItem) return true;
  const tokens = (queueItem.tokens || []).map((token) => String(token || "").toLowerCase());
  if (call.queue) return tokens.includes(String(call.queue).toLowerCase());
  const context = String(call.context || "").toLowerCase();
  if (tokens.some((token) => context === `queue-${token}`)) return true;
  const queueArgument = /^queue$/i.test(String(call.lastApp || "")) ? String(call.lastData || call.lastdata || "").split(",")[0].trim().toLowerCase() : "";
  return Boolean(queueArgument && tokens.includes(queueArgument));
}

function callMatchesOverviewExtension(call, extensionNumber = "") {
  const selected = String(extensionNumber || "");
  if (!selected) return true;
  return inferTargetExtension(call) === selected || String(call.extension || "") === selected;
}

function isHumanAnsweredCall(call) {
  const status = String(call.status || "").toLowerCase();
  const disposition = String(call.disposition || "").toUpperCase();
  const lastApp = String(call.lastApp || call.lastapp || "").toLowerCase();
  return (status === "answered" || disposition === "ANSWERED") && lastApp !== "voicemail";
}

function formatSeconds(totalSeconds) {
  const total = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

function formatDateTime(value) {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString("pt-BR");
}

function reportTypeIcon(type) {
  if (type === "inbound") return "phone-incoming";
  if (type === "outbound") return "phone-outgoing";
  if (type === "internal") return "repeat-2";
  return "phone";
}

function reportStatusTone(status) {
  if (status === "answered") return "ok";
  if (status === "busy" || status === "no_answer" || status === "canceled") return "warn";
  if (status === "failed" || status === "rejected") return "error";
  return "";
}

function reportFilterParams(extra = {}) {
  const params = new URLSearchParams();
  Object.entries({ ...(state.pbxReports.filters || {}), ...extra }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "") params.set(key, value);
  });
  return params;
}

function downloadUrl(path, extra = {}) {
  const params = reportFilterParams(extra);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

function option(value, selected, label = value) {
  return `<option value="${escapeHtml(value)}" ${value === selected ? "selected" : ""}>${escapeHtml(label)}</option>`;
}

function helpIcon(text) {
  return `<button type="button" class="help-icon" title="${escapeHtml(text)}" aria-label="${escapeHtml(text)}"><i data-lucide="info"></i></button>`;
}

function fieldBlock(label, help, control, className = "") {
  return `
    <label class="${className}">
      <span class="field-title">${escapeHtml(label)} ${helpIcon(help)}</span>
      ${control}
    </label>
  `;
}

function choiceOptions(baseOptions, currentValue = "") {
  return [...new Set([...baseOptions, ...(currentValue ? [currentValue] : [])].filter(Boolean))];
}

function audioChoices(selected) {
  const current = selected ? [{ playback: selected, label: selected, url: "" }] : [];
  const items = [...current, ...(state.ivrAudios || [])].filter(
    (item, index, list) => list.findIndex((candidate) => candidate.playback === item.playback) === index
  );
  return option("", selected || "", "Sem audio") + items.map((item) => option(item.playback, selected || "", item.label)).join("");
}

function destinationChoices(selectedType, selectedValue) {
  const cfg = state.config;
  const extensionOptions = [["700", "700 URA principal"], ...cfg.extensions.map((ext) => [ext.number, `${ext.number} ${ext.name}`])];
  const groups = [
    ["none", "Nenhum", [["", "Sem encaminhamento"]]],
    ["extension", "Ramal", extensionOptions],
    ["ivr", "URA", ivrMenuRecords().map((record) => [record.id, record.menu.name || record.id])],
    ["ringGroup", "Grupo", cfg.ringGroups.map((group) => [group.id, group.name])],
    ["queue", "Fila", cfg.queues.map((queue, index) => [queue.id, queueLabel(queue, index)])],
    ["trunk", "Tronco", ensureConfigTrunks().map((trunk) => [trunk.id, trunkLabel(trunk)])]
  ];
  return `
    <select data-destination-type>
      ${groups.map(([type, label]) => option(type, selectedType, label)).join("")}
    </select>
    <select data-destination-value>
      ${groups
        .find(([type]) => type === selectedType)?.[2]
        .map(([value, label]) => option(value, selectedValue, label))
        .join("") || option(selectedValue, selectedValue)}
    </select>
  `;
}

function destinationLabel(type, value) {
  const cfg = state.config;
  if (type === "none" || type === "voicemail") return "Nenhum";
  if (type === "extension" && value === "700") return "700 URA principal";
  if (type === "extension") {
    const ext = cfg.extensions.find((item) => item.number === value);
    return ext ? `${ext.number} ${ext.name}` : value || "Ramal";
  }
  if (type === "ivr") return ivrMenuLabel(value || "main");
  if (type === "trunk") {
    const trunk = ensureConfigTrunks().find((item) => item.id === value);
    return trunk ? `Tronco ${trunkLabel(trunk)}` : value || "Tronco";
  }
  if (type === "timeCondition") return `Horario ${timeConditionLabel(value)}`;
  if (type === "ringGroup") return cfg.ringGroups.find((item) => item.id === value)?.name || value || "Grupo";
  if (type === "queue") {
    const index = cfg.queues.findIndex((item) => item.id === value);
    const queue = cfg.queues[index];
    return queue ? queueLabel(queue, index) : value || "Fila";
  }
  return value || "Destino";
}

function ensureIvrMenus() {
  const ivr = state.config.ivr;
  ivr.menus = Array.isArray(ivr.menus) ? ivr.menus : [];
  return ivr.menus;
}

function ivrMenuRecords({ includeInactive = true } = {}) {
  const ivr = state.config.ivr;
  const records = [
    {
      id: "main",
      key: "main",
      menuKey: "main",
      index: -1,
      isMain: true,
      menu: ivr,
      active: true
    },
    ...ensureIvrMenus().map((menu, index) => ({
      id: menu.id || `menu-${index + 1}`,
      key: menu.id || `menu-${index + 1}`,
      menuKey: String(index),
      index,
      isMain: false,
      menu,
      active: menu.active !== false
    }))
  ];
  return includeInactive ? records : records.filter((record) => record.active);
}

function ivrMenuRecordById(id = "main") {
  const key = id === "main" ? "main" : String(id || "");
  return ivrMenuRecords().find((record) => record.id === key);
}

function ivrEditingRecord() {
  return ivrMenuRecordById(state.ivrEditingMenuId || "main");
}

function currentIvrWorkspaceMenu() {
  return (state.ivrBuilderOpen || state.ivrFullscreen ? ivrEditingRecord()?.menu : null) || state.config.ivr;
}

function eachIvrMenu(callback) {
  [state.config.ivr, ...ensureIvrMenus()].forEach((menu) => callback(menu));
}

function setIvrBuilderRoute(menuId = "main", { replace = true } = {}) {
  if (state.activeTab !== "ivr") return;
  const route = `/ura?edit=${encodeURIComponent(menuId || "main")}`;
  if (replace) window.history.replaceState({ tab: "ivr", edit: menuId || "main" }, "", route);
  else window.history.pushState({ tab: "ivr", edit: menuId || "main" }, "", route);
}

function clearIvrBuilderRoute({ replace = true } = {}) {
  if (state.activeTab !== "ivr") return;
  if (replace) window.history.replaceState({ tab: "ivr" }, "", "/ura");
  else window.history.pushState({ tab: "ivr" }, "", "/ura");
}

function openIvrBuilder(menuId = "main", { replace = true } = {}) {
  state.ivrEditingMenuId = menuId || "main";
  state.ivrBuilderOpen = true;
  state.ivrLinkSource = null;
  state.ivrContextMenu = null;
  setIvrBuilderRoute(state.ivrEditingMenuId, { replace });
}

function closeIvrBuilder({ replace = true } = {}) {
  state.ivrBuilderOpen = false;
  state.ivrFullscreen = false;
  state.ivrLinkSource = null;
  state.ivrContextMenu = null;
  clearIvrBuilderRoute({ replace });
}

function syncIvrBuilderFromRoute() {
  if (state.activeTab !== "ivr") return;
  const editId = new URLSearchParams(window.location.search).get("edit");
  if (editId && !ivrMenuRecordById(editId)) {
    closeIvrBuilder();
    return;
  }
  if (editId) {
    state.ivrBuilderOpen = true;
    state.ivrEditingMenuId = editId;
    return;
  }
  if (!state.ivrFullscreen) {
    state.ivrBuilderOpen = false;
    state.ivrLinkSource = null;
    state.ivrContextMenu = null;
  }
}

function ivrMenuLabel(id) {
  const ivr = state.config.ivr;
  if (id === "main") return ivr.name || "URA principal";
  const menu = (ivr.menus || []).find((item) => item.id === id);
  return menu?.name || id || "Menu";
}

function ivrTargetChoices(selectedType = "extension", selectedValue = "", currentMenuId = "", excludedTimeConditionId = "") {
  const cfg = state.config;
  const menus = ivrMenuRecords({ includeInactive: false })
    .map((record) => [record.id, record.menu.name || record.id])
    .filter(([id]) => id && id !== currentMenuId);
  if (selectedType === "ivr" && selectedValue && selectedValue !== currentMenuId && !menus.some(([value]) => value === selectedValue)) {
    menus.push([selectedValue, `${ivrMenuLabel(selectedValue)} (inativa)`]);
  }
  const timeConditions = ensureIvrTimeConditions()
    .filter((condition) => condition.id !== excludedTimeConditionId)
    .map((condition) => [condition.id, condition.name || condition.id]);
  const groups = [
    ["extension", "Ramal", cfg.extensions.map((ext) => [ext.number, `${ext.number} ${ext.name}`])],
    ["ringGroup", "Grupo", cfg.ringGroups.map((group) => [group.id, group.name])],
    ["queue", "Fila", cfg.queues.map((queue, index) => [queue.id, queueLabel(queue, index)])],
    ["ivr", "Menu URA", menus],
    ["trunk", "Tronco", ensureConfigTrunks().map((trunk) => [trunk.id, trunkLabel(trunk)])],
    ["timeCondition", "Horário", timeConditions]
  ];
  if (selectedType && !groups.some(([type]) => type === selectedType)) groups.push([selectedType, selectedType, []]);
  const values = groups.find(([type]) => type === selectedType)?.[2] || [];
  if (selectedValue && !values.some(([value]) => value === selectedValue)) values.push([selectedValue, selectedValue]);
  return `
    <select data-ivr-destination-type>
      ${option("", selectedType, "Sem destino")}
      ${groups.map(([type, label]) => option(type, selectedType, label)).join("")}
    </select>
    <select data-ivr-destination-value>
      ${option("", selectedValue, "Selecionar destino")}
      ${values.map(([value, label]) => option(value, selectedValue, label)).join("")}
    </select>
  `;
}

function ivrOptionDestinationLabel(item) {
  if (!item.destination) return "Sem destino";
  if (item.destinationType === "ivr") return `Menu ${ivrMenuLabel(item.destination)}`;
  return destinationLabel(item.destinationType, item.destination);
}

function ensureIvrLooseOptions(ivr = currentIvrWorkspaceMenu()) {
  ivr.looseOptions = Array.isArray(ivr.looseOptions) ? ivr.looseOptions : [];
  return ivr.looseOptions;
}

function ensureIvrTimeConditions(menu = currentIvrWorkspaceMenu()) {
  const target = menu || state.config.ivr;
  target.timeConditions = Array.isArray(target.timeConditions) ? target.timeConditions : [];
  return target.timeConditions;
}

function eachIvrTimeCondition(callback) {
  eachIvrMenu((menu) => {
    ensureIvrTimeConditions(menu).forEach((condition) => callback(condition, menu));
  });
}

function createIvrTimeCondition() {
  const id = `horario-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return {
    id,
    name: "Horario",
    start: "08:00",
    end: "18:00",
    weekdays: "mon-fri",
    inDestinationType: "",
    inDestination: "",
    outDestinationType: "",
    outDestination: ""
  };
}

function createIvrRootMenu() {
  const menus = ensureIvrMenus();
  const next = menus.length + 2;
  return {
    id: `ura-${Date.now().toString(36)}`,
    name: `URA ${next}`,
    greeting: "",
    greetingDescription: "",
    active: true,
    timeoutAudio: "",
    invalidAudio: "",
    timeoutSeconds: 20,
    menuRepeat: 3,
    allowDirectDial: false,
    targetVisibility: "explicit",
    hideEntryNode: true,
    looseOptions: [],
    timeConditions: [],
    hiddenTargetCards: [],
    duplicateTargetCards: [],
    flowLayout: {},
    options: []
  };
}

function timeConditionLabel(id) {
  let condition = null;
  eachIvrTimeCondition((item) => {
    if (!condition && item.id === id) condition = item;
  });
  return condition?.name || id || "Horario";
}

function ensureIvrFlowLayout(menu = currentIvrWorkspaceMenu()) {
  const target = menu || state.config.ivr;
  target.flowLayout = target.flowLayout && typeof target.flowLayout === "object" ? target.flowLayout : {};
  return target.flowLayout;
}

function ensureHiddenTargetCards(menu = currentIvrWorkspaceMenu()) {
  const target = menu || state.config.ivr;
  target.hiddenTargetCards = Array.isArray(target.hiddenTargetCards) ? target.hiddenTargetCards : [];
  return target.hiddenTargetCards;
}

function ensureIvrDuplicateTargetCards(menu = currentIvrWorkspaceMenu()) {
  const target = menu || state.config.ivr;
  target.duplicateTargetCards = Array.isArray(target.duplicateTargetCards) ? target.duplicateTargetCards : [];
  return target.duplicateTargetCards;
}

function ivrCardKey(menuKey) {
  if (menuKey === "main") return "menu:main";
  const menu = ensureIvrMenus()[Number(menuKey)];
  return `menu:${menu?.id || menuKey}`;
}

function ivrCardPosition(key, fallbackX, fallbackY) {
  const layout = ensureIvrFlowLayout();
  const current = layout[key] || {};
  return {
    x: Number.isFinite(Number(current.x)) ? Number(current.x) : fallbackX,
    y: Number.isFinite(Number(current.y)) ? Number(current.y) : fallbackY
  };
}

function setIvrCardPosition(key, x, y) {
  const layout = ensureIvrFlowLayout();
  layout[key] = {
    x: Math.max(20, Math.round(Number(x) || 20)),
    y: Math.max(20, Math.round(Number(y) || 20))
  };
}

function clampIvrZoom(value) {
  return Math.min(1.8, Math.max(0.45, Number(value) || 1));
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || min));
}

function floatingPhoneLimits() {
  const margin = 12;
  const viewportWidth = Math.max(320, window.innerWidth || 390);
  const viewportHeight = Math.max(480, window.innerHeight || 720);
  const maxWidth = Math.max(300, Math.min(520, viewportWidth - margin * 2));
  const maxHeight = Math.max(360, viewportHeight - margin * 2);
  return {
    margin,
    minWidth: Math.min(320, maxWidth),
    maxWidth,
    minHeight: Math.min(430, maxHeight),
    maxHeight,
    viewportWidth,
    viewportHeight
  };
}

function floatingPhoneFrame(partial = {}) {
  const limits = floatingPhoneLimits();
  const width = clampNumber(partial.width ?? state.extensionCall.floatingPhoneWidth, limits.minWidth, limits.maxWidth);
  const height = clampNumber(partial.height ?? state.extensionCall.floatingPhoneHeight, limits.minHeight, limits.maxHeight);
  const defaultX = limits.viewportWidth - width - 20;
  const defaultY = 84;
  const maxX = Math.max(limits.margin, limits.viewportWidth - width - limits.margin);
  const maxY = Math.max(limits.margin, limits.viewportHeight - height - limits.margin);
  const x = clampNumber(partial.x ?? state.extensionCall.floatingPhoneX ?? defaultX, limits.margin, maxX);
  const y = clampNumber(partial.y ?? state.extensionCall.floatingPhoneY ?? defaultY, limits.margin, maxY);
  return { x, y, width, height };
}

function syncFloatingPhoneFrame(partial = {}) {
  const frame = floatingPhoneFrame(partial);
  state.extensionCall.floatingPhoneX = frame.x;
  state.extensionCall.floatingPhoneY = frame.y;
  state.extensionCall.floatingPhoneWidth = frame.width;
  state.extensionCall.floatingPhoneHeight = frame.height;
  return frame;
}

function applyFloatingPhoneFrame(frame = syncFloatingPhoneFrame()) {
  const phone = document.querySelector("[data-floating-phone]");
  if (!phone) return;
  phone.style.left = `${frame.x}px`;
  phone.style.top = `${frame.y}px`;
  phone.style.width = `${frame.width}px`;
  phone.style.height = `${frame.height}px`;
}

function floatingPhoneStyle() {
  const frame = syncFloatingPhoneFrame();
  return `left:${frame.x}px;top:${frame.y}px;width:${frame.width}px;height:${frame.height}px;`;
}

function phonePipWindow() {
  const pipWindow = state.extensionCall.phonePipWindow;
  if (!pipWindow || pipWindow.closed) {
    state.extensionCall.phonePipWindow = null;
    return null;
  }
  return pipWindow;
}

function browserCanUsePhonePip() {
  return Boolean(window.documentPictureInPicture?.requestWindow);
}

function closePhonePictureInPicture({ render = false } = {}) {
  const pipWindow = phonePipWindow();
  state.extensionCall.phonePipWindow = null;
  if (pipWindow && !pipWindow.closed) {
    try {
      pipWindow.close();
    } catch (_error) {}
  }
  if (render && state.extensionSession) renderExtensionPortal();
}

function copyPhonePipStyles(pipDocument) {
  pipDocument.head.innerHTML = `<title>Telefone PBX</title>`;
  $all('link[rel="stylesheet"]').forEach((link) => {
    const clone = pipDocument.createElement("link");
    clone.rel = "stylesheet";
    clone.href = link.href;
    pipDocument.head.appendChild(clone);
  });
  const pipStyle = pipDocument.createElement("style");
  pipStyle.textContent = `
    html, body { width: 100%; min-height: 100%; margin: 0; }
    body.pip-phone-body { background: var(--bg); color: var(--text); padding: 10px; overflow: auto; }
    body.pip-phone-body .softphone-panel { width: 100%; min-height: 100%; box-shadow: none; }
    body.pip-phone-body .extension-monitor-panel,
    body.pip-phone-body .floating-phone-resize { display: none !important; }
  `;
  pipDocument.head.appendChild(pipStyle);
}

function refreshPhonePipIcons(pipWindow) {
  if (!pipWindow || pipWindow.closed) return;
  const run = () => {
    try {
      const lucide = pipWindow.lucide;
      if (lucide?.createIcons && lucide.icons) {
        lucide.createIcons({ icons: lucide.icons });
      }
    } catch (_error) {}
  };
  if (pipWindow.lucide) {
    run();
    return;
  }
  if (pipWindow.document.querySelector("[data-pip-lucide]")) return;
  const script = pipWindow.document.createElement("script");
  script.src = "/vendor/lucide.js?v=1.34.0";
  script.defer = true;
  script.dataset.pipLucide = "true";
  script.addEventListener("load", run);
  pipWindow.document.head.appendChild(script);
}

function bindPhonePipEvents(pipWindow) {
  if (pipWindow.__pbxPhoneEventsBound) return;
  pipWindow.__pbxPhoneEventsBound = true;
  pipWindow.document.addEventListener("click", async (event) => {
    if (state.extensionSession) prepareIncomingRingtone();
    try {
      if (await handleSoftphoneClick(event)) return;
    } catch (error) {
      setExtensionMessage(error.message, "error");
      renderExtensionPortal();
    }
  });
  pipWindow.document.addEventListener("input", handleSoftphoneInput);
  pipWindow.addEventListener("pagehide", () => {
    if (state.extensionCall.phonePipWindow === pipWindow) {
      state.extensionCall.phonePipWindow = null;
      if (state.extensionSession) renderExtensionPortal();
    }
  });
}

function renderPhonePictureInPicture(softphoneHtml) {
  const pipWindow = phonePipWindow();
  if (!pipWindow) return;
  const pipDocument = pipWindow.document;
  const activeElement = pipDocument.activeElement;
  const focusedId = activeElement?.id || "";
  const focusedSelection =
    focusedId && typeof activeElement.selectionStart === "number"
      ? { start: activeElement.selectionStart, end: activeElement.selectionEnd }
      : null;
  pipDocument.documentElement.dataset.theme = state.theme;
  pipDocument.body.className = "pip-phone-body";
  pipDocument.body.innerHTML = softphoneHtml;
  bindPhonePipEvents(pipWindow);
  refreshPhonePipIcons(pipWindow);
  if (focusedId) {
    const nextFocus = pipDocument.getElementById(focusedId);
    if (nextFocus) {
      nextFocus.focus({ preventScroll: true });
      if (focusedSelection && typeof nextFocus.setSelectionRange === "function") {
        const length = String(nextFocus.value || "").length;
        nextFocus.setSelectionRange(Math.min(focusedSelection.start, length), Math.min(focusedSelection.end, length));
      }
    }
  }
}

async function openPhonePictureInPicture() {
  if (!browserCanUsePhonePip()) return false;
  const frame = floatingPhoneFrame({ width: 360, height: 620 });
  const pipWindow = await window.documentPictureInPicture.requestWindow({
    width: Math.round(frame.width),
    height: Math.round(frame.height)
  });
  state.extensionCall.phonePipWindow = pipWindow;
  state.extensionCall.floatingPhoneOpen = false;
  copyPhonePipStyles(pipWindow.document);
  bindPhonePipEvents(pipWindow);
  return true;
}

async function toggleDetachedPhone() {
  if (phonePipWindow()) {
    closePhonePictureInPicture();
    state.extensionCall.floatingPhoneOpen = false;
    renderExtensionPortal();
    return;
  }
  if (state.extensionCall.floatingPhoneOpen) {
    state.extensionCall.floatingPhoneOpen = false;
    state.floatingPhoneDrag = null;
    state.floatingPhoneResize = null;
    renderExtensionPortal();
    return;
  }
  try {
    if (await openPhonePictureInPicture()) {
      renderExtensionPortal();
      return;
    }
  } catch (_error) {}
  renderExtensionPortal();
}

function ivrZoom() {
  state.ivrZoom = clampIvrZoom(state.ivrZoom);
  return state.ivrZoom;
}

function syncIvrCanvasPositions(root = document) {
  if (!state.config?.ivr) return;
  $all(".ivr-flow-canvas [data-ivr-card-key]", root).forEach((card) => {
    const left = Number.parseFloat(card.style.left || "");
    const top = Number.parseFloat(card.style.top || "");
    if (!card.dataset.ivrCardKey || !Number.isFinite(left) || !Number.isFinite(top)) return;
    setIvrCardPosition(card.dataset.ivrCardKey, left, top);
  });
}

function captureIvrViewport() {
  const canvas = $(".ivr-flow-canvas");
  const scrolling = document.scrollingElement || document.documentElement;
  return {
    scrollLeft: canvas?.scrollLeft || 0,
    scrollTop: canvas?.scrollTop || 0,
    zoom: ivrZoom(),
    windowX: window.scrollX || scrolling.scrollLeft || 0,
    windowY: window.scrollY || scrolling.scrollTop || 0
  };
}

function currentIvrViewportKey() {
  return state.ivrEditingMenuId || new URLSearchParams(window.location.search).get("edit") || "main";
}

function saveIvrViewport(viewport = captureIvrViewport(), menuId = currentIvrViewportKey()) {
  if (!viewport || !menuId) return viewport;
  state.ivrViewport = viewport;
  state.ivrViewports[menuId] = viewport;
  return viewport;
}

function selectedIvrViewport(menuId = currentIvrViewportKey(), fallback = null) {
  return state.ivrViewports[menuId] || fallback || state.ivrViewport;
}

function restoreIvrViewport(viewport = state.ivrViewport) {
  if (!viewport) return;
  if (Number.isFinite(Number(viewport.zoom))) state.ivrZoom = clampIvrZoom(viewport.zoom);
  requestAnimationFrame(() => {
    const canvas = $(".ivr-flow-canvas");
    if (canvas) {
      canvas.scrollLeft = viewport.scrollLeft || 0;
      canvas.scrollTop = viewport.scrollTop || 0;
    }
    window.scrollTo(viewport.windowX || 0, viewport.windowY || 0);
  });
}

function rememberIvrViewport() {
  if (state.activeTab !== "ivr") return;
  saveIvrViewport();
}

function createIvrOption(digit = "") {
  return {
    nodeId: `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    digit,
    label: digit ? `Opcao ${digit}` : "Nova opcao",
    description: "",
    announcement: "",
    destinationType: "",
    destination: ""
  };
}

function ensureIvrOptionId(item) {
  if (!item.nodeId) item.nodeId = `opt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return item.nodeId;
}

function ivrMenuByKey(menuKey) {
  return menuKey === "main" ? state.config.ivr : ensureIvrMenus()[Number(menuKey)];
}

function ivrMenuIdByKey(menuKey) {
  if (menuKey === "main") return "main";
  return ensureIvrMenus()[Number(menuKey)]?.id || menuKey;
}

function findIvrOptionByNodeId(nodeId) {
  if (!nodeId) return null;
  const workspace = ivrEditingRecord();
  for (const record of ivrMenuRecords().filter((r) => r.id === workspace.id || r.menu.parentMenuId === workspace.id)) {
    const index = (record.menu.options || []).findIndex((o) => o.nodeId === nodeId);
    if (index >= 0) return { source: "menu", menu: record.menu, menuKey: record.menuKey, index, item: record.menu.options[index] };
  }
  const loose = ensureIvrLooseOptions(workspace.menu);
  const index = loose.findIndex((o) => o.nodeId === nodeId);
  return index < 0 ? null : { source: "loose", menu: workspace.menu, menuKey: workspace.menuKey, index, item: loose[index] };
}

function removeIvrOptionFromCurrentSource(found) {
  if (!found) return null;
  if (found.source === "loose") return ensureIvrLooseOptions(found.menu).splice(found.index, 1)[0] || null;
  found.menu.options = found.menu.options || [];
  return found.menu.options.splice(found.index, 1)[0] || null;
}

function eachIvrOption(callback) {
  [state.config.ivr, ...ensureIvrMenus()].forEach((menu) => {
    [...(menu.options || []), ...ensureIvrLooseOptions(menu)].forEach((item) => callback(item));
  });
}

function clearIvrDestinationLinks(type, value, workspace = null, cardKey = "") {
  let removed = 0;
  function clear(item, prefix = "") {
    const typeField = prefix ? prefix + "DestinationType" : "destinationType";
    const valueField = prefix ? prefix + "Destination" : "destination";
    const keyField = prefix ? prefix + "DestinationCardKey" : "destinationCardKey";
    if (item[typeField] !== type || String(item[valueField]) !== String(value)) return;
    if (cardKey && (item[keyField] || ivrTargetCardByDestination(type, value)) !== cardKey) return;
    item[typeField] = item[valueField] = item[keyField] = "";
    removed++;
  }
  const menus = workspace ? [workspace, ...ensureIvrMenus().filter((menu) => menu.parentMenuId === ivrEditingRecord().id)] :
    [state.config.ivr, ...ensureIvrMenus()];
  for (const menu of menus) {
    for (const item of menu.options || []) clear(item);
    if (!workspace || menu === workspace) {
      for (const item of ensureIvrLooseOptions(menu)) clear(item);
      for (const c of ensureIvrTimeConditions(menu)) { clear(c, "in"); clear(c, "out"); }
    }
  }
  return removed;
}

function replaceIvrMenuReferences(oldId, nextId = "") {
  if (!oldId) return;
  for (const trunk of ensureConfigTrunks()) {
    if (trunk.inboundDestinationType === "ivr" && trunk.inboundDestination === oldId) trunk.inboundDestination = nextId || "main";
  }
  if (state.config.trunk.inboundDestinationType === "ivr" && state.config.trunk.inboundDestination === oldId) state.config.trunk.inboundDestination = nextId || "main";
  for (const route of state.config.inboundRoutes || []) {
    if (route.destinationType === "ivr" && route.destination === oldId) route.destination = nextId || "main";
  }
  const hours = state.config.businessHours;
  if (hours?.afterHoursDestinationType === "ivr" && hours.afterHoursDestination === oldId) hours.afterHoursDestination = nextId || "main";
  eachIvrMenu((m) => {
    const layout = ensureIvrFlowLayout(m);
    const oldKey = "menu:" + oldId;
    if (layout[oldKey]) {
      if (nextId) layout["menu:" + nextId] = layout[oldKey];
      delete layout[oldKey];
    }
  });
  if (nextId && oldId === state.ivrEditingMenuId) {
    state.ivrEditingMenuId = nextId;
    setIvrBuilderRoute(nextId);
  }
  ensureIvrMenus().forEach((menu) => {
    if (menu.parentMenuId === oldId) {
      if (nextId) menu.parentMenuId = nextId;
      else delete menu.parentMenuId;
    }
  });
  eachIvrOption((item) => {
    if (item.destinationType === "ivr" && item.destination === oldId) {
      item.destination = nextId;
      item.destinationCardKey = nextId ? "menu:" + nextId : "";
      if (!nextId) {
        item.destinationType = "";
        item.destinationCardKey = "";
      }
    }
  });
  eachIvrTimeCondition((condition) => {
    ["in", "out"].forEach((prefix) => {
      if (condition[`${prefix}DestinationType`] === "ivr" && condition[`${prefix}Destination`] === oldId) {
        condition[`${prefix}Destination`] = nextId;
        condition[`${prefix}DestinationCardKey`] = nextId ? "menu:" + nextId : "";
        if (!nextId) {
          condition[`${prefix}DestinationType`] = "";
          condition[`${prefix}DestinationCardKey`] = "";
        }
      }
    });
  });
}

function removeExtensionReferences(number, nextFallback = "") {
  clearIvrDestinationLinks("extension", number);
  clearIvrDestinationLinks("voicemail", number);
  state.config.queues.forEach((queue) => {
    queue.members = (queue.members || []).filter((member) => member !== number);
    if (queue.fallbackType !== "queue" && queue.fallback === number) queue.fallback = nextFallback;
  });
  state.config.ringGroups.forEach((group) => {
    group.members = (group.members || []).filter((member) => member !== number);
    if (group.fallbackType !== "queue" && group.fallback === number) group.fallback = nextFallback;
  });
  state.config.inboundRoutes.forEach((route) => {
    if (route.destinationType === "extension" && route.destination === number) {
      route.destination = nextFallback || "700";
    }
  });
}

function clearRouteReferences(type, value, fallbackType = "extension", fallbackValue = "700") {
  state.config.inboundRoutes.forEach((route) => {
    if (route.destinationType === type && route.destination === value) {
      route.destinationType = fallbackType;
      route.destination = fallbackValue;
    }
  });
}

function removeIvrTargetCard(type, value) {
  const allowedTypes = ["extension", "queue", "ringGroup", "timeCondition", "trunk", "ivr"];
  if (!allowedTypes.includes(type)) return { ok: false, message: "Tipo de card nao suportado para exclusao." };
  const hiddenCards = ensureHiddenTargetCards();
  const key = ivrTargetCardByDestination(type, value);
  if (!hiddenCards.includes(key)) hiddenCards.push(key);
  clearIvrDestinationLinks(type, value, currentIvrWorkspaceMenu(), key);
  return { ok: true, message: "Card removido da URA sem apagar o recurso do sistema." };
}

function hideIvrEntryNode() {
  const ivr = state.config.ivr;
  ivr.hideEntryNode = true;
  return { ok: true, message: "Entrada antiga removida. O tronco principal agora representa a entrada da URA." };
}

function connectIvrDestination(type, value, key = ivrTargetCardByDestination(type, value)) {
  const source = state.ivrLinkSource;
  if (source?.type === "option-target") {
    const item = findIvrOptionByNodeId(source.nodeId)?.item;
    if (!item) return false;
    Object.assign(item, { destinationType: type, destination: value, destinationCardKey: key });
  } else if (source?.type === "time-condition") {
    const condition = ensureIvrTimeConditions().find((c) => c.id === source.conditionId);
    if (!condition) return false;
    if (type === "timeCondition" && value === condition.id) throw new Error("Escolha outro horário para evitar uma repetição.");
    const branch = source.branch === "out" ? "out" : "in";
    condition[branch + "DestinationType"] = type;
    condition[branch + "Destination"] = value;
    condition[branch + "DestinationCardKey"] = key;
  } else return false;
  state.ivrLinkSource = null;
  return true;
}

function createDuplicateIvrTargetCard(type, value, x, y) {
  const duplicate = {
    id: `dup-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    type,
    value
  };
  ensureIvrDuplicateTargetCards().push(duplicate);
  const key = `${type}:${value}:${duplicate.id}`;
  setIvrCardPosition(key, x, y);
  return key;
}

function connectTrunkInboundToMenu(trunkId, menuId = "main") {
  const trunks = ensureConfigTrunks();
  const trunk = trunks.find((item) => item.id === trunkId);
  if (!trunk) return false;
  trunk.inboundDestinationType = "ivr";
  trunk.inboundDestination = menuId || "main";
  if (trunks[0]?.id === trunk.id) state.config.trunk = { ...(state.config.trunk || {}), ...trunk };
  return true;
}

function ivrTargetCards() {
  const cfg = state.config;
  const hiddenCards = new Set(ensureHiddenTargetCards());
  const baseTargets = [
    ...cfg.extensions.map((ext, index) => ({
      key: `extension:${ext.number}`,
      type: "extension",
      value: ext.number,
      title: `${ext.number} ${ext.name}`,
      subtitle: ext.department || "Ramal",
      icon: "phone",
      x: 920,
      y: 90 + index * 120
    })),
    ...cfg.queues.map((queue, index) => ({
      key: `queue:${queue.id}`,
      type: "queue",
      value: queue.id,
      title: queue.name || queue.id,
      subtitle: "Fila",
      icon: "headphones",
      x: 1220,
      y: 90 + index * 120
    })),
    ...cfg.ringGroups.map((group, index) => ({
      key: `ringGroup:${group.id}`,
      type: "ringGroup",
      value: group.id,
      title: group.name || group.id,
      subtitle: "Grupo de toque",
      icon: "users",
      x: 1220,
      y: 260 + index * 120
    })),
    ...ensureConfigTrunks().map((trunk, index) => ({
      key: `trunk:${trunk.id}`,
      type: "trunk",
      value: trunk.id,
      title: trunkLabel(trunk),
      subtitle: trunk.mainNumber || trunk.sipServer || "Tronco SIP",
      icon: "radio-tower",
      x: 1520,
      y: 500 + index * 120
    })),
    ...ensureIvrTimeConditions().map((condition, index) => ({
      key: `timeCondition:${condition.id}`,
      type: "timeCondition",
      value: condition.id,
      title: condition.name || condition.id,
      subtitle: `${condition.start || "08:00"}-${condition.end || "18:00"}`,
      icon: "clock-3",
      x: 1220,
      y: 500 + index * 230,
      condition
    }))
  ];
  const duplicateTargets = ensureIvrDuplicateTargetCards()
    .map((duplicate, index) => {
      const base = baseTargets.find((target) => target.type === duplicate.type && String(target.value) === String(duplicate.value));
      if (!base) return null;
      return {
        ...base,
        key: `${duplicate.type}:${duplicate.value}:${duplicate.id}`,
        duplicateId: duplicate.id,
        subtitle: `${base.subtitle} - atalho`,
        x: base.x + 90 + index * 40,
        y: base.y + 90 + index * 40
      };
    })
    .filter(Boolean);
  const workspace = currentIvrWorkspaceMenu();
  const layout = ensureIvrFlowLayout(workspace);
  const childOptions = (cfg.ivr?.menus || []).filter((m) => m.parentMenuId === (workspace.id || "main")).flatMap((m) => m.options || []);
  const references = new Set([...(workspace.options || []), ...(workspace.looseOptions || []), ...childOptions]
    .map((o) => o.destinationCardKey || ivrTargetCardByDestination(o.destinationType, o.destination)));
  (workspace.timeConditions || []).forEach((condition) => {
    references.add(`timeCondition:${condition.id}`);
    for (const branch of ["in", "out"]) references.add(condition[branch + "DestinationCardKey"] ||
      ivrTargetCardByDestination(condition[branch + "DestinationType"], condition[branch + "Destination"]));
  });
  return [...baseTargets, ...duplicateTargets].filter((target) =>
    !hiddenCards.has(target.key) && (workspace.targetVisibility !== "explicit" || Object.hasOwn(layout, target.key) || references.has(target.key))
  );
}

function ivrTargetCardByDestination(type, value) {
  if (type === "ivr") return `menu:${value || "main"}`;
  return `${type}:${value}`;
}

function trunkChoices(selected, direction = "inbound") {
  return ensureConfigTrunks()
    .filter(trunk => PbxTrunkPolicy.allows(trunk, direction) && (direction !== "outbound" || trunk.active !== false))
    .map((trunk) => option(trunk.id, selected, trunkLabel(trunk)))
    .join("");
}

function trunkInboundChoices(selectedType = "ivr", selectedValue = "main") {
  const cfg = state.config;
  const menus = ivrMenuRecords({ includeInactive: false }).map((record) => [record.id, record.menu.name || record.id]);
  if (selectedType === "ivr" && selectedValue && !menus.some(([value]) => value === selectedValue)) {
    menus.push([selectedValue, `${ivrMenuLabel(selectedValue)} (inativa)`]);
  }
  const timeConditions = ensureIvrTimeConditions().map((condition) => [condition.id, condition.name || condition.id]);
  const groups = [
    ["none", "Nenhum", [["", "Sem encaminhamento"]]],
    ["ivr", "URA", menus],
    ["queue", "Fila", cfg.queues.map((queue, index) => [queue.id, queueLabel(queue, index)])],
    ["ringGroup", "Grupo", cfg.ringGroups.map((group) => [group.id, group.name])],
    ["extension", "Ramal", cfg.extensions.map((ext) => [ext.number, `${ext.number} ${ext.name}`])],
    ["timeCondition", "Horario", timeConditions]
  ];
  const values = groups.find(([type]) => type === selectedType)?.[2] || [];
  return `
    <select data-trunk-inbound-type>
      ${groups.map(([type, label]) => option(type, selectedType, label)).join("")}
    </select>
    <select data-trunk-inbound-value>
      ${values.map(([value, label]) => option(value, selectedValue, label)).join("") || option(selectedValue, selectedValue)}
    </select>
  `;
}

function ensureConfigTrunks() {
  if (!state.config.trunks?.length) {
    state.config.trunks = [{ ...(state.config.trunk || {}), id: "trunk-operadora", name: "Operadora principal", active: true }];
  }
  state.config.trunks = state.config.trunks.map((trunk, index) => ({
    ...(state.config.trunk || {}),
    ...trunk,
    id: trunk.id || (index === 0 ? "trunk-operadora" : `trunk-${index + 1}`),
    name: trunk.name || (index === 0 ? "Operadora principal" : `Operadora ${index + 1}`),
    inboundDestinationType: trunk.inboundDestinationType || "ivr",
    inboundDestination: trunk.inboundDestinationType === "none" ? "" : trunk.inboundDestination || "main",
    usage: PbxTrunkPolicy.usage(trunk),
    authMode: PbxTrunkPolicy.authMode(trunk),
    active: trunk.active !== false
  }));
  state.config.trunk = { ...state.config.trunk, ...state.config.trunks[0] };
  return state.config.trunks;
}

function trunkLabel(trunk) {
  return trunk.name || trunk.mainNumber || trunk.sipUser || trunk.sipServer || trunk.id || "Tronco";
}

function nextTrunkId() {
  const used = new Set(ensureConfigTrunks().map((trunk) => trunk.id));
  let index = used.size + 1;
  let id = `trunk-${index}`;
  while (used.has(id)) {
    index += 1;
    id = `trunk-${index}`;
  }
  return id;
}

function routePresetFor(extension) {
  const permissions = extension.permissions || [];
  if (permissions.includes("international")) return "Diretoria";
  if (permissions.includes("ddd")) return "Equipe DDD";
  return "Recepcao";
}

function applySidebarState() {
  const appView = $("#appView");
  const toggle = $("#sidebarToggleBtn");
  const headerToggle = $("#sidebarHeaderToggleBtn");
  const collapsed = Boolean(state.sidebarCollapsed);
  appView?.classList.toggle("sidebar-collapsed", collapsed);
  const label = collapsed ? "Abrir menu" : "Recolher menu";
  if (toggle) {
    toggle.title = label;
    toggle.setAttribute("aria-label", label);
    toggle.innerHTML = `<i data-lucide="${collapsed ? "circle-chevron-right" : "circle-chevron-left"}"></i><span>${label}</span>`;
  }
  if (headerToggle) {
    headerToggle.title = label;
    headerToggle.setAttribute("aria-label", label);
  }
}

function updateOperationalClock() {
  const now = new Date();
  const date = $("#topbarDate");
  const clock = $("#topbarClock");
  if (date) date.textContent = now.toLocaleDateString("pt-BR");
  if (clock) clock.textContent = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function updateOperatorIdentity() {
  if (!state.user) return;
  const username = String(state.user.name || state.user.username || "Administrador");
  const role = state.user.role === "admin" || state.user.username === "admin" ? "Administrador" : state.user.role || "Operador";
  const initials = username
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "AU";
  if ($("#sidebarUserInitial")) $("#sidebarUserInitial").textContent = initials;
  if ($("#sidebarUserName")) $("#sidebarUserName").textContent = username;
  if ($("#sidebarUserRole")) $("#sidebarUserRole").textContent = role;
}

function renderShell() {
  clearRestrictedAudioViews();
  $("#loginView").classList.toggle("hidden", Boolean(state.user || state.extensionSession));
  $("#appView").classList.toggle("hidden", !state.user);
  $("#extensionView")?.classList.toggle("hidden", !state.extensionSession);
  $("#passwordWarning").classList.toggle("hidden", !state.user?.mustChangePassword);
  applySidebarState();
  updateOperationalClock();
  updateOperatorIdentity();
  if (state.user) {
    $all("[data-tab]").forEach((button) => {
      button.classList.toggle("hidden", !canAccessTab(button.dataset.tab));
    });
    updateNavigationGroups();
    if (!canAccessTab(state.activeTab)) {
      state.activeTab = firstAllowedTab();
      window.history.replaceState({ tab: state.activeTab }, "", routeForTab(state.activeTab));
    }
    syncActiveTabUi();
  }
  renderDesktopNotificationButton();
  iconRefresh();
}

function clearRestrictedAudioViews() {
  if (!state.user || !canAccessTab("ivrAudios")) {
    state.ivrAudios = [];
    if (pages.ivrAudios) pages.ivrAudios.innerHTML = "";
  }
  if (!state.user || !canAccessTab("audios")) {
    state.recordingLibrary.requestId = (state.recordingLibrary.requestId || 0) + 1;
    state.recordingLibrary.calls = [];
    state.recordingLibrary.meta = {};
    if (pages.audios) pages.audios.innerHTML = "";
  }
}

function updateNavigationGroups(root = $("#navTabs")) {
  if (!root) return;
  root.querySelectorAll(".nav-group").forEach((heading) => {
    let visible = false;
    for (let item = heading.nextElementSibling; item && !item.matches(".nav-group"); item = item.nextElementSibling) {
      if (item.matches("[data-tab]") && !item.classList.contains("hidden")) visible = true;
    }
    heading.classList.toggle("hidden", !visible);
  });
}

function canAccessTab(tab) {
  if (!state.user) return true;
  if ((state.user.role || "") === "admin" || state.user.username === "admin") return true;
  if (adminOnlyTabs.has(tab)) return false;
  const key = menuPermissions[tab];
  return !key || state.user.permissions?.menus?.[key] === true;
}

function firstAllowedTab() {
  return Object.keys(pages).find((tab) => canAccessTab(tab)) || "overview";
}

function normalizedRoutePath(pathname = window.location.pathname) {
  const raw = decodeURIComponent(String(pathname || "/")).replace(/\/+$/g, "") || "/";
  return raw.toLowerCase();
}

function tabFromCurrentPath() {
  return routeTabs[normalizedRoutePath()] || "overview";
}

function routeForTab(tab) {
  return tabRoutes[tab] || tabRoutes.overview;
}

function syncActiveTabUi() {
  Object.entries(pages).forEach(([key, page]) => page?.classList.toggle("active", key === state.activeTab));
  $all("[data-tab]").forEach((button) => button.classList.toggle("active", button.dataset.tab === state.activeTab));
  const title = $("#pageTitle");
  if (title) title.textContent = titleByTab[state.activeTab] || titleByTab.overview;
  const subtitle = $("#pageSubtitle");
  if (subtitle) subtitle.textContent = subtitleByTab[state.activeTab] || subtitleByTab.overview;
  updateTopbarActions();
}

const tabDataRequests = new Map();
const tabDataLoadedAt = new Map();
function loadTabData(tab = state.activeTab) {
  const key = `${state.user?.username || ""}:${tab}`;
  if (tabDataRequests.has(key)) return tabDataRequests.get(key);
  if (["reports", "audios", "ivrAudios", "audit", "logs"].includes(tab) && Date.now() - (tabDataLoadedAt.get(key) || 0) < 5000) return Promise.resolve();
  pages[tab]?.setAttribute("aria-busy", "true");
  const pending = fetchTabData(tab).then(() => {
    tabDataLoadedAt.set(key, Date.now());
  }).finally(() => {
    if (tabDataRequests.get(key) === pending) tabDataRequests.delete(key);
    pages[tab]?.setAttribute("aria-busy", "false");
  });
  tabDataRequests.set(key, pending);
  return pending;
}

function animateTabData(tab) {
  if (state.activeTab !== tab || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  pages[tab]?.animate?.([{ opacity: 0.85, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 160, easing: "ease-out" });
}

async function fetchTabData(tab = state.activeTab) {
  if (!state.config) return;
  if (tab === "trunk") await loadTrunkRegistrations();
  if (tab === "overview") await Promise.all([loadPbxStatus(), loadOverviewData(state.overview.date)]);
  if (tab === "reports") await Promise.all([loadPbxStatus(), loadReports()]);
  if (["status", "security"].includes(tab)) await loadPbxStatus();
  if (tab === "users") await loadUsers();
  if (tab === "audit") await loadAudit();
  if (tab === "dialer") await loadDialerCampaigns();
  if (tab === "logs") {
    await Promise.all([loadPbxStatus(), loadOutboundDiagnostics($("#dialTestNumber")?.value || "", state.config?.extensions?.[0]?.number || "201")]);
    renderLogs();
    iconRefresh();
  }
  if (tab === "ivr" && canAccessTab("ivrAudios")) await loadIvrAudios();
  if (tab === "ivrAudios") { await loadIvrAudios(); renderIvrAudios(); iconRefresh(); }
  if (tab === "audios") {
    await loadRecordingLibrary();
    renderAudios();
    iconRefresh();
  }
}

async function setActiveTab(tab, { push = false, replace = false, collect = false, load = false } = {}) {
  const nextTab = pages[tab] ? tab : "overview";
  if (!canAccessTab(nextTab)) {
    setMessage("Seu usuario nao tem permissao para este menu.", "error");
    return false;
  }
  if (collect && state.config && ["trunk", "extensions", "routing", "ivr", "queues", "security"].includes(state.activeTab)) collectConfig();
  const wasActiveTab = state.activeTab;
  state.activeTab = nextTab;
  if (nextTab === "ivr" && wasActiveTab !== "ivr" && !state.ivrFullscreen) {
    const editId = new URLSearchParams(window.location.search).get("edit");
    if (editId) openIvrBuilder(editId);
    else closeIvrBuilder();
  }
  syncActiveTabUi();
  const route = routeForTab(nextTab);
  if (replace) window.history.replaceState({ tab: nextTab }, "", route);
  else if (push && normalizedRoutePath() !== normalizedRoutePath(route)) window.history.pushState({ tab: nextTab }, "", route);
  if (push) window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  if (wasActiveTab !== nextTab) animateTabData(nextTab);
  if (load) {
    await loadTabData(nextTab);
    animateTabData(nextTab);
  }
  return true;
}

state.activeTab = tabFromCurrentPath();

function setExtensionMessage(message, tone = "info") {
  state.extensionCall.message = message || "";
  const target = $("#extensionCallMessage");
  if (target) {
    target.textContent = state.extensionCall.message;
    target.style.color = tone === "ok" ? "var(--green)" : tone === "info" ? "var(--muted)" : "var(--red-700)";
  }
}

function desktopNotificationPermission() {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

function renderDesktopNotificationButton() {
  const button = $("#extensionNotificationBtn");
  if (!button) return;
  const permission = desktopNotificationPermission();
  const enabled = permission === "granted";
  const blocked = permission === "denied";
  button.classList.toggle("active", enabled);
  button.disabled = permission === "unsupported";
  button.innerHTML = `<i data-lucide="${enabled ? "bell-ring" : blocked ? "bell-off" : "bell"}"></i><span>${enabled ? "Notificacoes" : blocked ? "Bloqueado" : "Ativar avisos"}</span>`;
  button.title = permission === "unsupported"
    ? "Navegador sem suporte a notificacoes"
    : blocked
      ? "Notificacoes bloqueadas no navegador"
      : enabled
        ? "Notificacoes de chamada ativas"
        : "Ativar notificacoes de chamada";
  button.setAttribute("aria-label", button.title);
  iconRefresh();
}

async function requestDesktopNotificationPermission({ silent = false } = {}) {
  if (!("Notification" in window)) {
    if (!silent) setExtensionMessage("Este navegador nao suporta notificacoes de area de trabalho.", "error");
    renderDesktopNotificationButton();
    return "unsupported";
  }
  if (Notification.permission === "default") {
    await Notification.requestPermission().catch(() => "default");
  }
  renderDesktopNotificationButton();
  if (!silent) {
    if (Notification.permission === "granted") setExtensionMessage("Notificacoes de chamada ativadas.", "ok");
    else setExtensionMessage("Notificacoes bloqueadas. Libere nas permissoes do navegador para receber aviso na area de trabalho.", "error");
  }
  return Notification.permission;
}

function closeIncomingDesktopNotification() {
  const notification = state.extensionCall.desktopNotification;
  if (notification?.close) notification.close();
  state.extensionCall.desktopNotification = null;
}

function showIncomingDesktopNotification(number) {
  if (desktopNotificationPermission() !== "granted") return;
  closeIncomingDesktopNotification();
  const notification = new Notification("Chamada recebida", {
    body: `Ramal recebendo ligacao de ${number || "numero desconhecido"}`,
    tag: `pbx-incoming-${state.extensionSession?.number || "ramal"}`,
    renotify: true,
    requireInteraction: true,
    icon: "/favicon.ico"
  });
  notification.onclick = () => {
    window.focus();
    notification.close();
  };
  state.extensionCall.desktopNotification = notification;
}

function extensionStatusLabel() {
  const call = state.extensionCall;
  if (call.incoming) return "Recebendo chamada";
  if (call.session) return call.held ? "Em espera" : call.muted ? "Mudo" : "Em chamada";
  return call.status || "desconectado";
}

function extensionDisplayStatusLabel(value = extensionStatusLabel()) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "registrado") return "Online";
  if (normalized === "desconectado" || normalized === "sem registro") return "Offline";
  return value || "Offline";
}

function isExtensionCallActive() {
  const call = state.extensionCall;
  return Boolean(call.session || ["originando", "chamando", "tocando", "em chamada"].includes(call.status));
}

function timeLabel(value = Date.now()) {
  return new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function callDurationLabel(startedAt, endedAt = Date.now()) {
  if (!startedAt) return "0s";
  const total = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return minutes ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function pauseDurationLabel(startedAt) {
  return startedAt ? callDurationLabel(startedAt) : "0s";
}

function pauseInfoFromQueues(queues = []) {
  const pausedQueues = queues.filter((queue) => queue.agent?.statusTone === "paused" || queue.agent?.status === "paused");
  if (!pausedQueues.length) return null;
  const starts = pausedQueues
    .map((queue) => Date.parse(queue.agent?.pauseStartedAt || ""))
    .filter((value) => Number.isFinite(value));
  const startedAt = starts.length ? Math.min(...starts) : Date.now();
  return {
    paused: true,
    startedAt,
    queues: pausedQueues.map((queue) => queue.name || queue.id).filter(Boolean),
    reason: pausedQueues.find((queue) => queue.agent?.pauseReason || queue.agent?.pauseName)?.agent?.pauseReason || pausedQueues.find((queue) => queue.agent?.pauseName)?.agent?.pauseName || "",
    label: pauseDurationLabel(startedAt)
  };
}

function currentExtensionPauseInfo() {
  const fromQueues = pauseInfoFromQueues(state.extensionStatus?.queues || []);
  if (fromQueues) return fromQueues;
  if (state.extensionCall.queuePaused && state.extensionCall.pauseStartedAt) {
    return {
      paused: true,
      startedAt: state.extensionCall.pauseStartedAt,
      queues: state.extensionCall.pauseQueues || [],
      reason: state.extensionCall.pauseReason || "",
      label: pauseDurationLabel(state.extensionCall.pauseStartedAt)
    };
  }
  return { paused: false, startedAt: null, queues: [], reason: "", label: "0s" };
}

function syncExtensionPauseState() {
  const fromQueues = pauseInfoFromQueues(state.extensionStatus?.queues || []);
  if (fromQueues) {
    state.extensionCall.queuePaused = true;
    state.extensionCall.pauseStartedAt = fromQueues.startedAt;
    state.extensionCall.pauseQueues = fromQueues.queues;
    state.extensionCall.pauseReason = fromQueues.reason || "";
    return;
  }
  if (state.extensionCall.queuePaused && state.extensionCall.pauseStartedAt) return;
  state.extensionCall.queuePaused = false;
  state.extensionCall.pauseStartedAt = null;
  state.extensionCall.pauseQueues = [];
  state.extensionCall.pauseReason = "";
}

function cleanCallerLabel(value, fallback = "entrada") {
  const text = String(value || "").replace(/^"|"$/g, "").trim();
  if (!text || /^anonymous$/i.test(text)) return fallback;
  return text;
}

function stopIncomingRingtone() {
  const call = state.extensionCall;
  closeIncomingDesktopNotification();
  if (call.ringtoneTimer) {
    clearInterval(call.ringtoneTimer);
    call.ringtoneTimer = null;
  }
  (call.ringtoneNodes || []).forEach((node) => {
    try {
      if (node.stop) node.stop();
      if (node.disconnect) node.disconnect();
    } catch (_error) {}
  });
  call.ringtoneNodes = [];
}

function prepareIncomingRingtone() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const call = state.extensionCall;
  call.ringtoneContext = call.ringtoneContext || new AudioContextClass();
  call.ringtoneContext.resume?.().catch(() => {});
}

function playIncomingRingBurst() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;
  const call = state.extensionCall;
  prepareIncomingRingtone();
  const ctx = call.ringtoneContext;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0.0001, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.03);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 1.35);
  gain.connect(ctx.destination);

  [440, 480].forEach((frequency) => {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.value = frequency;
    osc.connect(gain);
    osc.start();
    osc.stop(ctx.currentTime + 1.4);
    call.ringtoneNodes.push(osc);
  });
  call.ringtoneNodes.push(gain);
}

function startIncomingRingtone() {
  if (state.extensionCall.ringtoneTimer) return;
  playIncomingRingBurst();
  state.extensionCall.ringtoneTimer = setInterval(playIncomingRingBurst, 3000);
}

function clearConsultTransferState() {
  state.extensionCall.transferController?.dispose().catch(() => {});
  state.extensionCall.consultSession = null;
  state.extensionCall.consultTarget = "";
  state.extensionCall.consultStatus = "";
}

async function assignExtensionCallProtocol() {
  if (state.extensionCall.currentProtocol) return state.extensionCall.currentProtocol;
  const response = await api("/api/extensions/protocol", {
    method: "POST",
    body: JSON.stringify({
      direction: state.extensionCall.currentDirection || "",
      number: state.extensionCall.currentNumber || state.extensionCall.dialNumber || ""
    })
  });
  state.extensionCall.currentProtocol = response.protocol || "";
  return state.extensionCall.currentProtocol;
}

function addExtensionCallHistory(status) {
  if (status === "Registro") return;
  const call = state.extensionCall;
  const activeId = call.activeHistoryId;
  let item = activeId ? (call.history || []).find((entry) => entry.id === activeId) : null;
  if (!item) {
    item = {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      at: Date.now(),
      protocol: call.currentProtocol || "",
      number: call.currentNumber || call.dialNumber || "entrada",
      status: "Em andamento",
      answered: false,
      answeredAt: null,
      duration: "-"
    };
    call.activeHistoryId = item.id;
    call.history = [item, ...(call.history || [])].slice(0, 12);
  }

  item.number = call.currentNumber || call.dialNumber || item.number || "entrada";
  item.protocol = call.currentProtocol || item.protocol || "";

  if (["Em chamada", "Atendendo"].includes(status)) {
    item.answered = true;
    item.answeredAt = item.answeredAt || Date.now();
    item.status = "Atendida";
    item.duration = callDurationLabel(item.answeredAt);
    return;
  }

  if (status === "Falhou" || status === "Encerrada") {
    const endedAt = Date.now();
    const answered = item.answered || Boolean(item.answeredAt);
    item.status = status === "Falhou" ? "Falhou" : answered ? "Atendida" : "Nao atendida";
    item.duration = answered && item.answeredAt ? callDurationLabel(item.answeredAt, endedAt) : "0s";
    call.activeHistoryId = null;
    return;
  }

  item.status = "Em andamento";
  item.duration = item.answeredAt ? callDurationLabel(item.answeredAt) : "-";
}

function operatorHistoryRows() {
  const recentRows = (state.extensionStatus?.recentCalls || []).map((call) => {
    const number = call.customerNumber || (call.type === "outbound" ? call.destination : call.source);
    return {
      id: call.id || call.uniqueId || `${call.startedAt}-${number}`,
      at: Date.parse(call.startedAt || "") || 0,
      protocol: call.protocol || "",
      number: number || call.destination || call.source || "-",
      status: call.statusLabel || call.status || "-",
      duration: call.billsecLabel || call.durationLabel || "-"
    };
  });
  const liveRows = (state.extensionCall.history || []).map((item) => ({
    ...item,
    at: Number(item.at) || Date.now()
  }));
  const existingProtocols = new Set(recentRows.map((item) => item.protocol).filter(Boolean));
  return [
    ...liveRows.filter((item) => !item.protocol || !existingProtocols.has(item.protocol)),
    ...recentRows
  ]
    .sort((left, right) => Number(right.at || 0) - Number(left.at || 0))
    .slice(0, 50);
}

function compactCallTime(value) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function callStatusTone(status) {
  if (status === "answered") return "available";
  if (["busy", "no_answer", "canceled"].includes(status)) return "ringing";
  if (["failed", "rejected"].includes(status)) return "unavailable";
  return "unavailable";
}

async function loadExtensionDialPreview(number) {
  const cleanNumber = String(number || "").trim();
  if (!cleanNumber) {
    state.extensionCall.lastDialPreview = null;
    return null;
  }
  const preview = await api(`/api/extensions/dial-preview?number=${encodeURIComponent(cleanNumber)}`);
  state.extensionCall.lastDialPreview = preview;
  return preview;
}

function renderExtensionPortal() {
  const activeElement = document.activeElement;
  const focusedInsidePhone =
    activeElement?.id &&
    (activeElement.closest?.("#extensionPortal") || activeElement.closest?.("[data-floating-phone]"));
  const focusedId = focusedInsidePhone ? activeElement.id : "";
  const focusedSelection =
    focusedId && typeof activeElement.selectionStart === "number"
      ? { start: activeElement.selectionStart, end: activeElement.selectionEnd }
      : null;
  const portal = state.extensionPortal;
  const extension = portal?.extension || state.extensionSession || {};
  const status = state.extensionStatus || {};
  const live = status.extension || {};
  const queues = status.queues || [];
  const activeChannel = (status.active || [])[0] || null;
  const isRegistered = extensionSoftphoneRegistered();
  const registered = isRegistered ? "Online" : state.extensionCall.registrationStatus === "connecting" ? "Reconectando…" : "Offline";
  const tone = isRegistered ? "available" : "unavailable";
  const statusDetail = extensionStatusLabel();
  const showStatusDetail = !["registrado", "desconectado", "sem registro"].includes(String(statusDetail || "").toLowerCase());
  const microphoneBlocked = !browserCanUseMicrophone();
  const currentNumber = state.extensionCall.currentNumber || activeChannel?.extension || activeChannel?.callerId || "-";
  const callElapsed = state.extensionCall.startedAt ? callDurationLabel(state.extensionCall.startedAt, state.extensionCall.endedAt || Date.now()) : "-";
  const preview = state.extensionCall.lastDialPreview;
  const pauseInfo = currentExtensionPauseInfo();
  const pauseQueuesLabel = pauseInfo.queues?.length ? pauseInfo.queues.join(", ") : "Todas as filas";
  const pauseReasonLabel = pauseInfo.reason || state.extensionCall.pauseReason || "Pausa";
  const pauseOverlay = pauseInfo.paused ? `
    <div class="pause-lock-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div class="pause-lock-panel">
        <span><i data-lucide="pause-circle"></i>Ramal em pausa</span>
        <strong>${escapeHtml(pauseInfo.label)}</strong>
        <small>${escapeHtml(`${pauseReasonLabel} - ${pauseQueuesLabel}`)}</small>
        <button id="queueUnpauseOverlayBtn" class="primary-btn" type="button"><i data-lucide="play"></i>Despausar ramal</button>
      </div>
    </div>
  ` : "";
  const pauseReasonPicker = state.extensionCall.pauseReasonPickerOpen ? `
    <div class="pause-reason-modal" role="dialog" aria-modal="true">
      <div class="pause-reason-panel">
        <span>Motivo da pausa</span>
        <div class="pause-reason-options">
          ${PAUSE_REASONS.map((reason) => `<button class="secondary-btn" type="button" data-pause-reason="${escapeHtml(reason)}">${escapeHtml(reason)}</button>`).join("")}
        </div>
        <button id="pauseReasonCancelBtn" class="ghost-btn" type="button">Cancelar</button>
      </div>
    </div>
  ` : "";
  const historyRows = operatorHistoryRows();
  const sessionCallRows = historyRows.map((item) => {
    const duration = item.id === state.extensionCall.activeHistoryId && item.answeredAt ? callDurationLabel(item.answeredAt) : item.duration;
    return `
      <tr>
        <td>${escapeHtml(compactCallTime(item.at))}</td>
        <td>${escapeHtml(item.direction || item.type || "-")}</td>
        <td>${escapeHtml(duration || "-")}</td>
        <td><strong>${escapeHtml(item.protocol || "-")}</strong></td>
        <td>${escapeHtml(item.number || "-")}</td>
        <td><span class="badge">${escapeHtml(item.status || "-")}</span></td>
      </tr>
    `;
  }).join("");
  const queueCards = queues.map((queue) => `
    <article class="extension-mini-card ${queue.agent?.statusTone === "paused" ? "paused" : ""}">
      <span class="monitor-status-label ${escapeHtml(queue.agent?.statusTone || "unavailable")}">${escapeHtml(queue.agent?.statusLabel || "-")}</span>
      <strong>${escapeHtml(queue.name || queue.id)}</strong>
      <small>${escapeHtml(queue.agent?.statusTone === "paused" ? `${queue.agent?.pauseReason || queue.agent?.pauseName || "Pausa"} - ${queue.agent?.pauseDurationLabel || pauseInfo.label}` : "Disponivel para atendimento")}</small>
    </article>
  `).join("");
  const activeCall = isExtensionCallActive();
  const callLocked = activeCall ? "disabled" : "";
  const consultActive = Boolean(state.extensionCall.transferPhase && state.extensionCall.transferPhase !== "idle");
  const phoneInPicture = Boolean(phonePipWindow());
  const floatingPhone = Boolean(state.extensionCall.floatingPhoneOpen && !phoneInPicture);
  const detachedPhone = floatingPhone || phoneInPicture;
  const floatingButtonTitle = detachedPhone ? "Fixar telefone no painel" : browserCanUsePhonePip() ? "Abrir telefone em janela" : "Destacar telefone";
  const floatingButtonIcon = detachedPhone ? "panel-top" : "picture-in-picture-2";
  const floatingStyle = floatingPhone ? ` style="${floatingPhoneStyle()}"` : "";
  const incomingBanner = state.extensionCall.incoming && !state.extensionCall.autoAnswerNext ? `
    <div class="incoming-call-banner">
      <span><i data-lucide="phone-incoming"></i>Chamada recebida</span>
      <strong>${escapeHtml(currentNumber)}</strong>
      <div>
        <button id="softphoneAnswerBtn" class="primary-btn" type="button"><i data-lucide="phone-forwarded"></i>Atender</button>
        <button id="softphoneHangupBtn" class="secondary-btn danger" type="button"><i data-lucide="phone-off"></i>Recusar</button>
      </div>
    </div>
  ` : "";
  const dialpad = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "*", "0", "#"]
    .map((digit) => `<button class="dial-key" type="button" data-dial-key="${digit}" ${callLocked}>${digit}</button>`)
    .join("");
  const activeCallStage = activeCall ? `
      <div class="active-call-stage">
        <span>${escapeHtml(state.extensionCall.currentDirection === "saida" ? "Chamada de saida" : state.extensionCall.incoming ? "Chamada de entrada" : "Chamada")}</span>
        <strong>${escapeHtml(currentNumber)}</strong>
        ${state.extensionCall.currentProtocol ? `<em>Protocolo ${escapeHtml(state.extensionCall.currentProtocol)}</em>` : ""}
        <small>${escapeHtml(extensionStatusLabel())} - ${escapeHtml(callElapsed)}</small>
      <div class="active-call-actions">
        <button id="softphoneMuteBtn" class="icon-btn ${state.extensionCall.muted ? "active" : ""}" type="button" title="Mutar"><i data-lucide="${state.extensionCall.muted ? "mic-off" : "mic"}"></i></button>
        <button id="softphoneSpeakerBtn" class="icon-btn ${state.extensionCall.speakerMuted ? "active" : ""}" type="button" title="${state.extensionCall.speakerMuted ? "Ativar som" : "Silenciar som"}"><i data-lucide="${state.extensionCall.speakerMuted ? "volume-x" : "volume-2"}"></i></button>
        <button id="softphoneHoldBtn" class="icon-btn ${state.extensionCall.held ? "active" : ""}" type="button" title="Espera"><i data-lucide="pause"></i></button>
        <button id="softphoneHangupBtn" class="icon-btn danger" type="button" title="Encerrar"><i data-lucide="phone-off"></i></button>
      </div>
    </div>
  ` : "";

  $("#extensionTitle").textContent = `${extension.number || "Ramal"} ${extension.name || ""}`.trim();
  const extensionPortalNode = $("#extensionPortal");
  const softphoneHtml = `
    <section class="softphone-panel ${activeCall ? "in-call" : ""} ${floatingPhone ? "floating-phone" : ""}" ${floatingPhone ? "data-floating-phone" : ""}${floatingStyle}>
      <div class="softphone-tools" ${floatingPhone ? "data-floating-phone-handle" : ""}>
        <span><i data-lucide="phone"></i>Telefone</span>
      </div>
      <div class="softphone-status ${isRegistered ? "online" : "offline"} ${showStatusDetail ? "" : "compact"}">
        <span class="monitor-status-label ${tone}">${registered}</span>
        ${showStatusDetail ? `<strong>${escapeHtml(extensionDisplayStatusLabel(statusDetail))}</strong>` : ""}
        <small>${escapeHtml(extension.number || "Ramal")}</small>
      </div>
      ${microphoneBlocked ? `<p class="softphone-warning">Microfone bloqueado em HTTP externo. Use HTTPS ou acesse localmente por http://127.0.0.1:3090 para fazer chamadas.</p>` : ""}
      ${activeCallStage}
      <div class="phone-display webphone-number-row">
        <input id="extensionDialNumber" maxlength="20" pattern="[0-9*#]*" value="${escapeHtml(state.extensionCall.dialNumber)}" inputmode="numeric" placeholder="Numero" ${callLocked} />
        <button id="softphoneClearBtn" class="icon-btn" type="button" title="Limpar numero" ${callLocked}><i data-lucide="delete"></i></button>
      </div>
      ${incomingBanner}
      <div class="dialpad">${dialpad}</div>
      <div class="call-actions">
        <button id="softphoneCallBtn" class="primary-btn" type="button" ${callLocked}><i data-lucide="phone-call"></i>Ligar</button>
        <button id="softphoneAnswerBtn" class="secondary-btn hidden" type="button"><i data-lucide="phone-forwarded"></i>Atender</button>
        <button id="softphoneHangupBtn" class="secondary-btn danger ${activeCall ? "hidden" : ""}" type="button"><i data-lucide="phone-off"></i>Encerrar</button>
      </div>
      <div class="webphone-audio-bar">
        <i data-lucide="volume-2"></i>
        <input id="softphoneVolume" type="range" min="0" max="100" value="${Number(state.extensionCall.volume || 85)}" aria-label="Volume da ligacao" />
        <button id="softphoneAudioSettingsBtn" class="icon-btn ${state.extensionCall.audioSettingsOpen ? "active" : ""}" type="button" title="Configurar audio"><i data-lucide="settings"></i></button>
      </div>
      ${state.extensionCall.audioSettingsOpen ? `
        <section class="webphone-audio-settings">
          <label><span>Áudio da chamada</span><select id="softphoneCallDevice">${extensionDeviceOptions(state.extensionCall.audioOutputs, state.extensionCall.callDeviceId, "Padrão do navegador")}</select></label>
          <label><span>Microfone</span><select id="softphoneMicDevice">${extensionDeviceOptions(state.extensionCall.audioInputs, state.extensionCall.micDeviceId, "Padrão do navegador")}</select></label>
          <button id="softphoneRefreshDevicesBtn" class="secondary-btn compact" type="button"><i data-lucide="refresh-cw"></i>Atualizar dispositivos</button>
        </section>
      ` : ""}
      ${activeChannel ? `<div class="call-actions"><button id="serverHangupBtn" class="icon-btn danger" type="button" data-channel="${escapeHtml(activeChannel.channel)}" title="Derrubar canal"><i data-lucide="unlink"></i></button></div>` : ""}
      <div class="transfer-box">
        <input id="extensionTransferTarget" maxlength="20" pattern="[0-9]*" value="${escapeHtml(state.extensionCall.transferTarget)}" inputmode="numeric" placeholder="Ramal para transferencia assistida" />
        <button id="assistedTransferStartBtn" class="secondary-btn" type="button" ${state.extensionCall.transferPhase && state.extensionCall.transferPhase !== "idle" ? "disabled" : ""}><i data-lucide="messages-square"></i>Transferir</button>
      </div>
      ${consultActive ? `
        <div class="assisted-transfer-panel">
          <span>Transferencia assistida</span>
          <strong>${escapeHtml(state.extensionCall.consultTarget || "-")}</strong>
          <small>${escapeHtml(state.extensionCall.consultStatus || "Consultando ramal")}</small>
          <div>
            <button id="assistedTransferCompleteBtn" class="primary-btn" type="button" ${state.extensionCall.transferPhase === "consulting" ? "" : "disabled"}><i data-lucide="check"></i>Concluir a transferência</button>
            <button id="assistedTransferCancelBtn" class="secondary-btn danger" type="button" ${state.extensionCall.transferBusy ? "disabled" : ""}><i data-lucide="x"></i>Voltar ao cliente</button>
          </div>
        </div>
      ` : ""}
      <p id="extensionCallMessage" class="message">${escapeHtml(state.extensionCall.message || "")}</p>
      ${floatingPhone ? `<button class="floating-phone-resize" type="button" data-floating-phone-resize title="Redimensionar telefone" aria-label="Redimensionar telefone"></button>` : ""}
    </section>
  `;
  const phonePlaceholderHtml = `
    <section class="softphone-panel phone-pip-placeholder">
      <div class="softphone-tools">
        <span><i data-lucide="picture-in-picture-2"></i>Telefone em janela</span>
      </div>
      <p class="message">Telefone aberto em uma janela movel do navegador.</p>
    </section>
  `;
  extensionPortalNode.classList.toggle("phone-floating", floatingPhone || phoneInPicture);
  extensionPortalNode.innerHTML = `
    ${phoneInPicture ? phonePlaceholderHtml : softphoneHtml}
    <section class="extension-monitor-panel">
      <div class="panel-header">
        <h3>Monitor do ramal</h3>
      </div>
      <div class="trunk-strip">
        <span><strong>${escapeHtml(activeCall ? currentNumber : "Sem chamada")}</strong>Numero atual</span>
        <span><strong>${escapeHtml(activeCall ? callElapsed : "-")}</strong>Tempo da ligacao</span>
        <span><strong>${escapeHtml(pauseInfo.paused ? pauseInfo.label : "Nao pausado")}</strong>${escapeHtml(pauseInfo.paused ? pauseReasonLabel : "Pausa")}</span>
      </div>
      ${queueCards ? `<div class="extension-mini-grid">
        ${queueCards || ""}
      </div>` : ""}
      <div class="session-history">
        <h3>Chamadas das ultimas 24h</h3>
        <div class="table-wrap operator-history-table">
          <table>
            <thead><tr><th>Data</th><th>Tipo de ligacao</th><th>Duracao</th><th>Protocolo</th><th>Numero</th><th>Status</th></tr></thead>
            <tbody>${sessionCallRows || `<tr><td colspan="6">Sem chamadas nas ultimas 24h.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
    </section>
    ${pauseReasonPicker}
    ${pauseOverlay}
  `;
  if (phoneInPicture) renderPhonePictureInPicture(softphoneHtml);
  const topPauseButton = $("#queuePauseBtn");
  if (topPauseButton) {
    topPauseButton.classList.toggle("active", Boolean(pauseInfo.paused));
    topPauseButton.innerHTML = `<i data-lucide="${pauseInfo.paused ? "play" : "coffee"}"></i><span>${pauseInfo.paused ? "Despausar" : "Pausa"}</span>`;
    topPauseButton.title = pauseInfo.paused ? "Despausar ramal" : "Pausar fila";
  }
  setExtensionMessage(state.extensionCall.message, state.extensionCall.message ? "info" : "ok");
  iconRefresh();
  if (focusedId) {
    const nextFocus = document.getElementById(focusedId);
    if (nextFocus) {
      nextFocus.focus({ preventScroll: true });
      if (focusedSelection && typeof nextFocus.setSelectionRange === "function") {
        const length = String(nextFocus.value || "").length;
        nextFocus.setSelectionRange(Math.min(focusedSelection.start, length), Math.min(focusedSelection.end, length));
      }
    }
  }
}

async function loadExtensionPortal() {
  try {
    state.extensionPortal = await api("/api/extensions/portal");
    renderExtensionPortal();
  } catch (error) {
    if (isExtensionAuthError(error)) {
      await resetExtensionSessionAfterAuthError();
      return;
    }
    throw error;
  }
}

async function loadExtensionStatus({ preserveDraft = false, background = false } = {}) {
  if (!state.extensionSession) return;
  if (state.extensionStatusRefreshing) return state.extensionStatusRefreshing;
  const refresh = (async () => {
    try {
      state.extensionStatus = await api("/api/extensions/status");
      syncExtensionPauseState();
      const extensionRoot = $("#extensionView");
      if (background) {
        renderSurfaceInBackground(extensionRoot, renderExtensionPortal);
        return;
      }
      const draft = preserveDraft ? captureSurfaceDraft(extensionRoot) : null;
      renderExtensionPortal();
      restoreSurfaceDraft(extensionRoot, draft);
    } catch (error) {
      if (isExtensionAuthError(error)) {
        await resetExtensionSessionAfterAuthError();
        return;
      }
      throw error;
    }
  })();
  state.extensionStatusRefreshing = refresh;
  try {
    return await refresh;
  } finally {
    if (state.extensionStatusRefreshing === refresh) state.extensionStatusRefreshing = null;
  }
}

function waitForSipLibrary(timeoutMs = 7000) {
  if (window.SIP) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(() => {
      if (window.SIP) {
        clearInterval(timer);
        resolve();
        return;
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        reject(new Error("Biblioteca SIP nao carregou"));
      }
    }, 80);
  });
}

function browserCanUseMicrophone() {
  const host = window.location.hostname;
  return window.isSecureContext || ["localhost", "127.0.0.1", "::1"].includes(host);
}

function monitorSpyMode(value = "listen") {
  return MONITOR_SPY_MODES[value] ? value : "listen";
}

function allowedMonitorSpyModes() {
  const localModes = canAccessTab("status")
    ? ["listen", "whisper", "barge"]
    : ["listen"];
  const serverModes = Array.isArray(state.monitorSpy?.allowedModes) && state.monitorSpy.allowedModes.length
    ? state.monitorSpy.allowedModes
    : localModes;
  return localModes.filter((mode) => serverModes.includes(mode));
}

function attachRemoteAudio(session) {
  const audio = $("#remoteAudio");
  const peerConnection = session?.sessionDescriptionHandler?.peerConnection;
  if (!audio || !peerConnection) return;
  const stream = new MediaStream();
  peerConnection.getReceivers().forEach((receiver) => {
    if (receiver.track) stream.addTrack(receiver.track);
  });
  audio.srcObject = stream;
  audio.muted = Boolean(state.extensionCall.speakerMuted);
  audio.volume = Math.max(0, Math.min(1, Number(state.extensionCall.volume || 85) / 100));
  if (typeof audio.setSinkId === "function") audio.setSinkId(state.extensionCall.callDeviceId || "").catch(() => {});
  audio.play().catch(() => {});
}

function extensionAudioConstraints() {
  return state.extensionCall.micDeviceId ? { deviceId: { exact: state.extensionCall.micDeviceId } } : true;
}

function restoreExtensionAudioPreferences() {
  try {
    state.extensionCall.volume = Math.max(0, Math.min(100, Number(localStorage.getItem("uai:webphoneVolume") || 85)));
    state.extensionCall.callDeviceId = localStorage.getItem("uai:webphoneCallDevice") || "";
    state.extensionCall.micDeviceId = localStorage.getItem("uai:webphoneMicDevice") || "";
  } catch (_error) {}
}

function saveExtensionAudioPreferences() {
  try {
    localStorage.setItem("uai:webphoneVolume", String(state.extensionCall.volume));
    localStorage.setItem("uai:webphoneCallDevice", state.extensionCall.callDeviceId || "");
    localStorage.setItem("uai:webphoneMicDevice", state.extensionCall.micDeviceId || "");
  } catch (_error) {}
  attachRemoteAudio(state.extensionCall.consultSession || state.extensionCall.session);
}

async function loadExtensionAudioDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const devices = await navigator.mediaDevices.enumerateDevices();
  state.extensionCall.audioOutputs = devices.filter((device) => device.kind === "audiooutput");
  state.extensionCall.audioInputs = devices.filter((device) => device.kind === "audioinput");
  renderExtensionPortal();
}

function extensionDeviceOptions(devices, selected, fallback) {
  const options = [`<option value="">${escapeHtml(fallback)}</option>`];
  devices.forEach((device, index) => {
    options.push(`<option value="${escapeHtml(device.deviceId)}" ${device.deviceId === selected ? "selected" : ""}>${escapeHtml(device.label || `Dispositivo ${index + 1}`)}</option>`);
  });
  return options.join("");
}

function attachMonitorSpyAudio(session) {
  const audio = $("#monitorSpyAudio");
  const peerConnection = session?.sessionDescriptionHandler?.peerConnection;
  if (!audio || !peerConnection) return;
  const stream = new MediaStream();
  peerConnection.getReceivers().forEach((receiver) => {
    if (receiver.track) stream.addTrack(receiver.track);
  });
  if (!stream.getAudioTracks().length) return;
  audio.srcObject = stream;
  audio.muted = false;
  audio.volume = 1;
  audio.play().catch(() => {});
}

function restoreMonitorSpyAudio() {
  if (!state.monitorSpy?.session) return;
  setTimeout(() => attachMonitorSpyAudio(state.monitorSpy.session), 0);
}

async function terminateSipSession(session) {
  if (!session) return;
  if (session.bye) await session.bye().catch(() => {});
  else if (session.cancel) await session.cancel().catch(() => {});
  else if (session.reject) await session.reject().catch(() => {});
}

function waitForMonitorSpyRegistration(registerer, timeoutMs = 8000) {
  if (registerer.state === SIP.RegistererState.Registered) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      registerer.stateChange.removeListener(listener);
      if (error) reject(error);
      else resolve();
    };
    const listener = (nextState) => {
      if (nextState === SIP.RegistererState.Registered) finish();
      if (nextState === SIP.RegistererState.Terminated) finish(new Error("Registro do monitor foi encerrado pelo servidor"));
    };
    const timer = setTimeout(() => finish(new Error("Servidor nao confirmou o registro do monitor")), timeoutMs);
    registerer.stateChange.addListener(listener);
  });
}

async function finishMonitorSipOperation(operationFactory, timeoutMs = 2500) {
  await Promise.race([
    Promise.resolve().then(operationFactory).catch(() => null),
    new Promise((resolve) => setTimeout(resolve, timeoutMs))
  ]);
}

async function disposeMonitorSpySoftphone() {
  const registerer = state.monitorSpy.registerer;
  const userAgent = state.monitorSpy.ua;
  state.monitorSpy.registerer = null;
  state.monitorSpy.ua = null;
  state.monitorSpy.sip = null;
  if (registerer) await finishMonitorSipOperation(() => registerer.unregister());
  if (userAgent) await finishMonitorSipOperation(() => userAgent.stop());
}

async function ensureMonitorSpySoftphone() {
  await waitForSipLibrary();
  if (!state.monitorSpy.sip) {
    const response = await api("/api/monitor/sip");
    state.monitorSpy.sip = response.sip;
    state.monitorSpy.allowedModes = response.allowedModes || ["listen"];
  }
  if (state.monitorSpy.ua && state.monitorSpy.registerer) {
    if (state.monitorSpy.registerer.state !== SIP.RegistererState.Registered) {
      await state.monitorSpy.registerer.register();
      await waitForMonitorSpyRegistration(state.monitorSpy.registerer);
    }
    return;
  }
  const sip = state.monitorSpy.sip;
  const userAgent = new SIP.UserAgent({
    uri: SIP.UserAgent.makeURI(sip.uri),
    authorizationUsername: sip.authorizationUsername,
    authorizationPassword: sip.password,
    displayName: sip.displayName || "Monitor PBX",
    transportOptions: { server: sip.wsServer },
    sessionDescriptionHandlerFactoryOptions: {
      constraints: { audio: false, video: false }
    }
  });

  userAgent.delegate = {
    async onInvite(invitation) {
      if (!state.monitorSpy.open || !state.monitorSpy.accepting || state.monitorSpy.session) {
        await invitation.reject({ statusCode: 486 });
        return;
      }
      const mode = monitorSpyMode(state.monitorSpy.mode);
      const modeConfig = MONITOR_SPY_MODES[mode];
      state.monitorSpy.session = invitation;
      state.monitorSpy.busy = true;
      state.monitorSpy.status = "Conectando";
      state.monitorSpy.output = `${modeConfig.label} conectando no navegador...`;
      invitation.delegate = {
        ...(invitation.delegate || {}),
        onBye() {
          if (state.monitorSpy.session !== invitation) return;
          state.monitorSpy.session = null;
          state.monitorSpy.busy = false;
          state.monitorSpy.status = "Encerrada";
          state.monitorSpy.output = "Escuta encerrada.";
          renderMonitorSpyPortal();
        },
        onCancel() {
          if (state.monitorSpy.session !== invitation) return;
          state.monitorSpy.session = null;
          state.monitorSpy.busy = false;
          state.monitorSpy.status = "Cancelada";
          state.monitorSpy.output = "Escuta cancelada.";
          renderMonitorSpyPortal();
        }
      };
      const sessionState = window.SIP?.SessionState || {};
      invitation.stateChange?.addListener?.((nextState) => {
        if (state.monitorSpy.session !== invitation) return;
        let shouldAttachAudio = false;
        if (nextState === sessionState.Established) {
          state.monitorSpy.busy = false;
          state.monitorSpy.status = modeConfig.liveLabel;
          state.monitorSpy.output = `${modeConfig.label} conectado ao ramal ${state.monitorSpy.target}.`;
          shouldAttachAudio = true;
        }
        if (nextState === sessionState.Terminated) {
          state.monitorSpy.session = null;
          state.monitorSpy.busy = false;
          state.monitorSpy.status = "Encerrada";
          state.monitorSpy.output = "Escuta encerrada.";
        }
        renderMonitorSpyPortal();
        if (shouldAttachAudio) setTimeout(() => attachMonitorSpyAudio(invitation), 50);
      });
      renderMonitorSpyPortal();
      try {
        await invitation.accept({
          sessionDescriptionHandlerOptions: { constraints: { audio: modeConfig.microphone, video: false } }
        });
      } catch (error) {
        state.monitorSpy.session = null;
        state.monitorSpy.busy = false;
        state.monitorSpy.status = "Falha";
        state.monitorSpy.output = modeConfig.microphone
          ? "Nao foi possivel acessar o microfone para este modo."
          : `Nao foi possivel receber o audio: ${error.message}`;
        await api("/api/pbx/monitor/action", {
          method: "POST",
          body: JSON.stringify({ action: "hangup-monitor-spy" })
        }).catch(() => null);
        await disposeMonitorSpySoftphone();
        renderMonitorSpyPortal();
      }
    }
  };

  state.monitorSpy.ua = userAgent;
  state.monitorSpy.registerer = new SIP.Registerer(userAgent, { expires: WEB_SIP_REGISTER_EXPIRES_SECONDS });
  try {
    await userAgent.start();
    await state.monitorSpy.registerer.register();
    await waitForMonitorSpyRegistration(state.monitorSpy.registerer);
  } catch (error) {
    await disposeMonitorSpySoftphone();
    throw error;
  }
}

function prepareMonitorSpySoftphone() {
  if (!monitorSpyPreparation) {
    monitorSpyPreparation = ensureMonitorSpySoftphone().finally(() => {
      monitorSpyPreparation = null;
    });
  }
  return monitorSpyPreparation;
}

let monitorSpyGeneration = 0;
async function stopMonitorSpy({ keepRegistered = false } = {}) {
  monitorSpyGeneration += 1;
  state.monitorSpy.accepting = false;
  const session = state.monitorSpy.session;
  state.monitorSpy.session = null;
  state.monitorSpy.busy = true;
  state.monitorSpy.status = "Encerrando";
  renderMonitorSpyPortal();
  if (session) await finishMonitorSipOperation(() => {
    if (session.state === SIP.SessionState.Established) return session.bye();
    if (session.state === SIP.SessionState.Initial || session.state === SIP.SessionState.Establishing) return session.reject ? session.reject() : session.cancel();
  });
  await api("/api/pbx/monitor/action", {
    method: "POST",
    body: JSON.stringify({ action: "hangup-monitor-spy" })
  }).catch(() => null);
  state.monitorSpy.session = null;
  if (!keepRegistered) await disposeMonitorSpySoftphone();
  state.monitorSpy.busy = false;
  state.monitorSpy.status = "Parada";
  state.monitorSpy.output = "Monitoramento encerrado.";
  renderMonitorSpyPortal();
}

async function startMonitorBrowserSpy(target, requestedMode = "listen") {
  const mode = monitorSpyMode(requestedMode);
  const modeConfig = MONITOR_SPY_MODES[mode];
  if (!allowedMonitorSpyModes().includes(mode)) throw new Error("Sem permissao para este modo de monitoramento");
  if (modeConfig.microphone && (!browserCanUseMicrophone() || !navigator.mediaDevices?.getUserMedia)) {
    throw new Error("O navegador nao pode acessar o microfone neste ambiente");
  }
  if (state.monitorSpy.busy) return;
  if (state.monitorSpy.session) return;
  const generation = ++monitorSpyGeneration;
  state.monitorSpy.mode = mode;
  state.monitorSpy.busy = true;
  state.monitorSpy.status = "Registrando monitor";
  state.monitorSpy.output = "Preparando o canal seguro de audio...";
  renderMonitorSpyPortal();
  try {
    await prepareMonitorSpySoftphone();
    if (generation !== monitorSpyGeneration || !state.monitorSpy.open) return;
    state.monitorSpy.status = "Conectando";
    state.monitorSpy.output = `Abrindo ${modeConfig.label.toLowerCase()} na chamada do operador...`;
    renderMonitorSpyPortal();
    state.monitorSpy.accepting = true;
    await api("/api/pbx/monitor/action", {
      method: "POST",
      body: JSON.stringify({ action: "spy-browser", target, mode, contact: state.monitorSpy.ua.contact.uri.user })
    });
    if (!state.monitorSpy.session) state.monitorSpy.output = "Solicitacao enviada ao Asterisk.";
    setTimeout(() => {
      if (generation === monitorSpyGeneration && state.monitorSpy.busy && !state.monitorSpy.session && state.monitorSpy.target === target) {
        state.monitorSpy.accepting = false;
        state.monitorSpy.busy = false;
        state.monitorSpy.status = "Falha";
        state.monitorSpy.output = "O monitor nao recebeu a conexao. Tente novamente.";
        renderMonitorSpyPortal();
      }
    }, 12000);
    renderMonitorSpyPortal();
  } catch (error) {
    state.monitorSpy.busy = false;
    state.monitorSpy.status = "Falha";
    state.monitorSpy.output = error.message;
    await disposeMonitorSpySoftphone();
    renderMonitorSpyPortal();
    throw error;
  }
}

function finishSoftphoneSession(session, message = "Chamada encerrada.") {
  stopIncomingRingtone();
  if (session && state.extensionCall.session && state.extensionCall.session !== session) return;

  const hadCallState = Boolean(
    state.extensionCall.session ||
    state.extensionCall.incoming ||
    state.extensionCall.activeHistoryId ||
    ["originando", "chamando", "tocando", "em chamada"].includes(state.extensionCall.status)
  );

  state.extensionCall.endedAt = Date.now();
  if (hadCallState) addExtensionCallHistory("Encerrada");
  state.extensionCall.session = null;
  state.extensionCall.incoming = false;
  state.extensionCall.held = false;
  state.extensionCall.muted = false;
  state.extensionCall.autoAnswerNext = false;
  state.extensionCall.currentProtocol = "";
  clearConsultTransferState();
  state.extensionCall.status = state.extensionCall.ua ? "registrado" : "desconectado";
  setExtensionMessage(message, "info");
  renderExtensionPortal();
}

function watchSipSession(session) {
  const sessionState = window.SIP?.SessionState || {};
  if (session?.stateChange?.addListener) {
    session.stateChange.addListener((nextState) => {
      const label = String(nextState || "").split(".").pop();
      if (nextState === sessionState.Establishing) {
        state.extensionCall.status = "chamando";
        addExtensionCallHistory("Chamando");
      }
      if (nextState === sessionState.Established) {
        stopIncomingRingtone();
        state.extensionCall.incoming = false;
        state.extensionCall.status = "em chamada";
        if (!state.extensionCall.startedAt) state.extensionCall.startedAt = Date.now();
        state.extensionCall.endedAt = null;
        addExtensionCallHistory("Em chamada");
        attachRemoteAudio(session);
      }
      if (nextState === sessionState.Terminated) {
        const detail = `Estado final: ${label || "terminada"}`;
        finishSoftphoneSession(session, `Chamada encerrada. ${detail}`);
      }
      if (nextState !== sessionState.Terminated) renderExtensionPortal();
    });
  }
}

function extensionSoftphoneRegistered() {
  return Boolean(window.SIP && state.extensionCall.ua?.transport.state === SIP.TransportState.Connected && state.extensionCall.registerer?.state === SIP.RegistererState.Registered);
}

const extensionSipRecovery = SipRecovery.create({
  enabled: () => Boolean(state.extensionSession && !state.extensionCall.stopping),
  healthy: extensionSoftphoneRegistered,
  connect: connectExtensionSoftphone,
  status(value) {
    state.extensionCall.registrationStatus = value;
    if (!state.extensionCall.session) state.extensionCall.status = value === "online" ? "registrado" : "registrando";
    if (state.extensionSession) renderSurfaceInBackground($("#extensionView"), renderExtensionPortal);
  }
});

function startSoftphone() {
  return extensionSipRecovery.start();
}

async function connectExtensionSoftphone({ force, valid }) {
  const phone = state.extensionCall;
  const session = state.extensionSession;
  const active = () => valid() && state.extensionCall === phone && state.extensionSession === session;
  const sip = state.extensionPortal?.sip;
  if (!sip) await loadExtensionPortal();
  await waitForSipLibrary();
  if (!active()) throw new Error("Conexão cancelada.");
  if (phone.ua && phone.registerer) {
    await SipRecovery.restoreTransport(phone.ua, { force, valid: active });
    if (phone.registerer.state === SIP.RegistererState.Terminated) {
      phone.registerer = new SIP.Registerer(phone.ua, { expires: WEB_SIP_REGISTER_EXPIRES_SECONDS });
      watchExtensionRegistration(phone, active);
    }
    await SipRecovery.registerConfirmed(phone.registerer, { valid: active });
    return;
  }

  const userAgent = new SIP.UserAgent({
    uri: SIP.UserAgent.makeURI(state.extensionPortal.sip.uri),
    authorizationUsername: state.extensionPortal.sip.authorizationUsername,
    authorizationPassword: state.extensionPortal.sip.password,
    displayName: state.extensionPortal.sip.displayName,
    logConfiguration: false,
    logLevel: "error",
    reconnectionAttempts: 0,
    transportOptions: { server: state.extensionPortal.sip.wsServer, connectionTimeout: 10, keepAliveInterval: 20, keepAliveDebounce: 10 },
    sessionDescriptionHandlerFactoryOptions: {
      constraints: { audio: extensionAudioConstraints(), video: false },
      iceGatheringTimeout: WEBRTC_ICE_GATHERING_TIMEOUT_MS
    }
  });

  userAgent.delegate = {
    async onInvite(invitation) {
      if (!active()) { await invitation.reject({ statusCode: 480 }).catch(() => {}); return; }
      const outgoingOriginate = state.extensionCall.autoAnswerNext;
      state.extensionCall.session = invitation;
      state.extensionCall.incoming = true;
      state.extensionCall.status = "tocando";
      const remoteLabel = cleanCallerLabel(invitation.remoteIdentity?.displayName, cleanCallerLabel(invitation.remoteIdentity?.uri?.user, "entrada"));
      state.extensionCall.currentNumber = outgoingOriginate ? (state.extensionCall.dialNumber || state.extensionCall.currentNumber || "saida") : remoteLabel;
      state.extensionCall.currentDirection = outgoingOriginate ? "saida" : "entrada";
      state.extensionCall.startedAt = null;
      state.extensionCall.endedAt = null;
      await assignExtensionCallProtocol().catch(() => "");
      addExtensionCallHistory(outgoingOriginate ? "Conectando" : "Tocando");
      invitation.delegate = {
        ...(invitation.delegate || {}),
        onCancel() {
          finishSoftphoneSession(invitation, "Chamada cancelada na origem.");
        },
        onBye() {
          finishSoftphoneSession(invitation, "Chamada encerrada pela outra ponta.");
        }
      };
      watchSipSession(invitation);
      if (!outgoingOriginate) {
        startIncomingRingtone();
        showIncomingDesktopNotification(state.extensionCall.currentNumber);
        setExtensionMessage(`Chamada recebida de ${state.extensionCall.currentNumber}.`, "info");
      }
      renderExtensionPortal();
      if (outgoingOriginate) {
        state.extensionCall.autoAnswerNext = false;
        answerSoftphone().catch((error) => setExtensionMessage(`Falha ao atender chamada originada: ${error.message}`, "error"));
      }
    }
  };

  phone.ua = userAgent;
  phone.registerer = new SIP.Registerer(userAgent, { expires: WEB_SIP_REGISTER_EXPIRES_SECONDS });
  userAgent.transport.stateChange.addListener(nextState => {
    if (active() && nextState === SIP.TransportState.Disconnected) extensionSipRecovery.schedule("conexão interrompida");
  });
  watchExtensionRegistration(phone, active);
  await SipRecovery.restoreTransport(userAgent, { force, valid: active });
  await SipRecovery.registerConfirmed(phone.registerer, { valid: active });
}

function watchExtensionRegistration(phone, active) {
  phone.registerer.stateChange.addListener(nextState => {
    if (!active()) return;
    if (nextState === SIP.RegistererState.Unregistered || nextState === SIP.RegistererState.Terminated) extensionSipRecovery.schedule("registro interrompido");
  });
}

async function refreshSoftphoneRegistration() {
  await startSoftphone();
  await extensionSipRecovery.ensure({ probe: true });
  await loadExtensionStatus().catch(() => {});
}

async function autoRegisterSoftphone() {
  if (!state.extensionSession) return;
  restoreExtensionAudioPreferences();
  state.extensionCall.status = "registrando";
  renderExtensionPortal();
  try {
    await startSoftphone();
    await loadExtensionStatus();
  } catch (error) {
    setExtensionMessage("Conexão interrompida. Tentando reconectar automaticamente…", "info");
  }
}

async function callFromSoftphone() {
  if (isExtensionCallActive()) {
    setExtensionMessage("Finalize a ligacao atual antes de iniciar outra.", "error");
    return;
  }
  await refreshSoftphoneRegistration();
  if (!state.extensionSession) return;
  if (!browserCanUseMicrophone()) {
    throw new Error("Para ligar, acesse o PBX por HTTPS ou use http://127.0.0.1:3090 neste computador. Navegadores bloqueiam microfone em HTTP externo.");
  }
  const number = String(state.extensionCall.dialNumber || "").trim();
  if (!number) throw new Error("Informe um numero para discar");
  let preview = null;
  try {
    preview = await loadExtensionDialPreview(number);
  } catch (error) {
    if (isExtensionAuthError(error)) {
      await resetExtensionSessionAfterAuthError();
      return;
    }
    throw error;
  }
  if (preview && !preview.permitted) {
    throw new Error("Numero nao bate com nenhum ramal interno nem com rota de saida liberada.");
  }
  state.extensionCall.currentNumber = number;
  state.extensionCall.currentDirection = "saida";
  state.extensionCall.startedAt = Date.now();
  state.extensionCall.endedAt = null;
  state.extensionCall.status = "originando";
  state.extensionCall.autoAnswerNext = true;
  await assignExtensionCallProtocol().catch(() => "");
  addExtensionCallHistory("Originando");
  renderExtensionPortal();
  try {
    try {
      await api("/api/extensions/call", {
        method: "POST",
        body: JSON.stringify({ number })
      });
    } catch (error) {
      if (isExtensionAuthError(error)) {
        await resetExtensionSessionAfterAuthError();
        return;
      }
      if (error.status !== 503) throw error;
      setExtensionMessage("Revalidando registro SIP do navegador e tentando novamente...", "info");
      addExtensionCallHistory("Registro");
      await refreshSoftphoneRegistration();
      if (!state.extensionSession) return;
      await api("/api/extensions/call", {
        method: "POST",
        body: JSON.stringify({ number })
      });
    }
    state.extensionCall.status = "chamando";
    setExtensionMessage("Chamada enviada para o Asterisk. Conectando o softphone...", "info");
    renderExtensionPortal();
  } catch (error) {
    if (isExtensionAuthError(error)) {
      await resetExtensionSessionAfterAuthError();
      return;
    }
    state.extensionCall.autoAnswerNext = false;
    state.extensionCall.endedAt = Date.now();
    state.extensionCall.status = state.extensionCall.ua ? "registrado" : "desconectado";
    addExtensionCallHistory("Falhou");
    setExtensionMessage(`Chamada falhou: ${error.detail || error.message}`, "error");
    renderExtensionPortal();
    throw error;
  }
}

async function answerSoftphone() {
  const session = state.extensionCall.session;
  if (!session?.accept) return;
  stopIncomingRingtone();
  state.extensionCall.currentDirection = state.extensionCall.currentDirection || "entrada";
  state.extensionCall.startedAt = Date.now();
  state.extensionCall.endedAt = null;
  addExtensionCallHistory("Atendendo");
  await session.accept({
    sessionDescriptionHandlerOptions: {
      constraints: { audio: extensionAudioConstraints(), video: false },
      iceGatheringTimeout: WEBRTC_ICE_GATHERING_TIMEOUT_MS
    }
  });
}

async function hangupSoftphone() {
  const session = state.extensionCall.session;
  stopIncomingRingtone();
  await terminateSipSession(state.extensionCall.consultSession);
  clearConsultTransferState();
  if (!session) {
    finishSoftphoneSession(null, "Chamada encerrada.");
    return;
  }
  await terminateSipSession(session);
  finishSoftphoneSession(session, "Chamada encerrada.");
}

function toggleSoftphoneMute() {
  const peerConnection = state.extensionCall.session?.sessionDescriptionHandler?.peerConnection;
  state.extensionCall.muted = !state.extensionCall.muted;
  peerConnection?.getSenders().forEach((sender) => {
    if (sender.track?.kind === "audio") sender.track.enabled = !state.extensionCall.muted;
  });
  renderExtensionPortal();
}

function toggleSoftphoneSpeaker() {
  state.extensionCall.speakerMuted = !state.extensionCall.speakerMuted;
  const audio = $("#remoteAudio");
  if (audio) audio.muted = state.extensionCall.speakerMuted;
  renderExtensionPortal();
}

async function setSoftphoneHold(nextHeld) {
  const session = state.extensionCall.session;
  const holdModifier = window.SIP?.Web?.holdModifier;
  if (session?.invite && holdModifier) {
    await session.invite({ sessionDescriptionHandlerModifiers: nextHeld ? [holdModifier] : [] }).catch(() => {});
  }
  state.extensionCall.held = nextHeld;
  const peerConnection = state.extensionCall.session?.sessionDescriptionHandler?.peerConnection;
  peerConnection?.getSenders().forEach((sender) => {
    if (sender.track?.kind === "audio") sender.track.enabled = !state.extensionCall.held && !state.extensionCall.muted;
  });
  if (!nextHeld) attachRemoteAudio(session);
  renderExtensionPortal();
}

async function toggleSoftphoneHold() {
  await setSoftphoneHold(!state.extensionCall.held);
}

async function transferSoftphone() {
  return startAssistedTransfer();
}

function assistedTransferController() {
  if (!state.extensionCall.transferController) {
    state.extensionCall.transferController = window.AssistedTransfer.create({
      SIP: window.SIP,
      getSession: () => state.extensionCall.session,
      getAgent: () => state.extensionCall.ua,
      getMuted: () => state.extensionCall.muted,
      getDomain: () => state.extensionPortal.sip.domain,
      constraints: () => ({ audio: extensionAudioConstraints(), video: false }),
      audio: attachRemoteAudio,
      report: error => setExtensionMessage(error.message, "error"),
      changed: ({ phase, target, busy }) => {
        state.extensionCall.transferPhase = phase;
        state.extensionCall.transferBusy = busy;
        state.extensionCall.consultSession = state.extensionCall.transferController?.consult || null;
        state.extensionCall.consultTarget = target;
        state.extensionCall.consultStatus = ({ holding: "Colocando cliente em espera", calling: "Chamando destino", consulting: "Em consulta. Cliente em espera", completing: "Concluindo transferência", returning: "Voltando ao cliente", held: "Cliente em espera. Clique em Voltar ao cliente" })[phase] || "";
        state.extensionCall.held = phase !== "idle";
        renderExtensionPortal();
      }
    });
  }
  return state.extensionCall.transferController;
}

function watchConsultTransferSession(session) {
  const sessionState = window.SIP?.SessionState || {};
  session?.stateChange?.addListener?.((nextState) => {
    if (nextState === sessionState.Establishing) {
      state.extensionCall.consultStatus = "Chamando ramal";
    }
    if (nextState === sessionState.Established) {
      state.extensionCall.consultStatus = "Em consulta";
      attachRemoteAudio(session);
    }
    if (nextState === sessionState.Terminated) {
      if (state.extensionCall.consultSession === session) {
        clearConsultTransferState();
        setSoftphoneHold(false).catch(() => {});
        setExtensionMessage("Consulta encerrada. Cliente voltou da espera.", "info");
      }
    }
    renderExtensionPortal();
  });
}

async function startAssistedTransfer() {
  await assistedTransferController().start(String(state.extensionCall.transferTarget || "").trim());
}

async function completeAssistedTransfer() {
  await assistedTransferController().complete();
  setExtensionMessage("Transferencia assistida confirmada.", "ok");
  state.extensionCall.endedAt = Date.now();
  addExtensionCallHistory("Encerrada");
  state.extensionCall.session = null;
  state.extensionCall.incoming = false;
  state.extensionCall.held = false;
  state.extensionCall.status = state.extensionCall.ua ? "registrado" : "desconectado";
  clearConsultTransferState();
  renderExtensionPortal();
}

async function cancelAssistedTransfer() {
  await assistedTransferController().cancel();
  setExtensionMessage("Transferencia assistida cancelada. Cliente voltou da espera.", "info");
}

async function sendExtensionAction(action, payload = {}) {
  const response = await api("/api/extensions/action", {
    method: "POST",
    body: JSON.stringify({ action, ...payload })
  });
  setExtensionMessage(action === "hangup" ? "Canal desconectado." : "Comando enviado.", "ok");
  await loadExtensionStatus();
}

async function pauseExtensionQueue(reason) {
  const startedAt = Date.now();
  const response = await api("/api/extensions/action", {
    method: "POST",
    body: JSON.stringify({ action: "queue-pause", reason })
  });
  state.extensionCall.queuePaused = true;
  state.extensionCall.pauseStartedAt = startedAt;
  state.extensionCall.pauseQueues = (state.extensionStatus?.queues || []).map((queue) => queue.name || queue.id).filter(Boolean);
  state.extensionCall.pauseReason = response.pause?.reason || reason || "Pausa";
  state.extensionCall.pauseReasonPickerOpen = false;
  setExtensionMessage("Ramal pausado.", "ok");
  renderExtensionPortal();
  await loadExtensionStatus();
}

async function unpauseExtensionQueue() {
  const response = await api("/api/extensions/action", {
    method: "POST",
    body: JSON.stringify({ action: "queue-unpause" })
  });
  state.extensionCall.queuePaused = false;
  state.extensionCall.pauseStartedAt = null;
  state.extensionCall.pauseQueues = [];
  state.extensionCall.pauseReason = "";
  state.extensionCall.pauseReasonPickerOpen = false;
  setExtensionMessage("Ramal voltou da pausa.", "ok");
  renderExtensionPortal();
  await loadExtensionStatus();
}

function updateTopbarActions() {
  const editableTabs = ["trunk", "extensions", "routing", "ivr", "queues", "security"];
  const isAdmin = state.user?.role === "admin" || state.user?.username === "admin";
  $("#saveBtn")?.classList.toggle("hidden", !(isAdmin || state.activeTab === "queues" && canAccessTab("queues")) || !editableTabs.includes(state.activeTab));
}

async function loadConfig() {
  state.config = await api("/api/config");
  state.configBaseline = JSON.parse(JSON.stringify(state.config));
  renderAll();
  if (canAccessTab("dialer")) void loadDialerCampaigns({ background: true }).catch(() => {});
}

function renderAll() {
  if (!state.config) return;
  syncIvrBuilderFromRoute();
  syncActiveTabUi();
  renderOverview();
  renderStatus();
  renderTrunk();
  renderExtensions();
  renderRouting();
  renderIvr();
  renderDialer();
  renderAudios();
  renderIvrAudios();
  renderQueues();
  renderSecurity();
  renderLogs();
  renderReports();
  renderAudit();
  renderUsers();
  iconRefresh();
}

function statusTone(registered, stateText = "") {
  const normalized = String(stateText || "").trim().toLowerCase();
  if (registered || ["registered", "available", "reachable", "not in use", "idle", "in use", "ringing", "busy", "on hold"].includes(normalized)) return "ok";
  if (["unavailable", "nonqual", "lagged", "unknown", "no verificado", "nao verificado", "nao carregado"].includes(normalized)) return "warn";
  return "error";
}

function monitorStatusTone(value = "") {
  const normalized = String(value || "").trim().toLowerCase();
  if (["available", "disponivel", "ok"].includes(normalized)) return "available";
  if (["paused", "pausado"].includes(normalized)) return "paused";
  if (["busy", "ligacao", "in use", "ocupado"].includes(normalized)) return "busy";
  if (["ringing", "hold", "tocando", "espera"].includes(normalized)) return "ringing";
  return "unavailable";
}

function monitorNumber(value) {
  return Number(value || 0).toLocaleString("pt-BR");
}

function uniqueMonitorAgentCounts(queues = []) {
  const tonePriority = { unavailable: 0, available: 1, paused: 2, ringing: 3, busy: 4 };
  const agents = new Map();

  queues.forEach((queue, queueIndex) => {
    (queue.agents || []).forEach((agent, agentIndex) => {
      const number = String(agent.number || agent.interface || "").trim();
      const key = number || `${queueIndex}:${agentIndex}`;
      const tone = monitorStatusTone(agent.statusTone || agent.status);
      const previous = agents.get(key);
      if (!previous || tonePriority[tone] > tonePriority[previous]) agents.set(key, tone);
    });
  });

  const counts = { available: 0, paused: 0, busy: 0, ringing: 0, unavailable: 0, agents: agents.size };
  agents.forEach((tone) => {
    counts[tone] += 1;
  });
  return counts;
}

function queueCompactId(queue, index = 0) {
  return String(queue.id || queue.number || queue.name || index);
}

function visibleCompactQueues(queues = []) {
  const hidden = new Set((state.monitorCompact.hiddenQueues || []).map(String));
  return queues.filter((queue, index) => !hidden.has(queueCompactId(queue, index)));
}

function compactAgentCallPair(agent = {}) {
  const made = Number(agent.callsMadeToday ?? agent.madeCalls ?? agent.outboundCalls ?? 0) || 0;
  const received = Number(agent.callsReceivedToday ?? agent.receivedCalls ?? agent.inboundCalls ?? agent.callsTaken ?? 0) || 0;
  return `${monitorNumber(made)}/${monitorNumber(received)}`;
}

function agentPauseSummary(agent = {}, tone = "") {
  if (tone !== "paused") return "";
  const duration = agent.pauseDurationLabel || (Number(agent.pauseSeconds) ? formatSeconds(agent.pauseSeconds) : "0s");
  const reason = agent.pauseReason || agent.pauseName || "Pausa";
  return `${duration} - ${reason}`;
}

const queueBoardStates = {
  available: "Disponível", ringing: "Tocando", busy: "Em ligação", paused: "Em pausa", unavailable: "Offline"
};

const monitorSettings = $("#monitorSettings");
let monitorSettingsSection = "queues";
let monitorSettingsOpener = "";

function monitorSettingsQueues() {
  return state.pbxStatus?.queues?.length ? state.pbxStatus.queues : state.config?.queues || [];
}

function queueSearchKey(value) {
  return String(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function filterMonitorChoices() {
  const query = queueSearchKey($("#msSearch").value);
  const cards = $all("#msOptions .ms-choice");
  for (const card of cards) card.hidden = !card.dataset.search.includes(query);
  const matches = cards.filter((card) => !card.hidden);
  const count = cards.filter((card) => card.querySelector("input").checked).length;
  $("#msCount").textContent = `${count} de ${cards.length} ${cards.length === 1 ? "fila visível" : "filas visíveis"}`;
  $("#msEmpty").hidden = matches.length > 0;
  $("#msEmpty").textContent = query ? "Nenhuma fila encontrada para essa busca." : "Nenhuma fila cadastrada.";
  for (const button of $all("[data-ms-select]")) {
    const select = button.dataset.msSelect === "all";
    button.textContent = query ? (select ? "Marcar resultados" : "Desmarcar resultados") : (select ? "Marcar todas" : "Desmarcar todas");
    button.disabled = !matches.some((card) => card.querySelector("input").checked !== select);
  }
}

function renderMonitorChoices() {
  const section = monitorSettingsSection;
  const queues = section === "queues";
  const prefs = state.monitorCompact;
  const hidden = new Set(prefs.hiddenQueues);
  const configured = new Map((state.config?.queues || []).map((q) => [String(q.id), q]));
  const choices = queues ? monitorSettingsQueues().map((q, index) => {
    const id = queueCompactId(q, index);
    const number = String(q.number || configured.get(id)?.number || id);
    return { key: id, name: q.name || id, detail: "Fila " + number, checked: !hidden.has(id) };
  }) : (section === "fields" ? compactMonitorFieldOptions : compactMonitorStatusOptions)
    .map(([key, name]) => ({ key, name, checked: prefs[section][key] !== false }));

  for (const button of $all("[data-ms-section]")) button.setAttribute("aria-pressed", String(button.dataset.msSection === section));
  $("#msQueueTools").hidden = !queues;
  $("#msEmpty").hidden = true;
  const options = $("#msOptions");
  options.setAttribute("aria-label", queues ? "Filas visíveis" : section === "fields" ? "Colunas visíveis" : "Status visíveis");
  options.innerHTML = choices.map(({ key, name, detail, checked }, index) => `
    <div class="ms-choice" data-search="${escapeHtml(queueSearchKey([name, detail, key].join(" ")))}">
      <input id="msChoice${index}" type="checkbox" value="${escapeHtml(key)}" ${checked ? "checked" : ""}>
      <label for="msChoice${index}">${section === "statuses" ? `<span class="ms-dot ${key}" aria-hidden="true"></span>` : ""}
        <span class="ms-copy"><span>${escapeHtml(name)}</span>${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</span>
      </label>
    </div>`).join("");
  options.scrollTop = 0;
  if (queues) filterMonitorChoices();
}

function saveMonitorChoices(inputs, checked) {
  const prefs = state.monitorCompact;
  const hidden = new Set(prefs.hiddenQueues);
  for (const input of inputs) {
    input.checked = checked;
    if (monitorSettingsSection === "queues") {
      if (checked) hidden.delete(input.value);
      else hidden.add(input.value);
    } else {
      prefs[monitorSettingsSection][input.value] = checked;
    }
  }
  if (monitorSettingsSection === "queues") {
    prefs.hiddenQueues = [...hidden];
    filterMonitorChoices();
  }
  saveMonitorCompactSettings();
}

$("#msSearch").addEventListener("input", filterMonitorChoices);
$("#msOptions").addEventListener("change", (event) => {
  if (event.target.matches('input[type="checkbox"]')) saveMonitorChoices([event.target], event.target.checked);
});
monitorSettings.addEventListener("click", (event) => {
  if (event.target.closest("[data-ms-close]")) return monitorSettings.close();
  const tab = event.target.closest("[data-ms-section]");
  if (tab) {
    monitorSettingsSection = tab.dataset.msSection;
    renderMonitorChoices();
  }
  const bulk = event.target.closest("[data-ms-select]");
  if (bulk) saveMonitorChoices($all("#msOptions .ms-choice:not([hidden]) input"), bulk.dataset.msSelect === "all");
  if (event.target.closest("#msReset")) {
    const { view, queueSearch } = state.monitorCompact;
    state.monitorCompact = { ...defaultMonitorCompactSettings(), view, queueSearch };
    $("#msSearch").value = "";
    saveMonitorCompactSettings();
    renderMonitorChoices();
  }
});
monitorSettings.addEventListener("close", () => {
  if (!state.user || !state.config) return;
  renderMonitorPreferencesSurface();
  iconRefresh();
  document.getElementById(monitorSettingsOpener)?.focus({ preventScroll: true });
});

function renderWaitingCalls(calls) {
  return calls.map((call) => {
    const canCapture = (state.pbxStatus?.captureQueues || []).includes(call.queue);
    return `<article class="mini-monitor-card waiting-call-card">
      <div><strong>${escapeHtml(call.callerId || "Número privado")}</strong>
        <span>${escapeHtml(call.queueName || call.queue)} · ${monitorNumber(call.position)}º na fila</span>
        <span>Em espera há ${escapeHtml(call.wait || "0:00")}</span></div>
      ${canCapture ? `<button type="button" class="secondary-btn compact" data-transfer-waiting="${escapeHtml(call.channel)}" data-queue="${escapeHtml(call.queue)}" ${call.channel ? "" : "disabled"}>Capturar ligação</button>` : ""}
    </article>`;
  }).join("");
}

const captureDialog = $("#captureDialog");
const captureSearch = $("#captureSearch");
const captureTargets = $("#captureTargets");
let captureRequest = null;

function refreshCaptureDialog(matchNumber = false) {
  if (!captureDialog.open || !captureRequest) return;
  const { queue, channel, busy } = captureRequest;
  const waiting = state.pbxStatus?.waitingCalls?.some((call) => call.queue === queue && call.channel === channel);
  const query = captureSearch.value.trim().toLocaleLowerCase("pt-BR");
  const targets = (state.pbxStatus?.captureTargets || []).filter((ext) =>
    `${ext.number} ${ext.name || ""}`.toLocaleLowerCase("pt-BR").includes(query));
  const options = targets.map((ext) => `<option value="${escapeHtml(ext.number)}">${escapeHtml(ext.number)} · ${escapeHtml(ext.name || "Ramal")}</option>`).join("");
  const previous = captureTargets.value;
  if (options !== captureRequest.options) {
    captureTargets.innerHTML = options;
    captureRequest.options = options;
    captureTargets.value = previous;
  }
  if (matchNumber && query && targets.some((ext) => ext.number === query)) captureTargets.value = query;
  captureSearch.disabled = busy || !waiting;
  captureTargets.disabled = busy || !waiting;
  $("#captureSubmit").disabled = busy || !waiting || !captureTargets.value;
  $("#captureCancel").disabled = busy;
  $("#captureFeedback").textContent = busy ? "Solicitando encaminhamento…" :
    !waiting ? "Esta chamada já saiu da fila." : captureRequest.error ||
    (targets.length ? "" : query ? "Nenhum ramal disponível com esse nome ou número." : "Nenhum ramal disponível no momento.");
}

function openCaptureDialog(button) {
  const channel = button.dataset.transferWaiting;
  const queue = button.dataset.queue;
  const call = state.pbxStatus?.waitingCalls?.find((item) => item.channel === channel && item.queue === queue);
  if (!call) return setMessage("Esta chamada já saiu da fila.", "info");
  captureRequest = { channel, queue, busy: false };
  $("#captureCaller").textContent = `${call.callerId || "Número privado"} · ${call.queueName || queue}`;
  captureSearch.value = "";
  captureTargets.replaceChildren();
  captureDialog.showModal();
  refreshCaptureDialog();
  captureSearch.focus();
}

captureSearch.addEventListener("input", () => { captureRequest.error = ""; refreshCaptureDialog(true); });
captureTargets.addEventListener("change", () => { captureRequest.error = ""; refreshCaptureDialog(); });
$("#captureCancel").addEventListener("click", () => captureDialog.close());
captureDialog.addEventListener("cancel", (event) => { if (captureRequest?.busy) event.preventDefault(); });
captureDialog.addEventListener("close", () => { captureRequest = null; });
$("#captureForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!captureRequest || $("#captureSubmit").disabled) return;
  const target = captureTargets.value;
  const { channel, queue } = captureRequest;
  captureRequest.busy = true;
  refreshCaptureDialog();
  try {
    await api("/api/pbx/monitor/action", { method: "POST", body: JSON.stringify({ action: "transfer-waiting", channel, queue, target }) });
    captureDialog.close();
    setMessage(`Encaminhamento solicitado para o ramal ${target}.`, "ok");
  } catch (error) {
    captureRequest.error = error.message;
    captureRequest.busy = false;
    refreshCaptureDialog();
  }
  await loadPbxStatus({ background: true }).catch(() => {});
});

function renderCompactMonitor(queues = [], waitingCalls = [], totals = {}, lastReadLabel = "", trunkStatus = "", trunkTone = "warn", liveLabel = "") {
  const prefs = state.monitorCompact;
  const visibleQueues = visibleCompactQueues(queues);
  const searchValue = String(prefs.queueSearch || "");
  const compactPanels = commandCenterQueueCards(visibleQueues, "", searchValue);
  const waitingRows = renderWaitingCalls(waitingCalls);

  return `
    <div class="monitor-page compact-monitor-page command-center">
      <section class="command-kpi-grid monitor-command-kpis">
        ${[
          ["Filas monitoradas", visibleQueues.length, `${queues.length} cadastradas`, "list-ordered", "accent"],
          ["Em espera", totals.waiting || 0, "Neste momento", "clock-3", totals.waiting ? "caution" : "success"],
          ["Atendidas", totals.completed || 0, "Hoje", "phone-call", "success"],
          ["Perdidas", totals.abandoned || 0, "Hoje", "phone-missed", totals.abandoned ? "danger" : "success"],
          ["Agentes em pausa", totals.paused || 0, "Agora", "circle-pause", totals.paused ? "caution" : "neutral"],
          ["Agentes disponiveis", totals.available || 0, "Agora", "user-round-check", "success"]
        ].map(([label, value, meta, icon, tone]) => `
          <article class="command-kpi ${tone}">
            <i data-lucide="${icon}"></i>
            <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(meta)}</small></div>
          </article>`).join("")}
      </section>
      <section class="panel command-monitor-panel">
        <header class="command-monitor-header">
          <div>
            <h3>Filas de atendimento</h3>
            <span><i class="command-live-dot"></i> ${escapeHtml(liveLabel)}</span>
          </div>
          <div class="command-monitor-tools">
            <label class="command-search" title="Buscar fila ou ramal">
              <i data-lucide="search"></i>
              <input data-compact-search type="search" placeholder="Buscar fila ou ramal..." value="${escapeHtml(searchValue)}" />
            </label>
            <span class="badge ${trunkTone}">${trunkStatus === "Registered" ? "Tronco registrado" : `Tronco · ${escapeHtml(trunkStatus)}`}</span>
            <button id="monitorCompactSettingsBtn" class="secondary-btn compact" type="button"><i data-lucide="sliders-horizontal"></i>Personalizar</button>
            <button id="monitorViewToggleBtn" class="icon-btn" type="button" title="Abrir monitor completo"><i data-lucide="maximize-2"></i></button>
            <button id="refreshPbxStatusBtn" class="icon-btn" type="button" title="Atualizar agora"><i data-lucide="rotate-cw"></i></button>
          </div>
        </header>
        <div class="queue-board-key">
          <div aria-label="Status dos ramais">${Object.entries(queueBoardStates).map(([tone, label]) =>
            `<span><i aria-hidden="true" class="queue-presence ${tone}"></i>${label}</span>`).join("")}</div>
          <small>Atualizado em ${escapeHtml(lastReadLabel)}</small>
        </div>
        <div class="queue-board">
          ${compactPanels || `<div class="command-empty"><i data-lucide="search-x"></i><strong>Nenhuma fila encontrada</strong><span>Revise a busca ou as filas visiveis.</span></div>`}
        </div>

      </section>
      <section class="panel monitor-waiting monitor-waiting-final">
        <div class="panel-header">
          <h3>Chamadas em espera</h3>
          <span class="badge ${waitingCalls.length ? "warn" : "ok"}">${monitorNumber(waitingCalls.length)}</span>
        </div>
        <div class="mini-monitor-list waiting-call-list">${waitingRows || `<p class="hint">Nenhuma chamada aguardando atendimento.</p>`}</div>
      </section>
    </div>
  `;
}

function renderMonitorSpyModal() {
  if (!state.monitorSpy?.open) return "";
  const target = String(state.monitorSpy.target || "");
  const targetExtension = (state.config.extensions || []).find((extension) => String(extension.number) === target);
  const listening = Boolean(state.monitorSpy.session);
  const busy = Boolean(state.monitorSpy.busy);
  const locked = busy;
  const mode = monitorSpyMode(state.monitorSpy.mode);
  const modeConfig = MONITOR_SPY_MODES[mode];
  const modeHint = {
    listen: "Somente o supervisor recebe o audio da chamada.",
    whisper: "A voz do supervisor e enviada somente ao operador.",
    barge: "A voz do supervisor e enviada ao operador e ao cliente."
  }[mode];
  const modeOptions = allowedMonitorSpyModes()
    .map((key) => {
      const item = MONITOR_SPY_MODES[key];
      return `
        <button class="monitor-spy-mode ${mode === key ? "active" : ""}" type="button" data-monitor-spy-mode="${key}" aria-pressed="${mode === key}" ${locked ? "disabled" : ""}>
          <i data-lucide="${item.icon}"></i><span>${escapeHtml(item.label)}</span>
        </button>`;
    })
    .join("");
  return `
    <div class="modal-backdrop" data-monitor-spy-close></div>
    <section class="modal-card monitor-spy-card" role="dialog" aria-modal="true" aria-label="Monitoramento em tempo real">
      <header>
        <div>
          <p class="eyebrow">Monitoramento</p>
          <h3>Chamada do ramal ${escapeHtml(target || "-")}</h3>
          <p class="hint">${escapeHtml(modeHint)}</p>
        </div>
        <button class="icon-btn" id="monitorSpyCloseBtn" type="button" title="Fechar"><i data-lucide="x"></i></button>
      </header>
      <div class="detail-grid compact-detail-grid">
        <span><strong>Ramal monitorado</strong>${escapeHtml(target || "-")}</span>
        <span><strong>Operador</strong>${escapeHtml(targetExtension?.name || "-")}</span>
      </div>
      <div class="monitor-spy-modes" role="group" aria-label="Modo de monitoramento">${modeOptions}</div>
      <div class="monitor-spy-player" aria-live="polite">
        <span class="badge ${listening ? "ok" : "warn"}">${escapeHtml(state.monitorSpy.status || (listening ? "Ao vivo" : "Pronta"))}</span>
        <audio id="monitorSpyAudio" autoplay playsinline></audio>
      </div>
      ${state.monitorSpy.output ? `<p class="callout ok">${escapeHtml(state.monitorSpy.output)}</p>` : ""}
      <div class="modal-actions">
        <button class="secondary-btn" id="monitorSpyCancelBtn" type="button">Cancelar</button>
        ${listening ? `<button class="secondary-btn danger" id="monitorSpyStopBtn" type="button"><i data-lucide="phone-off"></i>Encerrar monitoramento</button>` : ""}
        <button class="primary-btn" id="monitorSpyStartBtn" type="button" ${locked || listening ? "disabled" : ""}><i data-lucide="${modeConfig.icon}"></i>${escapeHtml(busy ? "Conectando..." : modeConfig.actionLabel)}</button>
      </div>
    </section>
  `;
}

function renderMonitorSpyPortal() {
  if (!monitorSpyPortal) return;
  const audio = monitorSpyPortal.querySelector("#monitorSpyAudio");
  if (audio) audio.remove();
  monitorSpyPortal.innerHTML = renderMonitorSpyModal();
  const replacement = monitorSpyPortal.querySelector("#monitorSpyAudio");
  if (audio && replacement) replacement.replaceWith(audio);
  else if (audio) { audio.pause(); audio.srcObject = null; }
  restoreMonitorSpyAudio();
  iconRefresh();
}

function renderStatus() {
  const status = state.pbxStatus;
  const trunkStatus = status?.trunk?.registration?.status || "Nao verificado";
  const trunkTone = statusTone(trunkStatus === "Registered", trunkStatus);
  const queues = status?.queues?.length
    ? status.queues
    : (state.config.queues || []).map((queue) => ({
        ...queue,
        callsWaiting: 0,
        completed: 0,
        abandoned: 0,
        holdTimeLabel: "0s",
        talkTimeLabel: "0s",
        productivity: 0,
        serviceLevel: 0,
        serviceLevelSeconds: queue.timeout || 0,
        counts: { available: 0, paused: 0, busy: 0, ringing: 0, unavailable: queue.members?.length || 0 },
        agents: (queue.members || []).map((member) => {
          const extension = state.config.extensions.find((item) => item.number === member) || {};
          return {
            number: member,
            name: extension.name || member,
            penalty: "",
            statusLabel: "Nao verificado",
            statusTone: "unavailable",
            callsTaken: 0,
            loginTime: "",
            duration: "",
            flow: "",
            currentNumber: "",
            idleTime: "",
            pauseReason: "",
            pauseDurationLabel: "",
            pauseStartedAt: ""
          };
        }),
        waiting: []
      }));
  const waitingCalls = status?.waitingCalls || queues.flatMap((queue) => (queue.waiting || []).map((call) => ({ ...call, queueName: queue.name })));
  const uniqueAgentCounts = uniqueMonitorAgentCounts(queues);
  const totals = queues.reduce(
    (acc, queue) => {
      acc.waiting += Number(queue.callsWaiting) || 0;
      acc.completed += Number(queue.completed) || 0;
      acc.abandoned += Number(queue.abandoned) || 0;
      acc.holdTime += Number(queue.holdTime) || 0;
      acc.talkTime += Number(queue.talkTime) || 0;
      acc.productivity += Number(queue.productivity) || 0;
      return acc;
    },
    {
      waiting: 0,
      completed: 0,
      abandoned: 0,
      holdTime: 0,
      talkTime: 0,
      productivity: 0,
      ...uniqueAgentCounts,
      busy: uniqueAgentCounts.busy + uniqueAgentCounts.ringing
    }
  );
  const queueCount = Math.max(queues.length, 1);

  const generalStats = [
    ["Atendidas", totals.completed, "phone-call", "available"],
    ["Abandonadas", totals.abandoned, "phone-off", "busy"],
    ["Agentes", totals.agents, "headset", ""],
    ["TME medio", formatSeconds(Math.round(totals.holdTime / queueCount)), "timer", "ringing"],
    ["TMA medio", formatSeconds(Math.round(totals.talkTime / queueCount)), "clock-3", ""],
    ["Produtividade", `${monitorNumber(Math.round(totals.productivity / queueCount))}%`, "activity", "available"]
  ]
    .map(
      ([label, value, icon, tone]) => `
        <div class="monitor-stat ${tone}">
          <i data-lucide="${icon}"></i>
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(value)}</strong>
        </div>`
    )
    .join("");

  const monitorStats = [
    ["Filas", queues.length, "list-ordered", ""],
    ["Em espera", totals.waiting, "clock-3", "ringing"],
    ["Disponiveis", totals.available, "circle-check", "available"],
    ["Pausados", totals.paused, "pause", "paused"],
    ["Ocupados", totals.busy, "phone-call", "busy"],
    ["Indisponiveis", totals.unavailable, "circle-off", "unavailable"]
  ]
    .map(
      ([label, value, icon, tone]) => `
        <div class="monitor-stat ${tone}">
          <i data-lucide="${icon}"></i>
          <span>${escapeHtml(label)}</span>
          <strong>${monitorNumber(value)}</strong>
        </div>`
    )
    .join("");

  const queuePanels = queues
    .map((queue) => {
      const counts = queue.counts || {};
      const agents = queue.agents || [];
      const agentRows = agents
        .map((agent) => {
          const tone = monitorStatusTone(agent.statusTone || agent.status);
          const pauseReason = agent.pauseReason || agent.pauseName || "-";
          const pauseTime = tone === "paused" ? agent.pauseDurationLabel || "0s" : "-";
          const pauseSummary = agentPauseSummary(agent, tone);
          const canControlCall = Boolean(agent.channel) || ["busy", "ringing"].includes(tone);
          const idleTitle = agent.lastInboundCallAt ? ` title="Ultima chamada de entrada: ${escapeHtml(formatDateTime(agent.lastInboundCallAt))}"` : "";
          return `
            <tr class="agent-row ${tone}">
              <td class="agent-identity" data-label="Ramal">
                <strong>${escapeHtml(agent.number || "-")}</strong>
                <span>${escapeHtml(agent.name || "")}</span>
              </td>
              <td data-label="Pri">${escapeHtml(agent.penalty || "-")}</td>
              <td class="agent-status-cell" data-label="Status">
                <span class="monitor-status-label ${tone}">${escapeHtml(agent.statusLabel || "Nao verificado")}</span>
                ${pauseSummary ? `<small class="monitor-pause-detail">${escapeHtml(pauseSummary)}</small>` : ""}
              </td>
              <td class="agent-action-cell" data-label="Acao">
                <button class="icon-btn compact" data-monitor-spy="${escapeHtml(agent.number || "")}" ${canControlCall ? "" : "disabled"} title="Monitorar chamada"><i data-lucide="headphones"></i></button>
                <button class="icon-btn compact danger" data-monitor-hangup="${escapeHtml(agent.channel || "")}" data-monitor-extension="${escapeHtml(agent.number || "")}" ${canControlCall ? "" : "disabled"} title="Desconectar chamada"><i data-lucide="phone-off"></i></button>
              </td>
              <td data-label="Atendidas">${monitorNumber(agent.callsTaken)}</td>
              <td data-label="Online">${escapeHtml(agent.onlineDurationLabel || agent.loginTime || "-")}</td>
              <td data-label="Duracao">${escapeHtml(agent.duration || "-")}</td>
              <td data-label="Fluxo">${escapeHtml(agent.flow || "-")}</td>
              <td data-label="Numero">${escapeHtml(agent.currentNumber || "-")}</td>
              <td${idleTitle} data-label="Ocioso">${escapeHtml(agent.idleTime || "-")}</td>
              <td data-label="Pausa">${escapeHtml(pauseTime)}</td>
              <td data-label="Motivo">${escapeHtml(tone === "paused" ? pauseReason : "-")}</td>
            </tr>`;
        })
        .join("");

      return `
        <section class="panel queue-monitor">
          <div class="monitor-queue-head">
            <div>
              <h3>${escapeHtml(queue.name || queue.id)}</h3>
              <span class="hint">Fila ${escapeHtml(queue.id)} · ${escapeHtml(queueStrategyLabel(queue.strategy))}</span>
            </div>
            <div class="queue-summary">
              <span class="available">Disponivel: <strong>${monitorNumber(counts.available)}</strong></span>
              <span class="paused">Pausa: <strong>${monitorNumber(counts.paused)}</strong></span>
              <span class="busy">Ocupado: <strong>${monitorNumber((counts.busy || 0) + (counts.ringing || 0))}</strong></span>
              <span class="unavailable">Indisponivel: <strong>${monitorNumber(counts.unavailable)}</strong></span>
            </div>
          </div>
          <div class="queue-metrics">
            <div><span>Em Espera</span><strong>${monitorNumber(queue.callsWaiting)}</strong></div>
            <div><span>Atendidas</span><strong>${monitorNumber(queue.completed)}</strong></div>
            <div><span>Abandonadas</span><strong>${monitorNumber(queue.abandoned)}</strong></div>
            <div><span>TME</span><strong>${escapeHtml(queue.holdTimeLabel || "0s")}</strong></div>
            <div><span>TMA</span><strong>${escapeHtml(queue.talkTimeLabel || "0s")}</strong></div>
            <div><span>Produtividade</span><strong>${monitorNumber(queue.productivity)}%</strong></div>
            <div><span>Geral</span><strong>${monitorNumber((counts.available || 0) + (counts.busy || 0) + (counts.ringing || 0))}/${monitorNumber(agents.length)}</strong></div>
          </div>
          <div class="agent-table-wrap compact-table">
            <table class="agent-table">
              <thead>
                <tr>
                  <th>Ramal</th>
                  <th>Pri</th>
                  <th>Status</th>
                  <th>Acao</th>
                  <th>Atendidas</th>
                  <th>Online</th>
                  <th>Duracao</th>
                  <th>Fluxo</th>
                  <th>Numero</th>
                  <th>Ocioso</th>
                  <th>Pausa</th>
                  <th>Motivo</th>
                </tr>
              </thead>
              <tbody>
                ${agentRows || `<tr><td colspan="12" class="empty-table-cell">Nenhum agente configurado nesta fila.</td></tr>`}
              </tbody>
            </table>
          </div>
        </section>`;
    })
    .join("");

  const waitingRows = renderWaitingCalls(waitingCalls);
  const lastReadLabel = status?.checkedAt ? new Date(status.checkedAt).toLocaleString("pt-BR") : "ainda nao carregada";
  const liveLabel = "Ao Vivo";

  if (state.monitorCompact.view === "compact") {
    monitorStatusContent.innerHTML = renderCompactMonitor(queues, waitingCalls, totals, lastReadLabel, trunkStatus, trunkTone, liveLabel);
    return;
  }

  monitorStatusContent.innerHTML = `
    <div class="monitor-page">
      <section class="panel monitor-hero">
        <div>
          <p class="eyebrow">Call center</p>
          <h3>Monitoramento de filas</h3>
          <p class="hint">Ultima leitura: ${escapeHtml(lastReadLabel)}</p>
        </div>
        <div class="monitor-toolbar">
          <span class="live-pill"><span></span>${escapeHtml(liveLabel)}</span>
          <span class="badge ${trunkTone}">Tronco ${escapeHtml(trunkStatus)}</span>
          <button id="monitorViewToggleBtn" class="secondary-btn" type="button"><i data-lucide="table-2"></i>Compacto</button>
          <button id="monitorCompactSettingsBtn" class="icon-btn" type="button" title="Personalizar monitor" aria-label="Personalizar monitor"><i data-lucide="settings"></i></button>
          <button id="refreshPbxStatusBtn" class="secondary-btn"><i data-lucide="rotate-cw"></i>Agora</button>
        </div>
      </section>

      <div class="monitor-metrics-layout">
        <div class="monitor-metric-section">
          <div class="monitor-section-title">
            <h3>Metricas gerais</h3>
            <span class="badge">${monitorNumber(totals.agents)} agentes</span>
          </div>
          <div class="monitor-stat-grid general">${generalStats}</div>
        </div>

        <div class="monitor-metric-section">
          <div class="monitor-section-title">
            <h3>Metricas das filas</h3>
            <span class="badge">${monitorNumber(queues.length)} filas</span>
          </div>
          <div class="monitor-stat-grid">${monitorStats}</div>
        </div>
      </div>

      <div class="queue-stack">
        ${queuePanels || `
          <section class="panel">
            <div class="panel-header"><h3>Nenhuma fila para monitorar</h3></div>
            <p class="hint">Cadastre uma fila em Filas e grupos para exibir agentes e chamadas em espera.</p>
          </section>
        `}
      </div>

      <section class="panel monitor-waiting monitor-waiting-final">
        <div class="panel-header">
          <h3>Chamadas em espera</h3>
          <span class="badge ${waitingCalls.length ? "warn" : "ok"}">${monitorNumber(waitingCalls.length)}</span>
        </div>
        <div class="mini-monitor-list waiting-call-list">${waitingRows || `<p class="hint">Nenhuma chamada aguardando atendimento.</p>`}</div>
      </section>
    </div>
  `;
}

function renderFlow() {
  renderIvr();
}

function commandCenterQueueCards(queues = [], extensionFilter = "", searchValue = "") {
  const prefs = state.monitorCompact;
  const search = queueSearchKey(searchValue);
  const numbers = new Map((state.config?.queues || []).map((q) => [String(q.id), q.number]));
  const columns = [
    ["calls", "F/R", "Chamadas feitas / recebidas", compactAgentCallPair],
    ["duration", "Duração", "Duração da chamada", (a) => a.duration],
    ["number", "Número", "Número em ligação", (a) => a.currentNumber],
    ["pause", "Pausa", "Tempo em pausa", (a, tone) => tone === "paused" && (a.pauseDurationLabel || formatSeconds(Number(a.pauseSeconds) || 0))],
    ["idle", "Ocioso", "Tempo ocioso", (a) => a.idleTime],
    ["online", "Online", "Tempo online", (a) => a.onlineDurationLabel || a.loginTime]
  ].filter(([key]) => prefs.fields?.[key] !== false);
  const headings = columns.map(([, label, description]) =>
    `<th scope="col" title="${description}">${label}</th>`).join("");

  return queues.map((queue, index) => {
    const name = queue.name || queue.id || `Fila ${index + 1}`;
    const number = queue.number || numbers.get(String(queue.id)) || queue.id;
    const queueMatches = queueSearchKey([name, number, queue.id].join(" ")).includes(search);
    const agents = (queue.agents || []).filter((agent) =>
      prefs.statuses?.[monitorStatusTone(agent.statusTone || agent.status)] !== false &&
      (!extensionFilter || String(agent.number) === String(extensionFilter)) &&
      (queueMatches || queueSearchKey([agent.name, agent.number].join(" ")).includes(search))
    );
    if (!agents.length && (!queueMatches || extensionFilter)) return "";

    const rows = agents.map((agent) => {
      const tone = monitorStatusTone(agent.statusTone || agent.status);
      const label = queueBoardStates[tone];
      const pause = agentPauseSummary(agent, tone);
      const canMonitor = Boolean(agent.channel) || ["busy", "ringing"].includes(tone);
      const cells = columns.map(([, , , read]) => {
        const value = read(agent, tone);
        return value && value !== "-" ? `<td>${escapeHtml(value)}</td>` : '<td class="queue-no-value">–</td>';
      }).join("");
      return `<tr class="queue-agent ${tone}">
        <td class="queue-person"><div><i class="queue-presence ${tone}" aria-hidden="true"></i>
          <span class="queue-agent-label">${escapeHtml(agent.name || agent.number || "Ramal")}<small>${label}</small></span><b>${escapeHtml(agent.number || "")}</b></div>
          ${pause ? `<small class="queue-pause-note">${escapeHtml(pause)}</small>` : ""}</td>
        ${cells}<td class="queue-listen"><button class="icon-btn compact" data-monitor-spy="${escapeHtml(agent.number || "")}"
          ${canMonitor ? "" : "disabled"} type="button" aria-label="Monitorar chamada do ramal ${escapeHtml(agent.number || "")}" title="Monitorar chamada"><i data-lucide="headphones"></i></button></td>
      </tr>`;
    }).join("");
    return `<section class="queue-tile">
      <header><div class="queue-title"><h4>${escapeHtml(name)}</h4>
        ${number && String(name) !== String(number) ? `<small>Fila ${escapeHtml(number)}</small>` : ""}</div>
        <div class="queue-totals">${Number(queue.callsWaiting) > 0 ? `<span class="queue-wait-count"><b>${monitorNumber(queue.callsWaiting)}</b> em espera</span>` : ""}<span><b>${monitorNumber(queue.completed)}</b> Atendidas</span><span><b>${monitorNumber(queue.abandoned)}</b> Perdidas</span></div>
      </header>
      ${rows ? `<div class="queue-table-scroll"><table aria-label="Ramais da fila ${escapeHtml(name)}"><thead><tr>
        <th scope="col">Atendente / ramal</th>${headings}<th scope="col" aria-label="Monitorar chamada"></th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : '<p class="queue-empty">Nenhum ramal nesta visualização.</p>'}
    </section>`;
  }).join("");
}

function renderOverview() {
  const cfg = state.config;
  const overviewDate = state.overview.date || todayKey();
  const selectedQueueItem = selectedOverviewQueue();
  const selectedQueueValue = String(state.overview.queue || "");
  const selectedExtensionValue = String(state.overview.extension || "");
  const selectedQueueMembers = selectedQueueItem ? overviewQueueMemberNumbers(selectedQueueItem.queue) : null;
  const hasOverviewFilters = Boolean(selectedQueueValue || selectedExtensionValue);
  const selectableExtensions = cfg.extensions.filter((extension) => {
    const number = String(extension.number || "");
    if (selectedQueueMembers && !selectedQueueMembers.has(number)) return false;
    return true;
  });
  const overviewCallsRaw = state.overview.calls?.length ? state.overview.calls : (state.reports || []).filter((call) => localDateKey(call.startedAt) === overviewDate);
  const overviewCalls = overviewCallsRaw.filter((call) =>
    callMatchesOverviewQueue(call, selectedQueueItem) &&
    callMatchesOverviewExtension(call, selectedExtensionValue)
  );
  const isInboundCall = (call) => call.type === "inbound" || /inbound|ivr-main|ringgroup|support/.test(String(call.context || ""));
  const inboundOverview = overviewCalls.filter(isInboundCall);
  const answeredOverview = inboundOverview.filter((call) => isHumanAnsweredCall(call));
  const rejectedToday = overviewDate === todayKey() && !hasOverviewFilters ? (state.inboundCalls?.rejected || []).length : 0;
  const answeredToday = answeredOverview.length;
  const missedToday = inboundOverview.filter((call) => !isHumanAnsweredCall(call)).length + rejectedToday;
  const totalCalls = overviewCalls.length + rejectedToday;
  const answerRate = inboundOverview.length + rejectedToday
    ? Math.round((answeredToday / (inboundOverview.length + rejectedToday)) * 100)
    : 0;
  const lossRate = inboundOverview.length + rejectedToday ? Math.max(0, 100 - answerRate) : 0;
  const tmeSeconds = answeredOverview.length
    ? Math.round(
        answeredOverview.reduce((sum, call) => {
          const started = call.startedAt ? new Date(call.startedAt) : null;
          const answered = call.answeredAt ? new Date(call.answeredAt) : null;
          if (!started || !answered || Number.isNaN(started.getTime()) || Number.isNaN(answered.getTime())) return sum;
          return sum + Math.max(0, Math.round((answered.getTime() - started.getTime()) / 1000));
        }, 0) / answeredOverview.length
      )
    : 0;
  const answeredCalls = overviewCalls.filter(isHumanAnsweredCall);
  const tmaSeconds = answeredCalls.length
    ? Math.round(answeredCalls.reduce((sum, call) => sum + (Number(call.duration) || 0), 0) / answeredCalls.length)
    : 0;
  const withinTarget = answeredOverview.filter((call) => {
    const started = call.startedAt ? new Date(call.startedAt) : null;
    const answered = call.answeredAt ? new Date(call.answeredAt) : null;
    if (!started || !answered || Number.isNaN(started.getTime()) || Number.isNaN(answered.getTime())) return false;
    return answered.getTime() - started.getTime() <= 20000;
  }).length;
  const serviceLevel = answeredOverview.length ? Math.round((withinTarget / answeredOverview.length) * 100) : 0;

  const queueOptions = `<option value="">Todas as filas</option>${(cfg.queues || [])
    .map((queue, index) => {
      const value = queueFilterTokens(queue, index)[0] || "";
      return option(value, selectedQueueValue, queueLabel(queue, index));
    })
    .join("")}`;
  const extensionOptions = `<option value="">Todos os ramais</option>${selectableExtensions
    .map((extension) => option(String(extension.number || ""), selectedExtensionValue, `${extension.number} ${extension.name || ""}`.trim()))
    .join("")}`;

  const overviewDateLabel = overviewDate.split("-").reverse().join("/");
  const kpis = [
    ["Chamadas no periodo", totalCalls, overviewDate === todayKey() ? "Hoje" : overviewDateLabel, "phone-call", "accent"],
    ["Taxa de atendimento", `${answerRate}%`, `${answeredToday} atendidas`, "circle-check-big", answerRate >= 80 ? "success" : "caution"],
    ["Chamadas perdidas", missedToday, `${lossRate}% das entradas`, "phone-missed", missedToday ? "danger" : "success"],
    ["Nivel de servico", `${serviceLevel}%`, "Atendidas em ate 20s", "gauge", serviceLevel >= 80 ? "success" : "caution"],
    ["Tempo medio de espera", formatSeconds(tmeSeconds), selectedQueueValue ? "Fila selecionada" : "Todas as filas", "timer", "neutral"],
    ["Tempo medio de chamada", formatSeconds(tmaSeconds), `${answeredCalls.length} chamadas atendidas`, "clock-3", "neutral"]
  ]
    .map(
      ([label, value, meta, icon, tone]) => `
        <article class="command-kpi ${tone}">
          <i data-lucide="${icon}"></i>
          <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(meta)}</small></div>
        </article>`
    )
    .join("");

  const hourBuckets = new Map();
  overviewCalls.forEach((call) => {
    const date = call.startedAt ? new Date(call.startedAt) : null;
    if (!date || Number.isNaN(date.getTime())) return;
    const hour = date.getHours();
    hourBuckets.set(hour, (hourBuckets.get(hour) || 0) + 1);
  });
  const hourlySeries = [...hourBuckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([hour, value]) => ({ label: `${String(hour).padStart(2, "0")}:00`, value }));
  const maxHourly = Math.max(1, ...hourlySeries.map((item) => item.value));
  const hourlyRows = hourlySeries
    .map((item) => `
      <div class="strategy-bar-row">
        <span>${escapeHtml(item.label)}</span>
        <div><i style="width:${Math.max(4, Math.round((item.value / maxHourly) * 100))}%"></i></div>
        <strong>${monitorNumber(item.value)}</strong>
      </div>`)
    .join("");

  const directionItems = [
    ["Recebidas", overviewCalls.filter(isInboundCall).length + rejectedToday, "phone-incoming"],
    ["Realizadas", overviewCalls.filter((call) => call.type === "outbound").length, "phone-outgoing"],
    ["Internas", overviewCalls.filter((call) => call.type === "internal").length, "repeat-2"]
  ];
  const maxDirection = Math.max(1, ...directionItems.map((item) => item[1]));
  const directionRows = directionItems
    .map(([label, value, icon]) => `
      <div class="strategy-distribution-row">
        <i data-lucide="${icon}"></i>
        <div>
          <span><strong>${escapeHtml(label)}</strong><b>${monitorNumber(value)}</b></span>
          <div class="strategy-progress"><i style="width:${Math.round((value / maxDirection) * 100)}%"></i></div>
        </div>
      </div>`)
    .join("");

  const queuePerformance = (cfg.queues || [])
    .map((queue, index) => {
      const queueItem = { queue, index, tokens: queueFilterTokens(queue, index) };
      if (selectedQueueValue && !queueItem.tokens.includes(selectedQueueValue)) return null;
      const calls = overviewCallsRaw.filter((call) => callMatchesOverviewQueue(call, queueItem) && callMatchesOverviewExtension(call, selectedExtensionValue));
      const inbound = calls.filter(isInboundCall);
      const answered = inbound.filter(isHumanAnsweredCall).length;
      const missed = inbound.length - answered;
      const rate = inbound.length ? Math.round((answered / inbound.length) * 100) : 0;
      return { queue, index, total: inbound.length, answered, missed, rate };
    })
    .filter(Boolean)
    .sort((a, b) => b.total - a.total);
  const queueRows = queuePerformance
    .map((item) => `
      <tr>
        <td><strong>${escapeHtml(queueLabel(item.queue, item.index))}</strong><span class="table-subline">Fila ${escapeHtml(queueDialNumber(item.queue, item.index))}</span></td>
        <td>${monitorNumber(item.total)}</td>
        <td class="positive-value">${monitorNumber(item.answered)}</td>
        <td class="negative-value">${monitorNumber(item.missed)}</td>
        <td><span class="strategy-rate ${item.total ? (item.rate >= 80 ? "good" : item.rate >= 60 ? "attention" : "critical") : "neutral"}">${item.total ? `${monitorNumber(item.rate)}%` : "-"}</span></td>
      </tr>`)
    .join("");

  const extensionPerformance = selectableExtensions
    .filter((extension) => !selectedExtensionValue || String(extension.number || "") === selectedExtensionValue)
    .map((extension) => {
      const calls = overviewCalls.filter((call) => callMatchesOverviewExtension(call, extension.number));
      const answered = calls.filter(isHumanAnsweredCall).length;
      const average = answered
        ? Math.round(calls.filter(isHumanAnsweredCall).reduce((sum, call) => sum + (Number(call.duration) || 0), 0) / answered)
        : 0;
      return { extension, total: calls.length, answered, average };
    })
    .filter((item) => item.total > 0 || selectedExtensionValue)
    .sort((a, b) => b.answered - a.answered || b.total - a.total)
    .slice(0, 6);
  const extensionRows = extensionPerformance
    .map((item, index) => `
      <tr>
        <td><span class="strategy-rank">${index + 1}</span></td>
        <td><strong>${escapeHtml(item.extension.name || item.extension.number)}</strong><span class="table-subline">Ramal ${escapeHtml(item.extension.number)}</span></td>
        <td>${monitorNumber(item.total)}</td>
        <td class="positive-value">${monitorNumber(item.answered)}</td>
        <td>${escapeHtml(formatSeconds(item.average))}</td>
      </tr>`)
    .join("");

  const peakHour = hourlySeries.slice().sort((a, b) => b.value - a.value)[0];
  const eligibleQueues = queuePerformance.filter((item) => item.total > 0);
  const bestQueue = eligibleQueues.slice().sort((a, b) => b.rate - a.rate || b.total - a.total)[0];
  const attentionQueue = eligibleQueues.slice().sort((a, b) => b.missed - a.missed || a.rate - b.rate)[0];
  const busiestExtension = extensionPerformance[0];
  const insights = [
    ["Pico de volume", peakHour ? `${peakHour.label} com ${peakHour.value} chamadas` : "Sem chamadas no periodo", "chart-no-axes-column-increasing", "neutral"],
    ["Melhor taxa por fila", bestQueue ? `${queueLabel(bestQueue.queue, bestQueue.index)} em ${bestQueue.rate}%` : "Sem volume por fila", "trophy", "success"],
    ["Ponto de atencao", attentionQueue?.missed ? `${queueLabel(attentionQueue.queue, attentionQueue.index)} perdeu ${attentionQueue.missed}` : "Nenhuma perda identificada", "triangle-alert", attentionQueue?.missed ? "danger" : "success"],
    ["Ramal em destaque", busiestExtension ? `${busiestExtension.extension.number} com ${busiestExtension.answered} atendidas` : "Sem atividade por ramal", "headset", "accent"]
  ]
    .map(([label, value, icon, tone]) => `
      <article class="strategy-insight ${tone}">
        <i data-lucide="${icon}"></i>
        <div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>
      </article>`)
    .join("");

  pages.overview.innerHTML = `
    <div class="command-center strategy-overview">
      <section class="panel strategy-toolbar">
        <div>
          <p class="eyebrow">Analise operacional</p>
          <h3>Desempenho do atendimento</h3>
          <p class="hint">Indicadores consolidados para orientar capacidade, qualidade e operacao.</p>
        </div>
        <div class="strategy-filter-bar">
          <label class="command-filter-field" title="Data do resumo">
            <i data-lucide="calendar-days"></i>
            <input id="overviewDateInput" type="date" value="${escapeHtml(overviewDate)}" aria-label="Data do resumo" />
          </label>
          <label class="command-filter-field">
            <i data-lucide="list-filter"></i>
            <select id="overviewQueueFilter" aria-label="Filtrar fila">${queueOptions}</select>
          </label>
          <label class="command-filter-field">
            <i data-lucide="headset"></i>
            <select id="overviewExtensionFilter" aria-label="Filtrar ramal">${extensionOptions}</select>
          </label>
          <button id="applyOverviewDateBtn" class="primary-btn compact" type="button"><i data-lucide="check"></i>Aplicar</button>
          <button id="clearOverviewFiltersBtn" class="icon-btn" type="button" title="Limpar filtros" ${hasOverviewFilters ? "" : "disabled"}><i data-lucide="filter-x"></i></button>
        </div>
      </section>
      <section class="command-kpi-grid">${kpis}</section>
      <div class="strategy-grid">
        <section class="panel strategy-volume-panel">
          <div class="panel-header">
            <div><p class="eyebrow">Tendencia</p><h3>Volume por horario</h3></div>
            <span class="badge">${monitorNumber(totalCalls)} chamadas</span>
          </div>
          <div class="strategy-bars">${hourlyRows || `<div class="command-empty compact"><i data-lucide="chart-no-axes-column"></i><strong>Sem dados no periodo</strong><span>Escolha outra data ou filtro.</span></div>`}</div>
        </section>
        <section class="panel strategy-distribution-panel">
          <div class="panel-header"><div><p class="eyebrow">Composicao</p><h3>Perfil das chamadas</h3></div></div>
          <div class="strategy-distribution">${directionRows}</div>
          <div class="strategy-quality-summary">
            <span><small>Atendimento</small><strong>${monitorNumber(answerRate)}%</strong></span>
            <span><small>Servico em 20s</small><strong>${monitorNumber(serviceLevel)}%</strong></span>
          </div>
        </section>
      </div>
      <div class="strategy-grid lower">
        <section class="panel strategy-queue-panel">
          <div class="panel-header">
            <div><p class="eyebrow">Performance</p><h3>Resultado por fila</h3></div>
            <button class="secondary-btn compact" type="button" data-tab="status"><i data-lucide="monitor-dot"></i>Abrir monitor</button>
          </div>
          <div class="table-wrap">
            <table class="strategy-table">
              <thead><tr><th>Fila</th><th>Recebidas</th><th>Atendidas</th><th>Perdidas</th><th>Taxa</th></tr></thead>
              <tbody>${queueRows || `<tr><td colspan="5" class="empty-table-cell">Sem dados de fila para os filtros aplicados.</td></tr>`}</tbody>
            </table>
          </div>
        </section>
        <section class="panel strategy-insights-panel">
          <div class="panel-header"><div><p class="eyebrow">Leitura rapida</p><h3>Destaques do periodo</h3></div></div>
          <div class="strategy-insights">${insights}</div>
        </section>
      </div>
      <section class="panel strategy-extension-panel">
        <div class="panel-header">
          <div><p class="eyebrow">Produtividade</p><h3>Desempenho por ramal</h3></div>
          <button class="secondary-btn compact" type="button" data-tab="reports"><i data-lucide="file-chart-column"></i>Relatorio completo</button>
        </div>
        <div class="table-wrap">
          <table class="strategy-table extension-performance-table">
            <thead><tr><th>Posicao</th><th>Ramal</th><th>Chamadas</th><th>Atendidas</th><th>Duracao media</th></tr></thead>
            <tbody>${extensionRows || `<tr><td colspan="5" class="empty-table-cell">Sem atividade de ramais no periodo selecionado.</td></tr>`}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function renderMonitorPreferencesSurface() {
  if (state.activeTab === "overview") renderOverview();
  else renderStatus();
}

function renderTrunk() {
  const trunks = ensureConfigTrunks();
  const editingIndex = Number.isInteger(state.editingTrunkIndex) && trunks[state.editingTrunkIndex] ? state.editingTrunkIndex : null;
  const editing = editingIndex === null ? null : trunks[editingIndex];
  const summaryCards = trunks
    .map(
      (trunk, index) => `
      <article class="trunk-list-card" data-trunk-summary-index="${index}">
        <div class="panel-header compact-card-header">
          <div>
            <p class="eyebrow">Tronco SIP</p>
            <h3>${escapeHtml(trunkLabel(trunk))}</h3>
            <p class="microcopy">${escapeHtml(trunk.id)} · ${escapeHtml((trunk.transport || "udp").toUpperCase())} · ${trunk.active === false ? "Inativo" : "Ativo"}</p>
          </div>
        </div>
        <div class="trunk-card-statuses">
          <span class="badge ${trunk.active === false ? "warn" : "ok"}">${trunk.active === false ? "Inativo" : "Ativo"}</span>
          <span class="badge">${({ inbound: "Somente entrada", outbound: "Somente saída", both: "Entrada e saída" })[PbxTrunkPolicy.usage(trunk)] || "Uso não definido"}</span>
          <span class="trunk-registration-status" data-trunk-registration="${escapeHtml(trunk.id)}"></span>
        </div>
        <div class="list-card-meta">
          <span><strong>Numero principal</strong>${escapeHtml(trunk.mainNumber || "Nao informado")}</span>
          <span><strong>Servidor SIP</strong>${escapeHtml(trunk.sipServer || "Nao informado")}</span>
          <span><strong>Transporte</strong>${escapeHtml((trunk.transport || "udp").toUpperCase())}</span>
        </div>
        <div class="compact-card-actions">
          <button class="primary-btn compact" data-edit-trunk="${index}" type="button"><i data-lucide="pencil"></i>Editar</button>
          ${index > 0 ? `<button class="icon-btn danger" data-remove-trunk="${index}" type="button" title="Remover tronco"><i data-lucide="trash-2"></i></button>` : `<span class="badge"><i data-lucide="shield-check"></i>Principal protegida</span>`}
        </div>
      </article>`
    )
    .join("");
  const editor = editing
    ? `
      <section class="panel entity-editor-shell">
        <div class="panel-header entity-editor-header">
          <div>
            <p class="eyebrow">Editar tronco SIP</p>
            <h3>${escapeHtml(trunkLabel(editing))}</h3>
            <p class="microcopy">Edite somente este tronco. As alteracoes ficam em rascunho ate salvar e aplicar.</p>
          </div>
          <div class="compact-card-actions">
            <button class="secondary-btn" data-cancel-trunk-edit type="button"><i data-lucide="arrow-left"></i>Voltar para lista</button>
            ${editingIndex > 0 ? `<button class="icon-btn danger" data-remove-trunk="${editingIndex}" type="button" title="Remover tronco"><i data-lucide="trash-2"></i></button>` : ""}
          </div>
        </div>
        <article class="trunk-config-card" data-trunk-card data-entity-editor data-index="${editingIndex}">
          <div class="field-grid compact-field-grid">
            ${fieldBlock("Nome", "Nome simples para identificar esse tronco no painel.", `<input data-trunk-field="name" value="${escapeHtml(editing.name || "")}" placeholder="Operadora principal" />`)}
            ${fieldBlock("ID interno", "Identificador tecnico usado no Asterisk. Use letras, numeros e hifen.", `<input data-trunk-field="id" value="${escapeHtml(editing.id)}" ${editingIndex === 0 ? "readonly" : ""} />`)}
            ${fieldBlock("Numero principal", "Numero que a operadora entrega para receber e apresentar chamadas. Use so numeros.", `<input data-trunk-field="mainNumber" value="${escapeHtml(editing.mainNumber || "")}" placeholder="Ex: 3431950817" />`)}
            ${fieldBlock("Uso do tronco", "Somente entrada recebe ligações e nunca é usado pelo discador ou pelos ramais para ligar. Somente saída faz ligações. Entrada e saída permite as duas funções.", `<select data-trunk-field="usage">${option("both", PbxTrunkPolicy.usage(editing), "Entrada e saída")}${option("inbound", PbxTrunkPolicy.usage(editing), "Somente entrada — receptivo")}${option("outbound", PbxTrunkPolicy.usage(editing), "Somente saída")}</select>`)}
            ${fieldBlock("Usuario SIP", "Login que a operadora forneceu para registrar o tronco no servidor SIP.", `<input data-trunk-field="sipUser" value="${escapeHtml(editing.sipUser || "")}" />`)}
            ${fieldBlock("Autenticação", "Use a opção informada pela operadora. Usuário e senha registra o tronco. Por endereço IP não faz registro e depende da liberação do IP do PBX pela operadora.", `<select data-trunk-field="authMode">${option("registration", PbxTrunkPolicy.authMode(editing), "Usuário e senha (registro SIP)")}${option("ip", PbxTrunkPolicy.authMode(editing), "Por endereço IP (sem registro)")}</select>`)}
            ${fieldBlock("Senha SIP", "Senha do tronco SIP da operadora. Se estiver errada, o tronco nao registra.", `<input class="masked-secret" data-trunk-field="sipPassword" type="text" autocomplete="off" spellcheck="false" data-lpignore="true" data-1p-ignore value="${escapeHtml(editing.sipPassword || "")}" />`)}
            ${fieldBlock("Servidor SIP", "Endereco IP ou dominio do servidor da operadora.", `<input data-trunk-field="sipServer" value="${escapeHtml(editing.sipServer || "")}" placeholder="sip.operadora.com.br" />`, "wide")}
            ${fieldBlock("Porta", "Porta de registro SIP. Em geral 5060 para UDP/TCP ou 5061 para TLS.", `<select data-trunk-field="port">${option("5060", String(editing.port || 5060), "5060 UDP/TCP")}${option("5061", String(editing.port || 5060), "5061 TLS")}</select>`)}
            ${fieldBlock("Transporte", "Escolha UDP para o comum ou TLS quando a operadora exigir sinalizacao segura.", `<select data-trunk-field="transport">${option("udp", editing.transport || "udp", "UDP")}${option("tcp", editing.transport || "udp", "TCP")}${option("tls", editing.transport || "udp", "TLS")}</select>`)}
            ${fieldBlock("Chamadas simultaneas", "Limite de chamadas externas ao mesmo tempo nesse tronco.", `<select data-trunk-field="simultaneousCalls">${Array.from({ length: 20 }, (_, optIndex) => option(String(optIndex + 1), String(editing.simultaneousCalls || 4), `${optIndex + 1}`)).join("")}</select>`)}
            ${fieldBlock("Status", "Desative para tirar esse tronco do discador e da geracao SIP sem apagar os dados.", `<select data-trunk-field="active">${option("true", String(editing.active !== false), "Ativo")}${option("false", String(editing.active !== false), "Inativo")}</select>`)}
            ${fieldBlock("Codecs", "Formatos de audio liberados para esse tronco. Separe por virgula.", `<input data-trunk-field="codecs" value="${escapeHtml((editing.codecs || []).join(", "))}" placeholder="alaw, ulaw" />`, "wide")}
            ${fieldBlock("Observações", "Anote pendências da operadora ou informações úteis sobre este tronco.", `<textarea data-trunk-field="notes" rows="3" maxlength="1000">${escapeHtml(editing.notes || "")}</textarea>`, "wide")}
            ${fieldBlock("Destino de entrada", "Escolha qual URA, fila, grupo ou ramal atende as chamadas que chegam por este tronco.", `<div class="destination-picker">${trunkInboundChoices(editing.inboundDestinationType || "ivr", editing.inboundDestination || "main")}</div>`, "wide")}
          </div>
        </article>
      </section>`
    : `
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Telefonia</p>
            <h3>Troncos da operadora</h3>
            <p class="microcopy">Consulte os troncos cadastrados e abra somente o registro que deseja editar.</p>
          </div>
          <button id="addTrunkBtn" class="primary-btn" type="button"><i data-lucide="plus"></i>Novo tronco</button>
        </div>
        <div class="trunk-grid">${summaryCards || `<div class="governance-empty"><i data-lucide="radio-tower"></i><strong>Nenhum tronco cadastrado</strong><span>Cadastre o primeiro tronco para conectar a operadora.</span></div>`}</div>
      </section>`;
  pages.trunk.innerHTML = `<div class="section-grid">${editor || editor === "" ? editor : ""}</div>`;
  updateTrunkRegistrationBadges();
}

function updateTrunkRegistrationBadges() {
  const labels = { registered: "Registrado", rejected: "Registro rejeitado", unregistered: "Não registrado", disabled: "Inativo", ip: "Autenticação por IP", unknown: "Não verificado" };
  for (const badge of pages.trunk?.querySelectorAll("[data-trunk-registration]") || []) {
    const trunk = ensureConfigTrunks().find((item) => item.id === badge.dataset.trunkRegistration);
    const registration = trunk?.active === false ? "disabled" : state.trunkRegistrationStates[badge.dataset.trunkRegistration] || "unknown";
    badge.textContent = labels[registration] || labels.unknown;
    badge.dataset.state = registration;
    badge.title = registration === "ip" ? "Este tronco usa identificação por IP e não exige registro SIP. Isso não confirma que a operadora já liberou as chamadas." : registration === "rejected" ? "A operadora recusou o registro SIP deste tronco." : registration === "unknown" ? "Ainda não foi possível consultar o registro SIP." : "Estado atual do registro SIP no Asterisk.";
  }
}

async function loadTrunkRegistrations() {
  try {
    const response = await api("/api/trunks/registrations");
    state.trunkRegistrationStates = response.states || {};
  } catch (error) {
    state.trunkRegistrationStates = {};
    throw error;
  } finally {
    updateTrunkRegistrationBadges();
  }
}

function renderExtensions() {
  const extensions = state.config.extensions || [];
  const editingIndex = Number.isInteger(state.editingExtensionIndex) && extensions[state.editingExtensionIndex] ? state.editingExtensionIndex : null;
  const editing = editingIndex === null ? null : extensions[editingIndex];
  const cards = extensions.map((ext, index) => {
    const permissions = (ext.permissions || []).map((item) => permissionLabels[item] || item).join(", ") || "Sem saida externa";
    return `
      <article class="extension-card entity-list-card" data-extension-summary-index="${index}">
        <div class="panel-header compact-card-header">
          <div>
            <p class="eyebrow">Ramal SIP</p>
            <h3>${escapeHtml(ext.number)} ${escapeHtml(ext.name)}</h3>
            <p class="microcopy">${escapeHtml(ext.department || "Geral")} · ${escapeHtml(ext.extensionType || "Padrao")} · ${escapeHtml(permissions)}</p>
          </div>
          <span class="badge ${ext.blockExtension ? "warn" : "ok"}">${ext.blockExtension ? "Bloqueado" : "Ativo"}</span>
        </div>
        <div class="list-card-meta">
          <span><strong>Grupo de discagem</strong>${escapeHtml(ext.dialGroup || "PADRAO")}</span>
          <span><strong>Gravacao</strong>${ext.recordCalls ? "Ativada" : "Desativada"}</span>
          <span><strong>Permissoes</strong>${escapeHtml(permissions)}</span>
        </div>
        <div class="compact-card-actions">
          <button class="primary-btn compact" data-edit-extension="${index}" type="button"><i data-lucide="pencil"></i>Editar</button>
          <button class="icon-btn danger" data-remove-extension="${index}" type="button" title="Remover ramal"><i data-lucide="trash-2"></i></button>
        </div>
      </article>`;
  }).join("");
  const editor = editing ? `
    <section class="panel entity-editor-shell">
      <div class="panel-header entity-editor-header">
        <div><p class="eyebrow">Editar ramal SIP</p><h3>${escapeHtml(editing.number)} ${escapeHtml(editing.name)}</h3><p class="microcopy">Edite somente este ramal. As alteracoes ficam em rascunho ate salvar e aplicar.</p></div>
        <button class="secondary-btn" data-cancel-extension-edit type="button"><i data-lucide="arrow-left"></i>Voltar para lista</button>
      </div>
      <article class="extension-card compact-config-card" data-extension-card data-entity-editor data-index="${editingIndex}">
        <div class="field-grid compact-field-grid">
          ${fieldBlock("Numero do ramal", "Numero interno usado no softphone ou telefone IP.", `<input data-field="number" value="${escapeHtml(editing.number)}" />`)}
          ${fieldBlock("Nome exibido", "Nome da pessoa ou setor que vai aparecer no painel.", `<input data-field="name" value="${escapeHtml(editing.name)}" />`)}
          ${fieldBlock("Setor", "Ajuda a organizar filtros, relatorios e permissoes por equipe.", `<select data-field="department">${choiceOptions(departmentOptions, editing.department).map((item) => option(item, editing.department)).join("")}</select>`)}
          ${fieldBlock("Senha SIP", "Senha usada para registrar esse ramal no softphone.", `<input class="masked-secret" data-field="secret" type="text" autocomplete="off" spellcheck="false" data-lpignore="true" data-1p-ignore value="${escapeHtml(editing.secret)}" />`)}
        </div>
        <div class="advanced-config-fields">
          <div class="field-grid compact-field-grid">
            ${fieldBlock("Tipo do ramal", "Escolha o perfil que mais combina com o uso desse ramal.", `<select data-field="extensionType">${choiceOptions(extensionTypeOptions, editing.extensionType || "Padrao").map((item) => option(item, editing.extensionType || "Padrao")).join("")}</select>`)}
            ${fieldBlock("Grupo de discagem", "Serve para agrupar ramais com o mesmo perfil de saida.", `<select data-field="dialGroup">${choiceOptions(dialGroupOptions, editing.dialGroup || "PADRAO").map((item) => option(item, editing.dialGroup || "PADRAO")).join("")}</select>`)}
            ${fieldBlock("Grupo de captura", "Permite que um ramal atenda a chamada de outro grupo.", `<select data-field="pickupGroup">${choiceOptions(pickupGroupOptions, editing.pickupGroup || "-").map((item) => option(item, editing.pickupGroup || "-")).join("")}</select>`)}
            ${fieldBlock("Centro de custo", "Classifica chamadas e gastos por area da empresa.", `<select data-field="costCenter">${choiceOptions(costCenterOptions, editing.costCenter || "Padrao").map((item) => option(item, editing.costCenter || "Padrao")).join("")}</select>`)}
            ${fieldBlock("Cota em reais", "Limite mensal em valor para chamadas externas desse ramal.", `<input data-field="monthlyQuotaValue" type="number" min="0" step="0.01" value="${escapeHtml(editing.monthlyQuotaValue ?? 0)}" />`)}
            ${fieldBlock("Cota em minutos", "Limite mensal de minutos para chamadas externas.", `<input data-field="monthlyQuotaMinutes" type="number" min="0" value="${escapeHtml(editing.monthlyQuotaMinutes ?? 0)}" />`)}
            ${fieldBlock("Tempo limite", "Tempo maximo de chamada externa, em segundos. Zero deixa sem limite.", `<input data-field="timeoutLimit" type="number" min="0" value="${escapeHtml(editing.timeoutLimit ?? 0)}" />`)}
          </div>
          <div class="check-section"><span class="field-title">Recursos do ramal ${helpIcon("Marque so o que esse ramal realmente precisa para manter a operacao simples e segura.")}</span><div class="check-row">
            <label class="check-pill compact"><input data-field="blockExtension" type="checkbox" ${editing.blockExtension ? "checked" : ""} />Bloquear chamadas</label>
            <label class="check-pill compact"><input data-field="bridgeMode" type="checkbox" ${editing.bridgeMode ? "checked" : ""} />Bridge</label>
            <label class="check-pill compact"><input data-field="temporary" type="checkbox" ${editing.temporary ? "checked" : ""} />Temporario</label>
            <label class="check-pill compact"><input data-field="recordCalls" type="checkbox" ${editing.recordCalls ? "checked" : ""} />Gravar chamadas</label>
          </div></div>
          <div class="check-section"><span class="field-title">O que esse ramal pode discar ${helpIcon("Liberte so os tipos de ligacao que o usuario realmente precisa fazer.")}</span><div class="check-row">${renderPermissionChecks(editing.permissions || [], `extperm-${editingIndex}`)}</div></div>
        </div>
      </article>
    </section>` : `
    <section class="panel">
      <div class="panel-header"><div><p class="eyebrow">Telefonia</p><h3>Ramais internos</h3><p class="microcopy">Consulte os ramais cadastrados e abra somente o registro que deseja editar.</p></div><button class="primary-btn" id="addExtensionBtn" type="button"><i data-lucide="plus"></i>Novo ramal</button></div>
      <div class="extension-grid">${cards || `<div class="governance-empty"><i data-lucide="phone"></i><strong>Nenhum ramal cadastrado</strong><span>Cadastre o primeiro ramal para iniciar.</span></div>`}</div>
    </section>`;
  pages.extensions.innerHTML = `<div class="section-grid">${editor || editor === "" ? editor : ""}</div>`;
}

function renderPermissionChecks(selected, prefix) {
  return Object.keys(permissionLabels)
    .map((permission) => {
      const checked = selected.includes(permission) ? "checked" : "";
      return `<label class="check-pill"><input name="${prefix}" value="${permission}" type="checkbox" ${checked} />${permissionLabels[permission]}</label>`;
    })
    .join("");
}

function renderRouting() {
  const cfg = state.config;
  cfg.outbound = cfg.outbound || {};
  const preview = state.outboundDiagnostics?.preview;
  const trunks = ensureConfigTrunks();
  const inboundRoutes = cfg.inboundRoutes || [];
  const editingIndex = Number.isInteger(state.editingRouteIndex) && inboundRoutes[state.editingRouteIndex] ? state.editingRouteIndex : null;
  const editingRoute = editingIndex === null ? null : inboundRoutes[editingIndex];
  const routes = inboundRoutes.map((route, index) => `
      <article class="panel entity-list-card" data-route-summary-index="${index}">
        <div class="panel-header"><h3>${escapeHtml(route.name || "Rota sem nome")}</h3><span class="badge ${route.active !== false ? "ok" : "warn"}">${route.active !== false ? "Ativa" : "Inativa"}</span></div>
        <div class="list-card-meta">
          <span><strong>Operadora</strong>${escapeHtml(trunks.find((trunk) => trunk.id === route.trunkId)?.name || route.trunkId || "Sem tronco")}</span>
          <span><strong>Numero recebido</strong>${escapeHtml(route.did || "Qualquer numero")}</span>
          <span><strong>Encaminhar para</strong>${escapeHtml(destinationLabel(route.destinationType || "none", route.destination || ""))}</span>
        </div>
        <div class="compact-card-actions"><button class="primary-btn compact" data-edit-route="${index}" type="button"><i data-lucide="pencil"></i>Editar</button><button class="icon-btn danger" data-remove-inbound="${index}" type="button" title="Excluir rota"><i data-lucide="trash-2"></i></button></div>
      </article>`).join("");
  const routeEditor = editingRoute ? `
      <section class="panel entity-editor-shell">
        <div class="panel-header entity-editor-header"><div><p class="eyebrow">Editar rota de entrada</p><h3>${escapeHtml(editingRoute.name || editingRoute.id || "Rota")}</h3><p class="microcopy">Edite somente esta rota. As alteracoes ficam em rascunho ate salvar e aplicar.</p></div><button class="secondary-btn" data-cancel-route-edit type="button"><i data-lucide="arrow-left"></i>Voltar para lista</button></div>
        <div class="field-grid compact-field-grid" data-route-index="${editingIndex}" data-entity-editor>
          ${fieldBlock("Nome", "Nome interno para identificar a rota.", `<input data-field="name" value="${escapeHtml(editingRoute.name || "")}" />`)}
          ${fieldBlock("Tronco", "Tronco SIP que recebe esta chamada.", `<select data-field="trunkId">${trunkChoices(editingRoute.trunkId || trunks[0]?.id || "")}</select>`)}
          ${fieldBlock("Numero recebido (DID)", "Deixe em branco para usar esta rota como destino padrao do tronco.", `<input data-field="did" inputmode="tel" value="${escapeHtml(editingRoute.did || "")}" placeholder="Qualquer numero" />`)}
          ${fieldBlock("Ativa", "Desative sem apagar a rota para interromper temporariamente o atendimento.", `<input data-field="active" type="checkbox" ${editingRoute.active !== false ? "checked" : ""} />`)}
          ${fieldBlock("Destino", "Destino que atendera as chamadas desta rota.", `<div class="destination-picker">${destinationChoices(editingRoute.destinationType || "none", editingRoute.destination || "")}</div>`, "wide")}
        </div>
      </section>` : `
      <section class="panel full"><div class="panel-header"><h3>Rotas de entrada</h3><button id="addInboundBtn" class="primary-btn" type="button"><i data-lucide="plus"></i>Nova rota</button></div><div class="entity-list-grid">${routes || `<p class="hint">Nenhuma rota cadastrada.</p>`}</div></section>`;

  const permissionCards = cfg.extensions
    .map(
      (ext, index) => `
      <div class="permission-card" data-index="${index}">
        <header>
          <div>
            <strong>${escapeHtml(ext.number)} ${escapeHtml(ext.name)}</strong>
            <div class="hint">${escapeHtml(routePresetFor(ext))}</div>
          </div>
          <span class="badge">${escapeHtml((ext.permissions || []).length)} regras</span>
        </header>
        <div class="check-row">${renderPermissionChecks(ext.permissions || [], `routeperm-${index}`)}</div>
      </div>`
    )
    .join("");

  pages.routing.innerHTML = `
    <div class="section-grid">
      ${routeEditor}
      <details class="panel routing-advanced">
        <summary>Regras de saida e permissoes ${helpIcon("Configuracoes que definem como os ramais fazem chamadas externas. Altere apenas quando precisar ajustar a operadora ou as permissoes de ligacao.")}</summary>
        <div class="section-grid">
      <section class="panel">
        <div class="panel-header">
          <h3>Saida das chamadas</h3>
          <span class="badge">${escapeHtml(cfg.outbound.defaultTrunk || "trunk-operadora")}</span>
        </div>
        <div class="field-grid">
          ${fieldBlock("Tronco padrão de saída", "Escolha por qual tronco os ramais fazem ligações externas. Troncos somente de entrada não aparecem nesta lista.", `<select data-outbound="defaultTrunk">${trunkChoices(cfg.outbound.defaultTrunk || "", "outbound") || option("", "", "Nenhum tronco de saída disponível")}</select>`, "wide")}
          ${fieldBlock("DDD local", "DDD da sua cidade. Ele e usado para completar numeros locais automaticamente.", `<input data-outbound="areaCode" value="${escapeHtml(cfg.outbound.areaCode || cfg.trunk.mainNumber?.slice(0, 2) || "")}" placeholder="34" />`)}
          ${fieldBlock("Completar local", "Quando ativo, um numero local curto recebe o DDD automaticamente antes de sair.", `<select data-outbound="prependAreaCodeToLocal">${option("true", String(cfg.outbound.prependAreaCodeToLocal !== false), "Sim")}${option("false", String(cfg.outbound.prependAreaCodeToLocal !== false), "Nao")}</select>`)}
          ${fieldBlock("Prefixo ao discar", "Use apenas se a operadora exigir adicionar algo antes do numero, como 0 ou codigo da operadora.", `<input data-outbound="dialPrefix" value="${escapeHtml(cfg.outbound.dialPrefix || "")}" placeholder="Ex: 0 ou vazio" />`)}
          ${fieldBlock("Remover digitos", "Apaga os primeiros digitos antes de enviar ao tronco. Normalmente deixe 0.", `<select data-outbound="stripDigits">${Array.from({ length: 9 }, (_, index) => option(String(index), String(cfg.outbound.stripDigits || 0), `${index}`)).join("")}</select>`)}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h3>Permissões por ramal</h3><span class="badge">Presets prontos</span></div>
        <div class="permission-grid">${permissionCards}</div>
      </section>
      <section class="panel half">
        <div class="panel-header"><h3>Simulador de discagem</h3><button id="checkDialBtn" class="secondary-btn"><i data-lucide="search-check"></i>Validar</button></div>
        <div class="field-grid">
          <label>Ramal
            <select id="dialTestExtension">${cfg.extensions.map((ext) => option(ext.number, preview?.extension || "201", `${ext.number} ${ext.name}`)).join("")}</select>
          </label>
          <label class="wide">Numero digitado<input id="dialTestNumber" value="${escapeHtml(preview?.dialed || "")}" placeholder="Ex: 991708282, 0991708282 ou 34491708282" /></label>
        </div>
        <div class="diag-grid">
          <div><span class="hint">Regra</span><strong>${escapeHtml(preview?.matchedRule || "-")}</strong></div>
          <div><span class="hint">Padrao</span><strong>${escapeHtml(preview?.matchedPattern || "-")}</strong></div>
          <div><span class="hint">Numero enviado</span><strong>${escapeHtml(preview?.normalized || "-")}</strong></div>
          <div><span class="hint">Dial final</span><strong>${escapeHtml(preview?.dialString || "-")}</strong></div>
        </div>
      </section>
        </div>
      </details>
    </div>
  `;
}

function renderIvrMenuNode(menu, menuKey, isMain = false, fallbackIndex = 0, preview = false) {
  const options = menu.options || [];
  const ivr = state.config.ivr;
  const cardKey = ivrCardKey(menuKey);
  const pos = ivrCardPosition(cardKey, 300 + fallbackIndex * 560, 90 + (fallbackIndex % 2) * 260);
  const waitingOptionLink = state.ivrLinkSource?.type === "menu-option" && state.ivrLinkSource?.menuKey === menuKey;
  const waitingDestinationLink = ["option-target", "time-condition"].includes(state.ivrLinkSource?.type);
  const waitingTrunkEntryLink = state.ivrLinkSource?.type === "trunk-entry";

  return `
    <section class="ivr-flow-node ${isMain ? "main" : ""} ${waitingOptionLink ? "linking" : ""}" data-ivr-menu="${escapeHtml(menuKey)}" data-ivr-card-key="${escapeHtml(cardKey)}" style="left:${pos.x}px;top:${pos.y}px">
      <header data-ivr-drag-handle>
        <span class="ivr-node-icon"><i data-lucide="${isMain ? "layout-grid" : "git-branch"}"></i></span>
        <div>
          <strong>${escapeHtml(isMain || !menu.parentMenuId ? "Menu principal" : "Submenu")}</strong>
          <small>${escapeHtml(menu.id || "main")}</small>
        </div>
        ${waitingDestinationLink && !preview ? `<button type="button" class="secondary-btn compact" data-ivr-target-type="ivr" data-ivr-target-value="${escapeHtml(menu.id || "main")}"><i data-lucide="crosshair"></i>Conectar</button>` : ""}
        ${waitingTrunkEntryLink && !preview ? `<button type="button" class="secondary-btn compact" data-connect-trunk-inbound-menu="${escapeHtml(menu.id || "main")}"><i data-lucide="route"></i>Conectar entrada</button>` : ""}
        ${isMain ? `<span class="badge">Entrada</span>` : preview ? "" : `<button class="icon-btn" data-remove-ivr-menu="${escapeHtml(menuKey)}" title="Remover menu"><i data-lucide="trash-2"></i></button>`}
      </header>
      <div class="ivr-node-grid">
        ${isMain ? "" : `<label>Codigo<input data-ivr-menu-field="id" value="${escapeHtml(menu.id || "")}" placeholder="menu-suporte" /></label>`}
        <label>Nome<input data-ivr-menu-field="name" value="${escapeHtml(menu.name || "")}" placeholder="Menu Suporte" /></label>
        <label class="wide">Audio do menu<select data-ivr-menu-field="greeting">${audioChoices(menu.greeting || "")}</select></label>
        <label class="wide">Descricao<textarea data-ivr-menu-field="greetingDescription" rows="2" placeholder="Texto do audio e orientacao das opcoes">${escapeHtml(menu.greetingDescription || "")}</textarea></label>
      </div>
      ${
        `<div class="ivr-general-rules">
              <div class="ivr-rules-title">
                <span class="ivr-node-icon"><i data-lucide="sliders-horizontal"></i></span>
                <div><strong>Regras gerais</strong><small>Timeout, tentativas e discagem direta</small></div>
              </div>
              <div class="ivr-node-grid">
                <label>Audio timeout<select data-ivr-menu-field="timeoutAudio">${audioChoices(menu.timeoutAudio ?? ivr.timeoutAudio ?? "")}</select></label>
                <label>Audio invalido<select data-ivr-menu-field="invalidAudio">${audioChoices(menu.invalidAudio ?? ivr.invalidAudio ?? "")}</select></label>
                <label>Tempo resposta<input data-ivr-menu-field="timeoutSeconds" type="number" min="5" max="60" value="${escapeHtml(menu.timeoutSeconds ?? ivr.timeoutSeconds ?? 20)}" /></label>
                <label>Tentativas<input data-ivr-menu-field="menuRepeat" type="number" min="1" max="10" value="${escapeHtml(menu.menuRepeat ?? ivr.menuRepeat ?? 3)}" /></label>
                <label class="wide">Discar ramal direto<select data-ivr-menu-field="allowDirectDial">${option("true", String(Boolean(menu.allowDirectDial ?? ivr.allowDirectDial)), "Sim")}${option("false", String(Boolean(menu.allowDirectDial ?? ivr.allowDirectDial)), "Nao")}</select></label>
              </div>
            </div>`
      }
      <div class="ivr-options-head">
        <span>${monitorNumber(options.length)} opcoes</span>
        ${preview ? "" : `<button class="secondary-btn" data-start-menu-option-link="${escapeHtml(menuKey)}"><i data-lucide="git-merge"></i>Linkar opcao</button>`}
        ${preview ? "" : `<button class="secondary-btn" data-add-ivr-option="${escapeHtml(menuKey)}"><i data-lucide="plus"></i>Opcao</button>`}
      </div>
    </section>
  `;
}

function renderIvrOptionNode(card, preview = false) {
  const { menu, menuKey, item, index, menuPos, sourceType } = card;
  const menuId = menu?.id || "main";
  const nodeId = ensureIvrOptionId(item);
  const cardKey = `option:${nodeId}`;
  const pos = ivrCardPosition(cardKey, card.x ?? menuPos.x, card.y ?? menuPos.y);
  const linkingDestination = state.ivrLinkSource?.type === "option-target" && state.ivrLinkSource?.nodeId === nodeId;
  const canReceiveMenuLink = state.ivrLinkSource?.type === "menu-option";
  const parentLabel = sourceType === "loose" ? "Sem menu" : menu.name || menuId;
  return `
    <section class="ivr-option-node ${linkingDestination || canReceiveMenuLink ? "linking" : ""}" data-ivr-source-type="${escapeHtml(sourceType)}" data-ivr-menu="${escapeHtml(menuKey || "")}" data-ivr-option="${index}" data-ivr-option-id="${escapeHtml(nodeId)}" data-ivr-card-key="${escapeHtml(cardKey)}" style="left:${pos.x}px;top:${pos.y}px">
      <header data-ivr-drag-handle>
        <span class="ivr-option-socket">${escapeHtml(item.digit || "-")}</span>
        <div>
          <strong>${escapeHtml(item.label || "Opcao")}</strong>
          <small>${escapeHtml(parentLabel)}</small>
        </div>
        ${canReceiveMenuLink && !preview ? `<button type="button" class="secondary-btn compact" data-ivr-option-target="${escapeHtml(nodeId)}"><i data-lucide="crosshair"></i>Conectar</button>` : ""}
        ${preview ? "" : `<button class="icon-btn" data-remove-ivr-option="${escapeHtml(menuKey)}" data-option-index="${index}" title="Remover opcao"><i data-lucide="trash-2"></i></button>`}
      </header>
      <div class="ivr-node-grid">
        <label>Digito<input data-ivr-option-field="digit" value="${escapeHtml(item.digit || "")}" placeholder="1" /></label>
        <label>Nome<input data-ivr-option-field="label" value="${escapeHtml(item.label || "")}" placeholder="Comercial" /></label>
        <label class="wide">Audio antes do destino<select data-ivr-option-field="announcement">${audioChoices(item.announcement || "")}</select></label>
        <label class="wide">Descricao<input data-ivr-option-field="description" value="${escapeHtml(item.description || "")}" placeholder="Descricao interna" /></label>
      </div>
      <div class="ivr-link-row">
        ${preview ? "" : `<button type="button" class="secondary-btn compact" data-start-ivr-link="${escapeHtml(nodeId)}"><i data-lucide="link-2"></i>Linkar destino</button>`}
        <span class="ivr-edge-label">${escapeHtml(ivrOptionDestinationLabel(item))}</span>
        ${preview ? "" : `<button type="button" class="secondary-btn compact" data-remove-ivr-link="${escapeHtml(nodeId)}" title="Remove apenas o destino desta opcao"><i data-lucide="unlink"></i>Remover link</button>`}
        ${!preview && sourceType !== "loose" ? `<button type="button" class="secondary-btn compact" data-detach-ivr-option="${escapeHtml(nodeId)}" title="Solta esta opcao do menu sem apagar os proximos cards"><i data-lucide="split"></i>Soltar do menu</button>` : ""}
      </div>
      <input type="hidden" data-ivr-option-id-field value="${escapeHtml(nodeId)}" />
      <input type="hidden" data-ivr-destination-type value="${escapeHtml(item.destinationType || "")}" />
      <input type="hidden" data-ivr-destination-value value="${escapeHtml(item.destination || "")}" />
      <input type="hidden" data-ivr-destination-card-key value="${escapeHtml(item.destinationCardKey || "")}" />
    </section>
  `;
}

function ivrTimeWindows(condition) {
  return condition.windows?.length ? condition.windows : [{
    weekdays: condition.weekdays || "mon-fri", start: condition.start || "08:00", end: condition.end || "18:00"
  }];
}

function renderIvrTimeWindows(condition) {
  const days = [["mon-fri","Segunda a sexta"],["mon-sat","Segunda a sábado"],["sat-sun","Fim de semana"],
    ["mon","Segunda"],["tue","Terça"],["wed","Quarta"],["thu","Quinta"],["fri","Sexta"],["sat","Sábado"],["sun","Domingo"],["*","Todos os dias"]];
  const windows = ivrTimeWindows(condition);
  return windows.map((w, i) => `<div class="ivr-time-window" data-time-window="${i}">
    <label>Dias<select data-window-field="weekdays">${days.some(([key]) => key === w.weekdays) ? "" : option(w.weekdays, w.weekdays)}
      ${days.map(([key, name]) => option(key, w.weekdays, name)).join("")}</select></label>
    <label>Início<input data-window-field="start" type="time" value="${escapeHtml(w.start)}"></label>
    <label>Fim<input data-window-field="end" type="time" value="${escapeHtml(w.end)}"></label>
    ${windows.length > 1 ? `<button type="button" class="icon-btn" data-remove-time-window="${i}" title="Remover este período"><i data-lucide="trash-2"></i></button>` : ""}
    </div>`).join("") + '<button class="secondary-btn compact" type="button" data-add-time-window>Adicionar período</button>';
}

function renderIvrTargetNode(target) {
  const pos = ivrCardPosition(target.key, target.x, target.y);
  const waitingDestinationLink = ["option-target", "time-condition"].includes(state.ivrLinkSource?.type);
  const condition = target.type === "timeCondition" && !target.duplicateId ? target.condition || {} : null;
  const trunkInbound = target.type === "trunk" ? ensureConfigTrunks().find((trunk) => trunk.id === target.value) : null;
  return `
    <section class="ivr-target-node ${condition ? "time-condition-node" : ""}" ${condition ? `data-time-condition-id="${escapeHtml(condition.id || "")}"` : ""} data-ivr-card-key="${escapeHtml(target.key)}" style="left:${pos.x}px;top:${pos.y}px">
      <header data-ivr-drag-handle>
        <span class="ivr-node-icon"><i data-lucide="${target.icon}"></i></span>
        <div>
          <strong>${escapeHtml(target.title)}</strong>
          <small>${escapeHtml(target.subtitle)}</small>
        </div>
        <div class="ivr-target-actions">
          ${waitingDestinationLink ? `<button type="button" class="icon-btn" data-ivr-target-type="${escapeHtml(target.type)}" data-ivr-target-value="${escapeHtml(target.value)}" data-ivr-target-card-key="${escapeHtml(target.key)}" title="Conectar aqui"><i data-lucide="crosshair"></i></button>` : ""}
          ${target.type === "trunk" ? `<button type="button" class="icon-btn" data-start-trunk-inbound-link="${escapeHtml(target.value)}" data-trunk-card-key="${escapeHtml(target.key)}" title="Enviar chamadas recebidas deste tronco para um menu"><i data-lucide="route"></i></button>` : ""}
          <button type="button" class="icon-btn" data-remove-target-links="${escapeHtml(target.type)}" data-target-card-key="${escapeHtml(target.key)}" data-target-value="${escapeHtml(target.value)}" title="Remover links deste card"><i data-lucide="unlink"></i></button>
          <button type="button" class="icon-btn danger" data-remove-target-card="${escapeHtml(target.type)}" data-target-value="${escapeHtml(target.value)}" data-target-card-key="${escapeHtml(target.key)}" data-target-duplicate-id="${escapeHtml(target.duplicateId || "")}" title="Excluir card"><i data-lucide="trash-2"></i></button>
        </div>
      </header>
      ${
        condition
          ? `<div class="ivr-node-grid time-condition-grid">
              <label>Nome<input data-time-field="name" value="${escapeHtml(condition.name || "")}" /></label>
              ${renderIvrTimeWindows(condition)}
              <label class="wide">Dentro do horario<div data-time-destination="in">${ivrTargetChoices(condition.inDestinationType || (condition.inDestination ? "extension" : ""), condition.inDestination || "", "", condition.id)}<input type="hidden" data-ivr-destination-card-key value="${escapeHtml(condition.inDestinationCardKey || "")}" /></div><button type="button" class="secondary-btn compact" data-start-time-link="${escapeHtml(condition.id || "")}" data-time-branch="in"><i data-lucide="git-merge"></i>Linkar card</button></label>
              <label class="wide">Fora do horario<div data-time-destination="out">${ivrTargetChoices(condition.outDestinationType || (condition.outDestination ? "extension" : ""), condition.outDestination || "", "", condition.id)}<input type="hidden" data-ivr-destination-card-key value="${escapeHtml(condition.outDestinationCardKey || "")}" /></div><button type="button" class="secondary-btn compact" data-start-time-link="${escapeHtml(condition.id || "")}" data-time-branch="out"><i data-lucide="git-merge"></i>Linkar card</button></label>
            </div>`
          : ""
      }
      ${trunkInbound ? `<div class="ivr-edge-label">Entrada: ${escapeHtml(trunkInbound.inboundDestinationType === "ivr" ? ivrMenuLabel(trunkInbound.inboundDestination || "main") : destinationLabel(trunkInbound.inboundDestinationType || "", trunkInbound.inboundDestination || ""))}</div>` : ""}
    </section>
  `;
}

function renderIvrContextTargetButtons() {
  const group = (title, icon, body) => `
    <details class="context-group" name="ivr-context-menu">
      <summary><i data-lucide="${icon}"></i><span>${escapeHtml(title)}</span></summary>
      <div class="context-group-body">${body}</div>
    </details>
  `;
  const extensionButtons = (state.config.extensions || [])
    .map(
      (ext) => `
        <button data-create-ivr-target-type="extension" data-create-ivr-target-value="${escapeHtml(ext.number)}">
          <i data-lucide="phone"></i>${escapeHtml(ext.number)} ${escapeHtml(ext.name || "Ramal")}
        </button>`
    )
    .join("");
  const queueButtons = (state.config.queues || [])
    .map(
      (queue, index) => `
        <button data-create-ivr-target-type="queue" data-create-ivr-target-value="${escapeHtml(queue.id)}">
          <i data-lucide="headphones"></i>${escapeHtml(queueLabel(queue, index))}
        </button>`
    )
    .join("");
  const trunkButtons = ensureConfigTrunks()
    .map(
      (trunk) => `
        <button data-create-ivr-target-type="trunk" data-create-ivr-target-value="${escapeHtml(trunk.id)}">
          <i data-lucide="radio-tower"></i>${escapeHtml(trunkLabel(trunk))}
        </button>`
    )
    .join("");
  const timeButtons = ensureIvrTimeConditions()
    .map(
      (condition) => `
        <button data-create-ivr-target-type="timeCondition" data-create-ivr-target-value="${escapeHtml(condition.id)}">
          <i data-lucide="clock-3"></i>${escapeHtml(condition.name || condition.id)}
        </button>`
    )
    .join("");

  return `
    ${group("Outras URAs", "workflow", ivrMenuRecords({ includeInactive: false })
      .filter((r) => r.id !== ivrEditingRecord().id && r.menu.parentMenuId !== ivrEditingRecord().id)
      .map((r) => `<button data-create-ivr-target-type="ivr" data-create-ivr-target-value="${escapeHtml(r.id)}">${escapeHtml(r.menu.name || r.id)}</button>`).join("") || "<small>Nenhuma outra URA.</small>")}
    ${group("Ramais", "phone", extensionButtons || `<small>Nenhum ramal cadastrado</small>`)}
    ${group("Filas", "headphones", queueButtons || `<small>Nenhuma fila cadastrada</small>`)}
    ${group("Troncos", "radio-tower", trunkButtons || `<small>Nenhum tronco cadastrado</small>`)}
    ${group("Horarios", "clock-3", timeButtons || `<small>Nenhum horario criado</small>`)}
  `;
}

function renderIvrLinks(cards) {
  const nodeMap = new Map(cards.map((card) => [card.key, card]));
  function targetNode(type, value, key) {
    if (!value) return null;
    const base = ivrTargetCardByDestination(type, value);
    const card = nodeMap.get(key);
    return card && (key === base || (card.type === type && card.value === value)) ? card : nodeMap.get(base);
  }
  const links = [];
  const cardSize = (card) => {
    if (card.key === "entry:main") return { width: 190, height: 72 };
    if (card.kind === "option") return { width: 360, height: 190 };
    if (card.type === "timeCondition") return { width: 360, height: 260 };
    if (card.type) return { width: 260, height: 74 };
    return { width: 540, height: 300 };
  };
  const center = (card) => {
    const size = cardSize(card);
    return { x: card.x + size.width / 2, y: card.y + size.height / 2 };
  };
  const drawLink = (from, to, className = "") => {
    if (!from || !to) return;
    const start = center(from);
    const end = center(to);
    links.push(`<line ${className ? `class="${className}"` : ""} data-link-from="${escapeHtml(from.key)}" data-link-to="${escapeHtml(to.key)}" x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" />`);
  };
  cards.filter((card) => card.kind === "option").forEach((optionCard) => {
    if (optionCard.sourceMenuKey) {
      const source = nodeMap.get(optionCard.sourceMenuKey);
      if (source) drawLink(source, optionCard);
    }
    if (optionCard.item.destination) {
      const target = targetNode(optionCard.item.destinationType, optionCard.item.destination, optionCard.item.destinationCardKey);
      if (target) {
        drawLink(optionCard, target);
      }
    }
  });
  cards.filter((card) => card.type === "timeCondition" && card.condition).forEach((timeCard) => {
    const openTarget = targetNode(timeCard.condition.inDestinationType, timeCard.condition.inDestination, timeCard.condition.inDestinationCardKey);
    const closedTarget = targetNode(timeCard.condition.outDestinationType, timeCard.condition.outDestination, timeCard.condition.outDestinationCardKey);
    drawLink(timeCard, openTarget, "time-in-link");
    drawLink(timeCard, closedTarget, "time-out-link");
  });
  ensureConfigTrunks().forEach((trunk) => {
    if (trunk.inboundDestinationType !== "ivr") return;
    const source = nodeMap.get(`trunk:${trunk.id}`);
    const target = nodeMap.get(`menu:${trunk.inboundDestination || "main"}`);
    drawLink(source, target, "entry-link");
  });
  return links.join("");
}

function ivrNodeCenter(cardKey, branch = "") {
  const escaped = window.CSS?.escape ? CSS.escape(cardKey) : String(cardKey).replace(/"/g, '\\"');
  const node = $(`.ivr-canvas-space [data-ivr-card-key="${escaped}"]`);
  if (!node) return null;
  const socket = branch && $(`[data-time-branch="${branch}"]`, node);
  if (socket) {
    const box = socket.getBoundingClientRect();
    const card = node.getBoundingClientRect();
    return { x: node.offsetLeft + (box.right - card.left) / ivrZoom(), y: node.offsetTop + (box.top + box.height / 2 - card.top) / ivrZoom() };
  }
  return {
    x: node.offsetLeft + node.offsetWidth / 2,
    y: node.offsetTop + node.offsetHeight / 2
  };
}

function updateIvrLinkLayer() {
  const layer = $(".ivr-link-layer");
  if (!layer) return;
  $all("line[data-link-from][data-link-to]", layer).forEach((line) => {
    const branch = line.classList.contains("time-in-link") ? "in" : line.classList.contains("time-out-link") ? "out" : "";
    const from = ivrNodeCenter(line.dataset.linkFrom, branch);
    const to = ivrNodeCenter(line.dataset.linkTo);
    if (!from || !to) return;
    line.setAttribute("x1", String(from.x));
    line.setAttribute("y1", String(from.y));
    line.setAttribute("x2", String(to.x));
    line.setAttribute("y2", String(to.y));
  });
}

function renderIvrCanvas({ preview = false, menuId = "" } = {}) {
  const ivr = state.config.ivr;
  const menus = ensureIvrMenus();
  const focusedRecord = menuId ? ivrMenuRecordById(menuId) : null;
  const entryPos = ivrCardPosition("entry:main", 40, 110);
  const menuEntries = [
    { record: ivrMenuRecords()[0], menu: ivr, menuKey: "main", fallbackIndex: 0 },
    ...menus.map((menu, index) => ({ record: ivrMenuRecords()[index + 1], menu, menuKey: String(index), fallbackIndex: index + 1 }))
  ];
  const visibleMenuEntries = focusedRecord ? menuEntries.filter((entry) => entry.record?.id === focusedRecord.id || entry.menu.parentMenuId === focusedRecord.id) : menuEntries;
  const layout = ensureIvrFlowLayout();
  visibleMenuEntries.forEach((entry, index) => {
    const key = ivrCardKey(entry.menuKey);
    if (!layout[key]) layout[key] = { x: 300 + index * 620, y: 90 + index * 80 };
  });
  const menuCards = visibleMenuEntries.map((entry, index) => ({
    key: ivrCardKey(entry.menuKey),
    menu: entry.menu,
    menuKey: entry.menuKey,
    record: entry.record,
    fallbackIndex: entry.fallbackIndex,
    ...ivrCardPosition(ivrCardKey(entry.menuKey), focusedRecord ? 300 : 300 + entry.fallbackIndex * 560, focusedRecord ? 90 : 90 + (entry.fallbackIndex % 2) * 260)
  }));
  const seenIds = new Set();
  for (const item of [...visibleMenuEntries.flatMap((e) => e.menu.options || []), ...ensureIvrLooseOptions(focusedRecord?.menu || currentIvrWorkspaceMenu())]) {
    if (seenIds.has(item.nodeId)) delete item.nodeId;
    seenIds.add(ensureIvrOptionId(item));
  }
  const optionCards = visibleMenuEntries
    .map((entry, index) => ({ menu: entry.menu, menuKey: entry.menuKey, menuPos: menuCards[index] }))
    .flatMap(({ menu, menuKey, menuPos }) =>
      (menu.options || []).map((item, index) => ({
        key: `option:${ensureIvrOptionId(item)}`,
        kind: "option",
        sourceType: "menu",
        sourceMenuKey: ivrCardKey(menuKey),
        menu,
        menuKey,
        item,
        index,
        menuPos,
        ...ivrCardPosition(`option:${ensureIvrOptionId(item)}`, menuPos.x + 40, menuPos.y + (currentIvrWorkspaceMenu().targetVisibility === "explicit" ? 850 + index * 600 : 250 + index * 150))
      }))
    );
  const looseOptionCards = ensureIvrLooseOptions(focusedRecord?.menu || currentIvrWorkspaceMenu()).map((item, index) => ({
    key: `option:${ensureIvrOptionId(item)}`,
    kind: "option",
    sourceType: "loose",
    sourceMenuKey: "",
    menu: focusedRecord?.menu || currentIvrWorkspaceMenu(),
    menuKey: focusedRecord?.menuKey || "main",
    item,
    index,
    menuPos: { x: 420 + index * 40, y: 560 + index * 150 },
    ...ivrCardPosition(`option:${ensureIvrOptionId(item)}`, 420 + index * 40, 560 + index * 150)
  }));
  const allOptionCards = [...optionCards, ...looseOptionCards];
  const localMenuIds = new Set(visibleMenuEntries.map((e) => e.record.id));
  const externalIds = new Set();
  const addExternal = (type, value) => { if (type === "ivr" && value && !localMenuIds.has(value)) externalIds.add(value); };
  allOptionCards.forEach(({ item }) => addExternal(item.destinationType, item.destination));
  ensureIvrTimeConditions().forEach((c) => ["in","out"].forEach((b) => addExternal(c[b+"DestinationType"], c[b+"Destination"])));
  const externalMenus = ivrMenuRecords().filter((r) => !localMenuIds.has(r.id) &&
    (externalIds.has(r.id) || Object.hasOwn(layout, "menu:" + r.id))).map((r, i) => ({
      key: "menu:" + r.id, type: "ivr", value: r.id, title: r.menu.name || r.id, subtitle: "Destino em outra URA", icon: "workflow", x: 920, y: 160 + i * 160
    }));
  const targetCards = [...ivrTargetCards(), ...externalMenus].map((target) => ({ ...target, ...ivrCardPosition(target.key, target.x, target.y) }));
  const entryHidden = focusedRecord && focusedRecord.id !== "main" ? true : Boolean(ivr.hideEntryNode);
  const entryCard = { key: "entry:main", ...entryPos };
  const allCards = [...(entryHidden ? [] : [entryCard]), ...menuCards, ...allOptionCards, ...targetCards];
  const canvasWidth = Math.max(1500, ...allCards.map((card) => card.x + 620)) + 80;
  const canvasHeight = Math.max(850, ...allCards.map((card) => card.y + 430)) + 80;
  const zoom = ivrZoom();
  const scaledCanvasWidth = Math.ceil(canvasWidth * zoom);
  const scaledCanvasHeight = Math.ceil(canvasHeight * zoom);
  const primaryDid = state.config.inboundRoutes?.[0]?.did || state.config.trunk.mainNumber || "Entrada";

  return `
    <div class="ivr-canvas-space" style="width:${scaledCanvasWidth}px;height:${scaledCanvasHeight}px">
      <div class="ivr-canvas-zoom-layer" style="width:${canvasWidth}px;height:${canvasHeight}px;transform:scale(${zoom})">
        <svg class="ivr-link-layer" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}" aria-hidden="true">
          ${!entryHidden && (!focusedRecord || focusedRecord.id === "main") && menuCards[0] ? `<line class="entry-link" data-link-from="${escapeHtml(entryCard.key)}" data-link-to="menu:main" x1="${entryCard.x + 95}" y1="${entryCard.y + 36}" x2="${menuCards[0].x + 270}" y2="${menuCards[0].y + 150}" />` : ""}
          ${renderIvrLinks(allCards)}
        </svg>
        ${
          entryHidden
            ? ""
            : `<section class="ivr-entry-node" data-ivr-card-key="entry:main" style="left:${entryPos.x}px;top:${entryPos.y}px">
                <header data-ivr-drag-handle>
                  <i data-lucide="phone"></i>
                  <div>
                    <strong>${escapeHtml(primaryDid)}</strong>
                    <span>Entrada do tronco</span>
                  </div>
                  ${preview ? "" : `<button type="button" class="icon-btn danger" data-hide-ivr-entry title="Excluir entrada antiga"><i data-lucide="trash-2"></i></button>`}
                </header>
              </section>`
        }
        ${visibleMenuEntries.map((entry) => renderIvrMenuNode(entry.menuKey === "main" ? { ...ivr, id: "main", options: ivr.options || [] } : entry.menu, entry.menuKey, entry.menuKey === "main", entry.fallbackIndex, preview)).join("")}
        ${allOptionCards.map((card) => renderIvrOptionNode(card, preview)).join("")}
        ${targetCards.map((target) => renderIvrTargetNode(target)).join("")}
      </div>
    </div>
  `;
}

function renderIvrManager() {
  const records = ivrMenuRecords().filter((record) => !record.menu.parentMenuId);
  const trunks = ensureConfigTrunks();
  const routes = state.config.inboundRoutes || [];
  const rows = records
    .map((record) => {
      const menu = record.menu;
      const optionCount = (menu.options || []).length;
      const inboundCount =
        trunks.filter((trunk) => trunk.inboundDestinationType === "ivr" && (trunk.inboundDestination || "main") === record.id).length +
        routes.filter((route) => route.destinationType === "ivr" && (route.destination || "main") === record.id).length;
      return `
        <article class="panel ivr-list-card ${record.active ? "" : "muted-card"}" data-ivr-list-card="${escapeHtml(record.id)}">
          <div class="panel-header compact-card-header">
            <div>
              <p class="eyebrow">${record.isMain ? "URA principal" : "URA"}</p>
              <h3>${escapeHtml(menu.name || record.id)}</h3>
              <p class="microcopy">${escapeHtml(record.id)} - ${monitorNumber(optionCount)} opcoes - ${monitorNumber(inboundCount)} entradas usando</p>
            </div>
            <span class="badge ${record.active ? "ok" : "warn"}">${record.active ? "Ativa" : "Inativa"}</span>
          </div>
          <div class="ivr-list-meta">
            <span><i data-lucide="volume-2"></i>${escapeHtml(menu.greeting || "Sem audio")}</span>
            <span><i data-lucide="git-branch"></i>${monitorNumber(optionCount)} opcoes</span>
            <span><i data-lucide="radio-tower"></i>${monitorNumber(inboundCount)} vinculos</span>
          </div>
          <div class="compact-card-actions">
            <button class="primary-btn compact" data-edit-ivr-root="${escapeHtml(record.id)}" type="button"><i data-lucide="pencil"></i>Editar</button>
            ${
              record.isMain
                ? `<button class="secondary-btn compact" type="button" disabled><i data-lucide="shield"></i>Protegida</button>`
                : `<button class="secondary-btn compact" data-toggle-ivr-root="${escapeHtml(record.id)}" type="button"><i data-lucide="${record.active ? "pause-circle" : "play-circle"}"></i>${record.active ? "Inativar" : "Ativar"}</button>
                   <button class="icon-btn danger" data-delete-ivr-root="${escapeHtml(record.id)}" type="button" title="Excluir URA"><i data-lucide="trash-2"></i></button>`
            }
          </div>
        </article>
      `;
    })
    .join("");

  pages.ivr.innerHTML = `
    <div class="section-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">URAs</p>
            <h3>Fluxos de atendimento</h3>
            <p class="hint">Gerencie cada URA separadamente. Ao editar, o construtor abre focado somente naquele fluxo.</p>
          </div>
          <button id="newIvrRootBtn" class="primary-btn" type="button"><i data-lucide="workflow"></i>Nova URA</button>
        </div>
      </section>
      <section class="ivr-list-grid">
        ${rows}
      </section>
    </div>
  `;
}

function renderIvr() {
  syncIvrBuilderFromRoute();
  if (!state.ivrBuilderOpen && !state.ivrFullscreen) {
    renderIvrManager();
    return;
  }
  const editingRecord = ivrEditingRecord();
  const viewportKey = editingRecord?.id || currentIvrViewportKey();
  const capturedViewport = state.activeTab === "ivr" ? saveIvrViewport(captureIvrViewport(), viewportKey) : null;
  const viewport = selectedIvrViewport(viewportKey, capturedViewport);
  const linkText =
    state.ivrLinkSource?.type === "time-condition" ? `Escolha o destino para chamadas ${state.ivrLinkSource.branch === "in" ? "dentro" : "fora"} do horário.` :
    state.ivrLinkSource?.type === "menu-option"
      ? "Escolha um card de opcao para ligar a este menu."
      : state.ivrLinkSource?.type === "option-target"
        ? "Escolha um menu, ramal, fila ou grupo para concluir o destino."
        : state.ivrLinkSource?.type === "trunk-entry"
          ? "Escolha o menu que deve receber as chamadas de entrada deste tronco."
          : "Arraste os cards e crie os links individualmente: menu para opcao, opcao para destino, e tronco para menu de entrada.";

  pages.ivr.innerHTML = `
    <div class="ivr-builder ${state.ivrFullscreen ? "fullscreen" : ""}">
      <section class="ivr-flow-toolbar">
        <div>
          <p class="eyebrow">Construtor visual</p>
          <h3>${escapeHtml(editingRecord?.menu?.name || "Fluxograma da URA")}</h3>
          <p class="hint">${escapeHtml(linkText)}</p>
        </div>
        <div class="monitor-toolbar">
          <button id="backToIvrListBtn" class="secondary-btn"><i data-lucide="arrow-left"></i>Voltar</button>
          <span class="badge">${escapeHtml(editingRecord?.id || "main")}</span>
          <span class="badge">${monitorNumber((editingRecord?.menu?.options || []).length)} opcoes</span>
          ${state.ivrLinkSource ? `<button id="cancelIvrLinkBtn" class="secondary-btn"><i data-lucide="x"></i>Cancelar link</button>` : ""}
          <button id="addIvrRootBtn" class="secondary-btn"><i data-lucide="workflow"></i>Nova URA</button>
          <button id="addIvrMenuBtn" class="secondary-btn"><i data-lucide="git-branch-plus"></i>Novo menu</button>
          <button id="toggleIvrFullscreenBtn" class="secondary-btn"><i data-lucide="${state.ivrFullscreen ? "minimize-2" : "maximize-2"}"></i>${state.ivrFullscreen ? "Sair da tela cheia" : "Tela cheia"}</button>
          ${state.ivrFullscreen ? `<button id="saveIvrFullscreenBtn" class="primary-btn"><i data-lucide="save"></i>Salvar e aplicar</button>` : ""}
        </div>
      </section>
      <section class="ivr-flow-canvas">
        ${renderIvrCanvas({ menuId: editingRecord?.id || "main" })}
      </section>
      ${
        state.ivrContextMenu
          ? `<div class="ivr-context-menu" style="left:${state.ivrContextMenu.clientX}px;top:${state.ivrContextMenu.clientY}px">
              <details class="context-group" name="ivr-context-menu">
                <summary><i data-lucide="plus"></i><span>Criar</span></summary>
                <div class="context-group-body">
                  <button data-create-ivr-card="root"><i data-lucide="workflow"></i>Nova URA</button>
                  <button data-create-ivr-card="menu"><i data-lucide="messages-square"></i>Menu com audio</button>
                  <button data-create-ivr-card="ramal"><i data-lucide="phone-plus"></i>Novo ramal</button>
                  <button data-create-ivr-card="timeCondition"><i data-lucide="clock-3"></i>Horario</button>
                </div>
              </details>
              ${renderIvrContextTargetButtons()}
              <details class="context-group" name="ivr-context-menu">
                <summary><i data-lucide="list-plus"></i><span>Opcoes</span></summary>
                <div class="context-group-body">
                  ${[..."1234567890*#"].map((digit) => `<button data-create-ivr-card="option" data-digit="${digit}"><span>${digit}</span>Tecla ${digit}</button>`).join("")}
                </div>
              </details>
            </div>`
          : ""
      }
    </div>
  `;
  updateIvrLinkLayer();
  restoreIvrViewport(viewport);
}

function dialerStatusLabel(status) {
  return {
    draft: "Rascunho",
    running: "Rodando",
    paused: "Pausada",
    done: "Concluida"
  }[status] || "Rascunho";
}

function dialerDestinationSelect(type, value) {
  const queues = state.dialerDestinations.queues?.length ? state.dialerDestinations.queues : (state.config.queues || []);
  const extensions = state.dialerDestinations.extensions?.length ? state.dialerDestinations.extensions : (state.config.extensions || []);
  const queueOptions = queues.map((queue, index) => option(queue.id, value, queue.name || queueLabel(queue, index))).join("");
  const extensionOptions = extensions.map((ext) => option(ext.number, value, `${ext.number} ${ext.name || ""}`.trim())).join("");
  return `
    <select name="destinationType" aria-label="Tipo de destino" data-dialer-destination-type>
      ${option("queue", type, "Fila")}
      ${option("extension", type, "Ramal")}
    </select>
    <select name="destination" aria-label="Fila ou ramal de destino" data-dialer-destination>
      ${type === "extension" ? extensionOptions : queueOptions}
    </select>
  `;
}

function dialerTrunkOptions(selected = []) {
  const selectedSet = new Set(selected?.length ? selected : [state.config.outbound?.defaultTrunk || ensureConfigTrunks()[0]?.id || "trunk-operadora"]);
  const trunks = (state.dialerTrunks.length ? state.dialerTrunks : ensureConfigTrunks()).filter((trunk) => trunk.active !== false && PbxTrunkPolicy.allows(trunk, "outbound"));
  return trunks.map((trunk) => `<label class="dialer-trunk-choice"><input type="checkbox" name="trunkIds" value="${escapeHtml(trunk.id)}" ${selectedSet.has(trunk.id) ? "checked" : ""}><span>${escapeHtml(trunkLabel(trunk))}</span><small class="dialer-trunk-selected">${state.dialerTrunkHealth[trunk.id] === "unavailable" ? "Indisponível" : "Selecionado"}</small></label>`).join("");
}

function dialerTrunkSummary(campaign) {
  if (campaign.transport === "whatsapp") return "WhatsApp";
  const trunks = campaign.trunkIds || [];
  if (!trunks.length) return "Padrao";
  return trunks
    .map((id) => {
      const trunk = [...state.dialerTrunks, ...ensureConfigTrunks()].find((item) => item.id === id);
      return trunk ? trunkLabel(trunk) : id;
    })
    .join(", ");
}

function dialerProgress(stats = {}) {
  const total = Number(stats.total || 0);
  if (!total) return 0;
  return Math.round((Number(stats.completed || 0) / total) * 100);
}

function dialerResultSummary(stats = {}, transport = "sip") {
  return `
    <div class="dialer-result-list">
      <span class="success"><strong>${Number(stats.accepted || 0)}</strong> ${transport === "whatsapp" ? "conversaram com um atendente" : "atenderam e pediram atendimento"}</span>
      <span><strong>${Number(stats.answered || 0)}</strong> ${transport === "whatsapp" ? "atenderam, mas não conversaram com um atendente" : "atenderam, mas não confirmaram para falar"}</span>
      <span class="warning"><strong>${Number(stats.noAnswer || 0)}</strong> não atenderam</span>
      <span class="warning"><strong>${Number(stats.busy || 0)}</strong> números ocupados</span>
      <span class="danger"><strong>${Number(stats.failed || 0)}</strong> ligações não completadas</span>
      <span><strong>${Number(stats.canceled || 0)}</strong> ligações canceladas</span>
    </div>
  `;
}

function currentDialerFormCampaign() {
  return state.dialerCampaigns.find((campaign) => campaign.id === state.dialerEditingId) || null;
}

function renderDialerCampaignRows() {
  if (!state.dialerCampaigns.length) {
    if (state.dialerCampaignsError) return `<div class="governance-empty" role="alert"><strong>Nao foi possivel carregar as campanhas.</strong><span>Use Atualizar para tentar novamente.</span></div>`;
    if (!state.dialerCampaignsLoaded) return `<div class="governance-empty" role="status" aria-live="polite"><i data-lucide="loader-circle"></i><strong>Carregando campanhas...</strong></div>`;
    return `<div class="governance-empty"><i data-lucide="phone-call"></i><strong>Nenhuma campanha criada.</strong></div>`;
  }
  return state.dialerCampaigns
    .map((campaign) => {
      const stats = campaign.stats || {};
      const running = campaign.status === "running";
      const progress = dialerProgress(stats);
      const unavailable = campaign.transport === "whatsapp" ? [] : (campaign.trunkIds || []).filter((id) => state.dialerTrunkHealth[id] === "unavailable");
      return `
        <article class="panel entity-list-card">
          <div class="panel-header">
            <h3>${escapeHtml(campaign.name)}</h3>
            <span class="dialer-status ${escapeHtml(campaign.status || "draft")}">${escapeHtml(dialerStatusLabel(campaign.status))}</span>
          </div>
          <div>
            <div class="dialer-progress"><span style="width:${progress}%"></span></div>
            <small>${progress}% concluido · ${Number(stats.total || 0)} numeros</small>
          </div>
          <div class="list-card-meta">
            <span><strong>Encaminhar para</strong>${escapeHtml(destinationLabel(campaign.destinationType, campaign.destination))}</span>
            <span><strong>${campaign.transport === "whatsapp" ? "WhatsApp" : "Tecla"}</strong>${campaign.transport === "whatsapp" ? "Encaminhamento automático ao atender" : escapeHtml(campaign.digit || "1")}</span>
          </div>
          <div>
            <small>${Number(stats.pending || 0)} aguardando ligação | ${Number(stats.inProgress || 0)} ligando agora</small>
          </div>
          ${dialerResultSummary(stats, campaign.transport)}
          ${campaign.transport === "whatsapp" && !state.dialerWhatsApp?.connected ? '<small class="dialer-trunk-warning">WhatsApp desconectado. As próximas ligações aguardam a reconexão.</small>' : ""}
          ${unavailable.length ? `<small class="dialer-trunk-warning">Tronco indisponível: ${escapeHtml(unavailable.join(", "))}. O discador usa apenas os troncos registrados.</small>` : ""}
            <div class="compact-card-actions">
              <button class="icon-btn" type="button" data-dialer-report="${escapeHtml(campaign.id)}" title="Relatório da campanha"><i data-lucide="chart-column"></i></button>
              <button class="icon-btn" type="button" data-edit-dialer="${escapeHtml(campaign.id)}" title="Editar campanha"><i data-lucide="pencil"></i></button>
              <button class="icon-btn ${running ? "danger" : ""}" type="button" data-dialer-action="${running ? "pause" : "start"}" data-dialer-id="${escapeHtml(campaign.id)}" title="${running ? "Pausar" : "Iniciar"}"><i data-lucide="${running ? "pause" : "play"}"></i></button>
              <button class="icon-btn" type="button" data-dialer-action="reset" data-dialer-id="${escapeHtml(campaign.id)}" title="Reiniciar lista"><i data-lucide="rotate-ccw"></i></button>
              <button class="icon-btn danger" type="button" data-delete-dialer="${escapeHtml(campaign.id)}" title="Excluir campanha"><i data-lucide="trash-2"></i></button>
            </div>
        </article>
      `;
    })
    .join("");
}

function renderDialerCampaignLiveData() {
  syncDialerTransport($("#dialerCampaignForm", pages.dialer));
  const count = $("[data-dialer-campaign-count]", pages.dialer);
  const rows = $("[data-dialer-campaign-rows]", pages.dialer);
  if (count) count.textContent = state.dialerCampaignsLoaded ? `${state.dialerCampaigns.length} campanhas` : "Carregando...";
  if (rows) {
    const html = renderDialerCampaignRows();
    if (rows._lastDialerHtml !== html) {
      rows.innerHTML = html;
      rows._lastDialerHtml = html;
    }
  }
}

function renderDialer() {
  if (!pages.dialer || !state.config) return;
  const editing = currentDialerFormCampaign();
  const showEditor = state.dialerEditorOpen || Boolean(editing);
  const firstQueue = state.config.queues?.[0]?.id || "";
  const firstExtension = state.config.extensions?.[0]?.number || "";
  const destinationType = editing?.destinationType || "queue";
  const destination = editing?.destination || (destinationType === "extension" ? firstExtension : firstQueue);
  const campaignRowsHtml = renderDialerCampaignRows();
  const editor = showEditor ? `
    <section class="panel entity-editor-shell">
      <div class="panel-header entity-editor-header">
        <div><p class="eyebrow">Discador</p><h3>${editing ? "Editar campanha" : "Nova campanha"}</h3><p class="microcopy">${editing ? "Edite somente esta campanha." : "Cadastre uma nova campanha."} Os dados permanecem em rascunho ate salvar.</p></div>
        <button class="secondary-btn" type="button" data-cancel-dialer-edit><i data-lucide="arrow-left"></i>Voltar para lista</button>
      </div>
      <form id="dialerCampaignForm" class="field-grid dialer-form">
        <input type="hidden" name="id" value="${escapeHtml(editing?.id || "")}" />
        <div class="dialer-form-section-title"><span>Campanha e atendimento</span></div>
        ${fieldBlock("Ligar por", "Escolha a linha telefônica ou a conta de WhatsApp vinculada. No WhatsApp, quem atender será encaminhado automaticamente ao destino, sem áudio e sem apertar uma tecla.", `<select name="transport" data-dialer-transport>${option("sip", editing?.transport || "sip", "Linha telefônica")}${option("whatsapp", editing?.transport || "sip", "WhatsApp")}</select>`, "dialer-field-name")}
        <div class="dialer-whatsapp-info" data-dialer-whatsapp-info hidden role="status"></div>
        ${fieldBlock("Nome", "Nome interno para localizar a campanha.", `<input name="name" value="${escapeHtml(editing?.name || "")}" placeholder="Ex: Boletos em aberto" required />`, "dialer-field-name")}
        ${fieldBlock("Áudio", "Mensagem que sera tocada quando o cliente atender. Apos enviar um novo audio, use Salvar e aplicar para disponibiliza-lo no PBX.", `<div class="audio-picker"><select name="audio" required>${audioChoices(editing?.audio || "")}</select><button class="icon-btn" type="button" data-upload-dialer-audio title="Adicionar áudio" aria-label="Adicionar áudio"><i data-lucide="plus"></i></button></div><input id="dialerAudioFile" type="file" accept=".wav,.mp3,.gsm,.ulaw,.alaw,.sln16" hidden />`, "dialer-field-audio")}
        ${fieldBlock("Tecla", "Numero que o cliente deve apertar para falar com o atendimento.", `<input name="digit" inputmode="numeric" maxlength="1" value="${escapeHtml(editing?.digit || "1")}" required />`, "dialer-field-digit")}
        ${fieldBlock("Identificador", "Numero apresentado quando o tronco permitir caller ID.", `<input name="callerId" value="${escapeHtml(editing?.callerId || state.config.trunk?.mainNumber || "")}" />`, "dialer-field-caller")}
        ${fieldBlock("Destino", "Fila ou ramal que recebe o cliente. No WhatsApp, o encaminhamento acontece assim que ele atende; na linha telefônica, depois de apertar a tecla.", `<div class="dual-select">${dialerDestinationSelect(destinationType, destination)}</div>`, "dialer-field-destination")}
        <fieldset class="dialer-trunk-picker"><legend class="field-title">Troncos da campanha ${helpIcon("Marque os troncos que fazem parte desta campanha. Com mais de um selecionado, o discador alterna entre eles.")}</legend><div class="dialer-trunk-options">${dialerTrunkOptions(editing?.trunkIds || [])}</div></fieldset>
        <div class="dialer-form-section-title"><span>Ritmo das ligações</span></div>
        ${fieldBlock("Chamadas por rodada", "Quantidade enviada ao Asterisk em cada disparo.", `<input name="maxConcurrent" type="number" min="1" max="10" value="${Number(editing?.maxConcurrent || 1)}" />`, "dialer-field-metric")}
        ${fieldBlock("Intervalo", "Segundos entre uma rodada e outra.", `<input name="intervalSeconds" type="number" min="3" max="3600" value="${Number(editing?.intervalSeconds || 8)}" />`, "dialer-field-metric")}
        ${fieldBlock("Tentativas", "Quantidade maxima de envio por numero.", `<input name="retryAttempts" type="number" min="1" max="5" value="${Number(editing?.retryAttempts || 1)}" />`, "dialer-field-metric")}
        ${fieldBlock("Espera da tecla", "Segundos para aguardar a escolha depois do audio.", `<input name="responseTimeout" type="number" min="3" max="60" value="${Number(editing?.responseTimeout || 8)}" />`, "dialer-field-metric")}
        <div class="dialer-form-section-title"><span>Lista de contatos</span></div>
        ${fieldBlock("Descricao", "Observacao interna opcional.", `<input name="description" value="${escapeHtml(editing?.description || "")}" />`, "dialer-field-description")}
        ${fieldBlock("Numeros", "Cole um numero por linha, ou separados por virgula.", `<textarea name="numbers" rows="5" spellcheck="false" placeholder="31999999999&#10;31988888888" required>${escapeHtml(editing?.numberText || "")}</textarea>`, "dialer-field-numbers")}
        <div class="form-actions dialer-form-actions"><button class="primary-btn" type="submit"><i data-lucide="save"></i>${editing ? "Atualizar campanha" : "Salvar campanha"}</button></div>
      </form>
    </section>` : "";
  pages.dialer.innerHTML = `
    <div class="section-grid dialer-shell">
      ${editor}
      <section class="panel">
        <div class="panel-header"><div><p class="eyebrow">Operacao</p><h3>Campanhas</h3><p class="microcopy">Consulte as campanhas e abra somente aquela que deseja editar.</p></div><div class="compact-card-actions"><button class="secondary-btn compact" type="button" data-refresh-dialer><i data-lucide="refresh-cw"></i>Atualizar</button><button class="primary-btn compact" type="button" data-new-dialer><i data-lucide="plus"></i>Nova campanha</button></div></div>
        <span class="badge" data-dialer-campaign-count>${state.dialerCampaignsLoaded ? `${state.dialerCampaigns.length} campanhas` : "Carregando..."}</span>
        <div class="entity-list-grid" data-dialer-campaign-rows>${campaignRowsHtml}</div>
      </section>
    </div>`;
  const campaignRows = $("[data-dialer-campaign-rows]", pages.dialer);
  if (campaignRows) campaignRows._lastDialerHtml = campaignRowsHtml;
  syncDialerTransport($("#dialerCampaignForm", pages.dialer));
}

function syncDialerTransport(form) {
  if (!form) return;
  const whatsapp = form.elements.transport?.value === "whatsapp";
  for (const selector of [".dialer-field-audio", ".dialer-field-digit", ".dialer-field-caller", ".dialer-trunk-picker"]) {
    const group = form.querySelector(selector);
    if (!group) continue;
    group.hidden = whatsapp;
    group.querySelectorAll("input, select, button").forEach((field) => { field.disabled = whatsapp; });
  }
  const wait = form.elements.responseTimeout;
  if (wait) { wait.closest(".dialer-field-metric").hidden = whatsapp; wait.disabled = whatsapp; }
  const concurrent = form.elements.maxConcurrent;
  if (concurrent) {
    if (whatsapp && !concurrent.readOnly) { concurrent.dataset.sipValue = concurrent.value; concurrent.value = "1"; }
    if (!whatsapp && concurrent.readOnly) concurrent.value = concurrent.dataset.sipValue || "1";
    concurrent.readOnly = whatsapp;
  }
  const info = form.querySelector("[data-dialer-whatsapp-info]");
  if (info) {
    info.hidden = !whatsapp;
    const connection = state.dialerWhatsApp || {};
    info.textContent = `${!connection.checkedAt ? "Conferindo conexão do WhatsApp…" : connection.connected ? `WhatsApp conectado: +${connection.account}.` : "WhatsApp desconectado. Vincule o aparelho no laboratório antes de iniciar."} Uma ligação por vez nesta conta. Ao atender, o cliente é encaminhado diretamente à fila ou ao ramal escolhido.`;
  }
}

function recordingPartyNumber(call = {}) {
  if (call.type === "inbound") return call.source || call.callerId || call.destination || "";
  if (call.type === "outbound") return call.destination || call.callerId || call.source || "";
  return call.destination || call.source || call.callerId || "";
}

function renderIvrAudioLibrary() {
  const rows = (state.ivrAudios || [])
    .map(
      (audio) => `
        <div class="audio-item ivr-audio-row">
          <div>
            <strong>${escapeHtml(audio.label)}</strong>
            <div class="hint">${escapeHtml(audio.playback)}</div>
          </div>
          <audio controls preload="none" src="${escapeHtml(audio.url)}"></audio>
          <button type="button" class="icon-btn danger" data-delete-ivr-audio="${escapeHtml(audio.file)}" title="Excluir audio">
            <i data-lucide="trash-2"></i>
          </button>
        </div>`
    )
    .join("");
  return `
    <section class="panel recording-ivr-library">
      <div class="panel-header">
        <div>
          <h3>Audios da URA</h3>
          <p class="table-meta">Arquivos usados nos menus e opcoes do atendimento automatico.</p>
        </div>
        <span class="badge">${monitorNumber(state.ivrAudios.length)} arquivos</span>
      </div>
      <form id="ivrAudioUploadForm" class="recording-upload" enctype="multipart/form-data">
        <input name="audio" type="file" accept=".wav,.gsm,.ulaw,.alaw,.sln16,.mp3,audio/*" required />
        <button class="primary-btn" type="submit"><i data-lucide="upload"></i>Enviar audio</button>
      </form>
      <div class="audio-list">${rows || `<div class="governance-empty"><i data-lucide="audio-lines"></i><strong>Nenhum audio da URA</strong><span>Envie um arquivo para usa-lo no construtor.</span></div>`}</div>
    </section>`;
}

function renderIvrAudios() {
  if (!pages.ivrAudios) return;
  pages.ivrAudios.innerHTML = state.user && canAccessTab("ivrAudios") ? renderIvrAudioLibrary() : "";
}

function renderAudios() {
  if (!pages.audios) return;
  if (!state.user || !canAccessTab("audios")) { pages.audios.innerHTML = ""; return; }
  const library = state.recordingLibrary;
  const filters = library.filters || {};
  const meta = library.meta || {};
  const permissions = meta.permissions || {};
  const activeFilterCount = Object.values(filters).filter((value) => String(value || "") !== "").length;
  const extensionOptions = `<option value="">Todos os ramais</option>${(state.config.extensions || [])
    .map((extension) => option(extension.number, filters.extension || "", `${extension.number} - ${extension.name || "Ramal"}`))
    .join("")}`;
  const queueOptions = `<option value="">Todas as filas</option>${(state.config.queues || [])
    .map((queue, index) => option(queue.id || queue.number || "", filters.queue || "", queueLabel(queue, index)))
    .join("")}`;
  const recordingRows = (library.calls || [])
    .map((call) => {
      const direction = { inbound: "Entrada", outbound: "Saída", internal: "Interna" }[call.type] || "Chamada";
      const agent = [call.extension && `Ramal ${call.extension}`, call.extensionName].filter(Boolean).join(" · ");
      return `
        <article class="recording-entry">
          <div class="recording-party">
            <div class="recording-type-icon ${escapeHtml(call.type || "")}" aria-hidden="true"><i data-lucide="${reportTypeIcon(call.type)}"></i></div>
            <div><strong>${escapeHtml(recordingPartyNumber(call) || "Número não identificado")}</strong>
              <small>${escapeHtml([direction, agent].filter(Boolean).join(" · "))}</small></div>
          </div>
          <div class="recording-protocol"><small>Protocolo</small>
            ${call.protocol ? `<strong>${escapeHtml(call.protocol)}</strong>` : '<span>Não registrado</span>'}</div>
          <div class="recording-time"><span>${escapeHtml(formatDateTime(call.startedAt))}</span>
            <small>${escapeHtml(call.durationLabel || "0s")}</small></div>
          <div class="recording-actions">
            ${permissions.canListenRecordings ? `<button class="primary-btn compact" data-listen-recording="${escapeHtml(call.uniqueId)}"><i data-lucide="play"></i>Escutar</button>` : ""}
            ${permissions.canDownloadRecordings ? `<a class="icon-btn" href="/api/pbx/recordings/${encodeURIComponent(call.uniqueId)}/download" aria-label="Baixar gravação" title="Baixar gravação"><i data-lucide="download"></i></a>` : ""}
            <button class="icon-btn" data-call-details="${escapeHtml(call.id)}" aria-label="Detalhes da chamada" title="Detalhes da chamada"><i data-lucide="eye"></i></button>
          </div>
        </article>`;
    })
    .join("");

  const callLibrary = `
    <section class="panel recording-filters-panel">
      <div class="panel-header">
        <div><h3>Localizar gravações</h3><p class="table-meta">${activeFilterCount ? `${activeFilterCount} filtro(s) ativo(s)` : "Busque por número, protocolo ou período."}</p></div>
        <button id="toggleRecordingFiltersBtn" aria-expanded="${library.filtersOpen}" class="secondary-btn" type="button"><i data-lucide="${library.filtersOpen ? "chevron-up" : "sliders-horizontal"}"></i>${library.filtersOpen ? "Menos filtros" : "Mais filtros"}</button>
      </div>
      <div class="recording-filter-grid primary">
        <label>Data inicial<input data-recording-filter="dateStart" type="date" value="${escapeHtml(filters.dateStart || "")}" /></label>
        <label>Data final<input data-recording-filter="dateEnd" type="date" value="${escapeHtml(filters.dateEnd || "")}" /></label>
        <label class="recording-number-filter">Número<input data-recording-filter="number" value="${escapeHtml(filters.number || "")}" placeholder="Cliente, origem ou destino" inputmode="tel" /></label>
        <label>Ramal<select data-recording-filter="extension">${extensionOptions}</select></label>
        <label>Protocolo<input data-recording-filter="protocol" value="${escapeHtml(filters.protocol || "")}" placeholder="Número do protocolo" inputmode="numeric" /></label>
      </div>
      <div class="recording-filter-grid advanced ${library.filtersOpen ? "" : "hidden"}">
        <label>Direção<select data-recording-filter="type">${option("", filters.type || "", "Todas")}${option("inbound", filters.type || "", "Entrada")}${option("outbound", filters.type || "", "Saída")}${option("internal", filters.type || "", "Interna")}</select></label>
        <label>Status<select data-recording-filter="status">${option("", filters.status || "", "Todos")}${option("answered", filters.status || "", "Atendida")}${option("no_answer", filters.status || "", "Nao atendida")}${option("busy", filters.status || "", "Ocupado")}${option("failed", filters.status || "", "Falhou")}</select></label>
        <label>Fila<select data-recording-filter="queue">${queueOptions}</select></label>
        <label>Duracao minima<input data-recording-filter="minDuration" type="number" min="0" value="${escapeHtml(filters.minDuration || "")}" placeholder="Segundos" /></label>
        <label>Duracao maxima<input data-recording-filter="maxDuration" type="number" min="0" value="${escapeHtml(filters.maxDuration || "")}" placeholder="Segundos" /></label>
        <label>Origem<input data-recording-filter="source" value="${escapeHtml(filters.source || "")}" /></label>
        <label>Destino<input data-recording-filter="destination" value="${escapeHtml(filters.destination || "")}" /></label>
        <label class="wide">Busca geral<input data-recording-filter="q" value="${escapeHtml(filters.q || "")}" placeholder="Nome, protocolo, Caller ID ou identificador" /></label>
      </div>
      <div class="filter-actions">
        <button id="applyRecordingFiltersBtn" class="primary-btn" type="button"><i data-lucide="search"></i>Buscar gravações</button>
        <button id="clearRecordingFiltersBtn" class="secondary-btn" type="button"><i data-lucide="x"></i>Limpar</button>
      </div>
    </section>
    <section class="panel recording-results-panel">
      <div class="panel-header">
        <div><h3>Gravações de chamadas</h3><p class="table-meta">${library.loading ? "Carregando..." : `${monitorNumber(meta.total || 0)} resultado(s)`}</p></div>
        <button id="reloadRecordingsBtn" class="icon-btn" type="button" title="Atualizar gravacoes"><i data-lucide="rotate-cw"></i></button>
      </div>
      <div class="recording-list">${recordingRows || (library.loading ? "" : `<div class="governance-empty"><i data-lucide="file-audio"></i><strong>Nenhuma gravação encontrada</strong><span>Revise os filtros ou o período selecionado.</span></div>`)}</div>
      <div class="pagination recording-pagination" ${Number(meta.pages || 1) <= 1 ? "hidden" : ""}>
        <button class="secondary-btn" data-recording-page="${Math.max(1, Number(meta.page || 1) - 1)}" ${Number(meta.page || 1) <= 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i>Anterior</button>
        <span>Pagina ${monitorNumber(meta.page || 1)} de ${monitorNumber(meta.pages || 1)}</span>
        <button class="secondary-btn" data-recording-page="${Math.min(Number(meta.pages || 1), Number(meta.page || 1) + 1)}" ${Number(meta.page || 1) >= Number(meta.pages || 1) ? "disabled" : ""}>Proxima<i data-lucide="chevron-right"></i></button>
      </div>
    </section>`;

  pages.audios.innerHTML = `<div class="recordings-shell">${callLibrary}</div>`;
}

function removeQueueReferences(queueId) {
  const config = state.config || {};
  const fallbackExtension = config.extensions?.[0]?.number || "";
  const clearQueueDestination = (item) => {
    if (item?.destinationType === "queue" && String(item.destination) === String(queueId)) {
      item.destinationType = "";
      item.destination = "";
      item.destinationCardKey = "";
      return true;
    }
    return false;
  };

  (config.inboundRoutes || []).forEach((route) => {
    if (route.destinationType === "queue" && String(route.destination) === String(queueId)) {
      route.destinationType = fallbackExtension ? "extension" : "";
      route.destination = fallbackExtension;
    }
  });

  if (config.businessHours?.afterHoursDestinationType === "queue" && String(config.businessHours.afterHoursDestination) === String(queueId)) {
    config.businessHours.afterHoursDestinationType = fallbackExtension ? "extension" : "";
    config.businessHours.afterHoursDestination = fallbackExtension;
  }

  [...(config.ringGroups || []), ...(config.queues || [])].forEach((group) => {
    if (group.fallbackType === "queue" && String(group.fallback) === String(queueId)) {
      group.fallbackType = "none";
      group.fallback = "";
    }
  });

  const ivr = config.ivr || {};
  const menus = [ivr, ...(ivr.menus || [])];
  menus.forEach((menu) => (menu.options || []).forEach(clearQueueDestination));
  (ivr.looseOptions || []).forEach(clearQueueDestination);
  menus.forEach((menu) => {
    (menu.timeConditions || []).forEach((condition) => {
      ["in", "out"].forEach((prefix) => {
        if (condition[`${prefix}DestinationType`] === "queue" && String(condition[`${prefix}Destination`]) === String(queueId)) {
          condition[`${prefix}DestinationType`] = "";
          condition[`${prefix}Destination`] = "";
          condition[`${prefix}DestinationCardKey`] = "";
        }
      });
    });
    menu.hiddenTargetCards = (menu.hiddenTargetCards || []).filter((card) => !(card.type === "queue" && String(card.value) === String(queueId)));
    const layout = menu.flowLayout || {};
    Object.keys(layout).forEach((key) => {
      if (key === `queue:${queueId}` || key.startsWith(`queue:${queueId}:`)) delete layout[key];
    });
  });

  if (state.ivrLinkSource?.targetType === "queue" && String(state.ivrLinkSource?.targetValue) === String(queueId)) {
    state.ivrLinkSource = null;
  }
}

function finalDestinationChoices(item = {}, excludedQueueId = "") {
  const legacy = item.fallback && (!item.fallbackType || item.fallbackType === "extension");
  const selected = legacy ? "legacy:" : item.fallbackType === "queue" ? item.fallback : "";
  return (legacy ? option("legacy:", selected, "Manter destino atual (legado)") : "") +
    option("", selected, "Nenhum") + state.config.queues
      .filter((queue) => queue.id !== excludedQueueId)
      .map((queue) => option(queue.id, selected, `${queue.number || queue.id} ${queue.name}`)).join("");
}

function collectFinalDestination(item, value) {
  if (value === "legacy:") return;
  item.fallbackType = value ? "queue" : "none";
  item.fallback = value || "";
}

function queueStrategyLabel(strategy) {
  return ({ rrmemory: "Rodízio entre agentes", ringall: "Tocar em todos ao mesmo tempo", leastrecent: "Há mais tempo sem atender", fewestcalls: "Menor número de chamadas atendidas", random: "Distribuição aleatória", linear: "Ordem dos agentes", roundrobin: "Rodízio entre agentes", wrandom: "Distribuição aleatória por peso", rrordered: "Rodízio ordenado" })[strategy] || strategy || "Não definida";
}

function renderQueues() {
  const ring = state.config.ringGroups[0];
  const queues = state.config.queues || [];
  const queueStrategies = ["rrmemory", "ringall", "leastrecent", "fewestcalls"];
  const strategyLabels = { rrmemory: "Rodízio entre agentes", ringall: "Tocar em todos ao mesmo tempo", leastrecent: "Há mais tempo sem atender", fewestcalls: "Menor número de chamadas atendidas" };
  const queueOptions = queues.length
    ? queues.map((queue, index) => option(queue.id, queues[0]?.id || "", `${queueLabel(queue, index)} (${queue.id})`)).join("")
    : `<option value="">Nenhuma fila cadastrada</option>`;
  const extensionOptions = state.config.extensions.map((ext) => option(ext.number, state.config.extensions[0]?.number || "", `${ext.number} ${ext.name}`)).join("");
  const fallbackOptions = finalDestinationChoices();
  const editingIndex = Number.isInteger(state.editingQueueIndex) && queues[state.editingQueueIndex] ? state.editingQueueIndex : null;
  const editing = editingIndex === null ? null : queues[editingIndex];
  const queueCards = queues.map((queue, index) => `
    <article class="panel entity-list-card" data-queue-summary-index="${index}">
      <div class="panel-header compact-card-header">
        <div>
          <p class="eyebrow">Fila de atendimento</p>
          <h3>${escapeHtml(queue.name || queue.id)}</h3>
          <p class="microcopy">${escapeHtml(queue.id || "fila")} · Ramal ${escapeHtml(queueDialNumber(queue, index))} · ${escapeHtml(queueStrategyLabel(queue.strategy || "ringall"))}</p>
        </div>
        <span class="badge ok">${(queue.members || []).length} agente(s)</span>
      </div>
      <div class="list-card-meta">
        <span><strong>Agentes</strong>${escapeHtml((queue.members || []).join(", ") || "Nenhum cadastrado")}</span>
        <span><strong>Espera maxima</strong>${escapeHtml(`${queue.maxWait || 0}s`)}</span>
        <span><strong>Destino final</strong>${escapeHtml(queue.fallbackType === "queue" && queue.fallback ? destinationLabel("queue", queue.fallback) : "Nenhum")}</span>
      </div>
      <div class="compact-card-actions">
        <button class="primary-btn compact" data-edit-queue="${index}" type="button"><i data-lucide="pencil"></i>Editar</button>
        <button class="icon-btn danger" data-remove-queue="${index}" type="button" title="Excluir fila"><i data-lucide="trash-2"></i></button>
      </div>
    </article>`).join("");
  const memberChips = editing ? (editing.members || []).map((member) => {
    const ext = state.config.extensions.find((item) => item.number === member);
    return `<span class="member-chip"><strong>${escapeHtml(member)}</strong><small>${escapeHtml(ext?.name || "Ramal")}</small><button type="button" data-remove-queue-member="${editingIndex}" data-member="${escapeHtml(member)}" title="Remover ramal"><i data-lucide="x"></i></button></span>`;
  }).join("") : "";
  const editor = editing ? `
    <section class="panel entity-editor-shell">
      <div class="panel-header entity-editor-header">
        <div><p class="eyebrow">Editar fila</p><h3>${escapeHtml(editing.name || editing.id)}</h3><p class="microcopy">Edite somente esta fila. As alteracoes ficam em rascunho ate salvar e aplicar.</p></div>
        <div class="compact-card-actions"><button class="secondary-btn" data-cancel-queue-edit type="button"><i data-lucide="arrow-left"></i>Voltar para lista</button><button class="icon-btn danger" data-remove-queue="${editingIndex}" type="button" title="Excluir fila"><i data-lucide="trash-2"></i></button></div>
      </div>
      <section class="panel queue-config-card" data-queue-index="${editingIndex}" data-entity-editor>
        <div class="field-grid compact-field-grid">
          ${fieldBlock("Nome", "Nome amigavel da fila.", `<input data-key="name" value="${escapeHtml(editing.name || "")}" />`)}
          ${fieldBlock("Codigo", "Identificador usado pelo Asterisk para esta fila.", `<input data-key="id" value="${escapeHtml(editing.id || "")}" />`)}
          ${fieldBlock("Ramal da fila", "Numero virtual para transferir chamadas diretamente para esta fila.", `<input data-key="number" inputmode="numeric" value="${escapeHtml(queueDialNumber(editing, editingIndex))}" />`)}
          ${fieldBlock("Agentes", "Ramais que devem aparecer online nesta fila quando estiverem registrados no SIP.", `<input data-key="members" value="${escapeHtml((editing.members || []).join(", "))}" />`, "wide")}
        </div>
        <div class="field-grid compact-field-grid">
          ${fieldBlock("Estratégia", "Define como a fila distribui chamadas entre os agentes.", `<select data-key="strategy">${queueStrategies.map((item) => option(item, editing.strategy, strategyLabels[item])).join("")}</select>`)}
          ${fieldBlock("Timeout", "Tempo maximo que cada agente toca por tentativa.", `<input data-key="timeout" type="number" value="${escapeHtml(editing.timeout ?? 20)}" />`)}
          ${fieldBlock("Espera maxima", "Tempo maximo de fila antes de mandar para o destino final.", `<input data-key="maxWait" type="number" value="${escapeHtml(editing.maxWait ?? 300)}" />`)}
          ${fieldBlock("Destino final", "Outra fila apos a espera maxima. Nenhum encerra a chamada sem encaminhamento.", `<select data-key="fallbackDestination">${finalDestinationChoices(editing, editing.id)}</select>`)}
        </div>
        <div class="member-chip-row">${memberChips || `<span class="hint">Nenhum ramal nesta fila. Use o campo Agentes ou a acao de adicionar na lista.</span>`}</div>
      </section>
    </section>` : `
    <section class="panel">
      <div class="panel-header"><div><p class="eyebrow">Telefonia</p><h3>Filas de atendimento</h3><p class="microcopy">Consulte as filas cadastradas e abra somente a fila que deseja editar.</p></div><button id="createQueueBtn" class="primary-btn" type="button"><i data-lucide="plus"></i>Nova fila</button></div>
      <div class="entity-list-grid">${queueCards || `<div class="governance-empty"><i data-lucide="headphones"></i><strong>Nenhuma fila cadastrada</strong><span>Cadastre uma fila para distribuir chamadas.</span></div>`}</div>
    </section>`;
  const auxiliary = editing ? "" : `
    <section class="panel queue-auxiliary-panel">
      <div class="panel-header"><h3>Adicionar ramal em uma fila</h3><span class="badge">${queues.length} filas</span></div>
      <div class="inline-form queue-add-form"><label>Fila<select id="queueMemberQueue">${queueOptions}</select></label><label>Ramal<select id="queueMemberExtension">${extensionOptions}</select></label><button id="addQueueMemberBtn" class="primary-btn" type="button"><i data-lucide="user-plus"></i>Adicionar</button></div>
    </section>
    <section class="panel queue-auxiliary-panel"><div class="panel-header"><h3>Grupo de toque da recepcao</h3><span class="badge">${escapeHtml(queueStrategyLabel(ring.strategy))}</span></div><div class="field-grid" data-scope="ring">
      ${fieldBlock("Membros", "Ramais que vao tocar juntos. Separe por virgula.", `<input data-key="members" value="${escapeHtml((ring.members || []).join(", "))}" />`, "wide")}
      ${fieldBlock("Tempo de toque", "Quanto tempo o grupo tenta tocar antes de cair no destino final.", `<input data-key="timeout" type="number" value="${escapeHtml(ring.timeout)}" />`)}
      ${fieldBlock("Destino final", "Fila que recebe a chamada se ninguem atender o grupo. Nenhum encerra a chamada.", `<select data-key="fallbackDestination">${finalDestinationChoices(ring)}</select>`)}
    </div></section>`;
  pages.queues.innerHTML = `<div class="section-grid">${editing ? editor : `${editor}${auxiliary}`}</div>`;
}

function renderSecurity() {
  const sec = state.config.security;
  const hours = state.config.businessHours;
  const status = state.pbxStatus;
  const registeredExtensions = (status?.extensions || []).filter((ext) => ext.registered).length;
  const totalExtensions = state.config.extensions.length;
  const trunkStatus = status?.trunk?.registration?.status || "Nao verificado";
  const trunkTone = statusTone(trunkStatus === "Registered", trunkStatus);

  pages.security.innerHTML = `
    <div class="section-grid">
      <section class="panel full">
        <div class="panel-header">
          <h3>Saude SIP</h3>
          <span class="badge ${trunkTone}">Tronco ${escapeHtml(trunkStatus)}</span>
        </div>
        <div class="trunk-strip">
          <span><strong>Ramais online</strong>${monitorNumber(registeredExtensions)}/${monitorNumber(totalExtensions)}</span>
          <span><strong>Servidor SIP</strong>${escapeHtml(status?.trunk?.server || state.config.trunk.sipServer || "-")}</span>
          <span><strong>Registro</strong>${escapeHtml(status?.trunk?.registration?.server || "Sem registro carregado")}</span>
          <span><strong>Expira em</strong>${escapeHtml(status?.trunk?.registration?.expires || "-")}</span>
        </div>
      </section>

      <section class="panel half">
        <div class="panel-header"><h3>Protecoes SIP</h3><span class="badge">${sec.fail2banEnabled ? "Fail2Ban" : "Manual"}</span></div>
        <div class="check-row" data-scope="securityChecks">
          ${[
            ["requireStrongPasswords", "Senhas fortes"],
            ["blockInternationalByDefault", "Bloquear internacional"],
            ["firewallEnabled", "Firewall"],
            ["fail2banEnabled", "Fail2Ban"],
            ["tlsEnabled", "TLS"],
            ["srtpEnabled", "SRTP"]
          ]
            .map(([key, label]) => `<label class="check-pill"><input data-key="${key}" type="checkbox" ${sec[key] ? "checked" : ""} />${label}</label>`)
            .join("")}
        </div>
        <div class="field-grid" data-scope="security">
          ${fieldBlock("Redes SIP permitidas", "Informe os IPs ou redes de onde os ramais podem conectar pelo aplicativo ou navegador, separados por vírgula. Uma lista vazia bloqueia novas conexões de voz.", `<input data-key="allowedSipNetworks" value="${escapeHtml((sec.allowedSipNetworks || []).join(", "))}" />`, "wide")}
          ${fieldBlock("Endereco publico", "IP publico do seu servidor PBX. Importante quando ha NAT.", `<input data-key="publicAddress" value="${escapeHtml(sec.publicAddress || "")}" placeholder="Ex: ${escapeHtml(location.hostname)}" />`, "wide")}
          ${fieldBlock("Redes locais/NAT", "Redes internas usadas para o Asterisk distinguir trafego local do externo.", `<input data-key="localNetworks" value="${escapeHtml((sec.localNetworks || []).join(", "))}" />`, "wide")}
          ${fieldBlock("RTP inicio", "Primeira porta da faixa de audio RTP.", `<input data-key="rtpPortStart" type="number" value="${escapeHtml(sec.rtpPortStart)}" />`)}
          ${fieldBlock("RTP fim", "Ultima porta da faixa de audio RTP.", `<input data-key="rtpPortEnd" type="number" value="${escapeHtml(sec.rtpPortEnd)}" />`)}
        </div>
      </section>
      <section class="panel half">
        <div class="panel-header"><h3>Horario comercial</h3><span class="badge">${hours.enabled ? "Ativo" : "Inativo"}</span></div>
        <div class="field-grid" data-scope="hours">
          ${fieldBlock("Ativo", "Liga ou desliga a regra de horario comercial.", `<select data-key="enabled">${option("true", String(hours.enabled), "Sim")}${option("false", String(hours.enabled), "Nao")}</select>`)}
          ${fieldBlock("Inicio", "Hora em que o atendimento normal comeca.", `<input data-key="start" type="time" value="${escapeHtml(hours.start)}" />`)}
          ${fieldBlock("Fim", "Hora em que o atendimento normal termina.", `<input data-key="end" type="time" value="${escapeHtml(hours.end)}" />`)}
          ${fieldBlock("Dias", "Dias em que a empresa atende normalmente. Separe por virgula.", `<input data-key="weekdays" value="${escapeHtml((hours.weekdays || []).join(", "))}" />`, "wide")}
          ${fieldBlock("Tipo fora horario", "Define para onde a chamada vai fora do horario comercial.", `<select data-key="afterHoursDestinationType">${["none", "ivr", "extension", "ringGroup", "queue"].map((item) => option(item, hours.afterHoursDestinationType, item === "none" ? "Nenhum" : item)).join("")}</select>`)}
          ${fieldBlock("Destino fora horario", "Numero do ramal, fila ou grupo usado fora do horario.", `<input data-key="afterHoursDestination" value="${escapeHtml(hours.afterHoursDestination)}" />`)}
        </div>
      </section>
    </div>
  `;
}

function logFriendlyMessage(message = "") {
  const text = String(message || "");
  if (/wrong password|authentication failed|failed to authenticate/i.test(text)) return "Falha de autenticacao. Confira usuario e senha do ramal/tronco.";
  if (/no matching endpoint|not found/i.test(text)) return "Origem nao reconhecida pelo Asterisk. Confira ramal, tronco ou IP permitido.";
  if (/registered|added contact/i.test(text)) return "Registro SIP realizado com sucesso.";
  if (/unregistered|removed contact/i.test(text)) return "Registro SIP desconectado.";
  if (/timeout|timed out/i.test(text)) return "Sem resposta no tempo esperado. Verifique rede, NAT ou firewall.";
  if (/SecurityEvent=.*RequestNotSupported/i.test(text)) return "Solicitacao SIP nao suportada foi recusada.";
  if (/SecurityEvent=/i.test(text)) return "Evento de seguranca SIP registrado.";
  if (text.length > 140) return "Evento tecnico do Asterisk registrado.";
  return text || "-";
}

function renderLogs() {
  if (!pages.logs) return;
  const status = state.pbxStatus || {};
  const extensions = status.extensions || [];
  const activeCallCount = new Set((status.activeChannels || []).map((channel) => channel.linkedId || channel.uniqueId || channel.channel).filter(Boolean)).size;
  const sipEvents = (status.logs || []).map((log) => ({
    source: "sip",
    time: log.time || "",
    outcome: log.outcome || "info",
    title: logFriendlyMessage(log.message),
    raw: log.message || "",
    extension: log.extension || "",
    destination: log.ip || ""
  }));
  const outboundEvents = (state.outboundDiagnostics?.logs || []).map((item) => ({
    source: "outbound",
    time: item.time || "",
    outcome: item.status || "info",
    title: logFriendlyMessage(item.message),
    raw: item.message || "",
    extension: item.extension || "",
    destination: item.dialed || ""
  }));
  const allEvents = [...outboundEvents, ...sipEvents];
  const attentionCount = allEvents.filter((item) => ["erro", "error", "warn", "warning"].includes(String(item.outcome).toLowerCase())).length;
  const scope = state.systemView.scope || "all";
  const visibleEvents = allEvents
    .filter((item) => {
      if (scope === "sip" || scope === "outbound") return item.source === scope;
      if (scope === "attention") return ["erro", "error", "warn", "warning"].includes(String(item.outcome).toLowerCase());
      return true;
    })
    .slice(0, 60);
  const eventRows = visibleEvents
    .map((item) => {
      const outcome = String(item.outcome || "info").toLowerCase();
      const tone = outcome === "ok" ? "ok" : ["erro", "error"].includes(outcome) ? "error" : "warn";
      const sourceLabel = item.source === "sip" ? "Registro SIP" : "Chamada de saida";
      return `
        <article class="system-event-row ${tone}">
          <div class="system-event-icon"><i data-lucide="${item.source === "sip" ? "radio" : "phone-outgoing"}"></i></div>
          <div class="system-event-main">
            <strong>${escapeHtml(item.title)}</strong>
            <span>${escapeHtml(sourceLabel)} | ${escapeHtml(item.extension ? `Ramal ${item.extension}` : "Sem ramal")} ${item.destination ? `| ${escapeHtml(item.destination)}` : ""}</span>
            ${item.raw && item.raw !== item.title ? `<details><summary>Detalhe tecnico</summary><code>${escapeHtml(item.raw)}</code></details>` : ""}
          </div>
          <div class="system-event-meta"><span class="badge ${tone}">${escapeHtml(item.outcome || "info")}</span><time>${escapeHtml(item.time || "-")}</time></div>
        </article>`;
    })
    .join("");
  const trunkRegistered = status.trunk?.registration?.status === "Registered";
  const checkedAt = status.checkedAt ? formatDateTime(status.checkedAt) : "Aguardando leitura";

  pages.logs.innerHTML = `
    <div class="governance-shell">
      <section class="governance-summary">
        ${[
          ["Asterisk", status.checkedAt ? "Operacional" : "Sem leitura", "server", status.checkedAt ? "ok" : "warn"],
          ["Tronco principal", trunkRegistered ? "Registrado" : status.trunk?.registration?.status || "Nao verificado", "radio-tower", trunkRegistered ? "ok" : "warn"],
          ["Ramais online", `${extensions.filter((extension) => extension.registered).length}/${extensions.length}`, "phone", "ok"],
          ["Chamadas ativas", activeCallCount, "phone-call", activeCallCount ? "info" : ""]
        ]
          .map(([label, value, icon, tone]) => `<div class="governance-kpi ${tone}"><i data-lucide="${icon}"></i><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
          .join("")}
      </section>
      <section class="panel system-health-panel">
        <div class="panel-header">
          <div><h3>Saude do sistema</h3><p class="table-meta">Ultima leitura: ${escapeHtml(checkedAt)}</p></div>
          <div class="governance-actions">
            <button class="secondary-btn" data-tab="audit" type="button"><i data-lucide="history"></i>Ver auditoria</button>
            <button id="refreshTechnicalLogsBtn" class="primary-btn" type="button"><i data-lucide="rotate-cw"></i>Atualizar</button>
          </div>
        </div>
        <div class="system-health-strip">
          <span><strong>Servidor SIP</strong>${escapeHtml(status.trunk?.server || state.config.trunk?.sipServer || "-")}</span>
          <span><strong>Eventos recentes</strong>${monitorNumber(allEvents.length)}</span>
          <span><strong>Precisam de atencao</strong>${monitorNumber(attentionCount)}</span>
          <span><strong>Filas carregadas</strong>${monitorNumber((status.queues || []).length)}</span>
        </div>
      </section>
      <section class="panel system-events-panel">
        <div class="panel-header">
          <div><h3>Eventos recentes</h3><p class="table-meta">Mensagem principal simplificada; o detalhe tecnico fica recolhido.</p></div>
          <div class="segmented-control compact" role="group" aria-label="Filtrar eventos do sistema">
            ${[["all", "Todos"], ["attention", "Atencao"], ["sip", "SIP"], ["outbound", "Saida"]]
              .map(([key, label]) => `<button type="button" data-system-scope="${key}" class="${scope === key ? "active" : ""}">${escapeHtml(label)}</button>`)
              .join("")}
          </div>
        </div>
        <div class="system-event-list">${eventRows || `<div class="governance-empty"><i data-lucide="circle-check-big"></i><strong>Nenhum evento neste filtro</strong><span>O sistema nao registrou ocorrencias para esta visualizacao.</span></div>`}</div>
      </section>
    </div>`;
}

function renderReports() {
  const reports = state.pbxReports;
  const filters = reports.filters || {};
  const dashboard = reports.dashboard || {};
  const charts = reports.charts || {};
  const meta = reports.meta || {};
  const permissions = meta.permissions || {};
  const statCards = [
    ["Total de chamadas", dashboard.total || 0, "phone-call", "neutral"],
    ["Atendidas", dashboard.answered || 0, "phone-call", "success"],
    ["Nao atendidas", dashboard.noAnswer || 0, "phone-missed", "warn"],
    ["Perdidas", dashboard.missed || 0, "phone-off", "danger"],
    ["Ocupadas", dashboard.busy || 0, "circle-slash", "warn"],
    ["Rejeitadas", dashboard.rejected || 0, "shield-x", "danger"],
    ["Entrada", dashboard.inbound || 0, "phone-incoming", "info"],
    ["Saida", dashboard.outbound || 0, "phone-outgoing", "info"],
    ["Internas", dashboard.internal || 0, "repeat-2", "neutral"],
    ["TME", formatSeconds(dashboard.averageAnswerTime || 0), "timer", "neutral"],
    ["TMA", formatSeconds(dashboard.averageCallTime || 0), "clock-3", "neutral"],
    ["Gravacoes", dashboard.recordings || 0, "mic", "success"]
  ]
    .map(
      ([label, value, icon, tone]) => `
      <section class="report-stat ${tone}">
        <i data-lucide="${icon}"></i>
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
      </section>`
    )
    .join("");

  const optionFrom = (items, selected, emptyLabel) =>
    `<option value="">${emptyLabel}</option>${items.map((item) => option(item, selected)).join("")}`;
  const queueOptions = `<option value="">Todas</option>${(state.config.queues || []).map((queue, index) => option(queue.id || queue.number || queueLabel(queue, index), filters.queue || "", queueLabel(queue, index))).join("")}`;
  const activeFilterCount = Object.values(filters).filter((value) => String(value || "") !== "").length;
  const compactOpen = reports.compactOpen || {};

  const presenceRows = (reports.presence || [])
    .map(
      (extension) => `
        <tr>
          <td><span class="status-dot ${extension.currentOnline ? "ok" : "warn"}"></span></td>
          <td><strong>${escapeHtml(extension.number || "-")}</strong><br><span class="hint">${escapeHtml(extension.name || "")}</span></td>
          <td>${extension.currentOnline ? '<span class="badge ok">Online agora</span>' : '<span class="badge warn">Offline agora</span>'}</td>
          <td>${escapeHtml(extension.onlineDurationLabel || "-")}</td>
          <td>${escapeHtml(extension.department || "-")}</td>
        </tr>`
    )
    .join("");

  const pauseSummaryRows = (reports.pauses?.summary || [])
    .map((item) => `
        <tr>
          <td><strong>${escapeHtml(item.extension || "-")}</strong><br><span class="hint">${escapeHtml(item.extensionName || "")}</span></td>
          <td>${escapeHtml(item.department || "-")}</td>
          <td><strong>${monitorNumber(item.count || 0)}</strong></td>
          <td>${escapeHtml(item.reasonList || "-")}</td>
          <td><strong>${escapeHtml(item.totalLabel || "0s")}</strong></td>
        </tr>`)
    .join("");
  const pauseDetailRows = (reports.pauses?.events || [])
    .slice(0, 80)
    .map((item) => `
        <tr>
          <td>${escapeHtml(formatDateTime(item.startedAt))}</td>
          <td>${item.active ? '<span class="badge warn">Em pausa</span>' : escapeHtml(formatDateTime(item.endedAt))}</td>
          <td><strong>${escapeHtml(item.extension || "-")}</strong><br><span class="hint">${escapeHtml(item.extensionName || "")}</span></td>
          <td>${escapeHtml(item.reason || "-")}</td>
          <td><strong>${escapeHtml(item.durationLabel || "0s")}</strong></td>
        </tr>`)
    .join("");

  const barChart = (title, items = [], icon = "bar-chart-3") => {
    const max = Math.max(1, ...items.map((item) => Number(item.value) || 0));
    return `
      <section class="panel report-chart">
        <div class="panel-header"><h3><i data-lucide="${icon}"></i>${escapeHtml(title)}</h3><span class="badge">${items.length}</span></div>
        <div class="chart-bars">
          ${
            items.length
              ? items
                  .map(
                    (item) => `
            <div class="chart-row">
              <span>${escapeHtml(item.label)}</span>
              <div><i style="width:${Math.max(4, Math.round((Number(item.value) / max) * 100))}%"></i></div>
              <strong>${escapeHtml(item.value)}</strong>
            </div>`
                  )
                  .join("")
              : `<p class="empty-state">Sem dados para este grafico.</p>`
          }
        </div>
      </section>`;
  };

  const rows = (reports.calls || [])
    .map((call) => {
      const tone = reportStatusTone(call.status);
      const listenButton = call.recordingExists
        ? `<button class="secondary-btn compact" data-listen-recording="${escapeHtml(call.uniqueId)}"><i data-lucide="headphones"></i>Escutar</button>`
        : `<span class="hint">Sem gravacao</span>`;
      const downloadButton =
        call.recordingExists && permissions.canDownloadRecordings
          ? `<a class="icon-link" href="/api/pbx/recordings/${encodeURIComponent(call.uniqueId)}/download" title="Baixar gravacao"><i data-lucide="download"></i></a>`
          : "";
      return `
        <tr>
          <td class="report-time-cell">
            <strong>${escapeHtml(formatDateTime(call.startedAt))}</strong>
          </td>
          <td><strong>${escapeHtml(call.protocol || "-")}</strong></td>
          <td><strong>${escapeHtml(call.source || "-")}</strong></td>
          <td><strong>${escapeHtml(call.destination || "-")}</strong></td>
          <td class="report-service-cell">
            <div class="report-main-line">
              <strong>${escapeHtml(call.extension || "-")}</strong>
              <span class="badge"><i data-lucide="${reportTypeIcon(call.type)}"></i>${escapeHtml(call.typeLabel)}</span>
            </div>
            <span class="hint">${escapeHtml(call.extensionName || call.department || "-")}</span>
          </td>
          <td>
            <span class="badge ${tone}">${escapeHtml(call.statusLabel)}</span>
          </td>
          <td><strong>${escapeHtml(call.durationLabel)}</strong></td>
          <td>
            <span class="report-recording-state ${call.recordingExists ? "ok" : "warn"}">${call.recordingExists ? "Sim" : "Nao"}</span>
          </td>
          <td class="actions-cell">
            ${listenButton}
            ${downloadButton}
            <button class="icon-btn" data-call-details="${escapeHtml(call.id)}" title="Detalhes"><i data-lucide="eye"></i></button>
          </td>
        </tr>`;
    })
    .join("");

  pages.reports.innerHTML = `
    <div class="reports-shell">
      <section class="reports-hero">
        <div>
          <p class="eyebrow">Relatorios PBX</p>
          <h3>Relatório de chamadas</h3>
        </div>
        <div class="report-actions">
          <a class="secondary-btn" href="${downloadUrl("/api/pbx/reports/export/csv")}"><i data-lucide="file-text"></i>CSV</a>
          <a class="secondary-btn" href="${downloadUrl("/api/pbx/reports/export/xlsx")}"><i data-lucide="table"></i>Excel</a>
          <a class="primary-btn" href="${downloadUrl("/api/pbx/reports/export/pdf")}"><i data-lucide="file-down"></i>PDF</a>
        </div>
      </section>

      <section class="panel report-filters">
        <div class="panel-header">
          <div>
            <h3>Filtros</h3>
            <p class="table-meta">${activeFilterCount ? `${activeFilterCount} filtro${activeFilterCount > 1 ? "s" : ""} ativo${activeFilterCount > 1 ? "s" : ""}` : "Busca rapida sem abrir os campos tecnicos."}</p>
          </div>
          <button id="toggleReportFiltersBtn" class="secondary-btn"><i data-lucide="${reports.filtersOpen ? "chevron-up" : "sliders-horizontal"}"></i>${reports.filtersOpen ? "Ocultar avancado" : "Filtro avancado"}</button>
        </div>
        <div class="report-simple-filters">
          <label>Data inicial<input data-report-filter="dateStart" type="date" value="${escapeHtml(filters.dateStart || "")}" /></label>
          <label>Data final<input data-report-filter="dateEnd" type="date" value="${escapeHtml(filters.dateEnd || "")}" /></label>
          <label>Tipo<select data-report-filter="type">${optionFrom(["inbound", "outbound", "internal"], filters.type || "", "Todos")}</select></label>
          <label>Status<select data-report-filter="status">${optionFrom(["answered", "no_answer", "busy", "failed", "canceled", "rejected"], filters.status || "", "Todos")}</select></label>
          <label>Gravacao<select data-report-filter="recording">${option("", filters.recording || "", "Todas")}${option("with", filters.recording || "", "Com gravacao")}${option("without", filters.recording || "", "Sem gravacao")}</select></label>
          <label class="search">Pesquisar<input data-report-filter="q" value="${escapeHtml(filters.q || "")}" placeholder="Protocolo, origem, destino, ramal..." /></label>
        </div>
        <div class="report-advanced-filters ${reports.filtersOpen ? "" : "hidden"}">
          <div class="field-grid compact-grid">
            <label>Hora inicial<input data-report-filter="timeStart" type="time" value="${escapeHtml(filters.timeStart || "")}" /></label>
            <label>Hora final<input data-report-filter="timeEnd" type="time" value="${escapeHtml(filters.timeEnd || "")}" /></label>
            <label>Origem<input data-report-filter="source" value="${escapeHtml(filters.source || "")}" /></label>
            <label>Destino<input data-report-filter="destination" value="${escapeHtml(filters.destination || "")}" /></label>
            <label>Ramal<input data-report-filter="extension" value="${escapeHtml(filters.extension || "")}" /></label>
            <label>Nome do usuario<input data-report-filter="extensionName" value="${escapeHtml(filters.extensionName || "")}" /></label>
          <label>Tronco SIP<input data-report-filter="trunk" value="${escapeHtml(filters.trunk || "")}" /></label>
          <label>Fila<select data-report-filter="queue">${queueOptions}</select></label>
          <label>DID<input data-report-filter="did" value="${escapeHtml(filters.did || "")}" /></label>
          <label>Duracao minima<input data-report-filter="minDuration" type="number" min="0" value="${escapeHtml(filters.minDuration || "")}" /></label>
          <label>Duracao maxima<input data-report-filter="maxDuration" type="number" min="0" value="${escapeHtml(filters.maxDuration || "")}" /></label>
          <label>Protocolo<input data-report-filter="protocol" value="${escapeHtml(filters.protocol || "")}" /></label>
          <label>Unique ID<input data-report-filter="uniqueId" value="${escapeHtml(filters.uniqueId || "")}" /></label>
          <label>Caller ID<input data-report-filter="callerId" value="${escapeHtml(filters.callerId || "")}" /></label>
          <label>Grupo/departamento<input data-report-filter="department" value="${escapeHtml(filters.department || "")}" /></label>
          <label>Menu URA<input data-report-filter="ivrMenu" value="${escapeHtml(filters.ivrMenu || "")}" placeholder="Ex.: main" /></label>
          <label>Opcao URA<input data-report-filter="ivrOption" value="${escapeHtml(filters.ivrOption || "")}" placeholder="Digito, timeout ou invalid" /></label>
          </div>
        </div>
        <div class="filter-actions">
          <button id="applyReportFiltersBtn" class="primary-btn"><i data-lucide="search"></i>Aplicar filtros</button>
          <button id="clearReportFiltersBtn" class="secondary-btn"><i data-lucide="x"></i>Limpar filtros</button>
        </div>
      </section>

      <section class="report-stat-grid">${statCards}</section>

      <section class="panel report-collapsible ${compactOpen.presence ? "open" : ""}">
        <div class="panel-header">
          <div>
            <h3>Tempo online dos ramais</h3>
            <p class="table-meta">Soma do tempo registrado dentro do periodo filtrado.</p>
          </div>
          <button class="secondary-btn" data-toggle-report-section="presence"><i data-lucide="${compactOpen.presence ? "chevron-up" : "chevron-down"}"></i>${compactOpen.presence ? "Recolher" : "Expandir"}</button>
        </div>
        <div class="table-wrap collapsible-body">
          <table>
            <thead><tr><th></th><th>Ramal</th><th>Status atual</th><th>Tempo online no periodo</th><th>Setor</th></tr></thead>
            <tbody>${presenceRows || `<tr><td colspan="5">Nenhum historico de presenca carregado para o periodo.</td></tr>`}</tbody>
          </table>
        </div>
      </section>

      <section class="panel report-collapsible ${compactOpen.pauses ? "open" : ""}">
        <div class="panel-header">
          <div>
            <h3>Relatorio de pausas por ramal</h3>
            <p class="table-meta">Quantidade, motivos e tempo de pausa dentro do periodo filtrado.</p>
          </div>
          <button class="secondary-btn" data-toggle-report-section="pauses"><i data-lucide="${compactOpen.pauses ? "chevron-up" : "chevron-down"}"></i>${compactOpen.pauses ? "Recolher" : "Expandir"}</button>
        </div>
        <div class="collapsible-body">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Ramal</th><th>Setor</th><th>Qtd.</th><th>Motivos</th><th>Tempo total</th></tr></thead>
              <tbody>${pauseSummaryRows || `<tr><td colspan="5">Nenhuma pausa registrada para o periodo.</td></tr>`}</tbody>
            </table>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Inicio</th><th>Fim</th><th>Ramal</th><th>Motivo</th><th>Duracao</th></tr></thead>
              <tbody>${pauseDetailRows || `<tr><td colspan="5">Sem detalhes de pausa para exibir.</td></tr>`}</tbody>
            </table>
          </div>
        </div>
      </section>

      <div class="section-grid report-collapsible ${compactOpen.charts ? "open" : ""}">
        <section class="panel report-section-toggle">
          <div class="panel-header">
            <h3>Graficos</h3>
            <button class="secondary-btn" data-toggle-report-section="charts"><i data-lucide="${compactOpen.charts ? "chevron-up" : "chevron-down"}"></i>${compactOpen.charts ? "Recolher" : "Expandir"}</button>
          </div>
        </section>
        <div class="collapsible-body report-chart-grid">
        ${barChart("Chamadas por dia", charts.byDay || [], "calendar-days")}
        ${barChart("Chamadas por hora", charts.byHour || [], "clock")}
        ${barChart("Chamadas por ramal", charts.byExtension || [], "phone")}
        ${barChart("Chamadas por status", charts.byStatus || [], "badge-check")}
        ${barChart("Chamadas por tronco", charts.byTrunk || [], "radio-tower")}
        ${barChart("Entrada x saida", charts.byType || [], "arrow-left-right")}
        </div>
      </div>

      <section class="panel report-collapsible ${compactOpen.calls !== false ? "open" : ""}">
        <div class="panel-header report-table-header">
          <div>
            <h3>Relatorio detalhado de chamadas</h3>
            <p class="table-meta">${reports.loading ? "Carregando..." : `${meta.total || 0} registros encontrados`}</p>
          </div>
          <div class="report-header-actions">
            <button id="reloadReportsBtn" class="secondary-btn"><i data-lucide="rotate-cw"></i>Atualizar</button>
            <button class="secondary-btn" data-toggle-report-section="calls"><i data-lucide="${compactOpen.calls !== false ? "chevron-up" : "chevron-down"}"></i>${compactOpen.calls !== false ? "Recolher" : "Expandir"}</button>
          </div>
        </div>
        <div class="table-wrap report-calls-wrap collapsible-body">
          <table class="calls-table">
            <thead>
              <tr>
                <th><button data-report-sort="startedAt">Data</button></th>
                <th>Protocolo</th>
                <th>Origem</th>
                <th>Destino</th>
                <th>Ramal</th>
                <th>Status</th>
                <th><button data-report-sort="duration">Duracao</button></th>
                <th>Gravacao</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody>${rows || `<tr><td colspan="9"><div class="empty-state">Nenhuma chamada encontrada para os filtros aplicados.</div></td></tr>`}</tbody>
          </table>
        </div>
        <div class="pagination">
          <button class="secondary-btn" data-report-page="${Math.max(1, Number(meta.page || 1) - 1)}" ${Number(meta.page || 1) <= 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i>Anterior</button>
          <span>Pagina ${escapeHtml(meta.page || 1)} de ${escapeHtml(meta.pages || 1)}</span>
          <button class="secondary-btn" data-report-page="${Math.min(Number(meta.pages || 1), Number(meta.page || 1) + 1)}" ${Number(meta.page || 1) >= Number(meta.pages || 1) ? "disabled" : ""}>Proxima<i data-lucide="chevron-right"></i></button>
        </div>
      </section>
    </div>
  `;
}

function auditActionLabel(event) {
  const labels = {
    "config-update": "Configuracao atualizada",
    "users-update": "Usuarios atualizados",
    "ivr-audio-delete": "Audio da URA excluido",
    "monitor-transfer-waiting": "Chamada em espera transferida",
    "monitor-hangup-channel": "Chamada encerrada pelo monitor",
    "monitor-spy": "Escuta iniciada pelo monitor",
    "monitor-whisper": "Sussurro iniciado pelo monitor",
    "monitor-barge": "Intervencao iniciada pelo monitor",
    listen: "Gravacao escutada",
    download: "Gravacao baixada"
  };
  return event.label || labels[event.action] || event.action || "-";
}

function auditPreview(value) {
  if (value === undefined || value === null || value === "") return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    const text = JSON.stringify(value);
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  } catch (_error) {
    return String(value);
  }
}

function renderAuditChanges(event) {
  const changes = Array.isArray(event.changes) ? event.changes.filter(Boolean).slice(0, 8) : [];
  if (changes.length) {
    return `
      <div class="audit-change-list">
        ${changes
          .map(
            (change) => `
              <div class="audit-change">
                <strong>${escapeHtml(change.field || "campo")}</strong>
                <span><b>Antes:</b> ${escapeHtml(auditPreview(change.before))}</span>
                <span><b>Depois:</b> ${escapeHtml(auditPreview(change.after))}</span>
              </div>`
          )
          .join("")}
      </div>
    `;
  }
  if (event.before !== undefined || event.after !== undefined) {
    return `
      <div class="audit-before-after">
        <span><b>Antes:</b> ${escapeHtml(auditPreview(event.before))}</span>
        <span><b>Depois:</b> ${escapeHtml(auditPreview(event.after))}</span>
      </div>
    `;
  }
  return "";
}

function auditEventGroup(event = {}) {
  const action = String(event.action || "").toLowerCase();
  if (action === "listen" || action === "download") return "recordings";
  if (action.startsWith("monitor-")) return "monitoring";
  if (action.includes("config") || action.includes("users") || action.includes("ivr-audio")) return "configuration";
  return "other";
}

function auditEventPresentation(event = {}) {
  const group = auditEventGroup(event);
  if (group === "recordings") return { icon: "file-audio", tone: "info", label: "Gravacoes" };
  if (group === "monitoring") return { icon: "headphones", tone: "warn", label: "Monitoramento" };
  if (group === "configuration") return { icon: "settings-2", tone: "ok", label: "Configuracao" };
  return { icon: "activity", tone: "", label: "Outros" };
}

function auditEventSummary(event = {}) {
  return [
    event.summary || event.details || "",
    event.source && event.destination ? `${event.source} -> ${event.destination}` : "",
    event.target ? `Ramal ${event.target}` : "",
    Array.isArray(event.sections) && event.sections.length ? `Areas: ${event.sections.join(", ")}` : ""
  ].filter(Boolean).join(" | ") || "Evento registrado sem descricao adicional.";
}

function collectAuditFiltersFromDom() {
  const filters = {};
  $all("[data-audit-filter]", pages.audit).forEach((input) => {
    if (input.value !== "") filters[input.dataset.auditFilter] = input.value;
  });
  return filters;
}

function renderAudit() {
  const view = state.auditView || { page: 1, pageSize: 20, filters: {} };
  const filters = view.filters || {};
  const allEvents = [...(state.auditEvents || [])].sort((a, b) => {
    const left = new Date(a.accessedAt || a.at || a.updatedAt || 0).getTime() || 0;
    const right = new Date(b.accessedAt || b.at || b.updatedAt || 0).getTime() || 0;
    return right - left;
  });
  const filteredEvents = allEvents.filter((event) => {
    const group = auditEventGroup(event);
    const actor = String(event.user || "");
    const timestamp = new Date(event.accessedAt || event.at || event.updatedAt || 0);
    if (filters.group && group !== filters.group) return false;
    if (filters.user && actor !== filters.user) return false;
    if (filters.dateStart && (!timestamp.getTime() || timestamp < new Date(`${filters.dateStart}T00:00:00`))) return false;
    if (filters.dateEnd && (!timestamp.getTime() || timestamp > new Date(`${filters.dateEnd}T23:59:59`))) return false;
    if (filters.q) {
      const haystack = [auditActionLabel(event), event.action, auditEventSummary(event), actor, event.role, event.ip, event.callId, event.uniqueId]
        .join(" ")
        .toLowerCase();
      if (!haystack.includes(String(filters.q).toLowerCase())) return false;
    }
    return true;
  });
  const pageSize = Number(view.pageSize) || 20;
  const pagesCount = Math.max(1, Math.ceil(filteredEvents.length / pageSize));
  const page = Math.min(Math.max(1, Number(view.page) || 1), pagesCount);
  state.auditView.page = page;
  const pageEvents = filteredEvents.slice((page - 1) * pageSize, page * pageSize);
  const userOptions = [...new Set(allEvents.map((event) => String(event.user || "")).filter(Boolean))]
    .sort()
    .map((user) => option(user, filters.user || "", user))
    .join("");
  const rows = pageEvents
    .map((event) => {
      const presentation = auditEventPresentation(event);
      const summary = auditEventSummary(event);
      const eventId = event.callId || event.uniqueId || event.id || "";
      const hasTechnicalDetails = Boolean(event.before !== undefined || event.after !== undefined || (event.changes || []).length || event.channel || event.ip || eventId);
      return `
        <article class="audit-event-row">
          <div class="audit-event-icon ${presentation.tone}"><i data-lucide="${presentation.icon}"></i></div>
          <div class="audit-event-content">
            <div class="audit-event-heading">
              <strong>${escapeHtml(auditActionLabel(event))}</strong>
              <span class="badge ${presentation.tone}">${escapeHtml(presentation.label)}</span>
            </div>
            <p>${escapeHtml(summary)}</p>
            <div class="audit-event-byline">
              <span><i data-lucide="user-round"></i>${escapeHtml(event.user || "Sistema")} ${event.role ? `(${escapeHtml(event.role)})` : ""}</span>
              <span><i data-lucide="clock-3"></i>${escapeHtml(formatDateTime(event.accessedAt || event.at || event.updatedAt || ""))}</span>
            </div>
            ${hasTechnicalDetails ? `<details class="audit-technical-details"><summary>Ver detalhes tecnicos</summary><div class="audit-technical-meta"><span><b>Codigo:</b> ${escapeHtml(event.action || "-")}</span><span><b>IP:</b> ${escapeHtml(event.ip || "-")}</span><span><b>Identificador:</b> ${escapeHtml(eventId || "-")}</span>${event.channel ? `<span><b>Canal:</b> ${escapeHtml(event.channel)}</span>` : ""}</div>${renderAuditChanges(event)}</details>` : ""}
          </div>
        </article>`;
    })
    .join("");
  const activeFilterCount = Object.values(filters).filter((value) => String(value || "") !== "").length;
  const today = todayKey();

  pages.audit.innerHTML = `
    <div class="governance-shell audit-shell">
      <section class="governance-summary audit-summary">
        ${[
          ["Eventos registrados", allEvents.length, "history"],
          ["Hoje", allEvents.filter((event) => String(event.accessedAt || event.at || event.updatedAt || "").slice(0, 10) === today).length, "calendar-days"],
          ["Configuracoes", allEvents.filter((event) => auditEventGroup(event) === "configuration").length, "settings-2"],
          ["Monitoramentos", allEvents.filter((event) => auditEventGroup(event) === "monitoring").length, "headphones"]
        ]
          .map(([label, value, icon]) => `<div class="governance-kpi"><i data-lucide="${icon}"></i><span>${escapeHtml(label)}</span><strong>${monitorNumber(value)}</strong></div>`)
          .join("")}
      </section>
      <section class="panel audit-filter-panel">
        <div class="panel-header"><div><h3>Filtrar auditoria</h3><p class="table-meta">${activeFilterCount ? `${activeFilterCount} filtro(s) ativo(s)` : "Encontre uma alteracao sem percorrer o historico inteiro."}</p></div><button id="reloadAuditBtn" class="icon-btn" type="button" title="Atualizar auditoria"><i data-lucide="rotate-cw"></i></button></div>
        <div class="audit-filter-grid">
          <label class="wide">Pesquisar<input data-audit-filter="q" value="${escapeHtml(filters.q || "")}" placeholder="Acao, ramal, numero, usuario ou identificador" /></label>
          <label>Tipo<select data-audit-filter="group">${option("", filters.group || "", "Todos")}${option("configuration", filters.group || "", "Configuracoes")}${option("monitoring", filters.group || "", "Monitoramento")}${option("recordings", filters.group || "", "Gravacoes")}${option("other", filters.group || "", "Outros")}</select></label>
          <label>Usuario<select data-audit-filter="user"><option value="">Todos</option>${userOptions}</select></label>
          <label>Data inicial<input data-audit-filter="dateStart" type="date" value="${escapeHtml(filters.dateStart || "")}" /></label>
          <label>Data final<input data-audit-filter="dateEnd" type="date" value="${escapeHtml(filters.dateEnd || "")}" /></label>
        </div>
        <div class="filter-actions"><button id="applyAuditFiltersBtn" class="primary-btn" type="button"><i data-lucide="search"></i>Aplicar filtros</button><button id="clearAuditFiltersBtn" class="secondary-btn" type="button"><i data-lucide="x"></i>Limpar</button></div>
      </section>
      <section class="panel audit-events-panel">
        <div class="panel-header"><div><h3>Historico de atividades</h3><p class="table-meta">${monitorNumber(filteredEvents.length)} evento(s) encontrado(s)</p></div><button class="secondary-btn" data-tab="logs" type="button"><i data-lucide="server"></i>Ver sistema</button></div>
        <div class="audit-event-list">${rows || `<div class="governance-empty"><i data-lucide="search-x"></i><strong>Nenhum evento encontrado</strong><span>Revise os filtros aplicados.</span></div>`}</div>
        <div class="pagination"><button class="secondary-btn" data-audit-page="${Math.max(1, page - 1)}" ${page <= 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i>Anterior</button><span>Pagina ${page} de ${pagesCount}</span><button class="secondary-btn" data-audit-page="${Math.min(pagesCount, page + 1)}" ${page >= pagesCount ? "disabled" : ""}>Proxima<i data-lucide="chevron-right"></i></button></div>
      </section>
    </div>`;
}

function renderUsers() {
  const users = state.users.length ? state.users : [state.user].filter(Boolean);
  const editingIndex = Number.isInteger(state.editingUserIndex) && users[state.editingUserIndex] ? state.editingUserIndex : null;
  const editing = editingIndex === null ? null : users[editingIndex];
  const isAdmin = editing?.role === "admin";
  const enabledMenuCount = editing ? Object.values(menuPermissions).filter((key) => isAdmin || editing.permissions?.menus?.[key]).length : 0;
  const rows = users.map((user, index) => {
    const userIsAdmin = user.role === "admin";
    const userEnabledMenuCount = Object.values(menuPermissions).filter((key) => userIsAdmin || user.permissions?.menus?.[key]).length;
    return `
      <article class="panel user-card entity-list-card" data-user-summary-index="${index}">
        <div class="user-card-title"><span class="user-avatar"><i data-lucide="user-round"></i></span><div><h3>${escapeHtml(user.username || "novo")}</h3><span>${userIsAdmin ? "Administrador com acesso total" : `${escapeHtml(user.role || "user")} · ${userEnabledMenuCount} modulos`}</span></div></div>
        <div class="list-card-meta"><span><strong>Ramais</strong>Todos</span><span><strong>Acesso</strong>${userIsAdmin ? "Total" : `${userEnabledMenuCount} modulo(s)`}</span></div>
        <div class="compact-card-actions"><button class="primary-btn compact" data-edit-user="${index}" type="button"><i data-lucide="pencil"></i>Editar</button><button class="icon-btn danger" data-remove-user="${index}" ${user.username === "admin" ? "disabled" : ""} title="Remover usuario"><i data-lucide="trash-2"></i></button></div>
      </article>`;
  }).join("");
  const menuGroups = editing ? userMenuGroups.map((group) => `
      <section class="user-permission-group">
        <div class="user-permission-group-title"><i data-lucide="${group.icon}"></i><strong>${group.label}</strong><span>${group.tabs.length}</span></div>
        <div class="user-permission-list">${group.tabs.map((tab) => {
          const key = menuPermissions[tab];
          return `<label class="user-permission-option"><input type="checkbox" data-user-menu="${key}" ${(isAdmin || editing.permissions?.menus?.[key]) ? "checked" : ""} ${isAdmin ? "disabled" : ""}/><span>${escapeHtml(titleByTab[tab] || tab)}</span></label>`;
        }).join("")}</div>
      </section>`).join("") : "";
  const editor = editing ? `
    <article class="panel user-card entity-editor-shell" data-user-index="${editingIndex}" data-entity-editor>
      <div class="panel-header entity-editor-header"><div class="user-card-title"><span class="user-avatar"><i data-lucide="user-round"></i></span><div><p class="eyebrow">Editar usuario</p><h3>${escapeHtml(editing.username || "novo")}</h3><span>${isAdmin ? "Administrador com acesso total" : "Acesso personalizado"}</span></div></div><div class="compact-card-actions"><button class="secondary-btn" data-cancel-user-edit type="button"><i data-lucide="arrow-left"></i>Voltar para lista</button><button id="saveUsersBtn" class="primary-btn compact" type="button"><i data-lucide="save"></i>Salvar usuario</button><button class="icon-btn danger" data-remove-user="${editingIndex}" ${editing.username === "admin" ? "disabled" : ""} title="Remover usuario"><i data-lucide="trash-2"></i></button></div></div>
      <div class="field-grid compact-grid"><label>Usuario<input data-user-field="username" value="${escapeHtml(editing.username || "")}" ${editing.username === "admin" ? "readonly" : ""} /></label><label>Nova senha<input data-user-field="password" type="password" placeholder="Manter senha atual" /></label><label>Perfil<select data-user-field="role">${["admin", "supervisor", "user"].map((role) => option(role, editing.role || "user", role)).join("")}</select></label></div>
      <section class="user-access-block"><div class="user-access-heading"><div><strong>Acesso aos modulos</strong><span>Defina quais areas ficam disponiveis para este usuario.</span></div><div class="user-access-actions"><span class="user-permission-summary" data-user-menu-count>${enabledMenuCount} de ${Object.keys(menuPermissions).length} modulos</span>${isAdmin ? `<span class="badge ok">Acesso total</span>` : `<button class="secondary-btn compact" type="button" data-user-toggle-menus="${editingIndex}"><i data-lucide="check-check"></i><span data-user-toggle-label>${enabledMenuCount === Object.keys(menuPermissions).length ? "Limpar" : "Selecionar todos"}</span></button>`}</div></div><div class="user-permission-groups">${menuGroups}</div></section>
      <section class="user-access-block"><strong>Supervisao de chamadas</strong><p class="microcopy">Para usuarios nao administradores, autorize os ramais ou departamentos que podem ser escutados. Sem selecao, nenhuma escuta e permitida. O acesso ao modulo Monitor continua necessario.</p><div class="form-grid"><label>Ramais autorizados (separados por virgula)<input data-user-field="allowedExtensions" value="${escapeHtml((editing.allowedExtensions || []).join(', '))}" ${isAdmin ? 'disabled' : ''}/></label><label>Departamentos autorizados (separados por virgula)<input data-user-field="departments" value="${escapeHtml((editing.departments || []).join(', '))}" ${isAdmin ? 'disabled' : ''}/></label></div><label class="user-setting-option"><input type="checkbox" data-user-permission="interveneCalls" ${(isAdmin || editing.permissions?.interveneCalls === true) ? 'checked' : ''} ${isAdmin ? 'disabled' : ''}/><span>Permitir intervencao nas chamadas autorizadas (falar, participar, transferir e desligar)</span></label></section>
      <section class="user-access-block"><label class="user-setting-option"><input type="checkbox" data-user-field="mustChangePassword" ${editing.mustChangePassword ? "checked" : ""}/><span>Trocar senha no proximo login</span></label></section>
    </article>` : `
    <section class="panel"><div class="panel-header"><div><p class="eyebrow">Administracao</p><h3>Usuarios</h3><p class="microcopy">Consulte os usuarios cadastrados e abra somente a conta que deseja editar.</p></div><div class="report-header-actions"><button id="addUserBtn" class="primary-btn" type="button"><i data-lucide="plus"></i>Novo usuario</button><button id="saveUsersBtn" class="secondary-btn" type="button"><i data-lucide="save"></i>Salvar usuarios</button></div></div><div class="entity-list-grid">${rows || `<div class="governance-empty"><i data-lucide="users"></i><strong>Nenhum usuario cadastrado</strong><span>Cadastre um usuario para liberar acessos.</span></div>`}</div></section>`;
  pages.users.innerHTML = `<div class="section-grid">${editor || `<section class="panel"><div class="panel-header"><div><p class="eyebrow">Administracao</p><h3>Usuarios</h3><p class="microcopy">Consulte os usuarios cadastrados e abra somente a conta que deseja editar.</p></div><div class="report-header-actions"><button id="addUserBtn" class="primary-btn" type="button"><i data-lucide="plus"></i>Novo usuario</button><button id="saveUsersBtn" class="secondary-btn" type="button"><i data-lucide="save"></i>Salvar usuarios</button></div></div><div class="entity-list-grid">${rows || `<div class="governance-empty"><i data-lucide="users"></i><strong>Nenhum usuario cadastrado</strong><span>Cadastre um usuario para liberar acessos.</span></div>`}</div></section>`}</div>`;
}


function collectConfig() {
  const cfg = state.config;
  const activeRoot = $(".tab-page.active") || document;

  const trunkRoot = pages.trunk.classList.contains("active") ? pages.trunk : activeRoot;
  const trunkCards = $all("[data-trunk-card]", trunkRoot);
  if (trunkCards.length) {
    const currentTrunks = cfg.trunks || [];
    const updatedTrunks = currentTrunks.slice();
    const readTrunkCard = (card, fallbackIndex) => {
      const cardIndex = Number.isInteger(Number(card.dataset.index)) ? Number(card.dataset.index) : fallbackIndex;
      const current = currentTrunks[cardIndex] || {};
      const trunk = { ...current };
      $all("[data-trunk-field]", card).forEach((input) => {
        const key = input.dataset.trunkField;
        if (key === "codecs") trunk[key] = readArray(input.value);
        else if (["port", "simultaneousCalls"].includes(key)) trunk[key] = Number(input.value) || (key === "port" ? 5060 : 4);
        else if (key === "active") trunk[key] = input.value === "true";
        else trunk[key] = input.value;
      });
      trunk.inboundDestinationType = $("[data-trunk-inbound-type]", card)?.value || trunk.inboundDestinationType || "ivr";
      trunk.inboundDestination = trunk.inboundDestinationType === "none" ? "" : $("[data-trunk-inbound-value]", card)?.value || trunk.inboundDestination || "main";
      trunk.id = (trunk.id || (cardIndex === 0 ? "trunk-operadora" : `trunk-${cardIndex + 1}`)).replace(/[^a-zA-Z0-9_.-]/g, "-");
      return trunk;
    };
    trunkCards.forEach((card, index) => {
      const cardIndex = Number.isInteger(Number(card.dataset.index)) ? Number(card.dataset.index) : index;
      updatedTrunks[cardIndex] = readTrunkCard(card, index);
    });
    cfg.trunks = updatedTrunks;
    cfg.trunk = { ...(cfg.trunk || {}), ...(cfg.trunks[0] || {}) };
    (cfg.inboundRoutes || []).filter((route) => route.id === "main" && !route.trunkId).forEach((route) => {
      route.destinationType = cfg.trunk.inboundDestinationType;
      route.destination = cfg.trunk.inboundDestination;
    });
    if (!cfg.trunks.some((trunk) => trunk.id === cfg.outbound?.defaultTrunk && trunk.active !== false && PbxTrunkPolicy.allows(trunk, "outbound"))) {
      cfg.outbound = cfg.outbound || {};
      cfg.outbound.defaultTrunk = PbxTrunkPolicy.outboundTrunk(cfg)?.id || "";
    }
  }

  $all("[data-extension-card]", pages.extensions.classList.contains("active") ? pages.extensions : document.createElement("div")).forEach((row) => {
    const ext = cfg.extensions[Number(row.dataset.index)];
    if (!ext) return;
    $all("[data-field]", row).forEach((input) => {
      if (input.type === "checkbox") ext[input.dataset.field] = input.checked;
      else ext[input.dataset.field] = input.value;
    });
    ext.permissions = $all("input[name^='extperm-']:checked", row).map((input) => input.value);
  });

  $all("[data-route-index]", activeRoot).forEach((row) => {
    const route = cfg.inboundRoutes[Number(row.dataset.routeIndex)];
    if (!route) return;
    $all("[data-field]", row).forEach((input) => {
      route[input.dataset.field] = input.type === "checkbox" ? input.checked : input.value;
    });
    const destinationType = $("[data-destination-type]", row);
    const destinationValue = $("[data-destination-value]", row);
    if (destinationType && destinationValue) {
      route.destinationType = destinationType.value;
      route.destination = destinationValue.value;
    }
  });

  $all("[data-route-index][data-field]", activeRoot).forEach((input) => {
    const route = cfg.inboundRoutes[Number(input.dataset.routeIndex)];
    if (!route) return;
    route[input.dataset.field] = input.value;
  });

  const primaryRouteDestination = $("[data-primary-route-destination]", activeRoot);
  if (primaryRouteDestination && cfg.inboundRoutes[0]) {
    cfg.inboundRoutes[0].destinationType = $("[data-destination-type]", primaryRouteDestination).value;
    cfg.inboundRoutes[0].destination = $("[data-destination-value]", primaryRouteDestination).value;
  }

  Object.entries(cfg.outboundRules).forEach(([key, rule]) => {
    const input = $(`[data-rule='${key}']`, activeRoot);
    if (input) rule.patterns = readArray(input.value);
  });

  $all("[data-outbound]", activeRoot).forEach((input) => {
    const key = input.dataset.outbound;
    if (!cfg.outbound) cfg.outbound = {};
    if (key === "stripDigits") cfg.outbound[key] = Number(input.value) || 0;
    else if (key === "emergencyNumbers") cfg.outbound[key] = readArray(input.value);
    else if (["emergencyEnabled", "prependAreaCodeToLocal"].includes(key)) cfg.outbound[key] = input.value === "true";
    else cfg.outbound[key] = input.value;
  });

  $all(".permission-card[data-index]", activeRoot).forEach((card) => {
    const ext = cfg.extensions[Number(card.dataset.index)];
    if (!ext) return;
    ext.permissions = $all("input[name^='routeperm-']:checked", card).map((input) => input.value);
  });

  $all("[data-scope='ivr'] [data-key]", activeRoot).forEach((input) => {
    const key = input.dataset.key;
    if (key === "allowDirectDial") cfg.ivr[key] = input.value === "true";
    else if (key === "timeoutSeconds") cfg.ivr[key] = Number(input.value) || 20;
    else if (key === "menuRepeat") cfg.ivr[key] = Number(input.value) || 3;
    else cfg.ivr[key] = input.value;
  });

  const shouldCollectIvrFlow = Boolean($(".ivr-flow-canvas", activeRoot));
  if (shouldCollectIvrFlow) {
    syncIvrCanvasPositions(activeRoot);
    const workspace = currentIvrWorkspaceMenu();
    const renderedMenuKeys = new Set();
    $all(".ivr-flow-node[data-ivr-menu]", activeRoot).forEach((node) => {
      const menuKey = node.dataset.ivrMenu;
      renderedMenuKeys.add(menuKey);
      const menu = menuKey === "main" ? cfg.ivr : cfg.ivr.menus?.[Number(menuKey)];
      if (!menu) return;

      $all("[data-ivr-menu-field]", node).forEach((input) => {
        const key = input.dataset.ivrMenuField;
        if (key === "id") return;
        menu[key] = key === "allowDirectDial" ? input.value === "true" : input.type === "number" ? Number(input.value) : input.value;
      });
    });

    renderedMenuKeys.forEach((menuKey) => {
      const menu = menuKey === "main" ? cfg.ivr : cfg.ivr.menus?.[Number(menuKey)];
      if (menu) menu.options = [];
    });
    workspace.looseOptions = [];
    $all("[data-ivr-option][data-ivr-card-key]", activeRoot).forEach((row) => {
      const optionData = {
        nodeId: $("[data-ivr-option-id-field]", row)?.value || row.dataset.ivrOptionId || "",
        digit: $("[data-ivr-option-field='digit']", row)?.value || "",
        label: $("[data-ivr-option-field='label']", row)?.value || "Nova opcao",
        description: $("[data-ivr-option-field='description']", row)?.value || "",
        announcement: $("[data-ivr-option-field='announcement']", row)?.value || "",
        destinationType: $("[data-ivr-destination-type]", row)?.value || "",
        destination: $("[data-ivr-destination-value]", row)?.value || "",
        destinationCardKey: $("[data-ivr-destination-card-key]", row)?.value || ""
      };
      if (row.dataset.ivrSourceType === "loose") {
        workspace.looseOptions.push(optionData);
        return;
      }
      const menuKey = row.dataset.ivrMenu;
      const menu = menuKey === "main" ? cfg.ivr : cfg.ivr.menus?.[Number(menuKey)];
      if (!menu) return;
      menu.options.push(optionData);
    });

    $all("[data-time-condition-id]", activeRoot).forEach((node) => {
      const condition = ensureIvrTimeConditions(workspace).find((item) => item.id === node.dataset.timeConditionId);
      if (!condition) return;
      $all("[data-time-field]", node).forEach((input) => {
        condition[input.dataset.timeField] = input.value;
      });
      const prior = ivrTimeWindows(condition);
      const windows = $all("[data-time-window]", node).map((row, index) => {
        const window = { ...prior[index] };
        for (const field of $all("[data-window-field]", row)) window[field.dataset.windowField] = field.value;
        return window;
      });
      if (windows.length) {
        for (const key of ["start","end","weekdays"]) condition[key] = windows[0][key];
        if (condition.windows?.length || windows.length > 1) condition.windows = windows;
      }
      for (const branch of ["in", "out"]) {
        const row = $(`[data-time-destination='${branch}']`, node);
        if (!row) continue;
        condition[branch+"DestinationType"] = $("[data-ivr-destination-type]", row).value;
        condition[branch+"Destination"] = $("[data-ivr-destination-value]", row).value;
        condition[branch+"DestinationCardKey"] = $("[data-ivr-destination-card-key]", row)?.value || "";
      }
    });

  }

  $all("[data-ivr-index]", activeRoot).forEach((row) => {
    const item = cfg.ivr.options[Number(row.dataset.ivrIndex)];
    if (!item) return;
    $all("[data-field]", row).forEach((input) => {
      item[input.dataset.field] = input.value;
    });
  });

  const ring = cfg.ringGroups[0];
  $all("[data-scope='ring'] [data-key]", activeRoot).forEach((input) => {
    if (input.dataset.key === "fallbackDestination") return collectFinalDestination(ring, input.value);
    ring[input.dataset.key] = input.dataset.key === "members" ? readArray(input.value) : input.type === "number" ? Number(input.value) : input.value;
  });

  $all("[data-queue-index]", activeRoot).forEach((card) => {
    const queue = cfg.queues[Number(card.dataset.queueIndex)];
    if (!queue) return;
    $all("[data-key]", card).forEach((input) => {
      if (input.dataset.key === "members") queue.members = readArray(input.value);
      else if (input.dataset.key === "fallbackDestination") collectFinalDestination(queue, input.value);
      else if (input.dataset.key === "number") queue.number = String(input.value || "").replace(/\D/g, "");
      else queue[input.dataset.key] = input.type === "number" ? Number(input.value) : input.value;
    });
  });

  $all("[data-scope='securityChecks'] [data-key]", activeRoot).forEach((input) => {
    cfg.security[input.dataset.key] = input.checked;
  });
  $all("[data-scope='security'] [data-key]", activeRoot).forEach((input) => {
    if (["allowedSipNetworks", "localNetworks"].includes(input.dataset.key)) cfg.security[input.dataset.key] = readArray(input.value);
    else if (input.dataset.key === "publicAddress") cfg.security[input.dataset.key] = input.value;
    else cfg.security[input.dataset.key] = Number(input.value);
  });
  $all("[data-scope='hours'] [data-key]", activeRoot).forEach((input) => {
    const key = input.dataset.key;
    cfg.businessHours[key] = key === "enabled" ? input.value === "true" : key === "weekdays" ? readArray(input.value) : input.value;
  });

  return cfg;
}

function setConfigSaveBusy(busy) {
  $all("#saveBtn, #saveIvrFullscreenBtn, [data-save-config]").forEach((button) => {
    if (busy) {
      button.dataset.idleHtml = button.innerHTML;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      button.innerHTML = `<i data-lucide="loader-circle"></i>Salvando...`;
    } else {
      button.disabled = false;
      button.removeAttribute("aria-busy");
      if (button.dataset.idleHtml) button.innerHTML = button.dataset.idleHtml;
      delete button.dataset.idleHtml;
    }
  });
  iconRefresh();
}

async function saveConfig(scope = "") {
  if (state.configSaving) return;
  collectConfig();
  const queueNumberError = validateQueueDialNumbers();
  if (queueNumberError) {
    setMessage(queueNumberError, "error");
    throw new Error(queueNumberError);
  }

  const baseline = state.configBaseline || {};
  const scopeKeys = { extensions: ["extensions"], trunk: ["trunk", "trunks", "inboundRoutes", "outbound"], queues: ["queues", "ringGroups", "ivr", "inboundRoutes", "businessHours"], routing: ["inboundRoutes", "outbound", "outboundRules", "extensions"], security: ["security", "businessHours"] };
  const sections = Object.fromEntries(
    CONFIG_SECTION_KEYS
      .filter((key) => !scopeKeys[scope] || scopeKeys[scope].includes(key))
      .filter((key) => state.user?.role === "admin" || canAccessTab("queues") && ["queues", "ringGroups"].includes(key))
      .filter((key) => JSON.stringify(state.config?.[key]) !== JSON.stringify(baseline?.[key]))
      .map((key) => [key, state.config[key]])
  );
  if (!Object.keys(sections).length) {
    setMessage("Nenhuma alteracao para salvar.", "ok");
    return;
  }

  const submitted = JSON.parse(JSON.stringify(state.config));
  state.configSaving = true;
  setConfigSaveBusy(true);
  setMessage("Validando e aplicando somente os modulos alterados...");
  try {
    const applyResponse = await api("/api/config/apply", {
      method: "PATCH",
      body: JSON.stringify({
        _revision: baseline._revision || state.config?._revision || "",
        _sectionRevisions: baseline._sectionRevisions || state.config?._sectionRevisions || {},
        sections
      })
    });
    collectConfig();
    const drafts = Object.fromEntries(CONFIG_SECTION_KEYS
      .filter((key) => JSON.stringify(state.config[key]) !== JSON.stringify(submitted[key]) || (!Object.hasOwn(sections, key) && JSON.stringify(state.config[key]) !== JSON.stringify(baseline[key])))
      .map((key) => [key, state.config[key]]));
    state.config = { ...applyResponse.config, ...drafts };
    state.configBaseline = JSON.parse(JSON.stringify(applyResponse.config));
    const detail = applyResponse.reloaded ? "salva e aplicada ao Asterisk" : "salva; o Asterisk ja estava atualizado";
    const elapsed = Number(applyResponse.durationMs) > 0 ? ` em ${(Number(applyResponse.durationMs) / 1000).toFixed(1)}s` : "";
    setMessage(`Configuracao ${detail}${elapsed}.`, "ok");
  } finally {
    state.configSaving = false;
    setConfigSaveBusy(false);
  }
}

async function loadPreview(file) {
  const response = await fetch(`/api/generated/${file}`, { credentials: "same-origin", cache: "no-store" });
  state.generatedPreview = await response.text();
  renderOverview();
  iconRefresh();
}

async function loadOverviewData(date = state.overview.date || todayKey(), { preserveDraft = false, background = false } = {}) {
  const selectedDate = date || todayKey();
  state.overview.date = selectedDate;
  const params = new URLSearchParams({
    dateStart: selectedDate,
    dateEnd: selectedDate,
    page: "1",
    pageSize: "200",
    sortBy: "startedAt",
    sortDir: "desc"
  });
  const [callsResponse, dashboardResponse] = await Promise.all([
    api(`/api/pbx/reports/calls?${params.toString()}`),
    api(`/api/pbx/reports/dashboard?dateStart=${encodeURIComponent(selectedDate)}&dateEnd=${encodeURIComponent(selectedDate)}`)
  ]);
  state.overview.calls = callsResponse.data || [];
  state.overview.dashboard = dashboardResponse.dashboard || {};
  if (background) {
    renderSurfaceInBackground(pages.overview, renderOverview);
    return;
  }
  const draft = preserveDraft ? captureSurfaceDraft(pages.overview) : null;
  renderOverview();
  restoreSurfaceDraft(pages.overview, draft);
  iconRefresh();
}

function collectOverviewFiltersFromDom() {
  state.overview.queue = $("#overviewQueueFilter")?.value || "";
  state.overview.extension = $("#overviewExtensionFilter")?.value || "";
}

function collectReportFiltersFromDom() {
  const filters = {};
  $all("[data-report-filter]", pages.reports).forEach((input) => {
    if (input.value !== "") filters[input.dataset.reportFilter] = input.value;
  });
  return filters;
}

function collectRecordingFiltersFromDom() {
  const filters = {};
  $all("[data-recording-filter]", pages.audios).forEach((input) => {
    if (input.value !== "") filters[input.dataset.recordingFilter] = input.value;
  });
  return filters;
}

function recordingFilterParams(extra = {}) {
  const params = new URLSearchParams();
  Object.entries({ recording: "with", ...(state.recordingLibrary.filters || {}), ...extra }).forEach(([key, value]) => {
    if (value !== undefined && value !== null && String(value) !== "") params.set(key, value);
  });
  return params;
}

async function loadRecordingLibrary(extra = {}) {
  const library = state.recordingLibrary;
  const requestId = library.requestId = (library.requestId || 0) + 1;
  const meta = library.meta || {};
  library.loading = true;
  if (state.activeTab === "audios") {
    renderAudios();
    iconRefresh();
  }
  const params = recordingFilterParams({
    page: extra.page || meta.page || 1,
    pageSize: extra.pageSize || meta.pageSize || 20,
    sortBy: "startedAt",
    sortDir: "desc"
  });
  try {
    const callsResponse = await api(`/api/pbx/reports/calls?${params.toString()}`);
    if (library.requestId !== requestId) return;
    library.calls = callsResponse.data || [];
    library.meta = callsResponse.meta || library.meta;
  } catch (error) {
    if (library.requestId === requestId) throw error;
  } finally {
    if (library.requestId === requestId) {
    library.loading = false;
    if (state.activeTab === "audios") {
      renderAudios();
      iconRefresh();
    }
    }
  }
}

async function loadReports(extra = {}) {
  const requestId = state.pbxReports.requestId = (state.pbxReports.requestId || 0) + 1;
  state.pbxReports.loading = true;
  renderReports();
  iconRefresh();
  try {
  const meta = state.pbxReports.meta || {};
  const params = reportFilterParams({
    page: extra.page || meta.page || 1,
    pageSize: extra.pageSize || meta.pageSize || 25,
    sortBy: extra.sortBy || meta.sortBy || "startedAt",
    sortDir: extra.sortDir || meta.sortDir || "desc"
  });
  const [callsResponse, dashboardResponse, chartsResponse, presenceResponse, pausesResponse, inbound] = await Promise.all([
    api(`/api/pbx/reports/calls?${params.toString()}`),
    api(`/api/pbx/reports/dashboard?${reportFilterParams().toString()}`),
    api(`/api/pbx/reports/charts?${reportFilterParams().toString()}`),
    api(`/api/pbx/reports/presence?${reportFilterParams().toString()}`),
    api(`/api/pbx/reports/pauses?${reportFilterParams().toString()}`),
    api("/api/inbound-calls").catch(() => ({ cdr: [], rejected: [] }))
  ]);
  if (state.pbxReports.requestId !== requestId) return;
  state.pbxReports.calls = callsResponse.data || [];
  state.pbxReports.meta = callsResponse.meta || state.pbxReports.meta;
  state.pbxReports.dashboard = dashboardResponse.dashboard || {};
  state.pbxReports.charts = chartsResponse.charts || {};
  state.pbxReports.presence = presenceResponse.summary || [];
  state.pbxReports.pauses = { summary: pausesResponse.summary || [], events: pausesResponse.events || [] };
  state.pbxReports.loading = false;
  state.reports = (callsResponse.data || []).map((call) => ({
    ...call,
    startedAt: call.startedAt,
    source: call.source,
    destination: call.destination,
    context: call.context,
    disposition: call.disposition,
    billsec: call.billsec,
    duration: call.duration,
    lastApp: call.lastApp
  }));
  state.inboundCalls = inbound || { cdr: [], rejected: [] };
  } catch (error) {
    if (state.pbxReports.requestId === requestId) throw error;
  } finally {
  if (state.pbxReports.requestId === requestId) {
  state.pbxReports.loading = false;
  renderReports();
  iconRefresh();
  }
  }
}

function collectUsersFromDom() {
  const users = (state.users || []).map((user) => ({
    ...user,
    permissions: { ...(user.permissions || {}), menus: { ...(user.permissions?.menus || {}) } }
  }));
  $all("[data-user-index]", pages.users).forEach((card) => {
    const index = Number(card.dataset.userIndex);
    if (!Number.isInteger(index)) return;
    const current = users[index] || {};
    const permissions = { ...(current.permissions || {}), menus: { ...(current.permissions?.menus || {}) } };
    $all("[data-user-menu]", card).forEach((input) => {
      permissions.menus[input.dataset.userMenu] = input.checked;
    });
    $all("[data-user-permission]", card).forEach((input) => {
      permissions[input.dataset.userPermission] = input.checked;
    });
    const field = (name) => $(`[data-user-field='${name}']`, card);
    users[index] = {
      ...current,
      username: field("username")?.value || "",
      password: field("password")?.value || "",
      role: field("role")?.value || "user",
      extension: field("extension")?.value || "",
      allowedExtensions: readArray(field("allowedExtensions")?.value || ""),
      departments: readArray(field("departments")?.value || ""),
      mustChangePassword: Boolean(field("mustChangePassword")?.checked),
      permissions
    };
  });
  return users;
}

async function loadUsers() {
  const response = await api("/api/users");
  state.users = response.users || [];
  renderUsers();
  iconRefresh();
}

async function saveUsers() {
  const users = collectUsersFromDom();
  const response = await api("/api/users", {
    method: "PUT",
    body: JSON.stringify({ users })
  });
  state.users = response.users || [];
  state.editingUserIndex = null;
  state.editingUserNew = false;
  setMessage("Usuarios e permissoes salvos.", "ok");
  renderUsers();
  iconRefresh();
}

async function loadAudit() {
  const response = await api("/api/audit");
  state.auditEvents = response.events || [];
  renderAudit();
  iconRefresh();
}

async function loadPbxStatus({ announce = false, preserveDraft = false, background = false } = {}) {
  if (state.pbxStatusRefreshing) return;
  const renderLoadingState = !state.pbxStatus;
  state.pbxStatusRefreshing = true;
  if (renderLoadingState && state.activeTab === "status") {
    renderStatus();
    iconRefresh();
  }

  let response;
  try {
    response = await api("/api/pbx-status");
  } finally {
    state.pbxStatusRefreshing = false;
    if (renderLoadingState && state.activeTab === "status") {
      renderStatus();
      iconRefresh();
    }
  }

  state.pbxStatus = response;
  refreshCaptureDialog();
  if (announce) setMessage("Monitoramento atualizado.", "ok");
  const activeRoot = pages[state.activeTab];
  if (background) {
    const backgroundRenderers = {
      overview: renderOverview,
      status: renderStatus,
      logs: renderLogs
    };
    const render = backgroundRenderers[state.activeTab];
    if (render) renderSurfaceInBackground(activeRoot, render);
    iconRefresh();
    return;
  }
  const draft = preserveDraft ? captureSurfaceDraft(activeRoot) : null;
  renderOverview();
  renderStatus();
  if (state.activeTab === "security") renderSecurity();
  if (state.activeTab === "reports") renderReports();
  if (state.activeTab === "logs") renderLogs();
  restoreSurfaceDraft(activeRoot, draft);
  iconRefresh();
}

async function loadOutboundDiagnostics(number = "", extension = "") {
  const params = new URLSearchParams();
  if (number) params.set("number", number);
  if (extension) params.set("ext", extension);
  state.outboundDiagnostics = await api(`/api/outbound-diagnostics?${params.toString()}`);
  renderRouting();
  if (state.activeTab === "logs") renderLogs();
  iconRefresh();
}

async function loadIvrAudios() {
  const user = state.user;
  if (!user || !canAccessTab("ivrAudios")) return;
  const response = await api("/api/ivr-audios");
  if (state.user !== user || !canAccessTab("ivrAudios")) return;
  state.ivrAudios = response.audios || [];
  if (state.activeTab === "ivr" && !state.ivrBuilderOpen && !state.ivrFullscreen) {
    renderIvr();
    iconRefresh();
  }
  if (state.activeTab === "ivrAudios") {
    renderIvrAudios();
    iconRefresh();
  }
}

let dialerCampaignsRequest = null;
async function loadDialerCampaigns({ preserveDraft = false, background = false } = {}) {
  const user = state.user;
  if (!user || !canAccessTab("dialer")) return;
  if (!dialerCampaignsRequest) {
    dialerCampaignsRequest = api("/api/dialer/campaigns").finally(() => { dialerCampaignsRequest = null; });
  }
  let response;
  state.dialerCampaignsError = false;
  try {
    response = await dialerCampaignsRequest;
    if (state.user !== user) return;
    if (!Array.isArray(response.campaigns)) throw new Error("Resposta de campanhas invalida. Tente atualizar novamente.");
  } catch (error) {
    if (state.user !== user) return;
    state.dialerCampaignsError = true;
    if (state.activeTab === "dialer") renderDialerCampaignLiveData();
    throw error;
  }
  state.dialerCampaigns = response.campaigns;
  state.dialerCampaignsLoaded = true;
  state.dialerDestinations = response.destinations || { queues: [], extensions: [] };
  state.dialerTrunks = response.trunks || ensureConfigTrunks().filter((trunk) => trunk.active !== false && trunk.sipServer && PbxTrunkPolicy.allows(trunk, "outbound"));
  state.dialerTrunkHealth = response.trunkHealth || {};
  state.dialerWhatsApp = response.whatsapp || {};
  if (response.audios) state.ivrAudios = response.audios;
  if (state.activeTab === "dialer") {
    if (background) renderDialerCampaignLiveData();
    else {
      const draft = preserveDraft ? captureSurfaceDraft(pages.dialer) : null;
      renderDialer();
      restoreSurfaceDraft(pages.dialer, draft);
      syncDialerTransport($("#dialerCampaignForm", pages.dialer));
    }
    iconRefresh();
  }
}

async function saveDialerCampaign(form) {
  const payload = Object.fromEntries(new FormData(form));
  payload.trunkIds = new FormData(form).getAll("trunkIds");
  if (payload.transport !== "whatsapp" && !payload.trunkIds.length) {
    setMessage("Selecione pelo menos um tronco para a campanha.", "error");
    form.querySelector('[name="trunkIds"]')?.focus();
    return;
  }
  const response = await api("/api/dialer/campaigns", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  state.dialerCampaigns = response.campaigns || [];
  state.dialerEditingId = "";
  state.dialerEditorOpen = false;
  state.dialerEditingNew = false;
  renderDialer();
  iconRefresh();
  setMessage("Campanha salva.", "ok");
}

async function runDialerAction(id, action) {
  const response = await api(`/api/dialer/campaigns/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    body: "{}"
  });
  state.dialerCampaigns = response.campaigns || [];
  renderDialer();
  iconRefresh();
  setMessage(action === "start" ? "Campanha iniciada." : action === "pause" ? "Campanha pausada." : "Lista reiniciada.", "ok");
}

async function deleteDialerCampaign(id) {
  const campaign = state.dialerCampaigns.find((item) => item.id === id);
  if (!window.confirm(`Excluir a campanha ${campaign?.name || id}?`)) return;
  const response = await api(`/api/dialer/campaigns/${encodeURIComponent(id)}`, { method: "DELETE" });
  state.dialerCampaigns = response.campaigns || [];
  if (state.dialerEditingId === id) state.dialerEditingId = "";
  renderDialer();
  iconRefresh();
  setMessage("Campanha excluida.", "ok");
}

function ensureModalRoot() {
  let root = $("#modalRoot");
  if (!root) {
    root = document.createElement("div");
    root.id = "modalRoot";
    document.body.appendChild(root);
  }
  return root;
}

async function openDialerCampaignReport(id) {
  const report = await api(`/api/dialer/campaigns/${encodeURIComponent(id)}/report`);
  const { campaign, reasons, byTrunk, numbers } = report;
  const stats = campaign.stats || {};
  const trunkLabelForId = (id) => state.dialerTrunks.find((item) => item.id === id)?.name || id || "Não informado";
  const root = ensureModalRoot();
  root.innerHTML = `
    <div class="modal-backdrop" data-close-modal></div>
    <section class="modal-card dialer-report-modal" role="dialog" aria-modal="true" aria-label="Relatório da campanha">
      <header><div><p class="eyebrow">Relatório da campanha</p><h3>${escapeHtml(campaign.name)}</h3></div><button class="icon-btn" type="button" data-close-modal title="Fechar"><i data-lucide="x"></i></button></header>
      <div class="dialer-report-content">
        <p class="dialer-report-progress">${Number(stats.total || 0)} números · ${Number(stats.pending || 0)} aguardando ligação · ${Number(stats.inProgress || 0)} ligando agora</p>
        <div class="dialer-report-summary">
          <span class="success"><strong>${Number(stats.accepted || 0)}</strong><b>${campaign.transport === "whatsapp" ? "Conversou com um atendente" : "Atendeu e pediu atendimento"}</b><small>${campaign.transport === "whatsapp" ? "O cliente e o atendente foram conectados." : "Apertou a tecla e foi encaminhado."}</small></span>
          <span><strong>${Number(stats.answered || 0)}</strong><b>${campaign.transport === "whatsapp" ? "Atendeu, mas não conversou com um atendente" : "Atendeu, mas não confirmou para falar"}</b><small>${campaign.transport === "whatsapp" ? "Confira o motivo no resultado da ligação." : "A tecla para falar com atendente não foi registrada."}</small></span>
          <span><strong>${Number(stats.noAnswer || 0)}</strong><b>Não atendeu</b><small>Não houve atendimento dentro do tempo de espera.</small></span>
          <span><strong>${Number(stats.busy || 0)}</strong><b>Número ocupado</b><small>O número estava ocupado na tentativa.</small></span>
          <span class="danger"><strong>${Number(stats.failed || 0)}</strong><b>Ligação não completada</b><small>O sistema ou a operadora não concluiu a ligação.</small></span>
          <span><strong>${Number(stats.canceled || 0)}</strong><b>Ligação cancelada</b><small>A tentativa foi interrompida.</small></span>
        </div>
        <div class="dialer-report-sections">
          <section><h4>O que aconteceu</h4><div class="dialer-report-table-wrap"><table><thead><tr><th>Resultado</th><th>Quantidade</th></tr></thead><tbody>${reasons.length ? reasons.map((item) => `<tr><td>${escapeHtml(item.label)}</td><td>${Number(item.count)}</td></tr>`).join("") : '<tr><td colspan="2">Nenhum resultado registrado.</td></tr>'}</tbody></table></div></section>
          <section><h4>Resultado por tronco</h4><div class="dialer-report-table-wrap"><table><thead><tr><th>Tronco</th><th>Resultado</th><th>Quantidade</th></tr></thead><tbody>${byTrunk.length ? byTrunk.map((item) => `<tr><td>${escapeHtml(trunkLabelForId(item.trunk))}</td><td>${escapeHtml(item.statusLabel)}</td><td>${Number(item.count)}</td></tr>`).join("") : '<tr><td colspan="3">Sem ligações registradas.</td></tr>'}</tbody></table></div></section>
        </div>
        <section><h4>Números <small>Primeiros ${Math.min(numbers.length, 100)} de ${numbers.length}. O CSV contém todos.</small></h4><div class="dialer-report-table-wrap dialer-report-numbers"><table><thead><tr><th>Número</th><th>Resultado</th><th>Tentativas</th><th>Tronco</th><th>O que aconteceu</th></tr></thead><tbody>${numbers.slice(0, 100).map((item) => `<tr><td>${escapeHtml(item.number)}</td><td>${escapeHtml(item.statusLabel)}</td><td>${Number(item.attempts || 0)}</td><td>${escapeHtml(trunkLabelForId(item.trunkId))}</td><td>${escapeHtml(item.resultLabel)}</td></tr>`).join("")}</tbody></table></div></section>
      </div>
      <footer><a class="secondary-btn" href="/api/dialer/campaigns/${encodeURIComponent(id)}/report.csv"><i data-lucide="download"></i>Baixar CSV completo</a></footer>
    </section>`;
  iconRefresh();
}

function closeModal() {
  const root = $("#modalRoot");
  if (root) root.innerHTML = "";
}

async function openRecordingModal(uniqueId) {
  const detail = await api(`/api/pbx/reports/calls/${encodeURIComponent(uniqueId)}`);
  const call = detail.call;
  if (!call.recording?.available) {
    setMessage("Gravacao nao encontrada para esta chamada.");
    return;
  }
  if (!call.recording?.canListen) {
    setMessage("Usuario sem permissao para escutar esta gravacao.");
    return;
  }
  const root = ensureModalRoot();
  root.innerHTML = `
    <div class="modal-backdrop" data-close-modal></div>
    <section class="modal-card audio-modal">
      <header>
        <div>
          <p class="eyebrow">Gravacao de chamada</p>
          <h3>${escapeHtml(call.source || "-")} -> ${escapeHtml(call.destination || "-")}</h3>
        </div>
        <button class="icon-btn" data-close-modal title="Fechar"><i data-lucide="x"></i></button>
      </header>
      <audio controls preload="none" src="${escapeHtml(call.recording.playUrl)}"></audio>
      <div class="recording-tools">
        <label>Velocidade
          <select id="recordingSpeed">
            ${["0.75", "1", "1.25", "1.5", "2"].map((speed) => option(speed, speed === "1" ? speed : "", `${speed}x`)).join("")}
          </select>
        </label>
        ${
          call.recording.canDownload
            ? `<a class="primary-btn" href="${escapeHtml(call.recording.downloadUrl)}"><i data-lucide="download"></i>Baixar gravacao</a>`
            : `<span class="badge warn">Download sem permissao</span>`
        }
      </div>
      <div class="detail-grid">
        <span><strong>Protocolo</strong>${escapeHtml(call.protocol || "-")}</span>
        <span><strong>Data/hora</strong>${escapeHtml(formatDateTime(call.startedAt))}</span>
        <span><strong>Origem</strong>${escapeHtml(call.source || "-")}</span>
        <span><strong>Destino</strong>${escapeHtml(call.destination || "-")}</span>
        <span><strong>Ramal</strong>${escapeHtml(call.extension || "-")} ${escapeHtml(call.extensionName || "")}</span>
        <span><strong>Duracao</strong>${escapeHtml(call.durationLabel)}</span>
        <span><strong>Status</strong>${escapeHtml(call.statusLabel)}</span>
      </div>
    </section>
  `;
  const audio = $("audio", root);
  $("#recordingSpeed", root)?.addEventListener("change", (event) => {
    audio.playbackRate = Number(event.target.value) || 1;
  });
  iconRefresh();
}

async function openCallDetails(callId) {
  const detail = await api(`/api/pbx/reports/calls/${encodeURIComponent(callId)}`);
  const call = detail.call;
  const root = ensureModalRoot();
  const timeline = (call.timeline || [])
    .map(
      (item) => `
      <li>
        <strong>${escapeHtml(item.label)}</strong>
        <span>${escapeHtml(formatDateTime(item.at))}</span>
        <small>${escapeHtml(item.description || "")}</small>
      </li>`
    )
    .join("");
  root.innerHTML = `
    <div class="modal-backdrop" data-close-modal></div>
    <section class="modal-card call-detail-modal">
      <header>
        <div>
          <p class="eyebrow">Detalhes da chamada</p>
          <h3>${escapeHtml(call.uniqueId || call.id)}</h3>
        </div>
        <button class="icon-btn" data-close-modal title="Fechar"><i data-lucide="x"></i></button>
      </header>
      <div class="detail-grid">
        <span><strong>Protocolo</strong>${escapeHtml(call.protocol || "-")}</span>
        <span><strong>Origem</strong>${escapeHtml(call.source || "-")}</span>
        <span><strong>Destino</strong>${escapeHtml(call.destination || "-")}</span>
        <span><strong>Ramal</strong>${escapeHtml(call.extension || "-")} ${escapeHtml(call.extensionName || "")}</span>
        <span><strong>Tronco</strong>${escapeHtml(call.trunk || "-")}</span>
        <span><strong>Duracao total</strong>${escapeHtml(call.durationLabel)}</span>
        <span><strong>Ate atendimento</strong>${escapeHtml(call.waitsecLabel)}</span>
        <span><strong>Em conversa</strong>${escapeHtml(call.billsecLabel)}</span>
        <span><strong>Status final</strong>${escapeHtml(call.statusLabel)}</span>
        <span><strong>Fila</strong>${escapeHtml(call.queue || "-")}</span>
        <span><strong>DID</strong>${escapeHtml(call.did || "-")}</span>
        <span><strong>SIP Call-ID</strong>${escapeHtml(call.sipCallId || "-")}</span>
        <span><strong>Linked ID</strong>${escapeHtml(call.linkedId || "-")}</span>
      </div>
      <section class="timeline">
        <h3>Linha do tempo</h3>
        <ol>${timeline || `<li><strong>Sem eventos</strong><span>-</span><small>Nenhuma linha do tempo disponivel.</small></li>`}</ol>
      </section>
      <section class="technical-box">
        <h3>Dados tecnicos</h3>
        <pre>${escapeHtml(JSON.stringify({
          channel: call.channel,
          destinationChannel: call.destinationChannel,
          context: call.context,
          lastApp: call.lastApp,
          lastData: call.lastData,
          userField: call.userField,
          recordingFile: call.recordingFile
        }, null, 2))}</pre>
      </section>
      ${
        call.recording?.available && call.recording?.canListen
          ? `<button class="primary-btn" data-listen-recording="${escapeHtml(call.uniqueId)}"><i data-lucide="headphones"></i>Escutar gravacao</button>`
          : `<span class="badge warn">${call.recording?.available ? "Sem permissao para escutar" : "Sem gravacao"}</span>`
      }
    </section>
  `;
  iconRefresh();
}

function handleSoftphoneInput(event) {
  if (event.target.closest("#extensionDialNumber")) {
    const value = String(event.target.value || "").replace(/[^0-9*#]/g, "").slice(0, 20);
    event.target.value = value;
    state.extensionCall.dialNumber = value;
    return true;
  }
  if (event.target.closest("#extensionTransferTarget")) {
    const value = String(event.target.value || "").replace(/\D/g, "").slice(0, 20);
    event.target.value = value;
    state.extensionCall.transferTarget = value;
    return true;
  }
  if (event.target.closest("#softphoneVolume")) {
    state.extensionCall.volume = Math.max(0, Math.min(100, Number(event.target.value || 0)));
    saveExtensionAudioPreferences();
    return true;
  }
  if (event.target.closest("#softphoneCallDevice")) {
    state.extensionCall.callDeviceId = event.target.value || "";
    saveExtensionAudioPreferences();
    return true;
  }
  if (event.target.closest("#softphoneMicDevice")) {
    state.extensionCall.micDeviceId = event.target.value || "";
    saveExtensionAudioPreferences();
    return true;
  }
  return false;
}

async function handleSoftphoneClick(event) {
  const dialKeyButton = event.target.closest("[data-dial-key]");
  if (dialKeyButton) {
    state.extensionCall.dialNumber = `${state.extensionCall.dialNumber || ""}${dialKeyButton.dataset.dialKey}`.replace(/[^0-9*#]/g, "").slice(0, 20);
    renderExtensionPortal();
    return true;
  }

  if (event.target.closest("#softphoneClearBtn")) {
    state.extensionCall.dialNumber = "";
    renderExtensionPortal();
    return true;
  }

  if (event.target.closest("#softphoneCallBtn")) {
    await callFromSoftphone();
    return true;
  }

  if (event.target.closest("#softphoneAnswerBtn")) {
    await answerSoftphone();
    return true;
  }

  if (event.target.closest("#softphoneHangupBtn")) {
    await hangupSoftphone();
    return true;
  }

  if (event.target.closest("#softphoneMuteBtn")) {
    toggleSoftphoneMute();
    return true;
  }

  if (event.target.closest("#softphoneSpeakerBtn")) {
    toggleSoftphoneSpeaker();
    return true;
  }

  if (event.target.closest("#softphoneAudioSettingsBtn")) {
    state.extensionCall.audioSettingsOpen = !state.extensionCall.audioSettingsOpen;
    renderExtensionPortal();
    if (state.extensionCall.audioSettingsOpen) await loadExtensionAudioDevices();
    return true;
  }

  if (event.target.closest("#softphoneRefreshDevicesBtn")) {
    await loadExtensionAudioDevices();
    return true;
  }

  if (event.target.closest("#softphoneHoldBtn")) {
    await toggleSoftphoneHold();
    return true;
  }

  if (event.target.closest("#assistedTransferStartBtn")) {
    await startAssistedTransfer();
    return true;
  }

  if (event.target.closest("#assistedTransferCompleteBtn")) {
    await completeAssistedTransfer();
    return true;
  }

  if (event.target.closest("#assistedTransferCancelBtn")) {
    await cancelAssistedTransfer();
    return true;
  }

  const serverHangupButton = event.target.closest("#serverHangupBtn");
  if (serverHangupButton) {
    await sendExtensionAction("hangup", { channel: serverHangupButton.dataset.channel || "" });
    return true;
  }

  return false;
}

document.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.target;
  const formId = form.getAttribute("id");

  try {
    if (formId === "loginForm") {
      const formData = new FormData(form);
      const response = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData))
      });
      state.user = response.user;
      restoreViewPreferences();
      renderShell();
      if (!state.user.mustChangePassword) {
        await loadConfig();
        await loadTabData(state.activeTab);
      }
      return;
    }

    if (formId === "extensionLoginForm") {
      const formData = new FormData(form);
      const response = await api("/api/extensions/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData))
      });
      state.extensionSession = response.extension;
      state.extensionCall = initialExtensionCallState();
      renderShell();
      requestDesktopNotificationPermission({ silent: true }).catch(() => {});
      await loadExtensionPortal();
      await loadExtensionStatus();
      autoRegisterSoftphone();
      return;
    }

    if (formId === "passwordForm") {
      const formData = new FormData(form);
      const response = await api("/api/change-password", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData))
      });
      state.user = response.user;
      form.reset();
      renderShell();
      await loadConfig();
      await loadTabData(state.activeTab);
      setMessage("Senha administrativa atualizada.", "ok");
      return;
    }

    if (formId === "ivrAudioUploadForm") {
      const formData = new FormData(form);
      const response = await fetch("/api/ivr-audios", {
        method: "POST",
        credentials: "same-origin",
        body: formData
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao enviar audio");
      if (state.config) collectConfig();
      state.ivrAudios = data.audios || [];
      form.reset();
      renderAll();
      iconRefresh();
      setMessage("Audio enviado para a biblioteca da URA. Selecione no fluxograma e salve para aplicar.", "ok");
      return;
    }

    if (formId === "dialerCampaignForm") {
      await saveDialerCampaign(form);
      return;
    }
  } catch (error) {
    if (formId === "loginForm") $("#loginMessage").textContent = error.message;
    else if (formId === "extensionLoginForm") $("#extensionLoginMessage").textContent = error.message;
    else setMessage(error.message);
  }
});

document.addEventListener("click", async (event) => {
  if (event.target.closest("[data-upload-dialer-audio]")) {
    document.getElementById("dialerAudioFile")?.click();
    return;
  }
  if (state.extensionSession) prepareIncomingRingtone();
  if (state.extensionSession && !event.target.closest("#extensionNotificationBtn") && desktopNotificationPermission() === "default") {
    requestDesktopNotificationPermission({ silent: true }).catch(() => {});
  }
  const tabButton = event.target.closest("[data-tab]");
  const previewButton = event.target.closest("[data-preview]");
  const removeExtension = event.target.closest("[data-remove-extension]");
  const removeIvr = event.target.closest("[data-remove-ivr]");
  const reportPageButton = event.target.closest("[data-report-page]");
  const reportSortButton = event.target.closest("[data-report-sort]");
  const recordingViewButton = event.target.closest("[data-recording-view]");
  const recordingPageButton = event.target.closest("[data-recording-page]");
  const systemScopeButton = event.target.closest("[data-system-scope]");
  const auditPageButton = event.target.closest("[data-audit-page]");
  const listenRecordingButton = event.target.closest("[data-listen-recording]");
  const callDetailsButton = event.target.closest("[data-call-details]");
  const removeQueueMemberButton = event.target.closest("[data-remove-queue-member]");
  const removeQueueButton = event.target.closest("[data-remove-queue]");
  const removeTrunkButton = event.target.closest("[data-remove-trunk]");
  const editTrunkButton = event.target.closest("[data-edit-trunk]");
  const cancelTrunkEditButton = event.target.closest("[data-cancel-trunk-edit]");
  const deleteIvrAudioButton = event.target.closest("[data-delete-ivr-audio]");
  const editDialerButton = event.target.closest("[data-edit-dialer]");
  const dialerReportButton = event.target.closest("[data-dialer-report]");
  const newDialerButton = event.target.closest("[data-new-dialer]");
  const dialerActionButton = event.target.closest("[data-dialer-action]");
  const deleteDialerButton = event.target.closest("[data-delete-dialer]");
  const editExtensionButton = event.target.closest("[data-edit-extension]");
  const cancelExtensionEditButton = event.target.closest("[data-cancel-extension-edit]");
  const editQueueButton = event.target.closest("[data-edit-queue]");
  const cancelQueueEditButton = event.target.closest("[data-cancel-queue-edit]");
  const editRouteButton = event.target.closest("[data-edit-route]");
  const cancelRouteEditButton = event.target.closest("[data-cancel-route-edit]");
  const toggleExtensionDetailsButton = event.target.closest("[data-toggle-extension-details]");
  const toggleQueueDetailsButton = event.target.closest("[data-toggle-queue-details]");
  const addIvrOptionButton = event.target.closest("[data-add-ivr-option]");
  const removeIvrOptionButton = event.target.closest("[data-remove-ivr-option]");
  const removeIvrMenuButton = event.target.closest("[data-remove-ivr-menu]");
  const startIvrLinkButton = event.target.closest("[data-start-ivr-link]");
  const startMenuOptionLinkButton = event.target.closest("[data-start-menu-option-link]");
  const startTimeLinkButton = event.target.closest("[data-start-time-link]");
  const ivrOptionTargetButton = event.target.closest("[data-ivr-option-target]");
  const removeIvrLinkButton = event.target.closest("[data-remove-ivr-link]");
  const detachIvrOptionButton = event.target.closest("[data-detach-ivr-option]");
  const ivrTargetButton = event.target.closest("[data-ivr-target-type]");
  const removeTargetLinksButton = event.target.closest("[data-remove-target-links]");
  const removeTargetCardButton = event.target.closest("[data-remove-target-card]");
  const hideIvrEntryButton = event.target.closest("[data-hide-ivr-entry]");
  const createIvrCardButton = event.target.closest("[data-create-ivr-card]");
  const createIvrTargetButton = event.target.closest("[data-create-ivr-target-type]");
  const startTrunkInboundLinkButton = event.target.closest("[data-start-trunk-inbound-link]");
  const connectTrunkInboundMenuButton = event.target.closest("[data-connect-trunk-inbound-menu]");
  const editIvrRootButton = event.target.closest("[data-edit-ivr-root]");
  const toggleIvrRootButton = event.target.closest("[data-toggle-ivr-root]");
  const deleteIvrRootButton = event.target.closest("[data-delete-ivr-root]");
  const toggleReportSectionButton = event.target.closest("[data-toggle-report-section]");
  const transferWaitingButton = event.target.closest("[data-transfer-waiting]");
  const monitorHangupButton = event.target.closest("[data-monitor-hangup]");
  const monitorSpyButton = event.target.closest("[data-monitor-spy]");
  const monitorSpyModeButton = event.target.closest("[data-monitor-spy-mode]");
  const removeUserButton = event.target.closest("[data-remove-user]");
  const editUserButton = event.target.closest("[data-edit-user]");
  const cancelUserEditButton = event.target.closest("[data-cancel-user-edit]");
  const toggleUserMenusButton = event.target.closest("[data-user-toggle-menus]");
  const dialKeyButton = event.target.closest("[data-dial-key]");

  try {
    if (event.target.closest("#extensionLoginModeBtn")) {
      $("#loginForm").classList.add("hidden");
      $("#extensionLoginForm").classList.remove("hidden");
      $("#adminLoginModeBtn").classList.remove("active");
      $("#extensionLoginModeBtn").classList.add("active");
      iconRefresh();
      return;
    }

    if (event.target.closest("#adminLoginModeBtn")) {
      $("#extensionLoginForm").classList.add("hidden");
      $("#loginForm").classList.remove("hidden");
      $("#extensionLoginModeBtn").classList.remove("active");
      $("#adminLoginModeBtn").classList.add("active");
      iconRefresh();
      return;
    }

    if (await handleSoftphoneClick(event)) return;

    if (dialKeyButton) {
      state.extensionCall.dialNumber = `${state.extensionCall.dialNumber || ""}${dialKeyButton.dataset.dialKey}`;
      renderExtensionPortal();
      return;
    }

    if (event.target.closest("#softphoneCallBtn")) {
      await callFromSoftphone();
      return;
    }

    if (event.target.closest("#softphoneAnswerBtn")) {
      await answerSoftphone();
      return;
    }

    if (event.target.closest("#softphoneHangupBtn")) {
      await hangupSoftphone();
      return;
    }

    if (event.target.closest("#softphoneMuteBtn")) {
      toggleSoftphoneMute();
      return;
    }

    if (event.target.closest("#softphoneHoldBtn")) {
      await toggleSoftphoneHold();
      return;
    }

    if (event.target.closest("#assistedTransferStartBtn")) {
      await startAssistedTransfer();
      return;
    }

    if (event.target.closest("#assistedTransferCompleteBtn")) {
      await completeAssistedTransfer();
      return;
    }

    if (event.target.closest("#assistedTransferCancelBtn")) {
      await cancelAssistedTransfer();
      return;
    }

    if (event.target.closest("#queuePauseBtn")) {
      if (currentExtensionPauseInfo().paused) {
        await unpauseExtensionQueue();
      } else if (isExtensionCallActive()) {
        setExtensionMessage("Encerre a ligação antes de colocar o ramal em pausa.", "error");
      } else {
        state.extensionCall.pauseReasonPickerOpen = true;
        renderExtensionPortal();
      }
      return;
    }

    const pauseReasonButton = event.target.closest("[data-pause-reason]");
    if (pauseReasonButton) {
      await pauseExtensionQueue(pauseReasonButton.dataset.pauseReason || "Cafezinho");
      return;
    }

    if (event.target.closest("#pauseReasonCancelBtn")) {
      state.extensionCall.pauseReasonPickerOpen = false;
      renderExtensionPortal();
      return;
    }

    if (event.target.closest("#queueUnpauseBtn, #queueUnpauseOverlayBtn")) {
      await unpauseExtensionQueue();
      return;
    }

    const serverHangupButton = event.target.closest("#serverHangupBtn");
    if (serverHangupButton) {
      await sendExtensionAction("hangup", { channel: serverHangupButton.dataset.channel || "" });
      return;
    }

    if (event.target.closest("#extensionRefreshBtn")) {
      await loadExtensionStatus();
      return;
    }

    if (event.target.closest("#extensionLogoutBtn")) {
      closePhonePictureInPicture();
      await stopExtensionClientPhone();
      await api("/api/extensions/logout", { method: "POST", body: "{}" }).catch((error) => {
        if (!isExtensionAuthError(error)) throw error;
      });
      state.extensionSession = null;
      state.extensionPortal = null;
      state.extensionStatus = null;
      state.extensionCall = initialExtensionCallState();
      renderShell();
      return;
    }

    if (event.target.closest("#extensionNotificationBtn")) {
      await requestDesktopNotificationPermission();
      return;
    }

    const hadIvrContextMenu = Boolean(state.ivrContextMenu);
    const clickedOutsideIvrContextMenu = !event.target.closest(".ivr-context-menu");
    const clickedEmptyIvrCanvas =
      state.activeTab === "ivr" &&
      event.target.closest(".ivr-flow-canvas") &&
      !event.target.closest("[data-ivr-card-key], button, input, select, textarea, audio, a");
    if (hadIvrContextMenu && clickedOutsideIvrContextMenu) {
      state.ivrContextMenu = null;
      if (clickedEmptyIvrCanvas) {
        rememberIvrViewport();
        renderIvr();
        iconRefresh();
        return;
      }
    }

    if (event.target.closest("[data-close-modal]")) {
      closeModal();
      return;
    }

    if (event.target.closest("#sidebarToggleBtn, #sidebarHeaderToggleBtn")) {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      saveSidebarCollapsed(state.sidebarCollapsed);
      applySidebarState();
      iconRefresh();
      return;
    }

    if (tabButton) {
      await setActiveTab(tabButton.dataset.tab, { push: true, collect: true, load: true });
      return;
    }

    if (newDialerButton) {
      state.dialerEditingId = "";
      state.dialerEditorOpen = true;
      state.dialerEditingNew = true;
      renderDialer();
      iconRefresh();
      return;
    }

    if (dialerReportButton) {
      await openDialerCampaignReport(dialerReportButton.dataset.dialerReport);
      return;
    }

    if (event.target.closest("[data-refresh-dialer]")) {
      await loadDialerCampaigns();
      setMessage("Campanhas atualizadas.", "ok");
      return;
    }

    if (event.target.closest("[data-cancel-dialer-edit]")) {
      state.dialerEditingId = "";
      state.dialerEditorOpen = false;
      state.dialerEditingNew = false;
      renderDialer();
      iconRefresh();
      return;
    }

    if (editTrunkButton) {
      collectConfig();
      state.editingTrunkIndex = Number(editTrunkButton.dataset.editTrunk);
      state.editingTrunkNew = false;
      renderTrunk();
      iconRefresh();
      return;
    }

    if (cancelTrunkEditButton) {
      collectConfig();
      if (state.editingTrunkNew) state.config.trunks.pop();
      state.editingTrunkIndex = null;
      state.editingTrunkNew = false;
      renderTrunk();
      iconRefresh();
      return;
    }

    if (editExtensionButton) {
      collectConfig();
      state.editingExtensionIndex = Number(editExtensionButton.dataset.editExtension);
      state.editingExtensionNew = false;
      renderExtensions();
      iconRefresh();
      return;
    }

    if (cancelExtensionEditButton) {
      collectConfig();
      if (state.editingExtensionNew) state.config.extensions.splice(state.editingExtensionIndex, 1);
      state.editingExtensionIndex = null;
      state.editingExtensionNew = false;
      renderExtensions();
      iconRefresh();
      return;
    }

    if (editQueueButton) {
      collectConfig();
      state.editingQueueIndex = Number(editQueueButton.dataset.editQueue);
      state.editingQueueNew = false;
      renderQueues();
      iconRefresh();
      return;
    }

    if (cancelQueueEditButton) {
      collectConfig();
      if (state.editingQueueNew) state.config.queues.splice(state.editingQueueIndex, 1);
      state.editingQueueIndex = null;
      state.editingQueueNew = false;
      renderQueues();
      iconRefresh();
      return;
    }

    if (editRouteButton) {
      collectConfig();
      state.editingRouteIndex = Number(editRouteButton.dataset.editRoute);
      state.editingRouteNew = false;
      renderRouting();
      iconRefresh();
      return;
    }

    if (cancelRouteEditButton) {
      collectConfig();
      if (state.editingRouteNew) state.config.inboundRoutes.splice(state.editingRouteIndex, 1);
      state.editingRouteIndex = null;
      state.editingRouteNew = false;
      renderRouting();
      iconRefresh();
      return;
    }

    if (editUserButton) {
      state.users = collectUsersFromDom();
      state.editingUserIndex = Number(editUserButton.dataset.editUser);
      state.editingUserNew = false;
      renderUsers();
      iconRefresh();
      return;
    }

    if (cancelUserEditButton) {
      state.users = collectUsersFromDom();
      if (state.editingUserNew) state.users.splice(state.editingUserIndex, 1);
      state.editingUserIndex = null;
      state.editingUserNew = false;
      renderUsers();
      iconRefresh();
      return;
    }

    if (event.target.closest("#addTrunkBtn")) {
      collectConfig();
      ensureConfigTrunks();
      const trunkId = nextTrunkId();
      state.config.trunks.push({
        id: trunkId,
        name: "Nova operadora",
        mainNumber: "",
        sipUser: "",
        sipPassword: "",
        sipServer: "",
        port: 5060,
        transport: "udp",
        codecs: ["alaw", "ulaw"],
        simultaneousCalls: 4,
        usage: "both",
        authMode: "registration",
        inboundDestinationType: "ivr",
        inboundDestination: "main",
        active: true
      });
      state.editingTrunkIndex = state.config.trunks.length - 1;
      state.editingTrunkNew = true;
      renderTrunk();
      iconRefresh();
      setTimeout(() => {
        const cards = $all("[data-trunk-card]", pages.trunk);
        cards[cards.length - 1]?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
      setMessage("Tronco adicionado. Preencha os dados, salve e aplique.", "ok");
      return;
    }

    if (removeTrunkButton) {
      collectConfig();
      const index = Number(removeTrunkButton.dataset.removeTrunk);
      const trunk = state.config.trunks[index];
      if (!trunk || index === 0) return;
      if (!window.confirm(`Remover o tronco ${trunkLabel(trunk)}?`)) return;
      state.config.trunks.splice(index, 1);
      if (state.config.outbound?.defaultTrunk === trunk.id) state.config.outbound.defaultTrunk = PbxTrunkPolicy.outboundTrunk(state.config)?.id || "";
      state.editingTrunkIndex = null;
      state.editingTrunkNew = false;
      renderTrunk();
      iconRefresh();
      setMessage("Tronco removido. Salve e aplique para atualizar o Asterisk.", "ok");
      return;
    }

    if (editDialerButton) {
      state.dialerEditingId = editDialerButton.dataset.editDialer || "";
      state.dialerEditorOpen = true;
      state.dialerEditingNew = false;
      renderDialer();
      iconRefresh();
      return;
    }

    if (dialerActionButton) {
      await runDialerAction(dialerActionButton.dataset.dialerId || "", dialerActionButton.dataset.dialerAction || "start");
      return;
    }

    if (deleteDialerButton) {
      await deleteDialerCampaign(deleteDialerButton.dataset.deleteDialer || "");
      return;
    }

    if (toggleReportSectionButton) {
      const key = toggleReportSectionButton.dataset.toggleReportSection;
      state.pbxReports.compactOpen = state.pbxReports.compactOpen || {};
      state.pbxReports.compactOpen[key] = key === "calls" ? state.pbxReports.compactOpen[key] === false : !state.pbxReports.compactOpen[key];
      renderReports();
      iconRefresh();
      return;
    }

    if (transferWaitingButton) {
      openCaptureDialog(transferWaitingButton);
      return;
    }

    if (event.target.closest("[data-monitor-spy-close]") || event.target.closest("#monitorSpyCloseBtn") || event.target.closest("#monitorSpyCancelBtn")) {
      if (state.monitorSpy.session || state.monitorSpy.ua) await stopMonitorSpy();
      state.monitorSpy.open = false;
      state.monitorSpy.busy = false;
      renderMonitorSpyPortal();
      return;
    }

    if (monitorSpyModeButton && !state.monitorSpy.busy) {
      const nextMode = monitorSpyMode(monitorSpyModeButton.dataset.monitorSpyMode);
      if (state.monitorSpy.session && nextMode !== state.monitorSpy.mode) {
        await stopMonitorSpy({ keepRegistered: true });
        await startMonitorBrowserSpy(state.monitorSpy.target, nextMode);
        return;
      }
      state.monitorSpy.mode = monitorSpyMode(monitorSpyModeButton.dataset.monitorSpyMode);
      state.monitorSpy.output = "";
      state.monitorSpy.status = "Pronta";
      renderMonitorSpyPortal();
      return;
    }

    if (event.target.closest("#monitorSpyStopBtn")) {
      await stopMonitorSpy();
      return;
    }

    if (event.target.closest("#monitorSpyStartBtn")) {
      const target = state.monitorSpy?.target || "";
      if (!target) {
        state.monitorSpy.output = "Informe o ramal monitorado.";
        renderMonitorSpyPortal();
        return;
      }
      const mode = monitorSpyMode(state.monitorSpy.mode);
      await startMonitorBrowserSpy(target, mode);
      setMessage(`${MONITOR_SPY_MODES[mode].label} iniciado.`, "ok");
      return;
    }

    if (monitorHangupButton) {
      const channel = monitorHangupButton.dataset.monitorHangup || "";
      const target = monitorHangupButton.dataset.monitorExtension || "";
      if ((!channel && !target) || !window.confirm(`Desconectar a chamada do ramal ${target || "selecionado"} agora?`)) return;
      const response = await api("/api/pbx/monitor/action", {
        method: "POST",
        body: JSON.stringify({ action: "hangup-channel", channel, target })
      });
      setMessage("Chamada desconectada.", "ok");
      await loadPbxStatus();
      return;
    }

    if (monitorSpyButton) {
      const target = monitorSpyButton.dataset.monitorSpy || "";
      if (state.monitorSpy.session && target !== state.monitorSpy.target) {
        setMessage("Encerre o monitoramento atual antes de abrir outro ramal.", "warn");
        return;
      }
      state.monitorSpy = {
        open: true,
        target,
        mode: state.monitorSpy.session ? monitorSpyMode(state.monitorSpy.mode) : "listen",
        output: "",
        status: state.monitorSpy.session ? "Ao vivo" : "Preparando",
        busy: false,
        ua: state.monitorSpy.ua,
        registerer: state.monitorSpy.registerer,
        session: state.monitorSpy.session,
        sip: state.monitorSpy.sip,
        allowedModes: state.monitorSpy.allowedModes
      };
      renderMonitorSpyPortal();
      const openedTarget = target;
      prepareMonitorSpySoftphone()
        .then(async () => {
          if (!state.monitorSpy.open || state.monitorSpy.target !== openedTarget) {
            if (!state.monitorSpy.session) await disposeMonitorSpySoftphone();
            return;
          }
          if (!state.monitorSpy.busy && !state.monitorSpy.session) {
            state.monitorSpy.status = "Pronta";
            state.monitorSpy.output = "";
            renderMonitorSpyPortal();
          }
        })
        .catch((error) => {
          if (!state.monitorSpy.open || state.monitorSpy.target !== openedTarget || state.monitorSpy.busy) return;
          state.monitorSpy.status = "Falha";
          state.monitorSpy.output = error.message;
          renderMonitorSpyPortal();
        });
      return;
    }

    if (event.target.closest("#applyAuditFiltersBtn")) {
      state.auditView.filters = collectAuditFiltersFromDom();
      state.auditView.page = 1;
      renderAudit();
      iconRefresh();
      return;
    }

    if (event.target.closest("#clearAuditFiltersBtn")) {
      state.auditView.filters = {};
      state.auditView.page = 1;
      renderAudit();
      iconRefresh();
      return;
    }

    if (auditPageButton) {
      state.auditView.page = Number(auditPageButton.dataset.auditPage) || 1;
      renderAudit();
      iconRefresh();
      return;
    }

    if (event.target.closest("#reloadAuditBtn")) {
      await loadAudit();
      return;
    }

    if (toggleUserMenusButton) {
      const card = toggleUserMenusButton.closest("[data-user-index]");
      const inputs = $all("[data-user-menu]:not(:disabled)", card);
      const shouldEnable = inputs.some((input) => !input.checked);
      inputs.forEach((input) => {
        input.checked = shouldEnable;
      });
      const summary = $("[data-user-menu-count]", card);
      const label = $("[data-user-toggle-label]", card);
      if (summary) summary.textContent = `${inputs.filter((input) => input.checked).length} de ${inputs.length} modulos`;
      if (label) label.textContent = shouldEnable ? "Limpar" : "Selecionar todos";
      return;
    }

    if (event.target.closest("#addUserBtn")) {
      state.users = collectUsersFromDom();
      state.users.push({
        username: `usuario${state.users.length + 1}`,
        role: "user",
        extension: "",
        allowedExtensions: [],
        departments: [],
        permissions: { menus: { overview: true, reports: true } },
        mustChangePassword: true
      });
      state.editingUserIndex = state.users.length - 1;
      state.editingUserNew = true;
      renderUsers();
      iconRefresh();
      return;
    }

    if (removeUserButton) {
      state.users = collectUsersFromDom();
      const index = Number(removeUserButton.dataset.removeUser);
      const user = state.users[index];
      if (!user || user.username === "admin" || !window.confirm(`Remover o usuario ${user.username || "selecionado"}?`)) return;
      state.users.splice(index, 1);
      state.editingUserIndex = null;
      state.editingUserNew = false;
      renderUsers();
      iconRefresh();
      return;
    }

    if (event.target.closest("#saveUsersBtn")) {
      await saveUsers();
      return;
    }

    if (event.target.closest("[data-open-ivr-builder]")) {
      await setActiveTab("ivr", { push: true, collect: true, load: true });
      openIvrBuilder("main");
      state.ivrFullscreen = true;
      renderIvr();
      iconRefresh();
      return;
    }

    if (previewButton) {
      await loadPreview(previewButton.dataset.preview);
      return;
    }

    if (event.target.closest("#saveBtn, [data-save-config]")) {
      await saveConfig(event.target.closest("[data-save-config]")?.dataset.saveConfig || "");
      return;
    }

    if (event.target.closest("#saveIvrFullscreenBtn")) {
      await saveConfig();
      return;
    }

    if (event.target.closest("#themeToggleBtn, #extensionThemeToggleBtn")) {
      toggleTheme();
      return;
    }

    if (event.target.closest("#logoutBtn")) {
      persistViewPreferences();
      await api("/api/logout", { method: "POST", body: "{}" });
      state.user = null;
      state.config = null;
      state.configBaseline = null;
      renderShell();
      return;
    }

    if (event.target.closest("#addExtensionBtn")) {
      collectConfig();
      const next = String(Math.max(200, ...state.config.extensions.map((ext) => Number(ext.number) || 0)) + 1);
      state.config.extensions.push({
        number: next,
        name: "Novo ramal",
        department: "Geral",
        secret: `Ram-${next}-Senha9`,
        voicemail: false,
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
      });
      state.editingExtensionIndex = state.config.extensions.length - 1;
      state.editingExtensionNew = true;
      renderExtensions();
      iconRefresh();
      requestAnimationFrame(() => {
        const editor = pages.extensions.querySelector('[data-entity-editor]');
        editor?.scrollIntoView({ block: "start", behavior: "auto" });
        editor?.querySelector('input[data-field="number"]')?.focus({ preventScroll: true });
      });
      return;
    }

    if (removeExtension) {
      collectConfig();
      const index = Number(removeExtension.dataset.removeExtension);
      const extension = state.config.extensions[index];
      if (!extension || !window.confirm(`Remover o ramal ${extension.number || "selecionado"}? As referencias serao ajustadas.`)) return;
      state.config.extensions.splice(index, 1);
      removeExtensionReferences(extension.number);
      state.editingExtensionIndex = null;
      state.editingExtensionNew = false;
      renderExtensions();
      iconRefresh();
      return;
    }

    if (event.target.closest("#addInboundBtn")) {
      collectConfig();
      state.config.inboundRoutes.push({
        id: `route-${Date.now()}`,
        name: "Nova entrada",
        did: "",
        trunkId: ensureConfigTrunks()[0]?.id || "",
        active: false,
        destinationType: "none",
        destination: ""
      });
      state.editingRouteIndex = state.config.inboundRoutes.length - 1;
      state.editingRouteNew = true;
      renderRouting();
      iconRefresh();
      return;
    }

    const removeInbound = event.target.closest("[data-remove-inbound]");
    if (removeInbound) {
      collectConfig();
      const index = Number(removeInbound.dataset.removeInbound);
      if (!window.confirm(`Excluir a rota ${state.config.inboundRoutes[index]?.name || "selecionada"}?`)) return;
      state.config.inboundRoutes.splice(index, 1);
      state.editingRouteIndex = null;
      state.editingRouteNew = false;
      renderRouting();
      iconRefresh();
      return;
    }

    if (event.target.closest("#addIvrBtn")) {
      rememberIvrViewport();
      collectConfig();
      ensureIvrLooseOptions().push(createIvrOption(""));
      renderIvr();
      iconRefresh();
      return;
    }

    if (event.target.closest("#addIvrMenuBtn")) {
      rememberIvrViewport();
      collectConfig();
      const menus = ensureIvrMenus();
      let next = menus.length + 1;
      while (menus.some((m) => m.id === `menu-${next}`)) next++;
      menus.push({
        ...createIvrRootMenu(),
        id: `menu-${next}`,
        name: `Novo menu ${next}`,
        parentMenuId: state.ivrEditingMenuId || "main",
        greeting: "",
        greetingDescription: "",
        options: []
      });
      renderIvr();
      iconRefresh();
      setMessage("Menu adicionado ao fluxograma da URA.", "ok");
      return;
    }

    if (event.target.closest("#addIvrRootBtn")) {
      rememberIvrViewport();
      collectConfig();
      const menus = ensureIvrMenus();
      const menu = createIvrRootMenu();
      menus.push(menu);
      menu.flowLayout[`menu:${menu.id}`] = { x: 300, y: 90 };
      openIvrBuilder(menu.id);
      renderIvr();
      iconRefresh();
      setMessage("Nova URA criada. Configure o audio e selecione ela no destino de entrada do tronco.", "ok");
      return;
    }

    if (event.target.closest("#toggleIvrFullscreenBtn")) {
      rememberIvrViewport();
      collectConfig();
      state.ivrFullscreen = !state.ivrFullscreen;
      renderIvr();
      iconRefresh();
      return;
    }

    if (event.target.closest("#cancelIvrLinkBtn")) {
      rememberIvrViewport();
      state.ivrLinkSource = null;
      renderIvr();
      iconRefresh();
      return;
    }

    if (event.target.closest("#backToIvrListBtn")) {
      rememberIvrViewport();
      collectConfig();
      closeIvrBuilder();
      renderIvr();
      iconRefresh();
      return;
    }

    if (event.target.closest("#newIvrRootBtn")) {
      collectConfig();
      const menu = createIvrRootMenu();
      ensureIvrMenus().push(menu);
      menu.flowLayout[`menu:${menu.id}`] = { x: 300, y: 90 };
      openIvrBuilder(menu.id);
      renderIvr();
      iconRefresh();
      setMessage("Nova URA criada. Configure o fluxo e salve para aplicar.", "ok");
      return;
    }

    if (editIvrRootButton) {
      collectConfig();
      openIvrBuilder(editIvrRootButton.dataset.editIvrRoot || "main");
      renderIvr();
      iconRefresh();
      return;
    }

    if (toggleIvrRootButton) {
      collectConfig();
      const record = ivrMenuRecordById(toggleIvrRootButton.dataset.toggleIvrRoot || "");
      if (!record || record.isMain) return;
      record.menu.active = record.menu.active === false;
      renderIvr();
      iconRefresh();
      setMessage(record.menu.active === false ? "URA inativada. Ela nao aparecera como novo destino." : "URA ativada.", "ok");
      return;
    }

    if (deleteIvrRootButton) {
      collectConfig();
      const record = ivrMenuRecordById(deleteIvrRootButton.dataset.deleteIvrRoot || "");
      if (!record || record.isMain) return;
      if (!window.confirm(`Excluir a URA ${record.menu.name || record.id}?`)) return;
      const removed = ensureIvrMenus().splice(record.index, 1)[0];
      if (removed?.id) {
        ensureIvrMenus().forEach((menu) => {
          if (menu.parentMenuId === removed.id) delete menu.parentMenuId;
        });
        replaceIvrMenuReferences(removed.id, "");
        ensureConfigTrunks().forEach((trunk) => {
          if (trunk.inboundDestinationType === "ivr" && trunk.inboundDestination === removed.id) trunk.inboundDestination = "main";
        });
        (state.config.inboundRoutes || []).forEach((route) => {
          if (route.destinationType === "ivr" && route.destination === removed.id) route.destination = "main";
        });
      }
      closeIvrBuilder();
      renderIvr();
      iconRefresh();
      setMessage("URA excluida e vinculos ajustados para a URA principal.", "ok");
      return;
    }

    if (createIvrCardButton) {
      rememberIvrViewport();
      collectConfig();
      const menuInfo = state.ivrContextMenu || { x: 320, y: 160, menuKey: "main" };
      const action = createIvrCardButton.dataset.createIvrCard;
      if (action === "menu") {
        const menus = ensureIvrMenus();
        const next = menus.length + 1;
        const id = `menu-${Date.now().toString(36)}`;
        menus.push({ ...createIvrRootMenu(), id, name: `Novo menu ${next}`, parentMenuId: state.ivrEditingMenuId || "main" });
        setIvrCardPosition(`menu:${id}`, menuInfo.x, menuInfo.y);
        connectIvrDestination("ivr", id);
      }
      if (action === "root") {
        const menu = createIvrRootMenu();
        ensureIvrMenus().push(menu);
        menu.flowLayout[`menu:${menu.id}`] = { x: 300, y: 90 };
        openIvrBuilder(menu.id);
      }
      if (action === "option") {
        const digit = createIvrCardButton.dataset.digit || String(ensureIvrLooseOptions().length + 1);
        const newOption = createIvrOption(digit);
        ensureIvrLooseOptions().push(newOption);
        setIvrCardPosition(`option:${newOption.nodeId}`, menuInfo.x, menuInfo.y);
      }
      if (action === "timeCondition") {
        const condition = createIvrTimeCondition();
        ensureIvrTimeConditions().push(condition);
        setIvrCardPosition(`timeCondition:${condition.id}`, menuInfo.x, menuInfo.y);
        connectIvrDestination("timeCondition", condition.id);
      }
      if (action === "ramal") {
        const next = String(Math.max(200, ...state.config.extensions.map((ext) => Number(ext.number) || 0)) + 1);
        state.config.extensions.push({
          number: next,
          name: "Novo ramal",
          department: "Geral",
          secret: `Ram-${next}-Senha9`,
          voicemail: false,
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
        });
        setIvrCardPosition(`extension:${next}`, menuInfo.x, menuInfo.y);
        connectIvrDestination("extension", next);
      }
      state.ivrContextMenu = null;
      renderIvr();
      iconRefresh();
      return;
    }

    if (createIvrTargetButton) {
      rememberIvrViewport();
      collectConfig();
      const menuInfo = state.ivrContextMenu || { x: 320, y: 160, menuKey: "main" };
      const type = createIvrTargetButton.dataset.createIvrTargetType;
      const value = createIvrTargetButton.dataset.createIvrTargetValue;
      const baseKey = ivrTargetCardByDestination(type, value);
      const exists = $all(".ivr-canvas-space [data-ivr-card-key]").some((el) => el.dataset.ivrCardKey === baseKey);
      let key = baseKey;
      if (exists && !state.ivrLinkSource && !["trunk", "timeCondition", "ivr"].includes(type)) {
        key = createDuplicateIvrTargetCard(type, value, menuInfo.x, menuInfo.y);
      } else if (!exists) {
        const hidden = ensureHiddenTargetCards();
        if (hidden.includes(key)) hidden.splice(hidden.indexOf(key), 1);
        setIvrCardPosition(key, menuInfo.x, menuInfo.y);
      }
      const connected = connectIvrDestination(type, value, key);
      state.ivrContextMenu = null;
      renderIvr();
      iconRefresh();
      setMessage(connected ? "Destino conectado." : "Card disponível no fluxograma.", "ok");
      return;
    }

    if (startIvrLinkButton) {
      rememberIvrViewport();
      collectConfig();
      state.ivrLinkSource = {
        type: "option-target",
        nodeId: startIvrLinkButton.dataset.startIvrLink
      };
      renderIvr();
      iconRefresh();
      return;
    }

    const timeWindowAction = event.target.closest("[data-add-time-window], [data-remove-time-window]");
    if (timeWindowAction) {
      rememberIvrViewport();
      collectConfig();
      const id = timeWindowAction.closest("[data-time-condition-id]").dataset.timeConditionId;
      const c = ensureIvrTimeConditions().find((item) => item.id === id);
      if (!c) return;
      const windows = ivrTimeWindows(c);
      if (timeWindowAction.hasAttribute("data-add-time-window")) windows.push({ weekdays: "sat", start: "08:00", end: "12:00" });
      else if (windows.length > 1) windows.splice(Number(timeWindowAction.dataset.removeTimeWindow), 1);
      c.windows = windows;
      for (const key of ["start","end","weekdays"]) c[key] = windows[0][key];
      renderIvr();
      iconRefresh();
      return;
    }

    if (startTimeLinkButton) {
      rememberIvrViewport();
      collectConfig();
      state.ivrLinkSource = {
        type: "time-condition",
        conditionId: startTimeLinkButton.dataset.startTimeLink,
        branch: startTimeLinkButton.dataset.timeBranch || "in"
      };
      renderIvr();
      iconRefresh();
      return;
    }

    if (startMenuOptionLinkButton) {
      rememberIvrViewport();
      collectConfig();
      state.ivrLinkSource = {
        type: "menu-option",
        menuKey: startMenuOptionLinkButton.dataset.startMenuOptionLink
      };
      renderIvr();
      iconRefresh();
      return;
    }

    if (startTrunkInboundLinkButton) {
      rememberIvrViewport();
      collectConfig();
      state.ivrLinkSource = {
        type: "trunk-entry",
        trunkId: startTrunkInboundLinkButton.dataset.startTrunkInboundLink,
        cardKey: startTrunkInboundLinkButton.dataset.trunkCardKey || ""
      };
      renderIvr();
      iconRefresh();
      setMessage("Escolha o menu da URA que deve receber as chamadas deste tronco.", "ok");
      return;
    }

    if (connectTrunkInboundMenuButton && state.ivrLinkSource?.type === "trunk-entry") {
      rememberIvrViewport();
      collectConfig();
      const menuId = connectTrunkInboundMenuButton.dataset.connectTrunkInboundMenu || "main";
      const ok = connectTrunkInboundToMenu(state.ivrLinkSource.trunkId, menuId);
      state.ivrLinkSource = null;
      renderIvr();
      iconRefresh();
      setMessage(ok ? "Entrada do tronco ligada a este menu." : "Nao encontrei este tronco para vincular.", ok ? "ok" : "error");
      return;
    }

    if (ivrOptionTargetButton && state.ivrLinkSource?.type === "menu-option") {
      rememberIvrViewport();
      collectConfig();
      const targetMenu = ivrMenuByKey(state.ivrLinkSource.menuKey);
      const found = findIvrOptionByNodeId(ivrOptionTargetButton.dataset.ivrOptionTarget);
      if (targetMenu && found) {
        if ((targetMenu.options || []).some((o) => o !== found.item && o.digit && o.digit === found.item.digit)) {
          return setMessage(`A tecla ${found.item.digit} já está em uso neste menu. Altere a tecla antes de conectar.`);
        }
        const movedOption = removeIvrOptionFromCurrentSource(found);
        if (!movedOption) return;
        targetMenu.options = targetMenu.options || [];
        targetMenu.options.push(movedOption);
        state.ivrLinkSource = null;
        renderIvr();
        iconRefresh();
        setMessage("Opcao ligada ao menu.", "ok");
      }
      return;
    }

    if (removeIvrLinkButton) {
      rememberIvrViewport();
      collectConfig();
      const found = findIvrOptionByNodeId(removeIvrLinkButton.dataset.removeIvrLink);
      if (found?.item) {
        const hadDestination = Boolean(found.item.destination);
        found.item.destinationType = found.item.destination = found.item.destinationCardKey = "";
        if (state.ivrLinkSource?.nodeId === found.item.nodeId) state.ivrLinkSource = null;
        renderIvr();
        iconRefresh();
        setMessage(hadDestination ? "Link removido sem apagar os cards seguintes." : "Esta opcao ja estava sem link de destino.", "ok");
      }
      return;
    }

    if (detachIvrOptionButton) {
      rememberIvrViewport();
      collectConfig();
      const found = findIvrOptionByNodeId(detachIvrOptionButton.dataset.detachIvrOption);
      if (found) {
        const optionItem = removeIvrOptionFromCurrentSource(found);
        if (optionItem) ensureIvrLooseOptions().push(optionItem);
        if (state.ivrLinkSource?.nodeId === optionItem?.nodeId) state.ivrLinkSource = null;
        renderIvr();
        iconRefresh();
        setMessage("Opcao solta do menu sem apagar os cards seguintes.", "ok");
      }
      return;
    }

    if (removeTargetLinksButton) {
      rememberIvrViewport();
      collectConfig();
      const removed = clearIvrDestinationLinks(removeTargetLinksButton.dataset.removeTargetLinks, removeTargetLinksButton.dataset.targetValue, currentIvrWorkspaceMenu(), removeTargetLinksButton.dataset.targetCardKey);
      renderIvr();
      iconRefresh();
      setMessage(removed ? `${removed} link(s) removido(s) deste card sem apagar outros cards.` : "Este card nao tinha links ativos.", "ok");
      return;
    }

    if (hideIvrEntryButton) {
      rememberIvrViewport();
      collectConfig();
      const result = hideIvrEntryNode();
      renderIvr();
      iconRefresh();
      setMessage(result.message, "ok");
      return;
    }

    if (removeTargetCardButton) {
      rememberIvrViewport();
      collectConfig();
      const type = removeTargetCardButton.dataset.removeTargetCard;
      const value = removeTargetCardButton.dataset.targetValue;
      const duplicateId = removeTargetCardButton.dataset.targetDuplicateId || "";
      if (duplicateId) {
        clearIvrDestinationLinks(type, value, currentIvrWorkspaceMenu(), removeTargetCardButton.dataset.targetCardKey);
        const duplicateCards = ensureIvrDuplicateTargetCards();
        const duplicateIndex = duplicateCards.findIndex((item) => item.id === duplicateId);
        if (duplicateIndex >= 0) duplicateCards.splice(duplicateIndex, 1);
        const layout = ensureIvrFlowLayout();
        delete layout[removeTargetCardButton.dataset.targetCardKey || `${type}:${value}:${duplicateId}`];
        renderIvr();
        iconRefresh();
        setMessage("Atalho removido sem apagar o card original.", "ok");
        return;
      }
      const result = removeIvrTargetCard(type, value);
      if (!result.ok) {
        setMessage(result.message);
        return;
      }
      const layout = ensureIvrFlowLayout();
      delete layout[ivrTargetCardByDestination(type, value)];
      renderIvr();
      iconRefresh();
      setMessage(result.message, "ok");
      return;
    }

    if (ivrTargetButton && state.ivrLinkSource) {
      rememberIvrViewport();
      collectConfig();
      const { ivrTargetType, ivrTargetValue, ivrTargetCardKey } = ivrTargetButton.dataset;
      if (connectIvrDestination(ivrTargetType, ivrTargetValue, ivrTargetCardKey)) {
        renderIvr();
        iconRefresh();
        setMessage("Destino conectado.", "ok");
      }
      return;
    }

    if (addIvrOptionButton) {
      rememberIvrViewport();
      collectConfig();
      const menuKey = addIvrOptionButton.dataset.addIvrOption;
      const menu = ivrMenuByKey(menuKey);
      if (menu) {
        menu.options = menu.options || [];
        const nextDigit = [..."1234567890*#"].find((digit) => !menu.options.some((o) => String(o.digit) === digit));
        if (!nextDigit) return setMessage("Todas as teclas deste menu já estão em uso.");
        const option = createIvrOption(nextDigit);
        const menuNode = addIvrOptionButton.closest(".ivr-flow-node");
        if (menuNode) {
          const x = menuNode.offsetLeft + 40;
          const bottom = Math.max(...$all("[data-ivr-card-key]", $(".ivr-canvas-zoom-layer"))
            .filter((node) => node.offsetLeft < x + 540 && node.offsetLeft + node.offsetWidth > x)
            .map((node) => node.offsetTop + node.offsetHeight));
          setIvrCardPosition(`option:${ensureIvrOptionId(option)}`, x, bottom + 40);
        }
        menu.options.push(option);
        renderIvr();
        iconRefresh();
      }
      return;
    }

    if (removeIvrOptionButton) {
      rememberIvrViewport();
      collectConfig();
      const optionNode = removeIvrOptionButton.closest("[data-ivr-option][data-ivr-card-key]");
      const sourceType = optionNode?.dataset.ivrSourceType || "";
      const menuKey = optionNode?.dataset.ivrMenu || removeIvrOptionButton.dataset.removeIvrOption;
      const optionIndex = Number(optionNode?.dataset.ivrOption ?? removeIvrOptionButton.dataset.optionIndex);
      if (sourceType === "loose") {
        ensureIvrLooseOptions().splice(optionIndex, 1);
        renderIvr();
        iconRefresh();
        return;
      }
      const menu = ivrMenuByKey(menuKey);
      if (menu && Number.isFinite(optionIndex)) {
        menu.options = (menu.options || []).filter((_, index) => index !== optionIndex);
        renderIvr();
        iconRefresh();
      }
      return;
    }

    if (removeIvrMenuButton) {
      rememberIvrViewport();
      collectConfig();
      const menus = ensureIvrMenus();
      const removed = menus.splice(Number(removeIvrMenuButton.dataset.removeIvrMenu), 1)[0];
      if (removed?.id) {
        replaceIvrMenuReferences(removed.id);
        if (state.ivrEditingMenuId === removed.id) closeIvrBuilder();
      }
      renderIvr();
      iconRefresh();
      setMessage("Menu removido e conexoes ajustadas.", "ok");
      return;
    }

    if (event.target.closest("#createQueueBtn")) {
      collectConfig();
      const name = "Nova fila";
      const id = uniqueQueueId(name);
      const number = nextQueueDialNumber();
      state.config.queues.push({
        id,
        number,
        name,
        strategy: "ringall",
        members: [],
        timeout: 20,
        maxWait: 300,
        fallbackType: "none",
        fallback: ""
      });
      state.editingQueueIndex = state.config.queues.length - 1;
      state.editingQueueNew = true;
      renderQueues();
      iconRefresh();
      setMessage("Fila cadastrada. Adicione ramais, salve e aplique para atualizar o Asterisk.", "ok");
      return;
    }

    if (removeQueueButton) {
      collectConfig();
      const index = Number(removeQueueButton.dataset.removeQueue);
      const queue = state.config.queues[index];
      if (!queue) return;
      const queueName = queue.name || queue.id || `fila ${index + 1}`;
      if (!window.confirm(`Excluir a fila ${queueName}? As referencias na URA e nas rotas serao ajustadas.`)) return;
      state.config.queues.splice(index, 1);
      removeQueueReferences(queue.id);
      delete state.openQueueDetails[queue.id || index];
      state.editingQueueIndex = null;
      state.editingQueueNew = false;
      renderQueues();
      iconRefresh();
      setMessage("Fila excluida. Salve e aplique para atualizar o Asterisk.", "ok");
      return;
    }

    if (event.target.closest("#addQueueMemberBtn")) {
      collectConfig();
      const queueId = $("#queueMemberQueue")?.value || "";
      const extension = $("#queueMemberExtension")?.value || "";
      const queue = state.config.queues.find((item) => item.id === queueId);
      if (queue && extension) {
        queue.members = [...new Set([...(queue.members || []), extension])];
        state.editingQueueIndex = state.config.queues.indexOf(queue);
        state.editingQueueNew = false;
        renderQueues();
        iconRefresh();
        setMessage("Ramal adicionado na fila. Salve e aplique para atualizar o Asterisk.", "ok");
      }
      return;
    }

    if (deleteIvrAudioButton) {
      const file = deleteIvrAudioButton.dataset.deleteIvrAudio;
      if (!file) return;
      if (!window.confirm(`Excluir o audio "${file}"? Se ele estiver em uso na URA, a referencia sera removida.`)) return;
      const response = await api(`/api/ivr-audios/${encodeURIComponent(file)}`, { method: "DELETE" });
      state.ivrAudios = response.audios || [];
      if (response.config) state.config = response.config;
      renderAll();
      iconRefresh();
      setMessage(response.message || "Audio excluido.", "ok");
      return;
    }

    if (recordingViewButton) {
      await setActiveTab(recordingViewButton.dataset.recordingView === "ivr" ? "ivrAudios" : "audios", { push: true, load: true });
      return;
    }

    const recordingFilterToggle = event.target.closest("#toggleRecordingFiltersBtn");
    if (recordingFilterToggle) {
      const open = !state.recordingLibrary.filtersOpen;
      state.recordingLibrary.filtersOpen = open;
      $(".recording-filter-grid.advanced", pages.audios).classList.toggle("hidden", !open);
      recordingFilterToggle.setAttribute("aria-expanded", String(open));
      recordingFilterToggle.innerHTML = `<i data-lucide="${open ? "chevron-up" : "sliders-horizontal"}"></i>${open ? "Menos filtros" : "Mais filtros"}`;
      iconRefresh();
      return;
    }

    if (event.target.closest("#applyRecordingFiltersBtn")) {
      state.recordingLibrary.filters = collectRecordingFiltersFromDom();
      state.recordingLibrary.meta.page = 1;
      await loadRecordingLibrary({ page: 1 });
      return;
    }

    if (event.target.closest("#clearRecordingFiltersBtn")) {
      state.recordingLibrary.filters = {};
      state.recordingLibrary.meta.page = 1;
      await loadRecordingLibrary({ page: 1 });
      return;
    }

    if (recordingPageButton) {
      await loadRecordingLibrary({ page: Number(recordingPageButton.dataset.recordingPage) || 1 });
      return;
    }

    if (event.target.closest("#reloadRecordingsBtn")) {
      await loadRecordingLibrary();
      return;
    }

    if (systemScopeButton) {
      state.systemView.scope = systemScopeButton.dataset.systemScope || "all";
      renderLogs();
      iconRefresh();
      return;
    }

    if (removeQueueMemberButton) {
      collectConfig();
      const queue = state.config.queues[Number(removeQueueMemberButton.dataset.removeQueueMember)];
      if (queue) {
        queue.members = (queue.members || []).filter((member) => member !== removeQueueMemberButton.dataset.member);
        state.editingQueueIndex = state.config.queues.indexOf(queue);
        state.editingQueueNew = false;
        renderQueues();
        iconRefresh();
        setMessage("Ramal removido da fila. Salve e aplique para atualizar o Asterisk.", "ok");
      }
      return;
    }

    if (removeIvr) {
      collectConfig();
      state.config.ivr.options.splice(Number(removeIvr.dataset.removeIvr), 1);
      renderIvr();
      iconRefresh();
      return;
    }

    if (event.target.closest("#reloadReportsBtn")) {
      await loadReports();
      return;
    }

    if (event.target.closest("#applyOverviewDateBtn")) {
      collectOverviewFiltersFromDom();
      const date = $("#overviewDateInput")?.value || todayKey();
      await loadOverviewData(date);
      setMessage(`Resumo atualizado para ${date.split("-").reverse().join("/")}.`, "ok");
      return;
    }

    if (event.target.closest("#todayOverviewDateBtn")) {
      collectOverviewFiltersFromDom();
      await loadOverviewData(todayKey());
      setMessage("Resumo atualizado para hoje.", "ok");
      return;
    }

    if (event.target.closest("#clearOverviewFiltersBtn")) {
      state.overview.queue = "";
      state.overview.extension = "";
      state.overview.search = "";
      renderOverview();
      iconRefresh();
      return;
    }

    if (event.target.closest("#toggleReportFiltersBtn")) {
      state.pbxReports.filtersOpen = !state.pbxReports.filtersOpen;
      renderReports();
      iconRefresh();
      return;
    }

    if (event.target.closest("#applyReportFiltersBtn")) {
      state.pbxReports.filters = collectReportFiltersFromDom();
      state.pbxReports.meta.page = 1;
      await loadReports({ page: 1 });
      return;
    }

    if (event.target.closest("#clearReportFiltersBtn")) {
      state.pbxReports.filters = {};
      state.pbxReports.meta.page = 1;
      await loadReports({ page: 1 });
      return;
    }

    if (reportPageButton) {
      await loadReports({ page: Number(reportPageButton.dataset.reportPage) || 1 });
      return;
    }

    if (reportSortButton) {
      const sortBy = reportSortButton.dataset.reportSort;
      const current = state.pbxReports.meta || {};
      const sortDir = current.sortBy === sortBy && current.sortDir === "desc" ? "asc" : "desc";
      await loadReports({ sortBy, sortDir, page: 1 });
      return;
    }

    if (event.target.closest("#monitorViewToggleBtn")) {
      state.monitorCompact.view = state.monitorCompact.view === "compact" ? "full" : "compact";
      saveMonitorCompactSettings();
      renderStatus();
      iconRefresh();
      return;
    }

    const settingsButton = event.target.closest("#monitorCompactSettingsBtn, #overviewColumnsBtn");
    if (settingsButton) {
      monitorSettingsOpener = settingsButton.id;
      monitorSettingsSection = "queues";
      $("#msSearch").value = "";
      renderMonitorChoices();
      monitorSettings.showModal();
      $("#msSearch").focus();
      return;
    }

    if (listenRecordingButton) {
      await openRecordingModal(listenRecordingButton.dataset.listenRecording);
      return;
    }

    if (callDetailsButton) {
      await openCallDetails(callDetailsButton.dataset.callDetails);
      return;
    }

    if (event.target.closest("#refreshPbxStatusBtn")) {
      await loadPbxStatus({ announce: true });
      if (state.activeTab === "reports") await loadReports();
      return;
    }

    if (event.target.closest("#refreshTechnicalLogsBtn")) {
      await Promise.all([
        loadPbxStatus(),
        loadOutboundDiagnostics($("#dialTestNumber")?.value || "", state.config?.extensions?.[0]?.number || "201")
      ]);
      renderLogs();
      iconRefresh();
      return;
    }

    if (event.target.closest("#checkDialBtn")) {
      await loadOutboundDiagnostics($("#dialTestNumber")?.value || "", $("#dialTestExtension")?.value || "201");
    }
  } catch (error) {
    if (isExtensionAuthError(error) && event.target.closest("#extensionView")) {
      await resetExtensionSessionAfterAuthError();
    } else if (state.extensionSession && event.target.closest("#extensionView")) setExtensionMessage(error.message, "error");
    else setMessage(error.message);
  }
});

document.addEventListener("pointerdown", (event) => {
  const floatingResizeHandle = event.target.closest("[data-floating-phone-resize]");
  if (floatingResizeHandle && state.extensionCall.floatingPhoneOpen) {
    const frame = syncFloatingPhoneFrame();
    state.floatingPhoneResize = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: frame.width,
      height: frame.height
    };
    floatingResizeHandle.setPointerCapture?.(event.pointerId);
    document.body.classList.add("floating-phone-interacting");
    event.preventDefault();
    return;
  }

  const floatingHandle = event.target.closest("[data-floating-phone-handle]");
  if (
    floatingHandle &&
    state.extensionCall.floatingPhoneOpen &&
    event.button === 0 &&
    !event.target.closest("button,input,select,textarea,audio,a")
  ) {
    const frame = syncFloatingPhoneFrame();
    state.floatingPhoneDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      x: frame.x,
      y: frame.y
    };
    floatingHandle.setPointerCapture?.(event.pointerId);
    document.body.classList.add("floating-phone-interacting");
    event.preventDefault();
    return;
  }

  const handle = event.target.closest("[data-ivr-drag-handle]");
  if (!handle || event.target.closest("button,input,select,textarea,audio")) {
    const canvas = event.target.closest(".ivr-flow-canvas");
    const emptyCanvasHit =
      state.activeTab === "ivr" &&
      canvas &&
      event.button === 0 &&
      !event.target.closest("[data-ivr-card-key], button, input, select, textarea, audio, a, .ivr-context-menu");
    if (!emptyCanvasHit) return;
    state.ivrCanvasPan = {
      canvas,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      scrollLeft: canvas.scrollLeft,
      scrollTop: canvas.scrollTop
    };
    canvas.classList.add("panning");
    canvas.setPointerCapture?.(event.pointerId);
    event.preventDefault();
    return;
  }
  const card = handle.closest("[data-ivr-card-key]");
  if (!card || !state.config) return;
  const left = Number.parseFloat(card.style.left || "0");
  const top = Number.parseFloat(card.style.top || "0");
  state.ivrDrag = {
    key: card.dataset.ivrCardKey,
    card,
    startX: event.clientX,
    startY: event.clientY,
    left,
    top
  };
  card.classList.add("dragging");
  event.preventDefault();
});

document.addEventListener("contextmenu", (event) => {
  const canvas = event.target.closest(".ivr-flow-canvas");
  if (!canvas || state.activeTab !== "ivr") return;
  event.preventDefault();
  rememberIvrViewport();
  if (state.config) collectConfig();
  const space = event.target.closest(".ivr-canvas-space");
  const rect = space?.getBoundingClientRect();
  const menuNode = event.target.closest("[data-ivr-menu]");
  const zoom = ivrZoom();
  const menuWidth = 300;
  const menuHeight = 420;
  const menuMargin = 12;
  const menuClientX = Math.min(Math.max(menuMargin, event.clientX), Math.max(menuMargin, window.innerWidth - menuWidth - menuMargin));
  const menuClientY = Math.min(Math.max(menuMargin, event.clientY), Math.max(menuMargin, window.innerHeight - menuHeight - menuMargin));
  state.ivrContextMenu = {
    clientX: menuClientX,
    clientY: menuClientY,
    x: rect ? (event.clientX - rect.left) / zoom : 320,
    y: rect ? (event.clientY - rect.top) / zoom : 160,
    menuKey: menuNode?.dataset.ivrMenu || "main"
  };
  renderIvr();
  iconRefresh();
});

document.addEventListener("pointermove", (event) => {
  if (state.floatingPhoneResize) {
    const resize = state.floatingPhoneResize;
    const frame = syncFloatingPhoneFrame({
      width: resize.width + event.clientX - resize.startX,
      height: resize.height + event.clientY - resize.startY
    });
    applyFloatingPhoneFrame(frame);
    event.preventDefault();
    return;
  }

  if (state.floatingPhoneDrag) {
    const drag = state.floatingPhoneDrag;
    const frame = syncFloatingPhoneFrame({
      x: drag.x + event.clientX - drag.startX,
      y: drag.y + event.clientY - drag.startY
    });
    applyFloatingPhoneFrame(frame);
    event.preventDefault();
    return;
  }

  if (state.ivrCanvasPan) {
    const { canvas, startX, startY, scrollLeft, scrollTop } = state.ivrCanvasPan;
    canvas.scrollLeft = scrollLeft - (event.clientX - startX);
    canvas.scrollTop = scrollTop - (event.clientY - startY);
    rememberIvrViewport();
    event.preventDefault();
    return;
  }
  if (!state.ivrDrag) return;
  const zoom = ivrZoom();
  const nextX = Math.max(20, state.ivrDrag.left + (event.clientX - state.ivrDrag.startX) / zoom);
  const nextY = Math.max(20, state.ivrDrag.top + (event.clientY - state.ivrDrag.startY) / zoom);
  state.ivrDrag.card.style.left = `${nextX}px`;
  state.ivrDrag.card.style.top = `${nextY}px`;
  updateIvrLinkLayer();
});

document.addEventListener("pointerup", (event) => {
  if (state.floatingPhoneResize || state.floatingPhoneDrag) {
    state.floatingPhoneResize = null;
    state.floatingPhoneDrag = null;
    document.body.classList.remove("floating-phone-interacting");
    event.preventDefault();
    return;
  }

  if (state.ivrCanvasPan) {
    state.ivrCanvasPan.canvas.classList.remove("panning");
    state.ivrCanvasPan.canvas.releasePointerCapture?.(state.ivrCanvasPan.pointerId);
    rememberIvrViewport();
    state.ivrCanvasPan = null;
    event.preventDefault();
    return;
  }
  if (!state.ivrDrag) return;
  rememberIvrViewport();
  const { key, card } = state.ivrDrag;
  setIvrCardPosition(key, Number.parseFloat(card.style.left || "20"), Number.parseFloat(card.style.top || "20"));
  card.classList.remove("dragging");
  state.ivrDrag = null;
  if (state.activeTab === "ivr") {
    renderIvr();
    iconRefresh();
  }
});

document.addEventListener("pointercancel", () => {
  state.floatingPhoneResize = null;
  state.floatingPhoneDrag = null;
  document.body.classList.remove("floating-phone-interacting");
  if (state.ivrCanvasPan) {
    state.ivrCanvasPan.canvas.classList.remove("panning");
    state.ivrCanvasPan = null;
  }
  if (state.ivrDrag) {
    state.ivrDrag.card.classList.remove("dragging");
    state.ivrDrag = null;
  }
});

window.addEventListener("resize", () => {
  if (!state.extensionCall.floatingPhoneOpen) return;
  applyFloatingPhoneFrame(syncFloatingPhoneFrame());
});

document.addEventListener("wheel", (event) => {
  const canvas = event.target.closest(".ivr-flow-canvas");
  if (!canvas || state.activeTab !== "ivr" || !event.ctrlKey) return;
  event.preventDefault();
  const previousZoom = ivrZoom();
  const nextZoom = clampIvrZoom(previousZoom * (event.deltaY < 0 ? 1.1 : 1 / 1.1));
  if (nextZoom === previousZoom) return;

  const rect = canvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const contentX = (canvas.scrollLeft + localX) / previousZoom;
  const contentY = (canvas.scrollTop + localY) / previousZoom;
  state.ivrZoom = nextZoom;
  rememberIvrViewport();
  renderIvr();
  iconRefresh();
  requestAnimationFrame(() => {
    const nextCanvas = $(".ivr-flow-canvas");
    if (!nextCanvas) return;
    nextCanvas.scrollLeft = Math.max(0, contentX * nextZoom - localX);
    nextCanvas.scrollTop = Math.max(0, contentY * nextZoom - localY);
    rememberIvrViewport();
  });
}, { passive: false });

document.addEventListener("input", (event) => {
  if (handleSoftphoneInput(event)) return;
  const overviewSearch = event.target.closest("#overviewSearchInput");
  if (overviewSearch) {
    const cursorPosition = overviewSearch.selectionStart ?? overviewSearch.value.length;
    state.overview.search = overviewSearch.value || "";
    renderOverview();
    iconRefresh();
    requestAnimationFrame(() => {
      const nextSearch = $("#overviewSearchInput");
      if (!nextSearch) return;
      nextSearch.focus();
      nextSearch.setSelectionRange(cursorPosition, cursorPosition);
    });
    return;
  }
  const compactSearch = event.target.closest("[data-compact-search]");
  if (compactSearch) {
    const cursorPosition = compactSearch.selectionStart ?? compactSearch.value.length;
    state.monitorCompact.queueSearch = compactSearch.value || "";
    renderMonitorPreferencesSurface();
    iconRefresh();
    requestAnimationFrame(() => {
      const nextSearch = $("[data-compact-search]");
      if (!nextSearch) return;
      nextSearch.focus();
      nextSearch.setSelectionRange(cursorPosition, cursorPosition);
    });
  }
});

document.addEventListener("change", async (event) => {
  if (event.target.id === "dialerAudioFile") {
    const input = event.target;
    const file = input.files?.[0];
    if (!file) return;
    const form = input.closest("form");
    const button = form.querySelector("[data-upload-dialer-audio]");
    button.disabled = true;
    try {
      const body = new FormData();
      body.append("audio", file);
      const response = await fetch("/api/ivr-audios", { method: "POST", credentials: "same-origin", body });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao enviar áudio.");
      state.ivrAudios = data.audios || [];
      const select = form.querySelector('select[name="audio"]');
      select.innerHTML = audioChoices(data.audio?.playback || "");
      select.value = data.audio?.playback || "";
      setMessage("Áudio selecionado. Salve a campanha e, em URAs, use Salvar e aplicar antes de iniciar.", "ok");
    } catch (error) {
      setMessage(error.message);
    } finally {
      button.disabled = false;
      input.value = "";
    }
    return;
  }
  const userMenuInput = event.target.closest("[data-user-menu]");
  if (userMenuInput) {
    const card = userMenuInput.closest("[data-user-index]");
    const inputs = $all("[data-user-menu]", card);
    const enabled = inputs.filter((input) => input.checked).length;
    const summary = $("[data-user-menu-count]", card);
    const label = $("[data-user-toggle-label]", card);
    if (summary) summary.textContent = `${enabled} de ${inputs.length} modulos`;
    if (label) label.textContent = enabled === inputs.length ? "Limpar" : "Selecionar todos";
    return;
  }

  if (event.target.closest("#overviewQueueFilter")) {
    state.overview.queue = $("#overviewQueueFilter")?.value || "";
    const selectedQueue = selectedOverviewQueue();
    const members = selectedQueue ? overviewQueueMemberNumbers(selectedQueue.queue) : null;
    if (members && state.overview.extension && !members.has(String(state.overview.extension))) {
      state.overview.extension = "";
    }
    renderOverview();
    iconRefresh();
    return;
  }

  if (event.target.closest("#overviewExtensionFilter")) {
    state.overview.extension = $("#overviewExtensionFilter")?.value || "";
    renderOverview();
    iconRefresh();
    return;
  }

  const dialerDestinationType = event.target.closest("[data-dialer-destination-type]");
  if (event.target.matches("[data-dialer-transport]")) {
    syncDialerTransport(event.target.form);
    return;
  }
  if (dialerDestinationType && state.config) {
    const wrapper = dialerDestinationType.parentElement;
    wrapper.innerHTML = dialerDestinationSelect(dialerDestinationType.value, "");
    iconRefresh();
    return;
  }

  if (event.target.matches('[data-ivr-menu-field="id"]')) {
    const menu = ivrMenuByKey(event.target.closest(".ivr-flow-node").dataset.ivrMenu);
    const old = menu.id;
    const next = event.target.value.trim();
    if (!next || !/^[a-zA-Z0-9_.-]+$/.test(next) || ivrMenuRecords().some((r) => r.menu !== menu && r.id.toLowerCase() === next.toLowerCase())) {
      event.target.value = old;
      return setMessage("Use um código único com letras, números, ponto, hífen ou sublinhado.", "error");
    }
    if (next === old) return;
    rememberIvrViewport();
    collectConfig();
    menu.id = next;
    replaceIvrMenuReferences(old, next);
    renderIvr();
    iconRefresh();
    return;
  }
  const timeDestination = event.target.closest("[data-time-destination]");
  if (timeDestination && event.target.matches("select")) {
    rememberIvrViewport();
    if (event.target.matches("[data-ivr-destination-type]")) {
      const conditionId = timeDestination.closest("[data-time-condition-id]").dataset.timeConditionId;
      timeDestination.innerHTML = ivrTargetChoices(event.target.value, "", "", conditionId);
    } else {
      const key = $("[data-ivr-destination-card-key]", timeDestination);
      if (key) key.value = "";
    }
    collectConfig();
    renderIvr();
    iconRefresh();
    return;
  }

  const trunkInboundTypeSelect = event.target.closest("[data-trunk-inbound-type]");
  if (trunkInboundTypeSelect && state.config) {
    const wrapper = trunkInboundTypeSelect.parentElement;
    const currentValue = $("[data-trunk-inbound-value]", wrapper)?.value || "";
    wrapper.innerHTML = trunkInboundChoices(trunkInboundTypeSelect.value, currentValue);
    iconRefresh();
    return;
  }

  const typeSelect = event.target.closest("[data-destination-type]");
  if (!typeSelect || !state.config) return;
  const wrapper = typeSelect.parentElement;
  const currentValue = $("[data-destination-value]", wrapper)?.value || "";
  wrapper.innerHTML = destinationChoices(typeSelect.value, currentValue);
  iconRefresh();
});

window.addEventListener("popstate", () => {
  if (!state.user) return;
  if (state.config) collectConfig();
  const nextTab = tabFromCurrentPath();
  if (nextTab === "ivr") {
    const editId = new URLSearchParams(window.location.search).get("edit");
    if (editId) openIvrBuilder(editId);
    else closeIvrBuilder();
  }
  setActiveTab(nextTab, { collect: false, load: true }).catch((error) => setMessage(error.message || "Falha ao abrir pagina."));
});

async function boot() {
  const [adminResponse, extensionResponse] = await Promise.all([
    api("/api/me"),
    api("/api/extensions/me")
  ]);
  state.user = adminResponse.user;
  restoreViewPreferences();
  state.extensionSession = state.user ? null : extensionResponse.extension;
  renderShell();
  updateTopbarActions();
  if (state.user) {
    if (state.user.mustChangePassword) return;
    await loadConfig();
    await loadTabData(state.activeTab);
  } else if (state.extensionSession) {
    await loadExtensionPortal();
    await loadExtensionStatus();
    autoRegisterSoftphone();
  }
}

applyTheme();

boot().catch(() => {
  renderShell();
  applyTheme();
});

updateOperationalClock();
setInterval(updateOperationalClock, 1000);

setInterval(() => {
  if (!document.hidden && state.user && state.config && state.activeTab === "status") {
    loadPbxStatus({ background: true }).catch(() => {});
  }
}, MONITOR_REFRESH_MS);

setInterval(() => {
  if (!document.hidden && state.user && state.config && ["overview", "logs", "security", "reports"].includes(state.activeTab)) {
    loadPbxStatus({ background: true }).catch(() => {});
  }
}, BACKGROUND_STATUS_REFRESH_MS);

setInterval(() => {
  if (!document.hidden && state.user && state.config && state.activeTab === "dialer") {
    loadDialerCampaigns({ background: true }).catch(() => {});
  }
}, 5000);

setInterval(() => {
  if (!document.hidden && state.user && state.config && state.activeTab === "trunk") {
    loadTrunkRegistrations().catch(() => {});
  }
}, 15000);

setInterval(() => {
  if (!document.hidden && state.user && state.config && state.activeTab === "overview") {
    loadOverviewData(state.overview.date, { background: true }).catch(() => {});
  }
}, 30000);

setInterval(() => {
  if (state.extensionSession) {
    extensionSipRecovery.check("verificação periódica");
    loadExtensionStatus({ background: true }).catch(() => {});
  }
}, MONITOR_REFRESH_MS);

window.addEventListener("online", () => extensionSipRecovery.check("rede restabelecida", true));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) extensionSipRecovery.check("navegador retomado", true);
});

setInterval(() => {
  if (state.extensionSession && (currentExtensionPauseInfo().paused || isExtensionCallActive())) {
    const extensionRoot = $("#extensionView");
    renderSurfaceInBackground(extensionRoot, renderExtensionPortal);
  }
}, 1000);

window.addEventListener("pagehide", notifyExtensionLogoutOnClose);
window.addEventListener("pagehide", persistViewPreferences);
