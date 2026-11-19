// Knowledge units: the answerable pieces of the TXT library. Entries that say the same thing (a rule, its "(action)"
// twin and the glossary term of the same name) become one unit with the rule as its primary source; a transaction is
// cut into overview, process and dependency units; a rule with its own validations gets a validations unit. Every
// answer is the source fields' own text, labelled, so it can be checked word for word against the entry.
import crypto from 'node:crypto';
import { all } from '../db.ts';
import { CONFIRMED } from '../knowledge/txt.ts';
import { normalize } from '../search/lexicon.ts';

export type Aspect = 'overview' | 'validations' | 'calculation' | 'process' | 'dependencies' | 'definition';
export interface EntryLite { id: string; type: string; title: string; module: string; submodule: string; status: string; file: string; version: number; f: Record<string, string> }
export interface UnitDraft {
  id: string; module: string; submodule: string; topic: string; aspect: Aspect; kind: string;
  answer: string; answerParts: { entryId: string; field: string; text: string }[];
  entryIds: string[]; screen: string; relatedModules: string[]; keywords: string[];
  sourceRef: string; sourceHash: string; entryStatus: string; confidence: 'high' | 'medium' | 'low';
  f: Record<string, string>;
}

const META = new Set(['SOURCE', 'SOURCE DOCUMENT', 'VERSION', 'STATUS', 'CREATED DATE', 'LAST UPDATED', 'APPROVED BY', 'VERIFICATION', 'GROUP']);
/** Fields that carry the answer, per entry type, in reading order. */
const ANSWER_FIELDS: Record<string, string[]> = {
  rule: ['BUSINESS PURPOSE', 'FORMULA / LOGIC', 'EXPRESSION', 'TRIGGER CONDITION', 'APPLICABLE CONDITIONS', 'INPUT FIELDS', 'CALC INPUTS', 'OUTPUT', 'CALC OUTPUT', 'EXAMPLE', 'EXPECTED RESULT', 'SCREEN / LOCATION'],
  term: ['DEFINITION'],
  procedure: ['CONTENT', 'STEPS', 'WHERE IN WFX', 'NOTES'],
  case: ['SCENARIO', 'DESCRIPTION', 'CONTENT', 'OUTCOME', 'RESULT', 'NOTES'],
  workflow: ['PURPOSE', 'DESCRIPTION', 'WORKFLOW STEPS', 'STEPS'],
};
const VALIDATION_FIELDS = ['VALIDATIONS', 'EXCEPTION CONDITIONS'];
const TXN_ASPECTS: [Aspect, string[]][] = [
  ['overview', ['ONE LINE', 'PURPOSE', 'BUSINESS CONTEXT', 'FACTS']],
  ['process', ['NAVIGATION PATH', 'STEP', 'CALCULATIONS']],
  ['dependencies', ['UPSTREAM', 'DOWNSTREAM']],
];
const PRIMARY_RANK = (e: EntryLite) => (e.type === 'procedure' ? 0 : e.type === 'transaction' ? 1 : e.type === 'rule' && !/\(action\)/i.test(e.title) ? 2 : e.type === 'rule' ? 3 : e.type === 'case' ? 4 : 5);

export const clusterKey = (title: string) => normalize(title.replace(/\(action\)/i, '').replace(/\s*\(.*?\)\s*/g, ' '));

export function loadEntries(module?: string): EntryLite[] {
  const rows = all<{ id: string; type: string; title: string; module: string | null; submodule: string | null; status: string; file: string; version: number; fields: string }>(
    `SELECT id, type, title, module, submodule, status, file, version, fields FROM entries WHERE is_current = 1 ${module ? 'AND module = ?' : ''} ORDER BY id`, ...(module ? [module] : []));
  return rows.map((r) => ({ id: r.id, type: r.type, title: r.title, module: r.module ?? '', submodule: (r.submodule ?? '').replace(/\s*\(.*?\)/g, ''), status: r.status, file: r.file, version: Number(r.version),
    f: (JSON.parse(r.fields) as { fields: Record<string, string> }).fields }));
}

const clean = (s: string | undefined) => (s ?? '').replace(/[ \t]+/g, ' ').trim();
const hash = (s: string) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 16);

function partsOf(e: EntryLite, fields: string[]) {
  return fields.map((k) => ({ entryId: e.id, field: k, text: clean(e.f[k]) })).filter((p) => p.text.length > 0);
}

function render(parts: UnitDraft['answerParts']): string {
  const label = (k: string) => ({ 'FORMULA / LOGIC': 'How it works', 'BUSINESS PURPOSE': 'Purpose', 'SCREEN / LOCATION': 'Where in WFX', 'WHERE IN WFX': 'Where in WFX', 'NAVIGATION PATH': 'Where in WFX', CONTENT: 'How it works', DEFINITION: 'Meaning', 'ONE LINE': 'In one line', EXPRESSION: 'Formula' } as Record<string, string>)[k] ?? k.charAt(0) + k.slice(1).toLowerCase();
  return parts.map((p) => `${label(p.field)}: ${p.text}`).join('\n');
}

function confidenceOf(status: string, answer: string, hasWhere: boolean): UnitDraft['confidence'] {
  const words = answer.split(/\s+/).length;
  if (words < 12) return 'low';
  if (!CONFIRMED.includes(status)) return 'medium';
  return words >= 25 || hasWhere ? 'high' : 'medium';
}

function relatedModules(e: EntryLite, moduleNames: string[]): string[] {
  const text = `${e.f['RELATED TRANSACTIONS'] ?? ''} ${e.f['UPSTREAM'] ?? ''} ${e.f['DOWNSTREAM'] ?? ''}`;
  return moduleNames.filter((m) => m !== e.module && normalize(text).includes(normalize(m)));
}

export function buildUnits(entries: EntryLite[], moduleNames: string[]): UnitDraft[] {
  const clusters = new Map<string, EntryLite[]>();
  for (const e of entries) {
    if (e.type === 'model' || e.type === 'field' || e.type === 'dependency') continue;
    // calculations stay apart from the rule that uses them: "how is it calculated" is its own question
    const key = `${e.module}|${e.id.startsWith('CALC-') ? 'calc:' : e.type === 'transaction' ? 'txn:' : ''}${clusterKey(e.title)}`;
    clusters.set(key, [...(clusters.get(key) ?? []), e]);
  }
  const units: UnitDraft[] = [];
  for (const members of clusters.values()) {
    members.sort((a, b) => PRIMARY_RANK(a) - PRIMARY_RANK(b));
    const p = members[0];
    const topic = p.type === 'procedure' ? clean(p.f['TOPIC']) || p.title : p.title.replace(/\s*\(action\)/i, '').trim();
    const screen = clean(p.f['SCREEN / LOCATION'] || p.f['WHERE IN WFX'] || p.f['NAVIGATION PATH']);
    const base = { module: p.module, submodule: p.submodule, topic, screen, relatedModules: relatedModules(p, moduleNames), entryStatus: p.status, f: p.f };
    const mk = (aspect: Aspect, kind: string, parts: UnitDraft['answerParts'], ids: string[]) => {
      const answer = render(parts);
      const usedFields = [...new Set(parts.map((x) => `${x.entryId}:${x.field}`))].join(', ');
      units.push({ ...base, id: `${p.id}#${aspect}`, aspect, kind, answer, answerParts: parts, entryIds: ids,
        keywords: [], sourceRef: `${p.file} · ${p.id} v${p.version} · ${usedFields}`, sourceHash: hash(answer + ids.join(',')), confidence: confidenceOf(p.status, answer, !!screen) });
    };
    if (p.type === 'transaction') {
      for (const [aspect, fields] of TXN_ASPECTS) { const parts = partsOf(p, fields); if (parts.length) mk(aspect, 'transaction', parts, [p.id]); }
      continue;
    }
    // primary's own fields, then anything a twin adds that the primary does not already say
    let parts = partsOf(p, ANSWER_FIELDS[p.type] ?? Object.keys(p.f).filter((k) => !META.has(k) && !/ ID$|NAME$|^TERM$|^TITLE$|^TOPIC$|^MODULE$|^SUBMODULE$|^TRANSACTION$|CATEGORY$|^RELATED /.test(k)));
    const said = () => normalize(parts.map((x) => x.text).join(' '));
    for (const m of members.slice(1)) {
      for (const x of partsOf(m, ANSWER_FIELDS[m.type] ?? [])) if (!said().includes(normalize(x.text)) && x.field !== 'SCREEN / LOCATION') parts.push(x);
    }
    if (!parts.length) parts = partsOf(p, ['DEFINITION', 'CONTENT']);
    const ids = members.map((m) => m.id);
    const isCalc = p.id.startsWith('CALC-') || !!p.f['EXPRESSION'];
    // validations: their own unit when there is enough to answer "what is checked"; otherwise part of the overview
    const v = members.flatMap((m) => partsOf(m, VALIDATION_FIELDS)).filter((x) => !said().includes(normalize(x.text)));
    const ownValidations = normalize(v.map((x) => x.text).join(' ')).split(' ').length >= 6;
    if (!ownValidations) parts.push(...v);
    mk(isCalc ? 'calculation' : p.type === 'term' ? 'definition' : 'overview', isCalc ? 'calculation' : p.type, parts, ids);
    if (ownValidations) mk('validations', 'validation', v, ids);
  }
  return units;
}
