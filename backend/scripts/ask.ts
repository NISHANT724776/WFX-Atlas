// Asks the knowledge assistant from the command line and prints the Markdown answer.
//   node --disable-warning=ExperimentalWarning backend/scripts/ask.ts "question" ["question" ...] [--brief|--detailed] [--mode=workflow]
import { answerQuestion } from '../src/assistant/answer.ts';
import type { Depth, Mode } from '../src/assistant/answer.ts';
const args = process.argv.slice(2);
const depth: Depth = args.includes('--brief') ? 'brief' : args.includes('--detailed') ? 'detailed' : 'standard';
const mode = (args.find((a) => a.startsWith('--mode='))?.slice(7) ?? 'ask') as Mode;
let ctx = null;
for (const q of args.filter((a) => !a.startsWith('--'))) {
  const a = answerQuestion(q, { depth, mode, context: args.includes('--chain') ? ctx : null, log: false });
  ctx = a.topic;
  console.log(`\n================ Q: ${q}${a.resolvedQuestion !== q ? `  (read as: ${a.resolvedQuestion})` : ''}\n[${a.intent} · ${a.status}]`);
  console.log(a.markdown);
}
