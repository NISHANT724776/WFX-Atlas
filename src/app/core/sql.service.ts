import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import type { Database } from 'sql.js';

export interface TableInfo {
  module: string;
  table: string;
  file: string;
  document?: string;
  grid?: string;
  description: string;
  columns: { name: string; type: 'TEXT' | 'REAL' }[];
  rows: number;
}
export interface TextFile { module: string; file: string; description: string; }
export interface Manifest { generated: string; tables: TableInfo[]; texts?: TextFile[]; }
export interface SqlResult { columns: string[]; rows: (string | number | null)[][]; ms: number; }

/** Parses one CSV file (RFC 4180 quoting, optional BOM). */
function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cur = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === '"') { if (s[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cur); cur = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cur); cur = '';
      if (row.length > 1 || row[0] !== '') out.push(row);
      row = [];
    } else cur += ch;
  }
  if (cur !== '' || row.length) { row.push(cur); out.push(row); }
  return out;
}

/**
 * Loads every CSV in /data (listed in manifest.json) into an in-browser SQLite database (sql.js)
 * so pages can read the knowledge base with plain SQL. Nothing leaves the browser.
 */
@Injectable({ providedIn: 'root' })
export class SqlService {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private dbPromise: Promise<{ db: Database; manifest: Manifest }> | null = null;

  /** Resolves once all tables are loaded. Never called during prerender. */
  ready(): Promise<{ db: Database; manifest: Manifest }> {
    if (!this.browser) return Promise.reject(new Error('SQL runs in the browser only'));
    this.dbPromise ??= this.load();
    return this.dbPromise;
  }

  async manifest(): Promise<Manifest> {
    return (await this.ready()).manifest;
  }

  async query(sql: string): Promise<SqlResult> {
    const { db } = await this.ready();
    const t0 = performance.now();
    const res = db.exec(sql);
    const last = res[res.length - 1];
    return {
      columns: last?.columns ?? [],
      rows: (last?.values ?? []).map((r) => r.map((v) => (v instanceof Uint8Array ? '[blob]' : v))),
      ms: Math.round(performance.now() - t0),
    };
  }

  private async load() {
    const [{ default: initSqlJs }, manifest] = await Promise.all([
      import('sql.js'),
      fetch('/data/manifest.json').then((r) => r.json() as Promise<Manifest>),
    ]);
    const SQL = await initSqlJs({ locateFile: () => '/sql-wasm.wasm' });
    const db = new SQL.Database();
    const files = await Promise.all(manifest.tables.map((t) => fetch(`/data/${t.file}`).then((r) => r.text())));
    manifest.tables.forEach((t, i) => {
      const [header, ...rows] = parseCsv(files[i]);
      const cols = header.map((h, j) => `"${h}${header.indexOf(h) !== j ? '_' + j : ''}" ${t.columns[j]?.type ?? 'TEXT'}`);
      db.run(`CREATE TABLE "${t.table}" (${cols.join(', ')})`);
      const ins = `INSERT INTO "${t.table}" VALUES (${header.map(() => '?').join(', ')})`;
      for (const r of rows) {
        db.run(ins, r.map((v, j) => (t.columns[j]?.type === 'REAL' && v !== '' ? Number(v) : v === '' ? null : v)));
      }
    });
    return { db, manifest };
  }
}
