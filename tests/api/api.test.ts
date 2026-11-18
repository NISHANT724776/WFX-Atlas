// API integration: a real server on a free port over a sandbox. Setup, sign-in, roles, cross-site protection,
// uploads, documents, rules, calculations, conversations, export, audit trail, static file safety, headers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { sandbox } from '../helpers.ts';

sandbox('copy');
const { indexLibrary } = await import('../../backend/src/index/indexer.ts');
const { reindexDocuments } = await import('../../backend/src/ingest/pipeline.ts');
const { issueSetupToken } = await import('../../backend/src/auth.ts');
const { createServer } = await import('../../backend/src/server.ts');
indexLibrary();
await reindexDocuments();
const server = createServer();
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const pw = () => `Tt-${randomBytes(9).toString('base64url')}9`;

async function call(path: string, opts: { method?: string; body?: unknown; cookie?: string; raw?: Buffer; headers?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.method && opts.method !== 'GET') headers['x-requested-with'] ??= 'wfx';
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method: opts.method ?? 'GET', headers, body: opts.raw ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined) });
  const type = res.headers.get('content-type') ?? '';
  const data = type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data: data as any, headers: res.headers, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
}

const adminPw = pw(), editorPw = pw(), viewerPw = pw();
let admin = '', editor = '', viewer = '';

test('health is public; everything else needs a session', async () => {
  const h = await call('/api/v2/health');
  assert.equal(h.status, 200);
  assert.equal(h.data.setupRequired, true);
  assert.equal((await call('/api/v2/dashboard')).status, 401);
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
  assert.match(h.headers.get('content-security-policy') ?? '', /default-src 'none'/);
});

test('first-run setup needs the console token, works once', async () => {
  assert.equal((await call('/api/v2/auth/setup', { method: 'POST', body: { token: 'wrong', username: 'boss', displayName: 'Boss', password: adminPw } })).status, 400);
  const token = issueSetupToken()!;
  const weak = await call('/api/v2/auth/setup', { method: 'POST', body: { token, username: 'boss', displayName: 'Boss', password: 'short' } });
  assert.equal(weak.status, 400);
  const ok = await call('/api/v2/auth/setup', { method: 'POST', body: { token, username: 'boss', displayName: 'Boss', password: adminPw } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  assert.equal((await call('/api/v2/auth/setup', { method: 'POST', body: { token, username: 'boss2', displayName: 'B', password: adminPw } })).status, 400);
});

test('sign-in: wrong password refused; session cookie is HttpOnly and SameSite=Strict', async () => {
  assert.equal((await call('/api/v2/auth/login', { method: 'POST', body: { username: 'boss', password: 'nope-nope-1' } })).status, 401);
  const res = await fetch(`${base}/api/v2/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-requested-with': 'wfx' }, body: JSON.stringify({ username: 'boss', password: adminPw }) });
  const set = res.headers.get('set-cookie') ?? '';
  assert.match(set, /HttpOnly/);
  assert.match(set, /SameSite=Strict/);
  admin = set.split(';')[0];
  assert.equal((await call('/api/v2/auth/me', { cookie: admin })).data.user.role, 'admin');
});

test('cross-site requests are refused (missing header, foreign origin)', async () => {
  const noHeader = await fetch(`${base}/api/v2/conversations`, { method: 'POST', headers: { cookie: admin, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(noHeader.status, 403);
  const foreign = await call('/api/v2/conversations', { method: 'POST', cookie: admin, body: {}, headers: { origin: 'https://evil.example' } });
  assert.equal(foreign.status, 403);
});

test('roles: admin creates users; viewers cannot change knowledge; editors cannot approve', async () => {
  assert.equal((await call('/api/v2/users', { method: 'POST', cookie: admin, body: { username: 'editor1', displayName: 'Editor', role: 'editor', password: editorPw } })).status, 200);
  assert.equal((await call('/api/v2/users', { method: 'POST', cookie: admin, body: { username: 'viewer1', displayName: 'Viewer', role: 'viewer', password: viewerPw } })).status, 200);
  editor = (await call('/api/v2/auth/login', { method: 'POST', body: { username: 'editor1', password: editorPw } })).cookie;
  viewer = (await call('/api/v2/auth/login', { method: 'POST', body: { username: 'viewer1', password: viewerPw } })).cookie;
  assert.equal((await call('/api/v2/users', { cookie: editor })).status, 403);
  assert.equal((await call('/api/v2/entries', { method: 'POST', cookie: viewer, body: { raw: 'RULE ID: X-1' } })).status, 403);
  assert.equal((await call('/api/v2/documents', { method: 'POST', cookie: viewer, raw: Buffer.from('a,b\n1,2'), headers: { 'x-file-name': 'v.csv' } })).status, 403);
});

test('teach a rule over the API: propose → draft (editor) → refused activation (editor) → activate (admin)', async () => {
  const p = await call('/api/v2/rules/propose', { method: 'POST', cookie: editor, body: { text: 'In GRN, Accepted Qty must not be more than the Received Qty.' } });
  assert.equal(p.status, 200);
  assert.equal(p.data.understanding.category, 'Validation');
  const d = await call('/api/v2/entries', { method: 'POST', cookie: editor, body: { raw: p.data.draftText, reason: 'api test' } });
  assert.equal(d.status, 200, JSON.stringify(d.data));
  const id = d.data.id;
  assert.equal((await call(`/api/v2/entries/${id}/transition`, { method: 'POST', cookie: editor, body: { to: 'Active', version: 1 } })).status, 403);
  assert.equal((await call(`/api/v2/entries/${id}/transition`, { method: 'POST', cookie: editor, body: { to: 'Under Review', version: 1 } })).status, 200);
  const act = await call(`/api/v2/entries/${id}/transition`, { method: 'POST', cookie: admin, body: { to: 'Active', version: 1, reason: 'approved' } });
  assert.equal(act.status, 200, JSON.stringify(act.data));
  const detail = await call(`/api/v2/entries/${id}`, { cookie: viewer });
  assert.equal(detail.data.current.status, 'Active');
  assert.match(detail.data.current.fields['APPROVED BY'], /boss/);
  const run = await call('/api/v2/calc/run', { method: 'POST', cookie: viewer, body: { ruleId: id, inputs: { accepted_qty: 120, received_qty: 100 } } });
  assert.equal(run.data.result, 0, 'the validation fails for 120 > 100');
});

test('documents: upload, duplicate, list, extracted text, original download, reprocess', async () => {
  const csv = Buffer.from('Article Code,Qty,Rate\nN-8,100,15\nT-1,2,10\n');
  const up = await call('/api/v2/documents?knowledgeStatus=reference', { method: 'POST', cookie: editor, raw: csv, headers: { 'x-file-name': encodeURIComponent('bom lines.csv'), 'content-type': 'text/csv' } });
  assert.equal(up.status, 200, JSON.stringify(up.data));
  assert.equal(up.data.status, 'created');
  const dup = await call('/api/v2/documents', { method: 'POST', cookie: editor, raw: csv, headers: { 'x-file-name': 'other.csv' } });
  assert.equal(dup.data.status, 'duplicate');
  const list = await call('/api/v2/documents', { cookie: viewer });
  assert.ok(list.data.documents.some((d: { id: string }) => d.id === up.data.documentId));
  const ex = await call(`/api/v2/documents/${up.data.documentId}/versions/1/extracted`, { cookie: viewer });
  assert.match(ex.data.toString(), /TABLE 1/);
  const orig = await call(`/api/v2/documents/${up.data.documentId}/versions/1/original`, { cookie: viewer });
  assert.equal(Buffer.compare(orig.data, csv), 0, 'the original comes back byte for byte');
  assert.equal((await call(`/api/v2/documents/${up.data.documentId}/reprocess`, { method: 'POST', cookie: editor, body: {} })).status, 200);
  const bad = await call('/api/v2/documents', { method: 'POST', cookie: editor, raw: Buffer.from('not a pdf'), headers: { 'x-file-name': 'x.pdf' } });
  assert.equal(bad.status, 400);
});

test('conversations: ask, follow-up, regenerate, summary, export; private to their owner', async () => {
  const c = await call('/api/v2/conversations', { method: 'POST', cookie: viewer, body: {} });
  const id = c.data.id;
  const m1 = await call(`/api/v2/conversations/${id}/messages`, { method: 'POST', cookie: viewer, body: { content: 'How do I create a GDI pick list and GDN from the mobile application?' } });
  assert.equal(m1.status, 200);
  assert.ok(m1.data.answer.answer.sources.length > 0);
  const m2 = await call(`/api/v2/conversations/${id}/messages`, { method: 'POST', cookie: viewer, body: { content: 'Now explain the next step.' } });
  assert.match(m2.data.answer.answer.title, /step 2/);
  const rule = await call(`/api/v2/conversations/${id}/messages`, { method: 'POST', cookie: viewer, body: { content: 'In RMPO, Open Qty = Order Qty minus Received Qty', mode: 'rule' } });
  assert.ok(rule.data.answer.answer.sections.some((s: { kind: string }) => s.kind === 'conflict'), 'the stored RMPO rule is shown');
  const ba = await call(`/api/v2/conversations/${id}/messages`, { method: 'POST', cookie: viewer, body: { content: 'When Product Group is changed in an existing line, the previously selected Product Subcategory is cleared.', mode: 'ba' } });
  assert.ok(ba.data.answer.answer.sections.some((s: { title: string }) => /test scenarios/i.test(s.title)));
  assert.equal((await call(`/api/v2/conversations/${id}/regenerate`, { method: 'POST', cookie: viewer, body: { depth: 'brief' } })).status, 200);
  const conv = await call(`/api/v2/conversations/${id}`, { cookie: viewer });
  assert.ok(conv.data.messages.length >= 9);
  assert.match(conv.data.summary, /answer/);
  assert.equal((await call(`/api/v2/conversations/${id}`, { cookie: editor })).status, 404, 'another user cannot read it');
  const md = await call(`/api/v2/conversations/${id}/export`, { cookie: viewer });
  assert.match(md.data.toString(), /\*\*Question:\*\*/);
});

test('dashboard, transactions, calc tests, export and audit come from real data', async () => {
  const d = await call('/api/v2/dashboard', { cookie: viewer });
  assert.ok(d.data.totals.transactions >= 15 && d.data.totals.rulesConfirmed > 100);
  const t = await call('/api/v2/transactions', { cookie: viewer });
  const rmpo = t.data.transactions.find((x: { slug: string }) => x.slug === 'rmpo');
  const page = await call(`/api/v2/transactions/${rmpo.id}`, { cookie: viewer });
  assert.ok(page.data.sections.find((s: { key: string }) => s.key === 'calculations').value.length > 0);
  assert.ok(page.data.notDocumented.length > 0, 'missing sections are listed, not invented');
  const tests = await call('/api/v2/calc/tests', { method: 'POST', cookie: viewer, body: { ruleId: 'CALC-CONSUMPTION-CHAIN' } });
  assert.equal(tests.data.failed, 0);
  const zip = await call('/api/v2/admin/export', { cookie: admin });
  assert.equal(zip.data.subarray(0, 2).toString(), 'PK');
  assert.equal((await call('/api/v2/admin/export', { cookie: editor })).status, 403);
  const audit = await call('/api/v2/audit', { cookie: admin });
  const actions = new Set(audit.data.audit.map((a: { action: string }) => a.action));
  for (const a of ['login', 'login-failed', 'user-created', 'entry-activated', 'document-created']) assert.ok(actions.has(a) || [...actions].some((x) => String(x).startsWith(a.split('-')[0])), a);
});

test('static files: no path traversal, security headers on pages', async () => {
  for (const p of ['/../package.json', '/%2e%2e/package.json', '/..%5cpackage.json', '/%2e%2e%2f%2e%2e%2fpackage.json']) {
    const r = await fetch(`${base}${p}`);
    const body = await r.text();
    assert.ok(!body.includes('"name": "wfx-knowledge-hub"'), `${p} leaked package.json`);
  }
  const page = await fetch(`${base}/`);
  if (page.status === 200) assert.match(page.headers.get('content-security-policy') ?? '', /script-src 'self'/);
  assert.equal((await fetch(`${base}/api/v2/nothing`)).status, 404);
});

test('workflow designer API: open, generate, check, save (role-checked), reload', async () => {
  const list = await call('/api/v2/workflows', { cookie: viewer });
  assert.ok(list.data.workflows.length >= 12 && list.data.procedures.length > 10);
  const e2e = await call('/api/v2/workflows/WF-E2E-MATERIAL-FLOW', { cookie: viewer });
  assert.equal(e2e.data.problems.filter((p: { level: string }) => p.level === 'error').length, 0);
  assert.match(e2e.data.mermaid, /^flowchart TD/);
  const gen = await call('/api/v2/workflows/generate', { method: 'POST', cookie: viewer, body: { text: 'Raise indent\nIf approved then create PO, else return to merchandiser\nSend PO', name: 'API flow' } });
  assert.equal(gen.data.paths.length, 2);
  const broken = { ...gen.data.graph, edges: [] };
  const chk = await call('/api/v2/workflows/check', { method: 'POST', cookie: viewer, body: { graph: broken } });
  assert.ok(chk.data.problems.some((p: { message: string }) => /Dead end/.test(p.message)));
  assert.equal((await call('/api/v2/workflows/save', { method: 'POST', cookie: viewer, body: { graph: gen.data.graph } })).status, 403);
  const saved = await call('/api/v2/workflows/save', { method: 'POST', cookie: editor, body: { graph: gen.data.graph } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const back = await call(`/api/v2/workflows/${saved.data.id}`, { cookie: viewer });
  assert.equal(back.data.graph.nodes.length, gen.data.graph.nodes.length);
  assert.equal(back.data.graph.status, 'Draft');
});

test('data modelling API: list, open captured, draft, logical view, check, save (role-checked), DDL download', async () => {
  const list = await call('/api/v2/models', { cookie: viewer });
  assert.equal(list.data.captured.length, 28);
  const grn = await call('/api/v2/models/DM-GRN', { cookie: viewer });
  assert.equal(grn.data.model.level, 'captured');
  assert.match(grn.data.ddl, /NOT THE WFX DATABASE SCHEMA/);
  const d = await call('/api/v2/models/draft?view=logical', { method: 'POST', cookie: viewer, body: { text: 'An order has many lines\nLine: item, qty: decimal', name: 'API model' } });
  assert.equal(d.data.model.level, 'logical');
  assert.ok(d.data.model.entities.find((e: { name: string }) => e.name === 'Line').attributes.some((a: { fk: string }) => a.fk === 'Order'));
  const conceptual = (await call('/api/v2/models/draft', { method: 'POST', cookie: viewer, body: { text: 'An order has many lines\nLine: item, qty: decimal', name: 'API model' } })).data.model;
  const chk = await call('/api/v2/models/check', { method: 'POST', cookie: viewer, body: { model: { ...conceptual, level: 'captured' } } });
  assert.equal(chk.data.model.level, 'conceptual', 'a client cannot claim a model is captured');
  assert.equal((await call('/api/v2/models/save', { method: 'POST', cookie: viewer, body: { model: conceptual } })).status, 403);
  const saved = await call('/api/v2/models/save', { method: 'POST', cookie: editor, body: { model: conceptual } });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const back = await call(`/api/v2/models/${saved.data.id}`, { cookie: viewer });
  assert.equal(back.data.model.status, 'Draft');
  const ddl = await call(`/api/v2/models/${saved.data.id}/ddl`, { cookie: viewer });
  assert.match(ddl.headers.get('content-disposition') ?? '', /proposed\.sql/);
  assert.match(ddl.data.toString('utf8'), /CREATE TABLE line/);
});

test('chat to workflow over HTTP: request → draft + action → designer view → edit → save → retrieval; private and role-checked', async () => {
  const conv = (await call('/api/v2/conversations', { method: 'POST', cookie: editor, body: {} })).data;
  const sent = await call(`/api/v2/conversations/${conv.id}/messages`, { method: 'POST', cookie: editor, body: { content: 'Create a workflow for Sales Order processing.', mode: 'ask' } });
  const act = sent.data.answer?.answer?.action ?? assert.fail(JSON.stringify(sent.data).slice(0, 600));
  assert.equal(act.type, 'open-workflow'); assert.equal(act.conversationId, conv.id);
  // the designer loads the same draft with its request, sources and step details
  const view = await call(`/api/v2/workflow-drafts/${act.draftId}`, { cookie: editor });
  assert.equal(view.status, 200);
  assert.equal(view.data.draft.conversationId, conv.id); assert.equal(view.data.draft.approvalStatus, 'Draft'); assert.equal(view.data.draft.saved, false);
  assert.ok(view.data.doc.graph.nodes.some((n: { rules?: unknown[] }) => n.rules?.length));
  assert.equal(view.data.problems.filter((p: { level: string }) => p.level === 'error').length, 0);
  // private to its owner
  assert.equal((await call(`/api/v2/workflow-drafts/${act.draftId}`, { cookie: viewer })).status, 404);
  assert.equal((await call(`/api/v2/workflow-drafts/${act.draftId}/chat`, { method: 'POST', cookie: viewer, body: { message: 'Show this as a swimlane diagram' } })).status, 404);
  // edit by chat from the designer; the exchange lands in the originating conversation
  const edit = await call(`/api/v2/workflow-drafts/${act.draftId}/chat`, { method: 'POST', cookie: editor, body: { message: 'Add the BOM creation step after Create Sales Order' } });
  assert.equal(edit.data.ok, true, JSON.stringify(edit.data.reply));
  assert.ok(edit.data.doc.graph.nodes.some((n: { label: string; basis: string }) => n.label === 'BOM creation' && n.basis === 'proposed'));
  const sw = await call(`/api/v2/workflow-drafts/${act.draftId}/chat`, { method: 'POST', cookie: editor, body: { message: 'Show this as a swimlane diagram' } });
  assert.equal(sw.data.doc.graph.format, 'swimlane'); assert.equal(sw.data.draft.version, 3);
  const nope = await call(`/api/v2/workflow-drafts/${act.draftId}/chat`, { method: 'POST', cookie: editor, body: { message: 'make it prettier' } });
  assert.equal(nope.data.ok, false); assert.equal(nope.data.draft.version, 3, 'an unclear message changes nothing');
  const convAfter = await call(`/api/v2/conversations/${conv.id}`, { cookie: editor });
  assert.ok(convAfter.data.messages.length >= 8);
  // manual edit stored (autosave in place), then a saved version
  const g = sw.data.doc.graph; g.name = 'Sales order (edited)';
  const put = await call(`/api/v2/workflow-drafts/${act.draftId}`, { method: 'PUT', cookie: editor, body: { graph: g, detail: 'overview', overlay: 'rules', collapsed: ['Sales Order'], newVersion: true, reason: 'renamed' } });
  assert.equal(put.status, 200); assert.equal(put.data.draft.version, 4); assert.equal(put.data.doc.detail, 'overview'); assert.deepEqual(put.data.doc.collapsed, ['Sales Order']);
  // save to the library: viewers cannot, editors can; stays a Draft and keeps the link to its source request
  assert.equal((await call(`/api/v2/workflow-drafts/${act.draftId}/save`, { method: 'POST', cookie: viewer, body: {} })).status, 403);
  const saved = await call(`/api/v2/workflow-drafts/${act.draftId}/save`, { method: 'POST', cookie: editor, body: {} });
  assert.equal(saved.status, 200, JSON.stringify(saved.data));
  const lib = await call(`/api/v2/entries/${saved.data.entryId}`, { cookie: viewer });
  assert.equal(lib.data.pending ? lib.data.pending.status : lib.data.current.status, 'Draft');
  const again = await call(`/api/v2/workflow-drafts/${act.draftId}`, { cookie: editor });
  assert.equal(again.data.draft.saved, true); assert.equal(again.data.draft.workflowId, saved.data.entryId);
  // a stored workflow opened in the designer carries the documented details too
  const stored = await call('/api/v2/workflows/WF-READY-SALES-ORDER', { cookie: viewer });
  assert.ok(stored.data.graph.nodes.some((n: { rules?: unknown[] }) => n.rules?.length));
  // a request made in the designer itself, and one that cannot be answered (no draft, a clarification, request kept in the chat record)
  const gen = await call('/api/v2/workflow-drafts', { method: 'POST', cookie: editor, body: { request: 'Show the complete GRN workflow' } });
  assert.ok(gen.data.draftId);
  const unk = await call('/api/v2/workflow-drafts', { method: 'POST', cookie: editor, body: { request: 'Create a workflow for weather forecasting' } });
  assert.equal(unk.data.draftId, null); assert.equal(unk.data.answer.status, 'partial');
  assert.equal((await call('/api/v2/workflow-drafts', { method: 'POST', cookie: editor, body: { request: 'How does the MRP workflow work?' } })).status, 422);
  assert.equal((await call('/api/v2/workflow-drafts/WFD-nope', { cookie: editor })).status, 404);
});

test('create your own account from the sign-in page: viewer only, admin decides (off / approval / open), approval and rejection, limits', async () => {
  const sPw = pw();
  assert.equal((await call('/api/v2/health')).data.signup, 'approval', 'the default needs an admin to approve');
  // a request: always a viewer (a role in the body is ignored), cannot sign in until approved
  const a = await call('/api/v2/auth/signup', { method: 'POST', body: { username: 'newbie.one', displayName: 'New One', password: sPw, role: 'admin' } });
  assert.equal(a.status, 200, JSON.stringify(a.data)); assert.equal(a.data.status, 'pending'); assert.equal(a.data.user, null);
  assert.equal(a.cookie, '', 'no session before approval');
  const early = await call('/api/v2/auth/login', { method: 'POST', body: { username: 'newbie.one', password: sPw } });
  assert.equal(early.status, 403); assert.match(early.data.error ?? early.data.message ?? JSON.stringify(early.data), /waiting for an administrator/);
  assert.equal((await call('/api/v2/auth/login', { method: 'POST', body: { username: 'newbie.one', password: 'wrong-Password-1' } })).status, 401, 'a wrong password does not reveal the pending state');
  // a weak password is refused
  assert.equal((await call('/api/v2/auth/signup', { method: 'POST', body: { username: 'weak.one', displayName: 'W', password: 'short' } })).status, 400);
  // the admin sees it, and nobody else can approve
  const users = await call('/api/v2/users', { cookie: admin });
  const row = users.data.users.find((u: { username: string }) => u.username === 'newbie.one');
  assert.ok(row.pending && row.disabled && row.role === 'viewer');
  assert.equal((await call(`/api/v2/users/${row.id}/approve`, { method: 'POST', cookie: editor, body: { role: 'editor' } })).status, 403);
  assert.equal((await call(`/api/v2/users/${row.id}/approve`, { method: 'POST', cookie: admin, body: { role: 'editor' } })).status, 200);
  const first = await call('/api/v2/auth/login', { method: 'POST', body: { username: 'newbie.one', password: sPw } });
  assert.equal(first.status, 200); assert.equal(first.data.user.role, 'editor');
  assert.equal((await call(`/api/v2/users/${row.id}/approve`, { method: 'POST', cookie: admin, body: {} })).status, 400, 'approving twice is refused');
  // a request can be rejected (deleted); an active user cannot be removed this way
  await call('/api/v2/auth/signup', { method: 'POST', body: { username: 'newbie.two', displayName: 'Two', password: sPw } });
  const two = (await call('/api/v2/users', { cookie: admin })).data.users.find((u: { username: string }) => u.username === 'newbie.two');
  assert.equal((await call(`/api/v2/users/${two.id}/reject`, { method: 'POST', cookie: admin })).status, 200);
  assert.ok(!(await call('/api/v2/users', { cookie: admin })).data.users.some((u: { username: string }) => u.username === 'newbie.two'));
  assert.equal((await call(`/api/v2/users/${row.id}/reject`, { method: 'POST', cookie: admin })).status, 400);
  // the setting: only an admin changes it; "off" closes the door; "open" signs the new viewer in at once
  assert.equal((await call('/api/v2/settings/signup', { method: 'PUT', cookie: editor, body: { mode: 'open' } })).status, 403);
  assert.equal((await call('/api/v2/settings/signup', { method: 'PUT', cookie: admin, body: { mode: 'nonsense' } })).status, 400);
  assert.equal((await call('/api/v2/settings/signup', { method: 'PUT', cookie: admin, body: { mode: 'off' } })).status, 200);
  assert.equal((await call('/api/v2/health')).data.signup, 'off');
  assert.equal((await call('/api/v2/auth/signup', { method: 'POST', body: { username: 'closed.one', displayName: 'C', password: sPw } })).status, 403);
  await call('/api/v2/settings/signup', { method: 'PUT', cookie: admin, body: { mode: 'open' } });
  const open = await call('/api/v2/auth/signup', { method: 'POST', body: { username: 'open.one', displayName: 'Open One', password: sPw } });
  assert.equal(open.status, 200); assert.equal(open.data.status, 'active'); assert.equal(open.data.user.role, 'viewer'); assert.ok(open.cookie.startsWith('wfx_session=') || open.cookie.length > 10);
  const me = await call('/api/v2/auth/me', { cookie: open.cookie });
  assert.equal(me.data.user.username, 'open.one');
  assert.equal((await call('/api/v2/workflows/save', { method: 'POST', cookie: open.cookie, body: { graph: {} } })).status, 403, 'a self-registered viewer cannot change knowledge');
  // the limit: five requests an hour from one computer (five were used above)
  assert.equal((await call('/api/v2/auth/signup', { method: 'POST', body: { username: 'one.too.many', displayName: 'X', password: sPw } })).status, 429);
  await call('/api/v2/settings/signup', { method: 'PUT', cookie: admin, body: { mode: 'approval' } });
});

test('admin directory: users are written to knowledge/admin/users.txt (no secrets) and are searchable by an administrator only', async () => {
  const fs = await import('node:fs'), path = await import('node:path');
  const file = path.join(process.env['WFX_KNOWLEDGE_DIR']!, 'admin', 'users.txt');
  const secret = pw();
  const add = await call('/api/v2/users', { method: 'POST', cookie: admin, body: { username: 'zelda.approver', displayName: 'Zelda Approver', role: 'approver', password: secret } });
  assert.equal(add.status, 200, JSON.stringify(add.data));
  const text = fs.readFileSync(file, 'utf8');
  assert.match(text, /USER: zelda\.approver\nDISPLAY NAME: Zelda Approver\nROLE: approver \(approve and activate knowledge\)\nSTATUS: active/);
  assert.ok(!text.includes(secret) && !/scrypt|pass_hash|pass_salt|token/i.test(text), 'no password, hash or token in the file');
  // it follows changes: disabled, then a role change
  const id = (await call('/api/v2/users', { cookie: admin })).data.users.find((u: { username: string }) => u.username === 'zelda.approver').id;
  await call(`/api/v2/users/${id}`, { method: 'PATCH', cookie: admin, body: { disabled: true } });
  assert.match(fs.readFileSync(file, 'utf8'), /USER: zelda\.approver[\s\S]*?STATUS: disabled/);
  await call(`/api/v2/users/${id}`, { method: 'PATCH', cookie: admin, body: { disabled: false, role: 'editor' } });
  assert.match(fs.readFileSync(file, 'utf8'), /USER: zelda\.approver[\s\S]*?ROLE: editor[\s\S]*?STATUS: active/);
  // the API: only an admin reads it; everybody reads their own profile
  const dir = await call('/api/v2/admin/directory', { cookie: admin });
  assert.equal(dir.status, 200); assert.equal(dir.data.file, 'admin/users.txt'); assert.match(dir.data.text, /zelda\.approver/);
  assert.equal((await call('/api/v2/admin/directory', { cookie: editor })).status, 403);
  assert.equal((await call('/api/v2/admin/directory', { cookie: viewer })).status, 403);
  const prof = await call('/api/v2/profile', { cookie: viewer });
  assert.equal(prof.status, 200); assert.equal(prof.data.user.role, 'viewer'); assert.ok(!JSON.stringify(prof.data).match(/pass|hash|salt/i));
  // search: the passages exist, but only an administrator's search can see them
  const { search } = await import('../../backend/src/search/search.ts');
  assert.ok(search('approver role user zelda', { includeAdmin: true, limit: 30 }).hits.some((h) => h.kind === 'admin_user'));
  assert.ok(!search('approver role user zelda', { limit: 30 }).hits.some((h) => h.kind === 'admin_user'), 'hidden by default');
  // a viewer asking the assistant never gets it
  const conv = (await call('/api/v2/conversations', { method: 'POST', cookie: viewer, body: {} })).data;
  const m = await call(`/api/v2/conversations/${conv.id}/messages`, { method: 'POST', cookie: viewer, body: { content: 'which user has the approver role and what is their user name' } });
  assert.ok(!JSON.stringify(m.data.answer).includes('zelda'), 'a viewer cannot retrieve the admin directory');
});

