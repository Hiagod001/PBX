const fs = require("fs-extra");
const path = require("path");
const { Pool } = require("pg");

const schemaPath = path.join(__dirname, "postgres-schema.sql");

let pool = null;
let ready = false;
let unavailable = false;

function isEnabled() {
  if (String(process.env.PBX_DATABASE_ENABLED || "").toLowerCase() === "false") return false;
  return Boolean(
    process.env.DATABASE_URL ||
      process.env.PBX_DATABASE_URL ||
      process.env.PG_CONNECTION_STRING ||
      process.env.PGHOST ||
      process.env.PGDATABASE
  );
}

function isRequired() {
  return String(process.env.PBX_DATABASE_REQUIRED || "").toLowerCase() === "true";
}

function connectionConfig() {
  const connectionString = process.env.PBX_DATABASE_URL || process.env.DATABASE_URL || process.env.PG_CONNECTION_STRING;
  if (connectionString) {
    return {
      connectionString,
      max: Number(process.env.PGPOOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000)
    };
  }
  return {
    host: process.env.PGHOST || "127.0.0.1",
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || "pbx",
    user: process.env.PGUSER || "pbx",
    password: process.env.PGPASSWORD || "",
    max: Number(process.env.PGPOOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS || 30000)
  };
}

async function ensureDatabase() {
  if (!isEnabled()) return false;
  if (ready) return true;
  if (unavailable && !isRequired()) return false;

  try {
    if (!pool) pool = new Pool(connectionConfig());
    await pool.query("SELECT 1");
    await pool.query(await fs.readFile(schemaPath, "utf8"));
    ready = true;
    unavailable = false;
    return true;
  } catch (error) {
    unavailable = true;
    if (isRequired()) throw error;
    console.warn(`[postgres] Banco indisponivel, usando JSON local: ${error.message}`);
    return false;
  }
}

async function query(text, params = []) {
  if (!(await ensureDatabase())) return null;
  return pool.query(text, params);
}

async function transaction(callback) {
  if (!(await ensureDatabase())) return null;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function json(value, fallback) {
  if (value === undefined || value === null) return JSON.stringify(fallback);
  return JSON.stringify(value);
}

function num(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value) {
  return Boolean(value);
}

function withoutKeys(source, keys) {
  const skip = new Set(keys);
  return JSON.stringify(Object.fromEntries(Object.entries(source || {}).filter(([key]) => !skip.has(key))));
}

async function hasStoredConfig() {
  const result = await query("SELECT EXISTS (SELECT 1 FROM pbx_settings WHERE key = 'company') AS exists");
  return Boolean(result?.rows?.[0]?.exists);
}

async function saveConfig(config) {
  await transaction(async (client) => {
    await client.query("INSERT INTO pbx_config_snapshots (config) VALUES ($1)", [JSON.stringify(config)]);
    await client.query(`
      TRUNCATE
        pbx_settings,
        pbx_trunks,
        pbx_extensions,
        pbx_inbound_routes,
        pbx_ivr_options,
        pbx_ivr_menus,
        pbx_ring_group_members,
        pbx_ring_groups,
        pbx_queue_members,
        pbx_queues,
        pbx_outbound_rule_patterns,
        pbx_outbound_rules
      RESTART IDENTITY CASCADE
    `);

    const settings = ["company", "outbound", "businessHours", "recording", "voicemail", "security"];
    for (const key of settings) {
      await client.query(
        "INSERT INTO pbx_settings (key, value, updated_at) VALUES ($1, $2, NOW())",
        [key, json(config[key], {})]
      );
    }

    const trunks = Array.isArray(config.trunks) && config.trunks.length ? config.trunks : [{ ...(config.trunk || {}), id: "trunk-operadora", name: "Operadora principal" }];
    for (const [index, trunk] of trunks.entries()) {
      await client.query(
        `INSERT INTO pbx_trunks
         (id, main_number, sip_user, sip_password, sip_server, port, transport, codecs, simultaneous_calls, extra)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          trunk.id || (index === 0 ? "trunk-operadora" : `trunk-${index + 1}`),
          trunk.mainNumber || "",
          trunk.sipUser || "",
          trunk.sipPassword || "",
          trunk.sipServer || "",
          num(trunk.port, 5060),
          trunk.transport || "udp",
          json(trunk.codecs, []),
          num(trunk.simultaneousCalls, 0),
          withoutKeys(trunk, ["id", "mainNumber", "sipUser", "sipPassword", "sipServer", "port", "transport", "codecs", "simultaneousCalls"])
        ]
      );
    }

    for (const [index, extension] of (config.extensions || []).entries()) {
      await client.query(
        `INSERT INTO pbx_extensions
         (number, name, department, secret, voicemail, record_calls, permissions, block_extension, bridge_mode, temporary,
          monthly_quota_value, monthly_quota_minutes, timeout_limit, extension_type, dial_group, pickup_group, cost_center, extra, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        [
          String(extension.number || ""),
          extension.name || "",
          extension.department || "",
          extension.secret || "",
          bool(extension.voicemail),
          bool(extension.recordCalls),
          json(extension.permissions, []),
          bool(extension.blockExtension),
          bool(extension.bridgeMode),
          bool(extension.temporary),
          num(extension.monthlyQuotaValue, 0),
          num(extension.monthlyQuotaMinutes, 0),
          num(extension.timeoutLimit, 0),
          extension.extensionType || "",
          extension.dialGroup || "",
          extension.pickupGroup || "",
          extension.costCenter || "",
          withoutKeys(extension, [
            "number", "name", "department", "secret", "voicemail", "recordCalls", "permissions", "blockExtension",
            "bridgeMode", "temporary", "monthlyQuotaValue", "monthlyQuotaMinutes", "timeoutLimit", "extensionType",
            "dialGroup", "pickupGroup", "costCenter"
          ]),
          index
        ]
      );
    }

    for (const [index, route] of (config.inboundRoutes || []).entries()) {
      await client.query(
        `INSERT INTO pbx_inbound_routes (id, name, did, destination_type, destination, extra, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          route.id || `route-${index + 1}`,
          route.name || "",
          route.did || "",
          route.destinationType || "",
          route.destination || "",
          withoutKeys(route, ["id", "name", "did", "destinationType", "destination"]),
          index
        ]
      );
    }

    const mainIvr = config.ivr || {};
    const ivrMenus = [{ ...mainIvr, id: mainIvr.id || "main", isMain: true }, ...(mainIvr.menus || []).map((menu) => ({ ...menu, isMain: false }))];
    for (const [menuIndex, menu] of ivrMenus.entries()) {
      await client.query(
        `INSERT INTO pbx_ivr_menus
         (id, name, greeting, greeting_description, invalid_audio, timeout_audio, timeout_seconds, allow_direct_dial,
          menu_repeat, timeout_destination, invalid_destination, is_main, loose_options, hidden_target_cards, flow_layout, extra, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [
          menu.id || `menu-${menuIndex + 1}`,
          menu.name || "",
          menu.greeting || "",
          menu.greetingDescription || "",
          menu.invalidAudio || "",
          menu.timeoutAudio || "",
          num(menu.timeoutSeconds, 20),
          bool(menu.allowDirectDial),
          num(menu.menuRepeat, 3),
          menu.timeoutDestination || "",
          menu.invalidDestination || "",
          bool(menu.isMain),
          json(menu.looseOptions, []),
          json(menu.hiddenTargetCards, []),
          json(menu.flowLayout, {}),
          withoutKeys(menu, [
            "id", "name", "greeting", "greetingDescription", "invalidAudio", "timeoutAudio", "timeoutSeconds",
            "allowDirectDial", "menuRepeat", "timeoutDestination", "invalidDestination", "isMain", "looseOptions",
            "hiddenTargetCards", "flowLayout", "menus", "options"
          ]),
          menuIndex
        ]
      );

      for (const [optionIndex, option] of (menu.options || []).entries()) {
        await client.query(
          `INSERT INTO pbx_ivr_options
           (menu_id, node_id, digit, label, description, announcement, destination_type, destination, extra, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            menu.id || `menu-${menuIndex + 1}`,
            option.nodeId || "",
            option.digit || "",
            option.label || "",
            option.description || "",
            option.announcement || "",
            option.destinationType || "",
            option.destination || "",
            withoutKeys(option, ["nodeId", "digit", "label", "description", "announcement", "destinationType", "destination"]),
            optionIndex
          ]
        );
      }
    }

    for (const [index, group] of (config.ringGroups || []).entries()) {
      await client.query(
        `INSERT INTO pbx_ring_groups (id, name, strategy, timeout, fallback, extra, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [group.id || `ring-${index + 1}`, group.name || "", group.strategy || "", num(group.timeout, 0), group.fallback || "", withoutKeys(group, ["id", "name", "strategy", "timeout", "fallback", "members"]), index]
      );
      for (const [memberIndex, member] of (group.members || []).entries()) {
        await client.query(
          "INSERT INTO pbx_ring_group_members (ring_group_id, extension_number, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [group.id || `ring-${index + 1}`, String(member), memberIndex]
        );
      }
    }

    for (const [index, queue] of (config.queues || []).entries()) {
      await client.query(
        `INSERT INTO pbx_queues (id, name, strategy, timeout, max_wait, fallback, extra, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [queue.id || `queue-${index + 1}`, queue.name || "", queue.strategy || "", num(queue.timeout, 0), num(queue.maxWait, 0), queue.fallback || "", withoutKeys(queue, ["id", "name", "strategy", "timeout", "maxWait", "fallback", "members"]), index]
      );
      for (const [memberIndex, member] of (queue.members || []).entries()) {
        const memberNumber = typeof member === "object" ? member.number || member.extension || member.extensionNumber : member;
        await client.query(
          `INSERT INTO pbx_queue_members (queue_id, extension_number, penalty, paused, extra, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
          [
            queue.id || `queue-${index + 1}`,
            String(memberNumber || ""),
            num(member.penalty, 0),
            bool(member.paused),
            typeof member === "object" ? withoutKeys(member, ["number", "extension", "extensionNumber", "penalty", "paused"]) : {},
            memberIndex
          ]
        );
      }
    }

    for (const [index, [ruleId, rule]] of Object.entries(config.outboundRules || {}).entries()) {
      await client.query(
        "INSERT INTO pbx_outbound_rules (id, label, extra, sort_order) VALUES ($1,$2,$3,$4)",
        [ruleId, rule.label || "", withoutKeys(rule, ["label", "patterns"]), index]
      );
      for (const [patternIndex, pattern] of (rule.patterns || []).entries()) {
        await client.query(
          "INSERT INTO pbx_outbound_rule_patterns (rule_id, pattern, sort_order) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [ruleId, pattern, patternIndex]
        );
      }
    }
  });
}

async function getConfig() {
  if (!(await hasStoredConfig())) return null;

  const [
    settings,
    trunks,
    extensions,
    inboundRoutes,
    ivrMenus,
    ivrOptions,
    ringGroups,
    ringMembers,
    queues,
    queueMembers,
    outboundRules,
    outboundPatterns
  ] = await Promise.all([
    query("SELECT key, value FROM pbx_settings"),
    query("SELECT * FROM pbx_trunks ORDER BY id"),
    query("SELECT * FROM pbx_extensions ORDER BY sort_order, number"),
    query("SELECT * FROM pbx_inbound_routes ORDER BY sort_order, id"),
    query("SELECT * FROM pbx_ivr_menus ORDER BY is_main DESC, sort_order, id"),
    query("SELECT * FROM pbx_ivr_options ORDER BY menu_id, sort_order, id"),
    query("SELECT * FROM pbx_ring_groups ORDER BY sort_order, id"),
    query("SELECT * FROM pbx_ring_group_members ORDER BY ring_group_id, sort_order, extension_number"),
    query("SELECT * FROM pbx_queues ORDER BY sort_order, id"),
    query("SELECT * FROM pbx_queue_members ORDER BY queue_id, sort_order, extension_number"),
    query("SELECT * FROM pbx_outbound_rules ORDER BY sort_order, id"),
    query("SELECT * FROM pbx_outbound_rule_patterns ORDER BY rule_id, sort_order, pattern")
  ]);

  const settingMap = Object.fromEntries((settings?.rows || []).map((row) => [row.key, row.value || {}]));
  const trunkRows = trunks?.rows || [];
  const outboundSetting = settingMap.outbound || {};
  const configTrunks = trunkRows.map((row, index) => ({
    ...(row.extra || {}),
    id: row.id === "main" ? "trunk-operadora" : row.id || (index === 0 ? "trunk-operadora" : `trunk-${index + 1}`),
    mainNumber: row.main_number || "",
    sipUser: row.sip_user || "",
    sipPassword: row.sip_password || "",
    sipServer: row.sip_server || "",
    port: row.port || 5060,
    transport: row.transport || "udp",
    codecs: row.codecs || [],
    simultaneousCalls: row.simultaneous_calls || 0
  }));
  const trunk = configTrunks.find((item) => item.id === outboundSetting.defaultTrunk) || configTrunks[0] || {};
  const mainIvr = (ivrMenus?.rows || []).find((row) => row.is_main) || {};
  const menuOptions = new Map();
  (ivrOptions?.rows || []).forEach((row) => {
    const options = menuOptions.get(row.menu_id) || [];
    options.push({
      ...(row.extra || {}),
      nodeId: row.node_id || "",
      digit: row.digit || "",
      label: row.label || "",
      description: row.description || "",
      announcement: row.announcement || "",
      destinationType: row.destination_type || "",
      destination: row.destination || ""
    });
    menuOptions.set(row.menu_id, options);
  });

  const membersByRingGroup = new Map();
  (ringMembers?.rows || []).forEach((row) => {
    const members = membersByRingGroup.get(row.ring_group_id) || [];
    members.push(row.extension_number);
    membersByRingGroup.set(row.ring_group_id, members);
  });

  const membersByQueue = new Map();
  (queueMembers?.rows || []).forEach((row) => {
    const members = membersByQueue.get(row.queue_id) || [];
    members.push(row.extension_number);
    membersByQueue.set(row.queue_id, members);
  });

  const patternsByRule = new Map();
  (outboundPatterns?.rows || []).forEach((row) => {
    const patterns = patternsByRule.get(row.rule_id) || [];
    patterns.push(row.pattern);
    patternsByRule.set(row.rule_id, patterns);
  });

  return {
    company: settingMap.company || {},
    trunk,
    trunks: configTrunks,
    extensions: (extensions?.rows || []).map((row) => ({
      ...(row.extra || {}),
      number: row.number,
      name: row.name || "",
      department: row.department || "",
      secret: row.secret || "",
      voicemail: row.voicemail,
      recordCalls: row.record_calls,
      permissions: row.permissions || [],
      blockExtension: row.block_extension,
      bridgeMode: row.bridge_mode,
      temporary: row.temporary,
      monthlyQuotaValue: Number(row.monthly_quota_value) || 0,
      monthlyQuotaMinutes: row.monthly_quota_minutes || 0,
      timeoutLimit: row.timeout_limit || 0,
      extensionType: row.extension_type || "",
      dialGroup: row.dial_group || "",
      pickupGroup: row.pickup_group || "",
      costCenter: row.cost_center || ""
    })),
    inboundRoutes: (inboundRoutes?.rows || []).map((row) => ({
      ...(row.extra || {}),
      id: row.id,
      name: row.name || "",
      did: row.did || "",
      destinationType: row.destination_type || "",
      destination: row.destination || ""
    })),
    ivr: {
      ...(mainIvr.extra || {}),
      id: mainIvr.id || "main",
      name: mainIvr.name || "",
      greeting: mainIvr.greeting || "",
      greetingDescription: mainIvr.greeting_description || "",
      invalidAudio: mainIvr.invalid_audio || "",
      timeoutAudio: mainIvr.timeout_audio || "",
      timeoutSeconds: mainIvr.timeout_seconds || 20,
      allowDirectDial: mainIvr.allow_direct_dial || false,
      menuRepeat: mainIvr.menu_repeat || 3,
      timeoutDestination: mainIvr.timeout_destination || "",
      invalidDestination: mainIvr.invalid_destination || "",
      looseOptions: mainIvr.loose_options || [],
      hiddenTargetCards: mainIvr.hidden_target_cards || [],
      flowLayout: mainIvr.flow_layout || {},
      options: menuOptions.get(mainIvr.id) || [],
      menus: (ivrMenus?.rows || [])
        .filter((row) => !row.is_main)
        .map((row) => ({
          ...(row.extra || {}),
          id: row.id,
          name: row.name || "",
          greeting: row.greeting || "",
          greetingDescription: row.greeting_description || "",
          invalidAudio: row.invalid_audio || "",
          timeoutAudio: row.timeout_audio || "",
          timeoutSeconds: row.timeout_seconds || 20,
          allowDirectDial: row.allow_direct_dial || false,
          menuRepeat: row.menu_repeat || 3,
          timeoutDestination: row.timeout_destination || "",
          invalidDestination: row.invalid_destination || "",
          looseOptions: row.loose_options || [],
          hiddenTargetCards: row.hidden_target_cards || [],
          flowLayout: row.flow_layout || {},
          options: menuOptions.get(row.id) || []
        }))
    },
    ringGroups: (ringGroups?.rows || []).map((row) => ({
      ...(row.extra || {}),
      id: row.id,
      name: row.name || "",
      strategy: row.strategy || "",
      members: membersByRingGroup.get(row.id) || [],
      timeout: row.timeout || 0,
      fallback: row.fallback || ""
    })),
    queues: (queues?.rows || []).map((row) => ({
      ...(row.extra || {}),
      id: row.id,
      name: row.name || "",
      strategy: row.strategy || "",
      members: membersByQueue.get(row.id) || [],
      timeout: row.timeout || 0,
      maxWait: row.max_wait || 0,
      fallback: row.fallback || ""
    })),
    outboundRules: Object.fromEntries((outboundRules?.rows || []).map((row) => [
      row.id,
      {
        ...(row.extra || {}),
        label: row.label || "",
        patterns: patternsByRule.get(row.id) || []
      }
    ])),
    outbound: outboundSetting,
    businessHours: settingMap.businessHours || {},
    recording: settingMap.recording || {},
    voicemail: settingMap.voicemail || {},
    security: settingMap.security || {}
  };
}

async function saveUsers(users) {
  await transaction(async (client) => {
    await client.query("TRUNCATE pbx_users");
    for (const user of users.users || []) {
      await client.query(
        `INSERT INTO pbx_users
         (username, password_hash, role, extension, departments, allowed_extensions, permissions, must_change_password, extra, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::timestamptz, NOW()),COALESCE($11::timestamptz, NOW()))`,
        [
          user.username,
          user.passwordHash,
          user.role || (user.username === "admin" ? "admin" : "user"),
          user.extension || "",
          json(user.departments, []),
          json(user.allowedExtensions, []),
          json(user.permissions, {}),
          bool(user.mustChangePassword),
          withoutKeys(user, ["username", "passwordHash", "role", "extension", "departments", "allowedExtensions", "permissions", "mustChangePassword", "createdAt", "updatedAt"]),
          user.createdAt || null,
          user.updatedAt || null
        ]
      );
    }
  });
}

async function getUsers() {
  const result = await query("SELECT * FROM pbx_users ORDER BY username");
  if (!result || !result.rows.length) return null;
  return {
    users: result.rows.map((row) => ({
      ...(row.extra || {}),
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role || (row.username === "admin" ? "admin" : "user"),
      extension: row.extension || "",
      departments: row.departments || [],
      allowedExtensions: row.allowed_extensions || [],
      permissions: row.permissions || {},
      mustChangePassword: row.must_change_password,
      createdAt: row.created_at?.toISOString?.() || row.created_at,
      updatedAt: row.updated_at?.toISOString?.() || row.updated_at
    }))
  };
}

async function appendPresenceEvents(events = []) {
  const cleanEvents = events.filter(Boolean);
  if (!cleanEvents.length || !(await ensureDatabase())) return false;
  await transaction(async (client) => {
    for (const event of cleanEvents) {
      await client.query(
        "INSERT INTO pbx_presence_events (extension_number, registered, event_at, payload) VALUES ($1,$2,$3,$4)",
        [String(event.extension || ""), bool(event.registered), event.at || new Date().toISOString(), JSON.stringify(event)]
      );
    }
  });
  return true;
}

async function readPresenceHistory() {
  const result = await query(
    "SELECT extension_number, registered, event_at FROM pbx_presence_events ORDER BY event_at DESC LIMIT 100000"
  );
  if (!result) return null;
  return {
    events: result.rows.reverse().map((row) => ({
      extension: row.extension_number,
      registered: row.registered,
      at: row.event_at?.toISOString?.() || row.event_at
    }))
  };
}

async function writeRecordingAuditEvent(event) {
  if (!(await ensureDatabase())) return false;
  await query(
    `INSERT INTO pbx_recording_audit
     (username, role, action, call_id, uniqueid, src, dst, ip_address, payload, accessed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())`,
    [
      event.user || "",
      event.role || "",
      event.action || "",
      event.callId || "",
      event.uniqueId || "",
      event.source || "",
      event.destination || "",
      event.ip || "",
      JSON.stringify(event)
    ]
  );
  return true;
}

async function readRecordingAuditEvents(limit = 500) {
  const result = await query(
    "SELECT username, role, action, call_id, uniqueid, src, dst, ip_address, payload, accessed_at FROM pbx_recording_audit ORDER BY accessed_at DESC LIMIT $1",
    [Number(limit) || 500]
  );
  if (!result) return null;
  return result.rows.map((row) => ({
    ...(row.payload || {}),
    user: row.username,
    role: row.role,
    action: row.action,
    callId: row.call_id,
    uniqueId: row.uniqueid,
    source: row.src,
    destination: row.dst,
    ip: row.ip_address,
    accessedAt: row.accessed_at?.toISOString?.() || row.accessed_at
  }));
}

async function getCdrRows() {
  const result = await query("SELECT * FROM pbx_cdr ORDER BY calldate DESC LIMIT $1", [Number(process.env.PBX_CDR_DB_LIMIT || 50000)]);
  return result?.rows || [];
}

module.exports = {
  ensureDatabase,
  isEnabled,
  query,
  saveConfig,
  getConfig,
  saveUsers,
  getUsers,
  appendPresenceEvents,
  readPresenceHistory,
  writeRecordingAuditEvent,
  readRecordingAuditEvents,
  getCdrRows
};
