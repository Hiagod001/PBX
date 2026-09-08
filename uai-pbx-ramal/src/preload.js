const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pbxAPI", {
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
  status: () => ipcRenderer.invoke("extension:status"),
  pause: (payload) => ipcRenderer.invoke("extension:pause", payload),
  hangup: (payload) => ipcRenderer.invoke("extension:hangup", payload),
  transfer: (payload) => ipcRenderer.invoke("extension:transfer", payload)
});
