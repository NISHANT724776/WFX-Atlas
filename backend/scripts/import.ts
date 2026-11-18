// Imports files or folders into the knowledge library (originals are copied, never moved or changed).
//   node --disable-warning=ExperimentalWarning backend/scripts/import.ts <file|folder> [...] [--status=source-documented|proposed|reference|unreviewed]
//        [--type=specification|manual|change_request|data|diagram|image|reference|other] [--module="Sales Order"] [--dry-run]
//   node --disable-warning=ExperimentalWarning backend/scripts/import.ts --curated     (the sources listed in documentation/KNOWLEDGE_INVENTORY.md)
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { settings } from '../src/config.ts';
import { rebuildVocab } from '../src/index/indexer.ts';
import { ingestPath } from '../src/ingest/pipeline.ts';
import { SUPPORTED } from '../src/ingest/extract.ts';
import { resetSearchCache } from '../src/search/search.ts';

const args = process.argv.slice(2);
const flag = (k: string) => args.find((a) => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const dry = args.includes('--dry-run');
const home = os.homedir();
const root = settings().root;

const CURATED: { path: string; status: string; type?: string; origin: string }[] = [
  { path: 'D:/Sprints', status: 'source-documented', origin: 'D:\Sprints (WFX sprint and enhancement specifications)' },
  { path: path.join(home, 'Downloads', 'WFX_Data_Model_Flow_NIS-58_v4.xlsx'), status: 'source-documented', type: 'data', origin: 'Downloads (NIS-58 workbook)' },
  ...['New BOM NK1.docx', 'AI Tech pack Configuration Classic.docx', '337356 - OC Closer Setup New Angular Page.docx', 'Sourcing_Module_User_Manual_Enhanced.docx',
    'Inventory and QC process flow Kisah.pdf', 'Stock write off Auto OC closure stock transfer configuration.docx', 'Sample Order Manual final1 V11.docx', 'TNA Workflow.docx', 'WMS Workflow 1.docx']
    .map((f) => ({ path: path.join(home, 'Downloads', f), status: 'source-documented', type: 'manual', origin: 'Downloads (user manual supplied by the owner)' })),
  { path: path.resolve(root, '..', 'WFX-Product-Demo', 'site', 'specs'), status: 'source-documented', type: 'specification', origin: 'WFX-Product-Demo/site/specs (product specifications)' },
];

function files(p: string): string[] {
  if (!fs.existsSync(p)) return [];
  const st = fs.statSync(p);
  if (st.isFile()) return [p];
  const out: string[] = [];
  for (const d of fs.readdirSync(p, { withFileTypes: true })) {
    const full = path.join(p, d.name);
    if (d.isDirectory()) { if (!/^(images|_assets|node_modules|\.)/.test(d.name)) out.push(...files(full)); }
    else out.push(full);
  }
  return out;
}

const keep = (f: string) => {
  const name = path.basename(f);
  if (name.startsWith('~$') || name.startsWith('.') || /\.tmp$/i.test(name)) return false;
  return SUPPORTED.includes(path.extname(name).slice(1).toLowerCase());
};

const jobs: { file: string; status?: string; type?: string; origin: string }[] = [];
if (args.includes('--curated')) for (const c of CURATED) for (const f of files(c.path).filter(keep)) jobs.push({ file: f, status: c.status, type: c.type, origin: c.origin });
for (const a of args.filter((x) => !x.startsWith('--'))) for (const f of files(path.resolve(a)).filter(keep)) jobs.push({ file: f, status: flag('status'), type: flag('type'), origin: 'import' });
if (!jobs.length) { console.log('Nothing to import.'); process.exit(0); }

const tally: Record<string, number> = {};
for (const j of jobs) {
  if (dry) { console.log(`would import ${j.file}`); continue; }
  const r = await ingestPath(j.file, { knowledgeStatus: j.status ?? 'unreviewed', docType: j.type, origin: j.origin, uploadedBy: 'import script', module: flag('module') ?? null, deferVocab: true });
  tally[r.status] = (tally[r.status] ?? 0) + 1;
  console.log(`${r.status.padEnd(11)} ${r.documentId ?? '-'} ${path.basename(j.file)}  ${r.status === 'created' || r.status === 'new-version' ? `${r.quality}; ${(r.stats?.['chunks'] as number) ?? 0} chunks; module: ${(r.stats?.['detected_module'] as string) ?? 'unclassified'}` : r.message}`);
}
if (!dry) { rebuildVocab(); resetSearchCache(); }
console.log(JSON.stringify(tally));
