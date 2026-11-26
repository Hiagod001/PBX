const { isDeepStrictEqual } = require('node:util');

const settings = Object.freeze(['company', 'outbound', 'businessHours', 'recording', 'voicemail', 'security']);
const groupTables = Object.freeze({
  trunks: ['pbx_trunks'],
  extensions: ['pbx_extensions'],
  inboundRoutes: ['pbx_inbound_routes'],
  ivr: ['pbx_ivr_options', 'pbx_ivr_menus'],
  ringGroups: ['pbx_ring_group_members', 'pbx_ring_groups'],
  queues: ['pbx_queue_members', 'pbx_queues'],
  outboundRules: ['pbx_outbound_rule_patterns', 'pbx_outbound_rules']
});

function effectiveTrunks(config) {
  return Array.isArray(config.trunks) && config.trunks.length
    ? config.trunks
    : [{ ...(config.trunk || {}), id: 'trunk-operadora', name: 'Operadora principal' }];
}

// previous is the trusted configuration read under the server's mutation lock.
// Callers without that snapshot retain the full-save behavior used by migrations.
function configWritePlan(config, previous = null) {
  const changed = key => {
    if (!previous) return true;
    if (key === 'trunks') return !isDeepStrictEqual(effectiveTrunks(config), effectiveTrunks(previous));
    if (!isDeepStrictEqual(config[key], previous[key])) return true;
    return key === 'outboundRules' && !isDeepStrictEqual(Object.keys(config[key] || {}), Object.keys(previous[key] || {}));
  };
  const groups = new Set(Object.keys(groupTables).filter(changed));
  return {
    full: !previous,
    settings: settings.filter(changed),
    groups,
    deleteTables: [...groups].flatMap(key => groupTables[key])
  };
}

module.exports = { configWritePlan, effectiveTrunks };
