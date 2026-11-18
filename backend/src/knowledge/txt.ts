// The TXT knowledge format (Layer B). One file holds many entries; an entry starts with its ID line ("RULE ID: …"),
// every other line is "KEY: value", and values that span lines continue on lines indented by two spaces.
// A line of "=" characters separates entries. Lines starting with "#" are comments.
//
// The parser is lenient with hand edits (it reports problems instead of throwing) and the serializer round-trips exactly.

export type EntryType = 'rule' | 'term' | 'module' | 'procedure' | 'transaction' | 'field' | 'dependency' | 'case' | 'workflow' | 'model';

export const ID_KEYS: Record<string, EntryType> = {
  'RULE ID': 'rule',
  'TERM ID': 'term',
  'MODULE ID': 'module',
  'PROCEDURE ID': 'procedure',
  'TRANSACTION ID': 'transaction',
  'FIELD ID': 'field',
  'DEPENDENCY ID': 'dependency',
  'CASE ID': 'case',
  'WORKFLOW ID': 'workflow',
  'MODEL ID': 'model',
};

export const ID_KEY_OF: Record<EntryType, string> = Object.fromEntries(Object.entries(ID_KEYS).map(([k, v]) => [v, k])) as Record<EntryType, string>;

/** The key that holds each entry type's display title. */
export const TITLE_KEY: Record<EntryType, string> = {
  rule: 'RULE NAME',
  term: 'TERM',
  module: 'MODULE NAME',
  procedure: 'TITLE',
  transaction: 'TRANSACTION NAME',
  field: 'FIELD NAME',
  dependency: 'RELATIONSHIP',
  case: 'TITLE',
  workflow: 'WORKFLOW NAME',
  model: 'MODEL NAME',
};

export const STATUSES = ['Draft', 'Under Review', 'Approved', 'Active', 'Superseded', 'Rejected', 'Archived'] as const;
export type Status = (typeof STATUSES)[number];
/** Statuses whose content counts as confirmed business knowledge. */
export const CONFIRMED: readonly string[] = ['Approved', 'Active'];

/** The full key order of a business rule (specification, Module 3). */
export const RULE_KEYS = [
  'RULE ID', 'RULE NAME', 'MODULE', 'SUBMODULE', 'TRANSACTION', 'RULE CATEGORY', 'BUSINESS PURPOSE', 'TRIGGER CONDITION',
  'APPLICABLE CONDITIONS', 'INPUT FIELDS', 'FORMULA / LOGIC', 'UNIT OF MEASUREMENT', 'ROUNDING RULE', 'OUTPUT', 'VALIDATIONS',
  'EXAMPLE', 'EXPECTED RESULT', 'EXCEPTION CONDITIONS', 'RELATED TRANSACTIONS', 'RELATED RULES', 'SOURCE', 'VERSION', 'STATUS',
  'CREATED DATE', 'LAST UPDATED',
];

export interface Entry {
  idKey: string;
  id: string;
  type: EntryType;
  fields: Record<string, string>;
  order: string[];
  /** Knowledge-relative path of the file that holds the entry (posix separators). */
  file?: string;
  /** 1-based line of the ID line. */
  line?: number;
}

export interface ParseProblem {
  file: string;
  line: number;
  message: string;
}

const SEPARATOR = /^(={5,}|-{5,})\s*$/;
const KEY_LINE = /^([A-Z][A-Z0-9 /&()'.,+-]*?)\s*:(?:[ \t](.*))?$/;
export const ID_FORMAT = /^[A-Z0-9][A-Z0-9._-]{1,79}$/;

export function parseTxt(text: string, file = ''): { entries: Entry[]; problems: ParseProblem[] } {
  const lines = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
  const entries: Entry[] = [];
  const problems: ParseProblem[] = [];
  let cur: Entry | null = null;
  let key: string | null = null;

  const flush = () => {
    if (cur) {
      for (const k of Object.keys(cur.fields)) cur.fields[k] = trimValue(cur.fields[k]);
      if (!ID_FORMAT.test(cur.id)) problems.push({ file, line: cur.line ?? 0, message: `Invalid ID "${cur.id}" (use capitals, digits, dot, dash or underscore).` });
      entries.push(cur);
    }
    cur = null;
    key = null;
  };

  lines.forEach((raw, i) => {
    const line = raw.replace(/\s+$/, '');
    const n = i + 1;
    if (!line.length) {
      // a whitespace-only indented line keeps an empty line inside a multi-line value
      if (/^[ \t]+$/.test(raw) && cur && key) (cur as Entry).fields[key] += '\n';
      return;
    }
    if (line.startsWith('#')) return;
    if (SEPARATOR.test(line)) { flush(); return; }
    const indented = /^[ \t]/.test(raw);
    if (!indented) {
      const m = KEY_LINE.exec(line);
      if (m) {
        const k = m[1].trim();
        const v = (m[2] ?? '').trim();
        const type = ID_KEYS[k];
        if (type) {
          flush();
          cur = { idKey: k, id: v, type, fields: { [k]: v }, order: [k], file, line: n };
          key = k;
          return;
        }
        if (cur) {
          if (k in cur.fields) problems.push({ file, line: n, message: `Key "${k}" appears twice in ${cur.id}; the later value is used.` });
          else cur.order.push(k);
          cur.fields[k] = v;
          key = k;
          return;
        }
        problems.push({ file, line: n, message: `"${k}:" is outside an entry (an entry starts with an ID line such as "RULE ID:").` });
        return;
      }
    }
    // continuation of a multi-line value
    if (cur && key) {
      const c = cur as Entry;
      const text = indented ? raw.replace(/^( {1,2}|\t)/, '').replace(/\s+$/, '') : line;
      if (!indented) problems.push({ file, line: n, message: `Line is not indented; read as part of "${key}" in ${c.id}.` });
      c.fields[key] = c.fields[key] ? `${c.fields[key]}\n${text}` : text;
      return;
    }
    problems.push({ file, line: n, message: 'Text outside an entry was ignored.' });
  });
  flush();
  return { entries, problems };
}

function trimValue(v: string): string {
  return v.replace(/^\n+|\n+$/g, '').split('\n').map((l) => l.replace(/\s+$/, '')).join('\n');
}

/** Writes one entry. Single-line values stay on the key line; multi-line values become an indented block. */
export function serializeEntry(e: Entry): string {
  const keys = [e.idKey, ...e.order.filter((k) => k !== e.idKey), ...Object.keys(e.fields).filter((k) => k !== e.idKey && !e.order.includes(k))];
  const out = ['='.repeat(80)];
  for (const k of keys) {
    const v = (e.fields[k] ?? '').replace(/\r\n?/g, '\n');
    if (v.includes('\n')) {
      out.push(`${k}:`);
      for (const l of v.split('\n')) out.push(l ? `  ${l}` : '  ');
    } else out.push(v ? `${k}: ${v}` : `${k}:`);
  }
  return out.join('\n');
}

export function serializeFile(header: string[], entries: Entry[]): string {
  const head = header.map((h) => `# ${h}`.trimEnd());
  const body = entries.map(serializeEntry).join('\n');
  return `${head.join('\n')}${head.length ? '\n\n' : ''}${body}${entries.length ? `\n${'='.repeat(80)}\n` : ''}`;
}

/** Keeps the comment header of an existing file. */
export function fileHeader(text: string): string[] {
  const out: string[] = [];
  for (const l of text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')) {
    if (l.startsWith('#')) out.push(l.replace(/^#\s?/, ''));
    else if (l.trim()) break;
  }
  return out;
}

export function makeEntry(type: EntryType, id: string, fields: Record<string, string | undefined>, order?: string[]): Entry {
  const idKey = ID_KEY_OF[type];
  const clean: Record<string, string> = { [idKey]: id };
  const keys = order ?? Object.keys(fields);
  const ord = [idKey];
  for (const k of keys) {
    if (k === idKey) continue;
    clean[k] = (fields[k] ?? '').trim();
    ord.push(k);
  }
  for (const k of Object.keys(fields)) if (!(k in clean)) { clean[k] = (fields[k] ?? '').trim(); ord.push(k); }
  return { idKey, id, type, fields: clean, order: ord };
}

export const titleOf = (e: Entry) => e.fields[TITLE_KEY[e.type]] || e.fields['TITLE'] || e.fields['NAME'] || e.id;
export const statusOf = (e: Entry) => (e.fields['STATUS'] || 'Draft').trim();
export const versionOf = (e: Entry) => {
  const v = parseInt(e.fields['VERSION'] ?? '1', 10);
  return Number.isFinite(v) && v > 0 ? v : 1;
};

/** Checks an entry against the format rules. Returns human-readable problems (empty = valid). */
export function validateEntry(e: Entry): string[] {
  const p: string[] = [];
  if (!ID_FORMAT.test(e.id)) p.push(`Invalid ID "${e.id}".`);
  if (!e.fields[TITLE_KEY[e.type]]) p.push(`"${TITLE_KEY[e.type]}" is required.`);
  const st = e.fields['STATUS'];
  if (!st) p.push('"STATUS" is required.');
  else if (!(STATUSES as readonly string[]).includes(st)) p.push(`Unknown STATUS "${st}" (use ${STATUSES.join(', ')}).`);
  const v = e.fields['VERSION'];
  if (!v || !/^\d+$/.test(v) || Number(v) < 1) p.push('"VERSION" must be a whole number from 1.');
  for (const k of ['CREATED DATE', 'LAST UPDATED']) {
    const d = e.fields[k];
    if (d && !/^\d{4}-\d{2}-\d{2}/.test(d)) p.push(`"${k}" must start with a date written YYYY-MM-DD.`);
  }
  if (!e.fields['SOURCE']) p.push('"SOURCE" is required (where this knowledge comes from).');
  return p;
}

/** Splits a "1. step / 2. step" or one-per-line value into steps. */
export function stepsOf(v: string | undefined): string[] {
  if (!v) return [];
  return v.split('\n').map((l) => l.trim().replace(/^(\d+[.)]|[-•*])\s*/, '')).filter(Boolean);
}
