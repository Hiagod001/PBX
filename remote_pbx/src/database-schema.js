const { createHash } = require("node:crypto");

async function ensureSchema(pool, sql) {
  const fingerprint = createHash("sha256").update(sql).digest("hex");
  const exists = await pool.query("SELECT to_regclass('pbx_schema_version') IS NOT NULL AS exists");
  if (exists.rows[0]?.exists) {
    const current = await pool.query("SELECT fingerprint FROM pbx_schema_version WHERE id=1");
    if (current.rows[0]?.fingerprint === fingerprint) return false;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(786482104)");
    await client.query("CREATE TABLE IF NOT EXISTS pbx_schema_version (id SMALLINT PRIMARY KEY CHECK (id=1), fingerprint TEXT NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
    const current = await client.query("SELECT fingerprint FROM pbx_schema_version WHERE id=1");
    const changed = current.rows[0]?.fingerprint !== fingerprint;
    if (changed) {
      await client.query(sql);
      await client.query("INSERT INTO pbx_schema_version (id,fingerprint) VALUES (1,$1) ON CONFLICT (id) DO UPDATE SET fingerprint=EXCLUDED.fingerprint,applied_at=NOW()", [fingerprint]);
    }
    await client.query("COMMIT");
    return changed;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { ensureSchema };
