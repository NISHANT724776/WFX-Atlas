// Persistent conversations: messages, per-conversation context for follow-ups, modes that call real functionality,
// regenerate, summary and Markdown export. A user only ever sees their own conversations.
import { all, get, parseJson, run, tx } from '../db.ts';
import { analyseRequirement, baSections } from '../ba/analyse.ts';
import { proposeRule } from '../rules/rules.ts';
import { nowIso, randomToken } from '../util.ts';
import { answerQuestion, toMarkdown } from './answer.ts';
import type { Depth, KnowledgeAnswer, Mode, Section, Topic } from './answer.ts';
import { aiRewrite } from './llm.ts';
import { workflowTurn } from './workflow-chat.ts';
import { aiState } from './llm.ts';
import { clarify, enrichAnswer, generalNote, navigatorTurn } from './navigator.ts';
import { claudeTurn } from './claude-chat.ts';
import { log } from '../util.ts';
import type { User } from '../auth.ts';

export type ChatMode = Mode | 'rule' | 'ba';
export const CHAT_MODES: ChatMode[] = ['ask', 'transaction', 'workflow', 'data_model', 'calculate', 'rule', 'ba'];
export interface Message { id: number; role: 'user' | 'assistant'; content: string; answer: KnowledgeAnswer | null; createdAt: string }

export function listConversations(userId: number): { id: string; title: string; updatedAt: string; messages: number }[] {
  return all<Record<string, unknown>>('SELECT c.id, c.title, c.updated_at, (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id) AS n FROM conversations c WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 200', userId)
    .map((r) => ({ id: String(r['id']), title: String(r['title']), updatedAt: String(r['updated_at']), messages: Number(r['n']) }));
}

export function createConversation(userId: number, title = 'New conversation'): { id: string; title: string } {
  const id = `C-${randomToken(9)}`;
  const now = nowIso();
  run('INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', id, userId, title.slice(0, 120), now, now);
  return { id, title };
}

function own(id: string, userId: number): Record<string, unknown> {
  const c = get<Record<string, unknown>>('SELECT * FROM conversations WHERE id = ? AND user_id = ?', id, userId);
  if (!c) throw Object.assign(new Error('Conversation not found.'), { status: 404 });
  return c;
}

export function getConversation(id: string, userId: number): { id: string; title: string; summary: string; messages: Message[] } {
  const c = own(id, userId);
  const messages = all<Record<string, unknown>>('SELECT * FROM messages WHERE conversation_id = ? ORDER BY id', id).map((m) => ({
    id: Number(m['id']), role: m['role'] as Message['role'], content: String(m['content']), answer: parseJson<KnowledgeAnswer | null>(m['answer'] as string, null), createdAt: String(m['created_at']),
  }));
  return { id, title: String(c['title']), summary: summarise(messages), messages };
}

export function deleteConversation(id: string, userId: number): void {
  own(id, userId);
  run('DELETE FROM conversations WHERE id = ?', id);
}

/** Answers one message in a mode, using (and updating) the conversation's context. */
export async function respond(content: string, mode: ChatMode, depth: Depth, ctx: Topic | null, userId: number | null, history: { role: 'user' | 'assistant'; text: string }[]): Promise<KnowledgeAnswer> {
  if (mode === 'rule') return ruleAnswer(content);
  if (mode === 'ba') return baAnswer(content);
  const admin = userId !== null && get<{ role: string }>('SELECT role FROM users WHERE id = ?', userId)?.role === 'admin';
  const a = answerQuestion(content, { mode, depth, context: ctx, userId, admin });
  return (await aiRewrite(a, history)) ?? a;
}

/** Claude answers chat messages when a Claude credential exists and an admin recorded the organisation's approval for Claude (or for any provider). */
export function claudeActive(): boolean {
  const st = aiState();
  return st.active && st.providers.includes('claude') && (!st.authorisation?.provider || st.authorisation.provider === 'claude');
}

function userOf(userId: number): User | null {
  const u = get<{ id: number; username: string; display_name: string; role: string }>('SELECT id, username, display_name, role FROM users WHERE id = ?', userId);
  return u ? { id: u.id, username: u.username, displayName: u.display_name, role: u.role as User['role'] } : null;
}

/** Renames a conversation (1–120 characters). */
export function renameConversation(id: string, userId: number, title: string): { id: string; title: string } {
  own(id, userId);
  const t = title.replace(/\s+/g, ' ').trim().slice(0, 120);
  if (!t) throw Object.assign(new Error('Write a title.'), { status: 400 });
  run('UPDATE conversations SET title = ? WHERE id = ?', t, id);
  return { id, title: t };
}

/** The user's conversations whose title or messages contain the words. */
export function searchConversations(userId: number, q: string): { id: string; title: string; updatedAt: string; messages: number }[] {
  const t = q.trim().toLowerCase().slice(0, 100);
  if (!t) return listConversations(userId);
  const like = `%${t.replace(/[%_]/g, '')}%`;
  const ids = new Set(all<{ id: string }>('SELECT DISTINCT c.id FROM conversations c LEFT JOIN messages m ON m.conversation_id = c.id WHERE c.user_id = ? AND (lower(c.title) LIKE ? OR lower(m.content) LIKE ?)', userId, like, like).map((r) => r.id));
  return listConversations(userId).filter((c) => ids.has(c.id));
}

function shell(question: string, mode: Mode, title: string, sections: Section[], status: KnowledgeAnswer['status'], statusNote: string, missing: string[], followUps: string[]): KnowledgeAnswer {
  const a: KnowledgeAnswer = { question, resolvedQuestion: question, intent: 'general', mode, title, status, statusNote, sections, sources: [], missing, followUps, topic: { title, terms: [] }, generatedBy: 'knowledge-base', markdown: '', corrections: {} };
  a.markdown = toMarkdown(a);
  return a;
}

function ruleAnswer(text: string): KnowledgeAnswer {
  const p = proposeRule(text, 'assistant');
  const u = p.understanding;
  const sections: Section[] = [
    { kind: 'answer', title: 'How I read it', items: [`Category: ${u.category}`, `Transaction: ${u.transaction || 'not identified'}`, `Module: ${u.module || 'not identified'}`, ...(u.output ? [`Output: ${u.output}`] : []), ...(u.inputs.length ? [`Inputs: ${u.inputs.join(', ')}`] : []), ...(u.formula ? [`Formula: ${u.formula}`] : []), ...(u.purpose ? [`Meaning: ${u.purpose}`] : [])] },
  ];
  if (p.related.length) sections.push({ kind: p.correctionOf ? 'conflict' : 'related', title: p.correctionOf ? 'A stored rule already covers this' : 'Related stored rules', items: p.related.map((r) => `${r.id} v${r.version} (${r.status}): ${r.formula}${r.difference ? ` — ${r.difference}` : ''}`) });
  if (u.missing.length) sections.push({ kind: 'notes', title: 'Missing information', items: u.missing });
  if (u.questions.length) sections.push({ kind: 'notes', title: 'Questions before saving', items: u.questions });
  sections.push({ kind: 'code', title: `Proposed entry for ${p.suggestedFile} (status Draft)`, text: p.draftText });
  if (p.problems.length) sections.push({ kind: 'notes', title: 'Format problems', items: p.problems });
  const a = shell(text, 'ask', u.output ? `${u.output} (${u.category.toLowerCase()})` : 'Proposed rule', sections, 'provisional', 'Nothing is saved yet. Review the draft in the Rulebook ("Teach a rule") to save it as a Draft or, with approver rights, approve it.', u.missing, ['Open the Rulebook to save this draft']);
  (a as KnowledgeAnswer & { proposal?: unknown }).proposal = { draftText: p.draftText, suggestedFile: p.suggestedFile, correctionOf: p.correctionOf, id: p.draft.id };
  return a;
}

function baAnswer(text: string): KnowledgeAnswer {
  const r = analyseRequirement(text);
  return shell(text, 'ask', r.dependencies[0] ? `${r.dependencies[0].trigger} → ${r.dependencies[0].target}` : `Analysis: ${r.kind}`, baSections(r), 'provisional', 'Business-analyst analysis of your text. Generated stories, criteria and tests are proposals, not confirmed requirements.', r.missing, ['Turn this into a rule (Analyse Business Rule mode)']);
}

export async function postMessage(id: string, userId: number, content: string, mode: ChatMode, depth: Depth): Promise<{ question: Message; answer: Message }> {
  const c = own(id, userId);
  const text = content.trim().slice(0, 4000);
  if (!text) throw Object.assign(new Error('Write a question.'), { status: 400 });
  const ctx = parseJson<Topic | null>(c['context'] as string, null);
  const prior = all<{ role: string; content: string }>('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT 6', id).reverse().map((m) => ({ role: m.role as 'user' | 'assistant', text: m.content }));
  // a request to create / change / compare a workflow becomes a stored draft and an "open the designer" action, not a text answer
  const user = userOf(userId);
  const m: ChatMode = CHAT_MODES.includes(mode) ? mode : 'ask';
  // AI mode on with Claude: Claude reads the message and uses the platform's tools; nothing is routed by hand-written rules
  let tokens: number | null = null;
  let viaClaude: KnowledgeAnswer | null = null;
  if (claudeActive() && (m === 'ask' || m === 'workflow' || m === 'transaction')) {
    try { const r = await claudeTurn({ question: text, history: prior, user, userId, conversationId: id, admin: user?.role === 'admin' }); viaClaude = r.answer; tokens = r.tokens; }
    catch (e) { log('error', 'Claude answer failed; the knowledge engine answers instead', { error: (e as Error).message }); }
  }
  const plain = m === 'ask' || m === 'workflow' || m === 'transaction';
  // order: open a screen / the Trims prototype → ambiguous subject → workflow request → knowledge answer (+ destinations and guides)
  const a = viaClaude ?? (plain ? navigatorTurn(text, 'ask', user) ?? clarify(text, 'ask', user) : null)
    ?? workflowTurn(text, mode, id, userId)
    ?? (plain ? enrichAnswer(generalNote(await respond(text, m, depth, ctx, userId, prior), aiState().active), user) : await respond(text, m, depth, ctx, userId, prior));
  const now = nowIso();
  return tx(() => {
    const q = run('INSERT INTO messages (conversation_id, role, content, created_at) VALUES (?, ?, ?, ?)', id, 'user', text, now).lastId;
    const r = run('INSERT INTO messages (conversation_id, role, content, answer, created_at, token_usage) VALUES (?, ?, ?, ?, ?, ?)', id, 'assistant', a.markdown, JSON.stringify(a), now, tokens).lastId;
    const title = String(c['title']) === 'New conversation' ? text.slice(0, 80) : String(c['title']);
    const nextCtx = a.status === 'not-documented' && ctx ? ctx : a.topic;
    run('UPDATE conversations SET title = ?, context = ?, updated_at = ? WHERE id = ?', title, JSON.stringify(nextCtx), now, id);
    return { question: { id: q, role: 'user', content: text, answer: null, createdAt: now }, answer: { id: r, role: 'assistant', content: a.markdown, answer: a, createdAt: now } };
  });
}

/** Answers the last question again (for example with another mode or depth); the earlier answer stays in the history. */
export async function regenerate(id: string, userId: number, mode: ChatMode, depth: Depth): Promise<Message> {
  own(id, userId);
  const last = get<{ content: string }>("SELECT content FROM messages WHERE conversation_id = ? AND role = 'user' ORDER BY id DESC LIMIT 1", id);
  if (!last) throw Object.assign(new Error('Nothing to regenerate yet.'), { status: 400 });
  const ctxRow = get<{ context: string }>('SELECT context FROM conversations WHERE id = ?', id);
  const user = userOf(userId);
  const a = enrichAnswer(generalNote(await respond(last.content, mode, depth, parseJson<Topic | null>(ctxRow?.context, null), userId, []), aiState().active), user);
  const now = nowIso();
  const r = run('INSERT INTO messages (conversation_id, role, content, answer, created_at) VALUES (?, ?, ?, ?, ?)', id, 'assistant', a.markdown, JSON.stringify(a), now).lastId;
  run('UPDATE conversations SET updated_at = ? WHERE id = ?', now, id);
  return { id: r, role: 'assistant', content: a.markdown, answer: a, createdAt: now };
}

/** Deterministic summary: the topics asked, with the knowledge status each answer had. */
export function summarise(messages: Message[]): string {
  const answers = messages.filter((m) => m.role === 'assistant' && m.answer);
  if (!answers.length) return '';
  const lines = answers.map((m) => `${m.answer!.title} — ${m.answer!.status}${m.answer!.sources.length ? ` (${m.answer!.sources.slice(0, 2).map((s) => s.entryId ?? s.docId).join(', ')})` : ''}`);
  const gaps = answers.filter((m) => ['not-documented', 'partial'].includes(m.answer!.status)).length;
  return `${answers.length} answer(s): ${lines.join('; ')}.${gaps ? ` ${gaps} question(s) were not fully documented.` : ''}`;
}

export function exportMarkdown(id: string, userId: number): string {
  const c = getConversation(id, userId);
  const out = [`# ${c.title}`, '', `_Exported ${nowIso()} from the WFX knowledge platform._`, '', `**Summary:** ${c.summary || '–'}`, ''];
  for (const m of c.messages) out.push(m.role === 'user' ? `---\n\n**Question:** ${m.content}\n` : `${m.content}\n`);
  return out.join('\n');
}
