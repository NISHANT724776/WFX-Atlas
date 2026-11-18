// Data modelling studio. Two kinds of model, never mixed up:
//  • captured models – the 28 MODEL entries recorded from WFX screens and specifications (header fields, grids, which
//    field takes its value from which document). Links between documents are documented; anything else (e.g. that a
//    grid holds the lines of its document) is marked inferred.
//  • drafts – conceptual / logical models written from a requirement. Every entity, key and relationship in them is
//    marked proposed (or inferred when the studio adds it, e.g. a junction table); they are saved as MODEL entries with
//    status Draft and go through the normal review lifecycle.
// Neither is the WFX database schema: the DDL draft says so in its first line.
import { all } from '../db.ts';
import { CONFIRMED, makeEntry } from '../knowledge/txt.ts';
import type { Entry } from '../knowledge/txt.ts';
import { getEntry } from '../knowledge/repo.ts';
import type { EntryRow } from '../knowledge/repo.ts';
import { idPart, today } from '../util.ts';

export type Basis = 'documented' | 'proposed' | 'inferred';
export type AttrKind = 'key' | 'entered' | 'calc' | 'link' | 'copied' | 'attribute';
export type Cardinality = '1:1' | '1:N' | 'N:1' | 'M:N';
export interface Attribute { name: string; kind: AttrKind; type: string; pk: boolean; fk: string; formula: string; rule: string; from: string; note: string; basis: Basis }
export interface Entity { id: string; name: string; basis: Basis; note: string; attributes: Attribute[] }
export interface Relationship { from: string; to: string; cardinality: Cardinality; label: string; basis: Basis }
export interface DataModel {
  id: string; name: string; level: 'captured' | 'conceptual' | 'logical'; screen: string; summary: string; source: string;
  status: string; version: number; basisNote: string; requirement: string; entities: Entity[]; relationships: Relationship[];
}
export interface Check { level: 'error' | 'warning' | 'info'; entity: string; message: string }

const CAPTURED_NOTE = 'Captured screen-level model: fields as recorded from WFX screens and specifications. Not the WFX database schema; table and column names are not documented.';
const DRAFT_NOTE = 'Proposed model drafted from a requirement. Nothing in it is confirmed WFX knowledge until it is reviewed and approved.';
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'x';
const attr = (name: string, p: Partial<Attribute> = {}): Attribute => ({ name, kind: 'attribute', type: '', pk: false, fk: '', formula: '', rule: '', from: '', note: '', basis: 'proposed', ...p });
const KINDS: AttrKind[] = ['key', 'entered', 'calc', 'link', 'copied'];

// ── captured models ──────────────────────────────────────────────────────────────────────────────────────────────

/** One "label | kind | formula: … | rule: … | from: doc.col | note: …" line. */
function capturedAttr(line: string): Attribute | null {
  const p = line.split('|').map((x) => x.trim());
  if (!p[0]) return null;
  const kind = (KINDS.includes(p[1] as AttrKind) ? p[1] : 'attribute') as AttrKind;
  const val = (k: string) => p.find((x) => x.startsWith(`${k}:`))?.slice(k.length + 1).trim() ?? '';
  return attr(p[0], { kind, pk: kind === 'key', formula: val('formula'), rule: val('rule'), from: val('from'), note: val('note'), basis: 'documented', fk: kind === 'link' && val('from') ? val('from') : '' });
}

/** The model entry a "from: doc.col" reference points at (DM-<DOC>), if it exists. */
export function modelOfRef(ref: string): string | null {
  const doc = ref.split('.')[0];
  if (!doc) return null;
  const id = `DM-${doc.toUpperCase()}`;
  return getEntry(id) ? id : null;
}

/** A captured MODEL entry as entities (header + one per grid) with documented links to other documents. */
function capturedModel(e: EntryRow): DataModel {
  const m: DataModel = { id: e.id, name: e.title, level: 'captured', screen: e.fields['SCREEN'] ?? '', summary: e.fields['SUMMARY'] ?? '', source: e.fields['SOURCE'] ?? '', status: e.status, version: e.version, basisNote: CAPTURED_NOTE, requirement: '', entities: [], relationships: [] };
  const header: Entity = { id: e.id, name: e.title, basis: 'documented', note: 'Header fields of the screen', attributes: [] };
  for (const line of (e.fields['HEADER FIELDS'] ?? '').split('\n')) { const a = capturedAttr(line); if (a) header.attributes.push(a); }
  m.entities.push(header);
  let grid: Entity | null = null;
  for (const line of (e.fields['GRIDS'] ?? '').split('\n')) {
    const g = /^\[(.+?)\]\s*(.*)$/.exec(line.trim());
    if (g) {
      const name = g[1].replace(/\s*\(\d+\)\s*$/, '').trim();
      grid = { id: `${e.id}:${slug(name)}`, name: `${e.title} · ${name}`, basis: 'documented', note: `Grid on the screen${g[2] ? `, ${g[2].replace(/[()]/g, '')}` : ''}`, attributes: [] };
      m.entities.push(grid);
      m.relationships.push({ from: header.id, to: grid.id, cardinality: '1:N', label: 'grid lines', basis: 'inferred' });
      continue;
    }
    const a = capturedAttr(line);
    if (a) (grid ?? header).attributes.push(a);
  }
  // documented value links to other captured documents
  for (const ent of m.entities) for (const a of ent.attributes) {
    if (!a.from) continue;
    const target = modelOfRef(a.from);
    if (!target) { a.note = [a.note, `source document "${a.from.split('.')[0]}" has no captured model`].filter(Boolean).join('; '); continue; }
    if (target === e.id) continue;
    if (!m.entities.some((x) => x.id === target)) m.entities.push({ id: target, name: getEntry(target)!.title, basis: 'documented', note: 'Linked document (open it for its fields)', attributes: [] });
    // one documented link per pair of entities, naming the fields that take their value from the other document
    const ex = m.relationships.find((r) => r.from === ent.id && r.to === target);
    if (ex) ex.label = `${ex.label}, ${a.name}`;
    else m.relationships.push({ from: ent.id, to: target, cardinality: 'N:1', label: `values from: ${a.name}`, basis: 'documented' });
  }
  return m;
}

/** The map of every captured model and the documented links between them. */
export function capturedMap(): DataModel {
  const m: DataModel = { id: 'DM-MAP', name: 'All captured WFX documents', level: 'captured', screen: '', summary: 'Every captured document model and the documented "value comes from" links between them.', source: 'Captured MODEL entries', status: 'Active', version: 1, basisNote: CAPTURED_NOTE, requirement: '', entities: [], relationships: [] };
  for (const e of capturedRows()) {
    m.entities.push({ id: e.id, name: e.title, basis: 'documented', note: e.fields['SCREEN'] ?? '', attributes: [] });
    for (const line of `${e.fields['HEADER FIELDS'] ?? ''}\n${e.fields['GRIDS'] ?? ''}`.split('\n')) {
      const a = capturedAttr(line);
      const t = a?.from ? modelOfRef(a.from) : null;
      if (!a || !t || t === e.id) continue;
      if (!m.relationships.some((r) => r.from === e.id && r.to === t)) m.relationships.push({ from: e.id, to: t, cardinality: 'N:1', label: 'takes values from', basis: 'documented' });
    }
  }
  return m;
}

const capturedRows = () => all<{ id: string }>("SELECT id FROM entries WHERE type = 'model' AND is_current = 1 AND json_extract(fields, '$.fields.GRIDS') IS NOT NULL ORDER BY id").map((r) => getEntry(r.id)!).filter(Boolean);

/** Captured models and drafts, for the studio's list. */
export function listModels() {
  const rows = all<{ id: string; title: string; status: string; version: number; file: string; grids: string | null; level: string | null; screen: string | null }>(
    "SELECT id, title, status, version, file, json_extract(fields, '$.fields.GRIDS') AS grids, json_extract(fields, '$.fields.MODEL LEVEL') AS level, json_extract(fields, '$.fields.SCREEN') AS screen FROM entries WHERE type = 'model' AND (is_current = 1 OR file LIKE 'review/%') ORDER BY title");
  return {
    captured: rows.filter((r) => r.grids !== null).map((r) => ({ id: r.id, title: r.title, status: r.status, version: r.version, screen: r.screen ?? '' })),
    drafts: rows.filter((r) => r.grids === null).map((r) => ({ id: r.id, title: r.title, status: r.status, version: r.version, level: r.level ?? '' })),
  };
}

// ── drafts from a requirement ────────────────────────────────────────────────────────────────────────────────────

const MANY = /^(many|multiple|several|one or more|any number of|a list of|lots of|n)$/;
const ART = /^(a|an|the|each|every|one|its|their)\s+/i;
const clean = (s: string) => s.replace(ART, '').replace(/[.;]+$/, '').trim();
const singular = (s: string) => {
  const w = s.split(' '); const last = w[w.length - 1];
  w[w.length - 1] = /ies$/i.test(last) ? last.replace(/ies$/i, 'y') : /(ss|us|is)$/i.test(last) ? last : /(ches|shes|xes|ses)$/i.test(last) ? last.replace(/es$/i, '') : last.replace(/s$/i, '');
  return w.join(' ');
};
const title = (s: string) => singular(clean(s)).replace(/\b\w/g, (c) => c.toUpperCase());

/** "qty: decimal", "Order No (key)", "*Supplier" → an attribute. */
function textAttr(raw: string): Attribute | null {
  let s = raw.trim().replace(/^(and|or)\s+/i, '').replace(/[.;]+$/, '');
  if (!s) return null;
  const pk = /\((pk|key|primary key)\)|^#/i.test(s);
  const fk = /\(fk\s*(?:→|->|to)?\s*([^)]+)\)/i.exec(s)?.[1]?.trim() ?? '';
  const required = /^\*/.test(s) || /\(required\)/i.test(s);
  s = s.replace(/\((pk|key|primary key|required)\)|\(fk[^)]*\)|^[#*]/gi, '').trim();
  const [name, type] = s.split(/\s*:\s*/);
  if (!name || name.split(' ').length > 6) return null;
  return attr(name.trim(), { kind: pk ? 'key' : 'attribute', pk, fk: fk ? title(fk) : '', type: (type ?? '').trim(), note: required ? 'required' : '' });
}

/**
 * A requirement in plain sentences → a proposed model. Understood forms (one per sentence or line):
 *   "Supplier: code (key), name, country"            entity with attributes (also "Supplier has fields …")
 *   "An order has many lines" / "… one or more …"     one-to-many
 *   "Each line belongs to one order"                   many-to-one
 *   "An order has one invoice"                         one-to-one
 *   "Orders and suppliers are many-to-many" /
 *   "A style can have many colours and a colour can be used by many styles"   many-to-many (a junction table is proposed)
 * Anything else is reported back as "not understood" rather than guessed.
 */
export function draftFromText(text: string, name = 'New data model'): { model: DataModel; notUnderstood: string[] } {
  const m: DataModel = { id: '', name, level: 'conceptual', screen: '', summary: '', source: '', status: 'Draft', version: 0, basisNote: DRAFT_NOTE, requirement: text.trim(), entities: [], relationships: [] };
  const notUnderstood: string[] = [];
  const ent = (n: string): Entity => {
    const nm = title(n);
    let e = m.entities.find((x) => x.name.toLowerCase() === nm.toLowerCase());
    if (!e) { e = { id: slug(nm), name: nm, basis: 'proposed', note: '', attributes: [] }; m.entities.push(e); }
    return e;
  };
  const rel = (a: string, b: string, c: Cardinality, label: string) => {
    const A = ent(a), B = ent(b);
    const ex = m.relationships.find((r) => (r.from === A.id && r.to === B.id) || (r.from === B.id && r.to === A.id));
    if (ex) {
      // the two directions of one statement pair ("an order has many lines" + "a line belongs to one order") agree; opposite "many" sides make M:N
      const norm = ex.from === A.id ? c : (({ '1:N': 'N:1', 'N:1': '1:N', '1:1': '1:1', 'M:N': 'M:N' } as const)[c]);
      if (ex.cardinality !== norm && ex.cardinality !== '1:1' && norm !== '1:1') ex.cardinality = 'M:N';
      return;
    }
    m.relationships.push({ from: A.id, to: B.id, cardinality: c, label, basis: 'proposed' });
  };
  const sentences = text.split(/\n+|(?<=[.;])\s+/).map((s) => s.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim()).filter(Boolean);
  for (const s0 of sentences) {
    const s = s0.replace(/[.;]+$/, '');
    let r: RegExpExecArray | null;
    if ((r = /^(.+?)\s+(?:and|&)\s+(.+?)\s+(?:are|is|have a|have)\s+(?:a\s+)?many[- ]to[- ]many(?:\s+relationship)?$/i.exec(s))) { rel(r[1], r[2], 'M:N', 'related to'); continue; }
    if ((r = /^(.+?)\s+(?:can |may )?(?:have|has|contain|contains|include|includes|hold|holds)\s+(many|multiple|several|one or more|any number of|a list of|lots of)\s+(.+?)\s+and\s+(?:a |an |each )?(.+?)\s+(?:can |may )?(?:be used by|belong to|belongs to|appear in|appears in|be (?:linked|assigned) to)\s+(many|multiple|several|one or more)\s+(.+)$/i.exec(s))) { rel(r[1], r[3], 'M:N', 'related to'); continue; }
    if ((r = /^(.+?)\s+(?:can |may |must )?(?:have|has|contain|contains|include|includes|hold|holds|consist of|consists of)\s+(many|multiple|several|one or more|any number of|a list of|lots of)\s+(.+)$/i.exec(s))) { rel(r[1], r[3], '1:N', 'has'); continue; }
    if ((r = /^(.+?)\s+(?:belongs to|belong to|is for|refers to|is linked to|is assigned to|is raised for|is made against|is against)\s+(?:exactly\s+)?(?:one|a|an|the|a single)\s+(.+)$/i.exec(s))) { rel(r[1], r[2], 'N:1', 'belongs to'); continue; }
    if ((r = /^(.+?)\s+(?:has|have)\s+(?:exactly\s+)?(?:one|a single)\s+(.+)$/i.exec(s)) && !/\b(field|attribute|column)s?\b/i.test(r[2])) { rel(r[1], r[2], '1:1', 'has'); continue; }
    if ((r = /^(.+?)\s+(?:has|have|holds|records|stores|keeps)\s+(?:the\s+)?(?:fields?|attributes?|columns?|details?)\s*:?\s+(.+)$/i.exec(s)) || (r = /^([A-Za-z][\w /&-]{0,40}?)\s*:\s*(.+,.+|.+\(.+\).*)$/.exec(s))) {
      const e = ent(r[1]);
      for (const part of r[2].split(/,|\band\b(?![^()]*\))/)) { const a = textAttr(part); if (a && !e.attributes.some((x) => x.name.toLowerCase() === a.name.toLowerCase())) e.attributes.push(a); }
      continue;
    }
    notUnderstood.push(s0);
  }
  return { model: m, notUnderstood };
}

/** A logical model: primary keys, foreign keys on the "many" side, junction tables for many-to-many. */
export function toLogical(src: DataModel): DataModel {
  if (src.level === 'captured') return src;
  const m: DataModel = structuredClone(src);
  m.level = 'logical';
  const byId = new Map(m.entities.map((e) => [e.id, e]));
  for (const e of m.entities) {
    const declared = e.attributes.filter((a) => a.pk);
    if (!declared.length) e.attributes.unshift(attr(`${slug(e.name)}_id`, { kind: 'key', pk: true, type: 'identifier', basis: 'inferred', note: 'surrogate key proposed by the studio (no key was stated)' }));
  }
  const pkOf = (e: Entity) => e.attributes.find((a) => a.pk)!;
  const addFk = (child: Entity, parent: Entity, note: string) => {
    const name = `${slug(parent.name)}_id`;
    if (child.attributes.some((a) => a.fk.toLowerCase() === parent.name.toLowerCase() || a.name === name)) { for (const a of child.attributes) if (a.name === name) a.fk = parent.name; return; }
    child.attributes.push(attr(name, { kind: 'link', fk: parent.name, type: pkOf(parent).type || 'identifier', basis: 'inferred', note }));
  };
  const out: Relationship[] = [];
  for (const r of m.relationships) {
    const a = byId.get(r.from)!, b = byId.get(r.to)!;
    if (r.cardinality === '1:N') { addFk(b, a, `foreign key for "${a.name} ${r.label} ${b.name}"`); out.push(r); }
    else if (r.cardinality === 'N:1') { addFk(a, b, `foreign key for "${a.name} ${r.label} ${b.name}"`); out.push(r); }
    else if (r.cardinality === '1:1') { addFk(b, a, `foreign key (unique) for the one-to-one "${a.name} ${r.label} ${b.name}"`); out.push(r); }
    else {
      const j: Entity = { id: `${a.id}_${b.id}`, name: `${a.name} ${b.name}`, basis: 'inferred', note: `junction table proposed for the many-to-many between ${a.name} and ${b.name}`, attributes: [] };
      addFk(j, a, 'part of the key'); addFk(j, b, 'part of the key');
      for (const x of j.attributes) x.pk = true;
      m.entities.push(j); byId.set(j.id, j);
      out.push({ from: a.id, to: j.id, cardinality: '1:N', label: 'is linked through', basis: 'inferred' }, { from: b.id, to: j.id, cardinality: '1:N', label: 'is linked through', basis: 'inferred' });
    }
  }
  m.relationships = out;
  return m;
}

// ── checks ───────────────────────────────────────────────────────────────────────────────────────────────────────

export function checkModel(m: DataModel): Check[] {
  const c: Check[] = [];
  const names = new Map<string, string[]>();
  const linked = new Set(m.relationships.flatMap((r) => [r.from, r.to]));
  for (const e of m.entities) {
    const external = m.level === 'captured' && e.attributes.length === 0 && e.note.startsWith('Linked');
    if (external) continue;
    if (!e.attributes.length && m.id !== 'DM-MAP') c.push({ level: 'warning', entity: e.name, message: 'No attributes are stated.' });
    if (e.attributes.length && !e.attributes.some((a) => a.pk)) c.push({ level: m.level === 'captured' ? 'info' : 'warning', entity: e.name, message: m.level === 'captured' ? 'No key field was captured on this screen part (first normal form needs a unique identifier; WFX\'s key is not documented).' : 'No key: each row needs a unique identifier (first normal form). The logical model proposes a surrogate key.' });
    if (m.entities.length > 1 && !linked.has(e.id) && m.id !== 'DM-MAP') c.push({ level: 'warning', entity: e.name, message: 'Not connected to any other entity.' });
    for (const a of e.attributes) {
      const n = a.name.toLowerCase();
      if (/\d$/.test(n) && e.attributes.some((b) => b !== a && b.name.toLowerCase().replace(/\d+$/, '') === n.replace(/\d+$/, ''))) c.push({ level: 'warning', entity: e.name, message: `"${a.name}" looks like a repeating group (numbered columns); first normal form puts these in a child table.` });
      else if (/(s|colou?rs|sizes|list)$/.test(n) && !/(status|address|class|qty|process|loss|less|ness|bus|is|us|ss)$/.test(n) && a.kind !== 'calc' && !a.pk) c.push({ level: 'info', entity: e.name, message: `"${a.name}" may hold several values in one field; if so, first normal form puts them in a child table.` });
      if (a.kind === 'copied' && a.from) c.push({ level: 'info', entity: e.name, message: `"${a.name}" is a copy of ${a.from} (shown on the screen). In a logical model it would be read through the link instead of stored twice (third normal form).` });
      if (a.kind === 'calc') c.push({ level: 'info', entity: e.name, message: `"${a.name}" is derived${a.formula ? ` (${a.formula})` : ''}${a.rule ? ` – rule ${a.rule}` : ''}; decide whether it is stored or calculated.` });
      if (a.fk && m.level !== 'captured' && !m.entities.some((x) => x.name.toLowerCase() === a.fk.toLowerCase())) c.push({ level: 'error', entity: e.name, message: `"${a.name}" refers to "${a.fk}", which is not an entity of this model.` });
      if (!a.pk && !a.fk && a.kind !== 'calc' && a.kind !== 'copied') (names.get(n) ?? names.set(n, []).get(n)!).push(e.name);
    }
  }
  for (const r of m.relationships) if (r.cardinality === 'M:N') c.push({ level: 'info', entity: `${nameOf(m, r.from)} – ${nameOf(m, r.to)}`, message: 'Many-to-many: a relational model needs a junction table (the logical view adds one).' });
  for (const [n, ents] of names) if (ents.length > 1 && !/^(name|description|remarks?|status|date|qty|quantity|code|uom|rate|value|amount|currency|line|no)$/.test(n)) c.push({ level: 'info', entity: ents.join(', '), message: `"${n}" is held in ${ents.length} entities; if it means the same thing, keep it in one place (redundancy).` });
  return c;
}

const nameOf = (m: DataModel, id: string) => m.entities.find((e) => e.id === id)?.name ?? id;

// ── outputs ──────────────────────────────────────────────────────────────────────────────────────────────────────

const ident = (s: string) => (s.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'X').replace(/^(\d)/, '_$1');
const CARD: Record<Cardinality, string> = { '1:1': '||--||', '1:N': '||--o{', 'N:1': '}o--||', 'M:N': '}o--o{' };

/** Mermaid erDiagram (entity names made safe; basis shown in the attribute comments). */
export function toErMermaid(m: DataModel): string {
  const used = new Map<string, string>(); const taken = new Set<string>();
  const idOf = (e: Entity) => { if (!used.has(e.id)) { let b = ident(e.name).toUpperCase(), n = 2, x = b; while (taken.has(x)) x = `${b}_${n++}`; taken.add(x); used.set(e.id, x); } return used.get(e.id)!; };
  const lines = ['erDiagram'];
  for (const e of m.entities) {
    const id = idOf(e);
    if (!e.attributes.length) { lines.push(`  ${id} {`, `    text note "${e.basis}"`, '  }'); continue; }
    lines.push(`  ${id} {`);
    for (const a of e.attributes) lines.push(`    ${ident(a.type || a.kind)} ${ident(a.name)}${a.pk ? ' PK' : a.fk ? ' FK' : ''} "${[a.basis !== 'documented' ? a.basis : '', a.formula ? `= ${a.formula}` : '', a.from ? `from ${a.from}` : ''].filter(Boolean).join(', ').replace(/"/g, "'").slice(0, 80)}"`);
    lines.push('  }');
  }
  for (const r of m.relationships) {
    const a = m.entities.find((e) => e.id === r.from), b = m.entities.find((e) => e.id === r.to);
    if (a && b) lines.push(`  ${idOf(a)} ${CARD[r.cardinality]} ${idOf(b)} : "${`${r.label}${r.basis !== 'documented' ? ` (${r.basis})` : ''}`.replace(/"/g, "'")}"`);
  }
  return lines.join('\n');
}

export function dataDictionary(m: DataModel) {
  return {
    columns: ['Entity', 'Attribute', 'Kind', 'Type', 'Key', 'Formula / rule', 'Value comes from', 'Basis', 'Note'],
    rows: m.entities.flatMap((e) => e.attributes.map((a) => [e.name, a.name, a.kind, a.type, a.pk ? 'PK' : a.fk ? `FK → ${a.fk}` : '', [a.formula, a.rule].filter(Boolean).join(' · '), a.from, a.basis, a.note])),
  };
}

const sqlType = (a: Attribute): [string, boolean] => {
  const t = a.type.toLowerCase();
  if (t) {
    if (/^(int|integer|number|whole)/.test(t)) return ['INTEGER', false];
    if (/dec|money|amount|qty|quantity|float|numeric|percent/.test(t)) return ['DECIMAL(18,4)', false];
    if (/date ?time|timestamp/.test(t)) return ['TIMESTAMP', false];
    if (/date/.test(t)) return ['DATE', false];
    if (/bool|flag|yes/.test(t)) return ['BOOLEAN', false];
    if (/identifier|id$/.test(t)) return ['VARCHAR(50)', false];
    return ['VARCHAR(255)', false];
  }
  const n = a.name.toLowerCase();
  if (/(qty|quantity|rate|value|amount|price|cost|%|percent|factor|cons|weight|ratio)/.test(n)) return ['DECIMAL(18,4)', true];
  if (/date/.test(n)) return ['DATE', true];
  if (a.pk || a.fk || /(code|no|number|id|key)$/.test(n)) return ['VARCHAR(50)', true];
  return ['VARCHAR(255)', true];
};

/** A generic SQL draft. Labelled as a proposal, never as WFX schema. */
export function toDdl(src: DataModel): string {
  const m = src.level === 'captured' ? src : toLogical(src);
  const out = [
    `-- PROPOSED DRAFT – NOT THE WFX DATABASE SCHEMA.`,
    `-- Generated ${today()} by the data modelling studio from "${m.name}" (${m.level}${m.level === 'captured' ? ': screen fields captured from WFX, table and column names are not documented' : ': drafted from a requirement, not reviewed'}).`,
    `-- Types marked "guessed" were chosen from the field name only. Review every line before use.`,
    '',
  ];
  const tables = new Map(m.entities.filter((e) => e.attributes.length).map((e) => [e.id, ident(e.name).toLowerCase()]));
  for (const e of m.entities) {
    if (!e.attributes.length) continue;
    const cols: string[] = []; const used = new Set<string>();
    for (const a of e.attributes) {
      let c = ident(a.name).toLowerCase(), n = 2; const base = c; while (used.has(c)) c = `${base}_${n++}`; used.add(c);
      const [t, guessed] = sqlType(a);
      const comment = [a.basis !== 'documented' ? a.basis : '', a.kind === 'calc' ? `derived${a.formula ? `: ${a.formula}` : ''}` : '', a.kind === 'copied' ? `copy of ${a.from}` : '', guessed ? 'type guessed' : ''].filter(Boolean).join('; ');
      cols.push(`  ${c} ${t}${a.pk && e.attributes.filter((x) => x.pk).length === 1 ? ' PRIMARY KEY' : ''}${a.note === 'required' ? ' NOT NULL' : ''},${comment ? ` -- ${comment.replace(/\n/g, ' ')}` : ''}`);
    }
    const pks = e.attributes.filter((a) => a.pk);
    if (pks.length > 1) cols.push(`  PRIMARY KEY (${pks.map((a) => ident(a.name).toLowerCase()).join(', ')}),`);
    for (const a of e.attributes) {
      if (!a.fk || src.level === 'captured') continue;
      const parent = m.entities.find((x) => x.name.toLowerCase() === a.fk.toLowerCase());
      if (parent && tables.has(parent.id)) cols.push(`  FOREIGN KEY (${ident(a.name).toLowerCase()}) REFERENCES ${tables.get(parent.id)} (${ident(parent.attributes.find((x) => x.pk)?.name ?? 'id').toLowerCase()}),`);
    }
    if (cols.length) cols[cols.length - 1] = cols[cols.length - 1].replace(/,(\s*--|$)/, '$1');
    out.push(`-- ${e.name} (${e.basis})`, `CREATE TABLE ${tables.get(e.id)} (`, ...cols, ');', '');
  }
  if (src.level === 'captured') out.push('-- Links between documents are documented as "value comes from"; the key columns that implement them are not documented, so no FOREIGN KEY is written.');
  return out.join('\n');
}

// ── storage ──────────────────────────────────────────────────────────────────────────────────────────────────────

const flat = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ').trim();

/** A draft model as a MODEL entry (ENTITIES / RELATIONSHIPS lines, the requirement kept as written). */
export function modelToEntry(m: DataModel, author: string): Entry {
  const id = m.id && /^DM-/.test(m.id) && !getEntry(m.id)?.fields['GRIDS'] ? m.id : `DM-DRAFT-${idPart(m.name || 'MODEL')}`;
  const ents: string[] = [];
  for (const e of m.entities) {
    ents.push([flat(e.name), '', 'entity', '', '', '', e.basis, flat(e.note)].join(' | '));
    for (const a of e.attributes) ents.push([flat(e.name), flat(a.name), a.kind, flat(a.type), a.pk ? 'PK' : a.fk ? `FK ${flat(a.fk)}` : '', flat(a.formula), a.basis, flat(a.note)].join(' | '));
  }
  return makeEntry('model', id, {
    'MODEL NAME': m.name || id,
    'MODEL LEVEL': `Proposed ${m.level === 'logical' ? 'logical' : 'conceptual'} model (drafted in the data modelling studio; not WFX database schema)`,
    SUMMARY: m.summary, REQUIREMENT: m.requirement, ENTITIES: ents.join('\n'),
    RELATIONSHIPS: m.relationships.map((r) => [flat(nameOf(m, r.from)), flat(nameOf(m, r.to)), r.cardinality, flat(r.label), r.basis].join(' | ')).join('\n'),
    SOURCE: m.source || `Data modelling studio, ${author}, ${today()}`, VERSION: String(m.version || 1), STATUS: 'Draft', 'CREATED DATE': today(), 'LAST UPDATED': today(),
  });
}

function draftModel(e: EntryRow): DataModel {
  const m: DataModel = { id: e.id, name: e.title, level: /logical/i.test(e.fields['MODEL LEVEL'] ?? '') ? 'logical' : 'conceptual', screen: '', summary: e.fields['SUMMARY'] ?? '', source: e.fields['SOURCE'] ?? '', status: e.status, version: e.version, basisNote: CONFIRMED.includes(e.status) ? 'Approved model (reviewed). It describes a proposed design, not the WFX database schema.' : DRAFT_NOTE, requirement: e.fields['REQUIREMENT'] ?? '', entities: [], relationships: [] };
  const byName = new Map<string, Entity>();
  const get = (n: string) => { let x = byName.get(n.toLowerCase()); if (!x) { x = { id: slug(n), name: n, basis: 'proposed', note: '', attributes: [] }; byName.set(n.toLowerCase(), x); m.entities.push(x); } return x; };
  for (const line of (e.fields['ENTITIES'] ?? '').split('\n')) {
    const p = line.split('|').map((x) => x.trim());
    if (!p[0]) continue;
    const en = get(p[0]);
    if (p[2] === 'entity' || !p[1]) { en.basis = (p[6] as Basis) || 'proposed'; en.note = p[7] ?? ''; continue; }
    const key = p[4] ?? '';
    en.attributes.push(attr(p[1], { kind: (KINDS.includes(p[2] as AttrKind) ? p[2] : 'attribute') as AttrKind, type: p[3] ?? '', pk: key === 'PK', fk: key.startsWith('FK ') ? key.slice(3) : '', formula: p[5] ?? '', basis: (p[6] as Basis) || 'proposed', note: p[7] ?? '' }));
  }
  for (const line of (e.fields['RELATIONSHIPS'] ?? '').split('\n')) {
    const p = line.split('|').map((x) => x.trim());
    if (p.length < 3 || !p[0] || !p[1]) continue;
    m.relationships.push({ from: get(p[0]).id, to: get(p[1]).id, cardinality: (['1:1', '1:N', 'N:1', 'M:N'].includes(p[2]) ? p[2] : '1:N') as Cardinality, label: p[3] ?? '', basis: (p[4] as Basis) || 'proposed' });
  }
  return m;
}

/** Open a stored model (captured or draft), or the map of all captured documents. */
export function openModel(id: string, version?: number): DataModel | null {
  if (id === 'DM-MAP') return capturedMap();
  const e = getEntry(id, version);
  if (!e || e.type !== 'model') return null;
  return e.fields['GRIDS'] !== undefined ? capturedModel(e) : draftModel(e);
}

/** Captured WFX models whose name appears in a draft (so the draft can be compared with what is documented). */
export function capturedMatches(m: DataModel): { entity: string; model: string; title: string }[] {
  const out: { entity: string; model: string; title: string }[] = [];
  const caps = capturedRows();
  for (const e of m.entities) {
    const words = e.name.toLowerCase().split(/\W+/).filter((w) => w.length >= 2);
    // the captured title must be about the same thing: all of the entity's words, and not many more of its own
    const hit = caps.find((c) => { const t = c.title.toLowerCase().split(/\W+/).filter((w) => w.length >= 2); return words.length > 0 && words.every((w) => t.includes(w)) && t.length <= words.length + 1; });
    if (hit) out.push({ entity: e.name, model: hit.id, title: hit.title });
  }
  return out;
}

export function modelView(m: DataModel, view: 'as-is' | 'logical' = 'as-is') {
  const shown = view === 'logical' ? toLogical(m) : m;
  return { model: shown, checks: checkModel(shown), mermaid: toErMermaid(shown), dictionary: dataDictionary(shown), ddl: toDdl(m), matches: m.level === 'captured' ? [] : capturedMatches(m) };
}
