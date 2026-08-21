const MONITOR_REFRESH_MS = 1000;
const BACKGROUND_STATUS_REFRESH_MS = 15000;
const WEB_SIP_REGISTER_EXPIRES_SECONDS = 8 * 60 * 60;
const PAUSE_REASONS = ["Cafezinho", "Almoço", "Treinamento", "Atendimento presencial"];

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
  ["duration", "Duracao atual"],
  ["number", "Numero em ligacao"],
  ["pause", "Pausa"],
  ["idle", "Tempo ocioso"],
  ["online", "Tempo online"]
];
const compactMonitorStatusOptions = [
  ["available", "Disponivel"],
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
    session: null,
    status: "desconectado",
    message: "",
    dialNumber: "",
    transferTarget: "",
    muted: false,
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
  extensionCall: initialExtensionCallState(),
  config: null,
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
    dashboard: {},
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
  dialerEditingId: "",
  ivrZoom: 1,
  ivrViewport: null,
  ivrViewports: {},
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
  overview: "Visao Estrategica",
  status: "Monitor de Filas",
  trunk: "Tronco SIP",
  extensions: "Ramais SIP",
  routing: "Rotas e permissoes",
  ivr: "Construtor URA",
  dialer: "Discador",
  audios: "Gravacoes",
  queues: "Grupos e filas",
  security: "Seguranca",
  logs: "Sistema",
  reports: "Relatorios PBX",
  audit: "Auditoria",
  users: "Usuarios"
};

const subtitleByTab = {
  overview: "Indicadores, tendencias e desempenho do atendimento",
  status: "Acompanhamento em tempo real de filas e agentes",
  trunk: "Conectividade SIP e entradas da operadora",
  extensions: "Cadastro, presenca e recursos dos ramais",
  routing: "Regras de entrada, saida e permissoes",
  ivr: "Fluxos de atendimento automatico",
  dialer: "Campanhas e chamadas de saida",
  audios: "Pesquisa, reproducao e organizacao das gravacoes",
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
    tabs: ["overview", "status", "reports", "queues", "extensions", "dialer"]
  },
  {
    label: "Telefonia",
    icon: "phone",
    tabs: ["trunk", "routing", "ivr", "audios"]
  },
  {
    label: "Governanca",
    icon: "shield-check",
    tabs: ["logs", "security", "audit", "users"]
  }
];

const adminOnlyTabs = new Set(["trunk", "extensions", "routing", "ivr", "dialer", "audios", "queues", "logs", "security", "audit", "users"]);

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
const timeoutDestinationOptions = [
  ["201", "201 Recepcao"],
  ["202", "202 Financeiro"],
  ["203", "203 Comercial"],
  ["204", "204 Suporte"],
  ["205", "205 Diretoria"]
];

function $(selector, root = document) {
  return root.querySelector(selector);
}

function $all(selector, root = document) {
  return Array.from(root.querySelectorAll(selector));
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

function iconRefresh() {
  if (window.lucide) window.lucide.createIcons();
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
  stopIncomingRingtone();
  await terminateSipSession(state.extensionCall.consultSession).catch(() => {});
  await terminateSipSession(state.extensionCall.session).catch(() => {});
  if (state.extensionCall.registerer) await state.extensionCall.registerer.unregister().catch(() => {});
  if (state.extensionCall.ua) await state.extensionCall.ua.stop().catch(() => {});
}

function notifyExtensionLogoutOnClose() {
  if (!state.extensionSession) return;
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
  const tokens = queueItem.tokens || [];
  const haystack = [
    call.queue,
    call.destination,
    call.originalDestination,
    call.dst,
    call.context,
    call.lastApp,
    call.lastData,
    call.lastdata,
    call.channel,
    call.destinationChannel
  ].map((value) => String(value || "").toLowerCase());
  return tokens.some((token) => {
    const normalized = String(token || "").toLowerCase();
    if (!normalized) return false;
    return haystack.some((value) =>
      value === normalized ||
      value.includes(`queue-${normalized}`) ||
      value.includes(`queue(${normalized}`) ||
      value.includes(`${normalized},`) ||
      value.includes(`/${normalized}`) ||
      value.includes(` ${normalized} `)
    );
  });
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
    ["extension", "Ramal", extensionOptions],
    ["ivr", "URA", [[cfg.ivr.id, cfg.ivr.name]]],
    ["ringGroup", "Grupo", cfg.ringGroups.map((group) => [group.id, group.name])],
    ["queue", "Fila", cfg.queues.map((queue, index) => [queue.id, queueLabel(queue, index)])],
    ["voicemail", "Voicemail", cfg.extensions.map((ext) => [ext.number, `${ext.number} ${ext.name}`])],
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
  if (type === "extension" && value === "700") return "700 URA principal";
  if (type === "extension" || type === "voicemail") {
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
  return ivrMenuRecords().find((record) => record.id === key || record.key === key) || ivrMenuRecords()[0];
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
    ["voicemail", "Voicemail", cfg.extensions.map((ext) => [ext.number, `${ext.number} ${ext.name}`])],
    ["ivr", "Menu URA", menus],
    ["trunk", "Tronco", ensureConfigTrunks().map((trunk) => [trunk.id, trunkLabel(trunk)])],
    ["timeCondition", "Horario", timeConditions]
  ];
  return `
    <select data-ivr-destination-type>
      ${groups.map(([type, label]) => option(type, selectedType, label)).join("")}
    </select>
    <select data-ivr-destination-value>
      ${groups
        .find(([type]) => type === selectedType)?.[2]
        .map(([value, label]) => option(value, selectedValue, label))
        .join("") || option(selectedValue, selectedValue)}
    </select>
  `;
}

function ivrOptionDestinationLabel(item) {
  if (!item.destination) return "Sem destino";
  if (item.destinationType === "ivr") return `Menu ${ivrMenuLabel(item.destination)}`;
  return destinationLabel(item.destinationType, item.destination);
}

function ensureIvrLooseOptions() {
  const ivr = state.config.ivr;
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
  const id = `horario-${Date.now().toString(36)}`;
  const firstExtension = state.config.extensions?.[0]?.number || "201";
  return {
    id,
    name: "Horario",
    start: "08:00",
    end: "18:00",
    weekdays: "mon-fri",
    inDestinationType: "extension",
    inDestination: firstExtension,
    outDestinationType: "extension",
    outDestination: firstExtension
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

function ivrTargetKey(type, value) {
  return `${type}:${value}`;
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
      pipWindow.lucide?.createIcons?.();
    } catch (_error) {}
  };
  if (pipWindow.lucide) {
    run();
    return;
  }
  if (pipWindow.document.querySelector("[data-pip-lucide]")) return;
  const script = pipWindow.document.createElement("script");
  script.src = "https://unpkg.com/lucide@latest/dist/umd/lucide.min.js";
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
  const mainIndex = (state.config.ivr.options || []).findIndex((item) => item.nodeId === nodeId);
  if (mainIndex >= 0) return { source: "menu", menu: state.config.ivr, menuKey: "main", index: mainIndex, item: state.config.ivr.options[mainIndex] };
  const menus = ensureIvrMenus();
  for (let menuIndex = 0; menuIndex < menus.length; menuIndex += 1) {
    const optionIndex = (menus[menuIndex].options || []).findIndex((item) => item.nodeId === nodeId);
    if (optionIndex >= 0) return { source: "menu", menu: menus[menuIndex], menuKey: String(menuIndex), index: optionIndex, item: menus[menuIndex].options[optionIndex] };
  }
  const looseOptions = ensureIvrLooseOptions();
  const looseIndex = looseOptions.findIndex((item) => item.nodeId === nodeId);
  if (looseIndex >= 0) return { source: "loose", menu: null, menuKey: "", index: looseIndex, item: looseOptions[looseIndex] };
  return null;
}

function removeIvrOptionFromCurrentSource(found) {
  if (!found) return null;
  if (found.source === "loose") return ensureIvrLooseOptions().splice(found.index, 1)[0] || null;
  found.menu.options = found.menu.options || [];
  return found.menu.options.splice(found.index, 1)[0] || null;
}

function eachIvrOption(callback) {
  [state.config.ivr, ...ensureIvrMenus(), { options: ensureIvrLooseOptions() }].forEach((menu) => {
    (menu.options || []).forEach((item) => callback(item));
  });
}

function clearIvrDestinationLinks(type, value) {
  let removed = 0;
  eachIvrOption((item) => {
    if (item.destinationType === type && item.destination === value) {
      item.destinationType = "";
      item.destination = "";
      removed += 1;
    }
  });
  eachIvrTimeCondition((condition) => {
    if (condition.inDestinationType === type && condition.inDestination === value) {
      condition.inDestinationType = "";
      condition.inDestination = "";
      removed += 1;
    }
    if (condition.outDestinationType === type && condition.outDestination === value) {
      condition.outDestinationType = "";
      condition.outDestination = "";
      removed += 1;
    }
  });
  return removed;
}

function replaceIvrMenuReferences(oldId, nextId = "") {
  if (!oldId) return;
  eachIvrOption((item) => {
    if (item.destinationType === "ivr" && item.destination === oldId) {
      item.destination = nextId;
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
    if (queue.fallback === number) queue.fallback = nextFallback;
  });
  state.config.ringGroups.forEach((group) => {
    group.members = (group.members || []).filter((member) => member !== number);
    if (group.fallback === number) group.fallback = nextFallback;
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
  const allowedTypes = ["extension", "voicemail", "queue", "ringGroup", "timeCondition", "trunk"];
  if (!allowedTypes.includes(type)) return { ok: false, message: "Tipo de card nao suportado para exclusao." };
  const hiddenCards = ensureHiddenTargetCards();
  const key = ivrTargetKey(type, value);
  if (!hiddenCards.includes(key)) hiddenCards.push(key);
  clearIvrDestinationLinks(type, value);
  return { ok: true, message: "Card removido da URA sem apagar o recurso do sistema." };
}

function hideIvrEntryNode() {
  const ivr = state.config.ivr;
  ivr.hideEntryNode = true;
  return { ok: true, message: "Entrada antiga removida. O tronco principal agora representa a entrada da URA." };
}

function revealIvrTargetCard(type, value, x, y) {
  const hiddenCards = ensureHiddenTargetCards();
  const key = ivrTargetKey(type, value);
  const hiddenIndex = hiddenCards.indexOf(key);
  if (hiddenIndex >= 0) hiddenCards.splice(hiddenIndex, 1);
  setIvrCardPosition(key, x, y);

  if (state.ivrLinkSource?.type === "option-target") {
    const found = findIvrOptionByNodeId(state.ivrLinkSource.nodeId);
    if (found?.item) {
      found.item.destinationType = type;
      found.item.destination = value;
      state.ivrLinkSource = null;
      return "connected";
    }
  }

  return hiddenIndex >= 0 ? "restored" : "positioned";
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
    ...cfg.extensions.filter((ext) => ext.voicemail !== false).map((ext, index) => ({
      key: `voicemail:${ext.number}`,
      type: "voicemail",
      value: ext.number,
      title: `Voicemail ${ext.number}`,
      subtitle: ext.name || "Caixa postal",
      icon: "voicemail",
      x: 1520,
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
  return [...baseTargets, ...duplicateTargets].filter((target) => !hiddenCards.has(target.key));
}

function ivrTargetCardByDestination(type, value) {
  if (type === "ivr") return `menu:${value || "main"}`;
  return `${type}:${value}`;
}

function trunkChoices(selected) {
  return ensureConfigTrunks()
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
    ["ivr", "URA", menus],
    ["queue", "Fila", cfg.queues.map((queue, index) => [queue.id, queueLabel(queue, index)])],
    ["ringGroup", "Grupo", cfg.ringGroups.map((group) => [group.id, group.name])],
    ["extension", "Ramal", cfg.extensions.map((ext) => [ext.number, `${ext.number} ${ext.name}`])],
    ["voicemail", "Voicemail", cfg.extensions.map((ext) => [ext.number, `${ext.number} ${ext.name}`])],
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
    inboundDestination: trunk.inboundDestination || "main",
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
    if (!canAccessTab(state.activeTab)) {
      state.activeTab = firstAllowedTab();
      window.history.replaceState({ tab: state.activeTab }, "", routeForTab(state.activeTab));
    }
    syncActiveTabUi();
  }
  renderDesktopNotificationButton();
  iconRefresh();
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

async function loadTabData(tab = state.activeTab) {
  if (!state.config) return;
  if (tab === "reports") await loadPbxStatus();
  if (["overview", "reports"].includes(tab)) await loadReports();
  if (tab === "status") await loadPbxStatus();
  if (tab === "users") await loadUsers();
  if (tab === "audit") await loadAudit();
  if (tab === "dialer") await loadDialerCampaigns();
  if (tab === "logs") {
    await loadPbxStatus();
    await loadOutboundDiagnostics($("#dialTestNumber")?.value || "", state.config?.extensions?.[0]?.number || "201");
    renderLogs();
    iconRefresh();
  }
  if (tab === "ivr") await loadIvrAudios();
  if (tab === "audios") {
    await Promise.all([loadRecordingLibrary(), loadIvrAudios()]);
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
  if (collect && state.config) collectConfig();
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
  if (load) await loadTabData(nextTab);
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
    const number = call.type === "outbound" ? call.destination : call.source;
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
  const localRegistered = ["registrado", "originando", "chamando", "tocando", "em chamada"].includes(String(state.extensionCall.status || "").toLowerCase());
  const isRegistered = Boolean(live.registered || localRegistered);
  const registered = isRegistered ? "Online" : "Offline";
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
  const consultActive = Boolean(state.extensionCall.consultSession);
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
      <div class="phone-display">
        <input id="extensionDialNumber" value="${escapeHtml(state.extensionCall.dialNumber)}" inputmode="tel" placeholder="Numero" ${callLocked} />
      </div>
      ${incomingBanner}
      <div class="dialpad">${dialpad}</div>
      <div class="call-actions">
        <button id="softphoneCallBtn" class="primary-btn" type="button" ${callLocked}><i data-lucide="phone-call"></i>Ligar</button>
        <button id="softphoneAnswerBtn" class="secondary-btn hidden" type="button"><i data-lucide="phone-forwarded"></i>Atender</button>
        <button id="softphoneHangupBtn" class="secondary-btn danger ${activeCall ? "hidden" : ""}" type="button"><i data-lucide="phone-off"></i>Encerrar</button>
      </div>
      ${activeChannel ? `<div class="call-actions"><button id="serverHangupBtn" class="icon-btn danger" type="button" data-channel="${escapeHtml(activeChannel.channel)}" title="Derrubar canal"><i data-lucide="unlink"></i></button></div>` : ""}
      <div class="transfer-box">
        <input id="extensionTransferTarget" value="${escapeHtml(state.extensionCall.transferTarget)}" inputmode="tel" placeholder="Ramal para transferencia assistida" />
        <button id="assistedTransferStartBtn" class="secondary-btn" type="button"><i data-lucide="messages-square"></i>Transferencia Assistida</button>
      </div>
      ${consultActive ? `
        <div class="assisted-transfer-panel">
          <span>Transferencia assistida</span>
          <strong>${escapeHtml(state.extensionCall.consultTarget || "-")}</strong>
          <small>${escapeHtml(state.extensionCall.consultStatus || "Consultando ramal")}</small>
          <div>
            <button id="assistedTransferCompleteBtn" class="primary-btn" type="button"><i data-lucide="check"></i>Confirmar</button>
            <button id="assistedTransferCancelBtn" class="secondary-btn danger" type="button"><i data-lucide="x"></i>Cancelar</button>
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

async function loadExtensionStatus({ preserveDraft = false } = {}) {
  if (!state.extensionSession) return;
  try {
    state.extensionStatus = await api("/api/extensions/status");
    syncExtensionPauseState();
    const draft = preserveDraft ? captureSurfaceDraft($("#extensionView")) : null;
    renderExtensionPortal();
    restoreSurfaceDraft($("#extensionView"), draft);
  } catch (error) {
    if (isExtensionAuthError(error)) {
      await resetExtensionSessionAfterAuthError();
      return;
    }
    throw error;
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
  const localModes = state.user?.role === "admin" || state.user?.permissions?.interveneCalls
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
  audio.play().catch(() => {});
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
      const mode = monitorSpyMode(state.monitorSpy.mode);
      const modeConfig = MONITOR_SPY_MODES[mode];
      state.monitorSpy.session = invitation;
      state.monitorSpy.busy = true;
      state.monitorSpy.status = "Conectando";
      state.monitorSpy.output = `${modeConfig.label} conectando no navegador...`;
      invitation.delegate = {
        ...(invitation.delegate || {}),
        onBye() {
          state.monitorSpy.session = null;
          state.monitorSpy.busy = false;
          state.monitorSpy.status = "Encerrada";
          state.monitorSpy.output = "Escuta encerrada.";
          renderMonitorSpyPortal();
        },
        onCancel() {
          state.monitorSpy.session = null;
          state.monitorSpy.busy = false;
          state.monitorSpy.status = "Cancelada";
          state.monitorSpy.output = "Escuta cancelada.";
          renderMonitorSpyPortal();
        }
      };
      const sessionState = window.SIP?.SessionState || {};
      invitation.stateChange?.addListener?.((nextState) => {
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

async function stopMonitorSpy() {
  const session = state.monitorSpy.session;
  state.monitorSpy.busy = true;
  state.monitorSpy.status = "Encerrando";
  renderMonitorSpyPortal();
  if (session) await terminateSipSession(session);
  await api("/api/pbx/monitor/action", {
    method: "POST",
    body: JSON.stringify({ action: "hangup-monitor-spy" })
  }).catch(() => null);
  state.monitorSpy.session = null;
  await disposeMonitorSpySoftphone();
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
  state.monitorSpy.mode = mode;
  state.monitorSpy.busy = true;
  state.monitorSpy.status = "Registrando monitor";
  state.monitorSpy.output = "Preparando o canal seguro de audio...";
  renderMonitorSpyPortal();
  try {
    await prepareMonitorSpySoftphone();
    state.monitorSpy.status = "Conectando";
    state.monitorSpy.output = `Abrindo ${modeConfig.label.toLowerCase()} na chamada do operador...`;
    renderMonitorSpyPortal();
    await api("/api/pbx/monitor/action", {
      method: "POST",
      body: JSON.stringify({ action: "spy-browser", target, mode })
    });
    state.monitorSpy.output = "Solicitacao enviada ao Asterisk.";
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

async function startSoftphone() {
  const sip = state.extensionPortal?.sip;
  if (!sip) await loadExtensionPortal();
  await waitForSipLibrary();
  if (state.extensionCall.ua) return;

  const userAgent = new SIP.UserAgent({
    uri: SIP.UserAgent.makeURI(state.extensionPortal.sip.uri),
    authorizationUsername: state.extensionPortal.sip.authorizationUsername,
    authorizationPassword: state.extensionPortal.sip.password,
    displayName: state.extensionPortal.sip.displayName,
    transportOptions: { server: state.extensionPortal.sip.wsServer },
    sessionDescriptionHandlerFactoryOptions: {
      constraints: { audio: true, video: false }
    }
  });

  userAgent.delegate = {
    async onInvite(invitation) {
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

  state.extensionCall.ua = userAgent;
  state.extensionCall.registerer = new SIP.Registerer(userAgent, { expires: WEB_SIP_REGISTER_EXPIRES_SECONDS });
  await userAgent.start();
  await state.extensionCall.registerer.register();
  state.extensionCall.status = "registrado";
  setExtensionMessage("Ramal online no navegador.", "ok");
  renderExtensionPortal();
}

async function refreshSoftphoneRegistration() {
  await startSoftphone();
  if (!state.extensionCall.registerer) return;
  await state.extensionCall.registerer.register();
  state.extensionCall.status = "registrado";
  await wait(500);
  await loadExtensionStatus().catch(() => {});
}

async function autoRegisterSoftphone() {
  if (!state.extensionSession || state.extensionCall.ua) return;
  state.extensionCall.status = "registrando";
  renderExtensionPortal();
  try {
    await startSoftphone();
    await loadExtensionStatus();
  } catch (error) {
    setExtensionMessage(`Registro automatico pendente: ${error.message}`, "error");
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
  await session.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } } });
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
  const targetNumber = String(state.extensionCall.transferTarget || "").trim();
  const session = state.extensionCall.session;
  if (!targetNumber || !session?.refer) throw new Error("Transferencia SIP indisponivel");
  const target = SIP.UserAgent.makeURI(`sip:${targetNumber}@${state.extensionPortal.sip.domain}`);
  await session.refer(target);
  setExtensionMessage("Transferencia enviada.", "ok");
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
  const targetNumber = String(state.extensionCall.transferTarget || "").trim();
  const session = state.extensionCall.session;
  if (!targetNumber || !session?.refer || !state.extensionCall.ua) throw new Error("Transferencia assistida indisponivel");
  if (state.extensionCall.consultSession) throw new Error("Ja existe uma consulta em andamento");

  await setSoftphoneHold(true);
  const target = SIP.UserAgent.makeURI(`sip:${targetNumber}@${state.extensionPortal.sip.domain}`);
  if (!target || !SIP.Inviter) throw new Error("Nao foi possivel chamar o ramal de destino");

  const consultSession = new SIP.Inviter(state.extensionCall.ua, target, {
    sessionDescriptionHandlerOptions: { constraints: { audio: true, video: false } }
  });
  state.extensionCall.consultSession = consultSession;
  state.extensionCall.consultTarget = targetNumber;
  state.extensionCall.consultStatus = "Chamando ramal";
  watchConsultTransferSession(consultSession);
  renderExtensionPortal();
  try {
    await consultSession.invite();
    setExtensionMessage(`Consultando ramal ${targetNumber}. Cliente em espera.`, "info");
  } catch (error) {
    clearConsultTransferState();
    await setSoftphoneHold(false);
    throw error;
  }
}

async function completeAssistedTransfer() {
  const session = state.extensionCall.session;
  const consultSession = state.extensionCall.consultSession;
  if (!session?.refer || !consultSession) throw new Error("Nenhuma transferencia assistida em andamento");
  const sessionState = window.SIP?.SessionState || {};
  if (consultSession.state !== sessionState.Established) throw new Error("Aguarde o ramal de destino atender para confirmar");

  await session.refer(consultSession);
  setExtensionMessage("Transferencia assistida confirmada.", "ok");
  setTimeout(() => {
    terminateSipSession(session).catch(() => {});
    terminateSipSession(consultSession).catch(() => {});
  }, 700);
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
  await terminateSipSession(state.extensionCall.consultSession);
  clearConsultTransferState();
  await setSoftphoneHold(false);
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
  $("#saveBtn")?.classList.toggle("hidden", !isAdmin || !editableTabs.includes(state.activeTab));
}

async function loadConfig() {
  state.config = await api("/api/config");
  renderAll();
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

function compactQueueHeader(queue = {}) {
  return `${monitorNumber(queue.completed)} | ${monitorNumber(queue.abandoned)}`;
}

function renderMonitorCompactSettings(queues = []) {
  if (!state.monitorCompact.settingsOpen) return "";
  const prefs = state.monitorCompact;
  const search = String(prefs.queueSearch || "").trim().toLowerCase();
  const hidden = new Set((prefs.hiddenQueues || []).map(String));
  const queueOptions = queues
    .map((queue, index) => ({ queue, index, id: queueCompactId(queue, index), label: `${queue.name || queue.id || "Fila"} (${queue.id || "-"})` }))
    .filter((item) => !search || item.label.toLowerCase().includes(search))
    .map(
      ({ id, label }) => `
        <label class="compact-option-row">
          <span>${escapeHtml(label)}</span>
          <input type="checkbox" data-compact-queue="${escapeHtml(id)}" ${hidden.has(id) ? "" : "checked"} />
        </label>`
    )
    .join("");
  const fieldOptions = compactMonitorFieldOptions
    .map(
      ([key, label]) => `
        <label class="compact-option-row">
          <span>${escapeHtml(label)}</span>
          <input type="checkbox" data-compact-field="${escapeHtml(key)}" ${prefs.fields?.[key] === false ? "" : "checked"} />
        </label>`
    )
    .join("");
  const statusOptions = compactMonitorStatusOptions
    .map(
      ([key, label]) => `
        <label class="compact-option-row">
          <span>${escapeHtml(label)}</span>
          <input type="checkbox" data-compact-status="${escapeHtml(key)}" ${prefs.statuses?.[key] === false ? "" : "checked"} />
        </label>`
    )
    .join("");

  return `
    <div class="modal-backdrop" data-monitor-compact-close></div>
    <section class="modal-card monitor-compact-settings" role="dialog" aria-modal="true" aria-label="Opcoes do monitor compacto">
      <header>
        <div>
          <p class="eyebrow">Monitor compacto</p>
          <h3>Campos e filas visiveis</h3>
          <p class="hint">Preferencia salva apenas neste navegador.</p>
        </div>
        <button class="icon-btn" data-monitor-compact-close type="button" title="Fechar"><i data-lucide="x"></i></button>
      </header>
      <div class="compact-settings-grid">
        <section>
          <div class="compact-settings-title">
            <h3>Filas</h3>
            <span>
              <button class="text-btn" data-compact-select-queues="all" type="button">Todas</button>
              <button class="text-btn" data-compact-select-queues="none" type="button">Nenhuma</button>
            </span>
          </div>
          <input data-compact-search type="search" placeholder="Buscar filas" value="${escapeHtml(prefs.queueSearch || "")}" />
          <div class="compact-option-list">${queueOptions || `<p class="hint">Nenhuma fila encontrada.</p>`}</div>
        </section>
        <section>
          <div class="compact-settings-title"><h3>Campos</h3></div>
          <div class="compact-option-list">${fieldOptions}</div>
          <div class="compact-settings-title second"><h3>Status</h3></div>
          <div class="compact-option-list">${statusOptions}</div>
        </section>
      </div>
      <div class="modal-actions">
        <button class="secondary-btn" data-compact-reset type="button"><i data-lucide="rotate-ccw"></i>Restaurar</button>
        <button class="primary-btn" data-monitor-compact-close type="button">Concluir</button>
      </div>
    </section>
  `;
}

function renderCompactMonitor(queues = [], waitingCalls = [], totals = {}, lastReadLabel = "", trunkStatus = "", trunkTone = "warn", liveLabel = "") {
  const prefs = state.monitorCompact;
  const visibleQueues = visibleCompactQueues(queues);
  const searchValue = String(prefs.queueSearch || "");
  const compactPanels = commandCenterQueueCards(visibleQueues, "", searchValue);
  const waitingRows = waitingCalls
    .map(
      (call) => `
        <article class="mini-monitor-card waiting-call-card">
          <div>
            <strong>#${monitorNumber(call.position)} ${escapeHtml(call.callerId || "-")}</strong>
            <span>${escapeHtml(call.queueName || call.queue || "-")}</span>
            <span>${escapeHtml(call.wait || "-")}</span>
          </div>
          <button class="secondary-btn compact" data-transfer-waiting="${escapeHtml(call.channel || "")}" ${call.channel ? "" : "disabled"}><i data-lucide="send"></i>Transferir</button>
        </article>`
    )
    .join("");

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
            <h3>Monitor de Filas</h3>
            <span><i class="command-live-dot"></i> ${escapeHtml(liveLabel)}</span>
          </div>
          <div class="command-monitor-tools">
            <label class="command-search" title="Buscar fila ou ramal">
              <i data-lucide="search"></i>
              <input data-compact-search type="search" placeholder="Buscar fila ou ramal..." value="${escapeHtml(searchValue)}" />
            </label>
            <span class="badge ${trunkTone}">Tronco ${escapeHtml(trunkStatus)}</span>
            <button id="monitorCompactSettingsBtn" class="secondary-btn compact" type="button"><i data-lucide="columns-3"></i>Colunas</button>
            <button id="monitorViewToggleBtn" class="icon-btn" type="button" title="Abrir monitor completo"><i data-lucide="maximize-2"></i></button>
            <button id="refreshPbxStatusBtn" class="icon-btn" type="button" title="Atualizar agora"><i data-lucide="rotate-cw"></i></button>
          </div>
        </header>
        <div class="compact-queue-grid command-queue-grid">
          ${compactPanels || `<div class="command-empty"><i data-lucide="search-x"></i><strong>Nenhuma fila encontrada</strong><span>Revise a busca ou as filas visiveis.</span></div>`}
        </div>
        <footer class="command-monitor-footer">
          <div class="command-legend">
            <strong>Legenda:</strong>
            <span><i class="agent-state-dot available"></i>Disponivel</span>
            <span><i class="agent-state-dot paused"></i>Em pausa</span>
            <span><i class="agent-state-dot unavailable"></i>Inativo</span>
            <span><i class="agent-state-dot busy"></i>Em ligacao</span>
          </div>
          <span>Atualizado em ${escapeHtml(lastReadLabel)}</span>
        </footer>
      </section>
      <section class="panel monitor-waiting monitor-waiting-final">
        <div class="panel-header">
          <h3>Chamadas em espera</h3>
          <span class="badge ${waitingCalls.length ? "warn" : "ok"}">${monitorNumber(waitingCalls.length)}</span>
        </div>
        <div class="mini-monitor-list waiting-call-list">${waitingRows || `<p class="hint">Nenhuma chamada aguardando atendimento.</p>`}</div>
      </section>
    </div>
    ${state.activeTab === "status" ? renderMonitorCompactSettings(queues) : ""}
  `;
}

function renderMonitorSpyModal() {
  if (!state.monitorSpy?.open) return "";
  const target = String(state.monitorSpy.target || "");
  const targetExtension = (state.config.extensions || []).find((extension) => String(extension.number) === target);
  const listening = Boolean(state.monitorSpy.session);
  const busy = Boolean(state.monitorSpy.busy);
  const locked = listening || busy;
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
        <button class="primary-btn" id="monitorSpyStartBtn" type="button" ${locked ? "disabled" : ""}><i data-lucide="${modeConfig.icon}"></i>${escapeHtml(busy ? "Conectando..." : modeConfig.actionLabel)}</button>
      </div>
    </section>
  `;
}

function renderMonitorSpyPortal() {
  if (!monitorSpyPortal) return;
  monitorSpyPortal.innerHTML = renderMonitorSpyModal();
  restoreMonitorSpyAudio();
  iconRefresh();
}

function captureCompactSettingsViewport() {
  if (!state.monitorCompact?.settingsOpen) return null;
  const modal = $(".monitor-compact-settings");
  if (!modal) return null;
  const active = document.activeElement;
  return {
    modalScrollTop: modal.scrollTop,
    listScrollTops: $all(".monitor-compact-settings .compact-option-list").map((list) => list.scrollTop),
    searchFocused: active?.matches?.("[data-compact-search]") || false,
    searchSelectionStart: active?.selectionStart ?? null,
    searchSelectionEnd: active?.selectionEnd ?? null
  };
}

function restoreCompactSettingsViewport(snapshot) {
  if (!snapshot || !state.monitorCompact?.settingsOpen) return;
  requestAnimationFrame(() => {
    const modal = $(".monitor-compact-settings");
    if (!modal) return;
    modal.scrollTop = snapshot.modalScrollTop || 0;
    $all(".monitor-compact-settings .compact-option-list").forEach((list, index) => {
      list.scrollTop = snapshot.listScrollTops?.[index] || 0;
    });
    if (snapshot.searchFocused) {
      const search = $("[data-compact-search]");
      if (!search) return;
      search.focus();
      if (snapshot.searchSelectionStart !== null) {
        search.setSelectionRange(snapshot.searchSelectionStart, snapshot.searchSelectionEnd ?? snapshot.searchSelectionStart);
      }
    }
  });
}

function renderStatus() {
  const compactSettingsViewport = captureCompactSettingsViewport();
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
              <span class="hint">Fila ${escapeHtml(queue.id)} · ${escapeHtml(queue.strategy || "sem estrategia")}</span>
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

  const waitingRows = waitingCalls
    .map(
      (call) => `
        <article class="mini-monitor-card waiting-call-card">
          <div>
            <strong>#${monitorNumber(call.position)} ${escapeHtml(call.callerId || "-")}</strong>
            <span>${escapeHtml(call.queueName || call.queue || "-")}</span>
            <span>${escapeHtml(call.wait || "-")}</span>
          </div>
          <button class="secondary-btn compact" data-transfer-waiting="${escapeHtml(call.channel || "")}" ${call.channel ? "" : "disabled"}><i data-lucide="send"></i>Transferir</button>
        </article>`
    )
    .join("");
  const lastReadLabel = status?.checkedAt ? new Date(status.checkedAt).toLocaleString("pt-BR") : "ainda nao carregada";
  const liveLabel = "Ao Vivo";

  if (state.monitorCompact.view === "compact") {
    monitorStatusContent.innerHTML = renderCompactMonitor(queues, waitingCalls, totals, lastReadLabel, trunkStatus, trunkTone, liveLabel);
    restoreCompactSettingsViewport(compactSettingsViewport);
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
          <button id="monitorCompactSettingsBtn" class="icon-btn" type="button" title="Opcoes do compacto"><i data-lucide="settings"></i></button>
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
    ${state.activeTab === "status" ? renderMonitorCompactSettings(queues) : ""}
  `;
  restoreCompactSettingsViewport(compactSettingsViewport);
}

function renderFlow() {
  renderIvr();
}

function commandCenterQueueCards(queues = [], extensionFilter = "", searchValue = "") {
  const fields = state.monitorCompact.fields || {};
  const statuses = state.monitorCompact.statuses || {};
  const search = String(searchValue || "").trim().toLowerCase();
  const columnCount = 2 + ["calls", "duration", "number", "pause", "idle", "online"].filter((key) => fields[key] !== false).length;
  return queues
    .map((queue, queueIndex) => {
      const queueText = `${queue.name || ""} ${queue.id || queue.number || ""}`.toLowerCase();
      const queueMatchesSearch = !search || queueText.includes(search);
      const agents = (queue.agents || []).filter((agent) => {
        const tone = monitorStatusTone(agent.statusTone || agent.status);
        if (statuses[tone] === false) return false;
        if (extensionFilter && String(agent.number || "") !== String(extensionFilter)) return false;
        if (queueMatchesSearch) return true;
        return `${agent.name || ""} ${agent.number || ""}`.toLowerCase().includes(search);
      });
      if ((extensionFilter || search) && !agents.length && !queueMatchesSearch) return "";
      const headers = [
        fields.calls === false ? "" : "<th>F/R</th>",
        fields.duration === false ? "" : "<th>Dura.</th>",
        fields.number === false ? "" : "<th>Numero</th>",
        fields.pause === false ? "" : "<th>Pausa</th>",
        fields.idle === false ? "" : "<th>Ocioso</th>",
        fields.online === false ? "" : "<th>Online</th>",
        '<th class="compact-monitor-action">Acao</th>'
      ].join("");
      const rows = agents
        .map((agent) => {
          const tone = monitorStatusTone(agent.statusTone || agent.status);
          const pauseSummary = agentPauseSummary(agent, tone);
          const pauseTime = tone === "paused" ? agent.pauseDurationLabel || (Number(agent.pauseSeconds) ? formatSeconds(agent.pauseSeconds) : "0s") : "-";
          const canMonitorCall = Boolean(agent.channel) || ["busy", "ringing"].includes(tone);
          return `
            <tr class="compact-agent-row ${tone}">
              <td class="compact-agent-name agent-presence-cell ${tone}">
                <strong>${escapeHtml(agent.name || agent.number || "-")}</strong>
                <span>${escapeHtml(agent.number || "-")}</span>
                ${pauseSummary ? `<small class="compact-agent-pause">${escapeHtml(pauseSummary)}</small>` : ""}
              </td>
              ${fields.calls === false ? "" : `<td title="Feitas/recebidas hoje">${compactAgentCallPair(agent)}</td>`}
              ${fields.duration === false ? "" : `<td class="call-duration">${escapeHtml(agent.duration || "-")}</td>`}
              ${fields.number === false ? "" : `<td>${escapeHtml(agent.currentNumber || "-")}</td>`}
              ${fields.pause === false ? "" : `<td class="pause-value">${escapeHtml(pauseTime)}</td>`}
              ${fields.idle === false ? "" : `<td class="idle-value">${escapeHtml(agent.idleTime || "-")}</td>`}
              ${fields.online === false ? "" : `<td>${escapeHtml(agent.onlineDurationLabel || agent.loginTime || "-")}</td>`}
              <td class="compact-monitor-action"><button class="icon-btn compact" data-monitor-spy="${escapeHtml(agent.number || "")}" ${canMonitorCall ? "" : "disabled"} type="button" title="Monitorar chamada"><i data-lucide="headphones"></i></button></td>
            </tr>`;
        })
        .join("");
      return `
        <section class="compact-queue-card command-queue-card">
          <header>
            <div>
              <h3>${escapeHtml(queue.name || queue.id || `Fila ${queueIndex + 1}`)}</h3>
              <span>Fila ${escapeHtml(queue.id || queue.number || "-")}</span>
            </div>
            <strong title="Atendidas | Perdidas">${compactQueueHeader(queue)}</strong>
          </header>
          <table class="compact-monitor-table">
            <thead><tr><th>Nome / ramal</th>${headers}</tr></thead>
            <tbody>${rows || `<tr><td colspan="${columnCount}" class="empty-table-cell">Sem agentes nesta visualizacao.</td></tr>`}</tbody>
          </table>
        </section>`;
    })
    .join("");
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
  const cards = trunks
    .map(
      (trunk, index) => `
      <article class="trunk-config-card" data-trunk-card data-index="${index}">
        <div class="panel-header compact-card-header">
          <div>
            <h3>${escapeHtml(trunkLabel(trunk))}</h3>
            <p class="microcopy">${escapeHtml(trunk.id)} Â· ${escapeHtml((trunk.transport || "udp").toUpperCase())} Â· ${trunk.active === false ? "Inativo" : "Ativo"}</p>
          </div>
          <div class="compact-card-actions">
            <span class="badge">${escapeHtml(trunk.mainNumber || trunk.sipUser || "SIP")}</span>
            ${index > 0 ? `<button class="icon-btn danger" data-remove-trunk="${index}" type="button" title="Remover tronco"><i data-lucide="trash-2"></i></button>` : ""}
          </div>
        </div>
        <div class="field-grid compact-field-grid">
          ${fieldBlock("Nome", "Nome simples para identificar esse tronco no painel.", `<input data-trunk-field="name" value="${escapeHtml(trunk.name || "")}" placeholder="Operadora principal" />`)}
          ${fieldBlock("ID interno", "Identificador tecnico usado no Asterisk. Use letras, numeros e hifen.", `<input data-trunk-field="id" value="${escapeHtml(trunk.id)}" ${index === 0 ? "readonly" : ""} />`)}
          ${fieldBlock("Numero principal", "Numero que a operadora entrega para receber e apresentar chamadas. Use so numeros.", `<input data-trunk-field="mainNumber" value="${escapeHtml(trunk.mainNumber || "")}" placeholder="Ex: 3431950817" />`)}
          ${fieldBlock("Usuario SIP", "Login que a operadora forneceu para registrar o tronco no servidor SIP.", `<input data-trunk-field="sipUser" value="${escapeHtml(trunk.sipUser || "")}" />`)}
          ${fieldBlock("Senha SIP", "Senha do tronco SIP da operadora. Se estiver errada, o tronco nao registra.", `<input class="masked-secret" data-trunk-field="sipPassword" type="text" autocomplete="off" spellcheck="false" data-lpignore="true" data-1p-ignore value="${escapeHtml(trunk.sipPassword || "")}" />`)}
          ${fieldBlock("Servidor SIP", "Endereco IP ou dominio do servidor da operadora.", `<input data-trunk-field="sipServer" value="${escapeHtml(trunk.sipServer || "")}" placeholder="sip.operadora.com.br" />`, "wide")}
          ${fieldBlock("Porta", "Porta de registro SIP. Em geral 5060 para UDP/TCP ou 5061 para TLS.", `<select data-trunk-field="port">${option("5060", String(trunk.port || 5060), "5060 UDP/TCP")}${option("5061", String(trunk.port || 5060), "5061 TLS")}</select>`)}
          ${fieldBlock("Transporte", "Escolha UDP para o comum ou TLS quando a operadora exigir sinalizacao segura.", `<select data-trunk-field="transport">${option("udp", trunk.transport || "udp", "UDP")}${option("tcp", trunk.transport || "udp", "TCP")}${option("tls", trunk.transport || "udp", "TLS")}</select>`)}
          ${fieldBlock("Chamadas simultaneas", "Limite de chamadas externas ao mesmo tempo nesse tronco.", `<select data-trunk-field="simultaneousCalls">${Array.from({ length: 20 }, (_, optIndex) => option(String(optIndex + 1), String(trunk.simultaneousCalls || 4), `${optIndex + 1}`)).join("")}</select>`)}
          ${fieldBlock("Status", "Desative para tirar esse tronco do discador e da geracao SIP sem apagar os dados.", `<select data-trunk-field="active">${option("true", String(trunk.active !== false), "Ativo")}${option("false", String(trunk.active !== false), "Inativo")}</select>`)}
          ${fieldBlock("Codecs", "Formatos de audio liberados para esse tronco. Separe por virgula.", `<input data-trunk-field="codecs" value="${escapeHtml((trunk.codecs || []).join(", "))}" placeholder="alaw, ulaw" />`, "wide")}
          ${fieldBlock("Destino de entrada", "Escolha qual URA, fila, grupo ou ramal atende as chamadas que chegam por este tronco.", `<div class="destination-picker">${trunkInboundChoices(trunk.inboundDestinationType || "ivr", trunk.inboundDestination || "main")}</div>`, "wide")}
        </div>
      </article>`
    )
    .join("");
  pages.trunk.innerHTML = `
    <div class="section-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>Troncos da operadora</h3>
            <p class="microcopy">Cadastre quantos troncos SIP precisar e use o rodizio no Discador.</p>
          </div>
          <button id="addTrunkBtn" class="secondary-btn" type="button"><i data-lucide="plus"></i>Novo tronco</button>
        </div>
        <div class="trunk-grid">
          ${cards}
        </div>
      </section>
    </div>
  `;
}

function renderExtensions() {
  const cards = state.config.extensions
    .map((ext, index) => {
      const detailsOpen = Boolean(state.openExtensionDetails[ext.number || index]);
      const permissions = (ext.permissions || []).map((item) => permissionLabels[item] || item).join(", ") || "Sem saida externa";
      return `
      <article class="extension-card compact-config-card ${detailsOpen ? "details-open" : "details-closed"}" data-extension-card data-index="${index}">
        <div class="panel-header compact-card-header">
          <div>
            <h3>${escapeHtml(ext.number)} ${escapeHtml(ext.name)}</h3>
            <p class="microcopy">${escapeHtml(ext.department || "Geral")} · ${escapeHtml(ext.extensionType || "Padrao")} · ${escapeHtml(permissions)}</p>
          </div>
          <div class="compact-card-actions">
            <span class="badge">${escapeHtml(ext.number)}</span>
            <button class="secondary-btn compact" data-toggle-extension-details="${index}" type="button"><i data-lucide="${detailsOpen ? "minimize-2" : "sliders-horizontal"}"></i>${detailsOpen ? "Reduzir" : "Mostrar tudo"}</button>
            <button class="icon-btn" data-remove-extension="${index}" title="Remover ramal"><i data-lucide="trash-2"></i></button>
          </div>
        </div>
        <div class="field-grid compact-field-grid">
          ${fieldBlock("Numero do ramal", "Numero interno usado no softphone ou telefone IP.", `<input data-field="number" value="${escapeHtml(ext.number)}" />`)}
          ${fieldBlock("Nome exibido", "Nome da pessoa ou setor que vai aparecer no painel.", `<input data-field="name" value="${escapeHtml(ext.name)}" />`)}
          ${fieldBlock("Setor", "Ajuda a organizar filtros, relatorios e permissoes por equipe.", `<select data-field="department">${choiceOptions(departmentOptions, ext.department).map((item) => option(item, ext.department)).join("")}</select>`)}
          ${fieldBlock("Senha SIP", "Senha usada para registrar esse ramal no softphone.", `<input class="masked-secret" data-field="secret" type="text" autocomplete="off" spellcheck="false" data-lpignore="true" data-1p-ignore value="${escapeHtml(ext.secret)}" />`)}
        </div>
        <div class="advanced-config-fields">
          <div class="field-grid compact-field-grid">
            ${fieldBlock("Tipo do ramal", "Escolha o perfil que mais combina com o uso desse ramal.", `<select data-field="extensionType">${choiceOptions(extensionTypeOptions, ext.extensionType || "Padrao").map((item) => option(item, ext.extensionType || "Padrao")).join("")}</select>`)}
            ${fieldBlock("Grupo de discagem", "Serve para agrupar ramais com o mesmo perfil de saida.", `<select data-field="dialGroup">${choiceOptions(dialGroupOptions, ext.dialGroup || "PADRAO").map((item) => option(item, ext.dialGroup || "PADRAO")).join("")}</select>`)}
            ${fieldBlock("Grupo de captura", "Permite que um ramal atenda a chamada de outro grupo.", `<select data-field="pickupGroup">${choiceOptions(pickupGroupOptions, ext.pickupGroup || "-").map((item) => option(item, ext.pickupGroup || "-")).join("")}</select>`)}
            ${fieldBlock("Centro de custo", "Classifica chamadas e gastos por area da empresa.", `<select data-field="costCenter">${choiceOptions(costCenterOptions, ext.costCenter || "Padrao").map((item) => option(item, ext.costCenter || "Padrao")).join("")}</select>`)}
            ${fieldBlock("Cota em reais", "Limite mensal em valor para chamadas externas desse ramal.", `<input data-field="monthlyQuotaValue" type="number" min="0" step="0.01" value="${escapeHtml(ext.monthlyQuotaValue ?? 0)}" />`)}
            ${fieldBlock("Cota em minutos", "Limite mensal de minutos para chamadas externas.", `<input data-field="monthlyQuotaMinutes" type="number" min="0" value="${escapeHtml(ext.monthlyQuotaMinutes ?? 0)}" />`)}
            ${fieldBlock("Tempo limite", "Tempo maximo de chamada externa, em segundos. Zero deixa sem limite.", `<input data-field="timeoutLimit" type="number" min="0" value="${escapeHtml(ext.timeoutLimit ?? 0)}" />`)}
          </div>
          <div class="check-section">
            <span class="field-title">Recursos do ramal ${helpIcon("Marque so o que esse ramal realmente precisa para manter a operacao simples e segura.")}</span>
            <div class="check-row">
              <label class="check-pill compact"><input data-field="blockExtension" type="checkbox" ${ext.blockExtension ? "checked" : ""} />Bloquear chamadas</label>
              <label class="check-pill compact"><input data-field="bridgeMode" type="checkbox" ${ext.bridgeMode ? "checked" : ""} />Bridge</label>
              <label class="check-pill compact"><input data-field="temporary" type="checkbox" ${ext.temporary ? "checked" : ""} />Temporario</label>
              <label class="check-pill compact"><input data-field="voicemail" type="checkbox" ${ext.voicemail ? "checked" : ""} />Voicemail</label>
              <label class="check-pill compact"><input data-field="recordCalls" type="checkbox" ${ext.recordCalls ? "checked" : ""} />Gravar chamadas</label>
            </div>
          </div>
          <div class="check-section">
            <span class="field-title">O que esse ramal pode discar ${helpIcon("Liberte so os tipos de ligacao que o usuario realmente precisa fazer.")}</span>
            <div class="check-row">${renderPermissionChecks(ext.permissions || [], `extperm-${index}`)}</div>
          </div>
        </div>
      </article>`;
    })
    .join("");

  pages.extensions.innerHTML = `
    <div class="section-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h3>Ramais internos</h3>
            <p class="microcopy">Cada ramal pode ser expandido individualmente para editar permissoes, cotas e grupos.</p>
          </div>
          <div class="compact-card-actions">
            <button class="secondary-btn" id="addExtensionBtn"><i data-lucide="plus"></i>Novo ramal</button>
          </div>
        </div>
        <div class="extension-grid">
          ${cards}
        </div>
      </section>
    </div>
  `;
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
  const primaryRoute = cfg.inboundRoutes[0] || {
    id: "main",
    name: "Entrada principal",
    did: cfg.trunk.mainNumber || "",
    destinationType: "extension",
    destination: "700"
  };
  const routes = cfg.inboundRoutes
    .map((route, index) => ({ route, index }))
    .filter(({ index }) => index > 0)
    .map(
      ({ route, index }) => `
      <div class="route-card ${index === 0 ? "active" : ""}" data-route-index="${index}">
        <header>
          <strong>${escapeHtml(route.name)}</strong>
          <span class="badge">${escapeHtml(route.did || "Any DID")}</span>
        </header>
        <label>Nome<input data-field="name" value="${escapeHtml(route.name)}" /></label>
        <label>DID recebido<input data-field="did" value="${escapeHtml(route.did)}" placeholder="Vazio = qualquer numero" /></label>
        <label>Destino<div>${destinationChoices(route.destinationType, route.destination)}</div></label>
      </div>`
    )
    .join("") || `<p class="hint">Nenhuma rota extra criada. A entrada principal ja envia para 700 URA.</p>`;

  const ivrOptionCards = cfg.ivr.options
    .map(
      (item) => `
      <div class="ivr-option-card">
        <strong>${escapeHtml(item.digit || "-")}</strong>
        <div>
          <span>${escapeHtml(item.label || "Opcao")}</span>
          <small>${escapeHtml(destinationLabel(item.destinationType, item.destination))}</small>
        </div>
      </div>`
    )
    .join("");

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
      <section class="route-hero">
        <div>
          <p class="eyebrow">Atendimento principal</p>
          <h3>Quem liga no tronco entra no ramal 700 e ouve a URA.</h3>
          <p class="hint">Configure o numero recebido, confirme o destino principal e mantenha as opcoes da URA visiveis para revisar antes de aplicar.</p>
        </div>
        <div class="field-grid">
          ${fieldBlock("Numero recebido", "DID que chega da operadora. Deixe vazio para aceitar qualquer numero enviado pelo tronco.", `<input data-route-index="0" data-field="did" value="${escapeHtml(primaryRoute.did || cfg.trunk.mainNumber || "")}" placeholder="3431950817" />`, "full")}
          ${fieldBlock("Nome da entrada", "Nome amigavel para identificar essa rota no painel.", `<input data-route-index="0" data-field="name" value="${escapeHtml(primaryRoute.name || "Entrada principal")}" />`, "full")}
          ${fieldBlock("Destino principal", "Para a URA no ramal 700, deixe selecionado 700 URA principal.", `<div data-primary-route-destination>${destinationChoices(primaryRoute.destinationType || "extension", primaryRoute.destination || "700")}</div>`, "full")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h3>Fluxo de entrada</h3>
          <span class="badge">Ao vivo no dialplan</span>
        </div>
        <div class="route-path route-path-large">
          <span class="route-node"><i data-lucide="radio-tower"></i>${escapeHtml(primaryRoute.did || cfg.trunk.mainNumber || "Qualquer DID")}</span>
          <i data-lucide="arrow-right"></i>
          <span class="route-node"><i data-lucide="phone-forwarded"></i>${escapeHtml(destinationLabel(primaryRoute.destinationType || "extension", primaryRoute.destination || "700"))}</span>
          <i data-lucide="arrow-right"></i>
          <span class="route-node"><i data-lucide="messages-square"></i>${escapeHtml(cfg.ivr.name)}</span>
        </div>
        <div class="ivr-option-grid">${ivrOptionCards}</div>
      </section>
      <section class="panel">
        <div class="panel-header">
          <h3>Saida das chamadas</h3>
          <span class="badge">${escapeHtml(cfg.outbound.defaultTrunk || "trunk-operadora")}</span>
        </div>
        <div class="field-grid">
          ${fieldBlock("Tronco padrão de saída", "Escolha por qual tronco todas as ligacoes externas devem sair por padrao.", `<select data-outbound="defaultTrunk">${trunkChoices(cfg.outbound.defaultTrunk || "trunk-operadora")}</select>`, "wide")}
          ${fieldBlock("DDD local", "DDD da sua cidade. Ele e usado para completar numeros locais automaticamente.", `<input data-outbound="areaCode" value="${escapeHtml(cfg.outbound.areaCode || cfg.trunk.mainNumber?.slice(0, 2) || "")}" placeholder="34" />`)}
          ${fieldBlock("Completar local", "Quando ativo, um numero local curto recebe o DDD automaticamente antes de sair.", `<select data-outbound="prependAreaCodeToLocal">${option("true", String(cfg.outbound.prependAreaCodeToLocal !== false), "Sim")}${option("false", String(cfg.outbound.prependAreaCodeToLocal !== false), "Nao")}</select>`)}
          ${fieldBlock("Prefixo ao discar", "Use apenas se a operadora exigir adicionar algo antes do numero, como 0 ou codigo da operadora.", `<input data-outbound="dialPrefix" value="${escapeHtml(cfg.outbound.dialPrefix || "")}" placeholder="Ex: 0 ou vazio" />`)}
          ${fieldBlock("Remover digitos", "Apaga os primeiros digitos antes de enviar ao tronco. Normalmente deixe 0.", `<select data-outbound="stripDigits">${Array.from({ length: 9 }, (_, index) => option(String(index), String(cfg.outbound.stripDigits || 0), `${index}`)).join("")}</select>`)}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h3>Rotas de entrada extras</h3><button id="addInboundBtn" class="secondary-btn"><i data-lucide="plus"></i>Nova rota</button></div>
        <div class="route-studio">
          <aside class="route-sidebar">${routes}</aside>
          <div class="route-main">
            <div class="route-card active">
              <header><strong>Destino padrão</strong><span class="badge">700 URA</span></header>
              <p class="hint">Se a operadora enviar a chamada para s ou para qualquer DID nao mapeado, essa rota atende.</p>
              <div class="route-node"><i data-lucide="phone-forwarded"></i>${escapeHtml(destinationLabel(primaryRoute.destinationType || "extension", primaryRoute.destination || "700"))}</div>
            </div>
          </div>
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
      <section class="panel half">
        <div class="panel-header"><h3>Modelo UAI</h3><span class="badge">Rotas de saida</span></div>
        <div class="pill-row">
          <span class="badge">Rotas de entrada</span>
          <span class="badge">Rotas de saida</span>
          <span class="badge">Troncos</span>
          <span class="badge">Portabilidade</span>
        </div>
        <p class="hint">Estamos espelhando a logica do PBX atual: tronco, padrao, remover digitos e adicionar prefixo/DDD na mesma area de rota.</p>
      </section>
    </div>
  `;
}

function renderIvrMenuNode(menu, menuKey, isMain = false, fallbackIndex = 0, preview = false) {
  const options = menu.options || [];
  const ivr = state.config.ivr;
  const cardKey = ivrCardKey(menuKey);
  const pos = ivrCardPosition(cardKey, 300 + fallbackIndex * 560, 90 + (fallbackIndex % 2) * 260);
  const waitingOptionLink = state.ivrLinkSource?.type === "menu-option" && state.ivrLinkSource?.menuKey === menuKey;
  const waitingDestinationLink = state.ivrLinkSource?.type === "option-target";
  const waitingTrunkEntryLink = state.ivrLinkSource?.type === "trunk-entry";

  return `
    <section class="ivr-flow-node ${isMain ? "main" : ""} ${waitingOptionLink ? "linking" : ""}" data-ivr-menu="${escapeHtml(menuKey)}" data-ivr-card-key="${escapeHtml(cardKey)}" style="left:${pos.x}px;top:${pos.y}px">
      <header data-ivr-drag-handle>
        <span class="ivr-node-icon"><i data-lucide="${isMain ? "layout-grid" : "git-branch"}"></i></span>
        <div>
          <strong>${escapeHtml(isMain ? "Menu principal" : "Submenu")}</strong>
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
        isMain
          ? `<div class="ivr-general-rules" data-scope="ivr">
              <div class="ivr-rules-title">
                <span class="ivr-node-icon"><i data-lucide="sliders-horizontal"></i></span>
                <div><strong>Regras gerais</strong><small>Timeout, tentativas e discagem direta</small></div>
              </div>
              <div class="ivr-node-grid">
                <label>Audio timeout<select data-key="timeoutAudio">${audioChoices(ivr.timeoutAudio || "")}</select></label>
                <label>Audio invalido<select data-key="invalidAudio">${audioChoices(ivr.invalidAudio || "")}</select></label>
                <label>Tempo resposta<input data-key="timeoutSeconds" type="number" min="5" max="60" value="${escapeHtml(ivr.timeoutSeconds || 20)}" /></label>
                <label>Tentativas<input data-key="menuRepeat" type="number" min="1" max="10" value="${escapeHtml(ivr.menuRepeat || 3)}" /></label>
                <label class="wide">Discar ramal direto<select data-key="allowDirectDial">${option("true", String(Boolean(ivr.allowDirectDial)), "Sim")}${option("false", String(Boolean(ivr.allowDirectDial)), "Nao")}</select></label>
              </div>
            </div>`
          : ""
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

function renderIvrTargetNode(target) {
  const pos = ivrCardPosition(target.key, target.x, target.y);
  const waitingDestinationLink = ["option-target", "time-condition"].includes(state.ivrLinkSource?.type);
  const condition = target.type === "timeCondition" ? target.condition || {} : null;
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
          <button type="button" class="icon-btn" data-remove-target-links="${escapeHtml(target.type)}" data-target-value="${escapeHtml(target.value)}" title="Remover links deste card"><i data-lucide="unlink"></i></button>
          <button type="button" class="icon-btn danger" data-remove-target-card="${escapeHtml(target.type)}" data-target-value="${escapeHtml(target.value)}" data-target-card-key="${escapeHtml(target.key)}" data-target-duplicate-id="${escapeHtml(target.duplicateId || "")}" title="Excluir card"><i data-lucide="trash-2"></i></button>
        </div>
      </header>
      ${
        condition
          ? `<div class="ivr-node-grid time-condition-grid">
              <label>Nome<input data-time-field="name" value="${escapeHtml(condition.name || "")}" /></label>
              <label>Dias<select data-time-field="weekdays">
                ${[
                  ["mon-fri", "Segunda a sexta"],
                  ["mon-sat", "Segunda a sabado"],
                  ["sat-sun", "Fim de semana"],
                  ["*", "Todos os dias"]
                ].map(([value, label]) => option(value, condition.weekdays || "mon-fri", label)).join("")}
              </select></label>
              <label>Inicio<input data-time-field="start" type="time" value="${escapeHtml(condition.start || "08:00")}" /></label>
              <label>Fim<input data-time-field="end" type="time" value="${escapeHtml(condition.end || "18:00")}" /></label>
              <label class="wide">Dentro do horario<div data-time-destination="in">${ivrTargetChoices(condition.inDestinationType || "extension", condition.inDestination || "", "", condition.id)}<input type="hidden" data-ivr-destination-card-key value="${escapeHtml(condition.inDestinationCardKey || "")}" /></div><button type="button" class="secondary-btn compact" data-start-time-link="${escapeHtml(condition.id || "")}" data-time-branch="in"><i data-lucide="git-merge"></i>Linkar card</button></label>
              <label class="wide">Fora do horario<div data-time-destination="out">${ivrTargetChoices(condition.outDestinationType || "extension", condition.outDestination || "", "", condition.id)}<input type="hidden" data-ivr-destination-card-key value="${escapeHtml(condition.outDestinationCardKey || "")}" /></div><button type="button" class="secondary-btn compact" data-start-time-link="${escapeHtml(condition.id || "")}" data-time-branch="out"><i data-lucide="git-merge"></i>Linkar card</button></label>
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
    ${group("Ramais", "phone", extensionButtons || `<small>Nenhum ramal cadastrado</small>`)}
    ${group("Filas", "headphones", queueButtons || `<small>Nenhuma fila cadastrada</small>`)}
    ${group("Troncos", "radio-tower", trunkButtons || `<small>Nenhum tronco cadastrado</small>`)}
    ${group("Horarios", "clock-3", timeButtons || `<small>Nenhum horario criado</small>`)}
  `;
}

function renderIvrLinks(cards) {
  const nodeMap = new Map(cards.map((card) => [card.key, card]));
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
      const target = nodeMap.get(optionCard.item.destinationCardKey || ivrTargetCardByDestination(optionCard.item.destinationType, optionCard.item.destination));
      if (target) {
        drawLink(optionCard, target);
      }
    }
  });
  cards.filter((card) => card.type === "timeCondition" && card.condition).forEach((timeCard) => {
    const openTarget = nodeMap.get(timeCard.condition.inDestinationCardKey || ivrTargetCardByDestination(timeCard.condition.inDestinationType, timeCard.condition.inDestination));
    const closedTarget = nodeMap.get(timeCard.condition.outDestinationCardKey || ivrTargetCardByDestination(timeCard.condition.outDestinationType, timeCard.condition.outDestination));
    drawLink(timeCard, openTarget);
    drawLink(timeCard, closedTarget);
  });
  ensureConfigTrunks().forEach((trunk) => {
    if (trunk.inboundDestinationType !== "ivr") return;
    const source = nodeMap.get(`trunk:${trunk.id}`);
    const target = nodeMap.get(`menu:${trunk.inboundDestination || "main"}`);
    drawLink(source, target, "entry-link");
  });
  return links.join("");
}

function ivrNodeCenter(cardKey) {
  const escaped = window.CSS?.escape ? CSS.escape(cardKey) : String(cardKey).replace(/"/g, '\\"');
  const node = $(`.ivr-canvas-space [data-ivr-card-key="${escaped}"]`);
  if (!node) return null;
  return {
    x: node.offsetLeft + node.offsetWidth / 2,
    y: node.offsetTop + node.offsetHeight / 2
  };
}

function updateIvrLinkLayer() {
  const layer = $(".ivr-link-layer");
  if (!layer) return;
  $all("line[data-link-from][data-link-to]", layer).forEach((line) => {
    const from = ivrNodeCenter(line.dataset.linkFrom);
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
  const visibleMenuEntries = focusedRecord ? menuEntries.filter((entry) => entry.record?.id === focusedRecord.id) : menuEntries;
  const menuCards = visibleMenuEntries.map((entry, index) => ({
    key: ivrCardKey(entry.menuKey),
    menu: entry.menu,
    menuKey: entry.menuKey,
    record: entry.record,
    fallbackIndex: entry.fallbackIndex,
    ...ivrCardPosition(ivrCardKey(entry.menuKey), focusedRecord ? 300 : 300 + entry.fallbackIndex * 560, focusedRecord ? 90 : 90 + (entry.fallbackIndex % 2) * 260)
  }));
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
        ...ivrCardPosition(`option:${ensureIvrOptionId(item)}`, menuPos.x + 40, menuPos.y + 250 + index * 150)
      }))
    );
  const looseOptionCards = focusedRecord ? [] : ensureIvrLooseOptions().map((item, index) => ({
    key: `option:${ensureIvrOptionId(item)}`,
    kind: "option",
    sourceType: "loose",
    sourceMenuKey: "",
    menu: null,
    menuKey: "",
    item,
    index,
    menuPos: { x: 420 + index * 40, y: 560 + index * 150 },
    ...ivrCardPosition(`option:${ensureIvrOptionId(item)}`, 420 + index * 40, 560 + index * 150)
  }));
  const allOptionCards = [...optionCards, ...looseOptionCards];
  const targetCards = ivrTargetCards().map((target) => ({ ...target, ...ivrCardPosition(target.key, target.x, target.y) }));
  const entryHidden = focusedRecord && focusedRecord.id !== "main" ? true : Boolean(ivr.hideEntryNode);
  const entryCard = { key: "entry:main", ...entryPos };
  const primaryTrunkId = state.config.outbound?.defaultTrunk || ensureConfigTrunks()[0]?.id || "trunk-operadora";
  const trunkEntryCard = targetCards.find((target) => target.type === "trunk" && target.value === primaryTrunkId) || targetCards.find((target) => target.type === "trunk");
  const entrySourceCard = entryHidden && trunkEntryCard ? trunkEntryCard : entryCard;
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
          ${(!focusedRecord || focusedRecord.id === "main") && menuCards[0] ? `<line class="entry-link" data-link-from="${escapeHtml(entrySourceCard.key)}" data-link-to="menu:main" x1="${entrySourceCard.x + (entryHidden ? 130 : 95)}" y1="${entrySourceCard.y + 36}" x2="${menuCards[0].x + 270}" y2="${menuCards[0].y + 150}" />` : ""}
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
  const records = ivrMenuRecords();
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
  const menus = ensureIvrMenus();
  const looseOptions = ensureIvrLooseOptions();
  const editingRecord = ivrEditingRecord();
  const viewportKey = editingRecord?.id || currentIvrViewportKey();
  const capturedViewport = state.activeTab === "ivr" ? saveIvrViewport(captureIvrViewport(), viewportKey) : null;
  const viewport = selectedIvrViewport(viewportKey, capturedViewport);
  const summaryOptions = [state.config.ivr, ...menus].flatMap((menu) => menu.options || []).concat(looseOptions);
  const linkText =
    state.ivrLinkSource?.type === "menu-option"
      ? "Escolha um card de opcao para ligar a este menu."
      : state.ivrLinkSource?.type === "option-target"
        ? "Escolha um menu, ramal, fila, grupo ou voicemail para concluir o destino."
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
                  ${Array.from({ length: 9 }, (_, index) => `<button data-create-ivr-card="option" data-digit="${index + 1}"><span>${index + 1}</span>Opcao ${index + 1}</button>`).join("")}
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
    <select name="destinationType" data-dialer-destination-type>
      ${option("queue", type, "Fila")}
      ${option("extension", type, "Ramal")}
    </select>
    <select name="destination" data-dialer-destination>
      ${type === "extension" ? extensionOptions : queueOptions}
    </select>
  `;
}

function dialerTrunkOptions(selected = []) {
  const selectedSet = new Set(selected?.length ? selected : [state.config.outbound?.defaultTrunk || ensureConfigTrunks()[0]?.id || "trunk-operadora"]);
  const trunks = state.dialerTrunks.length ? state.dialerTrunks : ensureConfigTrunks().filter((trunk) => trunk.active !== false);
  return trunks.map((trunk) => `<option value="${escapeHtml(trunk.id)}" ${selectedSet.has(trunk.id) ? "selected" : ""}>${escapeHtml(trunkLabel(trunk))}</option>`).join("");
}

function dialerTrunkSummary(campaign) {
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
  return Math.round(((Number(stats.dialed || 0) + Number(stats.failed || 0)) / total) * 100);
}

function currentDialerFormCampaign() {
  return state.dialerCampaigns.find((campaign) => campaign.id === state.dialerEditingId) || null;
}

function renderDialerCampaignRows() {
  if (!state.dialerCampaigns.length) {
    return `<tr><td colspan="11" class="empty-table-cell">Nenhuma campanha criada.</td></tr>`;
  }
  return state.dialerCampaigns
    .map((campaign) => {
      const stats = campaign.stats || {};
      const running = campaign.status === "running";
      const progress = dialerProgress(stats);
      return `
        <tr>
          <td>
            <strong>${escapeHtml(campaign.name)}</strong>
            <small>${escapeHtml(campaign.description || campaign.audio || "-")}</small>
          </td>
          <td><span class="dialer-status ${escapeHtml(campaign.status || "draft")}">${escapeHtml(dialerStatusLabel(campaign.status))}</span></td>
          <td>
            <div class="dialer-progress"><span style="width:${progress}%"></span></div>
            <small>${progress}%</small>
          </td>
          <td>${escapeHtml(campaign.digit || "1")}</td>
          <td>${escapeHtml(destinationLabel(campaign.destinationType, campaign.destination))}</td>
          <td><small>${escapeHtml(dialerTrunkSummary(campaign))}</small></td>
          <td>${Number(stats.total || 0)}</td>
          <td>${Number(stats.pending || 0)}</td>
          <td>${Number(stats.dialed || 0)}</td>
          <td>${Number(stats.failed || 0)}</td>
          <td>
            <div class="table-actions">
              <button class="icon-btn" type="button" data-edit-dialer="${escapeHtml(campaign.id)}" title="Editar campanha"><i data-lucide="pencil"></i></button>
              <button class="icon-btn ${running ? "danger" : ""}" type="button" data-dialer-action="${running ? "pause" : "start"}" data-dialer-id="${escapeHtml(campaign.id)}" title="${running ? "Pausar" : "Iniciar"}"><i data-lucide="${running ? "pause" : "play"}"></i></button>
              <button class="icon-btn" type="button" data-dialer-action="reset" data-dialer-id="${escapeHtml(campaign.id)}" title="Reiniciar lista"><i data-lucide="rotate-ccw"></i></button>
              <button class="icon-btn danger" type="button" data-delete-dialer="${escapeHtml(campaign.id)}" title="Excluir campanha"><i data-lucide="trash-2"></i></button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function renderDialerCampaignLiveData() {
  const count = $("[data-dialer-campaign-count]", pages.dialer);
  const rows = $("[data-dialer-campaign-rows]", pages.dialer);
  if (count) count.textContent = `${state.dialerCampaigns.length} campanhas`;
  if (rows) rows.innerHTML = renderDialerCampaignRows();
}

function renderDialer() {
  if (!pages.dialer || !state.config) return;
  const editing = currentDialerFormCampaign();
  const firstQueue = state.config.queues?.[0]?.id || "";
  const firstExtension = state.config.extensions?.[0]?.number || "";
  const destinationType = editing?.destinationType || "queue";
  const destination = editing?.destination || (destinationType === "extension" ? firstExtension : firstQueue);
  pages.dialer.innerHTML = `
    <div class="section-grid dialer-shell">
      <section class="panel">
        <div class="panel-header">
          <h3>${editing ? "Editar campanha" : "Nova campanha"}</h3>
          <span class="badge" data-dialer-campaign-count>${state.dialerCampaigns.length} campanhas</span>
        </div>
        <form id="dialerCampaignForm" class="field-grid dialer-form">
          <input type="hidden" name="id" value="${escapeHtml(editing?.id || "")}" />
          ${fieldBlock("Nome", "Nome interno para localizar a campanha.", `<input name="name" value="${escapeHtml(editing?.name || "")}" placeholder="Ex: Boletos em aberto" required />`)}
          ${fieldBlock("Audio", "Mensagem que sera tocada quando o cliente atender.", `<select name="audio" required>${audioChoices(editing?.audio || "")}</select>`)}
          ${fieldBlock("Tecla", "Numero que o cliente deve apertar para falar com o atendimento.", `<input name="digit" inputmode="numeric" maxlength="1" value="${escapeHtml(editing?.digit || "1")}" required />`)}
          ${fieldBlock("Destino", "Fila ou ramal que recebe o cliente quando ele aperta a tecla.", `<div class="dual-select">${dialerDestinationSelect(destinationType, destination)}</div>`, "wide")}
          ${fieldBlock("Troncos da campanha", "Selecione um ou mais troncos. Com varios selecionados, o discador faz rodizio.", `<select name="trunkIds" multiple size="4" required>${dialerTrunkOptions(editing?.trunkIds || [])}</select>`, "wide")}
          ${fieldBlock("Chamadas por rodada", "Quantidade enviada ao Asterisk em cada disparo.", `<input name="maxConcurrent" type="number" min="1" max="10" value="${Number(editing?.maxConcurrent || 1)}" />`)}
          ${fieldBlock("Intervalo", "Segundos entre uma rodada e outra.", `<input name="intervalSeconds" type="number" min="3" max="3600" value="${Number(editing?.intervalSeconds || 8)}" />`)}
          ${fieldBlock("Tentativas", "Quantidade maxima de envio por numero.", `<input name="retryAttempts" type="number" min="1" max="5" value="${Number(editing?.retryAttempts || 1)}" />`)}
          ${fieldBlock("Espera da tecla", "Segundos para aguardar a escolha depois do audio.", `<input name="responseTimeout" type="number" min="3" max="60" value="${Number(editing?.responseTimeout || 8)}" />`)}
          ${fieldBlock("Identificador", "Numero apresentado quando o tronco permitir caller ID.", `<input name="callerId" value="${escapeHtml(editing?.callerId || state.config.trunk?.mainNumber || "")}" />`)}
          ${fieldBlock("Descricao", "Observacao interna opcional.", `<input name="description" value="${escapeHtml(editing?.description || "")}" />`, "wide")}
          ${fieldBlock("Numeros", "Cole um numero por linha, ou separados por virgula.", `<textarea name="numbers" rows="9" spellcheck="false" placeholder="31999999999&#10;31988888888" required>${escapeHtml(editing?.numberText || "")}</textarea>`, "wide")}
          <div class="form-actions wide">
            <button class="primary-btn" type="submit"><i data-lucide="save"></i>${editing ? "Atualizar campanha" : "Salvar campanha"}</button>
            ${editing ? `<button class="secondary-btn" type="button" data-cancel-dialer-edit><i data-lucide="x"></i>Cancelar</button>` : ""}
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h3>Campanhas</h3>
          <button class="secondary-btn compact" type="button" data-refresh-dialer><i data-lucide="refresh-cw"></i>Atualizar</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Campanha</th>
                <th>Status</th>
                <th>Avanco</th>
                <th>Tecla</th>
                <th>Destino</th>
                <th>Troncos</th>
                <th>Total</th>
                <th>Pendentes</th>
                <th>Discados</th>
                <th>Falhas</th>
                <th>Acoes</th>
              </tr>
            </thead>
            <tbody data-dialer-campaign-rows>${renderDialerCampaignRows()}</tbody>
          </table>
        </div>
      </section>
    </div>
  `;
}

function recordingPartyNumber(call = {}) {
  if (call.type === "inbound") return call.source || call.callerId || call.destination || "";
  if (call.type === "outbound") return call.destination || call.callerId || call.source || "";
  return call.destination || call.source || call.callerId || "";
}

function recordingDisplayTitle(call = {}) {
  const typeLabel = call.typeLabel || { inbound: "Entrada", outbound: "Saida", internal: "Interna" }[call.type] || "Chamada";
  const extension = call.extension ? `Ramal ${call.extension}` : "Sem ramal identificado";
  const party = recordingPartyNumber(call);
  return [typeLabel, extension, party].filter(Boolean).join(" - ");
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

function renderAudios() {
  if (!pages.audios) return;
  const library = state.recordingLibrary;
  const filters = library.filters || {};
  const meta = library.meta || {};
  const dashboard = library.dashboard || {};
  const permissions = meta.permissions || {};
  const view = library.view || "calls";
  const activeFilterCount = Object.values(filters).filter((value) => String(value || "") !== "").length;
  const extensionOptions = `<option value="">Todos os ramais</option>${(state.config.extensions || [])
    .map((extension) => option(extension.number, filters.extension || "", `${extension.number} - ${extension.name || "Ramal"}`))
    .join("")}`;
  const queueOptions = `<option value="">Todas as filas</option>${(state.config.queues || [])
    .map((queue, index) => option(queue.id || queue.number || "", filters.queue || "", queueLabel(queue, index)))
    .join("")}`;
  const recordingRows = (library.calls || [])
    .map((call) => {
      const tone = reportStatusTone(call.status);
      const downloadButton = permissions.canDownloadRecordings
        ? `<a class="icon-btn" href="/api/pbx/recordings/${encodeURIComponent(call.uniqueId)}/download" title="Baixar gravacao"><i data-lucide="download"></i></a>`
        : "";
      return `
        <article class="recording-row">
          <div class="recording-type-icon ${escapeHtml(call.type || "")}"><i data-lucide="${reportTypeIcon(call.type)}"></i></div>
          <div class="recording-identity">
            <strong>${escapeHtml(recordingDisplayTitle(call))}</strong>
            <span>${escapeHtml(formatDateTime(call.startedAt))} | ${escapeHtml(call.extensionName || call.department || "Operador nao identificado")} | ${escapeHtml(call.durationLabel || "0s")}</span>
            <code title="Nome usado ao baixar">${escapeHtml(call.recordingDownloadName || call.recordingFile || call.uniqueId || "gravacao")}</code>
          </div>
          <div class="recording-tags">
            <span class="badge ${tone}">${escapeHtml(call.statusLabel || "Gravada")}</span>
            <span class="badge">${escapeHtml(call.typeLabel || "Chamada")}</span>
          </div>
          <div class="recording-actions">
            <button class="primary-btn compact" data-listen-recording="${escapeHtml(call.uniqueId)}"><i data-lucide="play"></i>Escutar</button>
            ${downloadButton}
            <button class="icon-btn" data-call-details="${escapeHtml(call.id)}" title="Detalhes da chamada"><i data-lucide="eye"></i></button>
          </div>
        </article>`;
    })
    .join("");

  const callLibrary = `
    <section class="recording-summary-grid">
      ${[
        ["Gravacoes encontradas", meta.total || dashboard.total || 0, "library"],
        ["Entradas", dashboard.inbound || 0, "phone-incoming"],
        ["Saidas", dashboard.outbound || 0, "phone-outgoing"],
        ["Duracao media", formatSeconds(dashboard.averageCallTime || 0), "clock-3"]
      ]
        .map(([label, value, icon]) => `<div class="recording-summary"><i data-lucide="${icon}"></i><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`)
        .join("")}
    </section>
    <section class="panel recording-filters-panel">
      <div class="panel-header">
        <div><h3>Localizar gravacoes</h3><p class="table-meta">${activeFilterCount ? `${activeFilterCount} filtro(s) ativo(s)` : "Pesquise pelo cliente, operador ou periodo."}</p></div>
        <button id="toggleRecordingFiltersBtn" class="secondary-btn" type="button"><i data-lucide="${library.filtersOpen ? "chevron-up" : "sliders-horizontal"}"></i>${library.filtersOpen ? "Menos filtros" : "Mais filtros"}</button>
      </div>
      <div class="recording-filter-grid primary">
        <label>Data inicial<input data-recording-filter="dateStart" type="date" value="${escapeHtml(filters.dateStart || "")}" /></label>
        <label>Data final<input data-recording-filter="dateEnd" type="date" value="${escapeHtml(filters.dateEnd || "")}" /></label>
        <label class="recording-number-filter">Numero<input data-recording-filter="number" value="${escapeHtml(filters.number || "")}" placeholder="Cliente, origem ou destino" inputmode="tel" /></label>
        <label>Ramal<select data-recording-filter="extension">${extensionOptions}</select></label>
        <label>Direcao<select data-recording-filter="type">${option("", filters.type || "", "Todas")}${option("inbound", filters.type || "", "Entrada")}${option("outbound", filters.type || "", "Saida")}${option("internal", filters.type || "", "Interna")}</select></label>
      </div>
      <div class="recording-filter-grid advanced ${library.filtersOpen ? "" : "hidden"}">
        <label>Status<select data-recording-filter="status">${option("", filters.status || "", "Todos")}${option("answered", filters.status || "", "Atendida")}${option("no_answer", filters.status || "", "Nao atendida")}${option("busy", filters.status || "", "Ocupado")}${option("failed", filters.status || "", "Falhou")}</select></label>
        <label>Fila<select data-recording-filter="queue">${queueOptions}</select></label>
        <label>Duracao minima<input data-recording-filter="minDuration" type="number" min="0" value="${escapeHtml(filters.minDuration || "")}" placeholder="Segundos" /></label>
        <label>Duracao maxima<input data-recording-filter="maxDuration" type="number" min="0" value="${escapeHtml(filters.maxDuration || "")}" placeholder="Segundos" /></label>
        <label>Origem<input data-recording-filter="source" value="${escapeHtml(filters.source || "")}" /></label>
        <label>Destino<input data-recording-filter="destination" value="${escapeHtml(filters.destination || "")}" /></label>
        <label class="wide">Busca geral<input data-recording-filter="q" value="${escapeHtml(filters.q || "")}" placeholder="Nome, protocolo, Caller ID ou identificador" /></label>
      </div>
      <div class="filter-actions">
        <button id="applyRecordingFiltersBtn" class="primary-btn" type="button"><i data-lucide="search"></i>Filtrar gravacoes</button>
        <button id="clearRecordingFiltersBtn" class="secondary-btn" type="button"><i data-lucide="x"></i>Limpar</button>
      </div>
    </section>
    <section class="panel recording-results-panel">
      <div class="panel-header">
        <div><h3>Gravacoes de chamadas</h3><p class="table-meta">${library.loading ? "Carregando..." : `${monitorNumber(meta.total || 0)} resultado(s)`}</p></div>
        <button id="reloadRecordingsBtn" class="icon-btn" type="button" title="Atualizar gravacoes"><i data-lucide="rotate-cw"></i></button>
      </div>
      <div class="recording-list">${recordingRows || `<div class="governance-empty"><i data-lucide="file-audio"></i><strong>Nenhuma gravacao encontrada</strong><span>Revise os filtros ou o periodo selecionado.</span></div>`}</div>
      <div class="pagination recording-pagination">
        <button class="secondary-btn" data-recording-page="${Math.max(1, Number(meta.page || 1) - 1)}" ${Number(meta.page || 1) <= 1 ? "disabled" : ""}><i data-lucide="chevron-left"></i>Anterior</button>
        <span>Pagina ${monitorNumber(meta.page || 1)} de ${monitorNumber(meta.pages || 1)}</span>
        <button class="secondary-btn" data-recording-page="${Math.min(Number(meta.pages || 1), Number(meta.page || 1) + 1)}" ${Number(meta.page || 1) >= Number(meta.pages || 1) ? "disabled" : ""}>Proxima<i data-lucide="chevron-right"></i></button>
      </div>
    </section>`;

  pages.audios.innerHTML = `
    <div class="recordings-shell">
      <section class="recording-toolbar">
        <div class="segmented-control" role="group" aria-label="Tipo de audio">
          <button type="button" data-recording-view="calls" class="${view === "calls" ? "active" : ""}"><i data-lucide="headphones"></i>Chamadas gravadas</button>
          <button type="button" data-recording-view="ivr" class="${view === "ivr" ? "active" : ""}"><i data-lucide="audio-lines"></i>Audios da URA</button>
        </div>
      </section>
      ${view === "ivr" ? renderIvrAudioLibrary() : callLibrary}
    </div>`;
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

  (config.ringGroups || []).forEach((group) => {
    if (String(group.fallback) === String(queueId)) group.fallback = fallbackExtension;
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

function renderQueues() {
  const ring = state.config.ringGroups[0];
  const queueStrategies = ["rrmemory", "ringall", "leastrecent", "fewestcalls"];
  const queueOptions = state.config.queues.length
    ? state.config.queues.map((queue, index) => option(queue.id, state.config.queues[0]?.id || "", `${queueLabel(queue, index)} (${queue.id})`)).join("")
    : `<option value="">Nenhuma fila cadastrada</option>`;
  const extensionOptions = state.config.extensions.map((ext) => option(ext.number, state.config.extensions[0]?.number || "", `${ext.number} ${ext.name}`)).join("");
  const fallbackOptions = state.config.extensions.map((ext) => option(ext.number, state.config.extensions[0]?.number || "", `${ext.number} ${ext.name}`)).join("");
  const queueCards = state.config.queues
    .map((queue, index) => {
      const detailsOpen = Boolean(state.openQueueDetails[queue.id || index]);
      const memberChips = (queue.members || [])
        .map((member) => {
          const ext = state.config.extensions.find((item) => item.number === member);
          return `
            <span class="member-chip">
              <strong>${escapeHtml(member)}</strong>
              <small>${escapeHtml(ext?.name || "Ramal")}</small>
              <button type="button" data-remove-queue-member="${index}" data-member="${escapeHtml(member)}" title="Remover ramal"><i data-lucide="x"></i></button>
            </span>`;
        })
        .join("");

      return `
        <section class="panel queue-config-card compact-config-card ${detailsOpen ? "details-open" : "details-closed"}" data-queue-index="${index}">
          <div class="panel-header compact-card-header">
            <div>
              <h3>${escapeHtml(queue.name || queue.id)}</h3>
              <p class="microcopy">Ramal ${escapeHtml(queueDialNumber(queue, index))} · ${escapeHtml(queue.strategy || "ringall")} · ${(queue.members || []).length} membro(s)</p>
            </div>
            <div class="compact-card-actions">
              <span class="badge">${escapeHtml(queueDialNumber(queue, index))}</span>
              <button class="secondary-btn compact" data-toggle-queue-details="${index}" type="button"><i data-lucide="${detailsOpen ? "minimize-2" : "sliders-horizontal"}"></i>${detailsOpen ? "Reduzir" : "Mostrar tudo"}</button>
              <button class="secondary-btn compact danger" data-remove-queue="${index}" type="button"><i data-lucide="trash-2"></i>Excluir</button>
            </div>
          </div>
          <div class="field-grid compact-field-grid">
            ${fieldBlock("Nome", "Nome amigavel da fila.", `<input data-key="name" value="${escapeHtml(queue.name || "")}" />`)}
            ${fieldBlock("Codigo", "Identificador usado pelo Asterisk para esta fila.", `<input data-key="id" value="${escapeHtml(queue.id || "")}" />`)}
            ${fieldBlock("Ramal da fila", "Numero virtual para transferir chamadas diretamente para esta fila.", `<input data-key="number" inputmode="numeric" value="${escapeHtml(queueDialNumber(queue, index))}" />`)}
            ${fieldBlock("Agentes", "Ramais que devem aparecer online nesta fila quando estiverem registrados no SIP.", `<input data-key="members" value="${escapeHtml((queue.members || []).join(", "))}" />`, "wide")}
          </div>
          <div class="advanced-config-fields">
            <div class="field-grid compact-field-grid">
              ${fieldBlock("Estrategia", "Define como a fila distribui chamadas entre os agentes.", `<select data-key="strategy">${queueStrategies.map((item) => option(item, queue.strategy)).join("")}</select>`)}
              ${fieldBlock("Timeout", "Tempo maximo que cada agente toca por tentativa.", `<input data-key="timeout" type="number" value="${escapeHtml(queue.timeout)}" />`)}
              ${fieldBlock("Espera maxima", "Tempo maximo de fila antes de mandar para o destino final.", `<input data-key="maxWait" type="number" value="${escapeHtml(queue.maxWait)}" />`)}
              ${fieldBlock("Destino final", "Para onde a chamada vai se a fila nao conseguir atender.", `<select data-key="fallback">${state.config.extensions.map((ext) => option(ext.number, queue.fallback, `${ext.number} ${ext.name}`)).join("")}</select>`)}
            </div>
            <div class="member-chip-row">${memberChips || `<span class="hint">Nenhum ramal nesta fila.</span>`}</div>
          </div>
        </section>`;
    })
    .join("");

  pages.queues.innerHTML = `
    <div class="section-grid">
      <section class="panel">
        <div class="panel-header"><h3>Cadastrar nova fila</h3><span class="badge">Asterisk Queue</span></div>
        <div class="inline-form queue-create-form">
          <label>Ramal da fila<input id="newQueueNumber" inputmode="numeric" value="${escapeHtml(nextQueueDialNumber())}" /></label>
          <label>Codigo<input id="newQueueId" placeholder="ex: suporte-n2" /></label>
          <label>Nome<input id="newQueueName" placeholder="Fila Suporte N2" /></label>
          <label>Estrategia<select id="newQueueStrategy">${queueStrategies.map((item) => option(item, "ringall")).join("")}</select></label>
          <label>Destino final<select id="newQueueFallback">${fallbackOptions}</select></label>
          <button id="createQueueBtn" class="primary-btn" type="button"><i data-lucide="list-plus"></i>Cadastrar fila</button>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h3>Adicionar ramal em uma fila</h3><span class="badge">${state.config.queues.length} filas</span></div>
        <div class="inline-form queue-add-form">
          <label>Fila<select id="queueMemberQueue">${queueOptions}</select></label>
          <label>Ramal<select id="queueMemberExtension">${extensionOptions}</select></label>
          <button id="addQueueMemberBtn" class="primary-btn" type="button"><i data-lucide="user-plus"></i>Adicionar</button>
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h3>Grupo de toque da recepcao</h3><span class="badge">${escapeHtml(ring.strategy)}</span></div>
        <div class="field-grid" data-scope="ring">
          ${fieldBlock("Membros", "Ramais que vao tocar juntos. Separe por virgula.", `<input data-key="members" value="${escapeHtml((ring.members || []).join(", "))}" />`, "wide")}
          ${fieldBlock("Tempo de toque", "Quanto tempo o grupo tenta tocar antes de cair no destino final.", `<input data-key="timeout" type="number" value="${escapeHtml(ring.timeout)}" />`)}
          ${fieldBlock("Destino final", "Para onde a chamada vai se ninguem atender o grupo.", `<select data-key="fallback">${timeoutDestinationOptions.map(([value, label]) => option(value, ring.fallback, label)).join("")}</select>`)}
        </div>
      </section>
      ${queueCards}
    </div>
  `;
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
          ${fieldBlock("Redes SIP permitidas", "IPs ou redes que podem registrar ramais e acessar o PBX.", `<input data-key="allowedSipNetworks" value="${escapeHtml((sec.allowedSipNetworks || []).join(", "))}" />`, "wide")}
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
          ${fieldBlock("Tipo fora horario", "Define para onde a chamada vai fora do horario comercial.", `<select data-key="afterHoursDestinationType">${["ivr", "extension", "ringGroup", "queue", "voicemail"].map((item) => option(item, hours.afterHoursDestinationType)).join("")}</select>`)}
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
          <h3>Chamadas, duracao, status e gravacoes em uma visao limpa.</h3>
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
  const rows = users.map((user, index) => {
    const isAdmin = user.role === "admin";
    const enabledMenuCount = Object.values(menuPermissions).filter((key) => isAdmin || user.permissions?.menus?.[key]).length;
    const menuGroups = userMenuGroups.map((group) => `
      <section class="user-permission-group">
        <div class="user-permission-group-title">
          <i data-lucide="${group.icon}"></i>
          <strong>${group.label}</strong>
          <span>${group.tabs.length}</span>
        </div>
        <div class="user-permission-list">
          ${group.tabs.map((tab) => {
            const key = menuPermissions[tab];
            return `<label class="user-permission-option">
              <input type="checkbox" data-user-menu="${key}" ${(isAdmin || user.permissions?.menus?.[key]) ? "checked" : ""} ${isAdmin ? "disabled" : ""}/>
              <span>${escapeHtml(titleByTab[tab] || tab)}</span>
            </label>`;
          }).join("")}
        </div>
      </section>`).join("");

    return `
    <article class="panel user-card" data-user-index="${index}">
      <div class="panel-header">
        <div class="user-card-title">
          <span class="user-avatar"><i data-lucide="user-round"></i></span>
          <div>
            <h3>${escapeHtml(user.username || "novo")}</h3>
            <span>${isAdmin ? "Administrador com acesso total" : "Acesso personalizado"}</span>
          </div>
        </div>
        <button class="icon-btn danger" data-remove-user="${index}" ${user.username === "admin" ? "disabled" : ""} title="Remover usuario"><i data-lucide="trash-2"></i></button>
      </div>
      <div class="field-grid compact-grid">
        <label>Usuario<input data-user-field="username" value="${escapeHtml(user.username || "")}" ${user.username === "admin" ? "readonly" : ""} /></label>
        <label>Nova senha<input data-user-field="password" type="password" placeholder="Manter senha atual" /></label>
        <label>Perfil<select data-user-field="role">${["admin", "supervisor", "user"].map((role) => option(role, user.role || "user", role)).join("")}</select></label>
        <label>Ramal<input data-user-field="extension" value="${escapeHtml(user.extension || "")}" /></label>
        <label class="wide">Ramais permitidos<input data-user-field="allowedExtensions" value="${escapeHtml((user.allowedExtensions || []).join(", "))}" placeholder="201, 202" /></label>
        <label class="wide">Departamentos<input data-user-field="departments" value="${escapeHtml((user.departments || []).join(", "))}" placeholder="Recepcao, Financeiro" /></label>
      </div>
      <section class="user-access-block">
        <div class="user-access-heading">
          <div>
            <strong>Acesso aos modulos</strong>
            <span>Defina quais areas ficam disponiveis para este usuario.</span>
          </div>
          <div class="user-access-actions">
            <span class="user-permission-summary" data-user-menu-count>${enabledMenuCount} de ${Object.keys(menuPermissions).length} modulos</span>
            ${isAdmin
              ? `<span class="badge ok">Acesso total</span>`
              : `<button class="secondary-btn compact" type="button" data-user-toggle-menus="${index}">
                  <i data-lucide="check-check"></i><span data-user-toggle-label>${enabledMenuCount === Object.keys(menuPermissions).length ? "Limpar" : "Selecionar todos"}</span>
                </button>`}
          </div>
        </div>
        <div class="user-permission-groups">${menuGroups}</div>
      </section>
      <section class="user-access-block user-account-permissions">
        <div class="user-access-heading">
          <div>
            <strong>Gravacoes e monitoramento</strong>
            <span>Permissoes complementares da conta.</span>
          </div>
        </div>
        <div class="user-setting-list">
          <label class="user-setting-option">
            <input type="checkbox" data-user-permission="listenRecordings" ${user.permissions?.listenRecordings ? "checked" : ""}/>
            <span><strong>Escutar gravacoes</strong><small>Reproduzir audios das chamadas.</small></span>
          </label>
          <label class="user-setting-option">
            <input type="checkbox" data-user-permission="downloadRecordings" ${user.permissions?.downloadRecordings ? "checked" : ""}/>
            <span><strong>Baixar gravacoes</strong><small>Salvar uma copia do audio.</small></span>
          </label>
          <label class="user-setting-option">
            <input type="checkbox" data-user-permission="interveneCalls" ${user.permissions?.interveneCalls ? "checked" : ""}/>
            <span><strong>Intervir em chamadas</strong><small>Usar sussurro e intervencao ao vivo.</small></span>
          </label>
          <label class="user-setting-option">
            <input type="checkbox" data-user-field="mustChangePassword" ${user.mustChangePassword ? "checked" : ""}/>
            <span><strong>Trocar senha no proximo login</strong><small>Solicitar uma nova senha ao entrar.</small></span>
          </label>
        </div>
      </section>
    </article>`;
  }).join("");

  pages.users.innerHTML = `
    <div class="section-grid">
      <section class="panel">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Usuarios</p>
            <h3>Permissoes de acesso por menu</h3>
          </div>
          <div class="report-header-actions">
            <button id="addUserBtn" class="secondary-btn"><i data-lucide="user-plus"></i>Novo</button>
            <button id="saveUsersBtn" class="primary-btn"><i data-lucide="save"></i>Salvar usuarios</button>
          </div>
        </div>
      </section>
      ${rows}
    </div>
  `;
}

function collectConfig() {
  const cfg = state.config;
  const activeRoot = $(".tab-page.active") || document;

  const trunkRoot = pages.trunk.classList.contains("active") ? pages.trunk : activeRoot;
  const trunkCards = $all("[data-trunk-card]", trunkRoot);
  if (trunkCards.length) {
    cfg.trunks = trunkCards.map((card, index) => {
      const current = cfg.trunks?.[index] || {};
      const trunk = { ...current };
      $all("[data-trunk-field]", card).forEach((input) => {
        const key = input.dataset.trunkField;
        if (key === "codecs") trunk[key] = readArray(input.value);
        else if (["port", "simultaneousCalls"].includes(key)) trunk[key] = Number(input.value) || (key === "port" ? 5060 : 4);
        else if (key === "active") trunk[key] = input.value === "true";
        else trunk[key] = input.value;
      });
      trunk.inboundDestinationType = $("[data-trunk-inbound-type]", card)?.value || trunk.inboundDestinationType || "ivr";
      trunk.inboundDestination = $("[data-trunk-inbound-value]", card)?.value || trunk.inboundDestination || "main";
      trunk.id = (trunk.id || (index === 0 ? "trunk-operadora" : `trunk-${index + 1}`)).replace(/[^a-zA-Z0-9_.-]/g, "-");
      return trunk;
    });
    cfg.trunk = { ...(cfg.trunk || {}), ...(cfg.trunks[0] || {}) };
    if (!cfg.trunks.some((trunk) => trunk.id === cfg.outbound?.defaultTrunk)) {
      cfg.outbound = cfg.outbound || {};
      cfg.outbound.defaultTrunk = cfg.trunks[0]?.id || "trunk-operadora";
    }
  }

  $all("[data-extension-card], tbody tr", pages.extensions.classList.contains("active") ? pages.extensions : document.createElement("div")).forEach((row) => {
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
      route[input.dataset.field] = input.value;
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
    const oldMenuIds = (cfg.ivr.menus || []).map((menu) => menu.id);
    const renderedMenuKeys = new Set();
    $all("[data-ivr-menu]", activeRoot).forEach((node) => {
      const menuKey = node.dataset.ivrMenu;
      renderedMenuKeys.add(menuKey);
      const menu = menuKey === "main" ? cfg.ivr : cfg.ivr.menus?.[Number(menuKey)];
      if (!menu) return;
      const previousCardKey = node.dataset.ivrCardKey;

      $all("[data-ivr-menu-field]", node).forEach((input) => {
        const key = input.dataset.ivrMenuField;
        menu[key] = input.value;
      });
      if (menuKey !== "main") {
        menu.id = String(menu.id || `menu-${Number(menuKey) + 1}`)
          .trim()
          .replace(/\s+/g, "-")
          .replace(/[^a-zA-Z0-9_-]/g, "")
          .toLowerCase();
      }
      const nextCardKey = menuKey === "main" ? "menu:main" : `menu:${menu.id}`;
      const layout = ensureIvrFlowLayout();
      if (previousCardKey && previousCardKey !== nextCardKey && layout[previousCardKey] && !layout[nextCardKey]) {
        layout[nextCardKey] = { ...layout[previousCardKey] };
      }

    });

    renderedMenuKeys.forEach((menuKey) => {
      const menu = menuKey === "main" ? cfg.ivr : cfg.ivr.menus?.[Number(menuKey)];
      if (menu) menu.options = [];
    });
    const shouldCollectLooseOptions = Boolean($("[data-ivr-source-type='loose']", activeRoot));
    if (shouldCollectLooseOptions) cfg.ivr.looseOptions = [];
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
        cfg.ivr.looseOptions = cfg.ivr.looseOptions || [];
        cfg.ivr.looseOptions.push(optionData);
        return;
      }
      const menuKey = row.dataset.ivrMenu;
      const menu = menuKey === "main" ? cfg.ivr : cfg.ivr.menus?.[Number(menuKey)];
      if (!menu) return;
      menu.options.push(optionData);
    });

    $all("[data-time-condition-id]", activeRoot).forEach((node) => {
      const condition = ensureIvrTimeConditions().find((item) => item.id === node.dataset.timeConditionId);
      if (!condition) return;
      $all("[data-time-field]", node).forEach((input) => {
        condition[input.dataset.timeField] = input.value;
      });
      const inDestination = $("[data-time-destination='in']", node);
      const outDestination = $("[data-time-destination='out']", node);
      if (inDestination) {
        condition.inDestinationType = $("[data-ivr-destination-type]", inDestination)?.value || "";
        condition.inDestination = $("[data-ivr-destination-value]", inDestination)?.value || "";
        condition.inDestinationCardKey = $("[data-ivr-destination-card-key]", inDestination)?.value || "";
      }
      if (outDestination) {
        condition.outDestinationType = $("[data-ivr-destination-type]", outDestination)?.value || "";
        condition.outDestination = $("[data-ivr-destination-value]", outDestination)?.value || "";
        condition.outDestinationCardKey = $("[data-ivr-destination-card-key]", outDestination)?.value || "";
      }
    });

    (cfg.ivr.menus || []).forEach((menu, index) => {
      const oldId = oldMenuIds[index];
      if (!oldId || oldId === menu.id) return;
      replaceIvrMenuReferences(oldId, menu.id);
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
    ring[input.dataset.key] = input.dataset.key === "members" ? readArray(input.value) : input.type === "number" ? Number(input.value) : input.value;
  });

  $all("[data-queue-index]", activeRoot).forEach((card) => {
    const queue = cfg.queues[Number(card.dataset.queueIndex)];
    if (!queue) return;
    $all("[data-key]", card).forEach((input) => {
      if (input.dataset.key === "members") queue.members = readArray(input.value);
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

async function saveConfig() {
  collectConfig();
  const queueNumberError = validateQueueDialNumbers();
  if (queueNumberError) {
    setMessage(queueNumberError, "error");
    throw new Error(queueNumberError);
  }
  const saveResponse = await api("/api/config", {
    method: "PUT",
    body: JSON.stringify(state.config)
  });
  state.config = saveResponse.config;
  const applyResponse = await api("/api/apply", { method: "POST", body: "{}" });
  const detail = applyResponse.copied ? "copiados para o Asterisk" : "gerados em generated/asterisk";
  setMessage(`Configuracao salva. Arquivos ${detail}${applyResponse.reloaded ? " e reload executado" : ""}.`, "ok");
  renderAll();
}

async function loadPreview(file) {
  const response = await fetch(`/api/generated/${file}`, { credentials: "same-origin", cache: "no-store" });
  state.generatedPreview = await response.text();
  renderOverview();
  iconRefresh();
}

async function loadOverviewData(date = state.overview.date || todayKey(), { preserveDraft = false } = {}) {
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
  const dashboardParams = recordingFilterParams();
  try {
    const [callsResponse, dashboardResponse] = await Promise.all([
      api(`/api/pbx/reports/calls?${params.toString()}`),
      api(`/api/pbx/reports/dashboard?${dashboardParams.toString()}`)
    ]);
    library.calls = callsResponse.data || [];
    library.meta = callsResponse.meta || library.meta;
    library.dashboard = dashboardResponse.dashboard || {};
  } finally {
    library.loading = false;
    if (state.activeTab === "audios") {
      renderAudios();
      iconRefresh();
    }
  }
}

async function loadReports(extra = {}) {
  state.pbxReports.loading = true;
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
  renderReports();
  iconRefresh();
}

function collectUsersFromDom() {
  return $all("[data-user-index]", pages.users).map((card) => {
    const permissions = { menus: {} };
    $all("[data-user-menu]", card).forEach((input) => {
      permissions.menus[input.dataset.userMenu] = input.checked;
    });
    $all("[data-user-permission]", card).forEach((input) => {
      permissions[input.dataset.userPermission] = input.checked;
    });
    const field = (name) => $(`[data-user-field='${name}']`, card);
    return {
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

async function loadPbxStatus({ announce = false, preserveDraft = false } = {}) {
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
  if (announce) setMessage("Monitoramento atualizado.", "ok");
  const activeRoot = pages[state.activeTab];
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
  const response = await api("/api/ivr-audios");
  state.ivrAudios = response.audios || [];
  if (state.activeTab === "ivr" && !state.ivrBuilderOpen && !state.ivrFullscreen) {
    renderIvr();
    iconRefresh();
  }
  if (state.activeTab === "audios") {
    renderAudios();
    iconRefresh();
  }
}

async function loadDialerCampaigns({ preserveDraft = false, background = false } = {}) {
  const response = await api("/api/dialer/campaigns");
  state.dialerCampaigns = response.campaigns || [];
  state.dialerDestinations = response.destinations || { queues: [], extensions: [] };
  state.dialerTrunks = response.trunks || ensureConfigTrunks().filter((trunk) => trunk.active !== false && trunk.sipServer);
  if (response.audios) state.ivrAudios = response.audios;
  if (state.activeTab === "dialer") {
    if (background) renderDialerCampaignLiveData();
    else {
      const draft = preserveDraft ? captureSurfaceDraft(pages.dialer) : null;
      renderDialer();
      restoreSurfaceDraft(pages.dialer, draft);
    }
    iconRefresh();
  }
}

async function saveDialerCampaign(form) {
  const payload = Object.fromEntries(new FormData(form));
  payload.trunkIds = new FormData(form).getAll("trunkIds");
  const response = await api("/api/dialer/campaigns", {
    method: "POST",
    body: JSON.stringify(payload)
  });
  state.dialerCampaigns = response.campaigns || [];
  state.dialerEditingId = "";
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
    state.extensionCall.dialNumber = event.target.value;
    return true;
  }
  if (event.target.closest("#extensionTransferTarget")) {
    state.extensionCall.transferTarget = event.target.value;
    return true;
  }
  return false;
}

async function handleSoftphoneClick(event) {
  const dialKeyButton = event.target.closest("[data-dial-key]");
  if (dialKeyButton) {
    state.extensionCall.dialNumber = `${state.extensionCall.dialNumber || ""}${dialKeyButton.dataset.dialKey}`;
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

  try {
    if (form.id === "loginForm") {
      const formData = new FormData(form);
      const response = await api("/api/login", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData))
      });
      state.user = response.user;
      renderShell();
      await loadConfig();
      await loadPbxStatus();
      return;
    }

    if (form.id === "extensionLoginForm") {
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

    if (form.id === "passwordForm") {
      const formData = new FormData(form);
      const response = await api("/api/change-password", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(formData))
      });
      state.user = response.user;
      form.reset();
      renderShell();
      setMessage("Senha administrativa atualizada.", "ok");
      return;
    }

    if (form.id === "ivrAudioUploadForm") {
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

    if (form.id === "dialerCampaignForm") {
      await saveDialerCampaign(form);
      return;
    }
  } catch (error) {
    if (form.id === "loginForm") $("#loginMessage").textContent = error.message;
    else if (form.id === "extensionLoginForm") $("#extensionLoginMessage").textContent = error.message;
    else setMessage(error.message);
  }
});

document.addEventListener("click", async (event) => {
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
  const deleteIvrAudioButton = event.target.closest("[data-delete-ivr-audio]");
  const editDialerButton = event.target.closest("[data-edit-dialer]");
  const dialerActionButton = event.target.closest("[data-dialer-action]");
  const deleteDialerButton = event.target.closest("[data-delete-dialer]");
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

    if (event.target.closest("[data-refresh-dialer]")) {
      await loadDialerCampaigns();
      setMessage("Campanhas atualizadas.", "ok");
      return;
    }

    if (event.target.closest("[data-cancel-dialer-edit]")) {
      state.dialerEditingId = "";
      renderDialer();
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
        inboundDestinationType: "ivr",
        inboundDestination: "main",
        active: true
      });
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
      if (state.config.outbound?.defaultTrunk === trunk.id) state.config.outbound.defaultTrunk = state.config.trunks[0]?.id || "trunk-operadora";
      renderTrunk();
      iconRefresh();
      setMessage("Tronco removido. Salve e aplique para atualizar o Asterisk.", "ok");
      return;
    }

    if (editDialerButton) {
      state.dialerEditingId = editDialerButton.dataset.editDialer || "";
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
      const channel = transferWaitingButton.dataset.transferWaiting || "";
      const choices = [
        ...(state.config.extensions || []).map((ext) => `${ext.number} ${ext.name || ""}`.trim()),
        ...(state.config.queues || []).map((queue, index) => `${queue.id} ${queueLabel(queue, index)}`.trim())
      ].join("\n");
      const target = window.prompt(`Transferir para qual ramal ou fila?\n${choices}`, "");
      if (!target) return;
      const cleanTarget = target.trim().split(/\s+/)[0];
      const response = await api("/api/pbx/monitor/action", {
        method: "POST",
        body: JSON.stringify({ action: "transfer-waiting", channel, target: cleanTarget })
      });
      setMessage(response.output || "Chamada transferida.", "ok");
      await loadPbxStatus();
      return;
    }

    if (event.target.closest("[data-monitor-spy-close]") || event.target.closest("#monitorSpyCloseBtn") || event.target.closest("#monitorSpyCancelBtn")) {
      if (state.monitorSpy.session || state.monitorSpy.ua) await stopMonitorSpy();
      state.monitorSpy.open = false;
      state.monitorSpy.busy = false;
      renderMonitorSpyPortal();
      return;
    }

    if (monitorSpyModeButton && !state.monitorSpy.session && !state.monitorSpy.busy) {
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
      setMessage(response.output || "Chamada desconectada.", "ok");
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
      renderUsers();
      iconRefresh();
      return;
    }

    if (removeUserButton) {
      state.users = collectUsersFromDom();
      state.users.splice(Number(removeUserButton.dataset.removeUser), 1);
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

    if (event.target.closest("#saveBtn")) {
      await saveConfig();
      return;
    }

    if (event.target.closest("#saveIvrFullscreenBtn")) {
      await saveConfig();
      state.ivrFullscreen = false;
      openIvrBuilder(state.ivrEditingMenuId || "main");
      renderIvr();
      iconRefresh();
      return;
    }

    if (event.target.closest("#themeToggleBtn, #extensionThemeToggleBtn")) {
      toggleTheme();
      return;
    }

    if (event.target.closest("#logoutBtn")) {
      await api("/api/logout", { method: "POST", body: "{}" });
      state.user = null;
      state.config = null;
      renderShell();
      return;
    }

    if (event.target.closest("#addExtensionBtn")) {
      collectConfig();
      const next = String(Math.max(...state.config.extensions.map((ext) => Number(ext.number) || 200)) + 1);
      state.config.extensions.push({
        number: next,
        name: "Novo ramal",
        department: "Geral",
        secret: `Ram-${next}-Senha9`,
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
      });
      renderExtensions();
      iconRefresh();
      return;
    }

    if (toggleExtensionDetailsButton) {
      collectConfig();
      const ext = state.config.extensions[Number(toggleExtensionDetailsButton.dataset.toggleExtensionDetails)];
      if (ext) {
        const key = ext.number || toggleExtensionDetailsButton.dataset.toggleExtensionDetails;
        state.openExtensionDetails[key] = !state.openExtensionDetails[key];
      }
      renderExtensions();
      iconRefresh();
      return;
    }

    if (removeExtension) {
      collectConfig();
      state.config.extensions.splice(Number(removeExtension.dataset.removeExtension), 1);
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
        destinationType: "extension",
        destination: "700"
      });
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
      const next = menus.length + 1;
      menus.push({
        id: `menu-${next}`,
        name: `Novo menu ${next}`,
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
      const layout = ensureIvrFlowLayout();
      layout[`menu:${menu.id}`] = { x: 860 + menus.length * 360, y: 90 };
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
      const layout = ensureIvrFlowLayout();
      layout[`menu:${menu.id}`] = { x: 300, y: 90 };
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
        menus.push({ id, name: `Novo menu ${next}`, greeting: "", greetingDescription: "", options: [] });
        setIvrCardPosition(`menu:${id}`, menuInfo.x, menuInfo.y);
      }
      if (action === "root") {
        const menu = createIvrRootMenu();
        ensureIvrMenus().push(menu);
        setIvrCardPosition(`menu:${menu.id}`, menuInfo.x, menuInfo.y);
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
        if (state.ivrLinkSource?.type === "option-target") {
          const found = findIvrOptionByNodeId(state.ivrLinkSource.nodeId);
          if (found?.item) {
            found.item.destinationType = "timeCondition";
            found.item.destination = condition.id;
            state.ivrLinkSource = null;
          }
        }
      }
      if (action === "ramal") {
        const next = String(Math.max(...state.config.extensions.map((ext) => Number(ext.number) || 200)) + 1);
        state.config.extensions.push({
          number: next,
          name: "Novo ramal",
          department: "Geral",
          secret: `Ram-${next}-Senha9`,
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
        });
        setIvrCardPosition(`extension:${next}`, menuInfo.x, menuInfo.y);
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
      const existingVisible = ivrTargetCards().some((target) => target.type === type && String(target.value) === String(value));
      let result = revealIvrTargetCard(type, value, menuInfo.x, menuInfo.y);
      if (existingVisible && type === "trunk") {
        if (state.ivrLinkSource?.type === "option-target") {
          const found = findIvrOptionByNodeId(state.ivrLinkSource.nodeId);
          if (found?.item) {
            found.item.destinationType = type;
            found.item.destination = value;
            found.item.destinationCardKey = ivrTargetCardByDestination(type, value);
            state.ivrLinkSource = null;
            result = "connected";
          }
        } else {
          result = "positioned";
        }
      } else if (existingVisible && result === "positioned") {
        const cardKey = createDuplicateIvrTargetCard(type, value, menuInfo.x, menuInfo.y);
        if (state.ivrLinkSource?.type === "option-target") {
          const found = findIvrOptionByNodeId(state.ivrLinkSource.nodeId);
          if (found?.item) {
            found.item.destinationType = type;
            found.item.destination = value;
            found.item.destinationCardKey = cardKey;
            state.ivrLinkSource = null;
            result = "connected";
          }
        } else {
          result = "duplicated";
        }
      }
      state.ivrContextMenu = null;
      renderIvr();
      iconRefresh();
      setMessage(result === "connected" ? "Destino ligado na URA." : "Card adicionado ao fluxograma da URA.", "ok");
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
        found.item.destinationType = "";
        found.item.destination = "";
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
      const removed = clearIvrDestinationLinks(removeTargetLinksButton.dataset.removeTargetLinks, removeTargetLinksButton.dataset.targetValue);
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
      delete layout[`${type}:${value}`];
      renderIvr();
      iconRefresh();
      setMessage(result.message, "ok");
      return;
    }

    if (ivrTargetButton && state.ivrLinkSource?.type === "option-target") {
      rememberIvrViewport();
      collectConfig();
      const source = state.ivrLinkSource;
      const found = findIvrOptionByNodeId(source.nodeId);
      if (found?.item) {
        found.item.destinationType = ivrTargetButton.dataset.ivrTargetType;
        found.item.destination = ivrTargetButton.dataset.ivrTargetValue;
        found.item.destinationCardKey = ivrTargetButton.dataset.ivrTargetCardKey || "";
        state.ivrLinkSource = null;
        renderIvr();
        iconRefresh();
        setMessage("Link do fluxograma atualizado.", "ok");
      }
      return;
    }

    if (ivrTargetButton && state.ivrLinkSource?.type === "time-condition") {
      rememberIvrViewport();
      collectConfig();
      const condition = ensureIvrTimeConditions().find((item) => item.id === state.ivrLinkSource.conditionId);
      if (condition) {
        const prefix = state.ivrLinkSource.branch === "out" ? "out" : "in";
        condition[`${prefix}DestinationType`] = ivrTargetButton.dataset.ivrTargetType;
        condition[`${prefix}Destination`] = ivrTargetButton.dataset.ivrTargetValue;
        condition[`${prefix}DestinationCardKey`] = ivrTargetButton.dataset.ivrTargetCardKey || "";
        state.ivrLinkSource = null;
        renderIvr();
        iconRefresh();
        setMessage("Horario ligado ao card escolhido.", "ok");
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
        const nextDigit = String(menu.options.length + 1);
        menu.options.push(createIvrOption(nextDigit));
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
        [state.config.ivr, ...menus, { options: ensureIvrLooseOptions() }].forEach((menu) => {
          (menu.options || []).forEach((item) => {
            if (item.destinationType === "ivr" && item.destination === removed.id) {
              item.destinationType = "";
              item.destination = "";
            }
          });
        });
      }
      renderIvr();
      iconRefresh();
      setMessage("Menu removido e conexoes ajustadas.", "ok");
      return;
    }

    if (event.target.closest("#createQueueBtn")) {
      collectConfig();
      const name = $("#newQueueName")?.value.trim() || "Nova fila";
      const id = uniqueQueueId($("#newQueueId")?.value || name);
      const number = String($("#newQueueNumber")?.value || nextQueueDialNumber()).replace(/\D/g, "") || nextQueueDialNumber();
      if (queueDialNumberConflict(number)) {
        setMessage("O ramal da fila ja esta em uso por outro ramal ou fila.", "error");
        return;
      }
      const fallback = $("#newQueueFallback")?.value || state.config.extensions[0]?.number || "201";
      state.config.queues.push({
        id,
        number,
        name,
        strategy: $("#newQueueStrategy")?.value || "ringall",
        members: [],
        timeout: 20,
        maxWait: 300,
        fallback
      });
      renderQueues();
      iconRefresh();
      setMessage("Fila cadastrada. Adicione ramais, salve e aplique para atualizar o Asterisk.", "ok");
      return;
    }

    if (toggleQueueDetailsButton) {
      collectConfig();
      const queue = state.config.queues[Number(toggleQueueDetailsButton.dataset.toggleQueueDetails)];
      if (queue) {
        const key = queue.id || toggleQueueDetailsButton.dataset.toggleQueueDetails;
        state.openQueueDetails[key] = !state.openQueueDetails[key];
      }
      renderQueues();
      iconRefresh();
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
      state.recordingLibrary.view = recordingViewButton.dataset.recordingView === "ivr" ? "ivr" : "calls";
      renderAudios();
      iconRefresh();
      if (state.recordingLibrary.view === "calls" && !state.recordingLibrary.calls.length) await loadRecordingLibrary({ page: 1 });
      return;
    }

    if (event.target.closest("#toggleRecordingFiltersBtn")) {
      state.recordingLibrary.filtersOpen = !state.recordingLibrary.filtersOpen;
      renderAudios();
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

    if (event.target.closest("#monitorCompactSettingsBtn, #overviewColumnsBtn")) {
      state.monitorCompact.settingsOpen = true;
      renderMonitorPreferencesSurface();
      iconRefresh();
      return;
    }

    if (event.target.closest("[data-monitor-compact-close]")) {
      state.monitorCompact.settingsOpen = false;
      renderMonitorPreferencesSurface();
      iconRefresh();
      return;
    }

    const compactSelectQueues = event.target.closest("[data-compact-select-queues]");
    if (compactSelectQueues) {
      const queues = state.pbxStatus?.queues || state.config?.queues || [];
      state.monitorCompact.hiddenQueues =
        compactSelectQueues.dataset.compactSelectQueues === "none"
          ? queues.map((queue, index) => queueCompactId(queue, index))
          : [];
      saveMonitorCompactSettings();
      renderMonitorPreferencesSurface();
      iconRefresh();
      return;
    }

    if (event.target.closest("[data-compact-reset]")) {
      state.monitorCompact = { ...defaultMonitorCompactSettings(), view: state.monitorCompact.view, settingsOpen: true };
      saveMonitorCompactSettings();
      renderMonitorPreferencesSurface();
      iconRefresh();
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

document.addEventListener("change", (event) => {
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

  const compactField = event.target.closest("[data-compact-field]");
  if (compactField) {
    state.monitorCompact.fields = state.monitorCompact.fields || {};
    state.monitorCompact.fields[compactField.dataset.compactField] = compactField.checked;
    saveMonitorCompactSettings();
    renderMonitorPreferencesSurface();
    iconRefresh();
    return;
  }

  const compactStatus = event.target.closest("[data-compact-status]");
  if (compactStatus) {
    state.monitorCompact.statuses = state.monitorCompact.statuses || {};
    state.monitorCompact.statuses[compactStatus.dataset.compactStatus] = compactStatus.checked;
    saveMonitorCompactSettings();
    renderMonitorPreferencesSurface();
    iconRefresh();
    return;
  }

  const compactQueue = event.target.closest("[data-compact-queue]");
  if (compactQueue) {
    const id = String(compactQueue.dataset.compactQueue || "");
    const hidden = new Set((state.monitorCompact.hiddenQueues || []).map(String));
    if (compactQueue.checked) hidden.delete(id);
    else hidden.add(id);
    state.monitorCompact.hiddenQueues = [...hidden];
    saveMonitorCompactSettings();
    renderMonitorPreferencesSurface();
    iconRefresh();
    return;
  }

  const dialerDestinationType = event.target.closest("[data-dialer-destination-type]");
  if (dialerDestinationType && state.config) {
    const wrapper = dialerDestinationType.parentElement;
    wrapper.innerHTML = dialerDestinationSelect(dialerDestinationType.value, "");
    iconRefresh();
    return;
  }

  const ivrTypeSelect = event.target.closest("[data-ivr-destination-type]");
  if (ivrTypeSelect && state.config) {
    rememberIvrViewport();
    const wrapper = ivrTypeSelect.parentElement;
    const currentValue = $("[data-ivr-destination-value]", wrapper)?.value || "";
    const menuNode = ivrTypeSelect.closest("[data-ivr-menu]");
    const menuKey = menuNode?.dataset.ivrMenu || "";
    const currentMenuId = menuKey === "main" ? "main" : state.config.ivr.menus?.[Number(menuKey)]?.id || "";
    const timeNode = ivrTypeSelect.closest("[data-time-condition-id]");
    wrapper.innerHTML = ivrTargetChoices(ivrTypeSelect.value, currentValue, currentMenuId, timeNode?.dataset.timeConditionId || "");
    restoreIvrViewport();
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
  const nextTab = tabFromCurrentPath();
  if (nextTab === "ivr") {
    const editId = new URLSearchParams(window.location.search).get("edit");
    if (editId) openIvrBuilder(editId);
    else closeIvrBuilder();
  }
  setActiveTab(nextTab, { collect: true, load: true }).catch((error) => setMessage(error.message || "Falha ao abrir pagina."));
});

async function boot() {
  const [adminResponse, extensionResponse] = await Promise.all([
    api("/api/me"),
    api("/api/extensions/me")
  ]);
  state.user = adminResponse.user;
  state.extensionSession = state.user ? null : extensionResponse.extension;
  renderShell();
  updateTopbarActions();
  if (state.user) {
    await loadConfig();
    await loadPbxStatus();
    await loadOverviewData(state.overview.date);
    await loadReports();
    await loadIvrAudios();
    await loadDialerCampaigns();
    await loadOutboundDiagnostics("", state.config?.extensions?.[0]?.number || "201");
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
  if (state.user && state.config && state.activeTab === "status") {
    loadPbxStatus({ preserveDraft: true }).catch(() => {});
  }
}, MONITOR_REFRESH_MS);

setInterval(() => {
  if (state.user && state.config && ["overview", "logs", "security", "reports"].includes(state.activeTab)) {
    loadPbxStatus({ preserveDraft: true }).catch(() => {});
  }
}, BACKGROUND_STATUS_REFRESH_MS);

setInterval(() => {
  if (state.user && state.config && state.activeTab === "dialer") {
    loadDialerCampaigns({ background: true }).catch(() => {});
  }
}, 5000);

setInterval(() => {
  if (state.user && state.config && state.activeTab === "overview") {
    loadOverviewData(state.overview.date, { preserveDraft: true }).catch(() => {});
  }
}, 30000);

setInterval(() => {
  if (state.extensionSession) {
    loadExtensionStatus({ preserveDraft: true }).catch(() => {});
  }
}, MONITOR_REFRESH_MS);

setInterval(() => {
  if (state.extensionSession && (currentExtensionPauseInfo().paused || isExtensionCallActive())) {
    const draft = captureSurfaceDraft($("#extensionView"));
    renderExtensionPortal();
    restoreSurfaceDraft($("#extensionView"), draft);
  }
}, 1000);

window.addEventListener("pagehide", notifyExtensionLogoutOnClose);
