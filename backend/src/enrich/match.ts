// Semantic question mapping: a user's question → the knowledge units it most likely asks about. Compares the
// question's vector with every stored question variation (rejected ones excluded) and with each unit's own text,
// then blends: best variation 70 %, unit text 30 %. With a conversation topic the question is also read together
// with that topic, and a unit of the topic's module gets a small lift. Used by search() as one more relevance signal
// next to the full-text and keyword ranking, never on its own.
import { all, get } from '../db.ts';
import { conceptMap } from './terminology.ts';
import type { Concepts, Term } from './terminology.ts';
import { enrichVersion } from './pipeline.ts';
import { cosine, features, fromBlob, toVector } from './vectors.ts';

interface UnitRow { id: string; module: string; topic: string; entryIds: string[]; review: string; vec: Float32Array }
interface QRow { unit: string; text: string; vec: Float32Array }
interface Cache { v: number; stamp: string; units: Map<string, UnitRow>; qs: QRow[]; idf: Map<string, number>; fallback: number; concepts: Concepts }
let cache: Cache | null = null;

function load(): Cache | null {
  const stamp = get<{ value: string }>("SELECT value FROM kn_meta WHERE key = 'enriched_at'")?.value ?? '';
  if (!stamp) return null;
  if (cache && cache.v === enrichVersion() && cache.stamp === stamp) return cache;
  const units = new Map<string, UnitRow>();
  for (const r of all<{ id: string; module: string; topic: string; entry_ids: string; review: string; vec: Uint8Array | null }>('SELECT id, module, topic, entry_ids, review, vec FROM kn_units')) {
    if (r.vec) units.set(r.id, { id: r.id, module: r.module, topic: r.topic, entryIds: JSON.parse(r.entry_ids) as string[], review: r.review, vec: fromBlob(r.vec) });
  }
  const qs = all<{ unit_id: string; text: string; vec: Uint8Array | null }>("SELECT unit_id, text, vec FROM kn_questions WHERE status <> 'rejected' AND duplicate_of IS NULL")
    .filter((r) => r.vec).map((r) => ({ unit: r.unit_id, text: r.text, vec: fromBlob(r.vec!) }));
  const idf = new Map(JSON.parse(get<{ value: string }>("SELECT value FROM kn_meta WHERE key = 'idf'")?.value ?? '[]') as [string, number][]);
  const fallback = Number(get<{ value: string }>("SELECT value FROM kn_meta WHERE key = 'fallback_idf'")?.value ?? 5);
  const terms = all<Term>('SELECT term, norm, kind, canonical, module, source FROM kn_terms');
  cache = { v: enrichVersion(), stamp, units, qs, idf, fallback, concepts: conceptMap(terms) };
  return cache;
}
export function resetMatchCache(): void { cache = null; }

export interface UnitMatch { unitId: string; module: string; topic: string; entryIds: string[]; score: number; viaQuestion: string; questionSim: number; unitSim: number; /** score plus half its lead over the next unit: a clear winner counts more than a close call */ confidence: number }

export function matchQuestion(question: string, opts: { contextText?: string; contextModule?: string; limit?: number } = {}): UnitMatch[] {
  const c = load();
  if (!c || !c.units.size) return [];
  const qv = toVector(features(question, c.concepts), c.idf, c.fallback);
  const cv = opts.contextText ? toVector(features(`${question} ${opts.contextText}`, c.concepts), c.idf, c.fallback) : null;
  const best = new Map<string, { sim: number; text: string }>();
  for (const q of c.qs) {
    let s = cosine(qv, q.vec);
    if (cv) s = Math.max(s, 0.92 * cosine(cv, q.vec));
    const b = best.get(q.unit);
    if (!b || s > b.sim) best.set(q.unit, { sim: s, text: q.text });
  }
  const out: UnitMatch[] = [];
  for (const u of c.units.values()) {
    if (u.review === 'insufficient') continue;
    const b = best.get(u.id) ?? { sim: 0, text: '' };
    let us = cosine(qv, u.vec);
    if (cv) us = Math.max(us, 0.92 * cosine(cv, u.vec));
    let score = 0.7 * b.sim + 0.3 * us;
    if (opts.contextModule && u.module === opts.contextModule) score += 0.02;
    out.push({ unitId: u.id, module: u.module, topic: u.topic, entryIds: u.entryIds, score, viaQuestion: b.text, questionSim: b.sim, unitSim: us, confidence: score });
  }
  out.sort((a, b) => b.score - a.score);
  // twins of one entry group (same primary entry, other aspect) are not rivals
  const rival = out.find((m, i) => i > 0 && m.unitId.split('#')[0] !== out[0]?.unitId.split('#')[0]);
  if (out[0]) out[0].confidence = out[0].score + 0.5 * Math.max(0, out[0].score - (rival?.score ?? 0));
  return out.slice(0, opts.limit ?? 5);
}
