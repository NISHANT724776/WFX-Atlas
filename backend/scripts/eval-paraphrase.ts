// Paraphrase evaluation: questions written in users' own words (not the documents' wording) against the assistant.
// The set (tests/retrieval/so-paraphrase-set.json) was written before the enrichment existed, from reading the entries.
//   npm run kb:eval-paraphrase            → prints the table and writes documentation/PARAPHRASE_EVALUATION.md
//   npm run kb:eval-paraphrase -- --quiet → summary only
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.ts';
import { answerQuestion } from '../src/assistant/answer.ts';
import type { Topic } from '../src/assistant/answer.ts';

interface Case { q: string; category: string; expect: string[]; context?: string }
export interface CaseResult { c: Case; top1: string; top3: string[]; status: string; ok1: boolean; ok3: boolean; answered: boolean; module: string }

export function runParaphraseEval(file = path.join(ROOT, 'tests', 'retrieval', 'so-paraphrase-set.json')): { rows: CaseResult[]; top1: number; top3: number; answered: number; wrongConfident: number } {
  const all = JSON.parse(fs.readFileSync(file, "utf8")) as Case[];
  // --dev: odd-numbered questions (used to tune thresholds) · --test: even-numbered (never used for tuning)
  const half = process.argv.includes("--dev") ? 1 : process.argv.includes("--test") ? 0 : -1;
  const cases = half < 0 ? all : all.filter((_, i) => i % 2 === half);
  const rows = cases.map((c) => {
    const context: Topic | null = c.context ? { title: c.context, terms: [c.context] } : null;
    const a = answerQuestion(c.q, { log: false, context });
    const ids = a.sources.map((s) => s.entryId ?? s.docId ?? '').filter(Boolean);
    const top1 = ids[0] ?? '';
    const top3 = ids.slice(0, 3);
    const answered = a.status !== 'not-documented';
    // correct = answered (not "not documented") from an expected item; a right source behind a "not documented" answer does not count
    return { c, top1, top3, status: a.status, ok1: answered && c.expect.includes(top1), ok3: answered && top3.some((x) => c.expect.includes(x)), answered, module: '' };
  });
  const n = (f: (r: CaseResult) => boolean) => rows.filter(f).length;
  return { rows, top1: n((r) => r.ok1), top3: n((r) => r.ok3), answered: n((r) => r.answered), wrongConfident: n((r) => r.answered && !r.ok3) };
}

if (import.meta.url === `file://${process.argv[1].replace(/\\/g, '/').replace(/^([A-Za-z]):/, '/$1:')}` || process.argv[1]?.endsWith('eval-paraphrase.ts')) {
  const r = runParaphraseEval();
  const total = r.rows.length;
  const pct = (x: number) => `${Math.round((x / total) * 100)} %`;
  console.log(`paraphrase set: ${total} questions · top-1 ${r.top1} (${pct(r.top1)}) · top-3 ${r.top3} (${pct(r.top3)}) · answered ${r.answered} · answered with a wrong source ${r.wrongConfident}`);
  if (!process.argv.includes('--quiet')) for (const x of r.rows) console.log(`${x.ok1 ? '✔' : x.ok3 ? '~' : '✖'} [${x.c.category}] ${x.c.q} → ${x.top1 || '–'} (${x.status})`);
  const byCat = new Map<string, { n: number; ok: number }>();
  for (const x of r.rows) { const k = byCat.get(x.c.category) ?? { n: 0, ok: 0 }; k.n++; if (x.ok1) k.ok++; byCat.set(x.c.category, k); }
  if (process.argv.includes('--write')) {
    const lines = [
      '# Paraphrase evaluation (Sales Order)', '',
      `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC by \`npm run kb:eval-paraphrase -- --write\` over \`tests/retrieval/so-paraphrase-set.json\` (${total} questions in users' own words, written before the enrichment was built).`, '',
      '| Measure | Result |', '| --- | --- |',
      `| Correct knowledge item first | ${r.top1}/${total} (${pct(r.top1)}) |`,
      `| Correct knowledge item in the first three sources | ${r.top3}/${total} (${pct(r.top3)}) |`,
      `| Answered (not "not documented") | ${r.answered}/${total} |`,
      `| Answered from a wrong item (none of the expected in the first three) | ${r.wrongConfident}/${total} |`, '',
      '| Category | Correct first |', '| --- | --- |',
      ...[...byCat].map(([k, v]) => `| ${k} | ${v.ok}/${v.n} |`), '',
      '| # | Question | Category | First source | Status | OK |', '| --- | --- | --- | --- | --- | --- |',
      ...r.rows.map((x, i) => `| ${i + 1} | ${x.c.q.replace(/\|/g, '/')} | ${x.c.category} | ${x.top1 || '–'} | ${x.status} | ${x.ok1 ? '✔' : x.ok3 ? 'top 3' : '✖'} |`),
    ];
    fs.writeFileSync(path.join(ROOT, 'documentation', 'PARAPHRASE_EVALUATION.md'), `${lines.join('\n')}\n`, 'utf8');
  }
}
