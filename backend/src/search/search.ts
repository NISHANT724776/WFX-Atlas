// Hybrid retrieval over the index: question units (phrases and words) → spelling fix → synonyms and documented
// abbreviations → FTS5 BM25 candidates → re-rank by coverage of the question, title coverage, entry kind fitting the
// question type, and knowledge status. Also reports the question words the knowledge never mentions.
import { all, get } from '../db.ts';
import { detectIntent, editDistance, FILLER, INTENT_WORDS, KIND_FIT, normalize, stem, STOP, synonyms } from './lexicon.ts';
import type { Intent } from './lexicon.ts';
import { matchQuestion } from '../enrich/match.ts';
import type { UnitMatch } from '../enrich/match.ts';

export interface Unit { text: string; alts: string[][]; df: number; idf: number; known: boolean; corrected?: string }
export interface Hit {
  id: number; ref: string; kind: string; title: string; heading: string; text: string; module: string | null; txn: string | null;
  status: string; sourceLabel: string; docId: string | null; docVersion: number | null; entryId: string | null; entryVersion: number | null;
  locator: string | null; isCurrent: boolean; score: number; coverage: number; titleCoverage: number; matched: string[]; missing: string[];
  /** Set when the question mapping (semantic match on question variations) pointed at this entry. */
  mapped?: { unitId: string; score: number; via: string };
}
export interface SearchOptions { /** Include the admin directory (users and roles). Only set for an administrator. */ includeAdmin?: boolean; /** Conversation topic for context-aware mapping. */ context?: { text: string; module?: string }; /** false = keyword ranking only. */ mapping?: boolean; entriesOnly?: boolean; limit?: number; kinds?: string[]; module?: string; includeHistory?: boolean; docId?: string; entryId?: string; intent?: Intent }
export interface SearchResult { intent: Intent; units: Unit[]; hits: Hit[]; unknownUnits: string[]; corrections: Record<string, string>; mapping?: UnitMatch[] }

interface Cache { vocab: Map<string, number>; n: number; abbr: Map<string, string[]>; expansions: Map<string, string>; phrases: Set<string> }
let cache: Cache | null = null;
export function resetSearchCache(): void { cache = null; }

function load(): Cache {
  if (cache) return cache;
  const vocab = new Map(all<{ word: string; df: number }>('SELECT word, df FROM vocab').map((r) => [r.word, Number(r.df)]));
  const n = Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM chunks WHERE is_current = 1')?.n ?? 0) || 1;
  const abbr = new Map<string, string[]>();
  const expansions = new Map<string, string>();
  for (const r of all<{ abbr: string; expansion: string }>('SELECT abbr, expansion FROM abbreviations')) {
    abbr.set(r.abbr, [...(abbr.get(r.abbr) ?? []), normalize(r.expansion)]);
    expansions.set(normalize(r.expansion), r.abbr);
  }
  // known multi-word terms: glossary terms, transaction, field and rule names, documented expansions
  const phrases = new Set<string>();
  for (const r of all<{ title: string }>("SELECT DISTINCT title FROM entries WHERE is_current = 1 AND type IN ('term', 'transaction', 'field', 'rule', 'module')")) {
    // "Loss %" is the term "loss": the full-text index has no token for "%"
    const p = normalize(r.title.replace(/\s*\(.*?\)\s*/g, ' ').replace(/\s+–.*$/, '').replace(/%/g, ' '));
    const w = p.split(' ').filter(Boolean);
    if (w.length >= 2 && w.length <= 5) phrases.add(w.join(' '));
  }
  for (const e of expansions.keys()) if (e.split(' ').length >= 2) phrases.add(e);
  // two- and three-word phrases that recur in several entry titles ("purchase order", "sales order") become one unit
  const grams = new Map<string, number>();
  for (const r of all<{ title: string }>('SELECT DISTINCT title FROM entries WHERE is_current = 1')) {
    const w = normalize(r.title.replace(/\s*\(.*?\)\s*/g, ' ')).split(' ').filter((x) => x && !STOP.has(x));
    for (let n = 2; n <= 3; n++) for (let i = 0; i + n <= w.length; i++) { const g = w.slice(i, i + n).join(' '); grams.set(g, (grams.get(g) ?? 0) + 1); }
  }
  for (const [g, n] of grams) if (n >= 2 && !g.split(' ').some((x) => /^\d+$/.test(x) || x.length < 2)) phrases.add(g);
  cache = { vocab, n, abbr, expansions, phrases };
  return cache;
}

/** Document frequency of a word or phrase; small connecting words ("to", "of") are not in the vocabulary and do not count. */
const dfOf = (c: Cache, words: string[]) => {
  const content = words.filter((w) => w.length >= 3 && !STOP.has(w));
  return content.length ? Math.min(...content.map((w) => c.vocab.get(w) ?? 0)) : words.some((w) => c.vocab.has(w)) ? 1 : 0;
};

/** Fixes a misspelt word against the knowledge's own words (close matches only). */
export function correctWord(w: string): string {
  const c = load();
  if (c.vocab.has(w) || w.length < 4 || /\d/.test(w) || STOP.has(w)) return w;
  const max = w.length >= 8 ? 2 : 1;
  let best = w, bestD = max + 1, bestDf = 0;
  for (const [v, df] of c.vocab) {
    if (v[0] !== w[0] || Math.abs(v.length - w.length) > max) continue;
    const d = editDistance(w, v, max);
    if (d <= max && (d < bestD || (d === bestD && df > bestDf))) { best = v; bestD = d; bestDf = df; }
  }
  return best;
}

/** Splits a question into units: known phrases first, then the remaining topic words. */
export function questionUnits(question: string): { units: Unit[]; corrections: Record<string, string> } {
  const c = load();
  const corrections: Record<string, string> = {};
  const raw = normalize(question).split(' ').filter(Boolean);
  const fixed = raw.map((w) => {
    const f = correctWord(w);
    if (f !== w) corrections[w] = f;
    return f;
  });
  const used = new Array(fixed.length).fill(false);
  const units: Unit[] = [];
  const mkUnit = (text: string, altsRaw: string[]): Unit => {
    const alts = [...new Set(altsRaw)].map((a) => a.split(' ').filter(Boolean));
    const dfs = alts.map((a) => dfOf(c, a));
    const df = Math.max(...dfs, 0);
    return { text, alts, df, idf: Math.log(1 + c.n / (df + 1)), known: dfs.some((d) => d > 0) };
  };
  // phrases, longest first
  for (let len = 5; len >= 2; len--) {
    for (let i = 0; i + len <= fixed.length; i++) {
      if (used.slice(i, i + len).some(Boolean)) continue;
      const p = fixed.slice(i, i + len).join(' ');
      // "%" (read as "percentage") is not indexed, so it never joins a phrase: "loss %" is the term "loss"
      if (!c.phrases.has(p) || fixed.slice(i, i + len).some((w) => w === 'percentage' || w === 'percent' || w === 'pct')) continue;
      const alts = [p];
      const ab = c.expansions.get(p);
      if (ab) alts.push(ab);
      for (const syn of synonyms(p)) alts.push(syn);
      units.push(mkUnit(p, alts));
      for (let k = i; k < i + len; k++) used[k] = true;
    }
  }
  fixed.forEach((w, i) => {
    if (used[i] || STOP.has(w) || FILLER.has(w) || INTENT_WORDS.has(w) || w.length < 2 || /^\d+$/.test(w)) return;
    const alts = [w, ...synonyms(w), ...(c.abbr.get(w) ?? [])];
    const ab = c.expansions.get(w);
    if (ab) alts.push(ab);
    const u = mkUnit(w, alts);
    if (corrections[raw[i]]) u.corrected = raw[i];
    if (!units.some((x) => x.text === w)) units.push(u);
  });
  // article / document codes such as N-8, NIS-58, PPM-000735
  for (const m of question.matchAll(/\b([A-Za-z]{1,5})-(\d{1,6})\b|\b([A-Z]{1,5})(\d{1,6})\b/g)) {
    const t = `${(m[1] ?? m[3]).toLowerCase()} ${m[2] ?? m[4]}`;
    if (units.some((u) => u.text === t)) continue;
    // codes are short tokens the word vocabulary skips: ask the full-text index whether they occur
    const n = Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM (SELECT 1 FROM chunks_fts WHERE chunks_fts MATCH ? LIMIT 50)', `"${t}"`)?.n ?? 0);
    units.push({ text: t, alts: [t.split(' ')], df: n, idf: Math.log(1 + c.n / (n + 1)), known: n > 0 });
    // the code's own pieces ("n", "8") are not separate topic words
    for (let k = units.length - 2; k >= 0; k--) if (t.split(' ').includes(units[k].text)) units.splice(k, 1);
  }
  return { units, corrections };
}

/** Question-mapping thresholds (tuned on tests/retrieval/so-paraphrase-set.json, checked against the not-documented set). */
const envNum = (k: string, d: number) => (process.env[k] ? Number(process.env[k]) : d);
const MAP_MIN = envNum('WFX_MAP_MIN', 0.3), MAP_ADD = envNum('WFX_MAP_ADD', 0.4), MAP_STRONG = envNum('WFX_MAP_STRONG', 0.55), MAP_COVERAGE = envNum('WFX_MAP_COVERAGE', 0.6), MAP_WEIGHT = envNum('WFX_MAP_WEIGHT', 0.6), MAP_FLOOR = envNum('WFX_MAP_FLOOR', 0.2);
const ftsQuote = (alt: string[]) => `"${alt.join(' ').replace(/"/g, '')}"`;
const STATUS_FACTOR: Record<string, number> = { Active: 1, Approved: 1, 'source-documented': 1, reference: 0.85, 'Under Review': 0.9, Draft: 0.88, proposed: 0.9, unreviewed: 0.88 };

export function search(question: string, opts: SearchOptions = {}): SearchResult {
  const intent = opts.intent ?? detectIntent(question);
  const { units, corrections } = questionUnits(question);
  const known = units.filter((u) => u.known);
  // semantic question mapping (knowledge enrichment): only for open questions, not for the internal filtered lookups
  const useMap = opts.mapping !== false && process.env['WFX_MAPPING'] !== '0' && !opts.kinds?.length && !opts.docId && !opts.entryId && !opts.module && !opts.includeHistory;
  const mapping = useMap ? matchQuestion(question, { contextText: opts.context?.text, contextModule: opts.context?.module, limit: 5 }) : [];
  if (!known.length && !mapping.some((m) => m.score >= MAP_STRONG)) return { intent, units, hits: [], unknownUnits: units.map((u) => u.text), corrections, mapping };
  const match = known.flatMap((u) => u.alts.filter((a) => a.every((w) => w.length > 1)).map(ftsQuote)).join(' OR ');
  const where: string[] = ['chunks_fts MATCH ?'];
  const params: unknown[] = [match];
  if (!opts.includeHistory) where.push('c.is_current = 1');
  if (opts.kinds?.length) { where.push(`c.kind IN (${opts.kinds.map(() => '?').join(',')})`); params.push(...opts.kinds); }
  if (opts.module) { where.push('c.module = ?'); params.push(opts.module); }
  if (!opts.includeAdmin) where.push("c.kind <> 'admin_user'");
  if (opts.entriesOnly) where.push('c.entry_id IS NOT NULL');
  if (opts.docId) { where.push('c.doc_id = ?'); params.push(opts.docId); }
  if (opts.entryId) { where.push('c.entry_id = ?'); params.push(opts.entryId); }
  const rows = known.length && match ? all<Record<string, unknown>>(
    `SELECT c.*, bm25(chunks_fts, 10.0, 4.0, 1.0) AS bm FROM chunks_fts JOIN chunks c ON c.id = chunks_fts.rowid
     WHERE ${where.join(' AND ')} ORDER BY bm LIMIT 120`, ...params) : [];
  // entries the mapping points at but the keyword search did not find: their first current chunk joins the candidates
  const boost = new Map<string, { score: number; unitId: string; via: string }>();
  for (const m of mapping) {
    if (m.score < MAP_MIN) continue;
    m.entryIds.forEach((e, i) => { const w = m.score * (i === 0 ? 1 : 0.97); if ((boost.get(e)?.score ?? 0) < w) boost.set(e, { score: w, unitId: m.unitId, via: m.viaQuestion }); });
  }
  const have = new Set(rows.map((r) => r['entry_id']).filter(Boolean));
  for (const [e, b] of boost) {
    if (have.has(e) || b.score < MAP_ADD) continue;
    const r = get<Record<string, unknown>>("SELECT c.*, 0 AS bm FROM chunks c WHERE c.entry_id = ? AND c.is_current = 1 AND c.kind <> 'admin_user' ORDER BY c.id LIMIT 1", e);
    if (r) rows.push(r);
  }
  const minBm = Math.min(...rows.map((r) => Number(r['bm'])), -1e-9);
  const totalIdf = known.reduce((a, u) => a + u.idf, 0) || 1;
  const fit = KIND_FIT[intent];
  const hits: Hit[] = rows.map((r) => {
    const title = String(r['title']), heading = String(r['heading'] ?? ''), text = String(r['text']);
    const toks = new Set(normalize(`${title} ${heading} ${text}`).split(' ').map(stem));
    const ttoks = new Set(normalize(`${title} ${heading}`).split(' ').map(stem));
    const has = (set: Set<string>, u: Unit) => u.alts.some((a) => a.every((w) => set.has(stem(w))));
    const matched = known.filter((u) => has(toks, u));
    const titled = known.filter((u) => has(ttoks, u));
    const coverage = matched.reduce((a, u) => a + u.idf, 0) / totalIdf;
    const titleCoverage = titled.reduce((a, u) => a + u.idf, 0) / totalIdf;
    const kind = String(r['kind']);
    const idx = fit.indexOf(kind);
    const kindFit = idx < 0 ? 0.3 : Math.max(0.3, 1 - idx * 0.12);
    const bm25n = Number(r['bm']) / minBm;
    const status = String(r['status']);
    // how much of the title is about the question ("What is BOM?" prefers a title that IS "BOM")
    const titleWords = normalize(title.replace(/\s*\(.*?\)/g, '')).split(' ').filter((w) => w && !STOP.has(w) && !FILLER.has(w));
    const unitStems = new Set(known.flatMap((u) => u.alts.flat().map(stem)));
    const titlePrecision = titleWords.length ? titleWords.filter((w) => unitStems.has(stem(w))).length / titleWords.length : 0;
    const nTitle = normalize(title);
    const typeBonus = (intent === 'why' && /\bwhy\b|\breason/.test(nTitle)) || (intent === 'whatif' && /what happens|\bif\b/.test(nTitle)) || (intent === 'howto' && /^how\b/.test(nTitle)) ? 0.08 : 0;
    const curated = r['entry_id'] ? 0.05 : 0;
    // low-information chunks (a bare value such as "15,000 per KG") rank lower
    const thin = text.replace(/\s+/g, ' ').trim().length < 60 ? 0.85 : 1;
    const precisionWeight = intent === 'definition' || intent === 'compare' || intent === 'general' ? 0.15 : 0.06;
    const keywordScore = (0.5 * coverage + 0.2 * titleCoverage + 0.15 * bm25n + 0.15 * kindFit + precisionWeight * titlePrecision + typeBonus + curated) * (STATUS_FACTOR[status] ?? 0.9) * thin;
    // hybrid: the mapping score lifts the entry it points at; a strong mapping also counts as covering the question
    const b = r['entry_id'] ? boost.get(String(r['entry_id'])) : undefined;
    const score = keywordScore + (b ? MAP_WEIGHT * Math.max(0, b.score - MAP_FLOOR) * (STATUS_FACTOR[status] ?? 0.9) : 0);
    const mappedCoverage = b && b.score >= MAP_STRONG ? Math.max(coverage, MAP_COVERAGE) : coverage;
    return {
      id: Number(r['id']), ref: String(r['ref']), kind, title, heading, text, module: (r['module'] as string) ?? null, txn: (r['txn'] as string) ?? null,
      status, sourceLabel: String(r['source_label']), docId: (r['doc_id'] as string) ?? null, docVersion: r['doc_version'] === null ? null : Number(r['doc_version']),
      entryId: (r['entry_id'] as string) ?? null, entryVersion: r['entry_version'] === null ? null : Number(r['entry_version']), locator: (r['locator'] as string) ?? null,
      isCurrent: Number(r['is_current']) === 1, score, coverage: mappedCoverage, titleCoverage, matched: matched.map((u) => u.text), missing: known.filter((u) => !matched.includes(u)).map((u) => u.text),
      ...(b ? { mapped: { unitId: b.unitId, score: b.score, via: b.via } } : {}),
    };
  });
  hits.sort((a, b) => b.score - a.score);
  // one hit per entry (its best chunk) so several chunks of one entry do not crowd out others
  const seen = new Set<string>();
  const unique = hits.filter((h) => {
    const key = h.entryId ? `e:${h.entryId}` : `c:${h.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { intent, units, hits: unique.slice(0, opts.limit ?? 12), unknownUnits: units.filter((u) => !u.known).map((u) => u.text), corrections, mapping };
}
