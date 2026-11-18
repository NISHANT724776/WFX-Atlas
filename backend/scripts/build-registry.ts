// Builds knowledge/registry/screens.txt, the Screen Registry: every screen the platform documents, with its WFX menu path,
// the page of this platform that documents it, its real screenshots and related workflows. Sources: the v1 Knowledge Hub
// data (captured WFX screens, transactions, guided workflows) and the platform's own pages. Hand edits are kept: an entry
// that already exists in the file is never overwritten, only missing ones are added.
//   npm run kb:registry
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { settings } from '../src/config.ts';
import { parseRegistryText, serializeRegistry } from '../src/registry/registry.ts';
import type { RegEntry } from '../src/registry/registry.ts';

const ROOT = path.resolve(import.meta.dirname, '..', '..');
const out = path.join(ROOT, 'backend', '.cache', 'v1-dump.registry.mjs');
await build({ entryPoints: [path.join(ROOT, 'backend', 'scripts', 'v1-dump.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent' });
const v1 = (await import(pathToFileURL(out).href)).dump();
const today = new Date().toISOString().slice(0, 10);

const FLOW_WF: Record<string, string> = { 'block-booking': 'WF-READY-BLOCK-BOOKING', 'sales-order': 'WF-READY-SALES-ORDER', 'style-setup': 'WF-READY-STYLE-SETUP', 'end-to-end': 'WF-READY-END-TO-END' };
const stepsById = new Map<string, { doc?: string; theory?: string }>(v1.steps.map((s: { id: string; doc?: string; theory?: string }) => [s.id, s]));
const flowsTouching = (doc: string, slug: string) => (v1.flows as { slug: string; steps: string[] }[])
  .filter((f) => f.steps.some((id) => { const s = stepsById.get(id); return s && (s.doc === doc || (!!slug && s.theory === slug)); })).map((f) => f.slug);
const txn = (slug: string) => (v1.transactions as { slug: string; name: string; module: string; description: string }[]).find((t) => t.slug === slug);

const entries: RegEntry[] = [];
const add = (id: string, f: Record<string, string>) => entries.push({ id, fields: { 'SCREEN ID': id, ...f, STATUS: f['STATUS'] ?? 'Active', 'CREATED DATE': today } });

for (const d of v1.docs as { id: string; name: string; screen: string; summary: string; theory: string; shots: string[]; chapter: string }[]) {
  const t = d.theory ? txn(d.theory) : undefined;
  const flows = flowsTouching(d.id, d.theory);
  add(`SCR-${d.id.toUpperCase()}`, {
    'SCREEN NAME': d.name, MODULE: t?.module ?? (d.chapter === 'sales' ? 'Sales' : d.chapter === 'admin' ? 'Admin & setup' : ''),
    'WFX MENU PATH': d.screen.replace(/›/g, '>'), PURPOSE: d.summary,
    'APP ROUTE': '/data-model', 'ROUTE QUERY': `doc=${d.id}`, 'THEORY ROUTE': d.theory ? `/theory/${d.theory}` : '',
    'RELATED TRANSACTION': t ? `${t.name} (${d.theory})` : '', 'RELATED WORKFLOWS': flows.map((f) => FLOW_WF[f]).filter(Boolean).join(', '),
    'WORKFLOW PAGES': flows.map((f) => `/workflows/${f}`).join(', '),
    SCREENSHOTS: d.shots.join(', '), ACTIONS: 'View the documented fields and how each one gets its value; open the transaction theory; open related workflows',
    'REQUIRED ROLE': 'viewer', 'WFX URL': '',
    KEYWORDS: [d.name, d.theory?.replace(/-/g, ' '), t?.name].filter(Boolean).join(', '),
    SOURCE: 'Knowledge Hub v1 data (src/app/data/docs.ts): screens captured from live WFX or from the owner\'s Excel trial.',
  });
}
// transactions without a captured screen: their theory page
for (const t of v1.transactions as { slug: string; name: string; module: string; description: string }[]) {
  if ((v1.docs as { theory: string }[]).some((d) => d.theory === t.slug)) continue;
  add(`SCR-TXN-${t.slug.toUpperCase()}`, {
    'SCREEN NAME': t.name, MODULE: t.module, 'WFX MENU PATH': '', PURPOSE: t.description,
    'APP ROUTE': `/theory/${t.slug}`, 'ROUTE QUERY': '', 'THEORY ROUTE': `/theory/${t.slug}`, 'RELATED TRANSACTION': `${t.name} (${t.slug})`,
    'RELATED WORKFLOWS': flowsTouching('', t.slug).map((f) => FLOW_WF[f]).filter(Boolean).join(', '), 'WORKFLOW PAGES': flowsTouching('', t.slug).map((f) => `/workflows/${f}`).join(', '),
    SCREENSHOTS: '', ACTIONS: 'Read the transaction theory, fields, formulas and links', 'REQUIRED ROLE': 'viewer', 'WFX URL': '', KEYWORDS: `${t.name}, ${t.slug.replace(/-/g, ' ')}`,
    SOURCE: 'Knowledge Hub v1 data (src/app/data/transactions.ts).',
  });
}
// guided workflows of the platform
for (const f of v1.flows as { slug: string; name: string; description: string }[]) {
  add(`SCR-FLOW-${f.slug.toUpperCase()}`, {
    'SCREEN NAME': `${f.name} workflow`, MODULE: 'Workflows', 'WFX MENU PATH': '', PURPOSE: f.description, 'APP ROUTE': `/workflows/${f.slug}`, 'ROUTE QUERY': '',
    'RELATED WORKFLOWS': FLOW_WF[f.slug] ?? '', SCREENSHOTS: '', ACTIONS: 'Step through the workflow with the simulator', 'REQUIRED ROLE': 'viewer', 'WFX URL': '',
    KEYWORDS: `${f.name}, ${f.name} workflow, ${f.name} process, ${f.slug.replace(/-/g, ' ')} flow`, SOURCE: 'Knowledge Hub v1 guided workflows (src/app/data/catalog.ts).',
  });
}
// the platform's own pages
const PLATFORM: [string, string, string, string, string, string][] = [
  ['SCR-PLATFORM-WORKFLOW-DESIGNER', 'Workflow Designer (this platform)', '/workflow-designer', 'Generate, view and edit workflow diagrams from the stored knowledge; open stored workflows.', 'viewer', 'workflow designer, diagram, flowchart, swimlane, edit workflow'],
  ['SCR-PLATFORM-RULEBOOK', 'Business Rulebook (this platform)', '/rulebook', 'Every stored rule, term, procedure, transaction and workflow with its status and versions; teach a new rule.', 'viewer', 'rulebook, business rules, teach a rule, approve rule'],
  ['SCR-PLATFORM-LIBRARY', 'Knowledge Library (this platform)', '/library', 'The source documents (manuals, specifications) and their versions; upload documents.', 'viewer', 'library, documents, upload, specification, manual'],
  ['SCR-PLATFORM-CALC-LAB', 'Calculation Lab (this platform)', '/calc-lab', 'Run a stored calculation rule with your own numbers.', 'viewer', 'calculation lab, calculate, formula'],
  ['SCR-PLATFORM-DATA-MODELLING', 'Data Modelling (this platform)', '/data-modelling', 'Documented screen-level data models and their links.', 'viewer', 'data modelling, data model, entities'],
  ['SCR-PLATFORM-ADMIN', 'Admin and settings (this platform)', '/admin', 'Users, sign-up approvals, AI settings and the audit log.', 'admin', 'admin, users, settings, approve sign up'],
];
for (const [id, name, route, purpose, role, kw] of PLATFORM) add(id, { 'SCREEN NAME': name, MODULE: 'Knowledge platform', 'WFX MENU PATH': '', PURPOSE: purpose, 'APP ROUTE': route, 'ROUTE QUERY': '', SCREENSHOTS: '', 'REQUIRED ROLE': role, 'WFX URL': '', KEYWORDS: kw, SOURCE: 'This platform.' });
// registered external destinations
add('EXT-TRIMS-PROTOTYPE', {
  'SCREEN NAME': 'Trims Scan Prototype (Quick Docs mobile app)', MODULE: 'Inventory › Trims', 'WFX MENU PATH': 'Quick Docs mobile app', 'EXTERNAL URL': 'https://trims-prototype-mobile.vercel.app/',
  PURPOSE: 'Clickable prototype of trims handling by QR scan: GRN, Pick List, GDN, Location, Print Doc and Outward Note. Sample data only.',
  'APP ROUTE': '', 'ROUTE QUERY': '', SCREENSHOTS: 'trims/grn-1.webp', 'REQUIRED ROLE': 'viewer', 'WFX URL': '', 'RELATED GUIDES': 'GUIDE-TRIMS-GRN, GUIDE-TRIMS-DISPATCH, GUIDE-TRIMS-GDN, GUIDE-TRIMS-LOC, GUIDE-TRIMS-PRINT, GUIDE-TRIMS-OUT',
  KEYWORDS: 'trims scan, trims prototype, quick docs, QR scan, mobile app, trims outward', SOURCE: 'Owner-supplied prototype link (chat, 2026-11-18).',
});

const file = path.join(settings().knowledge, 'registry', 'screens.txt');
fs.mkdirSync(path.dirname(file), { recursive: true });
const existing = fs.existsSync(file) ? parseRegistryText(fs.readFileSync(file, 'utf8')) : [];
const have = new Set(existing.map((e) => e.id));
const merged = [...existing, ...entries.filter((e) => !have.has(e.id))];
fs.writeFileSync(file, serializeRegistry(merged, [
  'WFX Screen Registry. One entry per screen or destination the assistant may link to. Only APP ROUTE (a page of this platform),',
  'EXTERNAL URL (a verified outside link) and WFX URL (the live WFX screen, when known) are ever used as links; nothing else is navigable.',
  'WFX MENU PATH is how the screen is reached inside WFX itself. Generated by backend/scripts/build-registry.ts; edit freely, edits are kept.',
]), 'utf8');
console.log(`${merged.length} registry entries (${merged.length - existing.length} added) → ${file}`);
