// Question variations for a knowledge unit. Each question is built from what the unit's own text establishes: a
// "why can't I …" question only when the source states a restriction, "are remarks mandatory …" only when it says
// remarks are required, "where is …" only when it names a screen, a terminology variant only through an alias or
// abbreviation a document spells out. So the count follows the knowledge: a short definition gets a few questions,
// an action with conditions, outcomes and a screen gets many. Generated questions are proposals: a reviewer can
// approve, reject, edit or add (knowledge/enrichment/review.json).
import { normalize } from '../search/lexicon.ts';
import type { Term } from './terminology.ts';
import type { UnitDraft } from './units.ts';

export type QCategory = 'direct' | 'conversational' | 'informal' | 'problem' | 'process' | 'technical' | 'terminology' | 'short' | 'contextual';
export interface QDraft { text: string; category: QCategory; origin: 'canonical' | 'template' }

const VERBS: Record<string, string> = { add: 'adding', cancel: 'cancelling', close: 'closing', copy: 'copying', delete: 'deleting', reopen: 'reopening', split: 'splitting',
  update: 'updating', revise: 'revising', run: 'running', export: 'exporting', approve: 'approving', create: 'creating', configure: 'configuring', receive: 'receiving',
  dispatch: 'dispatching', generate: 'generating', print: 'printing', link: 'linking', attach: 'attaching', sync: 'syncing', import: 'importing' };
/** Verb synonyms a user may say instead (language only, never a different WFX action). */
const VERB_SAYS: Record<string, string[]> = { delete: ['remove'], cancel: ['void'], copy: ['duplicate'], update: ['change', 'edit'], create: ['make', 'add'], add: ['create'], reopen: ['open again'], close: ['complete'] };

interface Facts { restrict: boolean; enabledOnly: boolean; remarks: boolean; outcome: boolean; prereq: boolean; confirm: boolean; where: boolean; steps: boolean; validations: boolean; related: boolean; example: boolean; inputs: boolean }

function factsOf(u: UnitDraft): Facts {
  const t = ` ${normalize(u.answer)} `;
  return {
    restrict: /\b(cannot|can not|cant|not allowed|refused|never|until|only a|only when|only for|only if|is disabled|are disabled|must|not editable|blocked)\b/.test(t),
    enabledOnly: /\b(enabled only|only enabled|disabled)\b/.test(t),
    remarks: /\bremarks?\b/.test(t) && /\b(required|mandatory)\b/.test(t),
    outcome: /\b(status (becomes|turns|is)|becomes|turns|is created|are created|creates|is cancelled|are cancelled)\b/.test(t),
    prereq: /\b(before|first|only after|prerequisite|must be)\b/.test(t),
    confirm: /\b(confirmation|confirm|do you want)\b/.test(t),
    where: !!u.screen,
    steps: !!u.f['STEPS'] || /\b(1\.|step)\b/.test(t),
    validations: u.aspect === 'validations' || !!u.f['VALIDATIONS'],
    related: u.relatedModules.length > 0,
    example: !!u.f['EXAMPLE'],
    inputs: !!(u.f['CALC INPUTS'] || u.f['INPUT FIELDS']),
  };
}

/** Documented other names for words and phrases of a text (aliases and abbreviations, both directions). */
function altNames(phrase: string, terms: Term[]): string[] {
  const n = normalize(phrase);
  const out = new Set<string>();
  for (const t of terms) {
    if (!['alias', 'abbreviation'].includes(t.kind)) continue;
    // ambiguous abbreviations (several documented meanings) are not offered as variants
    if (t.kind === 'abbreviation' && terms.filter((x) => x.kind === 'abbreviation' && x.norm === t.norm).length > 1) continue;
    if (t.norm === t.canonical) continue;
    const re = (s: string) => new RegExp(`\\b${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const shown = (s: string) => (s.length <= 6 && !s.includes(' ') ? s.toUpperCase() : s);
    // a one-word name is only swapped when it IS the phrase ("delivery" → "delivery OC", not inside "OC Delivery Date")
    const fits = (s: string) => s.includes(' ') ? re(s).test(n) : n === s;
    if (fits(t.canonical)) out.add(n.replace(re(t.canonical), shown(t.norm)));
    else if (fits(t.norm)) out.add(n.replace(re(t.norm), t.canonical));
  }
  return [...out].filter((x) => x !== n).slice(0, 3);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Lower case except abbreviations and codes: "Close Sales Order" → "close sales order", "OC Notes" → "OC notes". */
const lc = (s: string) => s.split(' ').map((w) => (/^[A-Z0-9][A-Z0-9.&/-]+$/.test(w) && /[A-Z]/.test(w) && w.length <= 6 ? w : w.toLowerCase())).join(' ');

const PAST: Record<string, string> = { closed: 'close', typed: 'type', edited: 'edit', deleted: 'delete', selected: 'select', changed: 'change', cancelled: 'cancel', reopened: 'reopen',
  added: 'add', created: 'create', used: 'use', mixed: 'mix', modified: 'modify', saved: 'save', entered: 'enter', copied: 'copy', removed: 'remove', moved: 'move', revised: 'revise',
  approved: 'approve', confirmed: 'confirm', received: 'receive', shipped: 'ship', updated: 'update', linked: 'link', split: 'split', chosen: 'choose', issued: 'issue', transferred: 'transfer' };

/** Verbs the source itself restricts: "never typed" → type, "cannot be closed" → close, "is disabled" → use. */
function restrictedVerbs(answer: string): string[] {
  const out = new Set<string>();
  for (const m of normalize(answer).matchAll(/\b(?:cannot|can not|cant|never|not allowed to|must not)\s+(?:be\s+)?([a-z]{3,})/g)) {
    // only verbs whose base form is known; an unknown word is skipped rather than guessed
    const v = PAST[m[1]] ?? (Object.values(PAST).includes(m[1]) ? m[1] : undefined);
    if (v) out.add(v);
  }
  return [...out].slice(0, 2);
}

export function generateQuestions(u: UnitDraft, terms: Term[]): QDraft[] {
  const q: QDraft[] = [];
  const add = (category: QCategory, text: string, origin: QDraft['origin'] = 'template') => q.push({ text: cap(text.replace(/\s+/g, ' ').trim()), category, origin });
  const fx = factsOf(u);
  const T = u.topic.replace(/\s*\?$/, '').replace(/\s*\((?!.*\?).*?\)/g, '').trim() || u.topic;
  const words = T.split(' ');
  const verb = words[0].toLowerCase();
  const isAction = !!VERBS[verb] && words.length >= 2 && !T.includes('/') && u.aspect !== 'calculation' && u.kind !== 'procedure';
  const where = u.screen ? u.screen.split(/;/)[0].trim() : '';

  if (u.kind === 'procedure') {
    // the procedure title is already a question; its topic phrases the rest
    const title = (u.f['TITLE'] ?? T).trim();
    add('direct', title, 'canonical');
    const topic = lc(T);
    add('conversational', `Can you explain ${topic}?`);
    add('short', `${topic}?`);
    // the title's own action, said other ways: "How do I receive a sample …?" → "how to receive a sample …", "steps to …"
    const how = title.match(/^How (?:do|can|should) I (.+?)\??$/i);
    if (how) { const act = how[1]; add('informal', `how to ${act}`); add('informal', `I want to ${act}`); add('process', `steps to ${act}`); add('short', act); }
    const what = title.match(/^What (?:is|are) (.+?)\??$/i);
    if (what) add('short', what[1]);
    const wh = title.match(/^(?:What|Where|Why|When) .+?\?$/i);
    if (wh && !what) add('informal', title.replace(/\?$/, '').toLowerCase());
    if (fx.steps && !how) add('process', `What are the steps for ${topic}?`);
    if (fx.where) add('direct', `Where do I find ${topic} in WFX?`);
    for (const v of restrictedVerbs(u.answer)) add('problem', `Why can't I ${v} ${topic}?`);
    if (/\b(not allowed|duplicate)\b/.test(normalize(u.answer))) add('problem', `What is not allowed in ${topic}?`);
    for (const alt of altNames(topic, terms)) add('terminology', `${cap(alt)}?`);
    return dedupe(q);
  }

  if (u.aspect === 'calculation') {
    // the readable output name ("Total Value"), not the formula's code name ("total_value")
    const out = lc(clean(u.f['OUTPUT'] || (u.f['FORMULA / LOGIC'] ?? '').split('=')[0] || (u.f['CALC OUTPUT'] ?? '').replace(/_/g, ' ')) || T);
    add('direct', `How is ${out} calculated?`, 'canonical');
    add('direct', `What is the formula for ${out}?`);
    add('conversational', `How does the system work out ${out}?`);
    add('short', `${out} formula`);
    add('short', `${lc(T)} calculation`);
    if (fx.inputs) add('technical', `Which values are used to calculate ${out}?`);
    if (fx.example) add('technical', `Can you show an example of ${lc(T)}?`);
    for (const alt of altNames(out, terms)) add('terminology', `How is ${alt} calculated?`);
    return dedupe(q);
  }

  if (u.aspect === 'validations') {
    add('technical', `What validations apply to ${lc(T)}?`, 'canonical');
    add('technical', `What is checked for ${lc(T)}?`);
    add('problem', `Why is ${lc(T)} not allowed?`);
    add('problem', `${lc(T)} error – what should I check?`);
    add('short', `${lc(T)} validations`);
    return dedupe(q);
  }

  if (u.kind === 'transaction') {
    const t = lc(T);
    if (u.aspect === 'overview') { add('direct', `What is ${t}?`, 'canonical'); add('conversational', `What is ${t} used for?`); add('short', `${t}?`); for (const alt of altNames(t, terms)) add('terminology', `What is ${alt}?`); }
    if (u.aspect === 'process') { add('process', `What is the process of ${t}?`, 'canonical'); add('direct', `Where is ${t} in WFX?`); add('process', `Steps of ${t}`); }
    if (u.aspect === 'dependencies') { add('contextual', `What comes before and after ${t}?`, 'canonical'); add('contextual', `What does ${t} depend on?`); add('contextual', `What happens after ${t}?`); add('contextual', `Is ${t} connected to other modules?`); }
    return dedupe(q);
  }

  if (isAction) {
    const O = lc(words.slice(1).join(' '));
    const Ving = VERBS[verb];
    const a = /^(a|an|the)\b/.test(O) ? O : `the ${O}`;
    add('direct', `How do I ${verb} ${a}?`, 'canonical');
    add('direct', `What does ${T} do?`);
    add('conversational', `Can you explain how ${Ving} ${a} works?`);
    add('informal', `how to ${verb} ${O}`);
    add('short', `${verb} ${O}`);
    if (fx.where) { add('direct', `Where is the ${T} option?`); add('informal', `where do I ${verb} ${a}`); }
    if (fx.outcome) add('process', `What happens after I ${verb} ${a}?`);
    if (fx.prereq) add('process', `What must be done before ${Ving} ${a}?`);
    if (fx.steps || fx.confirm) add('process', `What are the steps to ${verb} ${a}?`);
    if (fx.restrict) { add('problem', `Why can't I ${verb} ${a}?`); add('problem', `When is ${Ving} ${a} not allowed?`); add('problem', `What should I check if I cannot ${verb} ${a}?`); }
    for (const v of restrictedVerbs(u.answer).filter((x) => x !== verb)) add('problem', `Why can't I ${v} ${a}?`);
    if (fx.enabledOnly) add('problem', `Why is ${T} disabled?`);
    if (fx.remarks) add('technical', `Are remarks mandatory when ${Ving} ${a}?`);
    if (fx.confirm) add('technical', `Does the system ask for a confirmation before ${Ving} ${a}?`);
    if (fx.validations) add('technical', `What validations apply when ${Ving} ${a}?`);
    for (const s of (VERB_SAYS[verb] ?? []).slice(0, 2)) add('terminology', `How do I ${s} ${a}?`);
    for (const alt of altNames(O, terms)) add('terminology', `How do I ${verb} the ${alt}?`);
    if (fx.related) add('contextual', `Does ${Ving} ${a} affect other modules?`);
    return dedupe(q);
  }

  // a feature, field, structure or term
  const t = lc(T);
  add('direct', `What is ${t}?`, 'canonical');
  add('direct', `What does ${t} mean?`);
  add('conversational', `How does ${t} work?`);
  add('conversational', `Can you explain ${t}?`);
  add('short', `${t}?`);
  if (fx.where) { add('direct', `Where is ${t} in WFX?`); add('informal', `where do I find ${t}`); add('informal', `where is ${t} set`); }
  for (const v of restrictedVerbs(u.answer)) add('problem', `Why can't I ${v} ${t}?`);
  if (fx.restrict) add('problem', `What restrictions apply to ${t}?`);
  if (fx.enabledOnly) add('problem', `Why is ${t} disabled?`);
  if (fx.outcome) add('process', `What happens with ${t}?`);
  if (fx.steps) add('process', `What are the steps for ${t}?`);
  if (fx.validations) add('technical', `What validations apply to ${t}?`);
  if (fx.related) add('contextual', `How is ${t} linked to other modules?`);
  for (const alt of altNames(t, terms)) { add('terminology', `What is ${alt}?`); add('terminology', `${alt} meaning`); }
  return dedupe(q);
}

function clean(s: string): string { return s.replace(/\s*\(.*?\)/g, '').replace(/[:=].*$/, '').replace(/\s+/g, ' ').trim(); }

function dedupe(q: QDraft[]): QDraft[] {
  const seen = new Set<string>();
  return q.filter((x) => { const n = normalize(x.text); if (!n || seen.has(n)) return false; seen.add(n); return true; });
}
