// One line per question: status, title and the first words of the answer. node backend/scripts/audit.ts <file with one question per line>
import fs from 'node:fs';
import { answerQuestion } from '../src/assistant/answer.ts';
const qs = fs.readFileSync(process.argv[2], 'utf8').split('\n').map((l) => l.trim()).filter(Boolean);
for (const q of qs) {
  const a = answerQuestion(q, { log: false });
  const first = a.sections[0]?.text ?? a.sections[0]?.items?.[0] ?? '';
  console.log(`${a.status.padEnd(14)} ${q.slice(0, 58).padEnd(58)} → ${a.title.slice(0, 48).padEnd(48)} | ${first.replace(/\s+/g, ' ').slice(0, 70)}${a.missing.length && a.status !== 'confirmed' ? `  {missing: ${a.missing[0].slice(0, 60)}}` : ''}`);
}
