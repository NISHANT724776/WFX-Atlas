// Business Analyst copilot (deterministic part): reads a requirement, observation or note and returns what it says,
// what it touches in the stored knowledge, what is ambiguous or missing, the questions to ask, and draft user story,
// acceptance criteria and test scenarios. Everything generated is labelled as a proposal; nothing becomes a rule.
import { all } from '../db.ts';
import { normalize } from '../search/lexicon.ts';
import { search } from '../search/search.ts';
import type { Section } from '../assistant/answer.ts';

export interface BaAnalysis {
  kind: 'observation' | 'requirement' | 'defect' | 'question' | 'notes';
  summary: string;
  dependencies: { trigger: string; context: string; effect: string; target: string }[];
  knownFields: { name: string; id: string; transaction: string }[];
  transactions: string[];
  screens: string[];
  ambiguities: string[];
  missing: string[];
  questions: string[];
  userStory: string;
  acceptance: string[];
  tests: { type: 'positive' | 'negative' | 'boundary'; scenario: string; expected: string }[];
  actions: string[];
}

const VAGUE = /\b(some|several|appropriate|appropriately|properly|etc|as required|as needed|if needed|user[- ]friendly|fast|quickly|easily|flexible|tbd|to be decided|and\/or|should be able|normal|usual|relevant|various|many|few)\b/gi;

export function analyseRequirement(text: string): BaAnalysis {
  const t = text.replace(/\s+/g, ' ').trim();
  const n = normalize(t);
  const kind: BaAnalysis['kind'] = /\b(not working|error|bug|issue|incorrect|wrong|fails?|failing|crash)\b/.test(n) ? 'defect'
    : /\?$/.test(t) ? 'question'
    : /\b(should|must|need to|needs to|required to|expected|shall|want|wants|would like)\b/.test(n) ? 'requirement'
    : /\b(action item|minutes|attendees|discussed|agreed|next steps)\b/.test(n) ? 'notes'
    : 'observation';
  // "When A is changed …, B is cleared" → dependency
  const dependencies: BaAnalysis['dependencies'] = [];
  const VERB = '(changed|selected|updated|modified|edited|removed|deleted|cleared|saved|confirmed|approved|cancelled|entered)';
  const EFFECT = '(cleared|reset|removed|recalculated|updated|changed|refreshed|disabled|enabled|blanked|retained|kept)';
  const TARGET = '(?:then\\s+)?(?:the\\s+)?(?:previously selected\\s+|previously entered\\s+|existing\\s+|selected\\s+)?(.+?)\\s+(?:is|are|gets?)\\s+';
  const withComma = new RegExp(`\\b(?:when|if|once|after|whenever)\\s+(?:the\\s+)?(.+?)\\s+(?:is|are|gets?)\\s+${VERB}\\b([^,.]*),\\s*${TARGET}${EFFECT}\\b`, 'gi');
  const noComma = new RegExp(`\\b(?:when|if|once|after|whenever)\\s+(?:the\\s+)?(.+?)\\s+(?:is|are|gets?)\\s+${VERB}\\b()\\s+${TARGET}${EFFECT}\\b`, 'gi');
  for (const re of [withComma, noComma]) {
    for (const m of t.matchAll(re)) dependencies.push({ trigger: `${m[1].trim()} is ${m[2]}`, context: m[3].trim(), effect: m[5], target: m[4].trim() });
    if (dependencies.length) break;
  }
  // fields and transactions that exist in the knowledge base
  const fieldRows = all<{ id: string; title: string; txn: string }>("SELECT id, title, txn FROM entries WHERE type = 'field' AND is_current = 1");
  const knownFields = fieldRows.filter((f) => f.title.length > 3 && n.includes(normalize(f.title))).slice(0, 12).map((f) => ({ name: f.title, id: f.id, transaction: f.txn }));
  const txnRows = all<{ title: string }>("SELECT title FROM entries WHERE type = 'transaction' AND is_current = 1");
  const transactions = txnRows.map((r) => r.title).filter((x) => x.split(/\s+[–-]\s+|\s*\(/).some((p) => p.trim().length > 1 && n.includes(normalize(p.trim()))));
  const screens = [...t.matchAll(/\b([A-Z][\w ]{2,40}?)\s+(screen|page|popup|pop-up|tab|grid|list|form|dialog)\b/g)].map((m) => `${m[1].trim()} ${m[2]}`);
  const ambiguities = [...new Set([...t.matchAll(VAGUE)].map((m) => m[0].toLowerCase()))].map((w) => `"${w}" is vague: say exactly what is meant.`);
  const missing: string[] = [];
  const questions: string[] = [];
  if (!/\b(user|merchandiser|planner|buyer|admin|approver|manager|store|inventory team|production|sourcing|role)\b/i.test(t)) missing.push('Who does this (role or user group)?');
  if (!screens.length && !transactions.length) missing.push('Which screen or transaction this happens on.');
  if (kind === 'observation') { questions.push('Is the observed behaviour expected, or a defect to be fixed?'); missing.push('Expected behaviour (the text describes what happens now).'); }
  if (kind === 'defect') missing.push('Steps to reproduce, actual result, expected result, environment/build, company or client.');
  if (kind === 'requirement' && !/\b(so that|because|in order to|to allow|to avoid|to prevent)\b/i.test(t)) missing.push('Business reason (why it is needed).');
  for (const d of dependencies) {
    questions.push(d.context ? `It is described "${d.context}": does the same happen on new lines, or only on existing (saved) ones?` : `Does this apply to new lines only, or also to existing (saved) lines when ${d.trigger}?`);
    questions.push(`If the same value is selected again, should ${d.target} still be ${d.effect}?`);
    questions.push(`Is the user warned before ${d.target} is ${d.effect}, and can the change be undone before saving?`);
  }
  if (!dependencies.length && kind !== 'notes') questions.push('What triggers this behaviour, and what exactly changes as a result?');
  for (const w of ['quantity', 'qty', 'price', 'rate', 'value', 'percentage']) if (n.includes(w)) { questions.push('What are the limits (zero, negative, maximum, decimals) and the unit of measure?'); break; }
  const unknownCaps = [...new Set([...t.matchAll(/\b[A-Z][A-Za-z]+(?: [A-Z][A-Za-z]+){1,3}\b/g)].map((m) => m[0].replace(/^(When|If|Once|After|Whenever|The|A|An|In|On|For|Then)\s+/, '')).filter((p) => p.includes(' ')))]
    .filter((p) => !knownFields.some((f) => normalize(f.name) === normalize(p)) && !search(p, { limit: 1 }).hits.some((h) => h.titleCoverage >= 0.99));
  for (const p of unknownCaps.slice(0, 5)) missing.push(`"${p}" is not defined in the stored knowledge yet.`);
  const role = /\b(merchandiser|planner|buyer|admin|approver|manager|store keeper|inventory team|production team|sourcing team)\b/i.exec(t)?.[0] ?? 'user';
  const d0 = dependencies[0];
  const userStory = kind === 'requirement' ? `As a ${role}, I want ${t.replace(/^(the system|system|it)\s+(should|must|shall)\s+/i, '').replace(/[.]$/, '')}, so that [business reason – to be confirmed].`
    : d0 ? `As a ${role}, I want ${d0.target} to be ${d0.effect} (or kept) when ${d0.trigger}, so that [business reason – to be confirmed].` : `As a ${role}, I want [goal], so that [reason] (not enough information in the text).`;
  const acceptance: string[] = d0
    ? [`Given ${d0.context ? d0.context.replace(/^in /, '') : 'a line'} with ${d0.target} selected, when ${d0.trigger}, then ${d0.target} is ${d0.effect} [as observed – confirm if expected].`,
       `Given a new line, when ${d0.trigger}, then ${d0.target} behaves the same way [to confirm].`,
       `Given ${d0.target} was ${d0.effect}, when the user saves without re-selecting it, then [validation or default – to be defined].`]
    : kind === 'requirement' ? [`Given [precondition], when [action from the text], then [expected result from the text].`] : [];
  const tests: BaAnalysis['tests'] = d0 ? [
    { type: 'positive', scenario: `Existing line: ${d0.trigger}`, expected: `${d0.target} is ${d0.effect} (current behaviour); compare with the confirmed expected behaviour` },
    { type: 'positive', scenario: `New line: ${d0.trigger}`, expected: `Same behaviour as on an existing line (to confirm)` },
    { type: 'boundary', scenario: `Select the same value again for ${d0.trigger.replace(/ (changed|selected|updated|modified|edited)$/, '')}`, expected: `${d0.target} is kept or cleared – to confirm` },
    { type: 'negative', scenario: `${d0.trigger}, then cancel/close without saving`, expected: `The saved ${d0.target} is unchanged` },
    { type: 'negative', scenario: `${d0.trigger}, leave ${d0.target} empty and save`, expected: 'The required-field validation (if any) is shown – to confirm' },
  ] : kind === 'requirement' ? [
    { type: 'positive', scenario: 'Perform the action described with valid data', expected: 'The described result happens' },
    { type: 'negative', scenario: 'Perform the action with missing or invalid data', expected: 'A clear validation message; nothing is saved' },
    { type: 'boundary', scenario: 'Use zero, maximum and decimal values where quantities are involved', expected: 'Handled as defined (limits to be confirmed)' },
  ] : [];
  const actions = kind === 'notes' ? t.split(/(?<=[.;])\s+/).filter((s) => /\b(will|to do|action|follow up|share|send|prepare|check|confirm)\b/i.test(s)).map((s) => s.trim()) : [];
  const summary = d0 ? `${kind === 'observation' ? 'Observed' : 'Described'} behaviour: when ${d0.trigger}${d0.context ? ` ${d0.context}` : ''}, ${d0.target} is ${d0.effect}.` : `${kind[0].toUpperCase()}${kind.slice(1)}: ${t.slice(0, 240)}`;
  return { kind, summary, dependencies, knownFields, transactions, screens: [...new Set(screens)], ambiguities, missing, questions: [...new Set(questions)], userStory, acceptance, tests, actions };
}

export function baSections(a: BaAnalysis): Section[] {
  const s: Section[] = [{ kind: 'answer', title: 'Reading of the text', text: `${a.summary} (classified as: ${a.kind}). Nothing below is a confirmed requirement; it is a proposal for review.` }];
  if (a.dependencies.length) s.push({ kind: 'dependencies', title: 'Functional dependency', items: a.dependencies.map((d) => `${d.trigger}${d.context ? ` (${d.context})` : ''} → ${d.target} is ${d.effect}`) });
  const touches = [...a.transactions.map((x) => `Transaction: ${x}`), ...a.knownFields.map((f) => `Field: ${f.name} (${f.id}${f.transaction ? `, ${f.transaction}` : ''})`), ...a.screens.map((x) => `Screen: ${x}`)];
  if (touches.length) s.push({ kind: 'related', title: 'What it touches in the stored knowledge', items: touches });
  if (a.ambiguities.length) s.push({ kind: 'notes', title: 'Ambiguous wording', items: a.ambiguities });
  if (a.missing.length) s.push({ kind: 'notes', title: 'Missing information', items: a.missing });
  if (a.questions.length) s.push({ kind: 'notes', title: 'Questions to clarify', items: a.questions });
  s.push({ kind: 'explanation', title: 'Draft user story (proposal)', text: a.userStory });
  if (a.acceptance.length) s.push({ kind: 'steps', title: 'Draft acceptance criteria (proposal)', items: a.acceptance });
  if (a.tests.length) s.push({ kind: 'comparison', title: 'Draft test scenarios (proposal)', table: { columns: ['Type', 'Scenario', 'Expected'], rows: a.tests.map((x) => [x.type, x.scenario, x.expected]) } });
  if (a.actions.length) s.push({ kind: 'steps', title: 'Action items', items: a.actions });
  return s;
}
