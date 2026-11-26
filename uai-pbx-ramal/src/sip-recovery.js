(function (root) {
  // Shared by the browser phone and the Windows launcher. Never stop a user
  // agent to repair its transport: doing so also disposes its live calls.
  function registerConfirmed(registerer, { valid = () => true, timeoutMs = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        registerer.waitingChange?.removeListener(waiting);
        error ? reject(error) : resolve();
      };
      const accept = () => finish(valid() && registerer.state === 'Registered' ? null : new Error('Registro não confirmado.'));
      const waiting = value => {
        if (!value) accept();
      };
      const timer = setTimeout(() => finish(new Error('Servidor não confirmou a conexão.')), timeoutMs);
      if (!valid()) return finish(new Error('Conexão cancelada.'));
      if (registerer.waiting) {
        registerer.waitingChange.addListener(waiting);
        return;
      }
      try {
        Promise.resolve(registerer.register({ requestDelegate: {
          onAccept: accept,
          onReject: () => finish(new Error('Servidor recusou o registro do ramal.')),
          onRedirect: () => finish(new Error('Servidor não confirmou o registro do ramal.'))
        } })).catch(finish);
      } catch (error) { finish(error); }
    });
  }

  async function restoreTransport(userAgent, { force = false, valid = () => true } = {}) {
    const assertActive = () => { if (!valid()) throw new Error('Conexão cancelada.'); };
    assertActive();
    if (force && userAgent.transport.state !== 'Disconnected') await userAgent.transport.disconnect();
    assertActive();
    if (userAgent.state !== 'Started') await userAgent.start();
    else if (userAgent.transport.state !== 'Connected') await userAgent.reconnect();
    assertActive();
  }

  function create({ enabled, healthy, connect, status = () => {}, log = () => {},
    clock = Date.now, setTimer = setTimeout, clearTimer = clearTimeout,
    checkMs = 5000, probeMs = 45000, random = Math.random }) {
    let stopped = true, epoch = 0, pending = null, retry = null, watch = null;
    let attempts = 0, verifiedAt = 0, force = false;
    const active = () => !stopped && enabled();
    const clearRetry = () => { if (retry !== null) clearTimer(retry); retry = null; };
    const armWatch = () => {
      if (!active() || watch !== null) return;
      watch = setTimer(() => { watch = null; check('verificação periódica'); armWatch(); }, checkMs);
    };
    function schedule(reason = 'conexão interrompida', immediate = false) {
      if (!active() || pending) return;
      if (retry !== null && !immediate) return;
      clearRetry();
      const delays = [1000, 2000, 5000, 10000, 30000];
      const delay = immediate ? 0 : Math.round(delays[Math.min(attempts, delays.length - 1)] * (1 + random() * .2));
      status('connecting');
      log(`recovery scheduled attempt=${attempts + 1} delayMs=${delay} reason=${reason}`);
      retry = setTimer(() => { retry = null; ensure({ probe: true }).catch(() => {}); }, delay);
    }
    function ensure({ probe = false } = {}) {
      if (!active()) return Promise.resolve();
      if (pending) return pending;
      if (!probe && healthy()) return Promise.resolve();
      clearRetry();
      const current = epoch;
      const valid = () => active() && current === epoch;
      if (!healthy()) status('connecting');
      const operation = Promise.resolve().then(() => connect({ force, valid })).then(() => {
        if (!valid()) return;
        if (!healthy()) throw new Error('Conexão ainda não confirmada.');
        attempts = 0; force = false; verifiedAt = clock();
        status('online');
        log('recovery registration confirmed');
      }).catch(error => {
        if (valid()) {
          attempts += 1; force = true;
          status('connecting');
          log(`recovery failed attempt=${attempts} error=${error.message || 'unknown'}`);
        }
        throw error;
      }).finally(() => {
        if (pending !== operation) return;
        pending = null;
        if (valid() && force) schedule('nova tentativa');
      });
      pending = operation;
      return operation;
    }
    function check(reason = 'conexão disponível', immediate = false) {
      if (!active()) return;
      if (immediate || !healthy() || clock() - verifiedAt >= probeMs) {
        if (healthy()) ensure({ probe: true }).catch(() => {});
        else schedule(reason, immediate);
      }
    }
    return {
      start() { stopped = false; armWatch(); return ensure(); },
      ensure, schedule, check,
      stop() {
        stopped = true; epoch += 1; clearRetry();
        if (watch !== null) clearTimer(watch);
        watch = null; pending = null; attempts = 0; verifiedAt = 0; force = false;
      }
    };
  }
  const api = { create, registerConfirmed, restoreTransport };
  if (typeof module !== 'undefined') module.exports = api;
  else root.SipRecovery = api;
})(typeof window !== 'undefined' ? window : globalThis);
