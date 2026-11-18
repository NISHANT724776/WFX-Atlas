// The Claude assistant's tools and answer assembly, driven by a scripted stand-in for the Claude API (no network,
// no key): which tool calls Claude makes is scripted, everything the tools do runs for real on a sandbox library.
// Also: without AI mode the chat still greets instead of answering "not documented".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from '../helpers.ts';

sandbox('copy');
const { indexLibrary } = await import('../../backend/src/index/indexer.ts');
const { syncRegistry } = await import('../../backend/src/registry/registry.ts');
const { claudeTurn } = await import('../../backend/src/assistant/claude-chat.ts');
const { createConversation, postMessage } = await import('../../backend/src/assistant/conversations.ts');
const { createUser } = await import('../../backend/src/auth.ts');
const { getEntry } = await import('../../backend/src/knowledge/repo.ts');
indexLibrary();
syncRegistry();
const viewer = createUser('cc-viewer', 'CC Viewer', 'viewer', 'Viewer-pass-12345');
const editor = createUser('cc-editor', 'CC Editor', 'editor', 'Editor-pass-12345');

type Call = { name: string; input: Record<string, unknown> };
/** A stand-in for the SDK client: runs the scripted tool calls through the real tools, then returns the scripted text. */
function fakeClaude(script: (results: string[]) => { calls: Call[]; text: string }[]) {
  const seen: { params: any; results: string[] } = { params: null, results: [] };
  const client = {
    beta: { messages: { toolRunner(params: any) {
      seen.params = params;
      return (async function* () {
        for (const turn of script(seen.results)) {
          for (const c of turn.calls) {
            const tool = params.tools.find((t: { name: string }) => t.name === c.name);
            assert.ok(tool, `tool ${c.name} exists`);
            seen.results.push(String(await tool.run(c.input)));
          }
          yield { model: 'claude-opus-5-5', stop_reason: turn.calls.length ? 'tool_use' : 'end_turn', usage: { input_tokens: 100, output_tokens: 20 }, content: turn.text ? [{ type: 'text', text: turn.text }] : [] };
        }
      })();
    } } },
  };
  return { client: client as any, seen };
}
const base = (question: string, user = viewer, history: { role: 'user' | 'assistant'; text: string }[] = []) => ({ question, history, user, userId: user.id, conversationId: createConversation(user.id).id, admin: false });

test('a greeting is answered as conversation, without tools or sources; the request uses Opus 5.5 with fallbacks', async () => {
  const { client, seen } = fakeClaude(() => [{ calls: [], text: 'Hi! How can I help you with WFX today?' }]);
  const r = await claudeTurn(base('hi'), client);
  assert.equal(r.answer.status, 'conversation'); assert.equal(r.answer.sources.length, 0);
  assert.match(r.answer.sections[0].text!, /Hi!/); assert.equal(r.tokens, 120);
  assert.equal(seen.params.model, 'claude-opus-5-5'); assert.equal(seen.params.fallbacks, 'default');
  assert.ok(seen.params.betas.includes('server-side-fallback-2026-07-01'));
  assert.ok(!('temperature' in seen.params) && !('thinking' in seen.params), 'no parameters the model rejects');
  assert.match(seen.params.system, /answer ONLY from what it returns/);
  assert.match(r.answer.generatedBy, /Claude/);
});

test('a WFX question: Claude searches, cites, and only the cited sources are kept and renumbered', async () => {
  const { client, seen } = fakeClaude(() => [
    { calls: [{ name: 'search_wfx_knowledge', input: { query: 'why do indents come in inactive status' } }], text: '' },
    { calls: [], text: 'Because the BOM has no User Group and Purchase Officer, the indents come in Inactive status [1]. Mark them Active by hand [1].' },
  ]);
  const r = await claudeTurn(base('Why are my indents inactive?'), client);
  assert.match(seen.results[0], /KNOWLEDGE STATUS: confirmed/);
  assert.match(seen.results[0], /RULE-SETUP-BOM-INDENT-OWNER/);
  assert.equal(r.answer.status, 'confirmed');
  assert.equal(r.answer.sources.length, 1); assert.equal(r.answer.sources[0].n, 1);
  assert.equal(r.answer.sources[0].entryId, 'RULE-SETUP-BOM-INDENT-OWNER');
});

test('nothing documented: searched but nothing cited → not documented', async () => {
  const { client } = fakeClaude(() => [{ calls: [{ name: 'search_wfx_knowledge', input: { query: 'payroll tax slabs' } }], text: '' }, { calls: [], text: 'The stored WFX documentation does not cover payroll tax slabs.' }]);
  const r = await claudeTurn(base('What are the payroll tax slabs in WFX?'), client);
  assert.equal(r.answer.status, 'not-documented'); assert.equal(r.answer.sources.length, 0);
});

test('open a screen: only registered destinations, opened at once when allowed; role checked', async () => {
  const { client, seen } = fakeClaude(() => [
    { calls: [{ name: 'find_screen_or_guide', input: { query: 'GRN' } }, { name: 'offer_link', input: { destination_id: 'SCR-GRN', open_now: true } }, { name: 'offer_link', input: { destination_id: 'https://evil.example', open_now: true } }], text: '' },
    { calls: [], text: 'Opening the GRN screen.' },
  ]);
  const r = await claudeTurn(base('open GRN'), client);
  assert.match(seen.results[0], /SCR-GRN/);
  assert.match(seen.results[2], /not a registered destination/);
  assert.equal(r.answer.navigate, 'SCR-GRN'); assert.equal(r.answer.actions!.length, 1);
  assert.deepEqual([r.answer.actions![0].route, r.answer.actions![0].query!.doc], ['/data-model', 'grn']);
  const { client: c2 } = fakeClaude(() => [{ calls: [{ name: 'offer_link', input: { destination_id: 'SCR-PLATFORM-ADMIN', open_now: true } }], text: '' }, { calls: [], text: 'You need the admin role.' }]);
  const b = await claudeTurn(base('open admin'), c2);
  assert.equal(b.answer.navigate, undefined); assert.equal(b.answer.actions![0].allowed, false);
});

test('show a guide and open a workflow from the chat', async () => {
  const { client } = fakeClaude(() => [
    { calls: [{ name: 'show_guide', input: { guide_id: 'GUIDE-TRIMS-GRN' } }, { name: 'show_guide', input: { guide_id: 'GUIDE-PROC-PROC-SOURCING-CREATE-RMPO' } }, { name: 'show_guide', input: { guide_id: 'GUIDE-NOPE' } }], text: '' },
    { calls: [], text: 'Here is how.' },
  ]);
  const r = await claudeTurn(base('show me how to receive trims'), client);
  assert.deepEqual(r.answer.cards!.map((c) => c.id), ['GUIDE-TRIMS-GRN', 'GUIDE-PROC-PROC-SOURCING-CREATE-RMPO']);
  assert.match(r.answer.cards![0].note!, /sample data/);
  const { client: c2 } = fakeClaude(() => [{ calls: [{ name: 'open_workflow_designer', input: { request: 'Create a workflow for Sales Order processing' } }], text: '' }, { calls: [], text: 'The Sales Order workflow is open in the designer.' }]);
  const w = await claudeTurn(base('show me the sales order workflow'), c2);
  assert.equal(w.answer.action!.type, 'open-workflow');
});

test('calculate, draft a rule, save it only with the editor role', async () => {
  const { client, seen } = fakeClaude(() => [
    { calls: [{ name: 'run_calculation', input: { rule_id: 'CALC-RMPO-OPEN' } }], text: '' },
    { calls: [], text: 'It needs the ordered and received quantities.' },
  ]);
  await claudeTurn(base('calculate open qty'), client);
  assert.match(seen.results[0], /needs:/);
  const rule = 'In GRN, the accepted quantity cannot be more than the received quantity.';
  const { client: c2, seen: s2 } = fakeClaude(() => [{ calls: [{ name: 'draft_business_rule', input: { text: rule } }, { name: 'save_rule_draft', input: { reason: 'owner said so' } }], text: '' }, { calls: [], text: 'Not saved.' }]);
  await claudeTurn(base('save this rule', viewer), c2);
  assert.match(s2.results[0], /DRAFT/); assert.match(s2.results[1], /needs the editor role/);
  const { client: c3, seen: s3 } = fakeClaude(() => [{ calls: [{ name: 'draft_business_rule', input: { text: rule } }, { name: 'save_rule_draft', input: { reason: 'owner said so' } }], text: '' }, { calls: [], text: 'Saved as a draft.' }]);
  const saved = await claudeTurn(base('save this rule', editor), c3);
  const id = /Saved (\S+) version/.exec(s3.results[1])?.[1];
  assert.ok(id, s3.results[1]); assert.equal(getEntry(id!)!.status, 'Draft');
  assert.equal(saved.answer.actions![0].query!.id, id);
  const { client: c4, seen: s4 } = fakeClaude(() => [{ calls: [{ name: 'list_review_queue', input: {} }], text: '' }, { calls: [], text: 'Here is the queue.' }]);
  await claudeTurn(base('what is waiting for review'), c4);
  assert.ok(s4.results[0].includes(id!), 'the new draft is in the review queue');
});

test('without AI mode the chat greets instead of answering "not documented"', async () => {
  const conv = createConversation(viewer.id).id;
  const r = await postMessage(conv, viewer.id, 'hi', 'ask', 'standard');
  assert.equal(r.answer.answer!.status, 'conversation');
  assert.match(r.answer.answer!.sections[0].text!, /Hello/);
});
