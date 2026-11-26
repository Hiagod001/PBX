(function (root) {
  function singleFlight(operation) {
    const pending = new WeakMap();
    return (session, ...args) => {
      if (pending.has(session)) return pending.get(session);
      const promise = Promise.resolve().then(() => operation(session, ...args)).finally(() => pending.delete(session));
      pending.set(session, promise);
      return promise;
    };
  }

  function protocolTracker({ request, apply, failed, createId, retry = () => false, delay = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
    let current = null;
    return {
      clear() { current = null; },
      start(payload) {
        const token = { requestId: createId() };
        current = token;
        return (async () => {
          for (let attempt = 0; attempt < 2; attempt++) {
            try {
              const result = await request({ ...payload, requestId: token.requestId });
              const protocol = result.protocol?.protocol || '';
              if (current === token) apply(protocol);
              return protocol;
            } catch (error) {
              if (current !== token) return '';
              if (attempt === 0 && retry()) { await delay(250); if (current !== token) return ''; continue; }
              failed?.(error);
              return '';
            }
          }
        })();
      }
    };
  }
  const api = { singleFlight, protocolTracker };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CallControl = api;
})(typeof window === 'object' ? window : globalThis);
