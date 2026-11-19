// Runs the knowledge enrichment pipeline (backend/src/enrich/pipeline.ts) and the question self-check.
//   npm run kb:enrich                        → modules in knowledge/enrichment/config.json
//   npm run kb:enrich -- --module "Sales Order"
import { refresh } from '../src/enrich/review.ts';

const i = process.argv.indexOf('--module');
const r = refresh(i > 0 ? [process.argv[i + 1]] : undefined);
console.log(JSON.stringify({ ...r, sourceProblems: r.sourceProblems.slice(0, 10) }));
