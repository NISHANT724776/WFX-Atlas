-- Word vocabulary (unstemmed) for spelling correction and term rarity; documented abbreviations; platform settings.
CREATE TABLE vocab (
  word TEXT PRIMARY KEY,
  df INTEGER NOT NULL
);

CREATE TABLE abbreviations (
  abbr TEXT NOT NULL,
  expansion TEXT NOT NULL,
  source TEXT,
  PRIMARY KEY (abbr, expansion)
);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT
);
