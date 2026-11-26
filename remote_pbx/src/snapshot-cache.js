function snapshotCache(load, { ttlMs = 1000, now = Date.now } = {}) {
  let version = 0;
  let cached;
  let expiresAt = 0;
  let pending = null;
  return {
    invalidate() {
      version += 1;
      cached = undefined;
      expiresAt = 0;
      pending = null;
    },
    async read() {
      if (cached !== undefined && expiresAt > now()) return structuredClone(cached);
      if (!pending) {
        const entry = { version, promise: Promise.resolve().then(load) };
        pending = entry;
        entry.promise = entry.promise.then(value => {
          if (pending === entry && version === entry.version) {
            cached = structuredClone(value);
            expiresAt = now() + ttlMs;
          }
          return value;
        }).finally(() => {
          if (pending === entry) pending = null;
        });
      }
      return structuredClone(await pending.promise);
    }
  };
}

module.exports = { snapshotCache };
