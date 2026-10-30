function createCdrMapper(mapRow, { limit = 60000, batchSize = 500 } = {}) {
  const cache = new Map();
  let currentRevision;
  return async (rows, config, revision) => {
    if (currentRevision !== revision) { cache.clear(); currentRevision = revision; }
    const calls = [];
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index];
      const key = row.uniqueid;
      const signature = JSON.stringify(row);
      let entry = key && cache.get(key);
      if (!entry || entry.signature !== signature || entry.revision !== revision) {
        entry = { signature, revision, value: mapRow(row, index, config) };
        if (key) cache.set(key, entry);
        while (cache.size > limit) cache.delete(cache.keys().next().value);
      }
      calls.push({ ...entry.value, technicalLogs: [...(entry.value.technicalLogs || [])] });
      if ((index + 1) % batchSize === 0) await new Promise(resolve => setImmediate(resolve));
    }
    return calls;
  };
}

module.exports = { createCdrMapper };
