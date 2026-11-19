// Writes the LLM training / grounding material to exports/llm-training (see backend/src/enrich/training.ts).
//   npm run kb:export-training                 → only Approved / Active knowledge
//   npm run kb:export-training -- --include-drafts
import { exportTraining } from '../src/enrich/training.ts';

console.log(JSON.stringify(exportTraining({ includeDrafts: process.argv.includes('--include-drafts') })));
