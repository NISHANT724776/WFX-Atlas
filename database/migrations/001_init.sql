-- WFX knowledge platform: initial schema (Layer C – application index).
-- Everything here can be rebuilt from knowledge/ (Layers A and B) except users, sessions, conversations and the audit log.

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'approver', 'editor', 'viewer')),
  pass_salt TEXT NOT NULL,
  pass_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip TEXT,
  user_agent TEXT
);

CREATE TABLE setup_tokens (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  detail TEXT,
  ip TEXT
);
CREATE INDEX idx_audit_at ON audit_log(at);

-- Documents (Layer A registry mirror)
CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  base_key TEXT NOT NULL,
  original_name TEXT NOT NULL,
  ext TEXT NOT NULL,
  doc_type TEXT NOT NULL,
  knowledge_status TEXT NOT NULL,
  module TEXT,
  submodule TEXT,
  current_version INTEGER NOT NULL DEFAULT 1,
  origin TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX idx_documents_base ON documents(base_key);

CREATE TABLE document_versions (
  id INTEGER PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  size INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  stored_path TEXT NOT NULL,
  extracted_path TEXT,
  status TEXT NOT NULL,
  status_note TEXT,
  stats TEXT,
  diff TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL,
  UNIQUE (document_id, version)
);
CREATE INDEX idx_docver_sha ON document_versions(sha256);

-- Layer B entries (rules, terms, procedures, transactions, …), one row per version
CREATE TABLE entries (
  uid INTEGER PRIMARY KEY,
  id TEXT NOT NULL,
  type TEXT NOT NULL,
  version INTEGER NOT NULL,
  status TEXT NOT NULL,
  title TEXT NOT NULL,
  module TEXT,
  submodule TEXT,
  txn TEXT,
  category TEXT,
  file TEXT NOT NULL,
  fields TEXT NOT NULL,
  is_current INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT,
  UNIQUE (id, version, file)
);
CREATE INDEX idx_entries_id ON entries(id);
CREATE INDEX idx_entries_type ON entries(type, is_current);

CREATE TABLE entry_changes (
  id INTEGER PRIMARY KEY,
  entry_id TEXT NOT NULL,
  from_version INTEGER,
  to_version INTEGER,
  from_status TEXT,
  to_status TEXT,
  action TEXT NOT NULL,
  reason TEXT,
  changed_by TEXT,
  changed_at TEXT NOT NULL,
  source TEXT
);
CREATE INDEX idx_entry_changes_entry ON entry_changes(entry_id);

-- Searchable chunks (entries and document sections) with full-text index
CREATE TABLE chunks (
  id INTEGER PRIMARY KEY,
  ref TEXT NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  heading TEXT NOT NULL DEFAULT '',
  text TEXT NOT NULL,
  module TEXT,
  txn TEXT,
  status TEXT NOT NULL,
  source_label TEXT NOT NULL,
  doc_id TEXT,
  doc_version INTEGER,
  entry_id TEXT,
  entry_version INTEGER,
  locator TEXT,
  is_current INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX idx_chunks_entry ON chunks(entry_id);
CREATE INDEX idx_chunks_doc ON chunks(doc_id, doc_version);

CREATE VIRTUAL TABLE chunks_fts USING fts5(title, heading, text, content = 'chunks', content_rowid = 'id', tokenize = 'porter unicode61');
CREATE TRIGGER chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts (rowid, title, heading, text) VALUES (new.id, new.title, new.heading, new.text);
END;
CREATE TRIGGER chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, title, heading, text) VALUES ('delete', old.id, old.title, old.heading, old.text);
END;
CREATE TRIGGER chunks_au AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts (chunks_fts, rowid, title, heading, text) VALUES ('delete', old.id, old.title, old.heading, old.text);
  INSERT INTO chunks_fts (rowid, title, heading, text) VALUES (new.id, new.title, new.heading, new.text);
END;
CREATE VIRTUAL TABLE chunks_vocab USING fts5vocab(chunks_fts, 'row');

-- Knowledge graph
CREATE TABLE relations (
  id INTEGER PRIMARY KEY,
  from_type TEXT NOT NULL,
  from_id TEXT NOT NULL,
  rel TEXT NOT NULL,
  to_type TEXT NOT NULL,
  to_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('confirmed', 'proposed')),
  basis TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (from_type, from_id, rel, to_type, to_id)
);
CREATE INDEX idx_relations_to ON relations(to_type, to_id);

-- Possible knowledge found by ingestion, waiting for review
CREATE TABLE candidates (
  id INTEGER PRIMARY KEY,
  doc_id TEXT NOT NULL,
  doc_version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  module TEXT,
  txn TEXT,
  locator TEXT,
  status TEXT NOT NULL DEFAULT 'new',
  entry_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_candidates_doc ON candidates(doc_id, doc_version);

-- Conversations
CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  user_id INTEGER,
  title TEXT NOT NULL,
  summary TEXT,
  context TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE messages (
  id INTEGER PRIMARY KEY,
  conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  answer TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_messages_conv ON messages(conversation_id, id);

-- Usage signals for the dashboard
CREATE TABLE topic_hits (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER,
  topic TEXT NOT NULL,
  ref TEXT
);
CREATE TABLE knowledge_gaps (
  id INTEGER PRIMARY KEY,
  at TEXT NOT NULL,
  user_id INTEGER,
  question TEXT NOT NULL,
  missing TEXT
);
