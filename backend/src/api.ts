// API routes (/api/v2). Each route states who may call it: public, any signed-in user, or a list of roles.
import fs from 'node:fs';
import type http from 'node:http';
import path from 'node:path';
import { evaluate, generateTests, parseSpec } from './calc/engine.ts';
import { KDIRS, settings } from './config.ts';
import { all, get, parseJson, run } from './db.ts';
import { allow, approveUser, atLeast, audit, completeSetup, createUser, isPending, listUsers, login, logout, rejectUser, ROLES, setPassword, setSignupMode, setupRequired, SIGNUP_MODES, signup, signupMode, updateUser } from './auth.ts';
import type { Role, User } from './auth.ts';
import { analyseRequirement, baSections } from './ba/analyse.ts';
import { answerQuestion } from './assistant/answer.ts';
import { CHAT_MODES, createConversation, deleteConversation, exportMarkdown, getConversation, listConversations, postMessage, regenerate, renameConversation, searchConversations } from './assistant/conversations.ts';
import { assetFile, findForQuestion, getGuide, getScreen, listGuides, listScreens, resolveNavigation } from './registry/registry.ts';
import type { ChatMode } from './assistant/conversations.ts';
import { aiState, setAiAuthorisation } from './assistant/llm.ts';
import { indexLibrary } from './index/indexer.ts';
import { DOC_TYPES, documentList, ingestBuffer, KNOWLEDGE_STATUSES, readRegistry, reindexDocuments, reprocess, setCandidateDecision } from './ingest/pipeline.ts';
import { kpath, readChanges, readHistory } from './knowledge/library.ts';
import { entryVersions, getEntry, listEntries, relationsOf } from './knowledge/repo.ts';
import { serializeEntry } from './knowledge/txt.ts';
import { allowedTransitions, impactOf, proposeRule, RuleError, saveDraft, transition } from './rules/rules.ts';
import { search } from './search/search.ts';
import { writeZip } from './ingest/zip.ts';
import { diff as graphDiff, EDGE_KINDS, FORMATS, graphFromEntry, graphFromText, graphToEntry, graphToMermaid, layout, testPaths, validate } from './workflows/designer.ts';
import type { Graph } from './workflows/designer.ts';
import { draftFromText, listModels, modelToEntry, modelView, openModel } from './datamodel/studio.ts';
import type { DataModel } from './datamodel/studio.ts';
import { compareVersions, draftVersion, draftView, DraftError, getDraft, listDrafts, retry as retryDraft, saveToLibrary, undo as undoDraft, updateDoc } from './workflows/drafts.ts';
import { readAdminDirectory } from './admin/directory.ts';
import { designerMessage, ensureConversation, appendExchange, workflowTurn } from './assistant/workflow-chat.ts';
import type { ChatAction } from './assistant/workflow-chat.ts';
import type { DraftDoc } from './workflows/generate.ts';
import { enrich as enrichGraph } from './workflows/generate.ts';
import { selectDiagram } from './workflows/select.ts';
import { inside, nowIso, toPosix } from './util.ts';
import * as SO from './sales/orders.ts';
import * as SOC from './sales/config.ts';
import { TOOLS as SO_TOOLS } from './sales/masters.ts';
import { addQuestion, listUnits, regenerate as regenerateEnrichment, setQuestion, setUnitReview, summary as enrichmentSummary, tryQuestion, unitDetail } from './enrich/review.ts';

export interface Ctx { req: http.IncomingMessage; res: http.ServerResponse; url: URL; params: Record<string, string>; user: User | null; token?: string; ip: string; body: Record<string, unknown>; raw: Buffer; ua: string }
type Auth = 'public' | 'user' | Role[];
interface Route { method: string; re: RegExp; auth: Auth; upload?: boolean; handler: (c: Ctx) => unknown }

const fail = (status: number, message: string): never => { throw Object.assign(new Error(message), { status }); };
const str = (v: unknown, max = 500) => (typeof v === 'string' ? v.slice(0, max) : '');
const EDIT: Role[] = ['admin', 'approver', 'editor'];
const APPROVE: Role[] = ['admin', 'approver'];
const ADMIN: Role[] = ['admin'];
const r = (method: string, p: string, auth: Auth, handler: Route['handler'], upload = false): Route => ({
  method, auth, upload, handler, re: new RegExp(`^${p.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`),
});
const sessionCookie = (token: string, maxAge: number) => `wfx_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${settings().secureCookies ? '; Secure' : ''}`;
const wrapRule = <T>(fn: () => T): T => { try { return fn(); } catch (e) { if (e instanceof RuleError || e instanceof DraftError) fail(e.status, e.message); throw e; } };

function dashboard(user: User) {
  const n = (sql: string, ...p: unknown[]) => Number(get<{ n: number }>(sql, ...p)?.n ?? 0);
  const changes = readChanges();
  return {
    totals: {
      documents: n('SELECT COUNT(*) AS n FROM documents'), documentVersions: n('SELECT COUNT(*) AS n FROM document_versions'),
      modules: n("SELECT COUNT(*) AS n FROM entries WHERE type = 'module' AND is_current = 1"), transactions: n("SELECT COUNT(*) AS n FROM entries WHERE type = 'transaction' AND is_current = 1"),
      rulesConfirmed: n("SELECT COUNT(*) AS n FROM entries WHERE type = 'rule' AND is_current = 1 AND status IN ('Active', 'Approved')"),
      rulesProvisional: n("SELECT COUNT(*) AS n FROM entries WHERE type = 'rule' AND (is_current = 1 OR file LIKE 'review/%') AND status IN ('Draft', 'Under Review')"),
      calculationsRunnable: n("SELECT COUNT(*) AS n FROM entries WHERE type = 'rule' AND is_current = 1 AND json_extract(fields, '$.fields.EXPRESSION') <> ''"),
      workflows: n("SELECT COUNT(*) AS n FROM entries WHERE type = 'workflow' AND is_current = 1"), dataModels: n("SELECT COUNT(*) AS n FROM entries WHERE type = 'model' AND is_current = 1"),
      terms: n("SELECT COUNT(*) AS n FROM entries WHERE type = 'term' AND is_current = 1"), procedures: n("SELECT COUNT(*) AS n FROM entries WHERE type = 'procedure' AND is_current = 1"),
      fields: n("SELECT COUNT(*) AS n FROM entries WHERE type = 'field' AND is_current = 1"), chunks: n('SELECT COUNT(*) AS n FROM chunks WHERE is_current = 1'),
      candidatesNew: n("SELECT COUNT(*) AS n FROM candidates WHERE status = 'new'"), gaps: n('SELECT COUNT(*) AS n FROM knowledge_gaps'),
    },
    pendingApprovals: all("SELECT id, version, status, title, type, module, file, updated_at FROM entries WHERE status IN ('Draft', 'Under Review', 'Approved') AND (is_current = 1 OR file LIKE 'review/%') ORDER BY updated_at DESC LIMIT 25"),
    recentUpdates: changes.slice(-15).reverse(),
    recentTopics: all("SELECT topic, COUNT(*) AS hits, MAX(at) AS last FROM topic_hits WHERE at > ? GROUP BY topic ORDER BY hits DESC, last DESC LIMIT 10", new Date(Date.now() - 30 * 86400_000).toISOString()),
    gaps: all('SELECT question, missing, MAX(at) AS last, COUNT(*) AS times FROM knowledge_gaps GROUP BY question ORDER BY last DESC LIMIT 12'),
    conversations: listConversations(user.id).slice(0, 6),
    documentsByStatus: all('SELECT v.status, COUNT(*) AS n FROM documents d JOIN document_versions v ON v.document_id = d.id AND v.version = d.current_version GROUP BY v.status'),
    entriesByType: all("SELECT type, status, COUNT(*) AS n FROM entries WHERE is_current = 1 OR file LIKE 'review/%' GROUP BY type, status ORDER BY type"),
  };
}

function entryDetail(id: string, user: User) {
  const versions = entryVersions(id);
  if (!versions.length) fail(404, `Entry ${id} was not found.`);
  const current = versions.find((v) => v.isCurrent) ?? versions[0];
  const pending = versions.find((v) => v.file.startsWith('review/'));
  const toEntry = (v: typeof current) => ({ idKey: Object.keys(v.fields)[0], id: v.id, type: v.type as never, fields: v.fields, order: v.order });
  return {
    current, pending: pending && pending !== current ? pending : null, versions: versions.map((v) => ({ version: v.version, status: v.status, file: v.file, updatedAt: v.updatedAt, isCurrent: v.isCurrent })),
    history: readHistory(id).map((h) => ({ version: h.fields['VERSION'], status: h.fields['STATUS'], fields: h.fields })),
    raw: serializeEntry(toEntry(pending ?? current)), relations: relationsOf(id),
    transitions: { current: allowedTransitions(current.status, user.role), pending: pending ? allowedTransitions(pending.status, user.role) : [] },
    changes: all('SELECT * FROM entry_changes WHERE entry_id = ? ORDER BY id DESC LIMIT 50', id).concat(readChanges().filter((c) => c.entry_id === id).reverse() as never[]).slice(0, 50),
  };
}

function transactionPage(id: string) {
  const t = getEntry(id);
  if (!t || t.type !== 'transaction') fail(404, 'Transaction not found.');
  const tx = t!;
  const rel = relationsOf(tx.id);
  const slug = tx.fields['SLUG'];
  const fields = all<Record<string, unknown>>("SELECT id, title, fields FROM entries WHERE type = 'field' AND is_current = 1 AND txn LIKE ?", `%(${slug})%`)
    .map((f) => { const x = parseJson<{ fields: Record<string, string> }>(f['fields'] as string, { fields: {} }).fields; return { id: f['id'], name: f['title'], group: x['FIELD GROUP'], type: x['FIELD TYPE'], definition: x['DEFINITION'], source: [x['SOURCE TRANSACTION'], x['SOURCE FIELD']].filter(Boolean).join(' › '), calculation: x['CALCULATION'] }; });
  const linked = (ids: string[]) => ids.map((i) => getEntry(i)).filter(Boolean).map((e) => ({ id: e!.id, title: e!.title, status: e!.status, version: e!.version, category: e!.category, formula: e!.fields['FORMULA / LOGIC'] ?? '', type: e!.type }));
  const rules = linked(rel.incoming.filter((x) => x.rel === 'applies_to').map((x) => x.fromId));
  const calcs = linked(rel.outgoing.filter((x) => x.rel === 'uses_calculation').map((x) => x.toId));
  const cases = all<{ id: string; title: string }>("SELECT id, title FROM entries WHERE type = 'case' AND is_current = 1 AND txn LIKE ?", `%(${slug})%`);
  const procedures = search(tx.title.replace(/\s*\(.*\)$/, ''), { kinds: ['procedure'], limit: 6 }).hits.filter((h) => h.coverage >= 0.99).map((h) => ({ id: h.entryId, title: h.title }));
  const sections: { key: string; label: string; value: unknown; documented: boolean }[] = [];
  const add = (key: string, label: string, value: unknown) => sections.push({ key, label, value, documented: Array.isArray(value) ? value.length > 0 : !!value });
  add('name', 'Transaction name', tx.title); add('module', 'Module', tx.module); add('submodule', 'Submodule', tx.submodule ?? '');
  add('purpose', 'Purpose', tx.fields['PURPOSE']); add('context', 'Business context', tx.fields['BUSINESS CONTEXT']); add('navigation', 'Navigation path', tx.fields['NAVIGATION PATH']);
  add('prerequisites', 'Prerequisite settings', tx.fields['PREREQUISITE SETTINGS'] ?? ''); add('masters', 'Required master data', tx.fields['REQUIRED MASTER DATA'] ?? '');
  add('fields', 'Input fields and definitions', fields); add('keys', 'Keys', tx.fields['KEYS']); add('defaults', 'Default values', tx.fields['DEFAULT VALUES'] ?? '');
  add('validations', 'Validations', rules.filter((x) => /valid/i.test(x.category ?? ''))); add('calculations', 'Calculation logic', calcs);
  add('workflow', 'Transaction workflow', rel.incoming.filter((x) => x.rel === 'includes').map((x) => ({ id: x.fromId, title: x.otherTitle })));
  add('statuses', 'Transaction statuses', tx.fields['STATUSES'] ?? ''); add('confirmation', 'Confirmation behaviour', tx.fields['CONFIRMATION BEHAVIOUR'] ?? '');
  add('outputs', 'Resulting outputs', tx.fields['DOWNSTREAM']); add('next', 'Next transaction', rel.outgoing.filter((x) => x.rel === 'feeds').map((x) => ({ id: x.toId, title: x.otherTitle })));
  add('previous', 'Previous transaction', rel.incoming.filter((x) => x.rel === 'feeds').map((x) => ({ id: x.fromId, title: x.otherTitle })));
  add('rules', 'Business rules', rules.filter((x) => !/valid/i.test(x.category ?? ''))); add('cases', 'Observations and exceptions', cases);
  add('errors', 'Common errors', procedures.filter((p) => /error|wrong|problem|not defined|inactive/i.test(p.title))); add('verification', 'Verification against WFX', tx.fields['VERIFICATION']);
  add('screenshots', 'Relevant screenshots', all<{ title: string; fields: string }>("SELECT title, fields FROM entries WHERE type = 'model' AND is_current = 1 AND json_extract(fields, '$.fields.SCREENSHOTS') <> ''").filter((m) => normalize2(m.title).includes(normalize2(tx.title.split(/\s+[–-]\s+/)[0]))).flatMap((m) => (parseJson<{ fields: Record<string, string> }>(m.fields, { fields: {} }).fields['SCREENSHOTS'] ?? '').split('\n').filter(Boolean)));
  add('docs', 'Related documentation', [...procedures, ...rel.incoming.filter((x) => x.rel === 'mentions').map((x) => ({ id: x.fromId, title: x.otherTitle }))]);
  return { transaction: tx, sections, notDocumented: sections.filter((s) => !s.documented).map((s) => s.label) };
}
/** A workflow graph sent by the browser: shape-checked and size-limited before use. */
function readGraph(v: unknown): Graph {
  const g = (v ?? {}) as Record<string, unknown>;
  const s = (x: unknown, n = 300) => (typeof x === 'string' ? x.slice(0, n) : '');
  const nodes = Array.isArray(g['nodes']) ? (g['nodes'] as Record<string, unknown>[]).slice(0, 300) : [];
  const edges = Array.isArray(g['edges']) ? (g['edges'] as Record<string, unknown>[]).slice(0, 600) : [];
  const TYPES = ['start', 'end', 'activity', 'decision', 'parallel', 'exception', 'state'], BASIS = ['documented', 'proposed', 'inferred'];
  return {
    id: s(g['id'], 80), name: s(g['name'], 150), description: s(g['description'], 2000), direction: g['direction'] === 'LR' ? 'LR' : 'TD',
    nodes: nodes.map((n) => ({ id: s(n['id'], 60).replace(/[^\w-]/g, '_') || 'n', type: (TYPES.includes(n['type'] as string) ? n['type'] : 'activity') as never, label: s(n['label']), role: s(n['role'], 80), transaction: s(n['transaction'], 120), basis: (BASIS.includes(n['basis'] as string) ? n['basis'] : 'proposed') as never, note: s(n['note'], 500), x: Number.isFinite(n['x']) ? Number(n['x']) : undefined, y: Number.isFinite(n['y']) ? Number(n['y']) : undefined, ...readDetails(n, s) })),
    edges: edges.map((e) => ({ from: s(e['from'], 60), to: s(e['to'], 60), label: s(e['label'], 120), ...(EDGE_KINDS.includes(e['kind'] as never) ? { kind: e['kind'] as never } : {}), ...(typeof e['condition'] === 'string' && e['condition'] ? { condition: s(e['condition'], 200) } : {}), ...(typeof e['id'] === 'string' ? { id: s(e['id'], 60) } : {}) })),
    preconditions: s(g['preconditions'], 2000), postconditions: s(g['postconditions'], 2000), exceptions: s(g['exceptions'], 2000), relatedTransactions: s(g['relatedTransactions'], 500),
    source: s(g['source'], 500), status: 'Draft', version: 0, basisNote: '',
    module: s(g['module'], 120), submodule: s(g['submodule'], 120), format: (FORMATS.includes(g['format'] as never) ? g['format'] : 'flowchart') as never,
    assumptions: strList(g['assumptions']), missing: strList(g['missing']), dependencies: strList(g['dependencies']),
    relatedDocuments: (Array.isArray(g['relatedDocuments']) ? (g['relatedDocuments'] as Record<string, unknown>[]).slice(0, 100) : []).map((r) => ({ id: s(r['id'], 80), title: s(r['title'], 200), kind: 'document', status: s(r['status'], 40) })).filter((r) => r.id),
    references: (Array.isArray(g['references']) ? (g['references'] as Record<string, unknown>[]).slice(0, 200) : []).map((r) => ({ id: s(r['id'], 80), title: s(r['title'], 200), kind: s(r['kind'], 40), status: s(r['status'], 40) })).filter((r) => r.id),
  };
}
const strList = (v: unknown, max = 60) => (Array.isArray(v) ? v.slice(0, max).map((x) => (typeof x === 'string' ? x.slice(0, 400) : '')).filter(Boolean) : []);
/** The documentation details of a step (inputs, rules, validations …): short lists of short strings. */
function readDetails(n: Record<string, unknown>, s: (x: unknown, n?: number) => string) {
  const list = (v: unknown, max = 40, len = 300) => (Array.isArray(v) ? v.slice(0, max).map((x) => s(x, len)).filter(Boolean) : undefined);
  const out: Record<string, unknown> = {};
  for (const k of ['inputs', 'outputs', 'dependencies', 'validations', 'sources']) { const l = list(n[k]); if (l?.length) out[k] = l; }
  if (Array.isArray(n['rules'])) out['rules'] = (n['rules'] as Record<string, unknown>[]).slice(0, 40).map((r) => ({ id: s(r['id'], 80), title: s(r['title'], 200), status: s(r['status'], 30), category: s(r['category'], 60) })).filter((r) => r.id);
  if (Array.isArray(n['images'])) out['images'] = (n['images'] as Record<string, unknown>[]).slice(0, 12).map((i) => ({ src: s(i['src'], 200), caption: s(i['caption'], 200) })).filter((i) => /^\/screens\/[\w./-]+$/.test(i.src));
  if (typeof n['description'] === 'string' && n['description']) out['description'] = s(n['description'], 800);
  if (n['pinned'] === true) out['pinned'] = true;
  if (typeof n['lane'] === 'string') out['lane'] = s(n['lane'], 80);
  if (typeof n['section'] === 'string') out['section'] = s(n['section'], 120);
  return out;
}
/** A data model sent by the studio page, checked field by field (it is a proposal, so its level is never "captured"). */
function readModel(v: unknown): DataModel {
  const m = (v ?? {}) as Record<string, unknown>;
  const s = (x: unknown, n = 300) => (typeof x === 'string' ? x.slice(0, n) : '');
  const BASIS = ['documented', 'proposed', 'inferred'], KIND = ['key', 'entered', 'calc', 'link', 'copied', 'attribute'], CARD = ['1:1', '1:N', 'N:1', 'M:N'];
  const ents = Array.isArray(m['entities']) ? (m['entities'] as Record<string, unknown>[]).slice(0, 150) : [];
  const rels = Array.isArray(m['relationships']) ? (m['relationships'] as Record<string, unknown>[]).slice(0, 400) : [];
  const entities = ents.map((e) => ({
    id: s(e['id'], 80) || 'e', name: s(e['name'], 120), basis: (BASIS.includes(e['basis'] as string) ? e['basis'] : 'proposed') as never, note: s(e['note'], 500),
    attributes: (Array.isArray(e['attributes']) ? (e['attributes'] as Record<string, unknown>[]).slice(0, 200) : []).map((a) => ({
      name: s(a['name'], 120), kind: (KIND.includes(a['kind'] as string) ? a['kind'] : 'attribute') as never, type: s(a['type'], 40), pk: a['pk'] === true, fk: s(a['fk'], 120),
      formula: s(a['formula'], 500), rule: s(a['rule'], 80), from: s(a['from'], 120), note: s(a['note'], 500), basis: (BASIS.includes(a['basis'] as string) ? a['basis'] : 'proposed') as never,
    })).filter((a) => a.name.trim()),
  })).filter((e) => e.name.trim());
  const ids = new Set(entities.map((e) => e.id));
  return {
    id: s(m['id'], 80), name: s(m['name'], 150), level: m['level'] === 'logical' ? 'logical' : 'conceptual', screen: '', summary: s(m['summary'], 2000), source: s(m['source'], 500),
    status: 'Draft', version: 0, basisNote: '', requirement: s(m['requirement'], 20000), entities,
    relationships: rels.map((r) => ({ from: s(r['from'], 80), to: s(r['to'], 80), cardinality: (CARD.includes(r['cardinality'] as string) ? r['cardinality'] : '1:N') as never, label: s(r['label'], 120), basis: (BASIS.includes(r['basis'] as string) ? r['basis'] : 'proposed') as never })).filter((r) => ids.has(r.from) && ids.has(r.to)),
  };
}
const viewOf = (c: { url: URL }) => (c.url.searchParams.get('view') === 'logical' ? 'logical' : 'as-is');

const graphView = (g: Graph) => ({ graph: g, problems: validate(g), paths: testPaths(g), mermaid: graphToMermaid(g) });

const normalize2 = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function knowledgeZip(includeOriginals: boolean): Buffer {
  const root = settings().knowledge;
  const files: { name: string; data: Buffer }[] = [];
  const walk = (dir: string) => {
    for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, d.name);
      const rel = toPosix(path.relative(root, full));
      if (d.isDirectory()) { if (!includeOriginals && rel === KDIRS.originals) continue; walk(full); }
      else files.push({ name: `knowledge/${rel}`, data: fs.readFileSync(full) });
    }
  };
  walk(root);
  files.push({ name: 'EXPORT-README.txt', data: Buffer.from(`WFX knowledge library export, ${nowIso()}.\nLayer B (TXT files) is the source of truth for rules, terms, transactions, procedures, workflows and data models.\nmetadata/source_registry.json lists every source document and version${includeOriginals ? '; original_sources/ holds the files unchanged' : ' (original files not included in this export)'}.\nFormat: see documentation/ARCHITECTURE.md section 4 in the project.\n`, 'utf8') });
  return writeZip(files);
}

export const routes: Route[] = [
  // ── health, auth ──
  r('GET', '/api/v2/health', 'public', () => {
    const ai = aiState();
    return { ok: true, service: 'wfx-knowledge', time: nowIso(), setupRequired: setupRequired(), signup: signupMode(), ai: { configured: ai.configured, active: ai.active, providers: ai.providers }, knowledge: { entries: Number(get<{ n: number }>('SELECT COUNT(DISTINCT id) AS n FROM entries')?.n ?? 0), documents: Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM documents')?.n ?? 0) } };
  }),
  r('POST', '/api/v2/auth/setup', 'public', (c) => {
    if (!allow(`setup:${c.ip}`, 10, 15 * 60_000)) fail(429, 'Too many attempts. Wait 15 minutes.');
    try { const u = completeSetup(str(c.body['token'], 100), str(c.body['username'], 40), str(c.body['displayName'], 80), str(c.body['password'], 200)); return { ok: true, user: u }; } catch (e) { return fail(400, (e as Error).message); }
  }),
  r('POST', '/api/v2/auth/login', 'public', (c) => {
    if (!allow(`login:${c.ip}`, 10, 15 * 60_000)) fail(429, 'Too many sign-in attempts. Wait 15 minutes.');
    const out = login(str(c.body['username'], 40), str(c.body['password'], 200), c.ip, c.ua);
    if (!out) {
      if (isPending(str(c.body['username'], 40), str(c.body['password'], 200))) return fail(403, 'Your account request is waiting for an administrator to approve it. Try again after it is approved.');
      audit(null, 'login-failed', 'user', str(c.body['username'], 40), '', c.ip); return fail(401, 'User name or password is wrong.');
    }
    c.res.setHeader('Set-Cookie', sessionCookie(out.token, settings().sessionHours * 3600));
    audit(out.user, 'login', 'user', String(out.user.id), '', c.ip);
    return { ok: true, user: out.user };
  }),
  // create your own account from the sign-in page (viewer only; an admin decides whether it needs approval, or is switched off)
  r('POST', '/api/v2/auth/signup', 'public', (c) => {
    if (!allow(`signup:${c.ip}`, 5, 60 * 60_000)) fail(429, 'Too many account requests from this computer. Try again in an hour.');
    const username = str(c.body['username'], 40), displayName = str(c.body['displayName'], 80) || username, password = str(c.body['password'], 200);
    let out: ReturnType<typeof signup>;
    try { out = signup(username, displayName, password); } catch (e) { const st = (e as { status?: number }).status; return fail(st ?? 400, (e as Error).message); }
    audit(out.user, 'signup', 'user', String(out.user.id), out.status, c.ip);
    if (out.status === 'active') {
      const s = login(username, password, c.ip, c.ua);
      if (s) c.res.setHeader('Set-Cookie', sessionCookie(s.token, settings().sessionHours * 3600));
    }
    return { ok: true, status: out.status, user: out.status === 'active' ? out.user : null };
  }),
  r('POST', '/api/v2/auth/logout', 'public', (c) => { logout(c.token); c.res.setHeader('Set-Cookie', sessionCookie('', 0)); return { ok: true }; }),
  r('GET', '/api/v2/auth/me', 'public', (c) => ({ user: c.user, setupRequired: setupRequired(), signup: signupMode() })),
  r('POST', '/api/v2/auth/password', 'user', (c) => {
    if (!login(c.user!.username, str(c.body['current'], 200), c.ip, c.ua)) fail(400, 'The current password is wrong.');
    try { setPassword(c.user!.id, str(c.body['password'], 200)); } catch (e) { fail(400, (e as Error).message); }
    audit(c.user, 'password-changed', 'user', String(c.user!.id), '', c.ip);
    return { ok: true };
  }),
  // the signed-in user's own profile
  r('GET', '/api/v2/profile', 'user', (c) => {
    const row = get<Record<string, unknown>>('SELECT created_at, last_login_at FROM users WHERE id = ?', c.user!.id);
    return { user: c.user, createdAt: row?.['created_at'] ?? null, lastLoginAt: row?.['last_login_at'] ?? null };
  }),
  // the readable admin directory (knowledge/admin/users.txt): no passwords or secrets in it
  r('GET', '/api/v2/admin/directory', ADMIN, () => readAdminDirectory()),
  // ── users (admin) ──
  r('GET', '/api/v2/users', ADMIN, () => ({ users: listUsers(), roles: ROLES })),
  r('POST', '/api/v2/users', ADMIN, (c) => {
    try { const u = createUser(str(c.body['username'], 40), str(c.body['displayName'], 80), str(c.body['role'], 20) as Role, str(c.body['password'], 200)); audit(c.user, 'user-created', 'user', String(u.id), u.role, c.ip); return { user: u }; } catch (e) { return fail(400, (e as Error).message); }
  }),
  r('PATCH', '/api/v2/users/:id', ADMIN, (c) => {
    try { updateUser(Number(c.params['id']), { role: c.body['role'] as Role | undefined, disabled: typeof c.body['disabled'] === 'boolean' ? (c.body['disabled'] as boolean) : undefined, displayName: str(c.body['displayName'], 80) || undefined }); }
    catch (e) { fail(400, (e as Error).message); }
    if (typeof c.body['password'] === 'string') { try { setPassword(Number(c.params['id']), str(c.body['password'], 200)); } catch (e) { fail(400, (e as Error).message); } }
    audit(c.user, 'user-updated', 'user', c.params['id'], JSON.stringify({ ...c.body, password: c.body['password'] ? '(set)' : undefined }), c.ip);
    return { ok: true };
  }),
  r('GET', '/api/v2/settings/signup', ADMIN, () => ({ mode: signupMode(), modes: SIGNUP_MODES })),
  r('PUT', '/api/v2/settings/signup', ADMIN, (c) => {
    const mode = str(c.body['mode'], 20);
    try { setSignupMode(mode as never, c.user!.username); } catch (e) { fail(400, (e as Error).message); }
    audit(c.user, 'signup-mode', 'settings', 'signup.mode', mode, c.ip);
    return { mode: signupMode() };
  }),
  r('POST', '/api/v2/users/:id/approve', ADMIN, (c) => {
    try { approveUser(Number(c.params['id']), (str(c.body['role'], 20) || 'viewer') as Role); } catch (e) { fail(400, (e as Error).message); }
    audit(c.user, 'user-approved', 'user', c.params['id'], str(c.body['role'], 20) || 'viewer', c.ip);
    return { ok: true };
  }),
  r('POST', '/api/v2/users/:id/reject', ADMIN, (c) => {
    try { rejectUser(Number(c.params['id'])); } catch (e) { fail(400, (e as Error).message); }
    audit(c.user, 'user-rejected', 'user', c.params['id'], '', c.ip);
    return { ok: true };
  }),
  // ── dashboard ──
  r('GET', '/api/v2/dashboard', 'user', (c) => dashboard(c.user!)),
  // ── documents ──
  r('GET', '/api/v2/documents', 'user', (c) => {
    const q = c.url.searchParams;
    let docs = documentList();
    if (q.get('module')) docs = docs.filter((d) => d['module'] === q.get('module'));
    if (q.get('type')) docs = docs.filter((d) => d['doc_type'] === q.get('type'));
    if (q.get('q')) { const s = q.get('q')!.toLowerCase(); docs = docs.filter((d) => String(d['title']).toLowerCase().includes(s) || String(d['id']).toLowerCase().includes(s)); }
    return { documents: docs, docTypes: DOC_TYPES, knowledgeStatuses: KNOWLEDGE_STATUSES, modules: all("SELECT DISTINCT module FROM documents WHERE module IS NOT NULL ORDER BY module").map((x) => x['module']) };
  }),
  r('POST', '/api/v2/documents', EDIT, async (c) => {
    if (!allow(`upload:${c.user!.id}`, 120, 3600_000)) fail(429, 'Upload limit reached (120 files per hour).');
    const name = decodeURIComponent(String(c.req.headers['x-file-name'] ?? ''));
    if (!name) fail(400, 'The X-File-Name header is required.');
    const q = c.url.searchParams;
    const ks = q.get('knowledgeStatus') ?? 'unreviewed';
    if (!(KNOWLEDGE_STATUSES as readonly string[]).includes(ks)) fail(400, 'Unknown knowledge status.');
    const dt = q.get('docType') || undefined;
    if (dt && !(DOC_TYPES as readonly string[]).includes(dt)) fail(400, 'Unknown document type.');
    const out = await ingestBuffer(c.raw, { originalName: name, origin: 'upload', uploadedBy: c.user!.username, knowledgeStatus: ks, docType: dt, module: q.get('module') || null, versionOf: q.get('versionOf') || undefined, title: q.get('title') || undefined });
    audit(c.user, `document-${out.status}`, 'document', out.documentId ?? '', `${name}: ${out.message}`, c.ip);
    if (out.status === 'rejected') fail(400, out.message);
    return out;
  }, true),
  r('GET', '/api/v2/documents/:id', 'user', (c) => {
    const reg = readRegistry().documents.find((d) => d.id === c.params['id']);
    if (!reg) fail(404, 'Document not found.');
    const candidates = all('SELECT id, doc_version, kind, text, locator, status, entry_id FROM candidates WHERE doc_id = ? ORDER BY doc_version DESC, kind, id LIMIT 400', c.params['id']);
    const chunks = Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ? AND is_current = 1', c.params['id'])?.n ?? 0);
    return { document: reg, candidates, chunks, relations: relationsOf(c.params['id']) };
  }),
  r('PATCH', '/api/v2/documents/:id', EDIT, (c) => {
    const reg = readRegistry();
    const d = reg.documents.find((x) => x.id === c.params['id']);
    if (!d) fail(404, 'Document not found.');
    const doc = d!;
    if (typeof c.body['title'] === 'string' && c.body['title']) doc.title = str(c.body['title'], 200);
    if (typeof c.body['module'] === 'string') doc.module = str(c.body['module'], 80) || null;
    if (typeof c.body['docType'] === 'string' && (DOC_TYPES as readonly string[]).includes(c.body['docType'] as string)) doc.doc_type = c.body['docType'] as string;
    if (typeof c.body['knowledgeStatus'] === 'string' && (KNOWLEDGE_STATUSES as readonly string[]).includes(c.body['knowledgeStatus'] as string)) doc.knowledge_status = c.body['knowledgeStatus'] as string;
    fs.writeFileSync(kpath(KDIRS.metadata, 'source_registry.json'), `${JSON.stringify({ ...reg, updated: nowIso() }, null, 2)}\n`);
    audit(c.user, 'document-updated', 'document', doc.id, JSON.stringify(c.body), c.ip);
    return reprocess(doc.id);
  }),
  r('GET', '/api/v2/documents/:id/versions/:v/extracted', 'user', (c) => {
    const d = readRegistry().documents.find((x) => x.id === c.params['id']);
    const v = d?.versions.find((x) => x.version === Number(c.params['v']));
    if (!v?.extracted_path) fail(404, 'No extraction for this version.');
    return { download: fs.readFileSync(kpath(v!.extracted_path!)), name: path.basename(v!.extracted_path!), type: 'text/plain; charset=utf-8', inline: true };
  }),
  r('GET', '/api/v2/documents/:id/versions/:v/original', 'user', (c) => {
    const d = readRegistry().documents.find((x) => x.id === c.params['id']);
    const v = d?.versions.find((x) => x.version === Number(c.params['v']));
    if (!v) fail(404, 'Version not found.');
    const full = inside(settings().knowledge, v!.stored_path);
    audit(c.user, 'document-downloaded', 'document', d!.id, `v${v!.version}`, c.ip);
    return { download: fs.readFileSync(full), name: v!.original_name, type: 'application/octet-stream' };
  }),
  r('POST', '/api/v2/documents/:id/reprocess', EDIT, (c) => { const out = reprocess(c.params['id'], c.body['version'] ? Number(c.body['version']) : undefined); audit(c.user, 'document-reprocessed', 'document', c.params['id'], out.message, c.ip); return out; }),
  r('POST', '/api/v2/candidates/:id/dismiss', EDIT, (c) => { setCandidateDecision(Number(c.params['id']), 'dismissed'); audit(c.user, 'candidate-dismissed', 'candidate', c.params['id'], '', c.ip); return { ok: true }; }),
  r('POST', '/api/v2/candidates/:id/propose', EDIT, (c) => {
    const cand = get<{ text: string; doc_id: string; doc_version: number; locator: string }>('SELECT text, doc_id, doc_version, locator FROM candidates WHERE id = ?', Number(c.params['id']));
    if (!cand) fail(404, 'Candidate not found.');
    const p = proposeRule(cand!.text, c.user!.username);
    p.draft.fields['SOURCE'] = `${cand!.doc_id} v${cand!.doc_version} (${cand!.locator}): "${cand!.text.slice(0, 300)}"`;
    return { ...p, draftText: serializeEntry(p.draft).replace(/^=+\n/, '') };
  }),
  // ── entries and rules ──
  r('GET', '/api/v2/entries', 'user', (c) => {
    const q = c.url.searchParams;
    return listEntries({ type: q.get('type') || undefined, module: q.get('module') || undefined, status: q.get('status') || undefined, category: q.get('category') || undefined, q: q.get('q') || undefined, limit: Math.min(Number(q.get('limit') || 200), 500), offset: Number(q.get('offset') || 0) });
  }),
  r('GET', '/api/v2/entries/:id', 'user', (c) => entryDetail(decodeURIComponent(c.params['id']), c.user!)),
  r('GET', '/api/v2/entries/:id/impact', 'user', (c) => wrapRule(() => impactOf(decodeURIComponent(c.params['id'])))),
  r('POST', '/api/v2/entries', EDIT, (c) => {
    const raw = str(c.body['raw'], 100_000);
    if (!raw) fail(400, 'Send the entry text as "raw".');
    const out = wrapRule(() => saveDraft(raw, c.user!.username, c.user!.role, str(c.body['reason'], 500)));
    audit(c.user, 'entry-draft-saved', 'entry', out.id, `v${out.version}`, c.ip);
    if (c.body['activate'] === true) {
      if (!atLeast(c.user, 'approver')) fail(403, 'Only approvers can activate.');
      const t = wrapRule(() => transition(out.id, out.version, 'Active', c.user!.username, c.user!.role, str(c.body['reason'], 500) || 'Saved and activated by the approver (explicit instruction).'));
      audit(c.user, 'entry-activated', 'entry', out.id, `v${out.version}`, c.ip);
      return { ...out, ...t };
    }
    return out;
  }),
  r('POST', '/api/v2/entries/:id/transition', EDIT, (c) => {
    const id = decodeURIComponent(c.params['id']);
    const out = wrapRule(() => transition(id, c.body['version'] ? Number(c.body['version']) : undefined, str(c.body['to'], 20), c.user!.username, c.user!.role, str(c.body['reason'], 500)));
    audit(c.user, `entry-${out.status.toLowerCase().replace(/\s+/g, '-')}`, 'entry', id, `v${out.version}`, c.ip);
    return out;
  }),
  r('POST', '/api/v2/rules/propose', 'user', (c) => {
    const text = str(c.body['text'], 4000);
    if (!text.trim()) fail(400, 'Write the rule in a sentence or as a formula.');
    const p = proposeRule(text, c.user!.username);
    return { ...p, draftText: serializeEntry(p.draft).replace(/^=+\n/, '') };
  }),
  // ── calculations ──
  r('GET', '/api/v2/calc/rules', 'user', () => ({
    rules: all<Record<string, unknown>>("SELECT id, version, status, title, module, txn, fields FROM entries WHERE type = 'rule' AND is_current = 1 AND json_extract(fields, '$.fields.EXPRESSION') <> '' ORDER BY module, title")
      .map((e) => { const f = parseJson<{ fields: Record<string, string> }>(e['fields'] as string, { fields: {} }).fields; let spec = null; try { spec = parseSpec(f); } catch { /* listed with no inputs */ } return { id: e['id'], version: e['version'], status: e['status'], title: e['title'], module: e['module'], txn: e['txn'], formula: f['FORMULA / LOGIC'], inputs: spec?.inputs ?? [], output: spec?.output ?? '', testCases: f['TEST CASES'] ?? '' }; }),
  })),
  r('POST', '/api/v2/calc/run', 'user', (c) => {
    const e = getEntry(str(c.body['ruleId'], 100), c.body['version'] ? Number(c.body['version']) : undefined);
    if (!e) fail(404, 'Rule not found.');
    let spec;
    try { spec = parseSpec(e!.fields); } catch (err) { fail(400, `The rule's expression is invalid: ${(err as Error).message}`); }
    if (!spec) fail(400, 'This rule has no EXPRESSION, so it cannot be calculated.');
    const result = evaluate(spec!, (c.body['inputs'] ?? {}) as Record<string, unknown>);
    return { ruleId: e!.id, version: e!.version, status: e!.status, confirmed: ['Active', 'Approved'].includes(e!.status), formula: e!.fields['FORMULA / LOGIC'], expression: e!.fields['EXPRESSION'], ...result, warnings: [...result.warnings, ...(['Active', 'Approved'].includes(e!.status) ? [] : [`Rule status is ${e!.status}: the result is a simulation of an unconfirmed rule.`])] };
  }),
  r('POST', '/api/v2/calc/tests', 'user', (c) => {
    const e = getEntry(str(c.body['ruleId'], 100));
    if (!e) fail(404, 'Rule not found.');
    const spec = parseSpec(e!.fields);
    if (!spec) fail(400, 'This rule has no EXPRESSION.');
    const cases = generateTests(spec!, e!.fields['TEST CASES']);
    return { ruleId: e!.id, version: e!.version, cases, passed: cases.filter((x) => x.pass).length, failed: cases.filter((x) => !x.pass).length };
  }),
  // ── search and assistant ──
  r('POST', '/api/v2/search', 'user', (c) => {
    const q = str(c.body['q'], 500);
    const res = search(q, { limit: Math.min(Number(c.body['limit'] ?? 20), 50), kinds: Array.isArray(c.body['kinds']) ? (c.body['kinds'] as string[]).slice(0, 10) : undefined, module: str(c.body['module'], 80) || undefined, includeHistory: c.body['includeHistory'] === true });
    return { ...res, hits: res.hits.map((h) => ({ ...h, text: h.text.slice(0, 600) })) };
  }),
  // ── Sales Order (Main OC → Delivery OC → Article → Colour/Size) ──
  r('GET', '/api/v2/so/masters', 'user', () => SO.listMasters()),
  r('GET', '/api/v2/so/tools', 'user', (c) => ({ tools: SO.toolsOf(c.user!) })),
  r('GET', '/api/v2/so/orders', 'user', (c) => {
    const p = c.url.searchParams;
    return SO.listOrders(c.user!, { mode: p.get('mode') === 'style' ? 'style' : 'main', q: p.get('q')?.slice(0, 80) ?? '', status: p.get('status') ?? '', buyer: p.get('buyer') ?? '',
      page: Number(p.get('page') ?? 1), size: Number(p.get('size') ?? 20), sort: p.get('sort') === 'asc' ? 'asc' : 'desc' });
  }),
  r('GET', '/api/v2/so/layout', 'user', (c) => SOC.resolveLayout(c.url.searchParams.get('list') === 'List' ? 'List' : 'New', c.user!.id, c.url.searchParams.get('buyer') ?? undefined)),
  r('POST', '/api/v2/so/orders', 'user', (c) => SO.createOrder(c.user!, { category: str(c.body['category'], 40), buyer: str(c.body['buyer'], 40) })),
  r('GET', '/api/v2/so/orders/:id', 'user', (c) => SO.getOrder(c.user!, Number(c.params['id']))),
  r('PATCH', '/api/v2/so/orders/:id', 'user', (c) => { SO.updateHeader(c.user!, Number(c.params['id']), (c.body['values'] ?? {}) as Record<string, unknown>, c.body['instructions'] as Record<string, string> | undefined); return SO.getOrder(c.user!, Number(c.params['id'])); }),
  r('POST', '/api/v2/so/orders/:id/action', 'user', (c) => {
    const id = Number(c.params['id']);
    const a = str(c.body['action'], 30);
    const remarks = str(c.body['remarks'], 500);
    const out: Record<string, unknown> = {};
    if (a === 'confirm') Object.assign(out, SO.confirmOrder(c.user!, id, c.body['approverId'] ? Number(c.body['approverId']) : null));
    else if (a === 'approve') Object.assign(out, SO.approveOrder(c.user!, id, remarks, c.body['nextApproverId'] ? Number(c.body['nextApproverId']) : null));
    else if (a === 'reject') SO.rejectOrder(c.user!, id, remarks);
    else if (a === 'revise') SO.reviseOrder(c.user!, id, str(c.body['reason'], 300), str(c.body['authorizedBy'], 100));
    else if (a === 'cancel') SO.cancelOrder(c.user!, id, remarks);
    else if (a === 'close') SO.closeOrder(c.user!, id, remarks);
    else if (a === 'sync-price') Object.assign(out, SO.syncPrices(c.user!, id));
    else if (a === 'add-delivery') out['deliveryId'] = SO.addDelivery(c.user!, id, (c.body['delivery'] ?? {}) as SO.DeliveryInput);
    else fail(400, 'Unknown action.');
    audit(c.user, `so-${a}`, 'sales-order', String(id), remarks, c.ip);
    return { ...out, order: SO.getOrder(c.user!, id) };
  }),
  r('POST', '/api/v2/so/deliveries/action', 'user', (c) => {
    const a = str(c.body['action'], 30);
    const ids = (Array.isArray(c.body['ids']) ? c.body['ids'] : []).map(Number).filter((n) => n > 0).slice(0, 200);
    const remarks = str(c.body['remarks'], 500);
    const first = ids[0] ?? fail(400, 'Select a delivery.');
    const orderId = SO.getDeliveryOrder(first);
    const out: Record<string, unknown> = {};
    if (a === 'update') SO.updateDelivery(c.user!, first, (c.body['delivery'] ?? {}) as SO.DeliveryInput);
    else if (a === 'copy') out['deliveryId'] = SO.copyDelivery(c.user!, first);
    else if (a === 'delete') SO.deleteDeliveries(c.user!, ids);
    else if (a === 'cancel') SO.cancelDeliveries(c.user!, ids, remarks);
    else if (a === 'close') SO.closeDeliveries(c.user!, ids, remarks);
    else if (a === 'reopen') SO.reopenDeliveries(c.user!, ids, remarks);
    else if (a === 'split') out['deliveryId'] = SO.splitDelivery(c.user!, first, str(c.body['mode'], 12) === 'quantity' ? 'quantity' : 'percentage', Number(c.body['value']));
    else if (a === 'add-article') out['lineId'] = SO.addArticle(c.user!, first, str(c.body['article'], 40));
    else fail(400, 'Unknown action.');
    audit(c.user, `so-delivery-${a}`, 'sales-order', String(orderId), ids.join(','), c.ip);
    return { ...out, order: SO.getOrder(c.user!, orderId) };
  }),
  r('POST', '/api/v2/so/lines/:id', 'user', (c) => {
    const id = Number(c.params['id']);
    const orderId = SO.getLineOrder(id);
    const a = str(c.body['action'], 30);
    if (a === 'update') SO.updateArticle(c.user!, id, { bomId: c.body['bomId'] === undefined ? undefined : (str(c.body['bomId'], 60) || null), extraProductionPct: c.body['extraProductionPct'] === undefined ? undefined : Number(c.body['extraProductionPct']), fields: c.body['fields'] as Record<string, unknown> | undefined });
    else if (a === 'remove') SO.removeArticle(c.user!, id);
    else if (a === 'add-qty') SO.addBreakup(c.user!, id, c.body['additional'] === true);
    else fail(400, 'Unknown action.');
    return { order: SO.getOrder(c.user!, orderId) };
  }),
  r('POST', '/api/v2/so/breakups/:id', 'user', (c) => {
    const id = Number(c.params['id']);
    const orderId = SO.getBreakupOrder(id);
    if (str(c.body['action'], 20) === 'delete') SO.deleteBreakup(c.user!, id);
    else SO.saveBreakup(c.user!, id, c.body as unknown as SO.BreakupInput);
    return { order: SO.getOrder(c.user!, orderId) };
  }),
  r('GET', '/api/v2/so/approvals', 'user', (c) => ({ pending: SO.pendingApprovals(c.user!), done: SO.approvalLog(c.user!), approvers: SO.approverRows() })),
  // setup: SLC, Additional Fields, buyer-wise views, approvers, tool permissions (admin)
  r('GET', '/api/v2/so/setup', ADMIN, () => ({ fields: SOC.fields(), slcNew: SOC.getSlc('New'), slcList: SOC.getSlc('List'), views: SOC.listViews(),
    users: listUsers().filter((u) => !u.pending && !u.disabled).map((u) => ({ id: u.id, username: u.username, displayName: u.displayName, role: u.role })),
    approvers: SO.approverRows(), tools: SO.toolRows(), allTools: SO_TOOLS, settings: SO.settingRows(), buyers: SO.listMasters().buyers })),
  r('PUT', '/api/v2/so/setup/slc/:list', ADMIN, (c) => { SOC.saveSlc(c.params['list'] === 'List' ? 'List' : 'New', (c.body['rows'] ?? []) as SOC.SlcRow[], c.user!.username); audit(c.user, 'so-slc-saved', 'slc', c.params['list'], '', c.ip); return { ok: true }; }),
  r('POST', '/api/v2/so/setup/fields', ADMIN, (c) => SOC.addAdditionalField({ label: str(c.body['label'], 80), fieldType: str(c.body['fieldType'], 20), multi: c.body['multi'] === true, options: (Array.isArray(c.body['options']) ? c.body['options'] : []).map((x) => String(x).slice(0, 80)).slice(0, 100), validation: str(c.body['validation'], 20) || 'None' })),
  r('DELETE', '/api/v2/so/setup/fields/:key', ADMIN, (c) => { SOC.deleteAdditionalField(c.params['key']); return { ok: true }; }),
  r('POST', '/api/v2/so/setup/views', ADMIN, (c) => SOC.saveView({ id: c.body['id'] ? Number(c.body['id']) : undefined, name: str(c.body['name'], 80), listType: str(c.body['listType'], 8) as SOC.ListType, buyers: (Array.isArray(c.body['buyers']) ? c.body['buyers'] : []).map(String), fields: (c.body['fields'] ?? []) as SOC.ViewField[], listScope: str(c.body['listScope'], 30) }, c.user!.username)),
  r('PUT', '/api/v2/so/setup/views/:id/users', ADMIN, (c) => SOC.setViewUsers(Number(c.params['id']), (Array.isArray(c.body['users']) ? c.body['users'] : []).map(Number))),
  r('DELETE', '/api/v2/so/setup/views/:id', ADMIN, (c) => { SOC.deleteView(Number(c.params['id'])); return { ok: true }; }),
  r('PUT', '/api/v2/so/setup/approvers', ADMIN, (c) => { SO.setApprovers((c.body['approvers'] ?? []) as { userId: number; limit: number; isFinal: boolean }[]); return { approvers: SO.approverRows() }; }),
  r('PUT', '/api/v2/so/setup/tools', ADMIN, (c) => { SO.setTools((c.body['tools'] ?? {}) as Record<string, string[]>); return { tools: SO.toolRows() }; }),
  r('PUT', '/api/v2/so/setup/settings', ADMIN, (c) => { SO.setSettings((c.body['settings'] ?? {}) as Record<string, string>); return { settings: SO.settingRows() }; }),
  // knowledge enrichment (question mapping): everyone signed in can look, editors change questions, approvers approve units
  r('GET', '/api/v2/enrichment/summary', 'user', () => enrichmentSummary()),
  r('GET', '/api/v2/enrichment/units', 'user', (c) => ({ units: listUnits(c.url.searchParams.get('module')?.slice(0, 80) || 'Sales Order', c.url.searchParams.get('filter')?.slice(0, 20) ?? '', c.url.searchParams.get('q')?.slice(0, 120) ?? '') })),
  r('GET', '/api/v2/enrichment/units/:id', 'user', (c) => unitDetail(decodeURIComponent(c.params['id'])) ?? fail(404, 'Unknown knowledge unit.')),
  r('POST', '/api/v2/enrichment/units/:id/questions', EDIT, (c) => {
    const id = decodeURIComponent(c.params['id']);
    const out = c.body['norm']
      ? setQuestion(id, str(c.body['norm'], 400), { status: (str(c.body['status'], 12) || undefined) as never, text: str(c.body['text'], 300) || undefined }, c.user!.username)
      : addQuestion(id, str(c.body['text'], 300), str(c.body['category'], 20), c.user!.username);
    audit(c.user, 'enrichment-question', 'knowledge-unit', id, str(c.body['status'], 12) || 'edit', c.ip);
    return out;
  }),
  r('POST', '/api/v2/enrichment/units/:id/review', APPROVE, (c) => {
    const id = decodeURIComponent(c.params['id']);
    const review = str(c.body['review'], 20) === 'approved' ? 'approved' : 'needs-review';
    audit(c.user, 'enrichment-unit-review', 'knowledge-unit', id, review, c.ip);
    return setUnitReview(id, review, str(c.body['note'], 300), c.user!.username);
  }),
  r('POST', '/api/v2/enrichment/regenerate', EDIT, (c) => {
    const module = str(c.body['module'], 80) || undefined;
    const out = regenerateEnrichment(module);
    audit(c.user, 'enrichment-regenerated', 'module', module ?? 'configured', `${out.units} units, ${out.questions} questions`, c.ip);
    return { ...out, sourceProblems: out.sourceProblems.slice(0, 20) };
  }),
  r('POST', '/api/v2/enrichment/try', 'user', (c) => ({ matches: tryQuestion(str(c.body['q'], 500), str(c.body['context'], 300) || undefined) })),
  r('POST', '/api/v2/ask', 'user', (c) => {
    if (!allow(`chat:${c.user!.id}`, 300, 3600_000)) fail(429, 'Question limit reached; try again later.');
    return answerQuestion(str(c.body['question'], 4000), { mode: (str(c.body['mode'], 20) || 'ask') as never, depth: (str(c.body['depth'], 10) || 'standard') as never, userId: c.user!.id });
  }),
  r('GET', '/api/v2/conversations', 'user', (c) => ({ conversations: listConversations(c.user!.id), modes: CHAT_MODES })),
  r('POST', '/api/v2/conversations', 'user', (c) => createConversation(c.user!.id, str(c.body['title'], 120) || undefined)),
  r('GET', '/api/v2/conversations/:id', 'user', (c) => getConversation(c.params['id'], c.user!.id)),
  r('DELETE', '/api/v2/conversations/:id', 'user', (c) => { deleteConversation(c.params['id'], c.user!.id); return { ok: true }; }),
  r('POST', '/api/v2/conversations/:id/messages', 'user', (c) => {
    if (!allow(`chat:${c.user!.id}`, 300, 3600_000)) fail(429, 'Question limit reached; try again later.');
    const mode = (str(c.body['mode'], 20) || 'ask') as ChatMode;
    return postMessage(c.params['id'], c.user!.id, str(c.body['content'], 4000), CHAT_MODES.includes(mode) ? mode : 'ask', (['brief', 'standard', 'detailed'].includes(str(c.body['depth'], 10)) ? str(c.body['depth'], 10) : 'standard') as never);
  }),
  r('POST', '/api/v2/conversations/:id/regenerate', 'user', (c) => regenerate(c.params['id'], c.user!.id, ((str(c.body['mode'], 20) || 'ask') as ChatMode), ((str(c.body['depth'], 10) || 'standard') as never))),
  r('GET', '/api/v2/conversations/:id/export', 'user', (c) => ({ download: Buffer.from(exportMarkdown(c.params['id'], c.user!.id), 'utf8'), name: `conversation-${c.params['id']}.md`, type: 'text/markdown; charset=utf-8' })),
  // ── chatbot: the same conversations under /api/v2/chat, plus registry, guides and navigation ──
  r('GET', '/api/v2/chat/conversations', 'user', (c) => ({ conversations: searchConversations(c.user!.id, c.url.searchParams.get('q') ?? '') })),
  r('POST', '/api/v2/chat/conversations', 'user', (c) => createConversation(c.user!.id, str(c.body['title'], 120) || undefined)),
  r('GET', '/api/v2/chat/conversations/:id', 'user', (c) => getConversation(c.params['id'], c.user!.id)),
  r('PATCH', '/api/v2/chat/conversations/:id', 'user', (c) => renameConversation(c.params['id'], c.user!.id, str(c.body['title'], 200))),
  r('PATCH', '/api/v2/conversations/:id', 'user', (c) => renameConversation(c.params['id'], c.user!.id, str(c.body['title'], 200))),
  r('DELETE', '/api/v2/chat/conversations/:id', 'user', (c) => { deleteConversation(c.params['id'], c.user!.id); return { ok: true }; }),
  r('POST', '/api/v2/chat/conversations/:id/messages', 'user', (c) => {
    if (!allow(`chat:${c.user!.id}`, 300, 3600_000)) fail(429, 'Question limit reached; try again later.');
    const mode = (str(c.body['mode'], 20) || 'ask') as ChatMode;
    return postMessage(c.params['id'], c.user!.id, str(c.body['content'], 4000), CHAT_MODES.includes(mode) ? mode : 'ask', (['brief', 'standard', 'detailed'].includes(str(c.body['depth'], 10)) ? str(c.body['depth'], 10) : 'standard') as never);
  }),
  r('POST', '/api/v2/chat/search', 'user', (c) => {
    const q = str(c.body['q'], 400);
    if (!q.trim()) fail(400, 'Write what to search for.');
    const k = search(q, { includeAdmin: c.user!.role === 'admin' }).hits.slice(0, 8).map((h) => ({ ref: h.ref, title: h.title, kind: h.kind, status: h.status, entryId: h.entryId, docId: h.docId, text: h.text.replace(/\s+/g, ' ').slice(0, 240) }));
    const f = findForQuestion(q);
    return { knowledge: k, screens: f.screens.map((x) => ({ id: x.s.id, name: x.s.name, module: x.s.module, score: +x.score.toFixed(2) })), guides: f.guides };
  }),
  r('GET', '/api/v2/chat/screens', 'user', () => ({ screens: listScreens() })),
  r('GET', '/api/v2/chat/screens/:id', 'user', (c) => getScreen(c.params['id']) ?? fail(404, 'No registered screen with this id.')),
  r('GET', '/api/v2/chat/guides', 'user', () => ({ guides: listGuides() })),
  r('GET', '/api/v2/chat/guides/:id', 'user', (c) => getGuide(c.params['id']) ?? fail(404, 'No guide with this id.')),
  r('GET', '/api/v2/chat/workflows/:id', 'user', (c) => {
    const g = graphFromEntry(c.params['id']);
    if (!g) fail(404, 'No stored workflow with this id.');
    const screens = listScreens().filter((s) => s.workflowIds.includes(c.params['id'])).map((s) => ({ id: s.id, name: s.name }));
    return { id: c.params['id'], name: g!.name, status: g!.status, description: g!.description, steps: g!.nodes.filter((n) => n.type !== 'start' && n.type !== 'end').map((n) => ({ id: n.id, label: n.label, type: n.type, lane: n.lane ?? n.role ?? '' })), screens, navigation: resolveNavigation(c.params['id'], c.user) };
  }),
  r('GET', '/api/v2/chat/navigation/:id', 'user', (c) => resolveNavigation(c.params['id'], c.user) ?? fail(404, 'This destination is not registered, so it cannot be opened.')),
  r('GET', '/api/v2/chat/assets/:dir/:file', 'user', (c) => {
    const full = assetFile(`${c.params['dir']}/${c.params['file']}`);
    if (!full) fail(404, 'No such image.');
    const ext = full!.split('.').pop()!.toLowerCase();
    c.res.setHeader('Cache-Control', 'private, max-age=3600');
    return { download: fs.readFileSync(full!), name: c.params['file'], type: ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg', inline: true };
  }),
  r('POST', '/api/v2/ba/analyse', 'user', (c) => { const a = analyseRequirement(str(c.body['text'], 8000)); return { analysis: a, sections: baSections(a) }; }),
  // ── workflow designer ──
  r('GET', '/api/v2/workflows', 'user', () => ({
    workflows: all("SELECT id, title, status, version FROM entries WHERE type = 'workflow' AND (is_current = 1 OR file LIKE 'review/%') ORDER BY title"),
    procedures: all("SELECT id, title, status, version FROM entries WHERE type = 'procedure' AND is_current = 1 AND json_extract(fields, '$.fields.STEPS') <> '' ORDER BY title"),
  })),
  r('GET', '/api/v2/workflows/:id', 'user', (c) => {
    const id = decodeURIComponent(c.params['id']);
    const v = c.url.searchParams.get('version');
    const g = graphFromEntry(id, v ? Number(v) : undefined);
    if (!g) fail(404, 'Workflow not found.');
    enrichGraph(g!); // documented inputs, outputs, rules, dependencies, validations, screens and sources for every step
    // a stored workflow opens in the picture that fits its structure (unless it was saved in another one), with the reason
    const selection = selectDiagram(g!);
    if (g!.format === 'flowchart' && !g!.nodes.some((n) => n.pinned)) g!.format = selection.recommended;
    return { ...graphView(g!), selection, versions: entryVersions(id).map((x) => ({ version: x.version, status: x.status, file: x.file })) };
  }),
  r('POST', '/api/v2/workflows/generate', 'user', (c) => {
    const text = str(c.body['text'], 20000);
    if (!text.trim()) fail(400, 'Write the process as steps, or paste Mermaid.');
    return graphView(graphFromText(text, str(c.body['name'], 150) || 'New workflow'));
  }),
  r('POST', '/api/v2/workflows/check', 'user', (c) => graphView(readGraph(c.body['graph']))),
  r('POST', '/api/v2/workflows/layout', 'user', (c) => { const g = readGraph(c.body['graph']); for (const n of g.nodes) { n.x = undefined; n.y = undefined; } return graphView(layout(g)); }),
  r('POST', '/api/v2/workflows/save', EDIT, (c) => {
    const g = readGraph(c.body['graph']);
    if (!g.name.trim()) fail(400, 'Give the workflow a name.');
    if (!g.nodes.length) fail(400, 'The workflow has no steps.');
    const out = wrapRule(() => saveDraft(graphToEntry(g, c.user!.username), c.user!.username, c.user!.role, str(c.body['reason'], 500) || 'Saved in the workflow designer'));
    audit(c.user, 'workflow-saved', 'entry', out.id, `v${out.version}`, c.ip);
    return out;
  }),
  r('GET', '/api/v2/workflows/:id/compare', 'user', (c) => {
    const id = decodeURIComponent(c.params['id']);
    const a = graphFromEntry(id, Number(c.url.searchParams.get('a'))), b = graphFromEntry(id, Number(c.url.searchParams.get('b')));
    if (!a || !b) fail(404, 'Version not found.');
    return graphDiff(a!, b!);
  }),
  // ── workflow drafts: the chat generates them, the designer shows, edits and saves them ──
  r('GET', '/api/v2/workflow-drafts', 'user', (c) => ({ drafts: listDrafts(c.user!.id, c.url.searchParams.get('conversation') ?? undefined) })),
  r('POST', '/api/v2/workflow-drafts', 'user', (c) => {
    // a workflow request made in the designer (no chat page involved): same path as the chat, same conversation record
    const text = str(c.body['request'], 4000);
    if (!text.trim()) fail(400, 'Write what the workflow should show.');
    if (!allow(`wfgen:${c.user!.id}`, 200, 3600_000)) fail(429, 'Workflow limit reached; try again later.');
    let conv = str(c.body['conversationId'], 40);
    if (conv) { try { getConversation(conv, c.user!.id); } catch { conv = ''; } }
    conv ||= ensureConversation(c.user!.id, text.slice(0, 80));
    const a = workflowTurn(text, 'workflow', conv, c.user!.id) ?? fail(422, 'That is a question, not a workflow request; ask it in the assistant.');
    appendExchange(conv, text, a);
    const act = (a as { action?: ChatAction }).action;
    return { answer: a, action: act ?? null, draftId: act ? act.draftId : null, conversationId: conv };
  }),
  r('GET', '/api/v2/workflow-drafts/:id', 'user', (c) => wrapRule(() => draftView(c.params['id'], c.user!.id))),
  r('PUT', '/api/v2/workflow-drafts/:id', 'user', (c) => wrapRule(() => {
    const d = getDraft(c.params['id'], c.user!.id);
    if (!d.doc) fail(409, 'This draft has no workflow yet; retry the generation first.');
    const g = readGraph(c.body['graph'] ?? d.doc!.graph);
    const doc: DraftDoc = {
      graph: { ...g, id: d.doc!.graph.id },
      detail: c.body['detail'] === 'overview' ? 'overview' : 'detailed',
      overlay: (['validations', 'rules', 'io', 'dependencies'].includes(c.body['overlay'] as string) ? c.body['overlay'] : '') as DraftDoc['overlay'],
      collapsed: Array.isArray(c.body['collapsed']) ? (c.body['collapsed'] as unknown[]).slice(0, 60).map((x) => str(x, 120)) : [],
      compare: d.doc!.compare, notes: d.doc!.notes, lifecycle: d.doc!.lifecycle ?? null, selection: d.doc!.selection ?? null,
    };
    if (!doc.graph.name.trim()) fail(400, 'Give the workflow a name.');
    updateDoc(d.id, c.user!.id, doc, str(c.body['reason'], 300) || 'Edited in the designer', c.body['newVersion'] === true);
    return draftView(d.id, c.user!.id);
  })),
  r('POST', '/api/v2/workflow-drafts/:id/chat', 'user', (c) => wrapRule(() => {
    const text = str(c.body['message'], 2000);
    if (!text.trim()) fail(400, 'Write what to change.');
    if (!allow(`wfchat:${c.user!.id}`, 400, 3600_000)) fail(429, 'Message limit reached; try again later.');
    const out = designerMessage(c.params['id'], c.user!.id, text);
    return { reply: out.reply, ok: out.ok, newDraft: out.newDraft, draftId: out.draftId, ...draftView(out.draftId, c.user!.id) };
  })),
  r('POST', '/api/v2/workflow-drafts/:id/retry', 'user', (c) => wrapRule(() => { retryDraft(c.params['id'], c.user!.id); return draftView(c.params['id'], c.user!.id); })),
  r('POST', '/api/v2/workflow-drafts/:id/undo', 'user', (c) => wrapRule(() => { undoDraft(c.params['id'], c.user!.id); return draftView(c.params['id'], c.user!.id); })),
  r('POST', '/api/v2/workflow-drafts/:id/save', EDIT, (c) => wrapRule(() => {
    const out = saveToLibrary(c.params['id'], c.user!.id, c.user!.username, c.user!.role, str(c.body['reason'], 500));
    audit(c.user, 'workflow-saved', 'entry', out.entryId, `v${out.version} from draft ${c.params['id']}`, c.ip);
    return { ...out, ...draftView(c.params['id'], c.user!.id) };
  })),
  r('GET', '/api/v2/workflow-drafts/:id/versions/:v', 'user', (c) => wrapRule(() => ({ doc: draftVersion(c.params['id'], c.user!.id, Number(c.params['v'])) }))),
  r('GET', '/api/v2/workflow-drafts/:id/compare', 'user', (c) => wrapRule(() => compareVersions(c.params['id'], c.user!.id, Number(c.url.searchParams.get('a')), Number(c.url.searchParams.get('b'))))),
  // ── data modelling studio ──
  r('GET', '/api/v2/models', 'user', () => listModels()),
  r('GET', '/api/v2/models/:id', 'user', (c) => {
    const id = decodeURIComponent(c.params['id']);
    const v = c.url.searchParams.get('version');
    const m = openModel(id, v ? Number(v) : undefined);
    if (!m) fail(404, 'Data model not found.');
    return { ...modelView(m!, viewOf(c)), versions: id === 'DM-MAP' ? [] : entryVersions(id).map((x) => ({ version: x.version, status: x.status, file: x.file })) };
  }),
  r('POST', '/api/v2/models/draft', 'user', (c) => {
    const text = str(c.body['text'], 20000);
    if (!text.trim()) fail(400, 'Describe the entities and how they relate, one statement per line.');
    const d = draftFromText(text, str(c.body['name'], 150) || 'New data model');
    return { ...modelView(d.model, viewOf(c)), notUnderstood: d.notUnderstood };
  }),
  r('POST', '/api/v2/models/check', 'user', (c) => modelView(readModel(c.body['model']), c.body['view'] === 'logical' ? 'logical' : 'as-is')),
  r('POST', '/api/v2/models/save', EDIT, (c) => {
    const m = readModel(c.body['model']);
    if (!m.name.trim()) fail(400, 'Give the model a name.');
    if (!m.entities.length) fail(400, 'The model has no entities.');
    const out = wrapRule(() => saveDraft(modelToEntry(m, c.user!.username), c.user!.username, c.user!.role, str(c.body['reason'], 500) || 'Saved in the data modelling studio'));
    audit(c.user, 'model-saved', 'entry', out.id, `v${out.version}`, c.ip);
    return out;
  }),
  r('GET', '/api/v2/models/:id/ddl', 'user', (c) => {
    const id = decodeURIComponent(c.params['id']);
    const m = openModel(id);
    if (!m) fail(404, 'Data model not found.');
    return { download: Buffer.from(modelView(m!).ddl, 'utf8'), name: `${id.toLowerCase()}-proposed.sql`, type: 'text/plain; charset=utf-8' };
  }),
  // ── documentation views ──
  r('GET', '/api/v2/transactions', 'user', () => ({ transactions: all("SELECT id, title, module, status, version, json_extract(fields, '$.fields.SLUG') AS slug, json_extract(fields, '$.fields.PURPOSE') AS purpose FROM entries WHERE type = 'transaction' AND is_current = 1 ORDER BY CAST(json_extract(fields, '$.fields.STEP') AS INTEGER)") })),
  r('GET', '/api/v2/transactions/:id', 'user', (c) => transactionPage(decodeURIComponent(c.params['id']))),
  r('GET', '/api/v2/modules', 'user', () => ({ modules: all("SELECT id, title, status, json_extract(fields, '$.fields.DESCRIPTION') AS description FROM entries WHERE type = 'module' AND is_current = 1 ORDER BY title") })),
  r('GET', '/api/v2/gaps', 'user', () => ({ gaps: all('SELECT question, missing, COUNT(*) AS times, MAX(at) AS last FROM knowledge_gaps GROUP BY question ORDER BY last DESC LIMIT 200') })),
  r('GET', '/api/v2/changes', 'user', () => ({ changes: readChanges().slice(-300).reverse() })),
  // ── admin ──
  r('GET', '/api/v2/audit', ADMIN, () => ({ audit: all('SELECT * FROM audit_log ORDER BY id DESC LIMIT 300') })),
  r('GET', '/api/v2/settings/ai', ADMIN, () => aiState()),
  r('PUT', '/api/v2/settings/ai', ADMIN, (c) => {
    try { const a = setAiAuthorisation({ authorised: c.body['authorised'] === true, provider: (str(c.body['provider'], 20) || null) as never, acknowledgement: str(c.body['acknowledgement'], 500), allowGeneral: c.body['allowGeneral'] !== false }, c.user!.username); audit(c.user, 'ai-authorisation', 'settings', 'ai', JSON.stringify(a), c.ip); return aiState(); }
    catch (e) { return fail(400, (e as Error).message); }
  }),
  r('POST', '/api/v2/admin/reindex', ADMIN, async (c) => { const lib = indexLibrary(); const docs = await reindexDocuments(); audit(c.user, 'reindex', 'system', '', JSON.stringify({ entries: lib.entries, documents: docs.documents }), c.ip); return { entries: lib.entries, chunks: lib.chunks, relations: lib.relations, problems: lib.problems, invalid: lib.invalid, documents: docs }; }),
  r('GET', '/api/v2/admin/export', ADMIN, (c) => {
    const withOriginals = c.url.searchParams.get('originals') === '1';
    audit(c.user, 'knowledge-exported', 'system', '', withOriginals ? 'with originals' : 'without originals', c.ip);
    return { download: knowledgeZip(withOriginals), name: `wfx-knowledge-${nowIso().slice(0, 10)}${withOriginals ? '-full' : ''}.zip`, type: 'application/zip' };
  }),
  r('POST', '/api/v2/admin/backup', ADMIN, (c) => {
    const dir = path.join(settings().root, 'database', 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = nowIso().replace(/[:.]/g, '-');
    const dbFile = path.join(dir, `wfx_knowledge-${stamp}.db`);
    run(`VACUUM INTO '${dbFile.replace(/'/g, "''")}'`);
    const zipFile = path.join(dir, `knowledge-${stamp}.zip`);
    fs.writeFileSync(zipFile, knowledgeZip(true));
    audit(c.user, 'backup', 'system', '', `${path.basename(dbFile)}, ${path.basename(zipFile)}`, c.ip);
    return { database: toPosix(path.relative(settings().root, dbFile)), knowledge: toPosix(path.relative(settings().root, zipFile)) };
  }),
];
