// Rebuilds the index (Layer C) from the TXT library (Layer B) and the extracted documents. Safe to run any time.
//   node --disable-warning=ExperimentalWarning backend/scripts/reindex.ts
import { indexLibrary } from '../src/index/indexer.ts';
import { reindexDocuments } from '../src/ingest/pipeline.ts';
import { syncRegistry } from '../src/registry/registry.ts';

const t = Date.now();
const lib = indexLibrary();
const docs = await reindexDocuments();
const reg = syncRegistry();
console.log(JSON.stringify({ entries: lib.entries, entryChunks: lib.chunks, relations: lib.relations, formatProblems: lib.problems.length, invalidEntries: lib.invalid.length, documents: docs, registry: { screens: reg.screens, guides: reg.guides, problems: reg.problems.length }, ms: Date.now() - t }));
if (lib.invalid.length) console.log(JSON.stringify(lib.invalid.slice(0, 10), null, 1));
if (reg.problems.length) console.log(JSON.stringify(reg.problems.slice(0, 10), null, 1));
if (lib.problems.length) console.log(JSON.stringify(lib.problems.slice(0, 10), null, 1));
