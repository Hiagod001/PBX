const fs = require('fs-extra');
const { isDeepStrictEqual } = require('node:util');
const db = require('./db');

function createDialerStore(database, readLegacy) {
  let initialization;
  let cache = null;
  let expiresAt = 0;
  let pending;
  let generation = 0;

  async function load(client) {
    const campaigns = await client.query('SELECT id, payload FROM pbx_dialer_campaigns ORDER BY position');
    const leads = await client.query('SELECT campaign_id, payload FROM pbx_dialer_leads ORDER BY campaign_id, position');
    const byId = new Map(campaigns.rows.map(row => [row.id, { ...row.payload, numbers: [] }]));
    for (const row of leads.rows) byId.get(row.campaign_id).numbers.push(row.payload);
    return [...byId.values()];
  }

  async function persist(client, campaigns, previous = []) {
    const old = new Map(previous.map(item => [item.id, item]));
    await client.query('DELETE FROM pbx_dialer_campaigns WHERE NOT (id = ANY($1::text[]))', [campaigns.map(item => item.id)]);
    for (const [position, campaign] of campaigns.entries()) {
      const { numbers = [], ...payload } = campaign;
      await client.query(`INSERT INTO pbx_dialer_campaigns (id, position, payload) VALUES ($1,$2,$3)
        ON CONFLICT (id) DO UPDATE SET position=EXCLUDED.position, payload=EXCLUDED.payload
        WHERE pbx_dialer_campaigns.position IS DISTINCT FROM EXCLUDED.position OR pbx_dialer_campaigns.payload IS DISTINCT FROM EXCLUDED.payload`,
      [campaign.id, position, JSON.stringify(payload)]);
      const previousNumbers = old.get(campaign.id)?.numbers || [];
      const changed = numbers.flatMap((lead, index) => isDeepStrictEqual(lead, previousNumbers[index]) ? [] : [{ position: index, payload: lead }]);
      if (changed.length) await client.query(`INSERT INTO pbx_dialer_leads (campaign_id, position, payload)
        SELECT $1, position, payload FROM jsonb_to_recordset($2::jsonb) AS x(position integer, payload jsonb)
        ON CONFLICT (campaign_id, position) DO UPDATE SET payload=EXCLUDED.payload`, [campaign.id, JSON.stringify(changed)]);
      if (numbers.length < previousNumbers.length) await client.query('DELETE FROM pbx_dialer_leads WHERE campaign_id=$1 AND position >= $2', [campaign.id, numbers.length]);
    }
  }

  async function initialize() {
    if (!await database.ensureDatabase()) return false;
    if (!initialization) initialization = database.transaction(async client => {
      await client.query('SELECT pg_advisory_xact_lock(704301)');
      const marker = await client.query('SELECT id FROM pbx_dialer_state WHERE id=1');
      if (!marker.rows.length) {
        const legacy = await readLegacy();
        await persist(client, legacy);
        if (!isDeepStrictEqual(await load(client), legacy)) throw new Error('Falha na verificacao da migracao de campanhas');
        await client.query('INSERT INTO pbx_dialer_state (id) VALUES (1)');
      }
      return true;
    }).catch(error => { initialization = null; throw error; });
    return initialization;
  }

  async function read() {
    if (!await initialize()) return null;
    if (cache && Date.now() < expiresAt) return structuredClone(cache);
    if (!pending) {
      const version = generation;
      pending = database.transaction(async client => {
        await client.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
        return load(client);
      }).then(value => {
        if (generation === version) { cache = value; expiresAt = Date.now() + 15000; }
        return value;
      }).finally(() => { pending = null; });
    }
    return structuredClone(await pending);
  }

  async function write(campaigns) {
    if (!await initialize()) return false;
    const previous = await read();
    await database.transaction(client => persist(client, campaigns, previous));
    generation++;
    cache = structuredClone(campaigns);
    expiresAt = Date.now() + 15000;
    return true;
  }
  return { read, write };
}

function dialerStore(file) {
  return createDialerStore(db, async () => {
    const payload = await fs.readJson(file).catch(error => {
      if (error.code === 'ENOENT') return { campaigns: [] };
      throw error;
    });
    if (!Array.isArray(payload.campaigns)) throw new Error('Arquivo de campanhas invalido');
    return payload.campaigns;
  });
}

module.exports = { dialerStore, createDialerStore };
