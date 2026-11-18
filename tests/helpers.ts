// Test sandbox: a temporary copy of the knowledge folder (without the original documents) and a temporary database.
// Must be called before the first database access in a test file (each test file runs in its own process).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

function copyDir(src: string, dst: string, keep: (rel: string) => boolean, base = src): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const d of fs.readdirSync(src, { withFileTypes: true })) {
    const from = path.join(src, d.name);
    const rel = path.relative(base, from).split(path.sep).join('/');
    if (!keep(rel)) continue;
    const to = path.join(dst, d.name);
    if (d.isDirectory()) copyDir(from, to, keep, base);
    else fs.copyFileSync(from, to);
  }
}

export function sandbox(kind: 'copy' | 'empty' = 'copy'): { dir: string; knowledge: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wfx-test-'));
  const knowledge = path.join(dir, 'knowledge');
  if (kind === 'copy') copyDir(path.join(ROOT, 'knowledge'), knowledge, (rel) => !rel.startsWith('original_sources') && !rel.startsWith('history') && rel !== 'review/pending.txt');
  else fs.mkdirSync(knowledge, { recursive: true });
  process.env['WFX_KNOWLEDGE_DIR'] = knowledge;
  process.env['WFX_DB_FILE'] = path.join(dir, 'test.db');
  process.env['WFX_QUIET'] = '1';
  return { dir, knowledge };
}

export function readCsv(rel: string): Record<string, string>[] {
  const text = fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); cell = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
