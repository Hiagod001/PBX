(function (root) {
  function clean(value = {}) {
    const sizes = [10, 20, 25, 50, 100];
    return {
      reportSize: sizes.includes(value.reportSize) ? value.reportSize : 25,
      recordingSize: sizes.includes(value.recordingSize) ? value.recordingSize : 20,
      reportFiltersOpen: value.reportFiltersOpen === true,
      recordingFiltersOpen: value.recordingFiltersOpen === true,
      compactOpen: Object.fromEntries(['presence', 'pauses', 'charts', 'calls'].map(key =>
        [key, typeof value.compactOpen?.[key] === 'boolean' ? value.compactOpen[key] : key === 'calls']))
    };
  }
  function key(user) { return `pbx-view-preferences-v1:${encodeURIComponent(user)}`; }
  function read(storage, user) {
    try { return clean(JSON.parse(storage.getItem(key(user)) || '{}') || {}); }
    catch { return clean(); }
  }
  function write(storage, user, value) {
    try {
      const serialized = JSON.stringify(clean(value));
      if (storage.getItem(key(user)) !== serialized) storage.setItem(key(user), serialized);
    } catch { /* Preferences are optional when browser storage is unavailable. */ }
  }
  const api = { clean, read, write };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PbxViewPreferences = api;
})(typeof window !== 'undefined' ? window : globalThis);
