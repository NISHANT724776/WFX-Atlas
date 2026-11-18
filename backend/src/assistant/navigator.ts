// The assistant as navigator and trainer: tells apart "open a screen", "show me how" (visual guide), the Trims Scan
// prototype and an ambiguous one- or two-word subject, and adds registered destinations and guides to ordinary answers.
// Every link comes from the Screen Registry, a stored workflow or a guide (resolveNavigation); nothing is made up.
import type { User } from '../auth.ts';
import { getEntry } from '../knowledge/repo.ts';
import { findForQuestion, getGuide, getScreen, resolveNavigation } from '../registry/registry.ts';
import type { Guide, NavAction, Screen } from '../registry/registry.ts';
import { normalize, STOP } from '../search/lexicon.ts';
import { search } from '../search/search.ts';
import { NOT_DOCUMENTED, toMarkdown } from './answer.ts';
import type { KnowledgeAnswer, Mode, Section } from './answer.ts';

export type NavIntent = 'navigate' | 'prototype' | 'howto' | 'ambiguous' | 'none';
type Action = NonNullable<KnowledgeAnswer['actions']>[number];

const NAV = /^(?:please\s+)?(?:open|go to|goto|take me to|navigate to|launch|bring up|show me the .+ (?:screen|page))\b|\bwhere (?:is|can i find|do i find) (?:the )?.+ (?:screen|page|menu)\b/i;
const PROTO = /\b(trims?\s*scan|trims?|qr( code)?|quick ?docs|prototype|scanning|scan)\b/i;
const HOWTO = /\b(how (?:do|can|should|would) (?:i|we|you|the user)|how to|steps? (?:to|for)|walk ?(?:me )?through|guide me|show me how|i (?:want|need) to (?:create|make|do|process|raise|generate|run|execute|post|book)|process(?:ing)? (?:a|an|the)\b)/i;
const QWORD = /\b(what|why|how|when|where|which|who|explain|show|list|compare|difference|create|open|is|are|does|can)\b/i;

export function navIntent(q: string): NavIntent {
  const t = q.trim();
  if (NAV.test(t)) return 'navigate';
  if (PROTO.test(t) && /\b(trims?|qr|quick ?docs|prototype|outward note|pick ?list|print doc|gdn|location)\b/i.test(t)) return 'prototype';
  if (HOWTO.test(t)) return 'howto';
  const words = normalize(t).split(' ').filter((w) => w && !STOP.has(w));
  if (words.length <= 3 && !QWORD.test(t) && !/[?]/.test(t)) return 'ambiguous';
  return 'none';
}

const act = (n: NavAction, primary = false): Action => ({ ...n, primary });
const nav = (id: string, user: User | null, primary = false) => { const n = resolveNavigation(id, user); return n ? act(n, primary) : null; };
const cardOf = (g: Guide, note?: string) => ({ type: 'guide' as const, id: g.id, title: g.title, kind: g.kind, steps: g.steps.length, cover: g.steps.find((s) => s.image)?.image ?? null, note });

function shell(question: string, mode: Mode, title: string, sections: Section[], status: KnowledgeAnswer['status'], statusNote: string, extra: Partial<KnowledgeAnswer> = {}): KnowledgeAnswer {
  const a: KnowledgeAnswer = { question, resolvedQuestion: question, intent: 'general', mode, title, status, statusNote, sections, sources: [], missing: [], followUps: [], topic: { title, terms: [] },
    generatedBy: 'knowledge-base', markdown: '', corrections: {}, ...extra };
  a.markdown = toMarkdown(a);
  return a;
}

const overlap = (id: string, words: Set<string>) => normalize(getEntry(id)?.title ?? id).split(' ').filter((w) => words.has(w)).length;

function screenActions(s: Screen, user: User | null, primary: boolean): Action[] {
  const out: Action[] = [];
  const main = nav(s.id, user, primary); if (main) out.push(main);
  // the workflow that shares most words with the screen first ("Sales Order" → "Sales Order to factory")
  const sw = new Set(normalize(s.name).split(' '));
  const ranked = [...s.workflowIds].sort((a, b) => overlap(b, sw) - overlap(a, sw));
  for (const w of ranked.slice(0, 2)) { const x = nav(w, user); if (x) out.push(x); }
  for (const g of s.relatedGuides.slice(0, 1)) { const x = nav(g, user); if (x) out.push(x); }
  return out;
}

/** Answers that are about navigation or the prototype itself; null hands the question to the knowledge answer. */
export function navigatorTurn(question: string, mode: Mode, user: User | null): KnowledgeAnswer | null {
  const intent = navIntent(question);
  if (intent === 'navigate') {
    const hit = findForQuestion(question.replace(NAV, ' ').replace(/\b(screen|page|menu)\b/gi, ' ') || question).screens;
    const best = hit[0];
    if (!best || best.score < 0.55) {
      return shell(question, mode, 'No registered screen found', [{ kind: 'answer', title: 'Answer', text: `No registered screen matches "${question}". I only open screens that are in the Screen Registry, so nothing was opened.` },
        ...(hit.length ? [{ kind: 'related', title: 'Closest registered screens', items: hit.map((h) => h.s.name) } as Section] : [])],
      'not-documented', 'The Screen Registry has no screen with this name.', { missing: ['a registered screen for this request'], followUps: hit.slice(0, 3).map((h) => `Open ${h.s.name}`) });
    }
    const s = best.s;
    const actions = screenActions(s, user, true);
    const main = actions[0];
    const text = [s.purpose, s.menuPath ? `In WFX: ${s.menuPath}.` : '', main && !main.allowed ? main.reason : ''].filter(Boolean).join(' ');
    return shell(question, mode, s.name, [{ kind: 'answer', title: 'Answer', text }], 'documented', 'Destination from the Screen Registry.', { actions, navigate: main?.allowed ? main.id : undefined, topic: { title: s.name, terms: [] } });
  }
  if (intent === 'prototype') {
    // one flow when the question names it, otherwise the whole process in the prototype's own order
    const ALL = ['GUIDE-TRIMS-GRN', 'GUIDE-TRIMS-DISPATCH', 'GUIDE-TRIMS-GDN', 'GUIDE-TRIMS-LOC', 'GUIDE-TRIMS-PRINT', 'GUIDE-TRIMS-OUT'];
    const FLOW: [RegExp, string][] = [[/\bpick ?list|picking\b/i, 'GUIDE-TRIMS-DISPATCH'], [/\bgdn|delivery note\b/i, 'GUIDE-TRIMS-GDN'], [/\blocation|move stock|bin\b/i, 'GUIDE-TRIMS-LOC'],
      [/\bprint|label\b/i, 'GUIDE-TRIMS-PRINT'], [/\boutward|returns?|transfers?\b/i, 'GUIDE-TRIMS-OUT'], [/\bgrn|goods received|receiv\w*|inward|asn\b/i, 'GUIDE-TRIMS-GRN']];
    const named = FLOW.filter(([re]) => re.test(question)).map(([, id]) => id);
    const guides = (named.length ? [...new Set(named)] : ALL).map((id) => ({ id }));
    const loaded = guides.map((g) => getGuide(g.id)).filter((g): g is Guide => !!g).slice(0, 6);
    if (!loaded.length) return null;
    const first = loaded[0];
    const cards = loaded.map((g, i) => cardOf(g, loaded.length > 1 ? `Flow ${i + 1} of ${loaded.length}` : undefined));
    const actions = [nav('EXT-TRIMS-PROTOTYPE', user, true)].filter((x): x is Action => !!x);
    const steps = first.steps.map((s) => `${s.title}: ${s.text}`);
    return shell(question, mode, loaded.length > 1 ? 'Trims Scan process (Quick Docs mobile app)' : first.title, [
      { kind: 'answer', title: 'Answer', text: loaded.length > 1 ? `Trims are handled by QR scan in the Quick Docs mobile app in ${loaded.length} flows: ${loaded.map((g) => g.title.replace(/^Trims Scan · /, '')).join(', ')}. Each flow is shown below with the prototype's own screens.` : `${first.title.replace(/^Trims Scan · /, '')} in the Quick Docs mobile app: ${first.steps.length} steps, shown below with the prototype's own screens.` },
      { kind: 'steps', title: 'Steps', items: steps, extra: true },
      ...(first.changes.length ? [{ kind: 'notes', title: 'What changes for the user', items: first.changes, extra: true } as Section] : []),
    ], 'documented', 'From the Trims Scan prototype (sample data only, not live WFX transactions).',
    { cards, actions, missing: [], followUps: loaded.length === 1 ? ['Explain the complete trims process'] : [], topic: { title: loaded.length > 1 ? 'Trims Scan process' : first.title, terms: ['trims'] } });
  }
  return null;
}

/** Adds registered destinations, workflows and visual guides to a knowledge answer (never changes its text or status). */
export function enrichAnswer(a: KnowledgeAnswer, user: User | null): KnowledgeAnswer {
  if (a.action) return a; // a generated workflow already opens the designer
  const intent = navIntent(a.question);
  const actions: Action[] = []; const cards: NonNullable<KnowledgeAnswer['cards']> = [];
  // a documented procedure becomes a step-by-step guide
  const procId = a.sources.find((s) => s.entryId && getEntry(s.entryId)?.type === 'procedure' && /^PROC-/.test(s.entryId))?.entryId;
  if (procId && (intent === 'howto' || a.intent === 'howto' || a.intent === 'workflow')) {
    const g = getGuide(`GUIDE-PROC-${procId}`);
    if (g) { cards.push(cardOf(g)); if (g.screenId) actions.push(...screenActions(getScreen(g.screenId)!, user, true)); }
  }
  const f = findForQuestion(`${a.question} ${a.title}`);
  for (const h of f.screens.filter((x) => x.score >= 0.6).slice(0, 2)) for (const x of screenActions(h.s, user, !actions.length)) if (!actions.some((y) => y.id === x.id)) actions.push(x);
  // the stored workflow the answer came from
  const wf = a.sources.find((s) => s.entryId?.startsWith('WF-'))?.entryId;
  if (wf && !actions.some((x) => x.id === wf)) { const x = nav(wf, user); if (x) actions.push(x); }
  // a prototype flow on the same subject is offered, labelled as a prototype
  const proto = f.guides.find((g) => g.kind === 'prototype' && g.score >= 0.55);
  if (proto && !cards.some((c) => c.id === proto.id)) { const g = getGuide(proto.id); if (g) cards.push(cardOf(g, 'Trims Scan prototype (sample data)')); }
  if (intent === 'howto' && !cards.length && a.status !== 'not-documented') {
    // a "how do I …" answered by a rule or a definition is not a procedure: say so first, keep what is documented below
    const primary = a.sources[0]?.entryId ? getEntry(a.sources[0].entryId)?.type : a.sources[0]?.kind;
    if (!['procedure', 'workflow', 'case'].includes(String(primary))) {
      a = { ...a, status: 'partial', statusNote: 'No stored procedure describes these steps; related documented content is shown under More detail.',
        sections: [{ kind: 'answer', title: 'Answer', text: `No step-by-step procedure for this is stored yet, so I cannot show the clicks. Closest documented content: ${a.title}.` }, ...a.sections.map((s) => ({ ...s, extra: true }))] };
    }
    a.missing = [...a.missing, 'no step-by-step procedure with screenshots is stored for this operation yet'];
  }
  if (!actions.length && !cards.length) { a = { ...a }; a.markdown = toMarkdown(a); return a; }
  const out = { ...a, actions: actions.slice(0, 4), cards: cards.slice(0, 3) };
  out.markdown = toMarkdown(out);
  return out;
}

/** One- or two-word subjects ("Sales Order"): ask what the user wants instead of guessing. */
export function clarify(question: string, mode: Mode, user: User | null): KnowledgeAnswer | null {
  if (navIntent(question) !== 'ambiguous') return null;
  const hit = findForQuestion(question).screens[0];
  if (!hit || hit.score < 0.6) return null;
  const subject = question.trim().replace(/[.?!]+$/, '');
  return shell(question, mode, subject, [{ kind: 'answer', title: 'Answer', text: `What do you need about ${subject}?` }], 'documented', 'Pick one of the options below.',
    { followUps: [`What is ${subject}?`, `Show the ${subject} workflow`, `How do I create a ${subject}?`, `Open the ${subject} screen`], actions: screenActions(hit.s, user, false).slice(0, 2), topic: { title: subject, terms: [] } });
}

/** A not-documented answer says how general questions can be answered (AI mode), instead of inventing anything. */
export function generalNote(a: KnowledgeAnswer, aiActive: boolean): KnowledgeAnswer {
  if (aiActive || a.status !== 'not-documented' || a.sections.some((s) => s.kind === 'general')) return a;
  // nothing in the message the knowledge base could search for (a greeting, thanks, "ok"): reply, do not say "not documented"
  if (!search(a.question).units.some((u) => u.known)) {
    const hello: KnowledgeAnswer = { ...a, status: 'conversation', title: '', statusNote: '', missing: [], sources: [], followUps: ['How do I create an RMPO?', 'Show me the Sales Order workflow', 'Explain the Trims Scan process'],
      sections: [{ kind: 'answer', title: 'Answer', text: 'Hello! Ask me anything about WFX: a screen, a rule, a calculation, a workflow or how to do something. (Claude is not connected on this server yet, so I can only answer from the stored WFX knowledge.)' }] };
    hello.markdown = toMarkdown(hello);
    return hello;
  }
  const out = { ...a, sections: [...a.sections, { kind: 'note', title: 'General questions', text: 'Questions outside WFX (for example "Explain APIs") are answered by AI mode, which is not switched on for this server. An admin can switch it on under Admin › AI once a provider key is configured.', extra: true }] };
  out.markdown = toMarkdown(out);
  return out;
}
export { NOT_DOCUMENTED };
