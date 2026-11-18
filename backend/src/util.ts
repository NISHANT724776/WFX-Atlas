// Small shared helpers: time, ids, hashing, safe file writes, JSON files, logging.
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const nowIso = () => new Date().toISOString();
export const today = () => nowIso().slice(0, 10);

export const sha256 = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/** Upper-case identifier part: "so-approval-limit" → "SO-APPROVAL-LIMIT". */
export const idPart = (s: string) =>
  s.normalize('NFKD').replace(/[^\w\s-]/g, ' ').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-').toUpperCase().slice(0, 60).replace(/-$/, '');

/** File-name safe slug: keeps letters, digits, dot, dash and underscore. */
export const safeName = (s: string) => {
  const cleaned = s.normalize('NFKD').replace(/[^\w.\- ()]+/g, '_').replace(/\s+/g, ' ').trim();
  return (cleaned || 'file').slice(0, 150);
};

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

/** Writes a file atomically (temp file + rename), so a crash never leaves half a TXT file. */
export function atomicWrite(file: string, data: string | Uint8Array): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(file: string, value: unknown): void {
  atomicWrite(file, `${JSON.stringify(value, null, 2)}\n`);
}

/** Resolves `rel` inside `base`; throws when the result would leave `base` (path traversal guard). */
export function inside(base: string, rel: string): string {
  const full = path.resolve(base, rel);
  const b = path.resolve(base);
  if (full !== b && !full.startsWith(b + path.sep)) throw new Error('Path outside the allowed folder.');
  return full;
}

export const toPosix = (p: string) => p.split(path.sep).join('/');

type Level = 'info' | 'warn' | 'error';
export function log(level: Level, message: string, detail?: Record<string, unknown>): void {
  if (process.env['WFX_QUIET'] === '1' && level === 'info') return;
  const line = JSON.stringify({ at: nowIso(), level, message, ...(detail ?? {}) });
  if (level === 'error') console.error(line);
  else console.log(line);
}

export const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

export function chunkArray<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}
