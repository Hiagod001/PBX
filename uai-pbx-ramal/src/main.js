const { app, BrowserWindow, ipcMain, session, Notification, powerMonitor } = require("electron");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const fs = require("node:fs");

const PBX_URL = process.env.UAI_PBX_URL || "https://uaipbx.uaitelecom.com.br";
const APP_PARTITION = "persist:uai-pbx-ramal";
const VALID_TONES = new Set(["ringtone", "ringing"]);
if (process.env.UAI_PBX_TEST_USER_DATA) app.setPath("userData", path.resolve(process.env.UAI_PBX_TEST_USER_DATA));

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

let mainWindow = null;
let currentExtension = null;
const toneProcesses = new Map();

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

function requestedToneTest(argv = process.argv) {
  return argv.some((arg) => arg === "--uai-test-tone" || arg === "uai-test-tone");
}

function runToneTest() {
  toneLog("manual tone test requested");
  if (!mainWindow || mainWindow.isDestroyed()) {
    startTone("ringtone");
    setTimeout(() => stopTone("ringtone"), 10000);
    return;
  }
  const clickTestButton = () => {
    mainWindow.webContents.executeJavaScript(
      "document.querySelector('#loginTestRingBtn, #testRingBtn')?.click()",
      true
    ).catch((error) => {
      toneLog(`manual renderer tone failed: ${error.message}`);
      startTone("ringtone");
      setTimeout(() => stopTone("ringtone"), 10000);
    });
  };
  if (mainWindow.webContents.isLoading()) {
    mainWindow.webContents.once("did-finish-load", clickTestButton);
  } else {
    clickTestButton();
  }
}

function operatorSession() {
  return session.fromPartition(APP_PARTITION);
}

async function resetRamalSession() {
  const pbxSession = operatorSession();
  await pbxSession.clearStorageData({
    storages: ["cookies", "localstorage", "indexdb", "cachestorage", "serviceworkers"]
  }).catch(() => null);
  await pbxSession.clearCache().catch(() => null);
  currentExtension = null;
}

function apiUrl(route) {
  return new URL(route, PBX_URL).toString();
}

async function pbxFetch(route, options = {}) {
  const response = await operatorSession().fetch(apiUrl(route), {
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && currentExtension) {
      currentExtension = null;
      mainWindow?.webContents.send("app:session-expired");
    }
    const error = new Error(data.error || "Falha na requisicao");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

function appIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", "icon.ico")
    : path.join(__dirname, "..", "assets", "icon.ico");
}

function assetPath(name) {
  const safeName = path.basename(String(name || ""));
  return app.isPackaged
    ? path.join(process.resourcesPath, "assets", safeName)
    : path.join(__dirname, "..", "assets", safeName);
}

function psString(value) {
  return `'${String(value || "").replace(/'/g, "''")}'`;
}

function toneLog(message) {
  const line = `[${new Date().toISOString()}] ${message}\n`;
  fs.appendFile(path.join(app.getPath("userData"), "tone.log"), line, () => {});
}

function sipLog(message) {
  const safeMessage = String(message || "").replace(/[\r\n]+/g, " ").slice(0, 800);
  const line = `[${new Date().toISOString()}] ${safeMessage}\n`;
  fs.appendFile(path.join(app.getPath("userData"), "sip.log"), line, () => {});
}

function stopTone(name) {
  const key = String(name || "");
  const child = toneProcesses.get(key);
  if (child) {
    toneProcesses.delete(key);
    child.kill();
  }
}

function startTone(name) {
  const key = String(name || "");
  if (!VALID_TONES.has(key)) {
    toneLog(`start ignored invalid tone=${key}`);
    return;
  }
  if (toneProcesses.has(key)) {
    toneLog(`start ${key} ignored=already-playing`);
    return;
  }
  const file = key === "ringing" ? "uai-audible-ringback.wav" : "uai-user-ringtone-mono-loud.wav";
  const fullPath = assetPath(file);
  toneLog(`start ${key} backend=SoundPlayerLoop file=${fullPath}`);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$VerbosePreference = 'SilentlyContinue'",
    "Write-Output 'tone-script-start'",
    "Add-Type -AssemblyName System",
    `$file = ${psString(fullPath)}`,
    "Write-Output ('tone-file=' + $file)",
    "$soundPlayer = $null",
    "$soundPlayer = [System.Media.SoundPlayer]::new($file)",
    "$soundPlayer.Load()",
    "$soundPlayer.PlayLooping()",
    "Write-Output 'SoundPlayer file loop started'",
    "Write-Output 'tone-loop-enter'",
    "try { while ($true) { Start-Sleep -Milliseconds 500 } } finally { try { if ($soundPlayer) { $soundPlayer.Stop(); $soundPlayer.Dispose() } } catch {} }"
  ].join("; ");
  const encodedScript = Buffer.from(script, "utf16le").toString("base64");
  const child = spawn("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-STA", "-OutputFormat", "Text", "-EncodedCommand", encodedScript], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"]
  });
  toneProcesses.set(key, child);
  child.stdout.on("data", (chunk) => toneLog(`${key} stdout: ${chunk.toString().trim()}`));
  child.stderr.on("data", (chunk) => toneLog(`${key} stderr: ${chunk.toString().trim()}`));
  child.on("error", (error) => toneLog(`${key} spawn error: ${error.message}`));
  child.on("exit", (code, signal) => {
    toneLog(`${key} exit code=${code} signal=${signal || ""}`);
    if (toneProcesses.get(key) === child) toneProcesses.delete(key);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 400,
    height: 760,
    minWidth: 320,
    minHeight: 520,
    title: "UAI PBX Ramal",
    icon: appIconPath(),
    backgroundColor: "#18181b",
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      sandbox: false
    }
  });

  mainWindow.webContents.session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    const wantsAudio = Array.isArray(details?.mediaTypes) && details.mediaTypes.includes("audio");
    callback(permission === "media" && wantsAudio);
  });

  mainWindow.loadFile(path.join(__dirname, "renderer.html"));
  mainWindow.webContents.setAudioMuted(false);
  mainWindow.on("closed", () => {
    stopTone("ringtone");
    stopTone("ringing");
    mainWindow = null;
  });
}

app.on("second-instance", (_event, argv) => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (requestedToneTest(argv)) runToneTest();
});

ipcMain.handle("app:server", () => ({
  serverUrl: PBX_URL,
  extension: currentExtension
}));

ipcMain.handle("app:sip-log", (_event, message) => {
  sipLog(message);
  return { ok: true };
});

ipcMain.handle("app:asset-url", (_event, name) => pathToFileURL(assetPath(name)).toString());

ipcMain.handle("app:tone-start", (_event, name) => {
  startTone(name);
  return { ok: true };
});

ipcMain.handle("app:tone-stop", (_event, name) => {
  stopTone(name);
  return { ok: true };
});

ipcMain.handle("app:incoming-call", async (_event, payload) => {
  const number = String(payload?.number || "Chamada recebida");
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
    mainWindow.flashFrame(true);
    mainWindow.setAlwaysOnTop(true, "screen-saver");
    setTimeout(() => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      mainWindow.setAlwaysOnTop(false);
      mainWindow.flashFrame(false);
    }, 3500);
  }
  if (Notification.isSupported()) {
    const notification = new Notification({
      title: "Chamada recebida",
      body: `${number} no ramal ${currentExtension?.number || ""}`.trim(),
      icon: appIconPath(),
      silent: true
    });
    notification.on("click", () => {
      if (!mainWindow || mainWindow.isDestroyed()) return;
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    });
    notification.show();
  }
  return { ok: true };
});

ipcMain.handle("extension:login", async (_event, credentials) => {
  await resetRamalSession();
  const data = await pbxFetch("/api/extensions/login", {
    method: "POST",
    body: JSON.stringify({
      extension: String(credentials?.extension || "").trim(),
      password: String(credentials?.password || "")
    })
  });
  currentExtension = data.extension || null;
  return { ok: true, extension: currentExtension };
});

ipcMain.handle("extension:logout", async () => {
  await pbxFetch("/api/extensions/logout", { method: "POST" }).catch(() => null);
  await resetRamalSession();
  return { ok: true };
});

ipcMain.handle("extension:portal", async () => {
  if (!currentExtension) throw new Error("Entre com o ramal antes de abrir o telefone.");
  const data = await pbxFetch("/api/extensions/portal");
  return { ok: true, portal: data };
});

ipcMain.handle("extension:protocol", async (_event, payload) => {
  const number = String(payload?.number || "").replace(/\D+/g, "");
  const direction = String(payload?.direction || "saida");
  if (!currentExtension) throw new Error("Entre com o ramal antes de gerar protocolo.");
  const data = await pbxFetch("/api/extensions/protocol", {
    method: "POST",
    body: JSON.stringify({ number, direction })
  });
  return { ok: true, protocol: data };
});

ipcMain.handle("extension:call", async (_event, payload) => {
  const number = String(payload?.number || "").replace(/\D+/g, "");
  if (!currentExtension) throw new Error("Entre com o ramal antes de ligar.");
  if (!number) throw new Error("Informe o numero para ligar.");
  const data = await pbxFetch("/api/extensions/call", {
    method: "POST",
    body: JSON.stringify({ number })
  });
  return { ok: true, call: data };
});

ipcMain.handle("extension:status", async () => {
  if (!currentExtension) throw new Error("Entre com o ramal antes de consultar status.");
  const data = await pbxFetch("/api/extensions/status");
  return { ok: true, status: data };
});

ipcMain.handle("extension:pause", async (_event, payload) => {
  if (!currentExtension) throw new Error("Entre com o ramal antes de pausar.");
  const paused = Boolean(payload?.paused);
  const data = await pbxFetch("/api/extensions/action", {
    method: "POST",
    body: JSON.stringify({
      action: paused ? "queue-pause" : "queue-unpause",
      reason: payload?.reason || "Cafezinho"
    })
  });
  return { ok: true, paused, result: data };
});

ipcMain.handle("extension:hangup", async (_event, payload) => {
  if (!currentExtension) throw new Error("Entre com o ramal antes de encerrar.");
  const data = await pbxFetch("/api/extensions/action", {
    method: "POST",
    body: JSON.stringify({
      action: "hangup",
      channel: String(payload?.channel || "")
    })
  });
  return { ok: true, result: data };
});

ipcMain.handle("extension:transfer", async (_event, payload) => {
  const target = String(payload?.target || "").trim();
  if (!currentExtension) throw new Error("Entre com o ramal antes de transferir.");
  if (!target) throw new Error("Informe o ramal ou fila de destino.");
  const data = await pbxFetch("/api/extensions/transfer", {
    method: "POST",
    body: JSON.stringify({ target })
  });
  return { ok: true, transfer: data };
});

app.whenReady().then(async () => {
  app.setAppUserModelId("br.com.uaitelecom.uaipbxramal");
  await resetRamalSession();
  createWindow();
  powerMonitor.on("resume", () => mainWindow?.webContents.send("app:resume"));
  powerMonitor.on("unlock-screen", () => mainWindow?.webContents.send("app:resume"));
  if (requestedToneTest()) runToneTest();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (!BrowserWindow.getAllWindows().length) createWindow();
});
