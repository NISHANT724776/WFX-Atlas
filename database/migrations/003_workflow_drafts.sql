-- Workflows generated or edited through the chat (or the designer): a persisted draft, linked to the conversation it came from.
-- A draft is NOT knowledge: it lives only here until someone saves it to the library (a Draft entry) and an approver approves it.
CREATE TABLE workflow_drafts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  conversation_id TEXT,
  title TEXT NOT NULL,
  request TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'ready' CHECK (state IN ('ready', 'failed')),
  error TEXT,
  doc TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  entry_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_wfd_user ON workflow_drafts (user_id, updated_at);
CREATE INDEX idx_wfd_conv ON workflow_drafts (conversation_id, updated_at);

CREATE TABLE workflow_draft_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id TEXT NOT NULL REFERENCES workflow_drafts (id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  doc TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (draft_id, version)
);
