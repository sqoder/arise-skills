/**
 * Database schema definition and migration.
 */
import type { Database } from 'sql.js';

export const SCHEMA_VERSION = 2;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER,
  end_line INTEGER,
  language TEXT NOT NULL,
  signature TEXT,
  doc_comment TEXT,
  module TEXT,
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  file_path TEXT,
  line INTEGER
);

CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  language TEXT,
  hash TEXT,
  entity_count INTEGER,
  last_indexed INTEGER
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Dedicated table for import alias tracking (schema v2).
-- Records every imported name and the local alias it's bound to, so that
-- resolveEdges can resolve qualified calls like service.foo() where
-- service is a renamed import or a variable holding an imported class.
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_file TEXT NOT NULL,        -- file that contains the import statement
  target_file TEXT NOT NULL,        -- resolved file path (set after edge resolution)
  target_module TEXT NOT NULL,      -- raw import path (e.g., './auth', 'fs')
  imported_name TEXT,               -- name as exported by source (e.g., 'AuthService', 'default')
  local_alias TEXT NOT NULL,        -- local binding name (e.g., 'AuthService', 'service', 'auth')
  import_kind TEXT NOT NULL,        -- 'default' | 'named' | 'namespace' | 'side_effect'
  line INTEGER
);
`;

const INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_entities_file ON entities(file_path);
CREATE INDEX IF NOT EXISTS idx_entities_kind ON entities(kind);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_module ON entities(module);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_id);
CREATE INDEX IF NOT EXISTS idx_edges_kind ON edges(kind);
CREATE INDEX IF NOT EXISTS idx_imports_source ON imports(source_file);
CREATE INDEX IF NOT EXISTS idx_imports_target ON imports(target_file);
CREATE INDEX IF NOT EXISTS idx_imports_alias ON imports(local_alias);
`;

/** Initialize the database schema */
export function initSchema(db: Database): void {
  const version = getSchemaVersion(db);

  if (version < SCHEMA_VERSION) {
    db.run(SCHEMA_SQL);
    db.run(INDEXES_SQL);
    setSchemaVersion(db, SCHEMA_VERSION);
  }
}

function getSchemaVersion(db: Database): number {
  try {
    const result = db.exec("SELECT value FROM meta WHERE key = 'schema_version'");
    if (result.length > 0 && result[0].values.length > 0) {
      return parseInt(String(result[0].values[0][0]), 10);
    }
    return 0;
  } catch {
    return 0;
  }
}

function setSchemaVersion(db: Database, version: number): void {
  db.run(
    "INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)",
    [String(version)]
  );
}
