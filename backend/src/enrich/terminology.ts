// WFX terminology dictionary: module, submodule, screen and transaction names, abbreviations the documents spell out,
// glossary terms, aliases the documents state ("Sales Order (Main OC)", "Purchase Order from Buyer (OC)") and the
// language synonym groups. Nothing here is guessed: every row names the entry or chunk it was read from, so two terms
// are only treated as one concept when a document says so.
import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../config.ts';
import { all, run, tx } from '../db.ts';
import { GROUPS, normalize } from '../search/lexicon.ts';

export interface Term { term: string; norm: string; kind: string; canonical: string; module: string; source: string }

/** "Buyer Style Reference (BSR)" or "OC (Order Confirmation)": a name and its abbreviation, either way round. */
const PAREN = /\b([A-Z][\w&/-]*(?: (?:of|from|to|and|on|the|for|[A-Z][\w&/-]*)){0,5}) \(([A-Z][\w&./-]*(?: [A-Za-z][\w&./-]*){0,4})\)/g;

/** True when the abbreviation is made of the name's initials in order ("TNA" ← Time aNd Action, "BSR" ← Buyer Style Reference). */
export function isAcronymOf(abbr: string, name: string): boolean {
  const a = abbr.replace(/[^A-Za-z]/g, '').toUpperCase();
  if (a.length < 2 || a.length > 6 || abbr !== abbr.toUpperCase() || /\s/.test(abbr.trim())) return false;
  const words = name.split(/[\s/-]+/).filter(Boolean);
  if (!words.length || words[0][0].toUpperCase() !== a[0]) return false;
  const significant = words.filter((w) => !/^(of|from|to|and|on|the|for|a|an)$/i.test(w));
  if (significant.length < 2 || significant.length > a.length) return false;
  // every letter of the abbreviation appears in order, and every significant word starts one of them
  let i = 0;
  for (const ch of words.join(' ').toUpperCase()) if (ch === a[i]) i++;
  return i === a.length && significant.every((w) => a.includes(w[0].toUpperCase()));
}

/** Extra aliases a reviewer has confirmed (knowledge/enrichment/terminology.txt: "term | means | source"). */
function curatedAliases(): Term[] {
  const file = path.join(settings().knowledge, 'enrichment', 'terminology.txt');
  if (!fs.existsSync(file)) return [];
  const out: Term[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const [term, means, source, module] = line.split('|').map((x) => x.trim());
    if (!term || !means || !source) continue;
    out.push({ term, norm: normalize(term), kind: 'alias', canonical: normalize(means), module: module ?? '', source: `curated: ${source}` });
  }
  return out;
}

/** Everyday phrasings (knowledge/enrichment/language.txt: "phrase, phrase = word"): English only, never WFX meanings. */
function languageList(): Term[] {
  const file = path.join(settings().knowledge, 'enrichment', 'language.txt');
  if (!fs.existsSync(file)) return [];
  const out: Term[] = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#') || !line.includes('=')) continue;
    const [left, right] = line.split('=');
    const canonical = normalize(right);
    for (const p of left.split(',')) { const n = normalize(p); if (n && canonical) out.push({ term: p.trim(), norm: n, kind: 'language', canonical, module: '', source: 'knowledge/enrichment/language.txt' }); }
  }
  return out;
}

export function buildTerminology(): Term[] {
  const terms: Term[] = [];
  const add = (term: string, kind: string, canonical: string, module: string, source: string) => {
    const n = normalize(term);
    if (!n || n.length < 2 || n.split(' ').length > 8) return;
    // "BOM (Bill of Materials)": the text normaliser already reads both as "bom", so it is not an extra alias
    if (kind === 'alias' && normalize(canonical) === n) return;
    terms.push({ term: term.trim(), norm: n, kind, canonical: normalize(canonical) || n, module, source });
  };
  const rows = all<{ id: string; type: string; title: string; module: string | null; submodule: string | null; txn: string | null; fields: string }>(
    'SELECT id, type, title, module, submodule, txn, fields FROM entries WHERE is_current = 1');
  for (const r of rows) {
    const f = (JSON.parse(r.fields) as { fields: Record<string, string> }).fields;
    const mod = r.module ?? '';
    if (mod) add(mod, 'module', mod, mod, `entry:${r.id}`);
    if (r.submodule) add(r.submodule.replace(/\s*\(.*?\)/g, ''), 'submodule', r.submodule.replace(/\s*\(.*?\)/g, ''), mod, `entry:${r.id}`);
    if (r.type === 'term') add(r.title.replace(/\s*\(.*?\)/g, ''), 'term', r.title.replace(/\s*\(.*?\)/g, ''), mod, `entry:${r.id}`);
    if (r.type === 'transaction') {
      add(r.title.replace(/\s*\(.*?\)/g, ''), 'transaction', r.title.replace(/\s*\(.*?\)/g, ''), mod, `entry:${r.id}`);
      if (f['SLUG']) add(f['SLUG'].replace(/-/g, ' '), 'transaction', r.title.replace(/\s*\(.*?\)/g, ''), mod, `entry:${r.id}`);
    }
    for (const key of ['SCREEN / LOCATION', 'WHERE IN WFX', 'NAVIGATION PATH']) {
      const v = f[key];
      if (!v) continue;
      for (const pathText of v.split(/;|,(?![^(]*\))/)) {
        const parts = pathText.split(/›|>|→/).map((x) => x.trim()).filter(Boolean);
        const last = parts[parts.length - 1];
        if (last && last.split(' ').length <= 5) add(last, 'screen', last, mod, `entry:${r.id} ${key}`);
      }
    }
    // documented other names: "Name (Other Name)"
    const text = Object.entries(f).filter(([k]) => !['SOURCE', 'SOURCE DOCUMENT', 'VERSION', 'STATUS', 'CREATED DATE', 'LAST UPDATED'].includes(k)).map(([, v]) => v).join('\n');
    for (const m of `${r.title}\n${text}`.matchAll(PAREN)) {
      const [name, other] = [m[1].trim(), m[2].trim()];
      // only an abbreviation spelled by the name's last words counts ("Raw Material Purchase Order (RMPO)");
      // "Sales Order (Main OC)" or "INR (value)" are not abbreviations and need a reviewer (terminology.txt)
      const words = name.split(' ');
      for (let k = Math.min(words.length, 6); k >= 2; k--) {
        const cand = words.slice(-k).join(' ');
        if (isAcronymOf(other, cand)) { add(other, 'alias', cand, mod, `entry:${r.id}`); break; }
      }
      if (isAcronymOf(name, other)) add(name, 'alias', other, mod, `entry:${r.id}`);
    }
  }
  for (const r of all<{ abbr: string; expansion: string; source: string }>('SELECT abbr, expansion, source FROM abbreviations')) add(r.abbr, 'abbreviation', r.expansion, '', r.source);
  for (const t of curatedAliases()) terms.push(t);
  for (const t of languageList()) terms.push(t);
  for (const g of GROUPS) for (const w of g) add(w, 'synonym', g[0], '', 'language synonym group (lexicon.ts)');
  // one row per (term, kind, canonical)
  const seen = new Set<string>();
  return terms.filter((t) => { const k = `${t.norm}|${t.kind}|${t.canonical}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

export function storeTerminology(terms: Term[]): void {
  tx(() => {
    run('DELETE FROM kn_terms');
    for (const t of terms) run('INSERT OR IGNORE INTO kn_terms (term, norm, kind, canonical, module, source) VALUES (?, ?, ?, ?, ?, ?)', t.term, t.norm, t.kind, t.canonical, t.module, t.source);
  });
}

/** norm phrase → concept keys it names (an abbreviation with two documented meanings keeps both). */
export interface Concepts { map: Map<string, Set<string>>; maxLen: number }
export function conceptMap(terms: Term[]): Concepts {
  const map = new Map<string, Set<string>>();
  const link = (a: string, b: string) => { if (!map.has(a)) map.set(a, new Set()); map.get(a)!.add(b); };
  for (const t of terms) {
    if (!['alias', 'abbreviation', 'synonym', 'language'].includes(t.kind)) continue;
    const key = `c:${t.canonical}`;
    link(t.norm, key);
    link(t.canonical, key);
  }
  let maxLen = 1;
  for (const k of map.keys()) maxLen = Math.max(maxLen, k.split(' ').length);
  return { map, maxLen: Math.min(maxLen, 6) };
}
