// Rebuilds the index (Layer C) from the TXT library (Layer B) and the extracted documents. Safe to run any time.
//   node --disable-warning=ExperimentalWarning backend/scripts/reindex.ts
import { indexLibrary } from '../src/index/indexer.ts';
import { reindexDocuments } from '../src/ingest/pipeline.ts';
import { syncRegistry } from '../src/registry/registry.ts';
import { configuredModules } from '../src/enrich/pipeline.ts';
import { refresh } from '../src/enrich/review.ts';

const t = Date.now();
const lib = indexLibrary();
const docs = await reindexDocuments();
const reg = syncRegistry();
// question mapping for the modules listed in knowledge/enrichment/config.json (units whose source changed go back to review)
const enr = configuredModules().length ? refresh() : null;
console.log(JSON.stringify({ entries: lib.entries, entryChunks: lib.chunks, relations: lib.relations, formatProblems: lib.problems.length, invalidEntries: lib.invalid.length, documents: docs, registry: { screens: reg.screens, guides: reg.guides, problems: reg.problems.length }, enrichment: enr && { modules: enr.modules, units: enr.units, questions: enr.questions, mapped: enr.selfCheck.mapped }, ms: Date.now() - t }));
if (lib.invalid.length) console.log(JSON.stringify(lib.invalid.slice(0, 10), null, 1));
if (reg.problems.length) console.log(JSON.stringify(reg.problems.slice(0, 10), null, 1));
if (lib.problems.length) console.log(JSON.stringify(lib.problems.slice(0, 10), null, 1));
