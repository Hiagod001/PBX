const state = {
  extension: null,
  serverUrl: "",
  audioDevicesReady: false,
  portal: null,
  ua: null,
  registerer: null,
  registrationStatus: "offline",
  softphoneStarting: null,
  reconnectTimer: null,
  reconnectAttempts: 0,
  sipGeneration: 0,
  stoppingSoftphone: false,
  session: null,
  incoming: false,
  autoAnswerNext: false,
  callPending: false,
  currentNumber: "",
  currentDirection: "saida",
  currentProtocol: "",
  callStatus: "",
  callStartedAt: null
};

const settingsBtn = document.querySelector("#settingsBtn");
const settingsPanel = document.querySelector("#settingsPanel");
const closeSettingsBtn = document.querySelector("#closeSettingsBtn");
const loginView = document.querySelector("#loginView");
const phoneView = document.querySelector("#phoneView");
const loginForm = document.querySelector("#loginForm");
const extensionInput = document.querySelector("#extensionInput");
const passwordInput = document.querySelector("#passwordInput");
const loginBtn = document.querySelector("#loginBtn");
const loginTestRingBtn = document.querySelector("#loginTestRingBtn");
const loginMessage = document.querySelector("#loginMessage");
const logoutBtn = document.querySelector("#logoutBtn");
const extensionLabel = document.querySelector("#extensionLabel");
const registrationBadge = document.querySelector("#registrationBadge");
const numberInput = document.querySelector("#numberInput");
const activeCallPanel = document.querySelector("#activeCallPanel");
const activeCallKind = document.querySelector("#activeCallKind");
const activeCallNumber = document.querySelector("#activeCallNumber");
const activeCallStatus = document.querySelector("#activeCallStatus");
const activeCallDuration = document.querySelector("#activeCallDuration");
const activeCallExtension = document.querySelector("#activeCallExtension");
const activeCallProtocol = document.querySelector("#activeCallProtocol");
const activeAnswerBtn = document.querySelector("#activeAnswerBtn");
const activeSpeakerBtn = document.querySelector("#activeSpeakerBtn");
const activeMuteBtn = document.querySelector("#activeMuteBtn");
const activeHangupBtn = document.querySelector("#activeHangupBtn");
const callBtn = document.querySelector("#callBtn");
const clearBtn = document.querySelector("#clearBtn");
const callMessage = document.querySelector("#callMessage");
const pauseBtn = document.querySelector("#pauseBtn");
const transferBtn = document.querySelector("#transferBtn");
const historyBtn = document.querySelector("#historyBtn");
const transferPanel = document.querySelector("#transferPanel");
const transferTargetInput = document.querySelector("#transferTargetInput");
const confirmTransferBtn = document.querySelector("#confirmTransferBtn");
const pauseReasonPanel = document.querySelector("#pauseReasonPanel");
const cancelPauseReasonBtn = document.querySelector("#cancelPauseReasonBtn");
const volumeSlider = document.querySelector("#volumeSlider");
const muteSpeakerBtn = document.querySelector("#muteSpeakerBtn");
const muteMicBtn = document.querySelector("#muteMicBtn");
const historyPanel = document.querySelector("#historyPanel");
const refreshHistoryBtn = document.querySelector("#refreshHistoryBtn");
const historyList = document.querySelector("#historyList");
const pauseOverlay = document.querySelector("#pauseOverlay");
const pauseOverlayReason = document.querySelector("#pauseOverlayReason");
const pauseOverlayTime = document.querySelector("#pauseOverlayTime");
const resumeOverlayBtn = document.querySelector("#resumeOverlayBtn");
const ringDeviceSelect = document.querySelector("#ringDeviceSelect");
const callDeviceSelect = document.querySelector("#callDeviceSelect");
const micDeviceSelect = document.querySelector("#micDeviceSelect");
const refreshDevicesBtn = document.querySelector("#refreshDevicesBtn");
const testRingBtn = document.querySelector("#testRingBtn");
const testRingbackBtn = document.querySelector("#testRingbackBtn");
const remoteAudio = document.querySelector("#remoteAudio");

let paused = false;
let speakerMuted = false;
let micMuted = false;
let pauseStartedAt = null;
let pauseReason = "Cafezinho";
let pauseTimer = null;
let callTimer = null;
let pendingCallTimeout = null;
let ringtoneAudio = null;
let ringingAudio = null;
let toneAssetUrls = null;
let toneAudioContext = null;
let toneTestToken = 0;
let activeTone = "";
const synthTones = new Map();
const SIP_REGISTER_TIMEOUT_MS = 15000;
const SIP_RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];
let statusInFlight = false;
let pauseInFlight = false;
let pauseRevision = 0;
let statusTimer = null;

function sipLog(message) {
  window.pbxAPI.sipLog?.(String(message || "")).catch(() => null);
}

function isSipRegistered() {
  return Boolean(
    state.registerer
    && state.ua
    && window.SIP
    && state.registerer.state === SIP.RegistererState.Registered
    && state.ua.transport.state === SIP.TransportState.Connected
  );
}

function setRegistrationStatus(nextStatus) {
  const status = ["online", "connecting", "offline"].includes(nextStatus) ? nextStatus : "offline";
  state.registrationStatus = status;
  registrationBadge.textContent = status === "online" ? "Online" : status === "connecting" ? "Conectando" : "Offline";
  registrationBadge.classList.toggle("is-connecting", status === "connecting");
  registrationBadge.classList.toggle("is-offline", status === "offline");
  if (status === "online" && paused) registrationBadge.textContent = "Em pausa";
  registrationBadge.classList.toggle("is-paused", status === "online" && paused);
  if (!state.session && !state.callPending) callBtn.disabled = status !== "online";
}

function clearSipReconnectTimer() {
  if (!state.reconnectTimer) return;
  clearTimeout(state.reconnectTimer);
  state.reconnectTimer = null;
}

function scheduleSipReconnect(reason = "conexao indisponivel") {
  if (state.stoppingSoftphone || !state.extension || state.reconnectTimer) return;
  const attempt = state.reconnectAttempts + 1;
  state.reconnectAttempts = attempt;
  const delay = SIP_RECONNECT_DELAYS_MS[Math.min(attempt - 1, SIP_RECONNECT_DELAYS_MS.length - 1)];
  setRegistrationStatus("connecting");
  sipLog(`reconnect scheduled attempt=${attempt} delayMs=${delay} reason=${reason}`);
  if (!state.session && !state.callPending) setMessage("Telefone offline. Reconectando...");
  state.reconnectTimer = setTimeout(() => {
    state.reconnectTimer = null;
    if (state.session || state.callPending) {
      scheduleSipReconnect("aguardando encerramento da chamada");
      return;
    }
    startSoftphone().catch((error) => {
      sipLog(`reconnect failed attempt=${attempt} error=${error.message || "unknown"}`);
    });
  }, delay);
}

function assertSoftphoneAttemptActive() {
  if (state.stoppingSoftphone || !state.extension) throw new Error("Registro SIP cancelado");
}

function showLogin(message = "") {
  clearTimeout(statusTimer);
  statusTimer = null;
  setPaused(false);
  state.stoppingSoftphone = true;
  state.extension = null;
  clearSipReconnectTimer();
  setRegistrationStatus("offline");
  stopCallTimer();
  setActiveCallVisible(false);
  loginView.classList.remove("hidden");
  phoneView.classList.add("hidden");
  settingsPanel.classList.add("hidden");
  logoutBtn.classList.add("hidden");
  loginMessage.textContent = message;
  loginBtn.disabled = false;
  loginBtn.textContent = "Entrar no ramal";
  extensionInput.focus();
}

async function showPhone(extension) {
  state.extension = extension;
  state.stoppingSoftphone = false;
  state.reconnectAttempts = 0;
  setRegistrationStatus("connecting");
  loginView.classList.add("hidden");
  phoneView.classList.remove("hidden");
  logoutBtn.classList.remove("hidden");
  extensionLabel.textContent = `${extension.number || "Ramal"} ${extension.name || ""}`.trim();
  activeCallExtension.textContent = extension.number || "-";
  callMessage.textContent = "Registrando telefone...";
  callMessage.classList.add("ok");
  scheduleStatusRefresh(0);
  await startSoftphone().catch((error) => {
    setMessage(`Ramal entrou, mas o telefone nao registrou: ${error.message}`);
  });
  numberInput.focus();
}

function callDurationLabel(startedAt, endedAt = Date.now()) {
  if (!startedAt) return "0s";
  const totalSeconds = Math.max(0, Math.round((endedAt - startedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes ? `${minutes}m ${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function setActiveCallVisible(visible) {
  phoneView.classList.toggle("in-call", Boolean(visible));
  activeCallPanel.classList.toggle("hidden", !visible);
}

function startCallTimer() {
  if (!callTimer) callTimer = setInterval(renderActiveCallPanel, 1000);
}

function stopCallTimer() {
  if (callTimer) {
    clearInterval(callTimer);
    callTimer = null;
  }
}

function clearPendingCallTimeout() {
  if (pendingCallTimeout) {
    clearTimeout(pendingCallTimeout);
    pendingCallTimeout = null;
  }
}

function renderActiveCallPanel() {
  const active = Boolean(state.session || state.callPending);
  setActiveCallVisible(active);
  if (!active) return;

  activeCallKind.textContent = state.currentDirection === "entrada" ? "Chamada de entrada" : "Chamada de saida";
  activeCallNumber.textContent = normalizeCallerNumber(state.currentNumber) || cleanNumber(numberInput.value) || "-";
  activeCallStatus.textContent = state.callStatus || (state.session ? "Em chamada" : "Conectando");
  activeCallDuration.textContent = state.callStartedAt ? callDurationLabel(state.callStartedAt) : "0s";
  activeCallExtension.textContent = state.extension?.number || "-";
  activeCallProtocol.textContent = state.currentProtocol || "-";
  activeAnswerBtn.classList.toggle("hidden", !(state.incoming && state.session));
  activeSpeakerBtn.classList.toggle("warn", speakerMuted);
  activeSpeakerBtn.textContent = speakerMuted ? "Som off" : "Som";
  activeMuteBtn.classList.toggle("warn", micMuted);
  activeMuteBtn.textContent = micMuted ? "Mic off" : "Mic";
}

function stopRingtone() {
  if (activeTone === "ringtone") activeTone = "";
  stopSynthTone("ringtone");
  window.pbxAPI.stopTone?.("ringtone").catch(() => null);
  if (!ringtoneAudio) return;
  ringtoneAudio.pause();
  ringtoneAudio.currentTime = 0;
}

function stopRingback() {
  if (activeTone === "ringing") activeTone = "";
  stopSynthTone("ringing");
  window.pbxAPI.stopTone?.("ringing").catch(() => null);
  if (!ringingAudio) return;
  ringingAudio.pause();
  ringingAudio.currentTime = 0;
}

async function prepareToneAudio(audio, sinkId = "") {
  if (!audio) return;
  audio.loop = true;
  audio.volume = Math.max(0.35, Number(volumeSlider.value || 85) / 100);
  if (typeof audio.setSinkId === "function") await audio.setSinkId(sinkId || "").catch(() => null);
}

function toneVolume() {
  return Math.max(0.35, Number(volumeSlider.value || 85) / 100);
}

async function ensureToneContext() {
  if (!toneAudioContext) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("AudioContext indisponivel");
    toneAudioContext = new AudioContextClass();
  }
  if (toneAudioContext.state === "suspended") await toneAudioContext.resume();
  return toneAudioContext;
}

async function startSynthTone(kind) {
  stopSynthTone(kind);
  const ctx = await ensureToneContext();
  const gain = ctx.createGain();
  const low = ctx.createOscillator();
  const high = ctx.createOscillator();
  low.type = kind === "ringing" ? "sine" : "square";
  high.type = kind === "ringing" ? "sine" : "triangle";
  low.frequency.value = kind === "ringing" ? 425 : 880;
  high.frequency.value = kind === "ringing" ? 425 : 660;
  low.connect(gain);
  high.connect(gain);
  gain.connect(ctx.destination);
  gain.gain.value = 0;
  low.start();
  high.start();

  const pulse = () => {
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    if (kind === "ringtone") {
      gain.gain.setValueAtTime(Math.min(1, toneVolume() + 0.15), now);
      return;
    }
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(toneVolume(), now + 0.03);
    gain.gain.setValueAtTime(toneVolume(), now + 0.75);
    gain.gain.linearRampToValueAtTime(0, now + 0.85);
  };
  pulse();
  const interval = window.setInterval(pulse, kind === "ringing" ? 2500 : 1000);
  synthTones.set(kind, { gain, low, high, interval });
}

function stopSynthTone(kind) {
  const tone = synthTones.get(kind);
  if (!tone) return;
  synthTones.delete(kind);
  window.clearInterval(tone.interval);
  const now = toneAudioContext?.currentTime || 0;
  try {
    tone.gain.gain.cancelScheduledValues(now);
    tone.gain.gain.setValueAtTime(0, now);
    tone.low.stop(now + 0.02);
    tone.high.stop(now + 0.02);
  } catch (_) {
    // Oscillators can only be stopped once.
  }
  tone.low.disconnect();
  tone.high.disconnect();
  tone.gain.disconnect();
}

async function ensureTonePlayers() {
  if (!toneAssetUrls) {
    toneAssetUrls = {
      ringtone: await window.pbxAPI.assetUrl("uai-user-ringtone-mono-loud.wav").catch(() => "../assets/uai-user-ringtone-mono-loud.wav"),
      ringing: await window.pbxAPI.assetUrl("uai-audible-ringback.wav").catch(() => "../assets/uai-audible-ringback.wav")
    };
  }
  if (!ringtoneAudio) ringtoneAudio = new Audio(toneAssetUrls.ringtone);
  if (!ringingAudio) ringingAudio = new Audio(toneAssetUrls.ringing);
  const prefs = audioPrefs();
  await prepareToneAudio(ringtoneAudio, prefs.ring);
  await prepareToneAudio(ringingAudio, prefs.ring);
}

function playTone(audio, label) {
  if (!audio) return;
  audio.currentTime = 0;
  audio.play().catch((error) => {
    setMessage(`Nao consegui tocar o ${label}: ${error.message || "audio bloqueado"}`);
  });
}

function startNativeTone(kind, label) {
  if (activeTone === kind) return;
  activeTone = kind;
  window.pbxAPI.startTone?.(kind).catch((error) => {
    if (activeTone === kind) activeTone = "";
    setMessage(`Falha no ${label} do Windows: ${error.message}`);
  });
}

function startRingtone() {
  if (activeTone === "ringtone") return;
  stopRingtone();
  stopRingback();
  startNativeTone("ringtone", "toque");
}

function startRingback() {
  if (activeTone === "ringing") return;
  stopRingback();
  stopRingtone();
  startNativeTone("ringing", "retorno");
}

function testTone(kind) {
  toneTestToken += 1;
  const token = toneTestToken;
  const isRingback = kind === "ringing";
  [loginTestRingBtn, testRingBtn, testRingbackBtn].forEach((button) => {
    if (button) button.disabled = true;
  });
  if (isRingback) startRingback();
  else startRingtone();
  setMessage(isRingback ? "Teste de chamando tocando..." : "Teste de toque tocando...", true);
  setTimeout(() => {
    if (token !== toneTestToken) return;
    if (isRingback) stopRingback();
    else stopRingtone();
    [loginTestRingBtn, testRingBtn, testRingbackBtn].forEach((button) => {
      if (button) button.disabled = false;
    });
  }, 10000);
}

function audioPrefs() {
  return {
    ring: "",
    call: localStorage.getItem("uai:callDevice") || "",
    mic: localStorage.getItem("uai:micDevice") || ""
  };
}

function saveAudioPrefs() {
  localStorage.setItem("uai:ringDevice", ringDeviceSelect.value);
  localStorage.setItem("uai:callDevice", callDeviceSelect.value);
  localStorage.setItem("uai:micDevice", micDeviceSelect.value);
  applyAudioDevices();
  if (state.extension) setMessage("Dispositivos de audio salvos.", true);
}

function deviceOption(device, index) {
  const option = document.createElement("option");
  option.value = device.deviceId;
  option.textContent = device.label || `Dispositivo ${index + 1}`;
  return option;
}

function fillDeviceSelect(select, devices, selectedValue, fallbackLabel) {
  select.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = fallbackLabel;
  select.append(defaultOption);
  devices.forEach((device, index) => select.append(deviceOption(device, index)));
  select.value = [...select.options].some((option) => option.value === selectedValue) ? selectedValue : "";
}

async function loadAudioDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  try {
    if (!state.audioDevicesReady && navigator.mediaDevices.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => null);
      stream?.getTracks().forEach((track) => track.stop());
      state.audioDevicesReady = true;
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const outputs = devices.filter((device) => device.kind === "audiooutput");
    const inputs = devices.filter((device) => device.kind === "audioinput");
    const prefs = audioPrefs();
    fillDeviceSelect(ringDeviceSelect, outputs, prefs.ring, "Padrao do Windows");
    fillDeviceSelect(callDeviceSelect, outputs, prefs.call, "Padrao do Windows");
    fillDeviceSelect(micDeviceSelect, inputs, prefs.mic, "Padrao do Windows");
  } catch (_error) {
    fillDeviceSelect(ringDeviceSelect, [], "", "Padrao do Windows");
    fillDeviceSelect(callDeviceSelect, [], "", "Padrao do Windows");
    fillDeviceSelect(micDeviceSelect, [], "", "Padrao do Windows");
  }
}

async function applyAudioDevices() {
  const prefs = audioPrefs();
  if (remoteAudio && typeof remoteAudio.setSinkId === "function") {
    await remoteAudio.setSinkId(prefs.call || "").catch(() => null);
  }
  remoteAudio.volume = speakerMuted ? 0 : Number(volumeSlider.value || 85) / 100;
  await ensureTonePlayers().catch(() => null);
}

function audioConstraints() {
  const mic = audioPrefs().mic;
  return mic ? { deviceId: { exact: mic } } : true;
}

function waitForSipLibrary(timeoutMs = 9000) {
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
    }, 100);
  });
}

function setCallSession(session) {
  state.callPending = false;
  state.session = session;
  state.callStatus = "Conectando";
  renderActiveCallPanel();
  startCallTimer();
  watchSipSession(session);
}

function attachRemoteAudio(session) {
  const peerConnection = session?.sessionDescriptionHandler?.peerConnection;
  if (!remoteAudio || !peerConnection) return;
  const stream = new MediaStream();
  peerConnection.getReceivers().forEach((receiver) => {
    if (receiver.track) stream.addTrack(receiver.track);
  });
  remoteAudio.srcObject = stream;
  applyAudioDevices();
  remoteAudio.play().catch(() => null);
}

async function terminateSipSession(session) {
  if (!session) return;
  const action = PhoneState.terminationAction(session, SIP.SessionState);
  if (action) await session[action]();
}

function finishSipCall(message = "Chamada encerrada.") {
  clearPendingCallTimeout();
  stopRingtone();
  stopRingback();
  state.session = null;
  state.incoming = false;
  state.autoAnswerNext = false;
  state.callPending = false;
  state.callStartedAt = null;
  state.callStatus = "";
  state.currentNumber = "";
  state.currentProtocol = "";
  stopCallTimer();
  renderActiveCallPanel();
  if (state.ua) setMessage(message, true);
  callBtn.textContent = "Ligar";
  callBtn.classList.remove("warn");
  callBtn.disabled = !isSipRegistered();
  remoteAudio.pause();
  remoteAudio.srcObject = null;
  transferBtn.disabled = true;
  setPaused(paused);
}

async function hangupCurrentCall(message = "Chamada encerrada.") {
  clearPendingCallTimeout();
  stopRingtone();
  stopRingback();
  const session = state.session;
  state.autoAnswerNext = false;
  state.callPending = false;
  state.callStatus = "Encerrando";
  renderActiveCallPanel();

  await Promise.all([
    finishSipOperation("terminate call", terminateSipSession(session)),
    finishSipOperation("hangup server", window.pbxAPI.hangup?.({}))
  ]).catch(() => null);

  finishSipCall(message);
}

function watchSipSession(session) {
  const sessionState = window.SIP?.SessionState || {};
  session.delegate = {
    ...(session.delegate || {}),
    onBye() {
      if (state.session !== session) return;
      stopRingtone();
      stopRingback();
      finishSipCall("Chamada encerrada pela outra ponta.");
    },
    onCancel() {
      if (state.session !== session) return;
      stopRingtone();
      stopRingback();
      finishSipCall("Chamada cancelada.");
    }
  };
  session.stateChange?.addListener?.((nextState) => {
    if (state.session !== session) return;
    if (nextState === sessionState.Establishing) {
      state.callStatus = "Chamando";
      setMessage("Chamando...", true);
      renderActiveCallPanel();
    }
    if (nextState === sessionState.Established) {
      stopRingtone();
      stopRingback();
      state.incoming = false;
      state.callStartedAt = Date.now();
      state.callStatus = "Em chamada";
      callBtn.textContent = "Encerrar";
      callBtn.classList.add("warn");
      setMessage("Chamada em andamento.", true);
      attachRemoteAudio(session);
      transferBtn.disabled = false;
      renderActiveCallPanel();
      startCallTimer();
    }
    if (nextState === sessionState.Terminated) {
      finishSipCall("Chamada encerrada.");
    }
  });
}

async function answerSipCall(session) {
  if (!session?.accept) return;
  stopRingtone();
  stopRingback();
  state.incoming = false;
  state.callStatus = "Atendendo";
  renderActiveCallPanel();
  await session.accept({ sessionDescriptionHandlerOptions: { constraints: { audio: audioConstraints(), video: false } } });
}

async function loadPortal() {
  if (state.portal) return state.portal;
  const result = await window.pbxAPI.portal();
  state.portal = result.portal;
  return state.portal;
}

function waitForSipRegistration(registerer, generation, timeoutMs = SIP_REGISTER_TIMEOUT_MS) {
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
      if (generation !== state.sipGeneration) {
        finish(new Error("Registro SIP substituido"));
        return;
      }
      if (nextState === SIP.RegistererState.Registered) finish();
      if (nextState === SIP.RegistererState.Terminated) finish(new Error("Registro SIP encerrado pelo servidor"));
    };
    const timer = setTimeout(() => finish(new Error("Servidor nao confirmou o registro SIP")), timeoutMs);
    registerer.stateChange.addListener(listener);
  });
}

async function finishSipOperation(label, operation, timeoutMs = 3000) {
  let timer = null;
  try {
    const finished = await Promise.race([
      Promise.resolve(operation).then(() => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
      })
    ]);
    if (!finished) sipLog(`${label} timed out after ${timeoutMs}ms`);
  } catch (error) {
    sipLog(`${label} failed error=${error.message || "unknown"}`);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function disposeSipStack(unregister = false) {
  const registerer = state.registerer;
  const userAgent = state.ua;
  state.sipGeneration += 1;
  state.registerer = null;
  state.ua = null;
  if (unregister && registerer) await finishSipOperation("unregister", registerer.unregister());
  if (userAgent) await finishSipOperation("userAgent.stop", userAgent.stop());
}

async function startSoftphone() {
  if (isSipRegistered()) return;
  if (state.softphoneStarting) return state.softphoneStarting;

  clearSipReconnectTimer();
  state.softphoneStarting = (async () => {
    state.stoppingSoftphone = false;
    setRegistrationStatus("connecting");
    sipLog(`registration starting extension=${state.extension?.number || "unknown"}`);
    if (state.ua || state.registerer) await disposeSipStack(false);
    assertSoftphoneAttemptActive();

    const portal = await loadPortal();
    await waitForSipLibrary();
    assertSoftphoneAttemptActive();
    const sip = portal.sip;
    const userAgent = new SIP.UserAgent({
      uri: SIP.UserAgent.makeURI(sip.uri),
      authorizationUsername: sip.authorizationUsername,
      authorizationPassword: sip.password,
      displayName: sip.displayName,
      transportOptions: {
        server: sip.wsServer,
        connectionTimeout: 10,
        keepAliveInterval: 20,
        keepAliveDebounce: 10
      },
      sessionDescriptionHandlerFactoryOptions: {
        constraints: { audio: audioConstraints(), video: false }
      }
    });

    const generation = state.sipGeneration + 1;
    state.sipGeneration = generation;
    userAgent.delegate = {
      async onInvite(invitation) {
        if (PhoneState.rejectInvitation({ paused: paused || pauseInFlight, busy: Boolean(state.session), stopping: state.stoppingSoftphone || generation !== state.sipGeneration, callback: state.autoAnswerNext && state.callPending })) {
          await invitation.reject({ statusCode: 486 }).catch(() => null);
          return;
        }
        setCallSession(invitation);
        if (state.autoAnswerNext) {
          state.autoAnswerNext = false;
          setMessage("Conectando chamada...", true);
          await answerSipCall(invitation).catch((error) => setMessage(`Falha ao atender: ${error.message}`));
          return;
        }
        state.currentDirection = "entrada";
        state.incoming = true;
        state.currentNumber = normalizeCallerNumber(invitation.remoteIdentity?.uri?.user || invitation.remoteIdentity?.displayName || "entrada");
        state.currentProtocol = "";
        await assignCallProtocol("entrada", state.currentNumber).catch(() => null);
        state.callStatus = "Recebendo chamada";
        setMessage("Chamada recebida.", true);
        startRingtone();
        window.pbxAPI?.incomingCall?.({ number: state.currentNumber, extension: state.extension?.number || "" }).catch(() => null);
        renderActiveCallPanel();
      }
    };

    const registerer = new SIP.Registerer(userAgent, { expires: 300 });
    state.ua = userAgent;
    state.registerer = registerer;

    userAgent.transport.stateChange.addListener((nextState) => {
      if (generation !== state.sipGeneration || state.stoppingSoftphone) return;
      sipLog(`transport state=${nextState}`);
      if (nextState === SIP.TransportState.Connecting) setRegistrationStatus("connecting");
      if (nextState === SIP.TransportState.Disconnected) {
        setRegistrationStatus("offline");
        scheduleSipReconnect("websocket desconectado");
      }
    });

    registerer.stateChange.addListener((nextState) => {
      if (generation !== state.sipGeneration || state.stoppingSoftphone) return;
      sipLog(`registerer state=${nextState}`);
      if (nextState === SIP.RegistererState.Registered) {
        state.reconnectAttempts = 0;
        setRegistrationStatus("online");
        setMessage("Telefone online.", true);
      } else if (nextState === SIP.RegistererState.Unregistered || nextState === SIP.RegistererState.Terminated) {
        setRegistrationStatus("offline");
        scheduleSipReconnect(`registro ${nextState}`);
      }
    });

    await userAgent.start();
    await registerer.register();
    await waitForSipRegistration(registerer, generation);
    sipLog("registration confirmed");
  })().catch((error) => {
    setRegistrationStatus("offline");
    scheduleSipReconnect(error.message || "falha no registro");
    throw error;
  }).finally(() => {
    state.softphoneStarting = null;
  });

  return state.softphoneStarting;
}

async function stopSoftphone() {
  state.stoppingSoftphone = true;
  clearSipReconnectTimer();
  clearPendingCallTimeout();
  stopRingtone();
  stopRingback();
  await finishSipOperation("terminate on logout", terminateSipSession(state.session));
  state.session = null;
  await disposeSipStack(true);
  setRegistrationStatus("offline");
  state.portal = null;
  state.incoming = false;
  state.autoAnswerNext = false;
  state.callPending = false;
  state.callStatus = "";
  state.currentProtocol = "";
  stopCallTimer();
  renderActiveCallPanel();
}

async function assignCallProtocol(direction, number) {
  if (state.currentProtocol) return state.currentProtocol;
  const result = await window.pbxAPI.protocol({ direction, number });
  state.currentProtocol = result.protocol?.protocol || "";
  renderActiveCallPanel();
  return state.currentProtocol;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (label) button.textContent = label;
}

function cleanNumber(value) {
  return String(value || "").replace(/\D+/g, "");
}

function normalizeCallerNumber(value) {
  const text = String(value || "").trim();
  const angleMatch = text.match(/<\s*([^>]+)\s*>/);
  const raw = angleMatch ? angleMatch[1] : text;
  const quotedDigits = [...text.matchAll(/"([^"]+)"/g)]
    .map((match) => cleanNumber(match[1]))
    .find(Boolean);
  const digits = cleanNumber(raw) || quotedDigits || cleanNumber(text);
  return digits || text.replace(/^"|"$/g, "");
}

function setMessage(text, ok = false) {
  callMessage.textContent = text;
  callMessage.classList.toggle("ok", ok);
  document.querySelector("#pauseMessage").textContent = paused && !ok ? text : "";
}

function setPaused(nextPaused) {
  paused = Boolean(nextPaused);
  if (paused && !pauseStartedAt) pauseStartedAt = Date.now();
  if (!paused) pauseStartedAt = null;
  pauseBtn.classList.toggle("active", paused);
  pauseBtn.textContent = paused ? "Voltar" : "Pausa";
  pauseOverlay.classList.toggle("hidden", !paused || Boolean(state.session || state.callPending));
  pauseOverlayReason.textContent = pauseReason || "Pausa";
  setRegistrationStatus(state.registrationStatus);
  updatePauseClock();
  if (paused && !pauseTimer) pauseTimer = setInterval(updatePauseClock, 1000);
  if (!paused && pauseTimer) {
    clearInterval(pauseTimer);
    pauseTimer = null;
  }
}

function updatePauseClock() {
  if (!paused || !pauseStartedAt) {
    pauseOverlayTime.textContent = "0s";
    return;
  }
  const totalSeconds = Math.max(0, Math.round((Date.now() - pauseStartedAt) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  pauseOverlayTime.textContent = minutes ? `${minutes}m ${seconds}s` : `${seconds}s`;
}

function renderHistory(calls = []) {
  if (!calls.length) {
    historyList.innerHTML = `<div class="history-item"><strong>Sem chamadas</strong><span>Nenhum registro recente encontrado.</span></div>`;
    return;
  }
  historyList.innerHTML = calls.slice(0, 20).map((call) => {
    const date = call.startedAt ? new Date(call.startedAt).toLocaleString("pt-BR") : "-";
    const number = displayHistoryNumber(call);
    const status = call.statusLabel || call.disposition || call.status || "-";
    const protocol = call.protocol || "Sem protocolo";
    return `
      <article class="history-item">
        <strong>${escapeHtml(number)} - ${escapeHtml(status)}</strong>
        <span>${escapeHtml(date)} | ${escapeHtml(call.typeLabel || call.type || "-")}</span>
        <span>Protocolo: ${escapeHtml(protocol)}</span>
        <span>Duracao: ${escapeHtml(call.durationLabel || call.billsecLabel || "-")}</span>
      </article>
    `;
  }).join("");
}

function displayHistoryNumber(call) {
  const type = String(call.type || call.typeLabel || "").toLowerCase();
  const candidates = type.includes("entrada") || type === "inbound"
    ? [call.customerNumber, call.callerId, call.source, call.src, call.trunkDialedNumber, call.originalDestination, call.destination]
    : [call.customerNumber, call.trunkDialedNumber, call.destination, call.originalDestination, call.callerId, call.source];
  return candidates
    .map((value) => normalizeCallerNumber(value))
    .find((value) => value && value.toLowerCase() !== "s") || "-";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function refreshStatus() {
  if (!state.extension || statusInFlight) return;
  statusInFlight = true;
  const extension = state.extension;
  const revision = pauseRevision;
  try {
    const result = await window.pbxAPI.status();
    if (state.extension !== extension) return;
    const status = result.status || {};
    if (!pauseInFlight && revision === pauseRevision) {
      const pause = PhoneState.pauseFromStatus(status);
      pauseReason = pause.reason;
      pauseStartedAt = pause.startedAt;
      setPaused(pause.paused);
    }
    if (!historyPanel.classList.contains("hidden")) renderHistory(status.recentCalls || []);
    if (!isSipRegistered() && !state.session) scheduleSipReconnect("verificacao periodica");
  } catch (_error) {
    setMessage("Sem resposta do servidor. Tentando novamente...");
  } finally {
    statusInFlight = false;
  }
}

function scheduleStatusRefresh(delay = 2000) {
  clearTimeout(statusTimer);
  if (!state.extension) return;
  statusTimer = setTimeout(async () => {
    await refreshStatus();
    scheduleStatusRefresh();
  }, delay);
}

async function startPause(reason) {
  if (pauseInFlight) return;
  pauseInFlight = true;
  pauseRevision += 1;
  pauseReason = reason || "Cafezinho";
  pauseStartedAt = Date.now();
  pauseReasonPanel.classList.add("hidden");
  setBusy(pauseBtn, true, "Pausando...");
  try {
    const response = await window.pbxAPI.pause({ paused: true, reason: pauseReason });
    pauseStartedAt = Date.parse(response.result?.pause?.startedAt || "") || Date.now();
    setPaused(true);
    setMessage(`Ramal pausado: ${pauseReason}.`, true);
  } catch (error) {
    setPaused(false);
    setMessage(error.message || "Nao foi possivel pausar.");
  } finally {
    pauseInFlight = false;
    pauseRevision += 1;
    pauseBtn.disabled = false;
  }
}

async function resumePause() {
  if (pauseInFlight) return;
  pauseInFlight = true;
  pauseRevision += 1;
  setBusy(pauseBtn, true, "Voltando...");
  try {
    await window.pbxAPI.pause({ paused: false });
    setPaused(false);
    setMessage("Ramal voltou da pausa.", true);
  } catch (error) {
    setMessage(error.message || "Nao foi possivel voltar da pausa.");
  } finally {
    pauseInFlight = false;
    pauseRevision += 1;
    pauseBtn.disabled = false;
  }
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  loginMessage.textContent = "";
  setBusy(loginBtn, true, "Entrando...");
  try {
    const result = await window.pbxAPI.login({
      extension: extensionInput.value,
      password: passwordInput.value
    });
    passwordInput.value = "";
    localStorage.setItem("uai:lastExtension", extensionInput.value.trim());
    await showPhone(result.extension);
  } catch (error) {
    showLogin(error.message || "Nao foi possivel entrar no ramal.");
  }
});

logoutBtn.addEventListener("click", async () => {
  await stopSoftphone().catch(() => null);
  await window.pbxAPI.logout().catch(() => null);
  setPaused(false);
  showLogin();
});

settingsBtn.addEventListener("click", async () => {
  settingsPanel.classList.toggle("hidden");
  if (!settingsPanel.classList.contains("hidden")) await loadAudioDevices();
});

closeSettingsBtn.addEventListener("click", () => {
  settingsPanel.classList.add("hidden");
});

refreshDevicesBtn.addEventListener("click", loadAudioDevices);
testRingBtn.addEventListener("click", () => testTone("ringtone"));
testRingbackBtn.addEventListener("click", () => testTone("ringing"));
loginTestRingBtn.addEventListener("click", () => testTone("ringtone"));

[ringDeviceSelect, callDeviceSelect, micDeviceSelect].forEach((select) => {
  select.addEventListener("change", saveAudioPrefs);
});

document.querySelectorAll("[data-digit]").forEach((button) => {
  button.addEventListener("click", () => {
    numberInput.value = `${numberInput.value || ""}${button.dataset.digit}`;
    numberInput.focus();
  });
});

clearBtn.addEventListener("click", () => {
  numberInput.value = "";
  numberInput.focus();
});

numberInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    callBtn.click();
  }
});

callBtn.addEventListener("click", async () => {
  if (state.callPending) {
    setBusy(callBtn, true, "Encerrando...");
    await hangupCurrentCall("Chamada cancelada.");
    setBusy(callBtn, false, "Ligar");
    return;
  }
  if (state.session) {
    setBusy(callBtn, true, "Encerrando...");
    await hangupCurrentCall("Chamada encerrada.");
    setBusy(callBtn, false, "Ligar");
    return;
  }
  const number = cleanNumber(numberInput.value);
  callMessage.classList.remove("ok");
  if (!number) {
    callMessage.textContent = "Informe o numero para ligar.";
    return;
  }
  setBusy(callBtn, true, "Ligando...");
  setMessage(`Preparando telefone para ${number}...`);
  try {
    await startSoftphone();
    state.currentNumber = number;
    state.currentDirection = "saida";
    state.callStatus = "Conectando";
    state.currentProtocol = "";
    await assignCallProtocol("saida", number);
    state.autoAnswerNext = true;
    state.callPending = true;
    renderActiveCallPanel();
    startCallTimer();
    startRingback();
    setMessage(`Chamando ${number}...`, true);
    const result = await window.pbxAPI.call({ number });
    const target = result.call?.target || number;
    setMessage(`Chamada enviada. Conectando ${target}...`, true);
    callBtn.textContent = "Aguardando...";
    renderActiveCallPanel();
    clearPendingCallTimeout();
    pendingCallTimeout = setTimeout(() => {
      pendingCallTimeout = null;
      if (!state.session && state.callPending) {
        stopRingback();
        state.callPending = false;
        state.autoAnswerNext = false;
        state.callStatus = "";
        state.currentProtocol = "";
        stopCallTimer();
        renderActiveCallPanel();
        setBusy(callBtn, false, "Ligar");
        setMessage("O Asterisk aceitou a chamada, mas o telefone nao recebeu a conexao. Verifique o registro SIP do ramal.");
      }
    }, 20000);
    refreshStatus();
  } catch (error) {
    clearPendingCallTimeout();
    state.autoAnswerNext = false;
    state.callPending = false;
    stopRingback();
    state.callStatus = "";
    state.currentProtocol = "";
    stopCallTimer();
    renderActiveCallPanel();
    setMessage(error.message || "Nao foi possivel iniciar a chamada.");
  } finally {
    if (!state.session && !state.callPending) setBusy(callBtn, false, "Ligar");
    else callBtn.disabled = false;
  }
});

activeHangupBtn.addEventListener("click", () => callBtn.click());

activeAnswerBtn.addEventListener("click", async () => {
  if (!state.session || !state.incoming) return;
  activeAnswerBtn.disabled = true;
  activeAnswerBtn.textContent = "Atendendo...";
  try {
    await answerSipCall(state.session);
  } catch (error) {
    setMessage(`Falha ao atender: ${error.message}`);
  } finally {
    activeAnswerBtn.disabled = false;
    activeAnswerBtn.textContent = "Atender";
    renderActiveCallPanel();
  }
});
activeSpeakerBtn.addEventListener("click", () => muteSpeakerBtn.click());
activeMuteBtn.addEventListener("click", () => muteMicBtn.click());

pauseBtn.addEventListener("click", async () => {
  if (paused) {
    await resumePause();
    return;
  }
  pauseReasonPanel.classList.toggle("hidden");
});

document.querySelectorAll("[data-pause-reason]").forEach((button) => {
  button.addEventListener("click", () => startPause(button.dataset.pauseReason || "Cafezinho"));
});

cancelPauseReasonBtn.addEventListener("click", () => {
  pauseReasonPanel.classList.add("hidden");
});

resumeOverlayBtn.addEventListener("click", async () => {
  setBusy(resumeOverlayBtn, true, "Voltando...");
  try {
    await resumePause();
  } catch (error) {
    setMessage(error.message || "Nao foi possivel voltar da pausa.");
  } finally {
    setBusy(resumeOverlayBtn, false, "Voltar da pausa");
  }
});

transferBtn.addEventListener("click", () => {
  transferPanel.classList.toggle("hidden");
  transferTargetInput.focus();
});

confirmTransferBtn.addEventListener("click", async () => {
  const target = transferTargetInput.value.trim();
  setBusy(confirmTransferBtn, true, "Transferindo...");
  try {
    const result = await window.pbxAPI.transfer({ target });
    setMessage(`Transferencia enviada para ${result.transfer?.target || target}.`, true);
    transferPanel.classList.add("hidden");
    transferTargetInput.value = "";
  } catch (error) {
    setMessage(error.message || "Nao foi possivel transferir.");
  } finally {
    setBusy(confirmTransferBtn, false, "Confirmar transferencia");
  }
});

historyBtn.addEventListener("click", async () => {
  historyPanel.classList.toggle("hidden");
  if (!historyPanel.classList.contains("hidden")) await refreshStatus();
});

refreshHistoryBtn.addEventListener("click", refreshStatus);

muteSpeakerBtn.addEventListener("click", () => {
  speakerMuted = !speakerMuted;
  muteSpeakerBtn.classList.toggle("warn", speakerMuted);
  muteSpeakerBtn.textContent = speakerMuted ? "Som off" : "Som";
  volumeSlider.disabled = speakerMuted;
  applyAudioDevices();
  renderActiveCallPanel();
});

muteMicBtn.addEventListener("click", () => {
  micMuted = !micMuted;
  muteMicBtn.classList.toggle("warn", micMuted);
  muteMicBtn.textContent = micMuted ? "Mic off" : "Mic";
  state.session?.sessionDescriptionHandler?.peerConnection?.getSenders().forEach((sender) => {
    if (sender.track?.kind === "audio") sender.track.enabled = !micMuted;
  });
  renderActiveCallPanel();
});

volumeSlider.addEventListener("input", applyAudioDevices);

window.addEventListener("DOMContentLoaded", async () => {
  applyAppTheme(localStorage.getItem("uai:theme") || "dark");
  extensionInput.value = localStorage.getItem("uai:lastExtension") || "";
  transferBtn.disabled = true;
  try {
    const info = await window.pbxAPI.server();
    state.serverUrl = info.serverUrl;
    await loadAudioDevices();
    showLogin();
  } catch (error) {
    showLogin(`Nao foi possivel preparar o telefone: ${error.message}`);
  }
});

function applyAppTheme(theme) {
  document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  localStorage.setItem("uai:theme", document.documentElement.dataset.theme);
  document.querySelector("#themeBtn").innerHTML = `<i data-lucide="${theme === "light" ? "moon" : "sun"}"></i>`;
  window.lucide?.createIcons({ icons: window.lucide.icons });
}
document.querySelector("#themeBtn").addEventListener("click", () => applyAppTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light"));

window.pbxAPI.onResume?.(() => {
  if (!state.extension) return;
  scheduleStatusRefresh(0);
  if (!state.session) startSoftphone().catch(() => null);
});
window.pbxAPI.onSessionExpired?.(async () => {
  await stopSoftphone().catch(() => null);
  showLogin("Sessao encerrada. Entre novamente no ramal.");
});
window.addEventListener("online", () => {
  if (state.extension) scheduleStatusRefresh(0);
});
