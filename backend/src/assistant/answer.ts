// Knowledge-grounded answers. Retrieval picks the sources; this module composes the answer ONLY from their text,
// numbers every source, computes the knowledge status from the sources' statuses, runs calculations with the engine,
// and says plainly when the stored documentation does not support an answer. No language model is needed; when one is
// authorised, llm.ts may rewrite the answer from the same numbered sources (and is checked against them).
import { evaluate, parseSpec, parseTestCases, toNumber } from '../calc/engine.ts';
import type { CalcResult } from '../calc/engine.ts';
import { all, run } from '../db.ts';
import { toMermaid } from '../ingest/diagram.ts';
import { findTransaction, getEntry, relationsOf, titleOf } from '../knowledge/repo.ts';
import type { EntryRow } from '../knowledge/repo.ts';
import { stepsOf } from '../knowledge/txt.ts';
import { detectIntent, FILLER, INTENT_WORDS, normalize, stem, STOP, synonyms } from '../search/lexicon.ts';
import type { Intent } from '../search/lexicon.ts';
import { search } from '../search/search.ts';
import type { Hit } from '../search/search.ts';
import { nowIso } from '../util.ts';

export type Mode = 'ask' | 'transaction' | 'workflow' | 'data_model' | 'calculate';
export type Depth = 'brief' | 'standard' | 'detailed';
/** 'conversation': a greeting or general reply that is not about stored WFX knowledge. */
export type KStatus = 'confirmed' | 'documented' | 'provisional' | 'conflicting' | 'partial' | 'not-documented' | 'conversation';

export interface Section { /** Secondary detail: shown behind "More detail", not in the first view. */ extra?: boolean; kind: string; title: string; text?: string; items?: string[]; table?: { columns: string[]; rows: string[][] }; mermaid?: string; json?: unknown; refs?: number[]; calc?: CalcView }
export interface CalcView { ruleId: string; version: number; formula: string; inputs: { label: string; value: number; defaulted: boolean }[]; steps: string[]; output: string; result: number | null; warnings: string[]; errors: string[]; source: 'test case' | 'your numbers' | 'none' }
export interface Source { n: number; ref: string; title: string; kind: string; status: string; label: string; entryId: string | null; entryVersion: number | null; docId: string | null; docVersion: number | null; locator: string | null; origin: string; confirmed: boolean }
export interface Topic { title: string; terms: string[]; primaryRef?: string; entryId?: string | null; docId?: string | null; steps?: string[]; stepIndex?: number; intent?: Intent }
export interface KnowledgeAnswer {
  question: string; resolvedQuestion: string; intent: Intent; mode: Mode; title: string; status: KStatus; statusNote: string;
  sections: Section[]; sources: Source[]; missing: string[]; followUps: string[]; topic: Topic; generatedBy: string; markdown: string; corrections: Record<string, string>;
  /** Something the page should do after showing this answer (open the workflow designer on a generated draft). */
  action?: { type: string; [k: string]: unknown };
  /** Visual guides shown with the answer (screenshots, steps, markers); loaded by id from the registry. */
  cards?: { type: 'guide'; id: string; title: string; kind: string; steps: number; cover: string | null; note?: string }[];
  /** Registered destinations only (Screen Registry, stored workflows, guides), each with the permission check already done. */
  actions?: { id: string; label: string; kind: 'route' | 'external'; route?: string; query?: Record<string, string>; url?: string; allowed: boolean; reason?: string; note?: string; primary?: boolean }[];
  /** A destination the page should open straight away (the user asked to open a screen). */
  navigate?: string;
}

export const NOT_DOCUMENTED = 'The currently stored WFX documentation does not contain sufficient information to confirm this.';
const CONFIRMED = ['Active', 'Approved'];
const PROVISIONAL = ['Draft', 'Under Review', 'proposed', 'unreviewed'];

class Sources {
  list: Source[] = [];
  add(h: Hit): number {
    const found = this.list.find((s) => s.ref === h.ref);
    if (found) return found.n;
    const e = h.entryId ? getEntry(h.entryId, h.entryVersion ?? undefined) : undefined;
    const n = this.list.length + 1;
    this.list.push({
      n, ref: h.ref, title: h.title, kind: h.kind, status: h.status, label: h.sourceLabel + (h.locator && h.docId ? ` · ${h.locator}` : ''),
      entryId: h.entryId, entryVersion: h.entryVersion, docId: h.docId, docVersion: h.docVersion, locator: h.locator,
      origin: e?.fields['SOURCE'] ?? (h.docId ? `Source document ${h.docId}` : ''), confirmed: CONFIRMED.includes(h.status),
    });
    return n;
  }
}

const sentences = (t: string) => t.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])/).filter(Boolean);
const firstSentences = (t: string, n: number) => sentences(t).slice(0, n).join(' ');
const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n).replace(/\s+\S*$/, '')} …` : t);
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-US') : Number(n.toPrecision(10)).toLocaleString('en-US', { maximumFractionDigits: 6 }));

interface Parts { answer: string; explanation: string[]; steps: string[]; notes: string[] }

function entryParts(e: EntryRow): Parts {
  const f = e.fields;
  const L = (k: string, label = k.charAt(0) + k.slice(1).toLowerCase()) => (f[k]?.trim() ? `${label}: ${f[k].trim().replace(/\n/g, '; ')}` : '');
  const notes = [L('OPEN QUESTION', 'Open question'), L('CONFLICT', 'Conflict'), L('INFERENCE', 'Inference (not stated by a source)')].filter(Boolean);
  switch (e.type) {
    case 'rule': return {
      answer: f['FORMULA / LOGIC'] || f['BUSINESS PURPOSE'] || e.title,
      explanation: [L('BUSINESS PURPOSE', 'Purpose'), L('TRIGGER CONDITION', 'Trigger'), L('APPLICABLE CONDITIONS', 'Applies when'), L('VALIDATIONS', 'Validations'), L('EXCEPTION CONDITIONS', 'Exceptions'), L('UNIT OF MEASUREMENT', 'Unit'), L('ROUNDING RULE', 'Rounding'), L('SCREEN / LOCATION', 'Where in WFX'), L('OPTIONS', 'Options'), L('EXAMPLE', 'Example')].filter(Boolean),
      steps: [], notes,
    };
    case 'term': return { answer: f['DEFINITION'] ?? e.title, explanation: [L('TRANSACTION', 'Used in')].filter(Boolean), steps: [], notes };
    case 'procedure': return { answer: f['CONTENT'] ?? '', explanation: [L('WHERE IN WFX', 'Where in WFX'), L('NOTES', 'Good to know')].filter(Boolean), steps: stepsOf(f['STEPS']), notes };
    case 'transaction': return { answer: [f['PURPOSE'], f['ONE LINE']].filter(Boolean).join(' '), explanation: [f['BUSINESS CONTEXT'] ?? '', L('NAVIGATION PATH', 'Navigation'), L('KEYS', 'Keys')].filter(Boolean), steps: [], notes };
    case 'field': return { answer: f['DEFINITION'] ?? e.title, explanation: [L('FIELD TYPE', 'How it gets its value'), [f['SOURCE TRANSACTION'], f['SOURCE FIELD']].filter(Boolean).length ? `Comes from: ${[f['SOURCE TRANSACTION'], f['SOURCE FIELD']].filter(Boolean).join(' › ')}` : '', L('CALCULATION', 'Calculated by')].filter(Boolean), steps: [], notes };
    case 'workflow': return { answer: f['DESCRIPTION'] ?? e.title, explanation: [], steps: stepsOf(f['STEPS']).map((s) => { const p = s.split('|').map((x) => x.trim()); return p.length >= 4 ? `${p[3]} (${p[2]}${p[4] && p[4] !== 'transaction: -' ? `, ${p[4]}` : ''})` : s; }), notes };
    case 'model': return { answer: f['SUMMARY'] ?? e.title, explanation: [L('SCREEN', 'Screen'), L('MODEL LEVEL', 'Level')].filter(Boolean), steps: [], notes };
    case 'case': return { answer: f['DESCRIPTION'] ?? '', explanation: [L('NOTES', 'Notes')].filter(Boolean), steps: [], notes };
    case 'dependency': return { answer: f['DESCRIPTION'] ?? e.title, explanation: [`${f['FROM TRANSACTION']} → ${f['TO TRANSACTION']}`], steps: [], notes };
    case 'module': return { answer: f['DESCRIPTION'] ?? e.title, explanation: [L('TRANSACTIONS', 'Transactions')].filter(Boolean), steps: [], notes };
  }
  return { answer: e.title, explanation: [], steps: [], notes };
}

function chunkParts(h: Hit, focus: string[] = []): Parts {
  if (focus.length) {
    const fs = focus.map(stem);
    const scored = sentences(h.text.replace(/\n• /g, '. ').replace(/\n/g, ' ')).map((t, i) => ({ t, i, n: fs.filter((f) => normalize(t).split(' ').map(stem).includes(f)).length }));
    const best = scored.filter((x) => x.n > 0).sort((a, b) => b.n - a.n || a.i - b.i).slice(0, 3).sort((a, b) => a.i - b.i).map((x) => x.t);
    if (best.length) {
      const rest = h.text.split('\n').filter((l) => l.startsWith('• ')).map((l) => l.slice(2));
      return { answer: best.join(' '), explanation: [clip(h.text.replace(/\n/g, ' '), 900)], steps: rest.length >= 2 ? rest : [], notes: [] };
    }
  }
  const lines = h.text.split('\n');
  const bullets = lines.filter((l) => l.startsWith('• ')).map((l) => l.slice(2));
  const prose = lines.filter((l) => !l.startsWith('• ')).join(' ');
  return { answer: prose || bullets.join('; '), explanation: [], steps: bullets.length >= 2 ? bullets : [], notes: [] };
}

const partsOf = (h: Hit, focus: string[] = []): { parts: Parts; entry?: EntryRow } => {
  const e = h.entryId ? getEntry(h.entryId, h.entryVersion ?? undefined) : undefined;
  return e ? { parts: entryParts(e), entry: e } : { parts: chunkParts(h, focus) };
};

/** Inputs written in the question ("order qty 100 and received 40") mapped to the rule's inputs by their labels. */
function inputsFromQuestion(question: string, spec: NonNullable<ReturnType<typeof parseSpec>>): Record<string, number> {
  const q = normalize(question);
  const out: Record<string, number> = {};
  for (const inp of spec.inputs) {
    const label = normalize(inp.label.replace(/\(.*?\)/g, ''));
    const words = label.split(' ').filter((w) => w.length > 1);
    // the user's own words count too: "consumption of 1 meter" fills Cons Qty (cons = consumption in the lexicon)
    for (const variant of [label, words.slice(-2).join(' '), words[0], ...(words[0] ? synonyms(words[0]) : [])]) {
      if (!variant) continue;
      const re = new RegExp(`\\b${variant.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?: (?:is|of|=|as|was|will be))? (-?\\d+(?:\\.\\d+)?)`);
      const m = re.exec(q);
      if (m) { out[inp.name] = Number(m[1]); break; }
    }
  }
  return out;
}

function calcView(e: EntryRow, question: string): CalcView | null {
  let spec;
  try { spec = parseSpec(e.fields); } catch { return null; }
  if (!spec) return null;
  const fromQ = inputsFromQuestion(question, spec);
  const tc = parseTestCases(e.fields['TEST CASES'])[0];
  const useQ = Object.keys(fromQ).length > 0;
  const inputs = useQ ? fromQ : tc?.inputs;
  if (!inputs) return { ruleId: e.id, version: e.version, formula: e.fields['FORMULA / LOGIC'] ?? '', inputs: [], steps: [], output: spec.output, result: null, warnings: [], errors: [], source: 'none' };
  const r: CalcResult = evaluate(spec, inputs);
  return {
    ruleId: e.id, version: e.version, formula: e.fields['FORMULA / LOGIC'] ?? '', inputs: r.inputsUsed.map((i) => ({ label: i.label, value: i.value, defaulted: i.defaulted })),
    steps: r.steps.map((s) => `${s.target} = ${s.substituted} = ${fmt(s.value)}`), output: spec.output, result: r.result, warnings: r.warnings, errors: r.errors, source: useQ ? 'your numbers' : 'test case',
  };
}

// ── follow-up questions ──────────────────────────────────────────────
const ANAPHORA = /\b(this|that|these|those|it|its|same|above|previous|earlier|them|they|there)\b/;
export function resolveFollowUp(question: string, ctx: Topic | null | undefined): { question: string; special?: 'next-step' | 'previous-step' | 'as-workflow'; intent?: Intent } {
  const q = question.trim();
  const n = normalize(q);
  if (!ctx) return { question: q };
  if (/\b(next|following) step\b|\bwhat (comes|happens) next\b|\bthen what\b|\bafter (that|this)\b/.test(n) && ctx.steps?.length) return { question: q, special: 'next-step' };
  if (/\bprevious step\b|\bstep before\b/.test(n) && ctx.steps?.length) return { question: q, special: 'previous-step' };
  if (/\b(as|into|in) a? ?(workflow|flow ?chart|flow|diagram)\b|\bsame (process )?as a workflow\b/.test(n)) return { question: `${ctx.title} workflow steps`, special: 'as-workflow', intent: 'workflow' };
  const topicWords = n.split(' ').filter((w) => w.length > 2 && !/^(what|why|how|when|which|does|this|that|these|those|the|and|for|with|happens|happen|required|needed|need|show|explain|tell|more|about|same|then|now|step|steps|next|it|is|are|was|were|if|zero|quantity|qty)$/.test(w));
  if (ANAPHORA.test(n) || topicWords.length <= 1) {
    const terms = ctx.terms.slice(0, 4).join(' ');
    const intent = detectIntent(q);
    return { question: `${q.replace(/\b(this|that|it|these|those|the same)\b/i, ctx.title)} ${intent === 'why' || intent === 'whatif' ? terms : ''}`.trim(), intent: intent === 'general' ? ctx.intent : intent };
  }
  return { question: q };
}

// ── main entry ──────────────────────────────────────────────────────
export interface AskOptions { mode?: Mode; depth?: Depth; context?: Topic | null; userId?: number | null; log?: boolean; /** The asker is an administrator: the admin directory (users and roles) may answer. */ admin?: boolean }

export function answerQuestion(question: string, opts: AskOptions = {}): KnowledgeAnswer {
  const mode = opts.mode ?? 'ask';
  const depth = opts.depth ?? 'standard';
  const fu = resolveFollowUp(question, opts.context);
  const S = new Sources();
  // step navigation inside the previous answer's steps
  if ((fu.special === 'next-step' || fu.special === 'previous-step') && opts.context?.steps?.length) {
    const ctx = opts.context;
    const i = (ctx.stepIndex ?? 0) + (fu.special === 'next-step' ? 1 : -1);
    if (i < 0 || i >= ctx.steps!.length) return finish(question, fu.question, ctx.intent ?? 'howto', mode, S, { title: ctx.title, status: 'documented', statusNote: 'Same sources as the previous answer.', sections: [{ kind: 'answer', title: 'Answer', text: i < 0 ? 'That was the first documented step.' : `That was the last documented step of "${ctx.title}". The stored knowledge lists no further step.` }], missing: [], followUps: [], topic: ctx }, {});
    const step = ctx.steps![i];
    return finish(question, fu.question, 'howto', mode, S, { title: `${ctx.title} – step ${i + 1} of ${ctx.steps!.length}`, status: 'documented', statusNote: 'From the same source as the previous answer.', sections: [{ kind: 'answer', title: `Step ${i + 1}`, text: step }, { kind: 'steps', title: 'All steps', items: ctx.steps!.map((s, k) => (k === i ? `▶ ${s}` : s)) }], missing: [], followUps: i + 1 < ctx.steps!.length ? ['Now explain the next step.'] : [], topic: { ...ctx, stepIndex: i } }, {});
  }
  const intent: Intent = mode === 'workflow' ? 'workflow' : mode === 'calculate' ? 'calculation' : mode === 'transaction' ? 'definition' : mode === 'data_model' ? 'data' : (fu.intent ?? detectIntent(fu.question));
  if (intent === 'compare') { const c = compare(question, fu.question, mode, depth, S); if (c) return c; }
  if (mode === 'transaction') { const t = transactionAnswer(question, fu.question, depth, S); if (t) return t; }
  if (mode === 'data_model' || /\bdata ?model\b|\berd?\b|\bentit(y|ies)\b/.test(normalize(fu.question))) { const m = dataModelAnswer(question, fu.question, mode, S); if (m) return m; }

  const sr = search(fu.question, { intent, limit: 16, includeAdmin: !!opts.admin });
  const entryPool = search(fu.question, { intent, limit: 12, entriesOnly: true });
  for (const h of entryPool.hits) if (!sr.hits.some((x) => x.ref === h.ref)) sr.hits.push(h);
  sr.hits.sort((a, b) => b.score - a.score);
  const top = sr.hits.slice(0, 6);
  const best = top[0];
  const coveredUnits = new Set(top.flatMap((h) => h.matched));
  const knownUnits = sr.units.filter((u) => u.known).map((u) => u.text);
  const missing = [...sr.unknownUnits.map((u) => `"${u}" is not mentioned anywhere in the stored knowledge`), ...knownUnits.filter((u) => !coveredUnits.has(u)).map((u) => `nothing found that connects "${u}" with the rest of the question`)];
  // the question's specific words are all unknown to the knowledge base and only generic words matched
  const onlyGenericKnown = sr.unknownUnits.length > 0 && sr.units.filter((u) => u.known).every((u) => u.idf < 1.5 && !u.text.includes(' '));
  if (!best || best.coverage < 0.5 || (sr.unknownUnits.length && best.coverage < 0.8) || onlyGenericKnown) {
    const abbr = definitionTarget(fu.question);
    if (abbr.length === 1) { const a = abbreviationAnswer(question, fu.question, abbr[0], mode, S, opts); if (a) return a; }
    return notDocumented(question, fu.question, intent, mode, S, sr.hits, missing, sr.corrections, opts);
  }

  // ── does a source actually answer the question? (not just share some words with it) ──
  const critical = sr.units.filter((u) => u.known && (u.text.includes(' ') || u.idf >= 1.5));
  const negated = /\b(without|not|cannot|cant|never|no|dont|didnt|doesnt)\b/.test(normalize(fu.question));
  const target = intent === 'definition' ? definitionTarget(fu.question) : [];
  const subject = subjectTarget(fu.question);
  const titleStems = (h: Hit) => new Set(normalize(`${h.title} ${h.entryId ? '' : sectionHeading(h)}`).split(' ').map(stem));
  const headStems = (h: Hit) => new Set(normalize(`${h.title} ${sectionHeading(h)}`).split(' ').map(stem));
  const negObject = negated ? negationObject(fu.question) : null;
  // generic context after "for / in / of …" ("for a style") may be missing; a transaction name ("in RMPO") never
  const ctx = new Set(contextWords(fu.question).filter((w) => !isTransactionWord(w)));
  const core = critical.filter((u) => !u.text.split(' ').every((w) => ctx.has(w)));
  // a question that names a transaction ("… in GRN") is not answered by an entry recorded for another transaction
  const qTxn = normalize(fu.question).split(' ').filter(isTransactionWord);
  const txnFit = (h: Hit) => !qTxn.length || !h.entryId || !h.txn || qTxn.some((w) => normalize(`${h.txn} ${h.title}`).split(' ').includes(w));
  const yesNo = /^(can|could|does|do|did|is|are|will|should|must|may)\b/.test(normalize(fu.question));
  const fitsWith = (h: Hit, units: typeof critical) =>
    txnFit(h)
    && !(yesNo && h.docId && ['proposed', 'unreviewed'].includes(h.status))
    && units.every((u) => h.matched.includes(u.text))
    && proximityFit(h, units)
    && (!negated || negationFit(h, negObject))
    && !quantifierClash(fu.question, h.title)
    // "how do I create a sales order": the subject must be what the entry is about (its title), not only its module ("Sales Order")
    // "where do I configure X" is about a setting: a scenario that merely contains "setup" does not answer it
    && !(/\b(configure|configuration|config|settings?)\b/i.test(fu.question) && h.kind === 'workflow')
    && !(intent === 'howto' && h.kind === 'procedure' && units.some((u) => u.text.includes(' ') && !u.text.split(' ').every((w) => titleStems(h).has(stem(w)))))
    && (!target.length || target.every((w) => titleStems(h).has(stem(w)) || synonymsIn(titleStems(h), w)))
    // synonyms count in the title only: a module name in the heading ("Inventory") must not stand in for "stock"
    && (!subject.length || subject.every((w) => headStems(h).has(stem(w)) || synonymsIn(titleStems(h), w)));
  const fits = (h: Hit) => fitsWith(h, critical);
  const withSteps = (h: Hit) => partsOf(h).parts.steps.length >= 2;
  let fitting = sr.hits.filter(fits);
  // a confirmed entry that answers about as well as an unreviewed document comes first (hundreds of proposed documents must not outrank reviewed rules)
  if (fitting[0]?.docId && !CONFIRMED.includes(fitting[0].status)) { const alt = fitting.find((h) => CONFIRMED.includes(h.status) && h.coverage >= fitting[0].coverage - 0.15 && h.titleCoverage >= fitting[0].titleCoverage); if (alt) fitting = [alt, ...fitting.filter((x) => x !== alt)]; }
  if (!fitting.length && core.length < critical.length && (subject.length || target.length)) fitting = sr.hits.filter((h) => fitsWith(h, core));
  // a calculation question is answered by the reviewed calculation rule when there is one, not by prose that mentions the same words
  if (intent === 'calculation') { const calc = sr.hits.find((h) => h.kind === 'calculation' && CONFIRMED.includes(h.status) && fitsWith(h, core)); if (calc) fitting = [calc, ...fitting.filter((x) => x !== calc)]; }
  const chosen = intent === 'workflow' ? (fitting.find((h) => ['workflow', 'procedure'].includes(h.kind) && withSteps(h)) ?? fitting.find(withSteps) ?? fitting[0]) : fitting[0];
  if (!chosen) {
    if (target.length === 1) { const a = abbreviationAnswer(question, fu.question, target[0], mode, S, opts); if (a) return a; }
    // when what is not covered is most of what the question is about, nothing is documented
    const nc = critical.filter((u) => !best.matched.includes(u.text));
    const all = critical.reduce((a, u) => a + u.idf, 0) || 1;
    const unknownSet = new Set(sr.unknownUnits);
    const focusUnknown = [...target, ...subject].some((w) => unknownSet.has(w));
    if (focusUnknown || (nc.reduce((a, u) => a + u.idf, 0) / all >= 0.5 && !target.length && !subject.length)) return notDocumented(question, fu.question, intent, mode, S, sr.hits, [...nc.map((u) => `nothing stored is about "${u.text}" in this context`), ...missing], sr.corrections, opts);
    return partialAnswer(question, fu.question, intent, mode, S, best, nc.map((u) => u.text), target, negated, missing, sr.corrections, opts);
  }

  // ── compose from the chosen source, add supporting sources ──
  const pick = chosen;
  const { parts, entry } = partsOf(pick, critical.flatMap((u) => u.alts.flat()));
  const n0 = S.add(pick);
  const sections: Section[] = [];
  const why = intent === 'why', whatif = intent === 'whatif';
  let status: KStatus = CONFIRMED.includes(pick.status) ? 'confirmed' : pick.status === 'source-documented' ? 'documented' : PROVISIONAL.includes(pick.status) ? 'provisional' : 'documented';
  let statusNote = status === 'confirmed' ? `Based on ${pick.entryId} (version ${pick.entryVersion}, ${pick.status}).`
    : status === 'documented' ? `Taken from the source document ${pick.docId ?? ''} (${titleOf(pick.docId ?? '')}); not yet a reviewed rule.`
    : `The main source is ${pick.status}: treat this as provisional until it is approved.`;

  // "why" and "what happens if" need a source that addresses exactly that
  if (why) {
    const reasonText = [...sentences(parts.answer), ...parts.explanation].find((s) => /\b(because|so that|in order to|purpose|reason|why|to ensure|is used to|is used because|helps|so the|unless|by default|only when|only if)\b|^if\b|\bwhen\b.*\b(not|no|without)\b|\bif\b.*\b(not|no|without)\b/i.test(s));
    if (!reasonText) {
      sections.push({ kind: 'answer', title: 'Answer', text: `The stored documentation describes ${pick.title}, but it does not state why. ${NOT_DOCUMENTED}`, refs: [n0] });
      sections.push({ kind: 'explanation', title: 'What is documented', text: clip(parts.answer, 700), refs: [n0] });
      return finish(question, fu.question, intent, mode, S, { title: pick.title, status: 'partial', statusNote: 'The reason is not documented.', sections, missing: ['the business reason ("why") is not written in any stored source', ...missing], followUps: [`What is ${pick.title}?`], topic: topicOf(pick, sr.units.map((u) => u.text), intent, parts) }, sr.corrections, opts, true);
    }
    sections.push({ kind: 'answer', title: 'Answer', text: clip(reasonText, 380), refs: [n0] });
  } else if (whatif) {
    const cond = sr.units.find((u) => /^(zero|0|negative|blank|empty|null|minus|less|more|exceed\w*|over|under)$/.test(u.text));
    const condCovered = cond ? pick.matched.includes(cond.text) : true;
    if (!condCovered) {
      sections.push({ kind: 'answer', title: 'Answer', text: `No stored rule describes what happens in this case for ${pick.title}. ${NOT_DOCUMENTED}`, refs: [n0] });
      sections.push({ kind: 'explanation', title: 'What is documented about the topic', text: clip(parts.answer, 600), refs: [n0] });
      return finish(question, fu.question, intent, mode, S, { title: pick.title, status: 'partial', statusNote: 'The situation asked about is not documented.', sections, missing: [`behaviour when the value is "${cond?.text}" is not documented`, ...missing], followUps: [], topic: topicOf(pick, sr.units.map((u) => u.text), intent, parts) }, sr.corrections, opts, true);
    }
    sections.push({ kind: 'answer', title: 'Answer', text: clip(parts.answer, depth === 'brief' ? 350 : 900), refs: [n0] });
  } else {
    // crisp by default: the sentences that answer the question, not the whole passage (the rest is under "More detail")
    sections.push({ kind: 'answer', title: 'Answer', text: depth === 'detailed' ? clip(parts.answer, 2500) : focusAnswer(parts.answer, fu.question, depth === 'brief' ? 300 : 380), refs: [n0] });
  }
  if (depth !== 'brief' && parts.explanation.length) sections.push({ kind: 'explanation', title: 'Explanation', items: parts.explanation.slice(0, depth === 'detailed' ? 12 : 5).map((x) => clip(x, depth === 'detailed' ? 1500 : 500)), refs: [n0] });
  if (parts.steps.length) sections.push({ kind: 'steps', title: intent === 'workflow' ? 'Workflow steps' : 'Steps', items: parts.steps, refs: [n0] });
  if (intent === 'workflow' && parts.steps.length >= 2) {
    const nodes = parts.steps.map((s, i) => ({ id: `s${i + 1}`, label: clip(s, 60), type: 'activity' }));
    const edges = nodes.slice(1).map((nd, i) => ({ from: nodes[i].id, to: nd.id }));
    sections.push({ kind: 'workflow', title: 'Workflow (Mermaid)', text: `Generated from the documented steps of [${n0}] in their written order. No step was added; decisions and branches are only shown when a source states them.`, mermaid: toMermaid([{ id: 'start', label: 'Start', type: 'start' }, ...nodes, { id: 'end', label: 'End', type: 'end' }], [{ from: 'start', to: nodes[0].id }, ...edges, { from: nodes[nodes.length - 1].id, to: 'end' }]), json: { nodes, edges, basis: S.list[n0 - 1].label }, refs: [n0] });
  }
  if (parts.notes.length) {
    sections.push({ kind: 'notes', title: 'Open points', items: parts.notes, refs: [n0] });
    if (entry?.fields['CONFLICT']) { status = 'conflicting'; statusNote = entry.fields['CONFLICT']; }
    else if (status === 'confirmed' && entry?.fields['INFERENCE']) { status = 'provisional'; statusNote = 'Part of this entry is an inference, not stated by a source.'; }
  }
  // calculation: run the rule with the question's numbers or the rule's own test case
  const calcEntry = entry && entry.fields['EXPRESSION'] ? entry : top.map((h) => (h.entryId ? getEntry(h.entryId) : undefined)).find((e) => e?.fields['EXPRESSION'] && (intent === 'calculation'));
  if (calcEntry && depth !== 'brief') {
    const v = calcView(calcEntry, question);
    if (v) {
      const nCalc = calcEntry.id === entry?.id ? n0 : S.add(top.find((h) => h.entryId === calcEntry.id)!);
      sections.push({ kind: 'calculation', title: 'Calculation', calc: v, text: v.source === 'none' ? `Formula: ${v.formula}. Give the input values (or open the Calculation Lab) to run it.` : `Worked with ${v.source === 'test case' ? 'the rule\'s own test case' : 'the numbers in your question'} by the calculation engine (rule ${v.ruleId} v${v.version}).`, refs: [nCalc] });
    }
  }
  // conflicting calculations: same rule name and transaction, different formula
  const rules = top.filter((h) => h.entryId && ['calculation', 'rule', 'validation'].includes(h.kind) && h !== pick);
  if (entry?.type === 'rule') {
    // two current rules that compute the same output for the same transaction with different logic
    // compare definition by definition: "X = …" lines of both rules that define the same X with a different right side
    const defs = (e: EntryRow) => new Map((e.fields['FORMULA / LOGIC'] ?? '').split(/\n|;/).filter((l) => l.includes('=')).map((l) => [normalize(l.split('=')[0].replace(/\(.*?\)/g, ' ')), normalize(l.split('=').slice(1).join('='))] as [string, string]).filter(([k]) => k));
    const mine = defs(entry);
    const clash = (e: EntryRow) => [...defs(e)].some(([k, v]) => mine.has(k) && mine.get(k) !== v);
    const same = rules.map((h) => getEntry(h.entryId!)).filter((e): e is EntryRow => !!e && e.id !== entry.id && e.category === entry.category && (e.txn ?? '') === (entry.txn ?? '') && clash(e));
    if (same.length) {
      status = 'conflicting';
      statusNote = `Two stored rules give different logic for "${entry.title}". Both are shown; please confirm which is correct.`;
      for (const e of same) { const h = rules.find((x) => x.entryId === e.id)!; const n = S.add(h); sections.push({ kind: 'conflict', title: `Conflicting rule ${e.id} v${e.version} (${e.status})`, text: e.fields['FORMULA / LOGIC'], refs: [n] }); }
    }
  }
  // the same question answered by other documents: shown side by side, never merged (documents can disagree, e.g. an older and a newer design)
  if (pick.docId) {
    const seenDocs = new Set([pick.docId]); const others: Hit[] = [];
    for (const h of fitting) if (h.docId && !seenDocs.has(h.docId)) { seenDocs.add(h.docId); others.push(h); if (others.length >= 3) break; }
    if (others.length) {
      sections.push({ kind: 'related', title: 'The same question is also answered in other documents', items: others.map((h) => `${clip(h.text.replace(/\s+/g, ' '), 230)} [${S.add(h)}] — ${h.title} (${h.docId})`) });
      statusNote = `${statusNote ? `${statusNote} ` : ''}${others.length} other document(s) also answer this. They are listed below, not merged, and were not compared automatically: check that they agree before relying on this.`;
    }
  }
  // business rules that apply (confirmed first)
  if (depth !== 'brief') {
    const ruleItems: string[] = [];
    const used = new Set(S.list.map((s) => s.ref));
    for (const h of rules.filter((x) => x.coverage >= 0.6 && !used.has(x.ref)).slice(0, depth === 'detailed' ? 6 : 3)) {
      const e = getEntry(h.entryId!);
      if (!e) continue;
      const n = S.add(h);
      ruleItems.push(`${e.title}: ${clip(e.fields['FORMULA / LOGIC'] || e.fields['BUSINESS PURPOSE'] || '', 260)} [${n}]${CONFIRMED.includes(e.status) ? '' : ` (${e.status})`}`);
    }
    if (ruleItems.length) sections.push({ kind: 'rules', title: 'Business rules', items: ruleItems });
  }
  // dependencies of the transaction involved
  const txn = entry?.type === 'transaction' ? entry : entry?.txn ? findTransaction(entry.txn) : pick.txn ? findTransaction(pick.txn) : undefined;
  if (txn && depth !== 'brief' && (intent === 'dependency' || intent === 'definition' || intent === 'general' || depth === 'detailed' || mode === 'transaction')) {
    const rel = relationsOf(txn.id);
    const up = rel.incoming.filter((r) => r.rel === 'feeds').map((r) => `${r.otherTitle} → ${txn.title}`);
    const down = rel.outgoing.filter((r) => r.rel === 'feeds').map((r) => `${txn.title} → ${r.otherTitle}`);
    const wfs = rel.incoming.filter((r) => r.rel === 'includes').map((r) => r.otherTitle ?? r.fromId);
    const docs = rel.incoming.filter((r) => r.rel === 'mentions').map((r) => `${r.fromId} ${r.otherTitle}`);
    const items = [...up.map((x) => `Upstream: ${x}`), ...down.map((x) => `Downstream: ${x}`), ...(wfs.length ? [`Workflows that include it: ${wfs.slice(0, 5).join('; ')}`] : []), ...(docs.length ? [`Documents that discuss it: ${docs.slice(0, 5).join('; ')}`] : [])];
    if (items.length) sections.push({ kind: 'dependencies', title: `Dependencies of ${txn.title}`, items, text: 'From the documented transaction links (each link names its source entry).' });
  }
  // supporting sources from documents (for "documented" breadth)
  if (depth === 'detailed') {
    const more = top.filter((h) => h.docId && h !== pick && h.coverage >= 0.7).slice(0, 3);
    if (more.length) sections.push({ kind: 'related', title: 'Also in the source documents', items: more.map((h) => `${clip(firstSentences(h.text, 2), 300)} [${S.add(h)}]`) });
  }
  const partialMissing = knownUnits.filter((u) => !pick.matched.includes(u) && !coveredUnits.has(u));
  if (partialMissing.length || sr.unknownUnits.length) {
    if (status === 'confirmed' || status === 'documented') status = 'partial';
    statusNote += ` Not covered by the sources: ${[...sr.unknownUnits, ...partialMissing].map((u) => `"${u}"`).join(', ')}.`;
  }
  const follow = followUpsFor(pick, entry, intent);
  return finish(question, fu.question, intent, mode, S, { title: entry?.title ?? pick.title, status, statusNote, sections, missing, followUps: follow, topic: topicOf(pick, sr.units.map((u) => u.text), intent, parts) }, sr.corrections, opts, status === 'partial');
}

const NEG = /\b(without|not|cannot|can not|never|no|none|blank|zero|skip\w*|bypass\w*|optional|dont|didnt|doesnt|missing)\b/i;
/** The word a negation applies to: "a PO without indent" → "indent". */
function negationObject(q: string): string | null {
  const m = /\b(?:without|not|no|never|cannot|dont|didnt|doesnt)\s+(?:a |an |the |any )?([a-z][\w-]*)/i.exec(normalize(q));
  return m ? m[1] : null;
}
/** The negation must sit in the same sentence as the word it applies to. */
function negationFit(h: Hit, obj: string | null): boolean {
  const want = obj ? [obj, ...synonyms(obj)].map(stem) : [];
  return sentences(h.text).some((s) => NEG.test(s) && (!obj || normalize(s).split(' ').map(stem).some((w) => want.includes(w))));
}
/** All key terms must appear close together: in one sentence or two neighbouring sentences (title and heading count as context). */
/** The section heading of a passage; for a document passage without the document's own title (which would make every word of the question look present). */
const sectionHeading = (h: Hit) => h.heading;
/** The one or two sentences of a passage that answer the question (most words in common), in their written order. */
function focusAnswer(text: string, question: string, max = 380): string {
  const ss = sentences(text);
  if (ss.length <= 1) return clip(text, max);
  const q = new Set(normalize(question).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(stem));
  const scored = ss.map((s, i) => ({ s, i, sc: normalize(s).split(' ').map(stem).filter((w) => q.has(w)).length }));
  const best = scored.reduce((a, b) => (b.sc > a.sc ? b : a), scored[0]);
  if (best.sc === 0) return clip(ss.slice(0, 2).join(' '), max);
  const next = scored[best.i + 1], prev = scored[best.i - 1];
  const pick = [best];
  if (next && next.sc > 0 && best.s.length + next.s.length <= max) pick.push(next);
  else if (prev && prev.sc > 0 && best.s.length + prev.s.length <= max) pick.push(prev);
  return clip(pick.sort((a, b) => a.i - b.i).map((x) => x.s).join(' '), max);
}
const EXTRA_KINDS = new Set(['explanation', 'notes', 'rules', 'dependencies', 'dependency', 'related', 'note']);
function proximityFit(h: Hit, critical: { text: string; alts: string[][] }[]): boolean {
  if (critical.length <= 1) return true;
  const ctx = new Set(normalize(`${h.title} ${sectionHeading(h)}`).split(' ').map(stem));
  const sents = sentences(h.text).map((s) => new Set(normalize(s).split(' ').map(stem)));
  if (!sents.length) sents.push(new Set());
  const has = (set: Set<string>, u: { alts: string[][] }) => u.alts.some((a) => a.every((w) => set.has(stem(w)) || ctx.has(stem(w))));
  for (let i = 0; i < sents.length; i++) {
    const win = new Set([...sents[i], ...(sents[i + 1] ?? [])]);
    if (critical.every((u) => has(win, u))) return true;
  }
  return false;
}
/** "multiple suppliers" must not be answered by "multiple indents". */
function quantifierClash(q: string, title: string): boolean {
  const Q = /\b(multiple|several|many|one|single|each|every|all)\s+([a-z]+)/g;
  const qa = [...normalize(q).matchAll(Q)], tb = [...normalize(title).matchAll(Q)];
  const same = (x: string, y: string) => stem(x) === stem(y);
  const titleWords = normalize(title).split(' ');
  return qa.some((a) => tb.some((b) => same(a[1], b[1]) && !same(a[2], b[2])) && !titleWords.some((w) => same(w, a[2])));
}

/** Words after the first preposition: the context of the question ("… for a style" → style). */
function contextWords(q: string): string[] {
  const n = normalize(q).split(' ');
  const i = n.findIndex((w, k) => k >= 2 && /^(in|for|of|on|at|during|within|inside|under|from)$/.test(w));
  return i < 0 ? [] : n.slice(i + 1).filter((w) => w.length > 1 && !STOP.has(w) && !FILLER.has(w) && !INTENT_WORDS.has(w));
}

let txnWords: Set<string> | null = null;
/** True for words that name a documented transaction ("rmpo", "grn", "oc", "bbb", "mrp"). */
function isTransactionWord(w: string): boolean {
  if (!txnWords) {
    txnWords = new Set<string>();
    for (const r of all<{ title: string; fields: string }>("SELECT title, fields FROM entries WHERE type = 'transaction' AND is_current = 1")) {
      const slug = (JSON.parse(r.fields) as { fields: Record<string, string> }).fields['SLUG'] ?? '';
      for (const x of normalize(slug).split(' ')) if (x.length > 1) txnWords.add(x);
      for (const m of r.title.matchAll(/\(([A-Za-z]{2,6})\)/g)) txnWords.add(m[1].toLowerCase());
      const head = r.title.split(/\s+[–-]\s+/)[0];
      if (/^[A-Z]{2,6}$/.test(head)) txnWords.add(head.toLowerCase());
    }
    txnWords.delete('style');
    txnWords.delete('order');
  }
  return txnWords.has(w);
}

/** What a how-to / calculation / list question is about: "how to cancel a purchase order" → purchase order;
 *  "how is open qty calculated" → open qty; "what reports are available" → reports. */
export function subjectTarget(q: string): string[] {
  const n = normalize(q);
  const pick = (t: string | undefined) => (t ?? '').split(/ (?:in|for|of|on|at|during|with|within|inside|under|when|from|to|into|between|after|before|by|using|via) /)[0]
    .split(' ').filter((w) => w.length > 1 && !STOP.has(w) && !FILLER.has(w) && !INTENT_WORDS.has(w));
  let m = /^how (?:do|can|should|would) (?:i|we|you|one|a user|the user) ([a-z]+) (?:a |an |the |my |our )?(.+)$/.exec(n) ?? /^how to ([a-z]+) (?:a |an |the |my |our )?(.+)$/.exec(n);
  if (m && !/^(do|get|make|know|see|find|check|use|work|handle)$/.test(m[1])) return pick(m[2]);
  m = /^how (?:is|are) (?:the |a |an )?(.+?) (?:calculated|computed|derived|worked out|arrived at)\b/.exec(n)
    ?? /^how (?:does|do|will|would|can) (?:wfx|the system|system|it) (?:calculate|compute|derive|work out|arrive at) (?:the |a |an )?(.+)$/.exec(n);
  if (m) return pick(m[1]);
  m = /^(?:what|which) ([a-z]+(?: [a-z]+)?) (?:are|is) (?:available|there|supported|possible|provided)/.exec(n);
  if (m) return pick(m[1]);
  return [];
}

/** "What is X" / "define X" / "what does X mean": the words of X (context after "in/for/of…" is dropped). */
export function definitionTarget(q: string): string[] {
  const n = normalize(q);
  if (/^(what is|what are|whats|explain) (the )?(purpose|use|role|reason|need|benefit) /.test(n)) return [];
  const m = /^what does (?:the |a |an )?(.+?) mean$/.exec(n) ?? /^(?:what is|what are|whats|define|meaning of|explain the term) (?:the |a |an )?(.+?)$/.exec(n);
  if (!m) return [];
  const term = m[1].split(/ (?:in|for|of|on|at|during|with|within|inside|under|when|used|from) /)[0];
  return term.split(' ').filter((w) => w.length > 1 && !STOP.has(w) && !FILLER.has(w) && !INTENT_WORDS.has(w));
}

function synonymsIn(set: Set<string>, w: string): boolean {
  return synonyms(w).some((s) => s.split(' ').every((x) => set.has(stem(x))));
}

/** "GDI": where the knowledge spells an abbreviation out, answer with that sentence and its source. */
function abbreviationAnswer(question: string, resolved: string, word: string, mode: Mode, S: Sources, opts: AskOptions): KnowledgeAnswer | null {
  const rows = all<{ expansion: string; source: string }>('SELECT expansion, source FROM abbreviations WHERE abbr = ?', word.toLowerCase());
  if (!rows.length) return null;
  const items: string[] = [];
  for (const r of rows.slice(0, 3)) {
    const id = /^chunk:(\d+)$/.exec(r.source ?? '')?.[1];
    const h = id ? hitById(Number(id)) : undefined;
    if (!h) continue;
    const n = S.add(h);
    const sentence = sentences(h.text).find((s) => new RegExp(`\\b${word}\\b`, 'i').test(s)) ?? clip(h.text, 300);
    items.push(`${word.toUpperCase()} = ${r.expansion.replace(/\b\w/g, (c) => c.toUpperCase())} — "${clip(sentence, 300)}" [${n}]`);
  }
  if (!items.length) return null;
  return finish(question, resolved, 'definition', mode, S, {
    title: word.toUpperCase(), status: S.list.every((s) => CONFIRMED.includes(s.status)) ? 'confirmed' : S.list.some((s) => PROVISIONAL.includes(s.status)) ? 'provisional' : 'documented',
    statusNote: 'The stored knowledge spells the abbreviation out; it has no separate definition entry for it.',
    sections: [{ kind: 'answer', title: 'Answer', items }], missing: [`no glossary entry defines ${word.toUpperCase()} yet`], followUps: [`Add ${word.toUpperCase()} to the glossary`], topic: { title: word.toUpperCase(), terms: [word] },
  }, {}, opts, true);
}

function hitById(id: number): Hit | undefined {
  const r = all<Record<string, unknown>>('SELECT * FROM chunks WHERE id = ?', id)[0];
  if (!r) return undefined;
  return {
    id, ref: String(r['ref']), kind: String(r['kind']), title: String(r['title']), heading: String(r['heading'] ?? ''), text: String(r['text']), module: (r['module'] as string) ?? null, txn: (r['txn'] as string) ?? null,
    status: String(r['status']), sourceLabel: String(r['source_label']), docId: (r['doc_id'] as string) ?? null, docVersion: r['doc_version'] === null ? null : Number(r['doc_version']),
    entryId: (r['entry_id'] as string) ?? null, entryVersion: r['entry_version'] === null ? null : Number(r['entry_version']), locator: (r['locator'] as string) ?? null,
    isCurrent: Number(r['is_current']) === 1, score: 0, coverage: 1, titleCoverage: 0, matched: [], missing: [],
  };
}

/** The best source covers only part of the question: say exactly what is not covered, then show the closest content. */
function partialAnswer(question: string, resolved: string, intent: Intent, mode: Mode, S: Sources, best: Hit, notCovered: string[], target: string[], negated: boolean, missing: string[], corrections: Record<string, string>, opts: AskOptions): KnowledgeAnswer {
  const { parts } = partsOf(best);
  const n = S.add(best);
  const gaps: string[] = [];
  if (target.length && !target.every((w) => normalize(best.title).includes(w))) gaps.push(`no stored entry defines "${target.join(' ')}"${notCovered.length ? '' : ' (it is only mentioned in passing)'}`);
  if (notCovered.length) gaps.push(`the stored sources do not cover ${notCovered.map((u) => `"${u}"`).join(', ')} for this question`);
  if (negated && !gaps.length) gaps.push('no stored source describes the case asked about ("without" / "not")');
  if (!gaps.length) gaps.push('the sources that mention these words are about something else; none is about the subject of the question');
  const sections: Section[] = [
    { kind: 'answer', title: 'Answer', text: `${NOT_DOCUMENTED} Specifically: ${gaps.join('; ')}.` },
    { kind: 'related', title: `Closest documented content: ${best.title}`, text: clip(parts.answer, 700), refs: [n] },
  ];
  return finish(question, resolved, intent, mode, S, {
    title: best.title, status: 'partial', statusNote: 'Only part of the question is documented; the closest content is shown separately and is not an answer.',
    sections, missing: [...gaps, ...missing.filter((m) => !gaps.includes(m))], followUps: [`Tell me about ${best.title}`], topic: topicOf(best, [], intent, parts),
  }, corrections, opts, true);
}

function topicOf(h: Hit, terms: string[], intent: Intent, parts: Parts): Topic {
  return { title: h.title, terms, primaryRef: h.ref, entryId: h.entryId, docId: h.docId, steps: parts.steps.length ? parts.steps : undefined, stepIndex: parts.steps.length ? 0 : undefined, intent };
}

function followUpsFor(h: Hit, e: EntryRow | undefined, intent: Intent): string[] {
  const out: string[] = [];
  const t = e?.type === 'transaction' ? e.title : e?.txn ?? h.txn ?? '';
  if (e?.fields['EXPRESSION']) out.push(`Calculate ${e.title} with my own numbers`);
  if (e && stepsOf(e.fields['STEPS']).length >= 2 && intent !== 'workflow') out.push('Show the same process as a workflow.');
  if (t) { out.push(`What are the validations for ${t.replace(/\s*\(.*\)$/, '')}?`); out.push(`Which transactions depend on ${t.replace(/\s*\(.*\)$/, '')}?`); }
  if (intent !== 'why') out.push('Why is this required?');
  return [...new Set(out)].slice(0, 4);
}

function notDocumented(question: string, resolved: string, intent: Intent, mode: Mode, S: Sources, hits: Hit[], missing: string[], corrections: Record<string, string>, opts: AskOptions): KnowledgeAnswer {
  const near = hits.filter((h) => h.coverage >= 0.3).slice(0, 3);
  const sections: Section[] = [{ kind: 'answer', title: 'Answer', text: NOT_DOCUMENTED }];
  if (near.length) sections.push({ kind: 'related', title: 'Closest documented topics (not an answer to the question)', items: near.map((h) => `${h.title} [${S.add(h)}]`) });
  return finish(question, resolved, intent, mode, S, {
    title: 'Not documented', status: 'not-documented', statusNote: 'No stored source supports an answer.', sections,
    missing: missing.length ? missing : ['no stored source covers the question'], followUps: near.map((h) => `Tell me about ${h.title}`), topic: { title: near[0]?.title ?? '', terms: [] },
  }, corrections, opts, true);
}

// ── comparison: both sides from the knowledge, plus any documented comparison ──
function compare(question: string, resolved: string, mode: Mode, depth: Depth, S: Sources): KnowledgeAnswer | null {
  const n = normalize(resolved);
  const tail = n.replace(/^.*?\b(difference|differences|differ|different|compare|compared|comparison)\b( (between|of|in))?/, '').trim() || n;
  const sides = tail.split(/\b(?:and|vs|versus|with|from|or|to)\b/).map((x) => x.trim()).filter((x) => x.split(' ').some((w) => w.length > 1)).slice(0, 2);
  if (sides.length < 2) return null;
  // each side needs an entry ABOUT it (its words in the title), not one that merely mentions it
  const sideWords = (side: string) => side.split(' ').filter((w) => w.length > 1 && !STOP.has(w) && !FILLER.has(w) && !INTENT_WORDS.has(w));
  const inTitle = (h: Hit, side: string) => { const t = new Set(normalize(h.title).split(' ').map(stem)); return sideWords(side).every((w) => t.has(stem(w))); };
  const sideHits = sides.map((side) => search(side, { intent: 'definition', limit: 12 }).hits.filter((h) => inTitle(h, side) && ['definition', 'transaction', 'rule', 'module', 'procedure', 'field', 'section'].includes(h.kind)));
  const found = sideHits.map((l) => l[0]);
  const documented = search(resolved, { intent: 'compare', limit: 10 }).hits.find((h) => /\b(vs|versus|difference|differ|compar)/i.test(h.title) && sides.every((sd) => inTitle(h, sd) || sideWords(sd).every((w) => normalize(h.text).includes(w))));
  const sections: Section[] = [];
  const missing: string[] = [];
  if (documented) { const { parts } = partsOf(documented); sections.push({ kind: 'answer', title: 'Documented comparison', text: clip(parts.answer, 2000), refs: [S.add(documented)] }); }
  const rows: string[][] = [];
  sides.forEach((side, i) => {
    const h = found[i];
    if (!h) { missing.push(`no stored definition of "${side}"`); return; }
    const { parts, entry } = partsOf(h);
    const nn = S.add(h);
    const txn = entry?.type === 'transaction' ? entry : entry?.txn ? findTransaction(entry.txn) : findTransaction(side);
    const rel = txn ? relationsOf(txn.id) : null;
    rows.push([
      `${h.title} [${nn}]`,
      clip(firstSentences(parts.answer, 2), 320),
      txn?.module ?? entry?.module ?? h.module ?? '—',
      rel ? rel.incoming.filter((r) => r.rel === 'feeds').map((r) => r.otherTitle).join('; ') || '—' : '—',
      rel ? rel.outgoing.filter((r) => r.rel === 'feeds').map((r) => r.otherTitle).join('; ') || '—' : '—',
    ]);
  });
  if (!rows.length && !documented) return null;
  if (!documented && rows.length < 2) sections.unshift({ kind: 'answer', title: 'Answer', text: `${NOT_DOCUMENTED} The stored knowledge defines only one side of the comparison.` });
  if (rows.length) sections.push({ kind: 'comparison', title: 'Side by side (from the stored definitions and transaction links)', table: { columns: ['Item', 'What it is', 'Module', 'Comes after', 'Leads to'], rows } });
  const kinds = sideHits.map((l, i) => (l.length > 1 ? `"${sides[i]}" has several documented kinds: ${l.slice(0, 4).map((h) => h.title).join('; ')}` : '')).filter(Boolean);
  if (kinds.length) sections.push({ kind: 'related', title: 'Several documented kinds', items: kinds });
  const statuses = S.list.map((s) => s.status);
  // a comparison assembled from two definitions is 'documented'; only a stored comparison can be 'confirmed'
  const status: KStatus = missing.length ? 'partial' : statuses.some((s) => PROVISIONAL.includes(s)) ? 'provisional' : documented && statuses.every((s) => CONFIRMED.includes(s)) ? 'confirmed' : 'documented';
  const note = documented ? 'A stored source compares them directly.' : 'No stored source compares them directly; the table puts their stored definitions side by side so you can compare.';
  return finish(question, resolved, 'compare', mode, S, { title: `${sides[0]} vs ${sides[1]}`, status, statusNote: note, sections, missing, followUps: sides.map((s) => `What is ${s}?`), topic: { title: `${sides[0]} vs ${sides[1]}`, terms: sides } }, {}, {}, !!missing.length);
}

// ── Explain Transaction mode: the documentation page in one answer ──
function transactionAnswer(question: string, resolved: string, depth: Depth, S: Sources): KnowledgeAnswer | null {
  const sr = search(resolved, { intent: 'definition', limit: 10, kinds: ['transaction'] });
  const h = sr.hits[0];
  if (!h || h.coverage < 0.5 || !h.entryId) return null;
  const t = getEntry(h.entryId)!;
  const n0 = S.add(h);
  const f = t.fields;
  const sections: Section[] = [{ kind: 'answer', title: 'Purpose', text: [f['PURPOSE'], f['ONE LINE']].filter(Boolean).join(' '), refs: [n0] }];
  if (f['BUSINESS CONTEXT']) sections.push({ kind: 'explanation', title: 'Business context', text: f['BUSINESS CONTEXT'], refs: [n0] });
  if (f['NAVIGATION PATH']) sections.push({ kind: 'explanation', title: 'Navigation path', text: f['NAVIGATION PATH'], refs: [n0] });
  const fields = search(`${t.title} fields`, { kinds: ['field'], limit: 40 }).hits.filter((x) => x.entryId && getEntry(x.entryId)?.fields['TRANSACTION']?.includes(`(${f['SLUG']})`));
  if (fields.length) sections.push({ kind: 'fields', title: 'Fields', table: { columns: ['Field', 'How it gets its value', 'Meaning'], rows: fields.slice(0, 30).map((x) => { const e = getEntry(x.entryId!)!; S.add(x); return [e.title, e.fields['FIELD TYPE'] ?? '', clip(e.fields['DEFINITION'] ?? '', 200)]; }) } });
  const rel = relationsOf(t.id);
  const calcs = rel.outgoing.filter((r) => r.rel === 'uses_calculation').map((r) => getEntry(r.toId)).filter((e): e is EntryRow => !!e);
  if (calcs.length) sections.push({ kind: 'rules', title: 'Calculations', items: calcs.map((c) => `${c.title}: ${c.fields['FORMULA / LOGIC']} (${c.id}, ${c.status})`) });
  const rules = rel.incoming.filter((r) => r.rel === 'applies_to' && r.fromType === 'rule').map((r) => getEntry(r.fromId)).filter((e): e is EntryRow => !!e && !e.fields['EXPRESSION']);
  if (rules.length) sections.push({ kind: 'rules', title: 'Business rules and validations', items: rules.slice(0, 15).map((c) => `${c.title}: ${clip(c.fields['FORMULA / LOGIC'] ?? '', 240)} (${c.id}, ${c.status})`) });
  const up = rel.incoming.filter((r) => r.rel === 'feeds').map((r) => r.otherTitle ?? r.fromId), down = rel.outgoing.filter((r) => r.rel === 'feeds').map((r) => r.otherTitle ?? r.toId);
  if (up.length || down.length) sections.push({ kind: 'dependencies', title: 'Previous and next transactions', items: [...up.map((x) => `Comes after: ${x}`), ...down.map((x) => `Leads to: ${x}`)] });
  const docs = rel.incoming.filter((r) => r.rel === 'mentions');
  if (docs.length) sections.push({ kind: 'related', title: 'Related documentation', items: docs.map((d) => `${d.fromId} ${d.otherTitle}`) });
  const notDoc = ['Prerequisite settings', 'Required master data', 'Default values', 'Transaction statuses', 'Confirmation behaviour', 'Common errors']
    .filter((k) => !Object.keys(f).some((x) => x.toLowerCase().includes(k.split(' ')[0].toLowerCase())));
  return finish(question, resolved, 'definition', 'transaction', S, { title: t.title, status: CONFIRMED.includes(t.status) ? 'confirmed' : 'provisional', statusNote: `Transaction documentation ${t.id} v${t.version}.`, sections, missing: notDoc.map((k) => `${k}: not documented yet for this transaction`), followUps: [`Show the workflow for ${t.title}`, `Which transactions depend on ${t.title}?`], topic: { title: t.title, terms: [t.title], entryId: t.id, primaryRef: h.ref, intent: 'definition' } }, sr.corrections, {}, false);
}

// ── data models: captured screen-level models only (never invented table names) ──
function dataModelAnswer(question: string, resolved: string, mode: Mode, S: Sources): KnowledgeAnswer | null {
  const q = resolved.replace(/\b(data ?model|erd?|entit(y|ies)|create|show|make|for|of|the|a)\b/gi, ' ');
  const sr = search(q.trim() || resolved, { kinds: ['data_model'], limit: 8 });
  // only captured, confirmed models: drafts from the data modelling studio are proposals, not WFX knowledge
  const models = sr.hits.filter((h) => h.coverage >= 0.5 && h.entryId).map((h) => ({ h, e: getEntry(h.entryId!)! })).filter((x) => x.e && x.e.fields['GRIDS'] !== undefined && CONFIRMED.includes(x.e.status));
  if (!models.length) return null;
  const sections: Section[] = [];
  const entities: { id: string; label: string; type: string }[] = [];
  const edges: { from: string; to: string; label: string }[] = [];
  const rows: string[][] = [];
  for (const { h, e } of models.slice(0, 4)) {
    const n = S.add(h);
    entities.push({ id: e.id, label: e.title, type: 'activity' });
    for (const line of (e.fields['GRIDS'] ?? '').split('\n')) {
      const p = line.split('|').map((x) => x.trim());
      if (p.length < 2 || line.startsWith('[')) continue;
      const from = /from: ([\w-]+)\.([\w-]+)/.exec(line);
      rows.push([`${e.title} [${n}]`, p[0], p[1], p.find((x) => x.startsWith('formula:'))?.slice(9) ?? '', from ? `${from[1]}.${from[2]}` : '']);
      if (from) {
        const target = getEntry(`DM-${from[1].toUpperCase()}`);
        if (target) { if (!entities.some((x) => x.id === target.id)) entities.push({ id: target.id, label: target.title, type: 'activity' }); if (!edges.some((x) => x.from === target.id && x.to === e.id)) edges.push({ from: target.id, to: e.id, label: 'value comes from' }); }
      }
    }
  }
  sections.push({ kind: 'answer', title: 'Answer', text: `Documented data model${models.length > 1 ? 's' : ''}: ${models.map((m) => m.e.title).join('; ')}. These are screen-level fields captured from WFX screens or specifications, not the WFX database schema; no table or column names were invented.` });
  sections.push({ kind: 'fields', title: 'Fields (data dictionary)', table: { columns: ['Document', 'Field', 'Type (key / entered / calc / link / copied)', 'Formula', 'Value comes from'], rows: rows.slice(0, 120) } });
  if (entities.length > 1) sections.push({ kind: 'workflow', title: 'How the documents connect (documented links only)', mermaid: toMermaid(entities, edges, 'LR'), json: { entities, edges } });
  return finish(question, resolved, 'data', mode, S, { title: models[0].e.title, status: 'confirmed', statusNote: 'Captured screen-level models (confirmed from captures). A logical or physical database model is not documented.', sections, missing: ['WFX database tables, keys and constraints are not documented (only screen fields)'], followUps: models.slice(1, 3).map((m) => `Show the data model of ${m.e.title}`), topic: { title: models[0].e.title, terms: [models[0].e.title], entryId: models[0].e.id } }, sr.corrections, {}, false);
}

// ── assemble, log, render Markdown ───────────────────────────────────
function finish(question: string, resolved: string, intent: Intent, mode: Mode, S: Sources,
  a: { title: string; status: KStatus; statusNote: string; sections: Section[]; missing: string[]; followUps: string[]; topic: Topic },
  corrections: Record<string, string>, opts: AskOptions = {}, gap = false): KnowledgeAnswer {
  for (const s of a.sections) if (EXTRA_KINDS.has(s.kind) && s.extra === undefined) s.extra = true;
  const out: KnowledgeAnswer = { question, resolvedQuestion: resolved, intent, mode, title: a.title, status: a.status, statusNote: a.statusNote.trim(), sections: a.sections, sources: S.list, missing: a.missing, followUps: a.followUps, topic: a.topic, generatedBy: 'knowledge-base', markdown: '', corrections };
  out.markdown = toMarkdown(out);
  if (opts.log !== false) {
    try {
      if (gap) run('INSERT INTO knowledge_gaps (at, user_id, question, missing) VALUES (?, ?, ?, ?)', nowIso(), opts.userId ?? null, question, a.missing.join('; '));
      if (a.status !== 'not-documented' && a.title) run('INSERT INTO topic_hits (at, user_id, topic, ref) VALUES (?, ?, ?, ?)', nowIso(), opts.userId ?? null, a.title, a.topic.primaryRef ?? null);
    } catch { /* logging must never break an answer */ }
  }
  return out;
}

const STATUS_LABEL: Record<KStatus, string> = {
  confirmed: 'Confirmed (approved or active knowledge)', documented: 'Documented in a source document (not yet a reviewed rule)', provisional: 'Provisional (draft, under review or proposed)',
  conflicting: 'Conflicting sources', partial: 'Partly documented', 'not-documented': 'Not documented', conversation: 'Conversation (not WFX documentation)',
};

export function toMarkdown(a: KnowledgeAnswer): string {
  const md: string[] = [`## ${a.title}`];
  for (const s of a.sections) {
    const refs = s.refs?.length ? ` ${s.refs.map((n) => `[${n}]`).join('')}` : '';
    md.push(`\n### ${s.title}`);
    if (s.text) md.push(`${s.text}${refs}`);
    if (s.items?.length) md.push(...s.items.map((x, i) => (s.kind === 'steps' ? `${i + 1}. ${x}` : `- ${x}`)));
    if (s.table) md.push(`| ${s.table.columns.join(' | ')} |`, `| ${s.table.columns.map(() => '---').join(' | ')} |`, ...s.table.rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, '/').replace(/\n/g, ' ')).join(' | ')} |`));
    if (s.calc) {
      md.push(`Rule ${s.calc.ruleId} v${s.calc.version}: ${s.calc.formula}`);
      if (s.calc.inputs.length) md.push(`Inputs: ${s.calc.inputs.map((i) => `${i.label} = ${fmt(i.value)}${i.defaulted ? ' (default)' : ''}`).join(', ')}`);
      md.push(...s.calc.steps.map((x) => `- ${x}`));
      if (s.calc.result !== null) md.push(`**Result: ${s.calc.output} = ${fmt(s.calc.result)}**`);
      md.push(...s.calc.warnings.map((w) => `- Warning: ${w}`), ...s.calc.errors.map((e) => `- Error: ${e}`));
    }
    if (s.mermaid) md.push('```mermaid', s.mermaid, '```');
  }
  if (a.missing.length) md.push('\n### Not documented', ...a.missing.map((m) => `- ${m}`));
  md.push(`\n### Knowledge status\n${STATUS_LABEL[a.status]}. ${a.statusNote}`);
  if (a.sources.length) md.push('\n### Sources', ...a.sources.map((s) => `[${s.n}] ${s.title} — ${s.label} (${s.status})${s.origin ? `. Origin: ${clip(s.origin, 220)}` : ''}`));
  return md.join('\n');
}

export const inputsFromText = inputsFromQuestion;
export { toNumber };
