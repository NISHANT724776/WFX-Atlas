// The ingestion pipeline: validate → hash → duplicate / version detection → store the original untouched (Layer A)
// → extract → analyse → write the readable extraction and analysis (Layer B) → index chunks, candidates and
// relations (Layer C) → registry and change history. Re-indexing rebuilds Layer C from the saved analyses.
import fs from 'node:fs';
import path from 'node:path';
import { KDIRS, settings } from '../config.ts';
import { all, get, run, tx } from '../db.ts';
import { insertChunk, rebuildVocab } from '../index/indexer.ts';
import { kpath, recordChange } from '../knowledge/library.ts';
import { normalize } from '../search/lexicon.ts';
import { resetSearchCache } from '../search/search.ts';
import { ensureDir, nowIso, readJson, safeName, sha256, toPosix, writeJson } from '../util.ts';
import { analyse, resetAnalyseCache } from './analyse.ts';
import type { Analysis } from './analyse.ts';
import { checkSignature, extract, SUPPORTED } from './extract.ts';
import type { DocModel } from './extract.ts';

export const DOC_TYPES = ['specification', 'manual', 'change_request', 'data', 'diagram', 'image', 'reference', 'other'] as const;
export const KNOWLEDGE_STATUSES = ['source-documented', 'proposed', 'reference', 'unreviewed'] as const;

export interface VersionRec {
  version: number; sha256: string; size: number; original_name: string; stored_path: string; extracted_path: string | null; analysis_path: string | null;
  status: 'indexed' | 'partial' | 'stored_only' | 'failed'; status_note: string; uploaded_at: string; uploaded_by: string; origin_path: string | null;
  diff: VersionDiff | null; stats: Record<string, unknown>;
}
export interface DocRec {
  id: string; title: string; base_key: string; original_name: string; ext: string; doc_type: string; knowledge_status: string; module: string | null;
  origin: string; created_at: string; updated_at: string; created_by: string; current_version: number; versions: VersionRec[];
}
interface Registry { updated?: string; sources: unknown[]; documents: DocRec[] }
export interface VersionDiff { previous: number; sections_added: string[]; sections_removed: string[]; sections_changed: string[]; formulas_added: string[]; formulas_removed: string[]; validations_added: string[]; validations_removed: string[] }

export interface IngestOptions {
  originalName: string; origin?: string; originPath?: string; uploadedBy?: string; docType?: string; knowledgeStatus?: string;
  module?: string | null; title?: string; versionOf?: string; deferVocab?: boolean;
}
export interface IngestResult { status: 'created' | 'new-version' | 'duplicate' | 'rejected' | 'failed'; documentId?: string; version?: number; message: string; quality?: string; stats?: Record<string, unknown>; diff?: VersionDiff | null }

const regFile = () => kpath(KDIRS.metadata, 'source_registry.json');
export const readRegistry = (): Registry => { const r = readJson<Registry>(regFile(), { sources: [], documents: [] }); r.sources ??= []; r.documents ??= []; return r; };
const writeRegistry = (r: Registry) => writeJson(regFile(), { ...r, updated: nowIso() });

/** Same document, different file name variants: "(1)", "Final", "V2", "Updated" and similar suffixes are ignored. */
export function baseKey(name: string): string {
  return path.parse(name).name.toLowerCase()
    .replace(/\s*\(\d+\)/g, ' ')
    .replace(/[\s_-]*\b(final(?:[\s_-]*last)?(?:[\s_-]*[a-z]+)?|updated?|latest|copy(?: of)?|draft|v\d+(?:\.\d+)?|version\s*\d+|rev\s*\d+)\b/gi, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim();
}

export function guessDocType(name: string, ext: string): string {
  if (['png', 'jpg', 'jpeg', 'webp'].includes(ext)) return 'image';
  if (['mmd', 'mermaid'].includes(ext)) return 'diagram';
  if (['csv', 'json'].includes(ext)) return 'data';
  const n = name.toLowerCase();
  if (/manual|user guide|\bsop\b|workflow|process flow|how to/.test(n)) return 'manual';
  if (/^\d{5,6}\b|tracker point|\bneed\b|issue|bug|not working|not showing|restricted|\bcr\b/.test(n)) return 'change_request';
  if (/sprint|spec|specification|\bsrs\b|\bfrd\b|\bbrd\b|enhancement|requirement|design|gaps?\b|setup|configuration|handling|handelling/.test(n)) return 'specification';
  if (ext === 'xlsx' || ext === 'xls') return 'data';
  return 'other';
}

function nextDocId(reg: Registry): string {
  const n = Math.max(0, ...reg.documents.map((d) => Number(d.id.replace(/\D/g, '')) || 0)) + 1;
  return `DOC-${String(n).padStart(4, '0')}`;
}

function sectionMap(a: Analysis): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of a.chunks.filter((x) => x.kind === 'section' || x.kind === 'table')) {
    const key = c.heading || c.title;
    m.set(key, (m.get(key) ?? '') + c.text);
  }
  return m;
}

function diffAnalyses(prev: Analysis, cur: Analysis, previous: number): VersionDiff {
  const a = sectionMap(prev), b = sectionMap(cur);
  const kinds = (x: Analysis, k: string) => new Set(x.candidates.filter((c) => c.kind === k).map((c) => normalize(c.text)));
  const pf = kinds(prev, 'formula'), cf = kinds(cur, 'formula'), pv = kinds(prev, 'validation'), cv = kinds(cur, 'validation');
  const textOf = (x: Analysis, k: string, set: Set<string>) => x.candidates.filter((c) => c.kind === k && set.has(normalize(c.text))).map((c) => c.text).slice(0, 50);
  return {
    previous,
    sections_added: [...b.keys()].filter((k) => !a.has(k)).slice(0, 100),
    sections_removed: [...a.keys()].filter((k) => !b.has(k)).slice(0, 100),
    sections_changed: [...b.keys()].filter((k) => a.has(k) && sha256(a.get(k)!) !== sha256(b.get(k)!)).slice(0, 100),
    formulas_added: textOf(cur, 'formula', new Set([...cf].filter((x) => !pf.has(x)))),
    formulas_removed: textOf(prev, 'formula', new Set([...pf].filter((x) => !cf.has(x)))),
    validations_added: textOf(cur, 'validation', new Set([...cv].filter((x) => !pv.has(x)))),
    validations_removed: textOf(prev, 'validation', new Set([...pv].filter((x) => !cv.has(x)))),
  };
}

function extractedText(doc: DocRec, v: VersionRec, model: DocModel | null, a: Analysis | null): string {
  const lines = [
    `# Extracted content of ${doc.id} version ${v.version}. Generated by the ingestion pipeline; the original file is unchanged in ${v.stored_path}.`,
    `# This file is for reading and search. Candidates at the end are NOT confirmed knowledge until reviewed.`,
    '',
    `DOCUMENT ID: ${doc.id}`, `TITLE: ${doc.title}`, `VERSION: ${v.version}`, `ORIGINAL FILE: ${v.stored_path}`, `ORIGINAL NAME: ${v.original_name}`,
    `SHA-256: ${v.sha256}`, `FORMAT: ${doc.ext} · extraction ${model?.quality ?? 'failed'}`, `DOCUMENT TYPE: ${doc.doc_type}`, `KNOWLEDGE STATUS: ${doc.knowledge_status}`,
    `MODULE (detected): ${a?.module ?? 'unclassified'}${a?.moduleScores.length ? ` (scores: ${a.moduleScores.map((s) => `${s.module} ${s.score}`).join(', ')})` : ''}`,
    `TRANSACTIONS (detected): ${a?.transactions.join('; ') || 'none'}`, `KEY TERMS: ${a?.keyTerms.join(', ') || '-'}`,
    `NOTES: ${[...(model?.notes ?? []), v.status_note].filter(Boolean).join(' ') || '-'}`,
    `INGESTED: ${v.uploaded_at} by ${v.uploaded_by}`,
    '='.repeat(80),
  ];
  if (model) {
    for (const b of model.blocks) {
      const where = [b.page ? `p.${b.page}` : '', b.sheet ? `sheet ${b.sheet}` : ''].filter(Boolean).join(' ');
      if (b.type === 'heading') lines.push('', `${'#'.repeat(Math.min(b.level ?? 1, 6))} ${b.text}${where ? `   [${where}]` : ''}`);
      else if (b.type === 'table' && b.table !== undefined) {
        const t = model.tables[b.table];
        lines.push('', `[TABLE ${b.table + 1}: ${t.name} · ${t.rows.length} rows · columns: ${t.headers.map((h, i) => `${h} (${t.types[i]})`).join(', ')}${t.identifiers.length ? ` · identifiers: ${t.identifiers.join(', ')}` : ''}]`);
        lines.push(...[t.headers, ...t.rows.slice(0, 200)].map((r) => `| ${r.join(' | ')} |`));
        if (t.rows.length > 200) lines.push(`| … ${t.rows.length - 200} more rows (all rows are indexed up to 400) |`);
      } else if (b.type === 'diagram') lines.push('', '[DIAGRAM]', b.text);
      else if (b.type === 'code') lines.push('', '```', b.text, '```');
      else lines.push(`${b.type === 'list' ? '• ' : ''}${b.text}${where && b.type !== 'list' ? `   [${where}]` : ''}`);
    }
  }
  if (a?.candidates.length) {
    lines.push('', '='.repeat(80), 'CANDIDATES FOR REVIEW (possible definitions, formulas, validations, steps; not confirmed knowledge)');
    for (const c of a.candidates) lines.push(`- ${c.kind} (${c.locator}): ${c.text.replace(/\n/g, ' / ')}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Writes a document version into the index (chunks, candidates, relations). Earlier versions stay as history. */
function indexVersion(doc: DocRec, v: VersionRec, a: Analysis | null): number {
  let n = 0;
  run('UPDATE chunks SET is_current = 0 WHERE doc_id = ? AND doc_version <> ?', doc.id, v.version);
  run('DELETE FROM chunks WHERE doc_id = ? AND doc_version = ?', doc.id, v.version);
  if (!a) return 0;
  const current = v.version === doc.current_version;
  for (const c of a.chunks) {
    insertChunk({
      ref: `doc:${doc.id}@${v.version}#${c.locator}`, kind: c.kind, title: rowTitle(c) || c.title || doc.title, heading: [doc.title, c.heading].filter(Boolean).join(' › '), text: c.text,
      module: doc.module ?? a.module, txn: a.transactions[0] ?? null, status: doc.knowledge_status, sourceLabel: `${doc.id} v${v.version} · ${doc.title}`,
      docId: doc.id, docVersion: v.version, locator: c.locator, isCurrent: current,
    });
    n++;
  }
  const decisions = readJson<Record<string, { status: string; entry_id?: string }>>(kpath(KDIRS.metadata, 'candidate_decisions.json'), {});
  run('DELETE FROM candidates WHERE doc_id = ? AND doc_version = ?', doc.id, v.version);
  for (const c of a.candidates) {
    const key = `${doc.id}@${v.version}:${sha256(normalize(c.text)).slice(0, 16)}`;
    const d = decisions[key];
    run('INSERT INTO candidates (doc_id, doc_version, kind, text, module, txn, locator, status, entry_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      doc.id, v.version, c.kind, c.text, c.module ?? doc.module, c.txn ?? null, c.locator, d?.status ?? 'new', d?.entry_id ?? null, nowIso());
  }
  run("DELETE FROM relations WHERE from_type = 'document' AND from_id = ?", doc.id);
  for (const t of a.transactions) {
    const txn = get<{ id: string }>("SELECT id FROM entries WHERE type = 'transaction' AND is_current = 1 AND title = ?", t);
    if (txn) run('INSERT OR IGNORE INTO relations (from_type, from_id, rel, to_type, to_id, status, basis, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', 'document', doc.id, 'mentions', 'transaction', txn.id, 'confirmed', `doc:${doc.id}@${v.version} names the transaction several times`, nowIso());
  }
  return n;
}

function upsertDocRows(doc: DocRec): void {
  run(`INSERT INTO documents (id, title, base_key, original_name, ext, doc_type, knowledge_status, module, submodule, current_version, origin, created_at, updated_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, base_key = excluded.base_key, doc_type = excluded.doc_type, knowledge_status = excluded.knowledge_status,
         module = excluded.module, current_version = excluded.current_version, updated_at = excluded.updated_at`,
  doc.id, doc.title, doc.base_key, doc.original_name, doc.ext, doc.doc_type, doc.knowledge_status, doc.module, doc.current_version, doc.origin, doc.created_at, doc.updated_at, doc.created_by);
  for (const v of doc.versions) {
    run(`INSERT INTO document_versions (document_id, version, sha256, size, original_name, stored_path, extracted_path, status, status_note, stats, diff, uploaded_by, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(document_id, version) DO UPDATE SET extracted_path = excluded.extracted_path, status = excluded.status, status_note = excluded.status_note, stats = excluded.stats, diff = excluded.diff`,
    doc.id, v.version, v.sha256, v.size, v.original_name, v.stored_path, v.extracted_path, v.status, v.status_note, JSON.stringify(v.stats), v.diff ? JSON.stringify(v.diff) : null, v.uploaded_by, v.uploaded_at);
  }
}

/** Runs extraction + analysis for a stored version and writes the Layer B files. */
function processVersion(doc: DocRec, v: VersionRec): { model: DocModel | null; analysis: Analysis | null } {
  const full = kpath(v.stored_path);
  let model: DocModel | null = null, analysis: Analysis | null = null;
  try {
    model = extract(fs.readFileSync(full), doc.ext, v.original_name);
    // the file name is the most reliable title (Word titles are often empty or generic)
    if (!doc.title || doc.title === v.original_name) doc.title = path.parse(v.original_name).name.replace(/\s*\(\d+\)/g, '').replace(/[_]+/g, ' ').trim();
    analysis = analyse(model, doc.title);
    v.status = model.quality === 'complete' ? 'indexed' : model.quality === 'partial' ? 'partial' : 'stored_only';
    v.status_note = model.notes.join(' ');
    v.stats = { blocks: model.blocks.length, tables: model.tables.length, chunks: analysis.chunks.length, candidates: analysis.candidates.length, quality: model.quality, meta: model.meta, detected_module: analysis.module, transactions: analysis.transactions, key_terms: analysis.keyTerms.slice(0, 10) };
    if (!doc.module && analysis.module) doc.module = analysis.module;
  } catch (e) {
    v.status = 'failed';
    v.status_note = `Extraction failed: ${(e as Error).message}`;
    v.stats = {};
  }
  const base = `${doc.id}_v${v.version}`;
  v.extracted_path = toPosix(path.join(KDIRS.extracted, `${base}.txt`));
  fs.mkdirSync(kpath(KDIRS.extracted), { recursive: true });
  fs.writeFileSync(kpath(v.extracted_path), extractedText(doc, v, model, analysis), 'utf8');
  if (analysis) {
    v.analysis_path = toPosix(path.join(KDIRS.extracted, `${base}.analysis.json`));
    writeJson(kpath(v.analysis_path), { tables: model?.tables.map((t) => ({ ...t, rows: t.rows.slice(0, 400) })) ?? [], ...analysis });
  }
  return { model, analysis };
}

export async function ingestBuffer(buf: Buffer, opts: IngestOptions): Promise<IngestResult> {
  const S = settings();
  const original = path.basename(opts.originalName);
  const ext = path.extname(original).slice(1).toLowerCase();
  if (!SUPPORTED.includes(ext)) return { status: 'rejected', message: `.${ext || '?'} files are not supported. Supported: ${SUPPORTED.join(', ')}.` };
  if (buf.length === 0) return { status: 'rejected', message: 'The file is empty.' };
  if (buf.length > S.maxUploadBytes) return { status: 'rejected', message: `The file is larger than ${Math.round(S.maxUploadBytes / 1048576)} MB.` };
  const sig = checkSignature(buf, ext);
  if (sig) return { status: 'rejected', message: sig };
  const hash = sha256(buf);
  const reg = readRegistry();
  const dup = reg.documents.find((d) => d.versions.some((v) => v.sha256 === hash));
  if (dup) {
    const v = dup.versions.find((x) => x.sha256 === hash)!;
    return { status: 'duplicate', documentId: dup.id, version: v.version, message: `Already stored as ${dup.id} version ${v.version} (${dup.title}); nothing was added.` };
  }
  const key = baseKey(original);
  let doc = opts.versionOf ? reg.documents.find((d) => d.id === opts.versionOf) : reg.documents.find((d) => d.base_key === key && d.ext.replace(/x$/, '') === ext.replace(/x$/, ''));
  if (opts.versionOf && !doc) return { status: 'rejected', message: `Document ${opts.versionOf} does not exist.` };
  const now = nowIso();
  const isNew = !doc;
  if (!doc) {
    doc = {
      id: nextDocId(reg), title: opts.title ?? '', base_key: key, original_name: original, ext, doc_type: opts.docType ?? guessDocType(original, ext),
      knowledge_status: opts.knowledgeStatus ?? 'unreviewed', module: opts.module ?? null, origin: opts.origin ?? 'upload', created_at: now, updated_at: now,
      created_by: opts.uploadedBy ?? 'system', current_version: 0, versions: [],
    };
    reg.documents.push(doc);
  }
  const version = Math.max(0, ...doc.versions.map((v) => v.version)) + 1;
  const stored = toPosix(path.join(KDIRS.originals, doc.id, `v${version}`, safeName(original)));
  const full = kpath(stored);
  if (fs.existsSync(full)) return { status: 'failed', message: `Refusing to overwrite ${stored}.` };
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, buf, { flag: 'wx' });
  const v: VersionRec = { version, sha256: hash, size: buf.length, original_name: original, stored_path: stored, extracted_path: null, analysis_path: null, status: 'stored_only', status_note: '', uploaded_at: now, uploaded_by: opts.uploadedBy ?? 'system', origin_path: opts.originPath ?? null, diff: null, stats: {} };
  doc.versions.push(v);
  doc.current_version = version;
  doc.updated_at = now;
  if (opts.title) doc.title = opts.title;
  if (opts.knowledgeStatus) doc.knowledge_status = opts.knowledgeStatus;
  if (opts.module) doc.module = opts.module;
  const { analysis } = processVersion(doc, v);
  if (!isNew && analysis) {
    const prev = doc.versions.find((x) => x.version === version - 1);
    const prevAnalysis = prev?.analysis_path ? readJson<Analysis | null>(kpath(prev.analysis_path), null) : null;
    if (prevAnalysis) v.diff = diffAnalyses(prevAnalysis, analysis, prev!.version);
  }
  writeRegistry(reg);
  tx(() => { upsertDocRows(doc!); indexVersion(doc!, v, analysis); });
  recordChange({ entry_id: doc.id, action: isNew ? 'document-added' : 'document-new-version', to_version: version, from_version: isNew ? null : version - 1, changed_by: v.uploaded_by, source: opts.originPath ?? original, reason: `${v.status}: ${v.status_note || 'extracted and indexed'}`, file: stored });
  if (!opts.deferVocab) { rebuildVocab(); resetSearchCache(); }
  return {
    status: isNew ? 'created' : 'new-version', documentId: doc.id, version, quality: String(v.stats['quality'] ?? v.status), stats: v.stats, diff: v.diff,
    message: `${isNew ? 'Stored' : 'Stored new version of'} ${doc.id} v${version} "${doc.title}": ${v.status}${v.status_note ? ` (${v.status_note})` : ''}.`,
  };
}

export async function ingestPath(file: string, opts: Partial<IngestOptions> = {}): Promise<IngestResult> {
  const buf = fs.readFileSync(file);
  return ingestBuffer(buf, { originalName: path.basename(file), originPath: file, origin: opts.origin ?? 'import', ...opts });
}

/** Re-runs extraction for a stored version (e.g. after a parser improvement). The original file is not touched. */
export function reprocess(docId: string, version?: number): IngestResult {
  const reg = readRegistry();
  const doc = reg.documents.find((d) => d.id === docId);
  if (!doc) return { status: 'rejected', message: `Document ${docId} does not exist.` };
  const v = doc.versions.find((x) => x.version === (version ?? doc.current_version));
  if (!v) return { status: 'rejected', message: `Version ${version} of ${docId} does not exist.` };
  resetAnalyseCache();
  const { analysis } = processVersion(doc, v);
  writeRegistry(reg);
  tx(() => { upsertDocRows(doc); indexVersion(doc, v, analysis); });
  rebuildVocab();
  resetSearchCache();
  return { status: 'created', documentId: doc.id, version: v.version, quality: String(v.stats['quality'] ?? v.status), stats: v.stats, message: `Reprocessed ${doc.id} v${v.version}: ${v.status}.` };
}

/** Rebuilds documents, versions and document chunks from the registry and the saved analyses. */
/** A table row is found by the thing it is about: "Term: Ratio Type; What it means: …" is titled "Ratio Type". */
const rowTitle = (c: { kind: string; text: string }): string => {
  // only rows that define a term (a glossary table), not every table of fields
  if (c.kind !== 'data_row' || !/^(Term|Word|Concept|Abbreviation)\s*:/i.test(c.text) || !/;\s*(What it means|Meaning|Definition|Description|Full form)\s*:/i.test(c.text)) return '';
  const first = /^[^:;]{1,40}:\s*([^;]{2,60})(?:;|$)/.exec(c.text)?.[1]?.trim() ?? '';
  return /^[\d.,\s-]*$/.test(first) ? '' : first;
};

export async function reindexDocuments(): Promise<{ documents: number; versions: number; chunks: number }> {
  const reg = readRegistry();
  let versions = 0, chunks = 0;
  resetAnalyseCache();
  tx(() => {
    run('DELETE FROM chunks WHERE doc_id IS NOT NULL');
    run('DELETE FROM document_versions');
    run('DELETE FROM documents');
    run("DELETE FROM relations WHERE from_type = 'document'");
    for (const doc of reg.documents) {
      upsertDocRows(doc);
      for (const v of doc.versions) {
        versions++;
        const a = v.analysis_path ? readJson<Analysis | null>(kpath(v.analysis_path), null) : null;
        chunks += indexVersion(doc, v, a);
      }
    }
  });
  rebuildVocab();
  resetSearchCache();
  return { documents: reg.documents.length, versions, chunks };
}

export function setCandidateDecision(id: number, status: 'promoted' | 'dismissed' | 'new', entryId?: string): void {
  const c = get<{ doc_id: string; doc_version: number; text: string }>('SELECT doc_id, doc_version, text FROM candidates WHERE id = ?', id);
  if (!c) throw new Error(`Candidate ${id} not found.`);
  run('UPDATE candidates SET status = ?, entry_id = ? WHERE id = ?', status, entryId ?? null, id);
  const file = kpath(KDIRS.metadata, 'candidate_decisions.json');
  const d = readJson<Record<string, { status: string; entry_id?: string }>>(file, {});
  d[`${c.doc_id}@${c.doc_version}:${sha256(normalize(c.text)).slice(0, 16)}`] = { status, entry_id: entryId };
  writeJson(file, d);
}

export function documentList(): Record<string, unknown>[] {
  return all('SELECT d.*, v.status AS version_status, v.status_note, v.size, v.uploaded_at FROM documents d LEFT JOIN document_versions v ON v.document_id = d.id AND v.version = d.current_version ORDER BY d.updated_at DESC');
}
