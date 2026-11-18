// The chat's entry point to the workflow designer. A message that asks for a workflow (create / modify / compare) is
// handled here instead of being answered as text: the request is kept, the documentation is searched, the workflow is
// generated and stored as a draft linked to the conversation, and the answer carries an "open-workflow" action that makes
// the chat page open the Workflow Designer on that draft. A message that only talks about workflows (a question) returns
// null and is answered normally. Generation problems never lose the request: a failed draft is stored for retry.
import { get, run } from '../db.ts';
import { nowIso, randomToken } from '../util.ts';
import { compareGraphs, compareRequest, applyCommand, enrich, newDoc, resolve, workflowKind } from '../workflows/generate.ts';
import type { DraftDoc } from '../workflows/generate.ts';
import { createDraft, failDraft, getDraft, latestDraft, updateDoc } from '../workflows/drafts.ts';
import type { DraftRow } from '../workflows/drafts.ts';
import { toMarkdown } from './answer.ts';
import type { KnowledgeAnswer, Section, Source } from './answer.ts';

export type ChatAction =
  | { type: 'open-workflow'; draftId: string; title: string; path: string; conversationId: string | null }
  | { type: 'workflow-failed'; draftId: string; error: string; request: string };

const DESIGNER = '/workflow-designer';

function answer(question: string, title: string, status: KnowledgeAnswer['status'], statusNote: string, sections: Section[], extra: Partial<KnowledgeAnswer> = {}): KnowledgeAnswer {
  const a: KnowledgeAnswer = {
    question, resolvedQuestion: question, intent: 'workflow', mode: 'workflow', title, status, statusNote, sections, sources: [], missing: [], followUps: [],
    topic: { title, terms: [] }, generatedBy: 'knowledge-base', markdown: '', corrections: {}, ...extra,
  };
  a.markdown = toMarkdown(a);
  return a;
}

function sourcesOf(doc: DraftDoc): Source[] {
  return doc.graph.references.filter((r) => r.kind !== 'rule').slice(0, 8).map((r, i) => ({
    n: i + 1, ref: `entry:${r.id}`, title: r.title, kind: r.kind, status: r.status, label: `${r.kind} ${r.id}`, entryId: r.id, entryVersion: null, docId: null, docVersion: null, locator: null,
    origin: r.id, confirmed: ['Active', 'Approved'].includes(r.status),
  }));
}

function stats(doc: DraftDoc) {
  const steps = doc.graph.nodes.filter((n) => n.type !== 'start' && n.type !== 'end');
  return {
    steps: steps.length, decisions: steps.filter((n) => n.type === 'decision').length,
    documented: steps.filter((n) => n.basis === 'documented').length, proposed: steps.filter((n) => n.basis === 'proposed').length,
    withRules: steps.filter((n) => n.rules?.length).length, withValidations: steps.filter((n) => n.validations?.length).length, withScreens: steps.filter((n) => n.images?.length).length,
  };
}

function openAnswer(question: string, d: DraftRow, doc: DraftDoc, lead: string, followUps: string[]): KnowledgeAnswer {
  const s = stats(doc);
  const items = [
    `${s.steps} step(s)${s.decisions ? `, ${s.decisions} decision(s)` : ''}: ${s.documented} documented by a source, ${s.proposed} proposed${s.steps - s.documented - s.proposed ? `, ${s.steps - s.documented - s.proposed} inferred` : ''}.`,
    `${s.withRules} step(s) have documented rules, ${s.withValidations} have validations or controls, ${s.withScreens} have screenshots.`,
    ...doc.notes,
  ];
  return answer(question, `Workflow: ${doc.graph.name}`, 'provisional',
    'A generated workflow is a draft. It is not an approved WFX business process until it is saved to the library and an approver approves it.',
    [{ kind: 'answer', title: 'Answer', text: lead, items }],
    {
      sources: sourcesOf(doc), followUps, topic: { title: doc.graph.name, terms: [doc.graph.name] },
      missing: s.proposed ? [`${s.proposed} step(s) are proposed, not documented`] : [],
      action: { type: 'open-workflow', draftId: d.id, title: doc.graph.name, path: DESIGNER, conversationId: d.conversationId } as ChatAction,
    } as Partial<KnowledgeAnswer>);
}

const FOLLOW = ['Show this as a swimlane diagram', 'Show me the validations applicable at every stage', 'Switch to the overview'];

function clarification(question: string, text: string, suggestions: string[]): KnowledgeAnswer {
  return answer(question, 'Which workflow?', 'partial', 'No workflow was generated: more information is needed first.',
    [{ kind: 'answer', title: 'Answer', text }, ...(suggestions.length ? [{ kind: 'related', title: 'Documented workflows you can ask for', items: suggestions }] : [])],
    { followUps: suggestions.slice(0, 3).map((s) => `Show me the workflow: ${s}`), missing: ['The process to draw is not documented or not specific enough'] });
}

/** A workflow request in the chat: returns the answer (with its action), or null when the message is an ordinary question. */
export function workflowTurn(text: string, mode: string, conversationId: string, userId: number): KnowledgeAnswer | null {
  const prior = latestDraft(conversationId, userId);
  const kind = workflowKind(text, mode, !!prior);
  if (kind === 'none' || kind === 'explain') return null;

  if (kind === 'modify' && prior?.doc) {
    const r = applyCommand(prior.doc, text, 'you');
    if (!r.ok) return answer(text, 'Workflow not changed', 'partial', 'The workflow was left as it was.', [{ kind: 'answer', title: 'Answer', text: r.reply }], { followUps: ['Show this as a swimlane diagram', 'Show me the validations applicable at every stage'] });
    const d = updateDoc(prior.id, userId, r.doc, text);
    return openAnswer(text, d, r.doc, r.reply, FOLLOW);
  }

  try {
    if (kind === 'compare') {
      const c = compareRequest(text);
      if ('clarify' in c) return clarification(text, c.clarify, []);
      const doc = newDoc(enrich(c.a.graph!), c.a.notes, text);
      doc.compare = { with: c.nameB, changes: compareGraphs(c.a.graph!, c.b.graph!) };
      const d = createDraft(userId, conversationId, text, doc, 'Generated for a comparison');
      const ch = doc.compare.changes;
      return openAnswer(text, d, doc, `Compared "${c.nameA}" with "${c.nameB}": the first has ${ch.nodesRemoved.length} step(s) the second lacks, the second has ${ch.nodesAdded.length} the first lacks. The designer shows "${c.nameA}" with the differences listed.`, FOLLOW);
    }
    const r = resolve(text);
    if (!r.graph) return clarification(text, r.clarify ?? 'Which process should the workflow show?', r.suggestions ?? []);
    const doc = newDoc(enrich(r.graph), r.notes, text, r.lifecycle ?? null);
    const d = createDraft(userId, conversationId, text, doc);
    return openAnswer(text, d, doc, `I built the workflow "${doc.graph.name}" and opened it in the Workflow Designer, where you can explore every step, change it and save it.`, FOLLOW);
  } catch (e) {
    const d = failDraft(userId, conversationId, text, (e as Error).message || 'The workflow could not be generated.');
    return answer(text, 'Workflow could not be generated', 'partial', 'Your request was kept; you can retry it.', [{ kind: 'answer', title: 'Answer', text: `Generating the workflow failed: ${d.error}. Your request is saved, so you can retry without typing it again.` }],
      { action: { type: 'workflow-failed', draftId: d.id, error: d.error ?? '', request: text } as ChatAction } as Partial<KnowledgeAnswer>);
  }
}

/** Stores one exchange in a conversation (used for the messages typed in the designer's own chat box). */
export function appendExchange(conversationId: string, userText: string, a: KnowledgeAnswer): void {
  const now = nowIso();
  run('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)', conversationId, 'user', userText, now);
  run('INSERT INTO messages (conversation_id, role, content, answer, created_at) VALUES (?, ?, ?, ?, ?)', conversationId, 'assistant', a.markdown, JSON.stringify(a), now);
  run('UPDATE conversations SET updated_at = ? WHERE id = ?', now, conversationId);
}

/** A conversation for a draft that has none (a request made in the designer itself). */
export function ensureConversation(userId: number, title: string): string {
  const id = `C-${randomToken(9)}`;
  const now = nowIso();
  run('INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, userId, title.slice(0, 120), now, now);
  return id;
}

/** A message typed in the designer: an edit of the open draft, or a request for another workflow. */
export function designerMessage(draftId: string, userId: number, text: string): { reply: string; ok: boolean; draftId: string; newDraft: boolean; answer: KnowledgeAnswer } {
  const d = getDraft(draftId, userId);
  const convId = d.conversationId ?? ensureConversation(userId, d.title);
  if (!d.conversationId) run('UPDATE workflow_drafts SET conversation_id = ? WHERE id = ?', convId, d.id);
  const kind = d.doc ? workflowKind(text, 'ask', true) : 'create';
  let result: { reply: string; ok: boolean; draftId: string; newDraft: boolean; answer: KnowledgeAnswer };
  if (kind === 'create' || kind === 'compare' || !d.doc) {
    const a = workflowTurn(text, 'workflow', convId, userId) ?? clarification(text, 'Which process should the workflow show?', []);
    const act = (a as KnowledgeAnswer & { action?: ChatAction }).action;
    result = { reply: a.sections[0]?.text ?? a.title, ok: act?.type === 'open-workflow', draftId: act?.type === 'open-workflow' ? act.draftId : draftId, newDraft: act?.type === 'open-workflow', answer: a };
    // workflowTurn stored nothing in the conversation; the exchange is added below like any other
  } else {
    const r = applyCommand(d.doc, text, 'you');
    if (r.ok) updateDoc(d.id, userId, r.doc, text);
    const a = answer(text, r.ok ? `Updated: ${d.doc.graph.name}` : 'Workflow not changed', r.ok ? 'provisional' : 'partial', r.ok ? 'The draft changed; it is still not an approved workflow.' : 'The workflow was left as it was.',
      [{ kind: 'answer', title: 'Answer', text: r.reply }], r.ok ? { followUps: FOLLOW } : {});
    result = { reply: r.reply, ok: r.ok, draftId, newDraft: false, answer: a };
  }
  appendExchange(convId, text, result.answer);
  return result;
}

export const draftOwner = (id: string): number | null => get<{ user_id: number }>('SELECT user_id FROM workflow_drafts WHERE id = ?', id)?.user_id ?? null;
