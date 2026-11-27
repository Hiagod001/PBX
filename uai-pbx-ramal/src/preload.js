const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pbxAPI", {
  updateStatus: () => ipcRenderer.invoke("app:update-status"),
  checkUpdate: () => ipcRenderer.invoke("app:update-check"),
  installUpdate: () => ipcRenderer.invoke("app:update-install"),
  activity: (busy) => ipcRenderer.send("app:activity", { busy: Boolean(busy) }),
  onUpdateStatus: callback => ipcRenderer.on("app:update-status", (_event, value) => callback(value)),
  onPrepareUpdate: callback => ipcRenderer.on("app:update-prepare", async (_event, nonce) => {
    const ready = await Promise.resolve().then(callback).catch(() => false);
    ipcRenderer.send("app:update-prepared", { nonce, ready });
  }),
  onCancelUpdate: callback => ipcRenderer.on("app:update-cancel", () => callback()),
  onResume: (callback) => ipcRenderer.on("app:resume", () => callback()),
  onSessionExpired: (callback) => ipcRenderer.on("app:session-expired", () => callback()),
  server: () => ipcRenderer.invoke("app:server"),
  sipLog: (message) => ipcRenderer.invoke("app:sip-log", message),
  assetUrl: (name) => ipcRenderer.invoke("app:asset-url", name),
  startTone: (name) => ipcRenderer.invoke("app:tone-start", name),
  stopTone: (name) => ipcRenderer.invoke("app:tone-stop", name),
  login: (credentials) => ipcRenderer.invoke("extension:login", credentials),
  logout: () => ipcRenderer.invoke("extension:logout"),
  portal: () => ipcRenderer.invoke("extension:portal"),
  protocol: (payload) => ipcRenderer.invoke("extension:protocol", payload),
  call: (payload) => ipcRenderer.invoke("extension:call", payload),
  incomingCall: (payload) => ipcRenderer.invoke("app:incoming-call", payload),
  status: (options) => ipcRenderer.invoke("extension:status", options),
  pause: (payload) => ipcRenderer.invoke("extension:pause", payload),
  hangup: (payload) => ipcRenderer.invoke("extension:hangup", payload),
  transfer: (payload) => ipcRenderer.invoke("extension:transfer", payload)
});
