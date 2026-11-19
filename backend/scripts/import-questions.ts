// Reads questions an LLM wrote for knowledge units (JSONL: {"unit_id": "...", "questions": [{"text": "...", "category": "..."}]})
// into the review queue as unreviewed proposals, then re-enriches so they are matched and shown on /question-mapping.
//   npm run kb:import-questions -- path/to/replies.jsonl --model "<model name>"
import fs from 'node:fs';
import { importQuestions } from '../src/enrich/training.ts';
import { refresh } from '../src/enrich/review.ts';

const file = process.argv[2];
if (!file || !fs.existsSync(file)) { console.error('Give the .jsonl file of LLM replies.'); process.exit(1); }
const mi = process.argv.indexOf('--model');
const r = importQuestions(fs.readFileSync(file, 'utf8'), 'llm-import', mi > 0 ? process.argv[mi + 1] : '');
const e = refresh();
console.log(JSON.stringify({ ...r, rejected: r.rejected.slice(0, 20), enrichment: { units: e.units, questions: e.questions, mapped: e.selfCheck.mapped } }));
