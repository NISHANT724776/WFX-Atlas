import { COLORS } from './catalog';
import { MANUALS, MANUAL_TABLES } from './manuals';
import { CALCULATIONS } from './calculations';
import { traceColor } from './color-trace';
import { GLOSSARY } from './glossary';
import { TRANSACTIONS } from './transactions';

export type DocType = 'Transaction' | 'Field' | 'Calculation' | 'Case' | 'Term' | 'Colour' | 'Guide';

export interface KDoc {
  id: string;
  type: DocType;
  title: string;
  body: string;
  /** Router link target. */
  link: string[];
  fragment?: string;
  query?: Record<string, string>;
  context: string;
}

export interface Hit {
  doc: KDoc;
  score: number;
  matched: string[];
}

const STOP = new Set('a an and are as at be by for from how i in is it of on or the to what when where which who why with does do this that its into can should will my me we you'.split(' '));

/** Words people use for the same WFX concept. */
const SYNONYMS: Record<string, string[]> = {
  cons: ['consumption'], consumption: ['cons'],
  waste: ['wastage'], wastage: ['waste'],
  shrink: ['shrinkage'], shrinkage: ['shrink'],
  po: ['rmpo', 'purchase', 'order'], rmpo: ['po', 'purchase'],
  oc: ['buyer', 'order', 'confirmation'],
  bbb: ['block', 'booking'], booking: ['bbb', 'block'],
  grn: ['receipt', 'goods'], receipt: ['grn'], received: ['grn', 'receipt'],
  colour: ['color'], color: ['colour'],
  uom: ['unit', 'measure'], unit: ['uom'],
  price: ['rate', 'value', 'cost'], rate: ['price'], cost: ['costing', 'price'],
  fpo: ['factory', 'production'], fppo: ['process', 'factory'],
  mrp: ['requirement', 'planning'], explosion: ['mrp', 'level'],
  stock: ['inventory', 'in-house'], inventory: ['stock'],
  margin: ['profit'], profit: ['margin'],
  calculate: ['formula', 'calculated'], calculated: ['formula'], formula: ['calculated'],
};

const stem = (w: string) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '').replace(/(ing|ed)$/, '');

export function tokens(text: string): string[] {
  return text.toLowerCase().replace(/[^a-z0-9%\-|.]+/g, ' ').split(/\s+/)
    .map((w) => w.replace(/^[.\-|]+|[.\-|]+$/g, ''))
    .filter((w) => w && !STOP.has(w));
}

function buildIndex(): KDoc[] {
  const docs: KDoc[] = [];
  for (const t of TRANSACTIONS) {
    docs.push({ id: `t:${t.slug}`, type: 'Transaction', title: t.name, body: [t.description, ...t.theory, t.screen, ...t.keys.map((k) => `${k.name} ${k.format} ${k.example}`)].join(' '),
      link: ['/theory', t.slug], context: `Step ${t.step} · ${t.module}` });
    for (const g of t.fieldGroups) for (const f of g.fields) {
      docs.push({ id: `f:${t.slug}:${f.name}`, type: 'Field', title: f.name, body: `${f.definition} ${f.fromField ?? ''} ${g.title}`,
        link: ['/theory', t.slug], query: { view: 'fields' }, context: `${t.name} › ${g.title}` });
    }
    for (const c of t.cases) {
      docs.push({ id: `c:${t.slug}:${c.title}`, type: 'Case', title: c.title, body: c.body,
        link: ['/theory', t.slug], query: { view: 'cases' }, context: `${t.name} · ${c.kind}` });
    }
  }
  for (const c of CALCULATIONS) {
    const t = TRANSACTIONS.find((x) => x.slug === c.txn);
    docs.push({ id: `k:${c.id}`, type: 'Calculation', title: c.name, body: `${c.formula} ${c.explanation} ${c.example} ${c.question ?? ''}`,
      link: ['/calculations'], fragment: c.id, context: `${t?.name ?? c.txn} · ${c.status === 'verified' ? 'verified' : 'to confirm'}` });
  }
  for (const g of GLOSSARY) {
    docs.push({ id: `g:${g.slug}`, type: 'Term', title: g.term, body: g.definition, link: ['/glossary'], fragment: g.slug, context: 'Glossary' });
  }
  for (const m of MANUALS) {
    docs.push({ id: `m:${m.table}:${m.topic}`, type: 'Guide', title: m.title, body: [m.content, ...(m.steps ?? []), m.where ?? '', m.notes ?? ''].join(' '),
      link: ['/assistant'], query: { q: m.title }, context: `${MANUAL_TABLES[m.table].areaName} guide · ${m.document}` });
  }
  for (const col of COLORS) {
    const tr = traceColor(col.code)!;
    docs.push({ id: `col:${col.code}`, type: 'Colour', title: `${col.name} (${col.code})`,
      body: `colour color ${col.code} ${col.name} ${tr.alerts.map((a) => a.text).join(' ')} ${tr.stages.filter((s) => s.present).map((s) => s.detail).join(' ')}`,
      link: ['/color-cards', col.card, col.slug], context: 'Colour tracking' });
  }
  return docs;
}

let INDEX: { doc: KDoc; title: string[]; body: string[] }[] | null = null;

export function search(query: string, limit = 8): Hit[] {
  INDEX ??= buildIndex().map((doc) => ({ doc, title: tokens(doc.title).map(stem), body: tokens(doc.body).map(stem) }));
  const raw = tokens(query);
  if (!raw.length) return [];
  const q = raw.map(stem);
  const expanded = new Map<string, number>();
  for (const w of raw) {
    expanded.set(stem(w), 1);
    for (const s of SYNONYMS[w] ?? []) if (!expanded.has(stem(s))) expanded.set(stem(s), 0.5);
  }
  const phrase = raw.join(' ');
  const hits: Hit[] = [];
  for (const e of INDEX) {
    let score = 0;
    const matched: string[] = [];
    for (const [w, weight] of expanded) {
      const inTitle = e.title.filter((x) => x === w || (w.length > 3 && x.startsWith(w))).length;
      const inBody = e.body.filter((x) => x === w || (w.length > 3 && x.startsWith(w))).length;
      if (inTitle || inBody) {
        score += weight * (inTitle * 4 + Math.min(inBody, 4));
        if (weight === 1) matched.push(w);
      }
    }
    if (!score) continue;
    // reward covering more of the question and exact phrase matches
    score *= 0.5 + matched.length / q.length;
    if (e.doc.title.toLowerCase().includes(phrase)) score += 6;
    if (e.doc.type === 'Calculation' && /calculat|formula|how/.test(query.toLowerCase())) score *= 1.3;
    hits.push({ doc: e.doc, score, matched });
  }
  return hits.sort((a, b) => b.score - a.score).slice(0, limit);
}

export function docBody(id: string): KDoc | undefined {
  INDEX ??= buildIndex().map((doc) => ({ doc, title: tokens(doc.title).map(stem), body: tokens(doc.body).map(stem) }));
  return INDEX.find((e) => e.doc.id === id)?.doc;
}
