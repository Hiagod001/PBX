-- Compatibilidade: o schema completo do PostgreSQL fica em:
-- ../src/postgres-schema.sql
--
-- Este arquivo mantem a referencia minima para ambientes que ja gravavam CDR
-- diretamente em banco antes da implementacao completa.

CREATE TABLE IF NOT EXISTS pbx_cdr (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  calldate TIMESTAMP NOT NULL,
  src VARCHAR(80),
  dst VARCHAR(80),
  dcontext VARCHAR(120),
  channel VARCHAR(160),
  dstchannel VARCHAR(160),
  lastapp VARCHAR(80),
  lastdata TEXT,
  duration INTEGER DEFAULT 0,
  billsec INTEGER DEFAULT 0,
  disposition VARCHAR(40),
  amaflags VARCHAR(40),
  accountcode VARCHAR(80),
  uniqueid VARCHAR(80) UNIQUE,
  linkedid VARCHAR(80),
  peeraccount VARCHAR(80),
  recordingfile VARCHAR(255),
  trunk VARCHAR(120),
  did VARCHAR(80),
  queue VARCHAR(120),
  userfield TEXT
);

CREATE INDEX IF NOT EXISTS idx_pbx_cdr_calldate ON pbx_cdr (calldate);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_src ON pbx_cdr (src);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_dst ON pbx_cdr (dst);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_disposition ON pbx_cdr (disposition);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_uniqueid ON pbx_cdr (uniqueid);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_trunk ON pbx_cdr (trunk);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_did ON pbx_cdr (did);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_queue ON pbx_cdr (queue);

CREATE TABLE IF NOT EXISTS pbx_recording_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username VARCHAR(120) NOT NULL,
  role VARCHAR(40),
  action VARCHAR(20) NOT NULL,
  uniqueid VARCHAR(80) NOT NULL,
  src VARCHAR(80),
  dst VARCHAR(80),
  ip_address VARCHAR(80),
  accessed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pbx_recording_audit_uniqueid ON pbx_recording_audit (uniqueid);
CREATE INDEX IF NOT EXISTS idx_pbx_recording_audit_user_time ON pbx_recording_audit (username, accessed_at);
