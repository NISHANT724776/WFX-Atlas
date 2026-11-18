-- Screen & workflow registry, visual guides (index of knowledge/registry/*.txt; rebuilt from the files) and message metadata.
CREATE TABLE IF NOT EXISTS reg_screens (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  module TEXT NOT NULL DEFAULT '',
  route TEXT NOT NULL DEFAULT '',
  query TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  required_role TEXT NOT NULL DEFAULT 'viewer',
  keywords TEXT NOT NULL DEFAULT '',
  fields TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reg_screens_module ON reg_screens(module);
CREATE TABLE IF NOT EXISTS reg_guides (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  kind TEXT NOT NULL,
  module TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '',
  screen_id TEXT,
  workflow_id TEXT,
  file TEXT NOT NULL,
  data TEXT NOT NULL
);
ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE messages ADD COLUMN token_usage INTEGER;
