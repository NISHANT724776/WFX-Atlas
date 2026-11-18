// Prints the top search hits for a question: node --disable-warning=ExperimentalWarning backend/scripts/search.ts "question"
import { search } from '../src/search/search.ts';
for (const q of process.argv.slice(2)) {
  const r = search(q, { limit: 5 });
  console.log(`\nQ: ${q}  [${r.intent}] units: ${r.units.map((u) => `${u.text}${u.known ? '' : '?'}`).join(', ')}${Object.keys(r.corrections).length ? `  fixed: ${JSON.stringify(r.corrections)}` : ''}`);
  for (const h of r.hits) console.log(`  ${h.score.toFixed(2)} cov ${h.coverage.toFixed(2)} [${h.kind}/${h.status}] ${h.title.slice(0, 70)} — ${h.sourceLabel.slice(0, 60)}${h.missing.length ? `  missing: ${h.missing.join(',')}` : ''}`);
}
