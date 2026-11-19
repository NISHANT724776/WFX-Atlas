// Knowledge enrichment pipeline: entries → units → question variations → duplicate check → source check → store →
// vectors. Repeatable: unit ids are stable (<primary entry>#<aspect>), a unit whose source text changed is rebuilt and
// goes back to review, and reviewers' decisions (knowledge/enrichment/review.json) are applied again on every run, so
// nothing is duplicated and nothing a reviewer did is lost. The TXT library is only read, never written.
//   npm run kb:enrich                      → the modules listed in knowledge/enrichment/config.json
//   npm run kb:enrich -- --module "Sales Order"
import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../config.ts';
import { all, get, run, tx } from '../db.ts';
import { normalize } from '../search/lexicon.ts';
import { nowIso, readJson, writeJson } from '../util.ts';
import { generateQuestions } from './questions.ts';
import { buildTerminology, conceptMap, storeTerminology } from './terminology.ts';
import { buildUnits, loadEntries } from './units.ts';
import type { UnitDraft } from './units.ts';
import { features, idfOf, LOCAL_EMBEDDER, toBlob, toVector } from './vectors.ts';
import type { Features } from './vectors.ts';

export interface Review {
  units: Record<string, { review: 'approved' | 'needs-review'; note?: string; by?: string; at?: string; hash?: string }>;
  questions: Record<string, Record<string, { status: 'approved' | 'rejected'; text?: string; by?: string; at?: string }>>;
  manual: Record<string, { text: string; category: string; by?: string; at?: string }[]>;
}
const enrichDir = () => path.join(settings().knowledge, 'enrichment');
export const reviewFile = () => path.join(enrichDir(), 'review.json');
export function readReview(): Review { const r = readJson<Partial<Review>>(reviewFile(), {}); return { units: r.units ?? {}, questions: r.questions ?? {}, manual: r.manual ?? {} }; }
export function writeReview(r: Review): void { fs.mkdirSync(enrichDir(), { recursive: true }); writeJson(reviewFile(), r); }
export function configuredModules(): string[] { return readJson<{ modules?: string[] }>(path.join(enrichDir(), 'config.json'), {}).modules ?? []; }

export interface EnrichReport { modules: string[]; units: number; questions: number; terms: number; changedUnits: number; duplicates: number; insufficient: number; sourceProblems: string[]; ms: number }

let version = 0;
/** Bumped after every run so the matcher reloads. */
export const enrichVersion = () => version;

export function enrich(modules: string[] = configuredModules()): EnrichReport {
  const t0 = Date.now();
  const moduleNames = all<{ m: string }>("SELECT DISTINCT module AS m FROM entries WHERE is_current = 1 AND module IS NOT NULL AND module <> ''").map((r) => r.m);
  const targets = modules.length ? modules.filter((m) => moduleNames.includes(m)) : [];
  const terms = buildTerminology();
  storeTerminology(terms);
  const concepts = conceptMap(terms);
  const review = readReview();
  const previous = new Map(all<{ id: string; source_hash: string }>('SELECT id, source_hash FROM kn_units').map((r) => [r.id, r.source_hash]));
  const sourceProblems: string[] = [];
  let changed = 0, dups = 0, insufficient = 0;

  const drafts: { u: UnitDraft; qs: { text: string; norm: string; category: string; origin: string; status: string; dup: string | null }[]; reviewState: string; note: string }[] = [];
  for (const mod of targets) {
    const entries = loadEntries(mod);
    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const u of buildUnits(entries, moduleNames)) {
      // source check: every sentence of the answer is the entry's own text
      const bad = u.answerParts.filter((p) => !(byId.get(p.entryId)?.f[p.field] ?? '').replace(/[ \t]+/g, ' ').includes(p.text));
      if (bad.length) sourceProblems.push(`${u.id}: ${bad.map((b) => `${b.entryId}:${b.field}`).join(', ')}`);
      const was = previous.get(u.id);
      if (was !== u.sourceHash) changed++;
      let reviewState = u.confidence === 'low' || bad.length ? 'insufficient' : 'generated';
      let note = bad.length ? 'answer text not found in the source' : u.confidence === 'low' ? 'the source says too little to answer reliably' : '';
      const r = review.units[u.id];
      if (r && reviewState !== 'insufficient') {
        if (r.hash && r.hash !== u.sourceHash) { reviewState = 'needs-review'; note = 'source changed since it was reviewed'; }
        else { reviewState = r.review; note = r.note ?? ''; }
      }
      if (reviewState === 'insufficient') insufficient++;
      const qr = review.questions[u.id] ?? {};
      const qs: { text: string; norm: string; category: string; origin: string; status: string; dup: string | null }[] = generateQuestions(u, terms).map((q) => {
        const norm = normalize(q.text);
        const o = qr[norm];
        return { text: o?.text ?? q.text, norm, category: q.category, origin: q.origin, status: o?.status ?? 'generated', dup: null as string | null };
      });
      for (const m of review.manual[u.id] ?? []) {
        const norm = normalize(m.text);
        if (!qs.some((x) => x.norm === norm)) qs.push({ text: m.text, norm, category: m.category || 'manual', origin: 'manual', status: qr[norm]?.status ?? 'approved', dup: null });
      }
      drafts.push({ u, qs, reviewState, note });
    }
  }
  // the same wording under two units: it stays with the first and is flagged on the other
  const owner = new Map<string, string>();
  for (const d of drafts) for (const q of d.qs) {
    const o = owner.get(q.norm);
    if (o && o !== d.u.id) { q.dup = o; dups++; if (d.reviewState === 'generated') { d.reviewState = 'needs-review'; d.note = d.note || `shares a question with ${o}`; } }
    else owner.set(q.norm, d.u.id);
  }

  // vectors over units and their questions (idf from this corpus; saved for questions asked later)
  const unitDoc = (u: UnitDraft) => `${u.topic} ${u.topic} ${u.answer}`;
  const featsU = drafts.map((d) => features(unitDoc(d.u), concepts));
  const featsQ = drafts.map((d) => d.qs.map((q) => features(`${q.text} ${d.u.topic}`, concepts)));
  const idf = idfOf([...featsU, ...featsQ.flat()]);
  const fallback = Math.log(1 + (featsU.length + featsQ.flat().length || 1));
  const vec = (f: Features) => toBlob(toVector(f, idf, fallback));

  const now = nowIso();
  tx(() => {
    const ids = drafts.map((d) => d.u.id);
    for (const mod of targets) {
      const stale = all<{ id: string }>('SELECT id FROM kn_units WHERE module = ?', mod).map((r) => r.id).filter((id) => !ids.includes(id));
      for (const id of stale) { run('DELETE FROM kn_questions WHERE unit_id = ?', id); run('DELETE FROM kn_units WHERE id = ?', id); }
    }
    drafts.forEach((d, i) => {
      const u = d.u;
      const canonical = d.qs.find((q) => q.origin === 'canonical')?.text ?? d.qs[0]?.text ?? u.topic;
      run(`INSERT INTO kn_units (id, module, submodule, topic, aspect, canonical_q, answer, entry_ids, screen, keywords, related_modules, source_ref, source_hash, entry_status, confidence, review, review_note, vec, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET module = excluded.module, submodule = excluded.submodule, topic = excluded.topic, aspect = excluded.aspect, canonical_q = excluded.canonical_q,
             answer = excluded.answer, entry_ids = excluded.entry_ids, screen = excluded.screen, keywords = excluded.keywords, related_modules = excluded.related_modules,
             source_ref = excluded.source_ref, source_hash = excluded.source_hash, entry_status = excluded.entry_status, confidence = excluded.confidence,
             review = excluded.review, review_note = excluded.review_note, vec = excluded.vec, updated_at = CASE WHEN kn_units.source_hash = excluded.source_hash THEN kn_units.updated_at ELSE excluded.updated_at END`,
        u.id, u.module, u.submodule, u.topic, u.aspect, canonical, u.answer, JSON.stringify(u.entryIds), u.screen, JSON.stringify(keywordsOf(u, concepts.map)), JSON.stringify(u.relatedModules),
        u.sourceRef, u.sourceHash, u.entryStatus, u.confidence, d.reviewState, d.note, vec(featsU[i]), now);
      run('DELETE FROM kn_questions WHERE unit_id = ?', u.id);
      d.qs.forEach((q, j) => run('INSERT OR IGNORE INTO kn_questions (unit_id, text, norm, category, origin, status, duplicate_of, vec) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        u.id, q.text, q.norm, q.category, q.origin, q.status, q.dup, vec(featsQ[i][j])));
    });
    run("INSERT INTO kn_meta (key, value) VALUES ('idf', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify([...idf]));
    run("INSERT INTO kn_meta (key, value) VALUES ('fallback_idf', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", String(fallback));
    run("INSERT INTO kn_meta (key, value) VALUES ('embedder', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", LOCAL_EMBEDDER);
    run("INSERT INTO kn_meta (key, value) VALUES ('enriched_at', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", now);
  });
  version++;
  const questions = Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM kn_questions')?.n ?? 0);
  return { modules: targets, units: drafts.length, questions, terms: terms.length, changedUnits: changed, duplicates: dups, insufficient, sourceProblems, ms: Date.now() - t0 };
}

/** Terms of the dictionary that occur in the unit (shown to reviewers as its keywords). */
function keywordsOf(u: UnitDraft, map: Map<string, Set<string>>): string[] {
  const text = ` ${normalize(`${u.topic} ${u.answer}`)} `;
  const out = new Set<string>([u.topic]);
  for (const k of map.keys()) if (k.length >= 2 && !/^(set|fill|put|use|get|add|make|open|close|order|change|edit)$/.test(k) && text.includes(` ${k} `)) out.add(k);
  return [...out].slice(0, 14);
}
