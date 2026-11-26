(function (root, factory) {
  const policy = factory();
  if (typeof module === "object" && module.exports) module.exports = policy;
  else root.PbxTrunkPolicy = policy;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  function usage(trunk) {
    return trunk?.usage || "both";
  }

  function allows(trunk, direction) {
    const value = usage(trunk);
    return value === "both" || value === direction;
  }

  function authMode(trunk) {
    return trunk?.authMode || "registration";
  }

  function outboundTrunk(config) {
    const trunks = Array.isArray(config.trunks) && config.trunks.length
      ? config.trunks : [{ ...(config.trunk || {}), id: config.trunk?.id || "trunk-operadora" }];
    const available = trunks.filter(trunk => trunk.active !== false && allows(trunk, "outbound"));
    return available.find(trunk => trunk.id === config.outbound?.defaultTrunk) || available[0] || null;
  }

  return { usage, allows, authMode, outboundTrunk };
});
