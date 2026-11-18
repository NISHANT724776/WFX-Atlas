// Chatbot as product expert and navigator, end to end over a real server and a sandbox database:
// Screen Registry and guides (from knowledge/registry), permission-checked navigation, the Trims Scan prototype guides
// with their real screenshots, how-to guides from procedures, clarification, unknown screens, persistence, rename, search.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import { sandbox } from '../helpers.ts';

sandbox('copy');
const { indexLibrary } = await import('../../backend/src/index/indexer.ts');
const { createUser } = await import('../../backend/src/auth.ts');
const { createServer } = await import('../../backend/src/server.ts');
const reg = await import('../../backend/src/registry/registry.ts');
const { navIntent } = await import('../../backend/src/assistant/navigator.ts');
indexLibrary();
const synced = reg.syncRegistry();
const server = createServer();
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
after(() => server.close());
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const pw = () => `Tt-${randomBytes(9).toString('base64url')}9`;
const viewerPw = pw(), adminPw = pw();
createUser('chat-viewer', 'Chat Viewer', 'viewer', viewerPw);
createUser('chat-admin', 'Chat Admin', 'admin', adminPw);

async function call(path: string, opts: { method?: string; body?: unknown; cookie?: string } = {}) {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.method && opts.method !== 'GET') headers['x-requested-with'] = 'wfx';
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  const res = await fetch(`${base}${path}`, { method: opts.method ?? 'GET', headers, body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, type, data: (type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer())) as any, cookie: (res.headers.get('set-cookie') ?? '').split(';')[0] };
}
const login = async (u: string, p: string) => (await call('/api/v2/auth/login', { method: 'POST', body: { username: u, password: p } })).cookie;
const viewer = await login('chat-viewer', viewerPw);
const admin = await login('chat-admin', adminPw);
async function ask(conv: string, content: string, cookie = viewer) {
  const r = await call(`/api/v2/chat/conversations/${conv}/messages`, { method: 'POST', cookie, body: { content } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data.answer.answer;
}

test('registry: screens, platform pages, the prototype link and six captured guides; no route outside the app', () => {
  assert.ok(synced.screens >= 35, `screens ${synced.screens}`);
  assert.equal(synced.guides, 6);
  assert.deepEqual(synced.problems, []);
  for (const s of reg.listScreens()) assert.ok(!s.route || reg.APP_ROUTES.some((r) => s.route === r || s.route.startsWith(`${r}/`)), s.id);
  const g = reg.getGuide('GUIDE-TRIMS-GRN')!;
  assert.equal(g.kind, 'prototype'); assert.ok(g.steps.length >= 8);
  assert.ok(g.steps.every((s) => s.image?.startsWith('/api/v2/chat/assets/trims/')), 'every step has its captured screen');
  assert.ok(g.steps[0].markers.length === 1 && /GOODS RECEIVED/i.test(g.steps[0].markers[0].label), 'the prototype\'s own "Tap here" is the first marker');
  assert.match(g.dataNote, /sample data/i);
});

test('intent: open / prototype / how-to / ambiguous are told apart', () => {
  assert.equal(navIntent('Open the Sales Order screen'), 'navigate');
  assert.equal(navIntent('Take me to GRN'), 'navigate');
  assert.equal(navIntent('Explain the complete trims outward process'), 'prototype');
  assert.equal(navIntent('How do I create an RMPO?'), 'howto');
  assert.equal(navIntent('Sales Order'), 'ambiguous');
  assert.equal(navIntent('What is GRN?'), 'none');
});

test('navigation: only registered destinations resolve, with the role checked', async () => {
  const ok = await call('/api/v2/chat/navigation/SCR-GRN', { cookie: viewer });
  assert.equal(ok.status, 200); assert.deepEqual([ok.data.kind, ok.data.route, ok.data.query.doc, ok.data.allowed], ['route', '/data-model', 'grn', true]);
  const blocked = await call('/api/v2/chat/navigation/SCR-PLATFORM-ADMIN', { cookie: viewer });
  assert.equal(blocked.data.allowed, false); assert.match(blocked.data.reason, /admin role/);
  assert.equal((await call('/api/v2/chat/navigation/SCR-PLATFORM-ADMIN', { cookie: admin })).data.allowed, true);
  const ext = await call('/api/v2/chat/navigation/EXT-TRIMS-PROTOTYPE', { cookie: viewer });
  assert.equal(ext.data.url, 'https://trims-prototype-mobile.vercel.app/'); assert.match(ext.data.note, /sample data/);
  const wf = await call('/api/v2/chat/navigation/WF-READY-SALES-ORDER', { cookie: viewer });
  assert.deepEqual([wf.data.route, wf.data.query.id], ['/workflow-designer', 'WF-READY-SALES-ORDER']);
  assert.equal((await call('/api/v2/chat/navigation/https%3A%2F%2Fevil.example', { cookie: viewer })).status, 404);
  assert.equal((await call('/api/v2/chat/navigation/SCR-GRN')).status, 401, 'needs a session');
});

test('guides and their images are served to signed-in users; no path escapes the assets folder', async () => {
  const g = await call('/api/v2/chat/guides/GUIDE-TRIMS-OUT', { cookie: viewer });
  assert.equal(g.status, 200); assert.ok(g.data.steps.length >= 8);
  const img = await call(g.data.steps[0].image, { cookie: viewer });
  assert.equal(img.status, 200); assert.equal(img.type, 'image/webp'); assert.ok(img.data.length > 5000);
  assert.equal((await call(g.data.steps[0].image)).status, 401);
  assert.equal((await call('/api/v2/chat/assets/..%2F..%2Fdatabase/x.webp', { cookie: viewer })).status, 404);
  const proc = await call('/api/v2/chat/guides/GUIDE-PROC-PROC-SOURCING-CREATE-RMPO', { cookie: viewer });
  assert.equal(proc.data.kind, 'procedure'); assert.equal(proc.data.steps.length, 6);
  assert.ok(proc.data.missing.some((m: string) => /Click positions/.test(m)), 'says honestly that click positions are not recorded');
  assert.equal((await call('/api/v2/chat/guides/GUIDE-NOPE', { cookie: viewer })).status, 404);
});

test('search: knowledge, screens and guides in one call', async () => {
  const r = await call('/api/v2/chat/search', { method: 'POST', cookie: viewer, body: { q: 'trims GRN scan' } });
  assert.equal(r.status, 200); assert.ok(r.data.guides.some((g: { id: string }) => g.id === 'GUIDE-TRIMS-GRN'));
  assert.ok(Array.isArray(r.data.knowledge) && Array.isArray(r.data.screens));
});

test('chat scenarios: prototype walkthrough, open a screen, how-to guide, clarify, unknown screen, workflow', async () => {
  const conv = (await call('/api/v2/chat/conversations', { method: 'POST', cookie: viewer, body: {} })).data.id;
  // D: trims outward → the Outward Note guide, the prototype link, labelled as sample data
  const d = await ask(conv, 'Explain the complete trims outward process');
  assert.equal(d.cards[0].id, 'GUIDE-TRIMS-OUT'); assert.equal(d.actions[0].url, 'https://trims-prototype-mobile.vercel.app/');
  assert.match(d.statusNote, /sample data/);
  const all = await ask(conv, 'Explain the Trims Scan process');
  assert.deepEqual(all.cards.map((c: { id: string }) => c.id), ['GUIDE-TRIMS-GRN', 'GUIDE-TRIMS-DISPATCH', 'GUIDE-TRIMS-GDN', 'GUIDE-TRIMS-LOC', 'GUIDE-TRIMS-PRINT', 'GUIDE-TRIMS-OUT']);
  // E: open a screen → resolved from the registry and opened straight away
  const e = await ask(conv, 'Open the Sales Order screen');
  assert.equal(e.navigate, 'SCR-OC'); assert.equal(e.actions[0].route, '/data-model'); assert.equal(e.actions[0].query.doc, 'oc');
  // permission: a viewer is not taken to the admin page
  const p = await ask(conv, 'open the admin page');
  assert.equal(p.navigate, undefined); assert.equal(p.actions[0].allowed, false);
  // how-to with a documented procedure → its steps as a guide
  const h = await ask(conv, 'How do I create an RMPO?');
  assert.equal(h.cards[0].id, 'GUIDE-PROC-PROC-SOURCING-CREATE-RMPO');
  // how-to without a procedure → says so, does not invent steps
  const so = await ask(conv, 'How do I create a Sales Order?');
  assert.equal(so.status, 'partial'); assert.match(so.sections[0].text, /No step-by-step procedure/);
  assert.ok(so.actions.some((a: { id: string }) => a.id === 'SCR-OC'), 'still offers the documented Sales Order screen');
  // ambiguous subject → options, not a guess
  const amb = await ask(conv, 'Sales Order');
  assert.ok(amb.followUps.includes('Show the Sales Order workflow')); assert.equal(amb.actions[1].id, 'WF-READY-SALES-ORDER');
  // F: unknown screen → nothing opened, nothing invented
  const f = await ask(conv, 'open the payroll screen');
  assert.equal(f.status, 'not-documented'); assert.equal(f.navigate, undefined); assert.equal(f.actions, undefined);
  // B: workflow → a generated workflow opens in the designer
  const b = await ask(conv, 'Show me the Sales Order workflow');
  assert.equal(b.action.type, 'open-workflow');
  // G: everything is stored and comes back
  const back = await call(`/api/v2/chat/conversations/${conv}`, { cookie: viewer });
  assert.equal(back.data.messages.length, 18, 'nine questions and nine answers');
  assert.equal(back.data.messages[1].answer.cards[0].id, 'GUIDE-TRIMS-OUT', 'guides survive a reload');
});

test('conversations: rename, search by content, private to their owner', async () => {
  const c = (await call('/api/v2/chat/conversations', { method: 'POST', cookie: viewer, body: {} })).data.id;
  await ask(c, 'How is open quantity calculated in RMPO?');
  const r = await call(`/api/v2/chat/conversations/${c}`, { method: 'PATCH', cookie: viewer, body: { title: 'RMPO open quantity' } });
  assert.equal(r.data.title, 'RMPO open quantity');
  assert.equal((await call(`/api/v2/chat/conversations/${c}`, { method: 'PATCH', cookie: viewer, body: { title: '  ' } })).status, 400);
  const found = await call('/api/v2/chat/conversations?q=open%20quantity', { cookie: viewer });
  assert.ok(found.data.conversations.some((x: { id: string }) => x.id === c));
  const none = await call('/api/v2/chat/conversations?q=zzzz-nothing', { cookie: viewer });
  assert.equal(none.data.conversations.length, 0);
  assert.equal((await call(`/api/v2/chat/conversations/${c}`, { method: 'PATCH', cookie: admin, body: { title: 'x' } })).status, 404, 'another user cannot rename it');
  assert.equal((await call(`/api/v2/chat/conversations?q=open`, { cookie: admin })).data.conversations.length, 0);
});
