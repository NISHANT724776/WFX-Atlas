// Understanding a document after extraction: subject, module, transactions, candidate definitions / formulas /
// validations / workflow steps / dependencies / tables, and section-aware chunks with locators.
// Module and transaction detection only uses names that exist in the knowledge base; nothing is invented. Topics that
// match no known module are reported as "unclassified" with the document's own key terms.
import { all } from '../db.ts';
import { normalize, STOP, FILLER } from '../search/lexicon.ts';
import type { DocModel } from './extract.ts';

export interface Candidate { kind: 'definition' | 'formula' | 'validation' | 'workflow_steps' | 'dependency' | 'table' | 'entry'; text: string; locator: string; module?: string | null; txn?: string | null }
export interface DocChunk { title: string; heading: string; text: string; locator: string; kind: string }
export interface Analysis { subject: string; keyTerms: string[]; module: string | null; moduleScores: { module: string; score: number }[]; transactions: string[]; candidates: Candidate[]; chunks: DocChunk[] }

interface Lex { modules: { name: string; terms: string[] }[]; txns: { name: string; id: string; slug: string; terms: string[] }[] }
let lexCache: Lex | null = null;
export function resetAnalyseCache(): void { lexCache = null; }

function lexicon(): Lex {
  if (lexCache) return lexCache;
  const rows = all<{ id: string; type: string; title: string; fields: string }>("SELECT id, type, title, fields FROM entries WHERE is_current = 1 AND type IN ('module', 'transaction')");
  const txns: Lex['txns'] = [];
  for (const r of rows.filter((x) => x.type === 'transaction')) {
    const f = (JSON.parse(r.fields) as { fields: Record<string, string> }).fields;
    const name = r.title;
    const terms = new Set([normalize(name.replace(/\s*\(.*?\)/g, '')), normalize(f['SLUG'] ?? '')]);
    for (const m of name.matchAll(/\(([^)]+)\)/g)) terms.add(normalize(m[1]));
    for (const part of name.split(/\s+[–-]\s+/)) if (part.split(' ').length <= 4) terms.add(normalize(part));
    txns.push({ name, id: r.id, slug: f['SLUG'] ?? '', terms: [...terms].filter((t) => t.length >= 2) });
  }
  // module terms: the parts of the module name plus the names of its own transactions. Description words such as
  // "order" or "task" made unrelated documents look alike, so they are not used.
  const bySlug = new Map(txns.map((t) => [t.slug, t]));
  const GENERIC_PART = new Set(['setup', 'rules', 'setup rules', 'booking', 'style']);
  const modules: Lex['modules'] = [];
  for (const r of rows.filter((x) => x.type === 'module')) {
    const f = (JSON.parse(r.fields) as { fields: Record<string, string> }).fields;
    const terms = new Set<string>();
    for (const part of r.title.split(/\s*[&,]\s*|\s+and\s+/i)) { const n = normalize(part); if (n && !GENERIC_PART.has(n)) terms.add(n); }
    for (const line of (f['TRANSACTIONS'] ?? '').split('\n')) {
      const slug = /\(([a-z0-9-]+)\)\s*$/.exec(line)?.[1];
      const t = slug ? bySlug.get(slug) : undefined;
      for (const x of t?.terms ?? []) if (x.length >= 2) terms.add(x);
    }
    modules.push({ name: r.title, terms: [...terms] });
  }
  lexCache = { modules, txns };
  return lexCache;
}

const count = (hay: string, needle: string) => {
  if (!needle) return 0;
  let n = 0, i = 0;
  const h = ` ${hay} `, x = ` ${needle} `;
  while ((i = h.indexOf(x, i)) >= 0) { n++; i += x.length - 1; }
  return n;
};

const DEF = /^(?:the |an? )?([A-Z][\w /&().'-]{1,60}?)\s+(?:is|are|means|refers to|represents|stands for|is defined as)\s+(.{12,400})$/;
const FORMULA = /(?:[A-Za-z%)]\s*=\s*[A-Za-z(\d])|\b(calculated as|formula|is computed|is derived)\b/i;
const VALID = /\b(must|mandatory|should not|shall not|cannot|can ?not|not allowed|is required|are required|restrict(ed|ion)?|validation|validate[sd]?|only (if|when)|error message|throws? an? (error|alert)|alert message|do not allow|does not allow|block(ed|s)?)\b/i;
const DEPEND = /\b(depends on|dependent on|based on|linked (to|with)|pulled from|flows? (to|into)|created (from|against)|generated (from|against)|triggers?|after the|before the)\b/i;

export function analyse(model: DocModel, title: string): Analysis {
  const lex = lexicon();
  const fullText = normalize([title, ...model.blocks.map((b) => b.text)].join(' '));
  const titleNorm = normalize(title);
  // modules: term hits in the text, title hits weigh more
  const moduleScores = lex.modules.map((m) => ({
    module: m.name,
    score: m.terms.reduce((a, t) => a + Math.min(count(fullText, t), 25) * (t.includes(' ') ? 2 : 1) + count(titleNorm, t) * 8, 0),
  })).sort((a, b) => b.score - a.score);
  const top = moduleScores[0];
  const module = top && top.score >= 6 && top.score >= (moduleScores[1]?.score ?? 0) * 1.25 ? top.module : null;
  const transactions = lex.txns.map((t) => ({ name: t.name, n: t.terms.reduce((a, x) => a + count(fullText, x) + count(titleNorm, x) * 5, 0) }))
    .filter((t) => t.n >= 2).sort((a, b) => b.n - a.n).slice(0, 8).map((t) => t.name);
  // key terms: frequent content words and two-word phrases
  const words = fullText.split(' ').filter((w) => w.length >= 3 && !STOP.has(w) && !FILLER.has(w) && !/^\d+$/.test(w));
  const freq = new Map<string, number>();
  for (let i = 0; i < words.length; i++) {
    freq.set(words[i], (freq.get(words[i]) ?? 0) + 1);
    if (i + 1 < words.length) { const bg = `${words[i]} ${words[i + 1]}`; freq.set(bg, (freq.get(bg) ?? 0) + 1.5); }
  }
  const keyTerms = [...freq.entries()].filter(([, n]) => n >= 3).sort((a, b) => b[1] - a[1]).slice(0, 15).map(([w]) => w);
  const subject = title || keyTerms.slice(0, 4).join(', ');

  // candidates and chunks, walking the blocks with the heading path
  const candidates: Candidate[] = [];
  const chunks: DocChunk[] = [];
  const path: string[] = [];
  let section = 0;
  let buf: string[] = [];
  let bufLoc = '';
  let listRun: string[] = [];
  const sectionLoc = (b: { page?: number; sheet?: string }) => [b.sheet ? `sheet "${b.sheet}"` : '', b.page ? `p. ${b.page}` : '', path.length ? `§ ${path.join(' › ')}` : ''].filter(Boolean).join(', ') || 'start';
  const flushText = () => {
    const text = buf.join('\n').trim();
    if (text) {
      // split long sections into ~1,400-character pieces at paragraph boundaries
      let piece = '';
      let part = 1;
      for (const para of text.split('\n')) {
        if (piece && piece.length + para.length > 1400) { chunks.push({ title: path[path.length - 1] ?? title, heading: path.join(' › '), text: piece, locator: `${bufLoc}${part > 1 ? ` (part ${part})` : ''}`, kind: 'section' }); piece = ''; part++; }
        piece += (piece ? '\n' : '') + para;
      }
      if (piece) chunks.push({ title: path[path.length - 1] ?? title, heading: path.join(' › '), text: piece, locator: `${bufLoc}${part > 1 ? ` (part ${part})` : ''}`, kind: 'section' });
    }
    buf = [];
  };
  const flushList = () => {
    if (listRun.length >= 3) candidates.push({ kind: 'workflow_steps', text: `${path[path.length - 1] ?? title}:\n${listRun.map((s, i) => `${i + 1}. ${s}`).join('\n')}`, locator: bufLoc || 'start', module });
    listRun = [];
  };
  for (const b of model.blocks) {
    if (b.type === 'heading') {
      flushText(); flushList();
      const lvl = Math.max(1, b.level ?? 1);
      path.splice(lvl - 1);
      path[lvl - 1] = b.text;
      for (let i = 0; i < path.length; i++) if (path[i] === undefined) path[i] = '…';
      section++;
      bufLoc = sectionLoc(b);
      continue;
    }
    if (!bufLoc) bufLoc = sectionLoc(b);
    if (b.type === 'table' && b.table !== undefined) {
      flushText(); flushList();
      const t = model.tables[b.table];
      const loc = `${sectionLoc(b)}${sectionLoc(b) === 'start' ? '' : ', '}table ${b.table + 1}`.replace(/^start, /, '');
      chunks.push({ title: `${path[path.length - 1] ?? title} – ${t.name}`, heading: path.join(' › '), text: [`Columns: ${t.headers.map((h, i) => `${h} (${t.types[i]}${t.units[h] ? `, ${t.units[h]}` : ''})`).join('; ')}`, b.text].join('\n'), locator: loc, kind: 'table' });
      // one chunk per row for structured lookup (capped)
      if (t.headers.length >= 2) t.rows.slice(0, 400).forEach((r, i) => {
        const line = t.headers.map((h, j) => (r[j] ? `${h}: ${r[j]}` : '')).filter(Boolean).join('; ');
        if (line.length > 8) chunks.push({ title: `${t.name} row ${i + 1}`, heading: path.join(' › '), text: line, locator: `${loc}, row ${i + 1}`, kind: 'data_row' });
      });
      candidates.push({ kind: 'table', text: `${t.name}: ${t.headers.join(', ')} (${t.rows.length} rows${t.identifiers.length ? `; identifiers: ${t.identifiers.join(', ')}` : ''})`, locator: loc, module });
      continue;
    }
    if (b.type === 'diagram') {
      flushText(); flushList();
      chunks.push({ title: `${path[path.length - 1] ?? title} – diagram`, heading: path.join(' › '), text: b.text, locator: sectionLoc(b), kind: 'diagram' });
      continue;
    }
    if (b.type === 'list') listRun.push(b.text); else flushList();
    buf.push(b.type === 'list' ? `• ${b.text}` : b.text);
    // candidates from sentences
    for (const sentence of b.text.split(/(?<=[.!?])\s+(?=[A-Z])/)) {
      const s = sentence.trim();
      if (s.length < 12 || s.length > 600) continue;
      const loc = sectionLoc(b);
      if (DEF.test(s)) candidates.push({ kind: 'definition', text: s, locator: loc, module });
      if (FORMULA.test(s) && /[A-Za-z]{3}/.test(s)) candidates.push({ kind: 'formula', text: s, locator: loc, module });
      else if (VALID.test(s)) candidates.push({ kind: 'validation', text: s, locator: loc, module });
      if (DEPEND.test(s) && lex.txns.filter((t) => t.terms.some((x) => x.length > 2 && count(normalize(s), x))).length >= 2) candidates.push({ kind: 'dependency', text: s, locator: loc, module });
    }
  }
  flushText(); flushList();
  for (const e of model.entries ?? []) candidates.push({ kind: 'entry', text: Object.entries(e.fields).map(([k, v]) => `${k}: ${v}`).join('\n'), locator: e.id, module });
  if (!chunks.length && model.notes.length) chunks.push({ title, heading: '', text: `${title}. ${model.notes.join(' ')}`, locator: 'file', kind: 'section' });
  // de-duplicate candidates
  const seen = new Set<string>();
  const uniq = candidates.filter((c) => { const k = `${c.kind}|${normalize(c.text)}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 400);
  return { subject, keyTerms, module, moduleScores: moduleScores.slice(0, 4), transactions, candidates: uniq, chunks };
}
