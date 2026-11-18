// Retrieval and answer evaluation over a sandbox copy of the knowledge: expected sources and statuses, hallucination
// (a confident answer to a question the knowledge does not cover), citation validity, follow-ups, version correctness
// after a rule is superseded, and conflict detection.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sandbox } from '../helpers.ts';

sandbox('copy');
const { indexLibrary } = await import('../../backend/src/index/indexer.ts');
const { reindexDocuments } = await import('../../backend/src/ingest/pipeline.ts');
const { answerQuestion } = await import('../../backend/src/assistant/answer.ts');
const { search } = await import('../../backend/src/search/search.ts');
const { proposeRule, saveDraft, transition } = await import('../../backend/src/rules/rules.ts');
const { serializeEntry } = await import('../../backend/src/knowledge/txt.ts');
indexLibrary();
await reindexDocuments();

interface Case { q: string; category: string; source?: string; status: string[]; calcResult?: number }
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'retrieval', 'eval-set.json'), 'utf8')) as Case[];
const results = cases.map((c) => ({ c, a: answerQuestion(c.q, { log: false }) }));

test('evaluation set: expected status and first source', () => {
  const failures: string[] = [];
  for (const { c, a } of results) {
    const first = a.sources[0];
    const id = first ? first.entryId ?? first.docId ?? '' : '';
    if (!c.status.includes(a.status)) failures.push(`${c.q}: status ${a.status}, expected ${c.status.join('/')}`);
    if (c.source && !id.includes(c.source)) failures.push(`${c.q}: first source ${id || 'none'}, expected ${c.source}`);
  }
  assert.deepEqual(failures, []);
});

test('no confident answer to a question the knowledge does not cover (hallucination rate 0)', () => {
  const bad = results.filter(({ c, a }) => c.category === 'not-documented' && ['confirmed', 'documented', 'provisional'].includes(a.status) && !c.status.includes(a.status));
  assert.deepEqual(bad.map(({ c, a }) => `${c.q} → ${a.status} ${a.title}`), []);
  for (const { c, a } of results.filter((x) => x.c.category === 'not-documented' && x.a.status === 'not-documented')) {
    assert.match(a.sections[0].text ?? '', /does not contain sufficient information/, c.q);
    assert.ok(a.missing.length > 0, `${c.q} says what is missing`);
  }
});

test('citations: every [n] points to a listed source; every source names its file or document', () => {
  for (const { c, a } of results) {
    for (const m of a.markdown.matchAll(/\[(\d+)\]/g)) assert.ok(Number(m[1]) >= 1 && Number(m[1]) <= a.sources.length, `${c.q}: [${m[1]}]`);
    for (const s of a.sources) assert.match(s.label, /knowledge\/|DOC-\d{4}/, `${c.q}: ${s.label}`);
  }
});

test('calculation answers are worked by the engine, not by text', () => {
  for (const { c, a } of results.filter((x) => x.c.calcResult !== undefined)) {
    const calc = a.sections.find((s) => s.kind === 'calculation')?.calc;
    assert.ok(calc, c.q);
    assert.ok(Math.abs((calc!.result ?? NaN) - c.calcResult!) < 1e-8, `${c.q}: ${calc!.result}`);
    assert.ok(calc!.steps.length >= 4);
  }
});

test('follow-ups keep the conversation context: next step, as a workflow, why', () => {
  const first = answerQuestion('How do I create a GDI pick list and GDN from the mobile application?', { log: false });
  assert.ok(first.topic.steps && first.topic.steps.length >= 3, 'the procedure has steps');
  const next = answerQuestion('Now explain the next step.', { context: first.topic, log: false });
  assert.match(next.sections[0].text ?? '', new RegExp(first.topic.steps![1].slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(next.topic.stepIndex, 1);
  const wf = answerQuestion('Show the same process as a workflow.', { context: first.topic, log: false });
  const diagram = wf.sections.find((s) => s.mermaid);
  assert.ok(diagram, 'a Mermaid workflow is produced');
  assert.match(diagram!.mermaid!, /flowchart TD/);
  assert.ok(!/\bend\[/.test(diagram!.mermaid!), 'reserved Mermaid ids are not used');
  const why = answerQuestion('Why is this required?', { context: first.topic, log: false });
  assert.ok(['partial', 'not-documented', 'confirmed', 'documented', 'provisional'].includes(why.status));
  assert.ok(why.resolvedQuestion.length > 'Why is this required?'.length, 'the topic was carried into the question');
});

test('teaching a rule: understood, compared with the stored rule, saved as a new version, activated, old version superseded', () => {
  const p = proposeRule('In RMPO, Open Qty represents the outstanding quantity against the order. The calculation is based on Order Qty minus Received Qty.', 'test');
  assert.equal(p.understanding.transaction, 'RMPO – Raw Material Purchase Order');
  assert.equal(p.understanding.expression, 'open_qty = order_qty - received_qty');
  assert.equal(p.correctionOf, 'CALC-RMPO-OPEN');
  assert.ok(p.understanding.questions[0].includes('correction of CALC-RMPO-OPEN'));
  // the owner confirms it is a correction: same ID, next version
  const draft = { ...p.draft, id: 'CALC-RMPO-OPEN', fields: { ...p.draft.fields, 'RULE ID': 'CALC-RMPO-OPEN', 'RULE NAME': 'Open Qty', 'TEST CASES': 'order_qty=100, received_qty=40 → open_qty=60' } };
  delete (draft.fields as Record<string, string>)['CONFLICT'];
  draft.order = draft.order.filter((k) => k !== 'CONFLICT').concat('TEST CASES');
  const saved = saveDraft(serializeEntry(draft).replace(/^=+\n/, ''), 'test-editor', 'editor', 'owner correction');
  assert.equal(saved.version, 2);
  // while v2 is a draft, answers still use the active v1
  const before = answerQuestion('how is open quantity calculated in RMPO', { log: false });
  assert.match(before.sections[0].text ?? '', /Additional Qty/);
  assert.throws(() => transition('CALC-RMPO-OPEN', 2, 'Active', 'test-editor', 'editor'), /not allowed/);
  const t = transition('CALC-RMPO-OPEN', 2, 'Active', 'test-approver', 'approver', 'approved in test');
  assert.equal(t.superseded, 1);
  const after = answerQuestion('how is open quantity calculated in RMPO', { log: false });
  assert.equal(after.sources[0].entryVersion, 2);
  assert.match(after.sections[0].text ?? '', /Order Qty − Received Qty/);
  assert.equal(after.sections.find((s) => s.kind === 'calculation')?.calc?.result, 60);
  // the superseded version is history: kept, but never retrieved as current logic
  const hist = search('open qty ordered additional shipped', { includeHistory: true, entryId: 'CALC-RMPO-OPEN' }).hits;
  assert.ok(hist.some((h) => h.entryVersion === 1 && !h.isCurrent && h.status === 'Superseded'));
  assert.ok(!search('open qty ordered additional shipped', { entryId: 'CALC-RMPO-OPEN' }).hits.some((h) => h.entryVersion === 1));
});

test('conflict: two active rules giving the same output differently are both shown, status conflicting', () => {
  const p = proposeRule('In GRN, Accepted Qty = Received Qty minus Rejected Qty minus Short Qty.', 'test');
  const text = serializeEntry({ ...p.draft, fields: { ...p.draft.fields, 'RULE ID': 'CALC-GRN-ACCEPTED-ALT', 'RULE NAME': 'Accepted Qty (alternative)' }, id: 'CALC-GRN-ACCEPTED-ALT' }).replace(/^=+\n/, '');
  const s = saveDraft(text, 'test-approver', 'approver');
  transition(s.id, s.version, 'Active', 'test-approver', 'approver');
  const a = answerQuestion('how is accepted qty calculated in GRN', { log: false });
  assert.equal(a.status, 'conflicting');
  assert.ok(a.sections.some((x) => x.kind === 'conflict'));
});
