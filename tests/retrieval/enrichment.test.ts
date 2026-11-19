// Knowledge enrichment (question mapping) over a sandbox copy: answers are the sources' own words, aliases are real
// abbreviations, re-running creates no duplicates, reviewers' decisions survive a rebuild, a changed source goes back
// to review, and with the mapping on the assistant answers paraphrased Sales Order questions better while the
// original evaluation set keeps every expected source and still gives no confident answer to undocumented questions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sandbox } from '../helpers.ts';

const box = sandbox('copy');
const { indexLibrary } = await import('../../backend/src/index/indexer.ts');
const { reindexDocuments } = await import('../../backend/src/ingest/pipeline.ts');
const { answerQuestion } = await import('../../backend/src/assistant/answer.ts');
const { all, get } = await import('../../backend/src/db.ts');
const { refresh, setQuestion, addQuestion, setUnitReview, unitDetail, summary } = await import('../../backend/src/enrich/review.ts');
const { isAcronymOf } = await import('../../backend/src/enrich/terminology.ts');
const { matchQuestion } = await import('../../backend/src/enrich/match.ts');
const { runParaphraseEval } = await import('../../backend/scripts/eval-paraphrase.ts');
indexLibrary();
await reindexDocuments();
const first = refresh(['Sales Order']);

test('Sales Order is cut into units whose answers are the entries’ own text', () => {
  assert.ok(first.units >= 80, `${first.units} units`);
  assert.deepEqual(first.sourceProblems, []);
  for (const u of all<{ id: string; answer: string; entry_ids: string }>("SELECT id, answer, entry_ids FROM kn_units WHERE module = 'Sales Order'")) {
    assert.ok(u.answer.length > 20, `${u.id} has an answer`);
    assert.ok((JSON.parse(u.entry_ids) as string[]).length >= 1);
  }
  // a rule, its "(action)" twin and the glossary term of the same name are one unit
  const del = unitDetail('RULE-SO-DELIVERY-DELETE#overview')!;
  assert.deepEqual([...del.entry_ids].sort(), ['RULE-SO-ACTION-DELETE-DELIVERY', 'RULE-SO-DELIVERY-DELETE', 'TERM-DELETE-DELIVERY']);
});

test('every unit has a canonical question and no repeated wording', () => {
  const units = all<{ id: string }>("SELECT id FROM kn_units WHERE module = 'Sales Order'");
  for (const { id } of units) {
    const qs = all<{ norm: string; origin: string }>('SELECT norm, origin FROM kn_questions WHERE unit_id = ?', id);
    assert.equal(qs.filter((q) => q.origin === 'canonical').length, 1, `${id} canonical`);
    assert.ok(qs.length >= 3, `${id} has ${qs.length} questions`);
    assert.equal(new Set(qs.map((q) => q.norm)).size, qs.length, `${id} duplicates`);
  }
});

test('questions follow what the source says (no "why can’t I" without a restriction)', () => {
  // Price Per: "never typed on the order" → the problem question is about typing it
  const pp = unitDetail('RULE-SO-PRICE-PER#overview')!.questions.map((q) => q.text);
  assert.ok(pp.includes("Why can't I type price per?"), pp.join(' | '));
  // Export has no restriction in its source: no problem questions
  const ex = unitDetail('RULE-SO-EXPORT#overview')!.questions.filter((q) => q.category === 'problem');
  assert.equal(ex.length, 0, ex.map((q) => q.text).join(' | '));
  // remarks are mandatory for closing an order (the source says so) → asked
  assert.ok(unitDetail('RULE-SO-ORDER-CLOSE#overview')!.questions.some((q) => /remarks mandatory/i.test(q.text)));
});

test('aliases read from documents are real abbreviations of the name', () => {
  for (const t of all<{ term: string; canonical: string; source: string }>("SELECT term, canonical, source FROM kn_terms WHERE kind = 'alias' AND source LIKE 'entry:%'")) {
    const ok = isAcronymOf(t.term, t.canonical) || isAcronymOf(t.canonical.toUpperCase(), t.term);
    assert.ok(ok, `${t.term} → ${t.canonical} (${t.source})`);
  }
  assert.ok(get("SELECT 1 FROM kn_terms WHERE kind = 'alias' AND term = 'BSR'"));
  assert.ok(!get("SELECT 1 FROM kn_terms WHERE kind = 'alias' AND term = 'INR'"), 'a currency in brackets is not an alias');
});

test('running again creates no duplicates and changes nothing', () => {
  const again = refresh(['Sales Order']);
  assert.equal(again.units, first.units);
  assert.equal(again.questions, first.questions);
  assert.equal(again.changedUnits, 0);
});

test('reviewers’ decisions are kept in review.json and survive a rebuild', () => {
  const unit = 'RULE-SO-DELIVERY-DELETE#overview';
  const q = unitDetail(unit)!.questions.find((x) => x.origin === 'template')!;
  setQuestion(unit, q.norm, { status: 'rejected' }, 'tester');
  addQuestion(unit, 'how do I throw away a delivery line', 'informal', 'tester');
  const file = path.join(box.knowledge, 'enrichment', 'review.json');
  assert.ok(fs.existsSync(file));
  refresh(['Sales Order']);
  const d = unitDetail(unit)!;
  assert.equal(d.questions.find((x) => x.norm === q.norm)?.status, 'rejected');
  assert.ok(d.questions.some((x) => x.origin === 'manual' && /throw away a delivery line/.test(x.text)));
  // a rejected question is not used for matching any more
  assert.ok(!matchQuestion(q.text, { limit: 5 }).some((m) => m.viaQuestion === q.text));
});

test('an approved unit whose source text changes goes back to review', () => {
  const unit = 'RULE-SO-EXPORT#overview';
  setUnitReview(unit, 'approved', '', 'tester');
  assert.equal(unitDetail(unit)!.review, 'approved');
  const file = path.join(box.knowledge, 'business_rules', 'sales_rules.txt');
  const text = fs.readFileSync(file, 'utf8');
  fs.writeFileSync(file, text.replace('Exports to Excel only what the list currently shows', 'Exports to Excel exactly what the list currently shows'));
  indexLibrary();
  refresh(['Sales Order']);
  const u = unitDetail(unit)!;
  assert.equal(u.review, 'needs-review');
  assert.match(String(u.review_note), /source changed/);
  fs.writeFileSync(file, text);
  indexLibrary();
  refresh(['Sales Order']);
});

test('summary reports the counts per module', () => {
  const s = summary();
  const so = s.modules.find((m) => m.module === 'Sales Order')!;
  assert.equal(so.enriched, true);
  assert.ok((so.units ?? 0) >= 80 && (so.variations ?? 0) > (so.units ?? 0) * 3 && (so.mapped ?? 0) > 0);
  assert.ok(s.modules.some((m) => !m.enriched), 'other modules are listed as not enriched yet');
});

test('paraphrased Sales Order questions: better than keyword search alone', () => {
  const r = runParaphraseEval(path.join(ROOT, 'tests', 'retrieval', 'so-paraphrase-set.json'));
  // measured 2026-11-19 (answered AND from an expected item): 40/70 without the mapping, 44/70 with it; wrong-source answers 17 → 12
  assert.ok(r.top1 >= 43, `top-1 ${r.top1}/${r.rows.length}`);
  assert.ok(r.wrongConfident <= 13, `answered from a wrong item ${r.wrongConfident}`);
});

test('original evaluation set unchanged with the mapping on: sources, statuses, no hallucination', () => {
  interface Case { q: string; category: string; source?: string; status: string[] }
  const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'retrieval', 'eval-set.json'), 'utf8')) as Case[];
  const failures: string[] = [];
  for (const c of cases) {
    const a = answerQuestion(c.q, { log: false });
    const id = a.sources[0] ? a.sources[0].entryId ?? a.sources[0].docId ?? '' : '';
    if (!c.status.includes(a.status)) failures.push(`${c.q}: status ${a.status}`);
    if (c.source && !id.includes(c.source)) failures.push(`${c.q}: first source ${id}`);
  }
  assert.deepEqual(failures, []);
});
