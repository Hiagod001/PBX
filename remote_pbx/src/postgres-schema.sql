CREATE TABLE IF NOT EXISTS pbx_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pbx_config_snapshots (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  config JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pbx_trunks (
  id TEXT PRIMARY KEY,
  main_number TEXT,
  sip_user TEXT,
  sip_password TEXT,
  sip_server TEXT,
  port INTEGER,
  transport TEXT,
  codecs JSONB NOT NULL DEFAULT '[]'::jsonb,
  simultaneous_calls INTEGER,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pbx_extensions (
  number TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  department TEXT NOT NULL DEFAULT '',
  secret TEXT NOT NULL DEFAULT '',
  voicemail BOOLEAN NOT NULL DEFAULT TRUE,
  record_calls BOOLEAN NOT NULL DEFAULT TRUE,
  permissions JSONB NOT NULL DEFAULT '[]'::jsonb,
  block_extension BOOLEAN NOT NULL DEFAULT FALSE,
  bridge_mode BOOLEAN NOT NULL DEFAULT FALSE,
  temporary BOOLEAN NOT NULL DEFAULT FALSE,
  monthly_quota_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  monthly_quota_minutes INTEGER NOT NULL DEFAULT 0,
  timeout_limit INTEGER NOT NULL DEFAULT 0,
  extension_type TEXT NOT NULL DEFAULT '',
  dial_group TEXT NOT NULL DEFAULT '',
  pickup_group TEXT NOT NULL DEFAULT '',
  cost_center TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pbx_extensions_department ON pbx_extensions (department);
CREATE INDEX IF NOT EXISTS idx_pbx_extensions_cost_center ON pbx_extensions (cost_center);

CREATE TABLE IF NOT EXISTS pbx_inbound_routes (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  did TEXT NOT NULL DEFAULT '',
  destination_type TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pbx_inbound_routes_did ON pbx_inbound_routes (did);

CREATE TABLE IF NOT EXISTS pbx_ivr_menus (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  greeting TEXT NOT NULL DEFAULT '',
  greeting_description TEXT NOT NULL DEFAULT '',
  invalid_audio TEXT NOT NULL DEFAULT '',
  timeout_audio TEXT NOT NULL DEFAULT '',
  timeout_seconds INTEGER NOT NULL DEFAULT 20,
  allow_direct_dial BOOLEAN NOT NULL DEFAULT FALSE,
  menu_repeat INTEGER NOT NULL DEFAULT 3,
  timeout_destination TEXT NOT NULL DEFAULT '',
  invalid_destination TEXT NOT NULL DEFAULT '',
  is_main BOOLEAN NOT NULL DEFAULT FALSE,
  loose_options JSONB NOT NULL DEFAULT '[]'::jsonb,
  hidden_target_cards JSONB NOT NULL DEFAULT '[]'::jsonb,
  flow_layout JSONB NOT NULL DEFAULT '{}'::jsonb,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pbx_ivr_options (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  menu_id TEXT NOT NULL REFERENCES pbx_ivr_menus(id) ON DELETE CASCADE,
  node_id TEXT NOT NULL DEFAULT '',
  digit TEXT NOT NULL DEFAULT '',
  label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  announcement TEXT NOT NULL DEFAULT '',
  destination_type TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_pbx_ivr_options_menu_digit ON pbx_ivr_options (menu_id, digit);
CREATE INDEX IF NOT EXISTS idx_pbx_ivr_options_destination ON pbx_ivr_options (destination_type, destination);

CREATE TABLE IF NOT EXISTS pbx_ring_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  strategy TEXT NOT NULL DEFAULT '',
  timeout INTEGER NOT NULL DEFAULT 0,
  fallback TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pbx_ring_group_members (
  ring_group_id TEXT NOT NULL REFERENCES pbx_ring_groups(id) ON DELETE CASCADE,
  extension_number TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ring_group_id, extension_number)
);

CREATE INDEX IF NOT EXISTS idx_pbx_ring_group_members_extension ON pbx_ring_group_members (extension_number);

CREATE TABLE IF NOT EXISTS pbx_queues (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  strategy TEXT NOT NULL DEFAULT '',
  timeout INTEGER NOT NULL DEFAULT 0,
  max_wait INTEGER NOT NULL DEFAULT 0,
  fallback TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pbx_queue_members (
  queue_id TEXT NOT NULL REFERENCES pbx_queues(id) ON DELETE CASCADE,
  extension_number TEXT NOT NULL,
  penalty INTEGER NOT NULL DEFAULT 0,
  paused BOOLEAN NOT NULL DEFAULT FALSE,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (queue_id, extension_number)
);

CREATE INDEX IF NOT EXISTS idx_pbx_queue_members_extension ON pbx_queue_members (extension_number);

CREATE TABLE IF NOT EXISTS pbx_outbound_rules (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL DEFAULT '',
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS pbx_outbound_rule_patterns (
  rule_id TEXT NOT NULL REFERENCES pbx_outbound_rules(id) ON DELETE CASCADE,
  pattern TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (rule_id, pattern)
);

CREATE TABLE IF NOT EXISTS pbx_users (
  username TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user',
  extension TEXT NOT NULL DEFAULT '',
  departments JSONB NOT NULL DEFAULT '[]'::jsonb,
  allowed_extensions JSONB NOT NULL DEFAULT '[]'::jsonb,
  permissions JSONB NOT NULL DEFAULT '{}'::jsonb,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pbx_users_role ON pbx_users (role);
CREATE INDEX IF NOT EXISTS idx_pbx_users_extension ON pbx_users (extension);

CREATE TABLE IF NOT EXISTS pbx_presence_events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  extension_number TEXT NOT NULL,
  registered BOOLEAN NOT NULL,
  event_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT NOT NULL DEFAULT 'asterisk',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_pbx_presence_extension_time ON pbx_presence_events (extension_number, event_at);

CREATE TABLE IF NOT EXISTS pbx_cdr (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  calldate TIMESTAMPTZ NOT NULL,
  start_at TIMESTAMPTZ,
  answer_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  callerid TEXT,
  src TEXT,
  dst TEXT,
  dcontext TEXT,
  channel TEXT,
  dstchannel TEXT,
  lastapp TEXT,
  lastdata TEXT,
  duration INTEGER NOT NULL DEFAULT 0,
  billsec INTEGER NOT NULL DEFAULT 0,
  disposition TEXT,
  amaflags TEXT,
  accountcode TEXT,
  uniqueid TEXT UNIQUE,
  linkedid TEXT,
  peeraccount TEXT,
  recordingfile TEXT,
  trunk TEXT,
  did TEXT,
  queue TEXT,
  direction TEXT,
  userfield TEXT,
  sequence TEXT,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pbx_cdr_calldate ON pbx_cdr (calldate);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_src ON pbx_cdr (src);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_dst ON pbx_cdr (dst);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_disposition ON pbx_cdr (disposition);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_uniqueid ON pbx_cdr (uniqueid);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_linkedid ON pbx_cdr (linkedid);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_trunk ON pbx_cdr (trunk);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_did ON pbx_cdr (did);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_queue ON pbx_cdr (queue);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_src_calldate ON pbx_cdr (src, calldate);
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_dst_calldate ON pbx_cdr (dst, calldate);

ALTER TABLE IF EXISTS pbx_cdr ADD COLUMN IF NOT EXISTS direction TEXT;
CREATE INDEX IF NOT EXISTS idx_pbx_cdr_direction ON pbx_cdr (direction);

CREATE TABLE IF NOT EXISTS pbx_recording_audit (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  call_id TEXT NOT NULL DEFAULT '',
  uniqueid TEXT NOT NULL DEFAULT '',
  src TEXT NOT NULL DEFAULT '',
  dst TEXT NOT NULL DEFAULT '',
  ip_address TEXT NOT NULL DEFAULT '',
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pbx_recording_audit_uniqueid ON pbx_recording_audit (uniqueid);
CREATE INDEX IF NOT EXISTS idx_pbx_recording_audit_user_time ON pbx_recording_audit (username, accessed_at);
CREATE INDEX IF NOT EXISTS idx_pbx_recording_audit_action_time ON pbx_recording_audit (action, accessed_at);
