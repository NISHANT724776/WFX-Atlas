// SQLite access (Node's built-in node:sqlite). One connection per process, migrations applied in order.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { settings } from './config.ts';
import { ensureDir, nowIso } from './util.ts';

export type Value = string | number | bigint | null | Uint8Array;
export type Row = Record<string, Value>;

let conn: DatabaseSync | null = null;
let connFile = '';

export function db(): DatabaseSync {
  const file = settings().dbFile;
  if (conn && connFile === file) return conn;
  if (conn) conn.close();
  if (file !== ':memory:') ensureDir(path.dirname(file));
  conn = new DatabaseSync(file);
  connFile = file;
  conn.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(conn);
  return conn;
}

export function closeDb(): void {
  if (conn) conn.close();
  conn = null;
  connFile = '';
}

function migrate(d: DatabaseSync): void {
  d.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  const done = new Set((d.prepare('SELECT version FROM schema_migrations').all() as Row[]).map((r) => String(r['version'])));
  const dir = settings().migrations;
  const files = fs.readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    d.exec('BEGIN');
    try {
      d.exec(sql);
      d.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(f, nowIso());
      d.exec('COMMIT');
    } catch (e) {
      d.exec('ROLLBACK');
      throw new Error(`Migration ${f} failed: ${(e as Error).message}`);
    }
  }
}

const norm = (v: unknown): Value => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : (v as Value));

export function all<T = Row>(sql: string, ...params: unknown[]): T[] {
  return db().prepare(sql).all(...params.map(norm)) as T[];
}
export function get<T = Row>(sql: string, ...params: unknown[]): T | undefined {
  return db().prepare(sql).get(...params.map(norm)) as T | undefined;
}
export function run(sql: string, ...params: unknown[]): { changes: number; lastId: number } {
  const r = db().prepare(sql).run(...params.map(norm));
  return { changes: Number(r.changes), lastId: Number(r.lastInsertRowid) };
}

/** Runs fn inside one transaction (nested calls join the outer one). */
let depth = 0;
export function tx<T>(fn: () => T): T {
  const d = db();
  if (depth > 0) return fn();
  depth++;
  d.exec('BEGIN');
  try {
    const out = fn();
    d.exec('COMMIT');
    return out;
  } catch (e) {
    d.exec('ROLLBACK');
    throw e;
  } finally {
    depth--;
  }
}

export const parseJson = <T>(v: Value | undefined, fallback: T): T => {
  if (typeof v !== 'string' || !v) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};
