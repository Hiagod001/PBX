const safeIdPattern = /^[a-zA-Z0-9_.-]+$/;
const extensionPattern = /^\d{2,8}$/;

function invalidCharacters(value) {
  return /[;\r\n\0]/.test(String(value || ""));
}

function validRecordingPath(value) {
  const recordingPath = String(value || "").trim();
  if (!recordingPath || recordingPath.length > 240) return false;
  if (!/^\/[a-zA-Z0-9_./-]+$/.test(recordingPath)) return false;
  return !recordingPath.split("/").includes("..");
}

function validateConfig(config) {
  const issues = [];
  const add = (message) => issues.push(message);
  const unique = (values, label) => {
    const seen = new Set();
    values.filter(Boolean).forEach((value) => {
      if (seen.has(value)) add(`${label} duplicado: ${value}`);
      seen.add(value);
    });
  };

  if (!config || typeof config !== "object" || Array.isArray(config)) add("Configuracao invalida");

  const extensions = Array.isArray(config?.extensions) ? config.extensions : [];
  const extensionNumbers = extensions.map((extension) => String(extension.number || "").trim());
  unique(extensionNumbers, "Ramal");
  extensions.forEach((extension, index) => {
    const number = extensionNumbers[index];
    if (!extensionPattern.test(number)) add(`Numero de ramal invalido na posicao ${index + 1}`);
    if (invalidCharacters(extension.name)) add(`Nome invalido no ramal ${number || index + 1}`);
    if (invalidCharacters(extension.secret) || String(extension.secret || "").length > 160) add(`Senha SIP invalida no ramal ${number || index + 1}`);
  });

  const trunks = Array.isArray(config?.trunks) && config.trunks.length ? config.trunks : config?.trunk ? [config.trunk] : [];
  const trunkIds = trunks.map((trunk, index) => String(trunk.id || (index === 0 ? "trunk-operadora" : "")).trim());
  unique(trunkIds, "Identificador de tronco");
  trunks.forEach((trunk, index) => {
    const id = trunkIds[index];
    if (!safeIdPattern.test(id)) add(`Identificador de tronco invalido: ${id || index + 1}`);
    if (invalidCharacters(trunk.sipServer) || invalidCharacters(trunk.sipUser) || invalidCharacters(trunk.sipPassword)) add(`Dados SIP invalidos no tronco ${id}`);
    const port = Number(trunk.port || 5060);
    if (!Number.isInteger(port) || port < 1 || port > 65535) add(`Porta invalida no tronco ${id}`);
  });

  const queues = Array.isArray(config?.queues) ? config.queues : [];
  const queueIds = queues.map((queue) => String(queue.id || "").trim());
  unique(queueIds, "Identificador de fila");
  queues.forEach((queue, index) => {
    const id = queueIds[index];
    if (!safeIdPattern.test(id)) add(`Identificador de fila invalido: ${id || index + 1}`);
    (queue.members || []).forEach((member) => {
      if (!extensionPattern.test(String(member || ""))) add(`Membro invalido na fila ${id}`);
    });
  });

  const menus = [config?.ivr, ...((config?.ivr?.menus || []))].filter(Boolean);
  const menuIds = menus.map((menu, index) => String(index === 0 ? menu.id || "main" : menu.id || "").trim());
  unique(menuIds, "Identificador de URA");
  menus.forEach((menu, index) => {
    const id = menuIds[index];
    if (!safeIdPattern.test(id)) add(`Identificador de URA invalido: ${id || index + 1}`);
    const digits = (menu.options || []).map((option) => String(option.digit || "").trim()).filter(Boolean);
    unique(digits, `Opcao da URA ${id}`);
    digits.forEach((digit) => {
      if (!/^[0-9#*]$/.test(digit)) add(`Opcao invalida na URA ${id}: ${digit}`);
    });
    (menu.timeConditions || []).forEach((condition) => {
      if (!safeIdPattern.test(String(condition.id || ""))) add(`Identificador de horario invalido na URA ${id}`);
    });
  });

  if (!validRecordingPath(config?.recording?.path)) {
    add("Caminho de gravacao invalido. Use um caminho absoluto sem espacos, delimitadores ou segmentos '..'.");
  }

  if (issues.length) {
    const error = new Error(issues.slice(0, 8).join("; "));
    error.status = 400;
    error.issues = issues;
    throw error;
  }
  return config;
}

module.exports = { validateConfig };
