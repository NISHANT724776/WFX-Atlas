// Persisted workflow drafts. A draft belongs to one user and (normally) one conversation; it is NOT knowledge. It lives in
// the database, with every version kept, until someone saves it to the library (a Draft entry in review/pending.txt) and an
// approver approves it through the normal rule lifecycle. A failed generation is kept too (request + error) so it can be
// retried without typing the request again.
import { all, get, parseJson, run, tx } from '../db.ts';
import { getEntry } from '../knowledge/repo.ts';
import { saveDraft } from '../rules/rules.ts';
import type { Role } from '../auth.ts';
import { idPart, nowIso, randomToken } from '../util.ts';
import { diff as graphDiff, graphToEntry, graphToMermaid, testPaths, validate } from './designer.ts';
import type { Graph } from './designer.ts';
import { enrich, newDoc, resolve } from './generate.ts';
import type { DraftDoc } from './generate.ts';

export class DraftError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

export interface DraftRow {
  id: string; userId: number; conversationId: string | null; title: string; request: string; state: 'ready' | 'failed'; error: string | null;
  doc: DraftDoc | null; version: number; entryId: string | null; createdAt: string; updatedAt: string;
}

const toRow = (r: Record<string, unknown>): DraftRow => ({
  id: String(r['id']), userId: Number(r['user_id']), conversationId: (r['conversation_id'] as string) ?? null, title: String(r['title']), request: String(r['request']),
  state: r['state'] as 'ready' | 'failed', error: (r['error'] as string) ?? null, doc: parseJson<DraftDoc | null>(r['doc'] as string, null), version: Number(r['version']),
  entryId: (r['entry_id'] as string) ?? null, createdAt: String(r['created_at']), updatedAt: String(r['updated_at']),
});

export function createDraft(userId: number, conversationId: string | null, request: string, doc: DraftDoc, reason = 'Generated from the request'): DraftRow {
  const id = `WFD-${randomToken(7)}`;
  const now = nowIso();
  tx(() => {
    run('INSERT INTO workflow_drafts (id, user_id, conversation_id, title, request, state, doc, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)', id, userId, conversationId, doc.graph.name.slice(0, 150), request.slice(0, 4000), 'ready', JSON.stringify(doc), now, now);
    run('INSERT INTO workflow_draft_versions (draft_id, version, doc, reason, created_at) VALUES (?, 1, ?, ?, ?)', id, JSON.stringify(doc), reason, now);
  });
  return getDraft(id, userId);
}

/** Keeps the request and the error of a generation that failed, so it can be retried. */
export function failDraft(userId: number, conversationId: string | null, request: string, error: string): DraftRow {
  const id = `WFD-${randomToken(7)}`;
  const now = nowIso();
  run('INSERT INTO workflow_drafts (id, user_id, conversation_id, title, request, state, error, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)', id, userId, conversationId, request.slice(0, 80), request.slice(0, 4000), 'failed', error.slice(0, 1000), now, now);
  return getDraft(id, userId);
}

export function getDraft(id: string, userId: number): DraftRow {
  const r = get<Record<string, unknown>>('SELECT * FROM workflow_drafts WHERE id = ? AND user_id = ?', id, userId);
  if (!r) throw new DraftError('Workflow draft not found.', 404);
  return toRow(r);
}

export function latestDraft(conversationId: string, userId: number): DraftRow | null {
  const r = get<Record<string, unknown>>("SELECT * FROM workflow_drafts WHERE conversation_id = ? AND user_id = ? AND state = 'ready' ORDER BY updated_at DESC, rowid DESC LIMIT 1", conversationId, userId);
  return r ? toRow(r) : null;
}

export function listDrafts(userId: number, conversationId?: string): Omit<DraftRow, 'doc'>[] {
  const rows = conversationId
    ? all<Record<string, unknown>>('SELECT * FROM workflow_drafts WHERE user_id = ? AND conversation_id = ? ORDER BY updated_at DESC LIMIT 100', userId, conversationId)
    : all<Record<string, unknown>>('SELECT * FROM workflow_drafts WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100', userId);
  return rows.map((r) => { const { doc: _doc, ...rest } = toRow(r); return rest; });
}

/** Stores a changed document. `newVersion` keeps the previous one in the history (chat edits, "save version"); otherwise it replaces the current one in place (autosave while dragging). */
export function updateDoc(id: string, userId: number, doc: DraftDoc, reason: string, newVersion = true): DraftRow {
  const d = getDraft(id, userId);
  if (d.state !== 'ready') throw new DraftError('This draft has no workflow yet; retry the generation first.', 409);
  const now = nowIso();
  const version = newVersion ? d.version + 1 : d.version;
  tx(() => {
    run('UPDATE workflow_drafts SET doc = ?, title = ?, version = ?, updated_at = ? WHERE id = ?', JSON.stringify(doc), doc.graph.name.slice(0, 150), version, now, id);
    if (newVersion) run('INSERT INTO workflow_draft_versions (draft_id, version, doc, reason, created_at) VALUES (?, ?, ?, ?, ?)', id, version, JSON.stringify(doc), reason.slice(0, 300), now);
    else run('UPDATE workflow_draft_versions SET doc = ? WHERE draft_id = ? AND version = ?', JSON.stringify(doc), id, version);
  });
  return getDraft(id, userId);
}

export function draftVersions(id: string, userId: number): { version: number; reason: string; createdAt: string }[] {
  getDraft(id, userId);
  return all<Record<string, unknown>>('SELECT version, reason, created_at FROM workflow_draft_versions WHERE draft_id = ? ORDER BY version DESC', id).map((r) => ({ version: Number(r['version']), reason: String(r['reason'] ?? ''), createdAt: String(r['created_at']) }));
}

export function draftVersion(id: string, userId: number, version: number): DraftDoc {
  getDraft(id, userId);
  const r = get<{ doc: string }>('SELECT doc FROM workflow_draft_versions WHERE draft_id = ? AND version = ?', id, version);
  if (!r) throw new DraftError('Version not found.', 404);
  return parseJson<DraftDoc>(r.doc, null as never);
}

export const compareVersions = (id: string, userId: number, a: number, b: number) => graphDiff(draftVersion(id, userId, a).graph, draftVersion(id, userId, b).graph);

/** Goes back to the version before the current one (as a new version, so nothing is lost). */
export function undo(id: string, userId: number): DraftRow {
  const d = getDraft(id, userId);
  if (d.version < 2) throw new DraftError('There is no earlier version to go back to.', 409);
  return updateDoc(id, userId, draftVersion(id, userId, d.version - 1), `Went back to version ${d.version - 1}`);
}

/** Runs the generation again for a failed (or any) draft's request. */
export function retry(id: string, userId: number): DraftRow {
  const d = getDraft(id, userId);
  const r = resolve(d.request);
  if (!r.graph) throw new DraftError(r.clarify ?? 'No workflow could be built from this request.', 422);
  const doc = newDoc(enrich(r.graph), r.notes, d.request, r.lifecycle ?? null);
  if (d.state === 'ready') return updateDoc(id, userId, doc, 'Regenerated from the request');
  const now = nowIso();
  tx(() => {
    run("UPDATE workflow_drafts SET state = 'ready', error = NULL, doc = ?, title = ?, version = 1, updated_at = ? WHERE id = ?", JSON.stringify(doc), doc.graph.name.slice(0, 150), now, id);
    run('INSERT INTO workflow_draft_versions (draft_id, version, doc, reason, created_at) VALUES (?, 1, ?, ?, ?)', id, JSON.stringify(doc), 'Generated from the request (retry)', now);
  });
  return getDraft(id, userId);
}

/** Saves the draft to the library as a Draft entry (needs editor rights); approval stays with the Rulebook. */
export function saveToLibrary(id: string, userId: number, username: string, role: Role, reason = ''): { entryId: string; version: number } {
  const d = getDraft(id, userId);
  if (!d.doc) throw new DraftError('This draft has no workflow yet.', 409);
  // generated workflows get their own recognisable ID range, so they never collide with a documented workflow of the same name
  const g: Graph = { ...d.doc.graph, id: d.entryId ?? (d.doc.graph.id || `WF-GEN-${idPart(d.doc.graph.name || 'WORKFLOW')}`) };
  const entry = graphToEntry(g, username);
  if (d.conversationId) entry.fields['SOURCE'] = `${entry.fields['SOURCE']} · from conversation ${d.conversationId}, request: "${d.request.slice(0, 160)}"`;
  const out = saveDraft(entry, username, role, reason || 'Saved from a chat-generated workflow draft');
  run('UPDATE workflow_drafts SET entry_id = ?, updated_at = ? WHERE id = ?', out.id, nowIso(), id);
  return { entryId: out.id, version: out.version };
}

/** Everything the designer page needs for one draft. */
export function draftView(id: string, userId: number) {
  const d = getDraft(id, userId);
  const entry = d.entryId ? getEntry(d.entryId) : undefined;
  const meta = {
    id: d.id, title: d.title, request: d.request, state: d.state, error: d.error, conversationId: d.conversationId, version: d.version,
    workflowId: d.entryId ?? d.id, entryId: d.entryId, createdAt: d.createdAt, updatedAt: d.updatedAt,
    approvalStatus: entry ? entry.status : 'Draft', saved: !!entry, savedVersion: entry?.version ?? null,
  };
  if (!d.doc) return { draft: meta, doc: null, problems: [], paths: [], mermaid: '', versions: draftVersions(id, userId) };
  const g = d.doc.graph;
  return { draft: meta, doc: d.doc, problems: validate(g), paths: testPaths(g), mermaid: graphToMermaid(g), versions: draftVersions(id, userId) };
}
