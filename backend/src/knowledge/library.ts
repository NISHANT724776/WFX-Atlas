// The TXT knowledge library (Layer B) on disk: load every entry file, write entries back safely, keep history and the
// change record. The files are the source of truth; the database index is rebuilt from them.
import fs from 'node:fs';
import path from 'node:path';
import { ENTRY_DIRS, KDIRS, settings } from '../config.ts';
import { atomicWrite, ensureDir, nowIso, readJson, toPosix, writeJson } from '../util.ts';
import { fileHeader, parseTxt, serializeEntry, serializeFile } from './txt.ts';
import type { Entry, ParseProblem } from './txt.ts';

export const kpath = (...parts: string[]) => path.join(settings().knowledge, ...parts);

export function listEntryFiles(): string[] {
  const root = settings().knowledge;
  const out: string[] = [];
  const walk = (dir: string) => {
    if (!fs.existsSync(dir)) return;
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      if (d.isDirectory()) walk(full);
      else if (d.name.endsWith('.txt')) out.push(toPosix(path.relative(root, full)));
    }
  };
  for (const dir of ENTRY_DIRS) walk(path.join(root, dir));
  return out.sort();
}

export interface Library {
  entries: Entry[];
  problems: ParseProblem[];
  files: string[];
}

export function loadLibrary(): Library {
  const files = listEntryFiles();
  const entries: Entry[] = [];
  const problems: ParseProblem[] = [];
  for (const rel of files) {
    const text = fs.readFileSync(kpath(rel), 'utf8');
    const r = parseTxt(text, rel);
    entries.push(...r.entries);
    problems.push(...r.problems);
  }
  return { entries, problems, files };
}

export function readFileEntries(rel: string): { header: string[]; entries: Entry[] } {
  const full = kpath(rel);
  if (!fs.existsSync(full)) return { header: [], entries: [] };
  const text = fs.readFileSync(full, 'utf8');
  return { header: fileHeader(text), entries: parseTxt(text, rel).entries };
}

export function writeEntryFile(rel: string, header: string[], entries: Entry[]): void {
  atomicWrite(kpath(rel), serializeFile(header, entries));
}

/** Replaces the entry with the same ID and VERSION in a file, or appends it. */
export function putEntry(rel: string, entry: Entry, defaultHeader: string[] = []): void {
  const { header, entries } = readFileEntries(rel);
  const v = entry.fields['VERSION'];
  const i = entries.findIndex((e) => e.id === entry.id && (e.fields['VERSION'] ?? '1') === (v ?? '1'));
  if (i >= 0) entries[i] = entry;
  else entries.push(entry);
  writeEntryFile(rel, header.length ? header : defaultHeader, entries);
}

/** Removes the entry with this ID (and version, when given) from a file. Returns the removed entry. */
export function takeEntry(rel: string, id: string, version?: string): Entry | undefined {
  const { header, entries } = readFileEntries(rel);
  const i = entries.findIndex((e) => e.id === id && (version === undefined || (e.fields['VERSION'] ?? '1') === version));
  if (i < 0) return undefined;
  const [removed] = entries.splice(i, 1);
  writeEntryFile(rel, header, entries);
  return removed;
}

/** Appends a version to the entry's history file (append-only, never rewritten). */
export function appendHistory(entry: Entry, note: string): string {
  const rel = toPosix(path.join(KDIRS.history, `${entry.id}.txt`));
  const full = kpath(rel);
  ensureDir(path.dirname(full));
  const head = fs.existsSync(full) ? '' : `# History of ${entry.id}. Append-only: every superseded or replaced version.\n\n`;
  fs.appendFileSync(full, `${head}# ${nowIso()} · ${note}\n${serializeEntry(entry)}\n${'='.repeat(80)}\n\n`, 'utf8');
  return rel;
}

export function readHistory(id: string): Entry[] {
  const full = kpath(KDIRS.history, `${id}.txt`);
  if (!fs.existsSync(full)) return [];
  return parseTxt(fs.readFileSync(full, 'utf8'), toPosix(path.join(KDIRS.history, `${id}.txt`))).entries;
}

export interface ChangeRecord {
  at: string;
  entry_id: string;
  action: string;
  from_version?: number | null;
  to_version?: number | null;
  from_status?: string | null;
  to_status?: string | null;
  changed_by: string;
  reason?: string;
  source?: string;
  file?: string;
}

/** Appends to metadata/change_history.json (kept as a JSON array so it stays readable and exportable). */
export function recordChange(change: Omit<ChangeRecord, 'at'>): ChangeRecord {
  const file = kpath(KDIRS.metadata, 'change_history.json');
  const list = readJson<ChangeRecord[]>(file, []);
  const rec = { at: nowIso(), ...change };
  list.push(rec);
  writeJson(file, list);
  return rec;
}

export function readChanges(): ChangeRecord[] {
  return readJson<ChangeRecord[]>(kpath(KDIRS.metadata, 'change_history.json'), []);
}

/** Default file for a new entry, by type and module. */
export function defaultFileFor(entry: Entry): string {
  const mod = (entry.fields['MODULE'] ?? '').toLowerCase();
  const cat = (entry.fields['RULE CATEGORY'] ?? '').toLowerCase();
  switch (entry.type) {
    case 'rule': {
      if (cat.includes('calculation')) return `${KDIRS.calcs}/calculation_rules.txt`;
      if (cat.includes('validation')) return `${KDIRS.rules}/validation_rules.txt`;
      const byModule: [RegExp, string][] = [
        [/kit|pack/, 'kit_pack_rules.txt'], [/sales|order/, 'sales_rules.txt'], [/inventory|stock|warehouse|wms|qc/, 'inventory_rules.txt'],
        [/sourcing|purchase|procure|rmpo|indent/, 'purchase_rules.txt'], [/production|fpo|cutting/, 'production_rules.txt'],
        [/cost/, 'costing_rules.txt'], [/planning|mrp/, 'planning_rules.txt'],
      ];
      const hit = byModule.find(([re]) => re.test(mod));
      return `${KDIRS.rules}/${hit ? hit[1] : 'general_rules.txt'}`;
    }
    case 'term': return `${KDIRS.glossary}/erp_terms.txt`;
    case 'transaction': return `${KDIRS.transactions}/transaction_definitions.txt`;
    case 'field': return `${KDIRS.transactions}/field_definitions.txt`;
    case 'dependency': return `${KDIRS.transactions}/transaction_dependencies.txt`;
    case 'case': return `${KDIRS.transactions}/transaction_cases.txt`;
    case 'workflow': return `${KDIRS.workflows}/workflows.txt`;
    case 'model': return `${KDIRS.models}/data_models.txt`;
    case 'module':
    case 'procedure':
    default: return `${KDIRS.modules}/${(mod.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'general')}.txt`;
  }
}

export const PENDING_FILE = `${KDIRS.review}/pending.txt`;
export const PENDING_HEADER = [
  'Drafts and new versions waiting for review. Nothing here is treated as confirmed WFX knowledge.',
  'Approve or reject them in the Rulebook; approved entries move to their category file.',
];
