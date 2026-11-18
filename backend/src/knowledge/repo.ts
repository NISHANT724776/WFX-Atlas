// Read access to the index: entries, versions, relationships, documents. Used by the assistant, the API and the UI.
import { all, get, parseJson } from '../db.ts';

export interface EntryRow {
  id: string; type: string; version: number; status: string; title: string; module: string | null; submodule: string | null;
  txn: string | null; category: string | null; file: string; isCurrent: boolean; updatedAt: string | null;
  order: string[]; fields: Record<string, string>;
}

const toEntry = (r: Record<string, unknown>): EntryRow => {
  const f = parseJson<{ order: string[]; fields: Record<string, string> }>(r['fields'] as string, { order: [], fields: {} });
  return {
    id: String(r['id']), type: String(r['type']), version: Number(r['version']), status: String(r['status']), title: String(r['title']),
    module: (r['module'] as string) ?? null, submodule: (r['submodule'] as string) ?? null, txn: (r['txn'] as string) ?? null,
    category: (r['category'] as string) ?? null, file: String(r['file']), isCurrent: Number(r['is_current']) === 1,
    updatedAt: (r['updated_at'] as string) ?? null, order: f.order, fields: f.fields,
  };
};

/** The current version of an entry (or a given version). */
export function getEntry(id: string, version?: number): EntryRow | undefined {
  const r = version
    ? get<Record<string, unknown>>("SELECT * FROM entries WHERE id = ? AND version = ? ORDER BY CASE WHEN file LIKE 'history/%' THEN 1 ELSE 0 END LIMIT 1", id, version)
    : get<Record<string, unknown>>('SELECT * FROM entries WHERE id = ? ORDER BY is_current DESC, version DESC LIMIT 1', id);
  return r ? toEntry(r) : undefined;
}

export function entryVersions(id: string): EntryRow[] {
  return all<Record<string, unknown>>('SELECT * FROM entries WHERE id = ? ORDER BY version DESC, is_current DESC', id).map(toEntry);
}

export interface EntryFilter { type?: string; module?: string; status?: string; category?: string; q?: string; file?: string; currentOnly?: boolean; limit?: number; offset?: number }
export function listEntries(f: EntryFilter = {}): { total: number; items: EntryRow[] } {
  const where: string[] = [];
  const p: unknown[] = [];
  if (f.currentOnly !== false) where.push("(is_current = 1 OR file LIKE 'review/%')");
  if (f.type) { where.push('type = ?'); p.push(f.type); }
  if (f.module) { where.push('module = ?'); p.push(f.module); }
  if (f.status) { where.push('status = ?'); p.push(f.status); }
  if (f.category) { where.push('category = ?'); p.push(f.category); }
  if (f.file) { where.push('file = ?'); p.push(f.file); }
  if (f.q) { where.push('(title LIKE ? OR id LIKE ? OR fields LIKE ?)'); p.push(`%${f.q}%`, `%${f.q}%`, `%${f.q}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM entries ${w}`, ...p)?.n ?? 0);
  const items = all<Record<string, unknown>>(`SELECT * FROM entries ${w} ORDER BY type, module, title LIMIT ? OFFSET ?`, ...p, f.limit ?? 200, f.offset ?? 0).map(toEntry);
  return { total, items };
}

export interface Relation { fromType: string; fromId: string; rel: string; toType: string; toId: string; status: string; basis: string; otherTitle?: string }
export function relationsOf(id: string): { outgoing: Relation[]; incoming: Relation[] } {
  const map = (r: Record<string, unknown>, other: string): Relation => ({
    fromType: String(r['from_type']), fromId: String(r['from_id']), rel: String(r['rel']), toType: String(r['to_type']), toId: String(r['to_id']),
    status: String(r['status']), basis: String(r['basis'] ?? ''), otherTitle: titleOf(other),
  });
  return {
    outgoing: all<Record<string, unknown>>('SELECT * FROM relations WHERE from_id = ?', id).map((r) => map(r, String(r['to_id']))),
    incoming: all<Record<string, unknown>>('SELECT * FROM relations WHERE to_id = ?', id).map((r) => map(r, String(r['from_id']))),
  };
}

export function titleOf(id: string): string {
  if (id.startsWith('DOC-')) return String(get<{ title: string }>('SELECT title FROM documents WHERE id = ?', id)?.title ?? id);
  return String(get<{ title: string }>('SELECT title FROM entries WHERE id = ? ORDER BY is_current DESC LIMIT 1', id)?.title ?? id);
}

/** The transaction entry a free-text transaction value points to ("RMPO", "rmpo", "RMPO – Raw Material Purchase Order"). */
export function findTransaction(text: string): EntryRow | undefined {
  const rows = all<Record<string, unknown>>("SELECT * FROM entries WHERE type = 'transaction' AND is_current = 1").map(toEntry);
  const n = text.toLowerCase().trim();
  return rows.find((t) => t.fields['SLUG'] === n)
    ?? rows.find((t) => t.title.toLowerCase() === n)
    ?? rows.find((t) => t.title.toLowerCase().split(/\s+[–-]\s+|\s*\(|\)/).map((x) => x.trim()).filter(Boolean).includes(n))
    ?? rows.find((t) => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(t.title.toLowerCase()));
}

export function docRow(id: string): Record<string, unknown> | undefined {
  return get('SELECT * FROM documents WHERE id = ?', id);
}
