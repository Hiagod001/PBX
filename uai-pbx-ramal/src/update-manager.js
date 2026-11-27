function createUpdateManager({ updater, publish = () => {}, prepare, cancelPrepare = () => {}, beforeInstall = async () => {},
  serverIdle = async () => true, log = () => {}, clock = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
  idleMs = 60000, checkMs = 2 * 60 * 60 * 1000, initialMs = 30000 }) {
  let state = { phase: 'idle', version: '', percent: 0 }, activity = null, idleSince = null;
  let checking = null, installing = false, ready = false, stopped = false;
  let checkTimer = null, idleTimer = null;
  const listeners = [];
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = false;
  if ('autoInstallEvent' in updater) updater.autoInstallEvent = 'manual';
  updater.allowDowngrade = false;
  updater.allowPrerelease = false;
  updater.disableWebInstaller = true;
  const emit = patch => { state = { ...state, ...patch }; publish({ ...state }); };
  const on = (name, fn) => { updater.on(name, fn); listeners.push([name, fn]); };
  const busy = () => !activity || activity.busy || clock() - activity.at > 10000;
  const armCheck = delay => {
    if (stopped) return;
    if (checkTimer !== null) clearTimer(checkTimer);
    checkTimer = setTimer(() => { checkTimer = null; check(); }, delay);
  };
  on('checking-for-update', () => { if (!ready) emit({ phase: 'checking' }); });
  on('update-available', info => emit({ phase: 'downloading', version: info.version, percent: 0 }));
  on('download-progress', info => emit({ phase: 'downloading', percent: Math.max(0, Math.min(100, Math.round(info.percent || 0))) }));
  on('update-not-available', () => { if (!ready) emit({ phase: 'current' }); });
  on('update-downloaded', info => { ready = true; idleSince = null; emit({ phase: 'ready', version: info.version, percent: 100 }); });
  on('error', error => {
    log(`update error: ${error?.message || 'unavailable'}`);
    if (state.phase === 'installing') {
      void Promise.resolve(cancelPrepare()).catch(() => {});
      idleSince = clock();
      emit({ phase: 'ready' });
    }
    if (!ready && !installing) emit({ phase: 'error' });
    armCheck(15 * 60 * 1000);
  });
  function check() {
    if (stopped || installing || ready) return Promise.resolve({ ...state });
    if (checking) return checking;
    checking = Promise.resolve().then(() => updater.checkForUpdates()).catch(error => {
      log(`update check failed: ${error?.message || 'unavailable'}`);
      emit({ phase: 'error' });
    }).finally(() => {
      checking = null;
      armCheck(state.phase === 'error' ? 15 * 60 * 1000 : checkMs);
    });
    return checking;
  }
  async function install() {
    if (stopped || installing || state.phase === 'installing' || !ready || busy()) return false;
    installing = true;
    try {
      if (!(await serverIdle()) || stopped || busy()) { idleSince = null; return false; }
      // The renderer checks once more and prevents new calls before stopping SIP.
      // No installation is permitted using a stale activity report alone.
      if (!(await prepare())) { await cancelPrepare(); idleSince = null; return false; }
      if (stopped) { await cancelPrepare(); return false; }
      emit({ phase: 'installing' });
      await beforeInstall();
      if (stopped) { await cancelPrepare(); return false; }
      updater.quitAndInstall(true, true);
      return true;
    } catch (error) {
      log(`update install deferred: ${error?.message || 'unavailable'}`);
      await Promise.resolve(cancelPrepare()).catch(() => {});
      idleSince = clock();
      emit({ phase: 'ready' });
      return false;
    } finally { installing = false; }
  }
  function tick() {
    if (stopped) return;
    if (busy()) idleSince = null;
    else if (idleSince === null) idleSince = clock();
    if (ready && idleSince !== null && clock() - idleSince >= idleMs) void install();
    idleTimer = setTimer(tick, 5000);
  }
  return {
    start() { stopped = false; armCheck(initialMs); tick(); },
    check, install,
    getState: () => ({ ...state }),
    activity(value) {
      activity = { busy: value?.busy !== false, at: clock() };
      if (activity.busy) idleSince = null;
    },
    stop() {
      stopped = true;
      if (checkTimer !== null) clearTimer(checkTimer);
      if (idleTimer !== null) clearTimer(idleTimer);
      listeners.forEach(([name, fn]) => updater.removeListener(name, fn));
    }
  };
}
module.exports = { createUpdateManager };
