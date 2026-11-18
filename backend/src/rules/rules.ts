// Business rules: understand a rule written in plain words, draft it in the RULE format, compare it with the stored
// rules, and move it through the lifecycle Draft → Under Review → Approved → Active → Superseded (or Rejected).
// Every change writes the TXT files (never silently overwriting), the history, the change record and the index.
import { CalcError, parseSpec } from '../calc/engine.ts';
import { KDIRS } from '../config.ts';
import { all } from '../db.ts';
import { indexLibrary } from '../index/indexer.ts';
import { appendHistory, defaultFileFor, PENDING_FILE, PENDING_HEADER, putEntry, readFileEntries, recordChange, takeEntry } from '../knowledge/library.ts';
import { findTransaction, getEntry, relationsOf } from '../knowledge/repo.ts';
import type { EntryRow } from '../knowledge/repo.ts';
import { makeEntry, parseTxt, RULE_KEYS, statusOf, validateEntry, versionOf } from '../knowledge/txt.ts';
import type { Entry } from '../knowledge/txt.ts';
import { normalize, stem } from '../search/lexicon.ts';
import { idPart, today } from '../util.ts';

export type Role = 'admin' | 'approver' | 'editor' | 'viewer';
export class RuleError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

// ── understanding a rule written in words ─────────────────────────────
const OPS: [RegExp, string][] = [
  [/\bminus\b|\bless\b(?! than)|\bsubtract(?:ed)?\b/gi, '-'], [/\bplus\b|\badded to\b|\bincluding\b/gi, '+'],
  [/\bmultiplied by\b|\btimes\b|×/gi, '*'], [/\bdivided by\b|÷/gi, '/'], [/−|–/g, '-'],
];
const snake = (s: string) => s.toLowerCase().replace(/%/g, ' pct').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').replace(/^(\d)/, 'f_$1');
const titleCase = (s: string) => s.replace(/\b([a-z])/g, (c) => c.toUpperCase()).replace(/\b(Qty|Uom|Bom|Oc|Rmpo|Grn|Mrp|Po)\b/g, (w) => (w === 'Qty' ? 'Qty' : w.toUpperCase()));

export interface RuleUnderstanding {
  category: string; module: string; transaction: string; transactionId: string | null; output: string; inputs: string[];
  formula: string; expression: string; purpose: string; conditions: string; exceptions: string; unit: string; example: string;
  missing: string[]; questions: string[]; confidence: 'high' | 'medium' | 'low';
}
export interface RelatedRule { id: string; title: string; version: number; status: string; formula: string; relation: 'same-output' | 'same-transaction' | 'mentions-output'; difference: string }
export interface RuleProposal { understanding: RuleUnderstanding; related: RelatedRule[]; draft: Entry; draftText: string; problems: string[]; suggestedFile: string; correctionOf: string | null }

function splitFormula(rhs: string): { expr: string; inputs: string[] } | null {
  let s = ` ${rhs} `;
  for (const [re, op] of OPS) s = s.replace(re, ` ${op} `);
  const tokens = s.split(/\s*([-+*/()])\s*/).map((t) => t.trim()).filter(Boolean);
  const inputs: string[] = [];
  const out: string[] = [];
  for (const t of tokens) {
    if (/^[-+*/()]$/.test(t)) { out.push(t); continue; }
    if (/^\d+(\.\d+)?%?$/.test(t)) { out.push(t.endsWith('%') ? `(${t.slice(0, -1)} / 100)` : t); continue; }
    const name = t.replace(/^(the|of|a|an)\s+/i, '').replace(/[.,;:]+$/, '').trim();
    if (!name || name.split(' ').length > 6) return null;
    inputs.push(titleCase(name));
    out.push(snake(name));
  }
  if (!inputs.length || !out.some((x) => /^[-+*/]$/.test(x))) return null;
  return { expr: out.join(' ').replace(/\( /g, '(').replace(/ \)/g, ')'), inputs: [...new Set(inputs)] };
}

export function understandRule(text: string): RuleUnderstanding {
  const t = text.replace(/\s+/g, ' ').trim();
  const sentencesOf = t.split(/(?<=[.!?])\s+/);
  let output = '', rhs = '', purpose = '';
  // "X = Y − Z" or "X is calculated as / is based on / equals Y minus Z"
  const eq = /([A-Za-z][\w %./()&-]{1,60}?)\s*(?:=|\bis calculated as\b|\bis computed as\b|\bequals\b|\bis equal to\b|\bis derived as\b)\s*(.+?)(?:\.\s|\.$|$)/i.exec(t);
  if (eq) { output = eq[1].replace(/^(in|for|the)\s+[\w ]*?,?\s*/i, '').trim(); rhs = eq[2]; }
  const based = /\b(?:calculation|formula|value|it)\s+is\s+(?:based on|calculated (?:as|from)|derived from)\s+(.+?)(?:\.\s|\.$|$)/i.exec(t);
  if (!rhs && based) rhs = based[1];
  // "In RMPO, Open Qty represents the outstanding quantity …": the field being described, and what it means
  const GENERIC_SUBJECT = /^(the )?(calculation|formula|value|it|this|that|rule|result|logic|system)$/i;
  const reps = [...t.matchAll(/(?:^|[.!?]\s+)(?:in\s+[\w ()/&-]+?,\s*)?(?:the\s+)?([A-Za-z][\w %./-]{1,40}?)\s+(represents|means|refers to|indicates|is defined as|is)\s+(?:the\s+)?(.+?)(?:[.!?](?:\s|$)|$)/gi)]
    .filter((m) => !GENERIC_SUBJECT.test(m[1].trim()))
    .sort((a, b) => (a[2].toLowerCase() === 'is' ? 1 : 0) - (b[2].toLowerCase() === 'is' ? 1 : 0));
  const rep = reps[0];
  if (rep) { if (!output || GENERIC_SUBJECT.test(output)) output = rep[1].trim(); purpose = `${rep[1].trim()} ${rep[2].toLowerCase()} ${rep[3].trim()}.`; }
  if (GENERIC_SUBJECT.test(output)) output = '';
  const f = rhs ? splitFormula(rhs) : null;
  // "X must not be more than Y" → valid = x <= y
  const CMP: [RegExp, string][] = [
    [/^(.+?)\s+(?:must not|should not|cannot|can not|may not|shall not)\s+(?:be\s+)?(?:more|greater|higher)\s+than\s+(?:the\s+)?(.+?)$/i, '<='],
    [/^(.+?)\s+(?:must not|should not|cannot|can not|may not|shall not)\s+exceed\s+(?:the\s+)?(.+?)$/i, '<='],
    [/^(.+?)\s+(?:must not|should not|cannot|can not|may not|shall not)\s+(?:be\s+)?(?:less|lower)\s+than\s+(?:the\s+)?(.+?)$/i, '>='],
    [/^(.+?)\s+(?:must|should|shall)\s+(?:be\s+)?(?:less|lower)\s+than\s+(?:the\s+)?(.+?)$/i, '<'],
    [/^(.+?)\s+(?:must|should|shall)\s+(?:be\s+)?(?:more|greater|higher)\s+than\s+(?:the\s+)?(.+?)$/i, '>'],
    [/^(.+?)\s+(?:must|should|shall)\s+(?:be\s+)?(?:equal to|the same as)\s+(?:the\s+)?(.+?)$/i, '=='],
  ];
  let check: { a: string; b: string; op: string } | null = null;
  for (const sen of sentencesOf) {
    const body = sen.replace(/^in\s+[\w ()/&-]+?,\s*/i, '').replace(/^(the)\s+/i, '').replace(/[.!?]+$/, '');
    for (const [re, op] of CMP) { const m = re.exec(body); if (m && m[1].split(' ').length <= 6 && m[2].split(' ').length <= 6) { check = { a: m[1].trim(), b: m[2].trim(), op }; break; } }
    if (check) break;
  }
  if (check && !output) output = check.a;
  const isCalc = !!f || /\b(calculat|formula|minus|plus|multipl|divid|sum of|percentage of)\w*/i.test(t);
  const isValidation = !!check || /\b(must|mandatory|should not|cannot|can not|not allowed|is required|are required|only (?:if|when)|restrict|validat|do not allow|does not allow|block)\w*/i.test(t);
  const category = isCalc ? 'Calculation' : isValidation ? 'Validation' : 'Business Rule';
  // transaction and module from the knowledge base (never guessed from general ERP knowledge)
  let txn: EntryRow | undefined;
  for (const m of t.matchAll(/\b([A-Z]{2,6}|[A-Z][a-z]+(?: [A-Z][a-z]+){0,3})\b/g)) { txn = findTransaction(m[1]); if (txn) break; }
  const cond = sentencesOf.map((s) => /\b(when|if|only for|only if|only when|provided that|as long as)\b(.+)/i.exec(s)?.[0]).filter(Boolean).join(' ');
  const exc = sentencesOf.map((s) => /\b(except|unless|excluding|other than)\b(.+)/i.exec(s)?.[0]).filter(Boolean).join(' ');
  const unit = /\b(kg|kgs|mtrs?|meters?|metres?|pcs|pieces|yards?|uom|%|percent)\b/i.exec(t)?.[0] ?? '';
  const example = /\b(e\.g\.|for example|example:?)\s*(.+?)(?:\.\s|\.$|$)/i.exec(t)?.[2] ?? '';
  const missing: string[] = [];
  const questions: string[] = [];
  if (!txn) { missing.push('Transaction: none of the stored transactions is named in the text.'); questions.push('Which transaction does this rule belong to?'); }
  if (/\b(sum of|total of|average of|count of)\b/i.test(t)) questions.push('"Sum / total of …" adds up several lines: should the rule take that total as one input, or be written per line?');
  if (isCalc && !f) { missing.push('Formula: the calculation could not be read as "Output = inputs with + − × ÷".'); questions.push('Can you write it as a formula, for example "Open Qty = Order Qty − Received Qty"?'); }
  if (isCalc && !output) missing.push('Output field: which field this calculation fills.');
  if (!unit && isCalc) missing.push('Unit of measurement (or "same unit as the inputs").');
  if (isCalc) missing.push('Rounding rule (decimal places, or "no rounding").');
  if (!cond) missing.push('Applicable conditions: statuses, document types or settings where the rule applies (or "always").');
  if (!exc) missing.push('Exceptions: what happens when the result is negative, zero or an input is blank.');
  if (!example) missing.push('A worked example with real numbers and the expected result (it becomes a test case).');
  for (const name of f?.inputs ?? []) if (/received|shipped|accepted/i.test(name)) questions.push(`Does "${name}" mean all received quantity, or only accepted (after QC) quantity?`);
  const confidence = txn && (!isCalc || f) && output ? 'high' : txn || f ? 'medium' : 'low';
  const validInputs = check ? [titleCase(check.a), /^\d+(\.\d+)?$/.test(check.b) ? '' : titleCase(check.b)].filter(Boolean) : [];
  const opWord: Record<string, string> = { '<=': 'must not be more than', '>=': 'must not be less than', '<': 'must be less than', '>': 'must be more than', '==': 'must equal' };
  return {
    category, module: txn?.module ?? '', transaction: txn?.title ?? '', transactionId: txn?.id ?? null, output: titleCase(output), inputs: f?.inputs ?? validInputs,
    formula: f ? `${titleCase(output || 'Result')} = ${rhs.replace(/\bminus\b/gi, '−').replace(/\bplus\b/gi, '+').trim()}` : check ? `${titleCase(check.a)} ${opWord[check.op]} ${/^\d/.test(check.b) ? check.b : titleCase(check.b)}` : '',
    expression: f ? `${snake(output || 'result')} = ${f.expr}` : check ? `valid = IF(${snake(check.a)} ${check.op} ${/^\d+(\.\d+)?$/.test(check.b) ? check.b : snake(check.b)}, 1, 0)` : '',
    purpose, conditions: cond, exceptions: exc, unit, example, missing, questions, confidence,
  };
}

/** Stored rules about the same output or transaction, with a plain description of the difference. */
export function relatedRules(u: RuleUnderstanding): RelatedRule[] {
  const out: RelatedRule[] = [];
  if (!u.output && !u.transactionId) return out;
  const rows = all<{ id: string }>("SELECT DISTINCT id FROM entries WHERE type = 'rule' AND (is_current = 1 OR file LIKE 'review/%')");
  const outN = normalize(u.output);
  for (const { id } of rows) {
    const e = getEntry(id);
    if (!e) continue;
    const formula = e.fields['FORMULA / LOGIC'] ?? '';
    const lhs = normalize(formula.split('=')[0] ?? '');
    const sameTxn = !!u.transaction && !!e.txn && normalize(e.txn) === normalize(u.transaction);
    const sameOut = !!outN && (normalize(e.title) === outN || lhs === outN || normalize(e.fields['OUTPUT'] ?? '') === outN || lhs.replace(/\bqty\b/g, 'quantity') === outN.replace(/\bqty\b/g, 'quantity'));
    // a validation about a field is not a competing formula for that field: only the same kind of rule can conflict
    const sameKind = (e.category ?? '').toLowerCase().startsWith(u.category.toLowerCase().slice(0, 5));
    if (sameOut && sameKind && (sameTxn || !u.transaction)) {
      const key = (x: string) => normalize(x.replace(/\(.*?\)/g, ' ')).split(' ').filter(Boolean).map(stem).join(' ');
      const listed = (e.fields['INPUT FIELDS'] ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
      const theirsRaw = listed.length ? listed : (formula.split('=')[1] ?? '').split(/[+−\-×÷*/]+/).map((x) => x.trim()).filter(Boolean);
      const theirs = new Map(theirsRaw.map((x) => [key(x), x]));
      const mineRaw = new Map(u.inputs.map((x) => [key(x), x]));
      const mine = new Set(mineRaw.keys());
      const onlyTheirs = [...theirs.keys()].filter((x) => !mine.has(x)).map((x) => theirs.get(x)!), onlyMine = [...mine].filter((x) => !theirs.has(x)).map((x) => mineRaw.get(x)!);
      const diff = onlyTheirs.length || onlyMine.length ? `The stored rule ${onlyTheirs.length ? `also uses ${onlyTheirs.join(', ')}` : ''}${onlyTheirs.length && onlyMine.length ? '; ' : ''}${onlyMine.length ? `does not use ${onlyMine.join(', ')}` : ''}.` : 'Same inputs; check the operators.';
      out.push({ id: e.id, title: e.title, version: e.version, status: e.status, formula, relation: 'same-output', difference: diff });
    } else if (sameTxn && e.category === u.category) {
      out.push({ id: e.id, title: e.title, version: e.version, status: e.status, formula, relation: 'same-transaction', difference: '' });
    }
  }
  return out.sort((a, b) => (a.relation === 'same-output' ? 0 : 1) - (b.relation === 'same-output' ? 0 : 1)).slice(0, 8);
}

function suggestId(u: RuleUnderstanding): string {
  const txn = u.transactionId ? u.transactionId.replace(/^TXN-/, '') : idPart(u.module || 'GENERAL');
  const prefix = u.category === 'Calculation' ? 'CALC' : u.category === 'Validation' ? 'VAL' : 'RULE';
  const base = `${prefix}-${txn}-${idPart(u.output || 'RULE')}`.slice(0, 70);
  let id = base, n = 2;
  while (all('SELECT 1 FROM entries WHERE id = ? LIMIT 1', id).length) id = `${base}-${n++}`;
  return id;
}

/** Prepares a reviewable draft from a plain-language statement. Nothing is saved. */
export function proposeRule(text: string, author: string): RuleProposal {
  const u = understandRule(text);
  const related = relatedRules(u);
  const sameOut = related.find((r) => r.relation === 'same-output');
  const id = suggestId(u);
  const fields: Record<string, string> = Object.fromEntries(RULE_KEYS.map((k) => [k, '']));
  Object.assign(fields, {
    'RULE ID': id, 'RULE NAME': u.output ? `${u.output} ${u.category === 'Validation' ? 'validation' : 'calculation'}` : clipWords(text, 8),
    MODULE: u.module, TRANSACTION: u.transaction, 'RULE CATEGORY': u.category, 'BUSINESS PURPOSE': u.purpose,
    'APPLICABLE CONDITIONS': u.conditions, 'INPUT FIELDS': u.inputs.join('\n'), 'FORMULA / LOGIC': u.formula || text.trim(),
    'UNIT OF MEASUREMENT': u.unit, OUTPUT: u.output, EXAMPLE: u.example, 'EXCEPTION CONDITIONS': u.exceptions,
    'RELATED TRANSACTIONS': u.transaction, 'RELATED RULES': related.map((r) => r.id).join(', '),
    SOURCE: `Product owner, ${today()}: "${text.trim()}"`, VERSION: '1', STATUS: 'Draft', 'CREATED DATE': today(), 'LAST UPDATED': today(),
  });
  if (u.expression) {
    fields['CALC INPUTS'] = u.inputs.map((i) => `${snake(i)} | ${i} | ${/%|pct|percent/i.test(i) ? 'percent' : 'quantity'} | required`).join('\n');
    fields['EXPRESSION'] = u.expression;
    fields['CALC OUTPUT'] = u.category === 'Validation' ? 'valid' : snake(u.output || 'result');
  }
  if (u.missing.length) fields['OPEN QUESTION'] = u.missing.join('\n');
  if (sameOut) fields['CONFLICT'] = `A stored rule gives ${sameOut.title} differently: ${sameOut.id} v${sameOut.version} (${sameOut.status}): ${sameOut.formula}. ${sameOut.difference}`;
  const order = [...RULE_KEYS.filter((k) => !['SOURCE', 'VERSION', 'STATUS', 'CREATED DATE', 'LAST UPDATED'].includes(k)), 'CALC INPUTS', 'EXPRESSION', 'CALC OUTPUT', 'OPEN QUESTION', 'CONFLICT', 'SOURCE', 'VERSION', 'STATUS', 'CREATED DATE', 'LAST UPDATED'].filter((k) => k in fields);
  const draft = makeEntry('rule', id, fields, order);
  const problems = validateEntry(draft);
  try { parseSpec(draft.fields); } catch (e) { problems.push(`Expression: ${(e as CalcError).message}`); }
  const questions = [...u.questions];
  if (sameOut) questions.unshift(`Is this a correction of ${sameOut.id} (a new version replaces it after approval), or a different rule?`);
  u.questions = questions;
  // file: where the stored rules of the same transaction and category already live, else the default for the category
  const sibling = related.map((r) => getEntry(r.id)).find((e) => e && e.category === u.category && !e.file.startsWith('review/') && !e.file.startsWith('history/'));
  return { understanding: u, related, draft, draftText: serialize(draft), problems, suggestedFile: sibling?.file ?? defaultFileFor(draft), correctionOf: sameOut?.id ?? null };
}

const clipWords = (s: string, n: number) => s.split(/\s+/).slice(0, n).join(' ');
const serialize = (e: Entry) => toText(e);
function toText(e: Entry): string {
  const lines: string[] = [];
  for (const k of [e.idKey, ...e.order.filter((x) => x !== e.idKey)]) {
    const v = e.fields[k] ?? '';
    if (v.includes('\n')) { lines.push(`${k}:`); for (const l of v.split('\n')) lines.push(`  ${l}`); } else lines.push(v ? `${k}: ${v}` : `${k}:`);
  }
  return lines.join('\n');
}

// ── lifecycle ─────────────────────────────────────────────────────────
const CAN_DRAFT: Role[] = ['admin', 'approver', 'editor'];
const CAN_APPROVE: Role[] = ['admin', 'approver'];
const TRANSITIONS: Record<string, { to: string; roles: Role[] }[]> = {
  Draft: [{ to: 'Under Review', roles: CAN_DRAFT }, { to: 'Approved', roles: CAN_APPROVE }, { to: 'Active', roles: CAN_APPROVE }, { to: 'Rejected', roles: CAN_APPROVE }, { to: 'Archived', roles: CAN_DRAFT }],
  'Under Review': [{ to: 'Draft', roles: CAN_DRAFT }, { to: 'Approved', roles: CAN_APPROVE }, { to: 'Active', roles: CAN_APPROVE }, { to: 'Rejected', roles: CAN_APPROVE }, { to: 'Archived', roles: CAN_DRAFT }],
  Approved: [{ to: 'Active', roles: CAN_APPROVE }, { to: 'Under Review', roles: CAN_APPROVE }, { to: 'Archived', roles: CAN_APPROVE }],
  Active: [{ to: 'Superseded', roles: CAN_APPROVE }, { to: 'Archived', roles: CAN_APPROVE }],
  Superseded: [], Rejected: [], Archived: [],
};
export const allowedTransitions = (from: string, role: Role) => (TRANSITIONS[from] ?? []).filter((t) => t.roles.includes(role)).map((t) => t.to);

function locate(id: string, version?: number): { file: string; entry: Entry } {
  const rows = all<{ file: string; version: number }>("SELECT file, version FROM entries WHERE id = ? AND file NOT LIKE 'history/%' ORDER BY version DESC", id);
  const row = version ? rows.find((r) => Number(r.version) === version) : rows[0];
  if (!row) throw new RuleError(`Entry ${id}${version ? ` v${version}` : ''} was not found.`, 404);
  const { entries } = readFileEntries(row.file);
  const entry = entries.find((e) => e.id === id && versionOf(e) === Number(row.version));
  if (!entry) throw new RuleError(`Entry ${id} is indexed but missing from ${row.file}; run a re-index.`, 409);
  return { file: row.file, entry };
}

/** Saves a new draft (a new entry, or version n+1 of an existing one) to review/pending.txt. */
export function saveDraft(raw: Entry | string, user: string, role: Role, reason = ''): { id: string; version: number; file: string } {
  if (!CAN_DRAFT.includes(role)) throw new RuleError('Your role cannot create or edit knowledge.', 403);
  const entry = typeof raw === 'string' ? parseOne(raw) : raw;
  const existing = all<{ version: number; file: string; status: string }>('SELECT version, file, status FROM entries WHERE id = ? ORDER BY version DESC', entry.id);
  const pending = existing.find((r) => r.file === PENDING_FILE);
  let version = existing.length ? Math.max(...existing.map((r) => Number(r.version))) + (pending ? 0 : 1) : 1;
  if (pending) version = Number(pending.version); // editing the pending draft in place (it is not confirmed knowledge)
  entry.fields['VERSION'] = String(version);
  entry.fields['STATUS'] = 'Draft';
  entry.fields['LAST UPDATED'] = today();
  entry.fields['CREATED DATE'] ||= today();
  if (!entry.order.includes('VERSION')) entry.order.push('VERSION', 'STATUS', 'LAST UPDATED');
  const problems = validateEntry(entry).filter((p) => !/STATUS|VERSION/.test(p));
  if (entry.fields['EXPRESSION']) { try { parseSpec(entry.fields); } catch (e) { problems.push(`Expression: ${(e as Error).message}`); } }
  if (problems.length) throw new RuleError(`The entry is not valid: ${problems.join(' ')}`);
  if (pending) {
    const prev = takeEntry(PENDING_FILE, entry.id, String(version));
    if (prev) appendHistory(prev, `draft v${version} edited by ${user}`);
  }
  putEntry(PENDING_FILE, entry, PENDING_HEADER);
  recordChange({ entry_id: entry.id, action: pending ? 'draft-edited' : existing.length ? 'new-version-drafted' : 'draft-created', from_version: existing.length ? Number(existing[0].version) : null, to_version: version, from_status: pending ? 'Draft' : existing[0]?.status ?? null, to_status: 'Draft', changed_by: user, reason, source: entry.fields['SOURCE'], file: PENDING_FILE });
  indexLibrary();
  return { id: entry.id, version, file: PENDING_FILE };
}

function parseOne(text: string): Entry {
  const r = parseTxt(text.includes('ID:') ? text : '', 'editor');
  if (r.entries.length !== 1) throw new RuleError(r.entries.length ? 'Paste exactly one entry.' : `No entry found: an entry starts with an ID line such as "RULE ID: CALC-RMPO-OPEN-QTY". ${r.problems.map((p) => p.message).join(' ')}`);
  return r.entries[0];
}

/** Moves an entry version through the lifecycle. Activating writes it to its category file and supersedes the old version. */
export function transition(id: string, version: number | undefined, to: string, user: string, role: Role, reason = ''): { id: string; version: number; status: string; file: string; superseded?: number } {
  const { file, entry } = locate(id, version);
  const from = statusOf(entry);
  if (!allowedTransitions(from, role).includes(to)) throw new RuleError(`${from} → ${to} is not allowed for role ${role}. Allowed: ${allowedTransitions(from, role).join(', ') || 'none'}.`, 403);
  if (['Approved', 'Active'].includes(to)) {
    const problems = validateEntry({ ...entry, fields: { ...entry.fields, STATUS: to } });
    if (problems.length) throw new RuleError(`Cannot ${to === 'Active' ? 'activate' : 'approve'}: ${problems.join(' ')}`);
    if (entry.fields['EXPRESSION']) { try { parseSpec(entry.fields); } catch (e) { throw new RuleError(`Cannot approve: the expression is invalid (${(e as Error).message}).`); } }
  }
  const v = versionOf(entry);
  entry.fields['STATUS'] = to;
  entry.fields['LAST UPDATED'] = today();
  if (to === 'Approved' || to === 'Active') entry.fields['APPROVED BY'] = `${user} on ${today()}`;
  if (to === 'Approved' || to === 'Active') { if (!entry.order.includes('APPROVED BY')) entry.order.splice(entry.order.indexOf('SOURCE') >= 0 ? entry.order.indexOf('SOURCE') : entry.order.length, 0, 'APPROVED BY'); }
  let target = file;
  let superseded: number | undefined;
  if (to === 'Active') {
    // the version in force moves to history as Superseded; the new one takes its place in the category file
    const current = all<{ version: number; file: string }>("SELECT version, file FROM entries WHERE id = ? AND status = 'Active' AND file NOT LIKE 'history/%' AND file <> ?", id, PENDING_FILE)[0];
    target = current?.file ?? (file === PENDING_FILE ? defaultFileFor(entry) : file);
    if (current) {
      const old = takeEntry(current.file, id, String(current.version));
      if (old) {
        old.fields['STATUS'] = 'Superseded';
        old.fields['SUPERSEDED BY'] = `v${v} on ${today()} (${user})`;
        appendHistory(old, `superseded by v${v}`);
        superseded = Number(current.version);
        recordChange({ entry_id: id, action: 'superseded', from_version: superseded, to_version: v, from_status: 'Active', to_status: 'Superseded', changed_by: user, reason, file: current.file });
      }
    }
    if (file === PENDING_FILE) takeEntry(PENDING_FILE, id, String(v));
    putEntry(target, entry, [`Knowledge file for ${entry.fields['MODULE'] || 'general'} rules. Format: documentation/ARCHITECTURE.md §4.`]);
  } else if (to === 'Rejected' || to === 'Superseded') {
    takeEntry(file, id, String(v));
    appendHistory(entry, `${to.toLowerCase()} by ${user}${reason ? `: ${reason}` : ''}`);
    target = `${KDIRS.history}/${id}.txt`;
  } else {
    putEntry(file, entry);
  }
  recordChange({ entry_id: id, action: `status:${to}`, from_version: v, to_version: v, from_status: from, to_status: to, changed_by: user, reason, source: entry.fields['SOURCE'], file: target });
  indexLibrary();
  return { id, version: v, status: to, file: target, superseded };
}

/** What depends on an entry: transactions, fields, rules, workflows, data models and documents. */
export function impactOf(id: string): { entry: string; items: { type: string; id: string; title: string; how: string }[] } {
  const e = getEntry(id);
  if (!e) throw new RuleError(`Entry ${id} was not found.`, 404);
  const items: { type: string; id: string; title: string; how: string }[] = [];
  const rel = relationsOf(id);
  for (const r of rel.outgoing) items.push({ type: r.toType, id: r.toId, title: r.otherTitle ?? r.toId, how: `${r.rel} (${r.basis})` });
  for (const r of rel.incoming) items.push({ type: r.fromType, id: r.fromId, title: r.otherTitle ?? r.fromId, how: `${r.rel} (${r.basis})` });
  const txn = e.type === 'transaction' ? e : e.txn ? findTransaction(e.txn) : undefined;
  if (txn && txn.id !== id) {
    const tr = relationsOf(txn.id);
    for (const r of tr.incoming.filter((x) => x.rel === 'includes')) items.push({ type: 'workflow', id: r.fromId, title: r.otherTitle ?? r.fromId, how: `includes ${txn.title}` });
    for (const r of tr.outgoing.filter((x) => x.rel === 'feeds')) items.push({ type: 'transaction', id: r.toId, title: r.otherTitle ?? r.toId, how: `downstream of ${txn.title}` });
    for (const r of tr.incoming.filter((x) => x.rel === 'mentions')) items.push({ type: 'document', id: r.fromId, title: r.otherTitle ?? r.fromId, how: `discusses ${txn.title}` });
  }
  // entries that name this ID in their text
  for (const r of all<{ id: string; title: string; type: string }>("SELECT id, title, type FROM entries WHERE is_current = 1 AND id <> ? AND fields LIKE ?", id, `%${id}%`)) {
    if (!items.some((x) => x.id === r.id)) items.push({ type: r.type, id: r.id, title: r.title, how: `refers to ${id}` });
  }
  const seen = new Set<string>();
  return { entry: id, items: items.filter((x) => { const k = `${x.type}:${x.id}:${x.how}`; if (seen.has(k)) return false; seen.add(k); return true; }) };
}
