// Material for training / grounding an LLM on the WFX knowledge, and the way back in for what an LLM proposes.
//  export → exports/llm-training/:
//    knowledge_corpus.jsonl   every current entry with its status and source (for a vector store / RAG)
//    qa_train.jsonl, qa_validation.jsonl   chat-format question → verified answer pairs from the enrichment
//                             (split by knowledge unit, so validation answers are never seen in training)
//    eval_heldout.jsonl       the evaluation questions (never in training): expected sources and statuses
//    question_prompts.jsonl   one prompt per unit asking an LLM for more user-style questions, grounded in its text
//    README.md                what each file is and how to use it
//  import ← a JSONL of {unit_id, questions:[{text, category}]} written by any LLM: the questions are checked and go to
//    knowledge/enrichment/review.json as unreviewed proposals (origin "llm"); a reviewer approves or rejects them on
//    /question-mapping. Nothing an LLM writes becomes an answer: answers stay the sources' own text.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { settings } from '../config.ts';
import { all, get } from '../db.ts';
import { CONFIRMED } from '../knowledge/txt.ts';
import { normalize } from '../search/lexicon.ts';
import { nowIso } from '../util.ts';
import { readReview, writeReview } from './pipeline.ts';

const SYSTEM = 'You are the WFX ERP assistant. Answer only from the WFX knowledge provided. Be brief and exact. If the knowledge does not cover the question, say so instead of guessing.';
const CATEGORIES = ['direct', 'conversational', 'informal', 'problem', 'process', 'technical', 'terminology', 'short', 'contextual'];
const jsonl = (rows: unknown[]) => rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : '');
/** Stable split by unit: about one unit in ten goes to validation, always the same ones. */
const isValidation = (unitId: string) => crypto.createHash('sha1').update(unitId).digest()[0] < 26;

export interface ExportReport { dir: string; corpus: number; train: number; validation: number; eval: number; prompts: number; skippedDraft: number }

export function exportTraining(opts: { includeDrafts?: boolean; dir?: string } = {}): ExportReport {
  const dir = opts.dir ?? path.join(settings().root, 'exports', 'llm-training');
  fs.mkdirSync(dir, { recursive: true });
  const confirmed = (s: string) => CONFIRMED.includes(s);

  // 1 · corpus: the entries themselves (no users, no conversations)
  const entries = all<{ id: string; type: string; title: string; module: string | null; status: string; file: string; version: number; fields: string }>(
    'SELECT id, type, title, module, status, file, version, fields FROM entries WHERE is_current = 1 ORDER BY id');
  const corpus = entries.filter((e) => opts.includeDrafts || confirmed(e.status)).map((e) => {
    const f = (JSON.parse(e.fields) as { fields: Record<string, string> }).fields;
    const text = Object.entries(f).filter(([k, v]) => v && !['VERSION', 'STATUS', 'CREATED DATE', 'LAST UPDATED'].includes(k)).map(([k, v]) => `${k}: ${v}`).join('\n');
    return { id: e.id, type: e.type, title: e.title, module: e.module, status: e.status, source: `${e.file} v${e.version}`, text };
  });

  // held-out evaluation questions: never written into training or validation (no leakage)
  const heldOut = new Set<string>();
  for (const name of ['eval-set.json', 'so-paraphrase-set.json']) {
    const file = path.join(settings().root, 'tests', 'retrieval', name);
    if (fs.existsSync(file)) for (const c of JSON.parse(fs.readFileSync(file, 'utf8')) as { q: string }[]) heldOut.add(normalize(c.q));
  }
  // 2 · question → answer pairs from the enrichment (rejected and duplicate questions left out)
  const units = all<{ id: string; module: string; topic: string; answer: string; entry_ids: string; entry_status: string; source_ref: string; review: string }>(
    "SELECT id, module, topic, answer, entry_ids, entry_status, source_ref, review FROM kn_units WHERE review <> 'insufficient' ORDER BY id");
  const train: unknown[] = [], validation: unknown[] = [];
  let skippedDraft = 0;
  for (const u of units) {
    if (!opts.includeDrafts && !confirmed(u.entry_status)) { skippedDraft++; continue; }
    const qs = all<{ text: string; category: string; origin: string; status: string }>("SELECT text, category, origin, status FROM kn_questions WHERE unit_id = ? AND status <> 'rejected' AND duplicate_of IS NULL", u.id);
    for (const q of qs) {
      if (heldOut.has(normalize(q.text))) continue;
      const row = {
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: q.text }, { role: 'assistant', content: `${u.answer}\n\nSource: ${u.source_ref}` }],
        metadata: { unit: u.id, module: u.module, entries: JSON.parse(u.entry_ids), category: q.category, origin: q.origin, questionReviewed: q.status === 'approved', unitReview: u.review, knowledgeStatus: u.entry_status },
      };
      (isValidation(u.id) ? validation : train).push(row);
    }
  }

  // 3 · held-out evaluation (never trained on)
  const evalRows: unknown[] = [];
  const evalFile = path.join(settings().root, 'tests', 'retrieval', 'eval-set.json');
  if (fs.existsSync(evalFile)) for (const c of JSON.parse(fs.readFileSync(evalFile, 'utf8')) as { q: string; category: string; source?: string; status: string[] }[]) evalRows.push({ question: c.q, category: c.category, expectedSource: c.source ?? null, expectedStatus: c.status, set: 'eval-set' });
  const paraFile = path.join(settings().root, 'tests', 'retrieval', 'so-paraphrase-set.json');
  if (fs.existsSync(paraFile)) for (const c of JSON.parse(fs.readFileSync(paraFile, 'utf8')) as { q: string; category: string; expect: string[]; context?: string }[]) evalRows.push({ question: c.q, category: c.category, expectedSources: c.expect, context: c.context ?? null, set: 'so-paraphrase' });

  // 4 · prompts asking an LLM for more questions per unit (grounded, no new facts)
  const prompts = units.map((u) => {
    const have = all<{ text: string }>("SELECT text FROM kn_questions WHERE unit_id = ? AND status <> 'rejected'", u.id).map((q) => q.text);
    return {
      unit_id: u.id, module: u.module, topic: u.topic,
      prompt: [
        'You write the questions real WFX ERP users would ask to get the knowledge below. Users are merchandisers, planners, store staff, implementation consultants and QA.',
        'Rules: every question must be answerable from the knowledge text alone; do not add facts, fields, screens or behaviour it does not state; vary the wording (informal, short, problem-oriented, abbreviations a user would type, typos are fine); 8 to 20 questions; no duplicates of the existing ones.',
        `Allowed categories: ${CATEGORIES.join(', ')}.`,
        'Reply with ONE line of JSON only: {"unit_id": "<id>", "questions": [{"text": "...", "category": "..."}]}',
        '', `unit_id: ${u.id}`, `Module: ${u.module}`, `Topic: ${u.topic}`, 'Knowledge:', u.answer, '', 'Existing questions:', ...have.map((h) => `- ${h}`),
      ].join('\n'),
    };
  });

  fs.writeFileSync(path.join(dir, 'knowledge_corpus.jsonl'), jsonl(corpus));
  fs.writeFileSync(path.join(dir, 'qa_train.jsonl'), jsonl(train));
  fs.writeFileSync(path.join(dir, 'qa_validation.jsonl'), jsonl(validation));
  fs.writeFileSync(path.join(dir, 'eval_heldout.jsonl'), jsonl(evalRows));
  fs.writeFileSync(path.join(dir, 'question_prompts.jsonl'), jsonl(prompts));
  fs.writeFileSync(path.join(dir, 'README.md'), readme({ corpus: corpus.length, train: train.length, validation: validation.length, eval: evalRows.length, prompts: prompts.length, includeDrafts: !!opts.includeDrafts }));
  return { dir, corpus: corpus.length, train: train.length, validation: validation.length, eval: evalRows.length, prompts: prompts.length, skippedDraft };
}

export interface ImportReport { added: number; duplicates: number; rejected: { unit: string; text: string; reason: string }[]; units: number }

/** Reads LLM-written questions (JSONL, one object per unit) into the review queue as unreviewed proposals. */
export function importQuestions(text: string, by: string, model = ''): ImportReport {
  const review = readReview();
  const report: ImportReport = { added: 0, duplicates: 0, rejected: [], units: 0 };
  for (const [i, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let o: { unit_id?: string; questions?: { text?: string; category?: string }[] };
    try { o = JSON.parse(line); } catch { report.rejected.push({ unit: '', text: line.slice(0, 80), reason: `line ${i + 1} is not JSON` }); continue; }
    const unit = String(o.unit_id ?? '');
    if (!get('SELECT 1 FROM kn_units WHERE id = ?', unit)) { report.rejected.push({ unit, text: '', reason: 'unknown unit id' }); continue; }
    report.units++;
    const existing = new Set(all<{ norm: string }>('SELECT norm FROM kn_questions WHERE unit_id = ?', unit).map((r) => r.norm));
    const list = (review.manual[unit] ??= []);
    for (const m of list) existing.add(normalize(m.text));
    for (const q of o.questions ?? []) {
      const t = String(q.text ?? '').trim().replace(/\s+/g, ' ');
      if (t.length < 4 || t.length > 200) { report.rejected.push({ unit, text: t, reason: 'length' }); continue; }
      if (/https?:|<[a-z]|\{|\}/i.test(t)) { report.rejected.push({ unit, text: t, reason: 'not a plain question' }); continue; }
      const n = normalize(t);
      if (existing.has(n)) { report.duplicates++; continue; }
      existing.add(n);
      list.push({ text: t, category: CATEGORIES.includes(String(q.category)) ? String(q.category) : 'informal', by, at: nowIso(), origin: 'llm', model });
      report.added++;
    }
  }
  writeReview(review);
  return report;
}

function readme(n: { corpus: number; train: number; validation: number; eval: number; prompts: number; includeDrafts: boolean }): string {
  return `# WFX knowledge — LLM training material

Generated ${nowIso().slice(0, 16).replace('T', ' ')} UTC by \`npm run kb:export-training\`${n.includeDrafts ? ' (drafts included)' : ' (only Approved / Active knowledge)'}. Regenerate after the knowledge changes.

| File | Rows | Use |
| --- | --- | --- |
| knowledge_corpus.jsonl | ${n.corpus} | Every current knowledge entry with status and source. Load into a vector store for retrieval (RAG). |
| qa_train.jsonl | ${n.train} | Chat-format pairs (system / user question / assistant = the source's own text + source). For fine-tuning or few-shot examples. |
| qa_validation.jsonl | ${n.validation} | Same format; whole knowledge units kept out of training, to measure on answers the model has not seen. |
| eval_heldout.jsonl | ${n.eval} | Questions with expected sources and statuses, including questions the knowledge does NOT answer. Never train on these. |
| question_prompts.jsonl | ${n.prompts} | One prompt per knowledge unit asking an LLM for more user-style questions. Run them with any LLM, collect the JSON replies in one .jsonl file, then \`npm run kb:import-questions -- <file> --model <name>\`. They arrive on /question-mapping as unreviewed proposals. |

Metadata on every pair says whether the question was reviewed (\`questionReviewed\`), where it came from (\`origin\`: canonical, template, manual, llm) and the knowledge status. Train first on reviewed questions; keep template/LLM questions that nobody reviewed for retrieval testing until a reviewer approves them.

Recommended order: (1) retrieval over knowledge_corpus.jsonl with the system prompt in the pairs — the assistant already works this way; (2) LLM-written questions → review → \`npm run kb:enrich\` to widen the question mapping; (3) fine-tune only if retrieval is not enough, and measure on eval_heldout.jsonl before and after (correct source, "not documented" where the knowledge has no answer).
`;
}
