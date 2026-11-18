// Rewrites the generated section of documentation/KNOWLEDGE_INVENTORY.md from the live registry and TXT library.
//   npm run kb:inventory
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../src/config.ts';
import { kpath, loadLibrary } from '../src/knowledge/library.ts';
import { readRegistry } from '../src/ingest/pipeline.ts';
import { readJson } from '../src/util.ts';

const lib = loadLibrary();
const reg = readRegistry();
const disc = readJson<{ counts?: Record<string, number> }>(kpath('metadata', 'discovered_sources.json'), {});
const byType = new Map<string, Map<string, number>>();
for (const e of lib.entries) {
  const m = byType.get(e.type) ?? new Map<string, number>();
  const s = e.fields['STATUS'] ?? 'Draft';
  m.set(s, (m.get(s) ?? 0) + 1);
  byType.set(e.type, m);
}
const files = new Map<string, number>();
for (const e of lib.entries) files.set(e.file ?? '', (files.get(e.file ?? '') ?? 0) + 1);
const lines = [
  `## Generated: current state (${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC)`,
  '',
  '### TXT library (Layer B)',
  '',
  '| Entry type | Entries | By status |',
  '| --- | --- | --- |',
  ...[...byType].sort().map(([t, m]) => `| ${t} | ${[...m.values()].reduce((a, b) => a + b, 0)} | ${[...m].map(([s, n]) => `${s} ${n}`).join(', ')} |`),
  '',
  `${lib.files.length} TXT files; format problems: ${lib.problems.length}.`,
  '',
  '| File | Entries |',
  '| --- | --- |',
  ...[...files].sort().map(([f, n]) => `| knowledge/${f} | ${n} |`),
  '',
  '### Source documents (Layer A)',
  '',
  '| ID | Title | Type | Knowledge status | Module (detected or set) | Versions | Extraction |',
  '| --- | --- | --- | --- | --- | --- | --- |',
  ...reg.documents.map((d) => `| ${d.id} | ${d.title.replace(/\|/g, '/')} | ${d.doc_type} | ${d.knowledge_status} | ${d.module ?? 'unclassified'} | ${d.versions.length} | ${d.versions[d.versions.length - 1]?.status ?? '-'} |`),
  '',
  `Repository sources of the migrated entries: ${(reg.sources as { id: string }[]).map((s) => s.id).join(', ')}.`,
  '',
  `Discovered but not imported (Downloads): ${disc.counts ? `${disc.counts['distinct_contents']} distinct documents (${disc.counts['files']} files, ${disc.counts['base_names']} names)` : 'none listed'} – see knowledge/metadata/discovered_sources.json.`,
];
const file = path.join(ROOT, 'documentation', 'KNOWLEDGE_INVENTORY.md');
const text = fs.readFileSync(file, 'utf8');
const out = text.replace(/<!-- GENERATED:START -->[\s\S]*<!-- GENERATED:END -->/, `<!-- GENERATED:START -->\n${lines.join('\n')}\n<!-- GENERATED:END -->`);
fs.writeFileSync(file, out, 'utf8');
console.log(`KNOWLEDGE_INVENTORY.md updated: ${lib.entries.length} entries, ${reg.documents.length} documents.`);
