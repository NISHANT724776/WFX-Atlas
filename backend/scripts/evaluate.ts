// Knowledge evaluation: runs tests/retrieval/eval-set.json against the index and writes documentation/KNOWLEDGE_EVALUATION.md
// with retrieval accuracy, status accuracy, hallucination rate, citation validity and per-question results.
//   npm run kb:evaluate
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.ts';
import { answerQuestion } from '../src/assistant/answer.ts';

interface Case { q: string; category: string; source?: string; status: string[]; calcResult?: number }
const cases = JSON.parse(fs.readFileSync(path.join(ROOT, 'tests', 'retrieval', 'eval-set.json'), 'utf8')) as Case[];
const rows = cases.map((c) => {
  const a = answerQuestion(c.q, { log: false });
  const first = a.sources[0];
  const id = first ? first.entryId ?? first.docId ?? '' : '';
  const sourceOk = !c.source || id.includes(c.source);
  const statusOk = c.status.includes(a.status);
  const citations = [...a.markdown.matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
  const citationsOk = citations.every((n) => n >= 1 && n <= a.sources.length);
  const hallucination = c.category === 'not-documented' && ['confirmed', 'documented', 'provisional'].includes(a.status) && !c.status.includes(a.status);
  return { c, a, id, sourceOk, statusOk, citationsOk, hallucination };
});
const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : '–');
const withSource = rows.filter((r) => r.c.source);
const notDoc = rows.filter((r) => r.c.category === 'not-documented');
const lines = [
  '# Knowledge evaluation',
  '',
  `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`npm run kb:evaluate\` over \`tests/retrieval/eval-set.json\` (${rows.length} questions). The same set runs as an automated test (\`npm run test:kb\`).`,
  'Expected sources were checked by reading the entries; "not-documented" questions are questions the stored knowledge does not answer.',
  '',
  '| Measure | Result |',
  '| --- | --- |',
  `| Retrieval accuracy (expected first source) | ${withSource.filter((r) => r.sourceOk).length}/${withSource.length} (${pct(withSource.filter((r) => r.sourceOk).length, withSource.length)}) |`,
  `| Knowledge-status accuracy | ${rows.filter((r) => r.statusOk).length}/${rows.length} (${pct(rows.filter((r) => r.statusOk).length, rows.length)}) |`,
  `| Hallucination rate (confident answer to an undocumented question) | ${notDoc.filter((r) => r.hallucination).length}/${notDoc.length} |`,
  `| Missing-information detection (undocumented questions that name what is missing) | ${notDoc.filter((r) => r.a.missing.length > 0).length}/${notDoc.length} |`,
  `| Citation validity (every [n] points to a listed source) | ${rows.filter((r) => r.citationsOk).length}/${rows.length} |`,
  '',
  'Version correctness, conflict detection, follow-ups and the calculation engine are covered by `tests/retrieval/retrieval.test.ts` and `tests/calculations/engine.test.ts` (see TESTING_REPORT.md).',
  '',
  '| # | Question | Category | Status | First source | OK |',
  '| --- | --- | --- | --- | --- | --- |',
  ...rows.map((r, i) => `| ${i + 1} | ${r.c.q.replace(/\|/g, '/')} | ${r.c.category} | ${r.a.status} | ${r.id || '–'} | ${r.sourceOk && r.statusOk && r.citationsOk ? '✔' : '✖'} |`),
  '',
  '## Known limits',
  '',
  '- Retrieval is lexical (full-text search with synonyms, abbreviations learned from the documents, phrase units and re-ranking). It does not understand paraphrases it has no words for; such questions are answered "partly documented" or "not documented" rather than guessed. Semantic search needs an embedding model, which is not configured.',
  '- A question whose words all appear in an unrelated passage can still be matched; the gate (all key terms close together, subject in the title, negation next to its object, same transaction) blocks the cases found so far. New mismatches should be added to the evaluation set.',
  '- "Why" questions are answered only when a source states a reason; most WFX sources describe how, not why.',
];
fs.writeFileSync(path.join(ROOT, 'documentation', 'KNOWLEDGE_EVALUATION.md'), `${lines.join('\n')}\n`, 'utf8');
console.log(`KNOWLEDGE_EVALUATION.md written: retrieval ${withSource.filter((r) => r.sourceOk).length}/${withSource.length}, status ${rows.filter((r) => r.statusOk).length}/${rows.length}, hallucinations ${notDoc.filter((r) => r.hallucination).length}/${notDoc.length}.`);
