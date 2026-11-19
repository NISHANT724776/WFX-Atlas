-- Knowledge enrichment: answerable knowledge units cut from the TXT entries, the questions users may ask for each,
-- the WFX terminology dictionary and the vectors used for semantic matching. All rebuildable from the TXT library
-- (npm run kb:enrich); reviewers' decisions live in knowledge/enrichment/review.json so a rebuild keeps them.
CREATE TABLE IF NOT EXISTS kn_units (
  id TEXT PRIMARY KEY,                 -- <primary entry id>#<aspect>
  module TEXT NOT NULL,
  submodule TEXT NOT NULL DEFAULT '',
  topic TEXT NOT NULL,
  aspect TEXT NOT NULL,                -- overview | steps | validations | calculation | definition
  canonical_q TEXT NOT NULL,
  answer TEXT NOT NULL,                -- verbatim text of the source fields, labelled
  entry_ids TEXT NOT NULL,             -- JSON: primary entry first, then entries that say the same thing
  screen TEXT NOT NULL DEFAULT '',
  keywords TEXT NOT NULL DEFAULT '[]',
  related_modules TEXT NOT NULL DEFAULT '[]',
  source_ref TEXT NOT NULL,            -- file, entry id and version, fields used
  source_hash TEXT NOT NULL,           -- changes when the source text changes
  entry_status TEXT NOT NULL,          -- knowledge status of the primary entry (Active, Draft …)
  confidence TEXT NOT NULL,            -- high | medium | low
  review TEXT NOT NULL DEFAULT 'generated', -- generated | approved | needs-review | insufficient
  review_note TEXT NOT NULL DEFAULT '',
  vec BLOB,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_kn_units_module ON kn_units(module);

CREATE TABLE IF NOT EXISTS kn_questions (
  id INTEGER PRIMARY KEY,
  unit_id TEXT NOT NULL,
  text TEXT NOT NULL,
  norm TEXT NOT NULL,
  category TEXT NOT NULL,              -- direct | conversational | informal | problem | process | technical | terminology | short | contextual
  origin TEXT NOT NULL,                -- canonical | template | manual
  status TEXT NOT NULL DEFAULT 'generated', -- generated | approved | rejected
  duplicate_of TEXT,                   -- unit id that owns the same wording, when overlapping
  self_rank INTEGER,                   -- where its own unit ranks when the question is asked (1 = mapped correctly)
  vec BLOB,
  UNIQUE (unit_id, norm)
);
CREATE INDEX IF NOT EXISTS idx_kn_questions_unit ON kn_questions(unit_id);

CREATE TABLE IF NOT EXISTS kn_terms (
  id INTEGER PRIMARY KEY,
  term TEXT NOT NULL,
  norm TEXT NOT NULL,
  kind TEXT NOT NULL,                  -- module | submodule | screen | transaction | abbreviation | term | field | alias | synonym
  canonical TEXT NOT NULL,             -- the concept the term names
  module TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL,
  UNIQUE (norm, kind, canonical)
);
CREATE INDEX IF NOT EXISTS idx_kn_terms_norm ON kn_terms(norm);

CREATE TABLE IF NOT EXISTS kn_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
