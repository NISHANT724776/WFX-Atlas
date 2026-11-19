// LLM training material and the way back in: export shape and hygiene (no drafts by default, validation units kept
// out of training, held-out evaluation never in the pairs); LLM-written questions arrive as unreviewed proposals,
// are checked, deduplicated and never replace an answer. Also: ready-made workflows do not assume a Buyer Block Booking.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sandbox } from '../helpers.ts';

const box = sandbox('copy');
const { indexLibrary } = await import('../../backend/src/index/indexer.ts');
const { refresh, unitDetail } = await import('../../backend/src/enrich/review.ts');
const { exportTraining, importQuestions } = await import('../../backend/src/enrich/training.ts');
indexLibrary();
refresh(['Sales Order']);
const out = path.join(box.dir, 'export');
const rep = exportTraining({ dir: out });
const lines = (f: string) => fs.readFileSync(path.join(out, f), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

test('export writes corpus, train/validation pairs, held-out eval and prompts', () => {
  for (const f of ['knowledge_corpus.jsonl', 'qa_train.jsonl', 'qa_validation.jsonl', 'eval_heldout.jsonl', 'question_prompts.jsonl', 'README.md']) assert.ok(fs.existsSync(path.join(out, f)), f);
  assert.ok(rep.corpus > 500 && rep.train > 300 && rep.validation > 10 && rep.prompts >= 80, JSON.stringify(rep));
  const pair = lines('qa_train.jsonl')[0];
  assert.deepEqual(pair.messages.map((m: { role: string }) => m.role), ['system', 'user', 'assistant']);
  assert.match(pair.messages[2].content, /Source: /);
});

test('only Approved / Active knowledge by default; validation units never appear in training', () => {
  assert.ok(lines('knowledge_corpus.jsonl').every((e) => ['Approved', 'Active'].includes(e.status)));
  const trainUnits = new Set(lines('qa_train.jsonl').map((p) => p.metadata.unit));
  assert.ok(lines('qa_validation.jsonl').every((p) => !trainUnits.has(p.metadata.unit)));
});

test('held-out evaluation questions are not training questions', () => {
  const asked = new Set([...lines('qa_train.jsonl'), ...lines('qa_validation.jsonl')].map((p) => p.messages[1].content.toLowerCase()));
  const leaked = lines('eval_heldout.jsonl').filter((e) => asked.has(String(e.question).toLowerCase()));
  assert.deepEqual(leaked, []);
});

test('LLM questions come back as unreviewed proposals; bad lines and duplicates are refused', () => {
  const unit = 'RULE-SO-DELIVERY-DELETE#overview';
  const reply = [
    JSON.stringify({ unit_id: unit, questions: [{ text: 'wrongly added a delivery, how to remove it', category: 'informal' }, { text: 'How do I delete the delivery?', category: 'direct' }, { text: 'see https://x.y', category: 'direct' }] }),
    JSON.stringify({ unit_id: 'NOPE#overview', questions: [{ text: 'anything' }] }),
    'not json',
  ].join('\n');
  const r = importQuestions(reply, 'tester', 'test-model');
  assert.equal(r.added, 1);
  assert.equal(r.duplicates, 1, 'an existing question is not added twice');
  assert.equal(r.rejected.length, 3, JSON.stringify(r.rejected));
  refresh(['Sales Order']);
  const q = unitDetail(unit)!.questions.find((x) => x.text === 'wrongly added a delivery, how to remove it')!;
  assert.equal(q.origin, 'llm');
  assert.equal(q.status, 'generated', 'not approved until a reviewer approves it');
  assert.match(unitDetail(unit)!.answer, /Removes one or several ticked deliveries/, 'the answer is still the source text');
});

test('ready-made "Sales Order to factory" has no Buyer Block Booking step; module shortcuts do not add one', () => {
  const root = path.resolve(import.meta.dirname, '..', '..');
  const catalog = fs.readFileSync(path.join(root, 'src', 'app', 'data', 'catalog.ts'), 'utf8');
  const so = catalog.match(/slug: 'sales-order'[\s\S]*?steps: \[([^\]]*)\]/);
  assert.ok(so, 'the sales-order preset lists its steps');
  assert.ok(!/bbb|'link'|'adjust'|so-updated|gen-indent|adhoc/.test(so![1]), so![1]);
  assert.ok(catalog.indexOf("slug: 'block-booking'") > catalog.indexOf("slug: 'sales-order'"), 'booking is not the first, default workflow');
  const modules = fs.readFileSync(path.join(root, 'src', 'app', 'data', 'modules.ts'), 'utf8');
  for (const m of modules.matchAll(/\{ id: '([a-z-]+)'[\s\S]*?steps: \[([^\]]*)\]/g)) {
    if (m[1] === 'booking') continue;
    assert.ok(!/bbb|'link'|'adjust'|so-updated/.test(m[2]), `${m[1]}: ${m[2]}`);
  }
});

test('Claude in Atlas: its questions become unreviewed proposals; bad replies and refusals are reported, not stored', async () => {
  const { claudeQuestions } = await import('../../backend/src/enrich/training.ts');
  const replies: Record<string, unknown> = {
    'RULE-SO-ORDER-CLOSE#overview': { stop_reason: 'end_turn', usage: { input_tokens: 400, output_tokens: 80 }, content: [{ type: 'text', text: '{"unit_id": "SOMETHING-ELSE", "questions": [{"text": "cant close a cancelled OC why", "category": "problem"}, {"text": "How do I close the sales order?", "category": "direct"}]}' }] },
    'RULE-SO-EXPORT#overview': { stop_reason: 'end_turn', usage: { input_tokens: 300, output_tokens: 10 }, content: [{ type: 'text', text: 'Sorry, here are some ideas' }] },
    'RULE-SO-KIT#overview': { stop_reason: 'refusal', usage: { input_tokens: 1, output_tokens: 1 }, content: [] },
  };
  const asked: string[] = [];
  const client = { beta: { messages: { create: async (req: { messages: { content: string }[] }) => {
    const id = /unit_id: (\S+)/.exec(req.messages[0].content)![1];
    asked.push(id);
    assert.match(req.messages[0].content, /do not add facts/, 'the prompt forbids new facts');
    return replies[id];
  } } } };
  const r = await claudeQuestions(Object.keys(replies), 'tester', client as never, 'claude-test');
  assert.deepEqual(asked.sort(), Object.keys(replies).sort());
  assert.equal(r.added, 1, 'the new question; the existing one is a duplicate');
  assert.equal(r.duplicates, 1);
  assert.equal(r.failed.length, 2, JSON.stringify(r.failed));
  assert.equal(r.tokens, 400 + 80 + 300 + 10 + 2);
  refresh(['Sales Order']);
  const q = unitDetail('RULE-SO-ORDER-CLOSE#overview')!.questions.find((x) => x.text === 'cant close a cancelled OC why')!;
  assert.ok(q, 'stored on the unit that was asked, whatever unit id the reply names');
  assert.equal(q.origin, 'llm');
  assert.equal(q.status, 'generated');
});
