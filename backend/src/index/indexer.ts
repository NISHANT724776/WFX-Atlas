// Layer C: turns the TXT library and extracted documents into searchable chunks, entry rows, relationships, the word
// vocabulary and the knowledge catalogue. Everything here is rebuildable from the knowledge folder.
import { KDIRS } from '../config.ts';
import { all, get, run, tx } from '../db.ts';
import { kpath, loadLibrary, readHistory } from '../knowledge/library.ts';
import { stepsOf, statusOf, titleOf, validateEntry, versionOf } from '../knowledge/txt.ts';
import type { Entry } from '../knowledge/txt.ts';
import { normalize } from '../search/lexicon.ts';
import { resetSearchCache } from '../search/search.ts';
import { nowIso, writeJson } from '../util.ts';

export interface ChunkIn {
  ref: string;
  kind: string;
  title: string;
  heading?: string;
  text: string;
  module?: string | null;
  txn?: string | null;
  status: string;
  sourceLabel: string;
  docId?: string | null;
  docVersion?: number | null;
  entryId?: string | null;
  entryVersion?: number | null;
  locator?: string | null;
  isCurrent?: boolean;
}

export function insertChunk(c: ChunkIn): number {
  return run(
    `INSERT INTO chunks (ref, kind, title, heading, text, module, txn, status, source_label, doc_id, doc_version, entry_id, entry_version, locator, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    c.ref, c.kind, c.title.slice(0, 300), c.heading ?? '', c.text, c.module ?? null, c.txn ?? null, c.status, c.sourceLabel,
    c.docId ?? null, c.docVersion ?? null, c.entryId ?? null, c.entryVersion ?? null, c.locator ?? null, c.isCurrent === false ? 0 : 1,
  ).lastId;
}

export function entryKind(e: Entry): string {
  if (e.type === 'rule') {
    const c = (e.fields['RULE CATEGORY'] ?? '').toLowerCase();
    if (c.includes('calc')) return 'calculation';
    if (c.includes('valid')) return 'validation';
    if (c.includes('definition')) return 'definition';
    return 'rule';
  }
  return ({ term: 'definition', module: 'module', procedure: 'procedure', transaction: 'transaction', field: 'field', dependency: 'dependency', case: 'case', workflow: 'workflow', model: 'data_model' } as Record<string, string>)[e.type] ?? e.type;
}

const label = (k: string, v: string | undefined) => (v && v.trim() ? `${k}: ${v.trim()}` : '');
const joinText = (parts: string[]) => parts.filter(Boolean).join('\n');

/** The searchable text of an entry, split when long (data models and workflows). */
export function entryChunks(e: Entry): { title: string; heading: string; text: string; locator?: string }[] {
  const f = e.fields;
  const title = titleOf(e);
  const heading = [f['MODULE'], f['TRANSACTION'] && f['TRANSACTION'] !== title ? f['TRANSACTION'] : ''].filter(Boolean).join(' › ');
  switch (e.type) {
    case 'rule':
      return [{ title, heading, text: joinText([
        f['FORMULA / LOGIC'], label('Purpose', f['BUSINESS PURPOSE']), label('Trigger', f['TRIGGER CONDITION']), label('Applies when', f['APPLICABLE CONDITIONS']),
        label('Inputs', f['INPUT FIELDS']?.replace(/\n/g, ', ')), label('Output', f['OUTPUT']), label('Validations', f['VALIDATIONS']), label('Example', f['EXAMPLE']),
        label('Expected result', f['EXPECTED RESULT']), label('Exceptions', f['EXCEPTION CONDITIONS']), label('Where', f['SCREEN / LOCATION']), label('Options', f['OPTIONS']),
        label('Open question', f['OPEN QUESTION']), label('Conflict', f['CONFLICT']), label('Inference', f['INFERENCE']),
      ]) }];
    case 'term':
      return [{ title, heading: f['MODULE'] ?? '', text: joinText([f['DEFINITION'], label('Transaction', f['TRANSACTION']), label('Category', f['CATEGORY'])]) }];
    case 'module':
      return [{ title, heading: 'Module', text: joinText([f['DESCRIPTION'], label('Transactions', f['TRANSACTIONS']?.replace(/\n/g, '; ')), label('Submodules', f['SUBMODULES'])]) }];
    case 'procedure':
      return [{ title, heading: [f['MODULE'], f['TOPIC']].filter(Boolean).join(' › '), text: joinText([f['CONTENT'], label('Steps', f['STEPS']), label('Where in WFX', f['WHERE IN WFX']), label('Notes', f['NOTES']), label('Inference', f['INFERENCE'])]) }];
    case 'transaction':
      return [
        { title, heading: f['MODULE'] ?? '', text: joinText([f['PURPOSE'], f['ONE LINE'], label('Navigation', f['NAVIGATION PATH']), label('Keys', f['KEYS']), label('Facts', f['FACTS'])]) },
        { title: `${title} – business context`, heading: f['MODULE'] ?? '', text: joinText([f['BUSINESS CONTEXT'], label('Upstream', f['UPSTREAM']), label('Downstream', f['DOWNSTREAM'])]), locator: 'context' },
      ].filter((c) => c.text.trim());
    case 'field':
      return [{ title: `${title} (${(f['TRANSACTION'] ?? '').replace(/\s*\(.*\)$/, '')})`, heading: [f['TRANSACTION'], f['FIELD GROUP']].filter(Boolean).join(' › '), text: joinText([f['DEFINITION'], label('Type', f['FIELD TYPE']), label('Comes from', [f['SOURCE TRANSACTION'], f['SOURCE FIELD']].filter(Boolean).join(' › ')), label('Calculated by', f['CALCULATION'])]) }];
    case 'dependency':
      return [{ title, heading: 'Dependency', text: joinText([f['DESCRIPTION'], label('From', f['FROM TRANSACTION']), label('To', f['TO TRANSACTION']), label('Basis', f['BASIS'])]) }];
    case 'case':
      return [{ title, heading: [f['MODULE'], f['TRANSACTION']].filter(Boolean).join(' › '), text: joinText([label('Kind', f['KIND']), f['DESCRIPTION'], label('Notes', f['NOTES'])]) }];
    case 'workflow': {
      const steps = stepsOf(f['STEPS']).map((s) => s.split('|').map((x) => x.trim()));
      const readable = steps.map((p, i) => (p.length >= 4 ? `${i + 1}. ${p[3]} (${p[2]})` : `${i + 1}. ${p.join(' ')}`)).join('\n');
      return [{ title, heading: 'Workflow', text: joinText([f['DESCRIPTION'], label('Steps', readable)]) }];
    }
    case 'model': {
      const grids = (f['GRIDS'] ?? '').split(/\n(?=\[)/).filter(Boolean);
      const head = { title, heading: 'Data model', text: joinText([f['SUMMARY'], label('Screen', f['SCREEN']), label('Level', f['MODEL LEVEL']), label('Header fields', f['HEADER FIELDS']?.split('\n').map((l) => l.split('|')[0].trim()).join(', '))]) };
      return [head, ...grids.map((g, i) => ({ title: `${title} – ${(/^\[(.+?)\]/.exec(g)?.[1] ?? `grid ${i + 1}`)}`, heading: 'Data model', text: g, locator: `grid ${i + 1}` }))];
    }
  }
  return [{ title, heading, text: Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n') }];
}

export interface IndexReport { entries: number; chunks: number; relations: number; problems: { file: string; line: number; message: string }[]; invalid: { id: string; file: string; problems: string[] }[] }

/** Rebuilds every entry-derived row from the TXT files. Document chunks are left alone. */
export function indexLibrary(): IndexReport {
  const lib = loadLibrary();
  const invalid: IndexReport['invalid'] = [];
  // which version of each ID is current: the Active (or Approved) one in a category file; else the newest draft
  const byId = new Map<string, Entry[]>();
  for (const e of lib.entries) byId.set(e.id, [...(byId.get(e.id) ?? []), e]);
  const isPending = (e: Entry) => (e.file ?? '').startsWith(`${KDIRS.review}/`);
  const currentOf = (list: Entry[]): Entry => {
    const confirmed = list.filter((e) => !isPending(e) && ['Active', 'Approved'].includes(statusOf(e)));
    if (confirmed.length) return confirmed.sort((a, b) => versionOf(b) - versionOf(a))[0];
    return [...list].sort((a, b) => versionOf(b) - versionOf(a))[0];
  };
  let chunks = 0;
  tx(() => {
    run('DELETE FROM chunks WHERE entry_id IS NOT NULL');
    run('DELETE FROM entries');
    run("DELETE FROM relations WHERE basis LIKE 'entry:%'");
    for (const [id, list] of byId) {
      const cur = currentOf(list);
      const versions = [...list];
      // superseded versions kept in history/ are indexed as history only
      for (const h of readHistory(id)) if (!versions.some((v) => versionOf(v) === versionOf(h) && statusOf(v) === statusOf(h))) versions.push({ ...h, fields: { ...h.fields, STATUS: ['Rejected', 'Archived'].includes(statusOf(h)) ? statusOf(h) : 'Superseded' } });
      for (const e of versions) {
        const problems = validateEntry(e);
        if (problems.length && e === cur) invalid.push({ id: e.id, file: e.file ?? '', problems });
        const current = e === cur && !['Superseded', 'Rejected', 'Archived'].includes(statusOf(e));
        run(`INSERT OR REPLACE INTO entries (id, type, version, status, title, module, submodule, txn, category, file, fields, is_current, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        e.id, e.type, versionOf(e), statusOf(e), titleOf(e), e.fields['MODULE'] ?? null, e.fields['SUBMODULE'] ?? null,
        e.fields['TRANSACTION'] ?? null, e.fields['RULE CATEGORY'] ?? e.fields['KIND'] ?? null, e.file ?? '', JSON.stringify({ order: e.order, fields: e.fields }), current ? 1 : 0, e.fields['LAST UPDATED'] ?? null);
        for (const c of entryChunks(e)) {
          if (!c.text.trim()) continue;
          insertChunk({
            ref: `entry:${e.id}@${versionOf(e)}${c.locator ? `#${c.locator}` : ''}`, kind: entryKind(e), title: c.title, heading: c.heading, text: c.text,
            module: e.fields['MODULE'] ?? null, txn: e.fields['TRANSACTION'] ?? null, status: statusOf(e), sourceLabel: `${e.id} v${versionOf(e)} · knowledge/${e.file}`,
            entryId: e.id, entryVersion: versionOf(e), locator: c.locator ?? null, isCurrent: current,
          });
          chunks++;
        }
      }
    }
    buildEntryRelations(lib.entries.filter((e) => currentOf(byId.get(e.id)!) === e));
  });
  rebuildVocab();
  const relations = Number(get<{ n: number }>("SELECT COUNT(*) AS n FROM relations")?.n ?? 0);
  writeCatalog(lib.problems, invalid);
  return { entries: byId.size, chunks, relations, problems: lib.problems, invalid };
}

function addRelation(fromType: string, fromId: string, rel: string, toType: string, toId: string, basis: string, status: 'confirmed' | 'proposed' = 'confirmed'): void {
  if (!fromId || !toId || (fromType === toType && fromId === toId)) return;
  run('INSERT OR IGNORE INTO relations (from_type, from_id, rel, to_type, to_id, status, basis, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', fromType, fromId, rel, toType, toId, status, basis, nowIso());
}

/** Relationships stated by the entries themselves (never guessed). */
function buildEntryRelations(entries: Entry[]): void {
  const txns = entries.filter((e) => e.type === 'transaction');
  const bySlug = new Map(txns.map((t) => [t.fields['SLUG'], t.id]));
  const byName = new Map(txns.map((t) => [normalize(t.fields['TRANSACTION NAME'] ?? ''), t.id]));
  const ids = new Set(entries.map((e) => e.id));
  const findTxn = (v: string | undefined): string | undefined => {
    if (!v) return undefined;
    const slug = /\(([a-z0-9-]+)\)\s*$/.exec(v)?.[1];
    if (slug && bySlug.has(slug)) return bySlug.get(slug);
    return byName.get(normalize(v.replace(/\s*\(.*\)$/, ''))) ?? byName.get(normalize(v));
  };
  const refs = (v: string | undefined) => (v ?? '').match(/\b(?:CALC|RULE|TXN|TERM|PROC|WF|DM|FLD|DEP|CASE|MOD)-[A-Z0-9._-]+/g) ?? [];
  for (const e of entries) {
    const basis = (k: string) => `entry:${e.id} field "${k}"`;
    const t = findTxn(e.fields['TRANSACTION']);
    if (t && e.type !== 'transaction') addRelation(e.type, e.id, e.type === 'field' ? 'field_of' : 'applies_to', 'transaction', t, basis('TRANSACTION'));
    for (const r of refs(e.fields['CALCULATION'])) if (ids.has(r)) addRelation(e.type, e.id, 'calculated_by', 'rule', r, basis('CALCULATION'));
    for (const r of refs(e.fields['CALCULATIONS'])) if (ids.has(r)) addRelation(e.type, e.id, 'uses_calculation', 'rule', r, basis('CALCULATIONS'));
    for (const r of refs(e.fields['RELATED RULES'])) if (ids.has(r)) addRelation(e.type, e.id, 'related_to', 'rule', r, basis('RELATED RULES'));
    for (const r of refs(e.fields['GRIDS'])) if (ids.has(r)) addRelation(e.type, e.id, 'uses_calculation', 'rule', r, basis('GRIDS'));
    if (e.type === 'dependency') {
      const a = findTxn(e.fields['FROM TRANSACTION']), b = findTxn(e.fields['TO TRANSACTION']);
      if (a && b) addRelation('transaction', a, 'feeds', 'transaction', b, basis('FROM/TO TRANSACTION'));
    }
    if (e.type === 'module') {
      for (const line of (e.fields['TRANSACTIONS'] ?? '').split('\n')) { const x = findTxn(line); if (x) addRelation('module', e.id, 'contains', 'transaction', x, basis('TRANSACTIONS')); }
    }
    if (e.type === 'workflow') {
      for (const line of stepsOf(e.fields['STEPS'])) {
        const slug = /transaction:\s*([a-z0-9-]+)/.exec(line)?.[1];
        const x = slug ? bySlug.get(slug) : findTxn(line.replace(/^\d+\.\s*/, '').replace(/\s+–.*$/, ''));
        if (x) addRelation('workflow', e.id, 'includes', 'transaction', x, basis('STEPS'));
      }
    }
  }
}

/** Word document frequencies (unstemmed) over current chunks, and abbreviations the knowledge itself spells out. */
export function rebuildVocab(): void {
  const rows = all<{ id: number; title: string; heading: string; text: string }>('SELECT id, title, heading, text FROM chunks WHERE is_current = 1 ORDER BY entry_id IS NULL, id');
  const df = new Map<string, number>();
  const abbr = new Map<string, Map<string, number>>();
  const ABBR_RE = /\b([A-Z][A-Za-z]{1,6})\s*\(([A-Z][A-Za-z]+(?:[ -](?:of|and|for|to|[A-Z][A-Za-z]+)){1,6})\)|\b([A-Z][A-Za-z]+(?:[ -](?:of|and|for|to|[A-Z][A-Za-z]+)){1,6})\s*\(([A-Z]{2,7})\)/g;
  const initials = (phrase: string) => phrase.split(/[ -]/).filter((w) => !/^(of|and|for|to)$/i.test(w)).map((w) => w[0]).join('').toUpperCase();
  for (const r of rows) {
    const blob = `${r.title} ${r.heading} ${r.text}`;
    for (const w of new Set(normalize(blob).split(' '))) if (w.length >= 3 && !/^\d+$/.test(w)) df.set(w, (df.get(w) ?? 0) + 1);
    for (const m of blob.matchAll(ABBR_RE)) {
      const a = (m[1] ?? m[4]).toUpperCase(), phrase = (m[2] ?? m[3]).trim();
      if (a.length >= 2 && initials(phrase).startsWith(a.slice(0, 2)) && (initials(phrase) === a || initials(phrase).includes(a.slice(0, 3)))) {
        if (!abbr.has(a)) abbr.set(a, new Map());
        const m2 = abbr.get(a)!;
        if (!m2.has(phrase.toLowerCase())) m2.set(phrase.toLowerCase(), Number(r.id));
      }
    }
  }
  tx(() => {
    run('DELETE FROM vocab');
    for (const [w, n] of df) run('INSERT INTO vocab (word, df) VALUES (?, ?)', w, n);
    run('DELETE FROM abbreviations');
    for (const [a, m2] of abbr) for (const [p, id] of m2) run('INSERT OR IGNORE INTO abbreviations (abbr, expansion, source) VALUES (?, ?, ?)', a.toLowerCase(), p, `chunk:${id}`);
  });  resetSearchCache();
}

export function writeCatalog(problems: { file: string; line: number; message: string }[] = [], invalid: IndexReport['invalid'] = []): void {
  const byType = all<{ type: string; status: string; n: number }>('SELECT type, status, COUNT(*) AS n FROM entries WHERE is_current = 1 GROUP BY type, status');
  const byFile = all<{ file: string; n: number }>('SELECT file, COUNT(*) AS n FROM entries WHERE is_current = 1 GROUP BY file ORDER BY file');
  const modules = all<{ id: string; title: string }>("SELECT id, title FROM entries WHERE type = 'module' AND is_current = 1 ORDER BY title");
  const docs = all<{ doc_type: string; knowledge_status: string; n: number }>('SELECT doc_type, knowledge_status, COUNT(*) AS n FROM documents GROUP BY doc_type, knowledge_status');
  const types: Record<string, Record<string, number>> = {};
  for (const r of byType) (types[r.type] ??= {})[r.status] = Number(r.n);
  writeJson(kpath(KDIRS.metadata, 'knowledge_catalog.json'), {
    generated_at: nowIso(),
    hierarchy: 'WFX ERP › Modules › Submodules › Transactions › (fields, rules, calculations, validations, workflows, data models, dependencies, examples, FAQs)',
    modules: modules.map((m) => ({ id: m.id, name: m.title })),
    entries_by_type_and_status: types,
    files: byFile.map((f) => ({ file: `knowledge/${f.file}`, entries: Number(f.n) })),
    documents: docs.map((d) => ({ type: d.doc_type, knowledge_status: d.knowledge_status, count: Number(d.n) })),
    format_problems: problems,
    invalid_entries: invalid,
  });
}
