(function (root) {
  // Grants for formerly administrator-only menus require an explicit choice in the new editor.
  const delegated = new Set(["extensions", "trunk", "routing", "ivr", "security", "logs", "audit", "users"]);
  const owners = {
    extensions: ["extensions", "routing"], trunk: ["trunk", "ivr"], trunks: ["trunk", "ivr"],
    inboundRoutes: ["routing", "trunk", "ivr"], outbound: ["routing", "trunk"], outboundRules: ["routing"],
    ivr: ["ivr"], security: ["security"], businessHours: ["security"], queues: ["queues"], ringGroups: ["queues"]
  };
  const policy = {
    menuKey: tab => delegated.has(tab) ? "manage-" + tab : tab,
    sectionAllowed: (key, hasMenu) => Object.hasOwn(owners, key) && owners[key].some(hasMenu)
  };
  if (typeof module !== "undefined" && module.exports) module.exports = policy;
  else root.PbxAccess = policy;
})(typeof window !== "undefined" ? window : globalThis);
