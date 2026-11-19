// Reviewing the enriched knowledge: per-module counts, unit and question lists, approve / reject / edit / add, and
// regeneration. Every decision is written to knowledge/enrichment/review.json and the module is enriched again, so the
// stored questions, the vectors and the file always agree, and a rebuild from the TXT library keeps the decisions.
import { all, get, run, tx } from '../db.ts';
import { normalize } from '../search/lexicon.ts';
import { nowIso } from '../util.ts';
import { resetMatchCache, matchQuestion } from './match.ts';
import { configuredModules, enrich, readReview, writeReview } from './pipeline.ts';
import { claudeActive } from '../assistant/conversations.ts';
import type { EnrichReport } from './pipeline.ts';

/** Asks every stored question and records where its own unit ranks: 1 means the question maps back correctly. */
export function selfCheck(module?: string, unitId?: string): { checked: number; mapped: number } {
  resetMatchCache();
  const qs = all<{ id: number; unit_id: string; text: string }>(
    `SELECT q.id, q.unit_id, q.text FROM kn_questions q JOIN kn_units u ON u.id = q.unit_id WHERE q.status <> 'rejected' AND q.duplicate_of IS NULL ${module ? 'AND u.module = ?' : ''} ${unitId ? 'AND q.unit_id = ?' : ''}`, ...(module ? [module] : []), ...(unitId ? [unitId] : []));
  let mapped = 0;
  tx(() => {
    for (const q of qs) {
      const m = matchQuestion(q.text, { limit: 10 });
      const own = q.unit_id.split('#')[0];
      const i = m.findIndex((x) => x.unitId === q.unit_id || x.unitId.split('#')[0] === own);
      const rank = i < 0 ? 99 : i + 1;
      if (rank === 1) mapped++;
      run('UPDATE kn_questions SET self_rank = ? WHERE id = ?', rank, q.id);
    }
  });
  return { checked: qs.length, mapped };
}

/** Enrich, then self-check: the full refresh used by the script, the reindex and the review actions. */
export function refresh(modules?: string[], onlyUnit?: string): EnrichReport & { selfCheck: { checked: number; mapped: number } } {
  // the self-rank of untouched questions is kept from the last full check (a review click re-checks its own unit only)
  const kept = new Map(all<{ unit_id: string; norm: string; self_rank: number | null }>('SELECT unit_id, norm, self_rank FROM kn_questions').map((r) => [`${r.unit_id}|${r.norm}`, r.self_rank]));
  const r = enrich(modules);
  resetMatchCache();
  if (onlyUnit) {
    tx(() => { for (const q of all<{ id: number; unit_id: string; norm: string }>('SELECT id, unit_id, norm FROM kn_questions WHERE unit_id <> ?', onlyUnit)) run('UPDATE kn_questions SET self_rank = ? WHERE id = ?', kept.get(`${q.unit_id}|${q.norm}`) ?? null, q.id); });
    return { ...r, selfCheck: selfCheck(undefined, onlyUnit) };
  }
  return { ...r, selfCheck: selfCheck() };
}

export function summary() {
  const mods = all<{ module: string }>('SELECT DISTINCT module FROM kn_units ORDER BY module').map((r) => r.module);
  const enrichedAt = get<{ value: string }>("SELECT value FROM kn_meta WHERE key = 'enriched_at'")?.value ?? null;
  const embedder = get<{ value: string }>("SELECT value FROM kn_meta WHERE key = 'embedder'")?.value ?? null;
  const allModules = all<{ m: string; n: number }>("SELECT module AS m, COUNT(*) AS n FROM entries WHERE is_current = 1 AND module IS NOT NULL AND module <> '' GROUP BY module ORDER BY module");
  const rows = allModules.map(({ m, n }) => {
    if (!mods.includes(m)) return { module: m, entries: n, enriched: false };
    const q = (sql: string) => Number(get<{ n: number }>(sql, m)?.n ?? 0);
    const keywords = new Set(all<{ keywords: string }>('SELECT keywords FROM kn_units WHERE module = ?', m).flatMap((r) => JSON.parse(r.keywords) as string[])).size;
    return {
      module: m, entries: n, enriched: true,
      units: q('SELECT COUNT(*) AS n FROM kn_units WHERE module = ?'),
      canonical: q("SELECT COUNT(*) AS n FROM kn_questions q JOIN kn_units u ON u.id = q.unit_id WHERE u.module = ? AND q.origin = 'canonical'"),
      variations: q("SELECT COUNT(*) AS n FROM kn_questions q JOIN kn_units u ON u.id = q.unit_id WHERE u.module = ? AND q.origin <> 'canonical' AND q.status <> 'rejected'"),
      keywords,
      terms: Number(get<{ n: number }>("SELECT COUNT(*) AS n FROM kn_terms WHERE module = ? OR module = ''", m)?.n ?? 0),
      mapped: q("SELECT COUNT(*) AS n FROM kn_questions q JOIN kn_units u ON u.id = q.unit_id WHERE u.module = ? AND q.self_rank = 1"),
      checked: q("SELECT COUNT(*) AS n FROM kn_questions q JOIN kn_units u ON u.id = q.unit_id WHERE u.module = ? AND q.self_rank IS NOT NULL"),
      toReview: q("SELECT COUNT(*) AS n FROM kn_questions q JOIN kn_units u ON u.id = q.unit_id WHERE u.module = ? AND q.status = 'generated'"),
      misrouted: q("SELECT COUNT(*) AS n FROM kn_questions q JOIN kn_units u ON u.id = q.unit_id WHERE u.module = ? AND q.self_rank > 1"),
      unitsToReview: q("SELECT COUNT(*) AS n FROM kn_units WHERE module = ? AND review = 'needs-review'"),
      insufficient: q("SELECT COUNT(*) AS n FROM kn_units WHERE module = ? AND review = 'insufficient'"),
      approved: q("SELECT COUNT(*) AS n FROM kn_units WHERE module = ? AND review = 'approved'"),
    };
  });
  return { modules: rows, configured: configuredModules(), enrichedAt, embedder, claude: claudeActive() };
}

export function listUnits(module: string, filter = '', text = '') {
  const where = ['module = ?'];
  const params: unknown[] = [module];
  if (['generated', 'approved', 'needs-review', 'insufficient'].includes(filter)) { where.push('review = ?'); params.push(filter); }
  if (filter === 'misrouted') where.push('id IN (SELECT unit_id FROM kn_questions WHERE self_rank > 1)');
  if (filter === 'llm') where.push("id IN (SELECT unit_id FROM kn_questions WHERE origin = 'llm' AND status = 'generated')");
  if (text) { where.push('(topic LIKE ? OR id LIKE ? OR id IN (SELECT unit_id FROM kn_questions WHERE text LIKE ?))'); const t = `%${text}%`; params.push(t, t, t); }
  return all<Record<string, unknown>>(`SELECT id, topic, aspect, canonical_q, confidence, review, review_note, entry_status,
      (SELECT COUNT(*) FROM kn_questions q WHERE q.unit_id = kn_units.id AND q.status <> 'rejected') AS questions,
      (SELECT COUNT(*) FROM kn_questions q WHERE q.unit_id = kn_units.id AND q.self_rank > 1) AS misrouted
      FROM kn_units WHERE ${where.join(' AND ')} ORDER BY topic`, ...params);
}

export interface QuestionRow { id: number; text: string; norm: string; category: string; origin: string; status: string; duplicate_of: string | null; self_rank: number | null }
export interface UnitDetail { id: string; module: string; submodule: string; topic: string; aspect: string; canonical_q: string; answer: string; entry_ids: string[]; screen: string; keywords: string[];
  related_modules: string[]; source_ref: string; entry_status: string; confidence: string; review: string; review_note: string; updated_at: string; questions: QuestionRow[] }

export function unitDetail(id: string): UnitDetail | null {
  const u = get<Record<string, string>>('SELECT id, module, submodule, topic, aspect, canonical_q, answer, entry_ids, screen, keywords, related_modules, source_ref, entry_status, confidence, review, review_note, updated_at FROM kn_units WHERE id = ?', id);
  if (!u) return null;
  const questions = all<QuestionRow>("SELECT id, text, norm, category, origin, status, duplicate_of, self_rank FROM kn_questions WHERE unit_id = ? ORDER BY origin = 'canonical' DESC, category, id", id);
  return { ...(u as unknown as UnitDetail), entry_ids: JSON.parse(u['entry_ids']) as string[], keywords: JSON.parse(u['keywords']) as string[], related_modules: JSON.parse(u['related_modules']) as string[], questions };
}

const moduleOf = (unitId: string) => get<{ module: string }>('SELECT module FROM kn_units WHERE id = ?', unitId)?.module;

export function setQuestion(unitId: string, norm: string, change: { status?: 'approved' | 'rejected' | 'generated'; text?: string }, by: string) {
  const mod = moduleOf(unitId);
  if (!mod) throw new Error('Unknown knowledge unit.');
  const r = readReview();
  const qs = (r.questions[unitId] ??= {});
  const manual = (r.manual[unitId] ?? []).find((m) => normalize(m.text) === norm);
  if (change.status === 'generated') delete qs[norm];
  else {
    const text = change.text?.trim();
    if (manual && text) manual.text = text;
    qs[norm] = { ...(qs[norm] ?? { status: 'approved' }), ...(change.status ? { status: change.status } : {}), ...(text && !manual ? { text } : {}), by, at: nowIso() };
  }
  writeReview(r);
  refresh([mod], unitId);
  return unitDetail(unitId);
}

export function addQuestion(unitId: string, text: string, category: string, by: string) {
  const mod = moduleOf(unitId);
  if (!mod) throw new Error('Unknown knowledge unit.');
  const t = text.trim();
  if (t.length < 3) throw new Error('Write the question.');
  const r = readReview();
  (r.manual[unitId] ??= []).push({ text: t, category: category || 'manual', by, at: nowIso() });
  writeReview(r);
  refresh([mod], unitId);
  return unitDetail(unitId);
}

export function setUnitReview(unitId: string, review: 'approved' | 'needs-review', note: string, by: string) {
  const mod = moduleOf(unitId);
  if (!mod) throw new Error('Unknown knowledge unit.');
  const hash = get<{ source_hash: string }>('SELECT source_hash FROM kn_units WHERE id = ?', unitId)!.source_hash;
  const r = readReview();
  r.units[unitId] = { review, note, by, at: nowIso(), hash };
  writeReview(r);
  refresh([mod], unitId);
  return unitDetail(unitId);
}

/** Regenerate a module's (or every configured module's) units and questions from the current TXT library. */
export function regenerate(module?: string) {
  return refresh(module ? [module] : undefined);
}

/** Which units a question maps to, for the review page's "try a question" box. */
export function tryQuestion(q: string, context?: string) {
  return matchQuestion(q, { contextText: context, limit: 5 }).map((m) => ({ ...m, score: Math.round(m.score * 100) / 100, confidence: Math.round(m.confidence * 100) / 100 }));
}

/** Units of a module's questions that are still unreviewed, for a quick count in the dashboard. */
export const pendingCount = () => Number(get<{ n: number }>("SELECT COUNT(*) AS n FROM kn_questions WHERE status = 'generated'")?.n ?? 0);
