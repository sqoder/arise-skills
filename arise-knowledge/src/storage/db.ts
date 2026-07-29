/**
 * SQLite database connection using sql.js (pure WASM, no native deps).
 * Provides singleton management, concurrency protection, and transaction support.
 *
 * Multi-process safety: sql.js loads the DB into memory, so multiple MCP
 * server processes (e.g., two IDE windows) each have their own in-memory copy.
 * Writes are persisted via `saveDatabase()`, but the last writer wins —
 * concurrent processes can silently overwrite each other's changes.
 *
 * To mitigate this, we use an advisory lockfile (`graph.db.lock`) with the
 * process PID. Before any write operation (index_project, etc.), acquireLock()
 * checks the lockfile; if it belongs to another live process, we wait.
 * This is cooperative locking — it only works if all clients use this module.
 */
import initSqlJs, { type Database } from 'sql.js';
import path from 'path';
import fs from 'fs';
import { initSchema, SCHEMA_VERSION } from './schema.js';

let db: Database | null = null;
let currentDbPath: string | null = null;
let currentLockPath: string | null = null;
let operationLock: Promise<void> = Promise.resolve();

/** Check if a process with the given PID is currently running */
function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0); // signal 0 = check existence
    return true;
  } catch {
    return false;
  }
}

/** Sleep for the given ms (async, non-blocking) */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wait for a lock file to become available or be owned by a dead process */
async function waitForLockFile(lockPath: string, maxWaitMs = 10000): Promise<void> {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    if (!fs.existsSync(lockPath)) return;
    try {
      const lockPid = parseInt(fs.readFileSync(lockPath, 'utf-8').trim(), 10);
      if (!isProcessAlive(lockPid)) {
        // Stale lock — the owning process crashed. Take it over.
        fs.writeFileSync(lockPath, String(process.pid));
        return;
      }
    } catch {
      // Lock file is malformed or unreadable — treat as available
      try { fs.unlinkSync(lockPath); } catch { /* ignore */ }
      return;
    }
    // Still locked by a live process — wait asynchronously and retry
    const remaining = maxWaitMs - (Date.now() - startTime);
    if (remaining <= 0) break;
    await sleep(Math.min(200, remaining));
  }
  // Timeout — proceed anyway to avoid blocking forever, but warn
  console.warn(`[arise-knowledge] Lock wait timed out after ${maxWaitMs}ms; proceeding without lock. Data may be corrupted if another process is writing.`);
}

/** Acquire a cross-process file lock for the current DB path */
async function acquireFileLock(dbPath: string): Promise<string> {
  const lockPath = `${dbPath}.lock`;
  await waitForLockFile(lockPath);
  fs.writeFileSync(lockPath, String(process.pid));
  return lockPath;
}

/** Release the cross-process file lock */
function releaseFileLock(lockPath: string | null): void {
  if (!lockPath) return;
  try {
    // Only delete if it's our lock
    const lockPid = parseInt(fs.readFileSync(lockPath, 'utf-8').trim(), 10);
    if (lockPid === process.pid) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Lock file already gone — ignore
  }
}

/**
 * Acquire a serialized lock to prevent concurrent DB operations.
 * Combines an in-process Promise lock with a cross-process file lock.
 * Returns a release function that must be called when done.
 */
export function acquireLock(): Promise<() => void> {
  let release: () => void;
  const prev = operationLock;
  operationLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  return prev.then(async () => {
    // Acquire cross-process file lock if we have a DB path
    if (currentDbPath) {
      currentLockPath = await acquireFileLock(currentDbPath);
    }
    return () => {
      releaseFileLock(currentLockPath);
      currentLockPath = null;
      release!();
    };
  });
}

/** Read schema_version from an existing db (returns 0 if not initialized) */
function readDbSchemaVersion(database: Database): number {
  try {
    // Check if meta table exists first (old DBs may not have it)
    const tables = database.exec(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='meta'"
    );
    if (tables.length === 0) return 0;
    const result = database.exec("SELECT value FROM meta WHERE key = 'schema_version'");
    if (result.length > 0 && result[0].values.length > 0) {
      return parseInt(String(result[0].values[0][0]), 10);
    }
    return 0;
  } catch {
    return 0;
  }
}

/** Get or create the database instance for a project */
export async function getDatabase(projectPath: string): Promise<Database> {
  const dbDir = path.join(projectPath, '.arise', 'knowledge');
  if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
  }

  const dbPath = path.join(dbDir, 'graph.db');

  if (db && currentDbPath === dbPath) {
    return db;
  }

  if (db) {
    saveDatabase(db, currentDbPath!);
    db.close();
  }

  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);

    // Schema migration: if existing DB has an older schema_version, the old
    // schema's constraints (e.g., FOREIGN KEY declarations that have since been
    // removed) would still be active and cause "FOREIGN KEY constraint failed"
    // errors. Back up the old DB and start fresh — re-indexing will rebuild it.
    const existingVersion = readDbSchemaVersion(db);
    if (existingVersion < SCHEMA_VERSION) {
      const backupPath = `${dbPath}.v${existingVersion}.bak`;
      try {
        fs.renameSync(dbPath, backupPath);
      } catch {
        fs.copyFileSync(dbPath, backupPath);
        fs.unlinkSync(dbPath);
      }
      db.close();
      db = new SQL.Database();
      console.warn(
        `[arise-knowledge] DB schema v${existingVersion} → v${SCHEMA_VERSION}; ` +
        `old DB backed up to ${path.basename(backupPath)}. Re-indexing required.`
      );
    }
  } else {
    db = new SQL.Database();
  }

  currentDbPath = dbPath;
  // Note: WAL mode is not meaningful for sql.js (in-memory), skipped.
  db.run('PRAGMA foreign_keys = ON');

  initSchema(db);

  return db;
}

/** Run a function within a SQLite transaction (BEGIN/COMMIT/ROLLBACK) */
export function withTransaction<T>(database: Database, fn: () => T): T {
  database.run('BEGIN TRANSACTION');
  try {
    const result = fn();
    database.run('COMMIT');
    return result;
  } catch (err) {
    database.run('ROLLBACK');
    throw err;
  }
}

/** Save database to disk */
export function saveDatabase(database?: Database, dbPath?: string): void {
  const d = database ?? db;
  const p = dbPath ?? currentDbPath;
  if (d && p) {
    const data = d.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(p, buffer);
  }
}

/** Close and save the current database */
export function closeDatabase(): void {
  if (db && currentDbPath) {
    saveDatabase(db, currentDbPath);
    db.close();
    db = null;
    currentDbPath = null;
  }
}

export type { Database };
