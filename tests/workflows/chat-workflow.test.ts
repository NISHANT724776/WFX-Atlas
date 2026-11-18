// Chat → workflow: intent detection, generation from the knowledge, per-step documentation, plain-language edits,
// persisted drafts (versions, undo, retry, save to the library), the conversation link, and the status lifecycle.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from '../helpers.ts';

sandbox('copy');
const { indexLibrary } = await import('../../backend/src/index/indexer.ts');
const g = await import('../../backend/src/workflows/generate.ts');
const drafts = await import('../../backend/src/workflows/drafts.ts');
const d = await import('../../backend/src/workflows/designer.ts');
const { createConversation, postMessage, getConversation } = await import('../../backend/src/assistant/conversations.ts');
const { transition } = await import('../../backend/src/rules/rules.ts');
const { getEntry } = await import('../../backend/src/knowledge/repo.ts');
indexLibrary();
const U = 7;

test('intent: create / modify / compare / explain are told apart', () => {
  const create = ['Create a workflow for Sales Order processing.', 'Show me the complete MRP workflow.', 'Make a workflow for RMPO confirmation.', 'Convert this business process into a workflow: raise indent, then approve, then buy',
    'Design an end-to-end garment manufacturing workflow.', 'Show the transaction lifecycle as a diagram.', 'Generate a Kit/Pack process flow.'];
  for (const q of create) assert.equal(g.workflowKind(q, 'ask', false), 'create', q);
  for (const q of ['How does the MRP workflow work?', 'What is the workflow for GRN?', 'Explain the workflow of RMPO', 'Why is there a workflow for approval?']) assert.equal(g.workflowKind(q, 'ask', false), 'explain', q);
  for (const q of ['Explain the Kit/Pack process', 'How is open quantity calculated in RMPO?', 'What is BOM?']) assert.equal(g.workflowKind(q, 'ask', false), 'none', q);
  for (const q of ['Add the BOM creation step after article setup', 'Show me the validations applicable at every stage', 'Show this as a swimlane diagram', 'Remove the MRP step', 'Switch to the overview']) assert.equal(g.workflowKind(q, 'ask', true), 'modify', q);
  assert.equal(g.workflowKind('Show this as a swimlane diagram', 'ask', false), 'create', 'without a draft, a swimlane request starts a workflow');
  assert.equal(g.workflowKind('Compare the Sales Order workflow with the MRP workflow', 'ask', false), 'compare');
  assert.equal(g.workflowKind('Create the complete GRN workflow', 'ask', true), 'create', 'a new subject with a draft open is a new workflow, not an edit');
});

test('generation: documented process found; steps carry what the documentation says; nothing invented', () => {
  const r = g.resolve('Create a workflow for Sales Order processing.');
  assert.ok(r.graph && r.graph.nodes.length >= 8);
  const doc = g.newDoc(g.enrich(r.graph!), r.notes);
  const so = doc.graph.nodes.find((n) => /Create Sales Order/.test(n.label))!;
  assert.ok(so.rules!.length > 3 && so.inputs!.length && so.outputs!.length && so.dependencies!.length, 'rules, inputs, outputs, dependencies');
  assert.ok(so.validations!.length > 0, 'controls and approvals recorded for the sales order');
  assert.ok(doc.graph.references.some((x) => x.kind === 'rule') && doc.graph.module && doc.graph.relatedTransactions);
  assert.ok(doc.graph.nodes.every((n) => n.type === 'start' || n.type === 'end' || n.basis === 'documented' || n.id.startsWith('bbb_gate')), 'only documented steps (plus the labelled booking gateway)');
  const e2e = g.enrich(g.resolve('Make a workflow from techpack to production order').graph!);
  assert.ok(e2e.nodes.length >= 3 && e2e.nodes.some((n) => n.section || n.rules?.length || n.dependencies?.length), 'documented context attached');
  // a process written in the request is drawn, marked proposed
  const t = g.resolve('Convert this business process into a workflow: Merchandiser raises the indent, then planner approves it, then buyer creates the RMPO');
  assert.ok(t.graph!.nodes.filter((n) => n.type === 'activity').every((n) => n.basis === 'proposed'));
  // not documented / too vague: a clarification, never an empty graph
  for (const q of ['Create a workflow for weather forecasting', 'Generate a Kit/Pack process flow', 'Create a workflow']) { const x = g.resolve(q); assert.ok(!x.graph && x.clarify, q); }
});

test('the end-to-end flow keeps its phases as sections and its reference screens', () => {
  const full = g.enrich(d.graphFromEntry('WF-E2E-MATERIAL-FLOW')!);
  assert.ok(new Set(full.nodes.map((n) => n.section).filter(Boolean)).size >= 3);
  assert.ok(full.nodes.some((n) => n.images?.length), 'reference screens attached');
});

test('edits in plain language: add, rename, remove, overlays, formats; unknown commands change nothing', () => {
  let doc = g.newDoc(g.enrich(g.resolve('Create a workflow for Sales Order processing.').graph!));
  const n0 = doc.graph.nodes.length;
  const miss = g.applyCommand(doc, 'Add the BOM creation step after article setup');
  assert.equal(miss.ok, false); assert.match(miss.reply, /could not find a step like "article setup"/);
  let r = g.applyCommand(doc, 'Add the BOM creation step after Create Sales Order'); assert.ok(r.ok); doc = r.doc;
  const added = doc.graph.nodes.find((n) => n.label === 'BOM creation')!;
  assert.equal(added.basis, 'proposed'); assert.ok(added.rules!.length, 'the new step picks up the documented BOM rules');
  assert.equal(doc.graph.nodes.length, n0 + 1);
  assert.deepEqual(d.validate(doc.graph).filter((p) => p.level === 'error'), []);
  r = g.applyCommand(doc, 'Show me the validations applicable at every stage'); assert.ok(r.ok); doc = r.doc;
  assert.equal(doc.overlay, 'validations'); assert.match(r.reply, /Not documented for/);
  r = g.applyCommand(doc, 'Show this as a swimlane diagram'); doc = r.doc; assert.equal(doc.graph.format, 'swimlane');
  assert.equal(doc.graph.nodes.length, n0 + 1, 'same process, different picture');
  r = g.applyCommand(doc, 'Switch to the overview'); doc = r.doc; assert.equal(doc.detail, 'overview'); assert.ok(doc.collapsed.length);
  r = g.applyCommand(doc, 'Rename BOM creation to Create BOM'); doc = r.doc; assert.ok(doc.graph.nodes.some((n) => n.label === 'Create BOM'));
  r = g.applyCommand(doc, 'Remove the Create BOM step'); doc = r.doc; assert.equal(doc.graph.nodes.length, n0);
  assert.deepEqual(d.validate(doc.graph).filter((p) => p.level === 'error'), []);
  const same = g.applyCommand(doc, 'make the font bigger');
  assert.equal(same.ok, false); assert.deepEqual(same.doc, doc);
});

test('drafts: versions, undo, retry, details survive saving to the library; drafts are not knowledge', () => {
  const conv = createConversation(U).id;
  const doc = g.newDoc(g.enrich(g.resolve('Create the workflow for GRN').graph!));
  const dr = drafts.createDraft(U, conv, 'Create the workflow for GRN', doc);
  assert.equal(dr.version, 1); assert.equal(drafts.latestDraft(conv, U)!.id, dr.id);
  assert.throws(() => drafts.getDraft(dr.id, U + 1), /not found/, 'private to its owner');
  const before = dr.doc!.graph.format;
  const r = g.applyCommand(dr.doc!, 'Show this as a swimlane diagram');
  const v2 = drafts.updateDoc(dr.id, U, r.doc, 'Show this as a swimlane diagram');
  assert.equal(v2.version, 2); assert.equal(drafts.draftVersions(dr.id, U).length, 2);
  assert.equal(drafts.undo(dr.id, U).doc!.graph.format, before);
  assert.equal(drafts.getDraft(dr.id, U).version, 3, 'undo is a new version; nothing is lost');
  // a failed generation keeps the request and can be retried
  const bad = drafts.failDraft(U, conv, 'Create a workflow for Sales Order processing', 'boom');
  assert.equal(bad.state, 'failed'); assert.equal(bad.doc, null);
  assert.equal(drafts.retry(bad.id, U).state, 'ready');
  // saved to the library as a Draft entry: details round trip through TXT
  const saved = drafts.saveToLibrary(dr.id, U, 'tester', 'editor');
  const back = d.graphFromEntry(saved.entryId)!;
  assert.equal(back.status, 'Draft');
  const node = back.nodes.find((n) => n.rules?.length)!;
  assert.ok(node.rules![0].title && node.inputs?.length && back.references.length && back.module);
  assert.equal(drafts.draftView(dr.id, U).draft.approvalStatus, 'Draft');
  assert.throws(() => drafts.saveToLibrary(dr.id, U, 'v', 'viewer'), /cannot create/);
  // lifecycle: Draft → Under Review → Approved → Archived; archived is no longer current
  transition(saved.entryId, saved.version, 'Under Review', 'tester', 'editor');
  transition(saved.entryId, saved.version, 'Approved', 'boss', 'approver');
  transition(saved.entryId, saved.version, 'Archived', 'boss', 'approver');
  assert.equal(getEntry(saved.entryId)!.status, 'Archived');
  assert.equal(getEntry(saved.entryId)!.isCurrent, false);
});

test('chat: a workflow request becomes a linked draft with an open-workflow action; questions stay text', async () => {
  const conv = createConversation(U).id;
  const q = await postMessage(conv, U, 'Show me the complete MRP workflow.', 'ask', 'standard');
  const act = q.answer.answer!.action as unknown as { type: string; draftId: string; path: string };
  assert.equal(act.type, 'open-workflow'); assert.equal(act.path, '/workflow-designer');
  const draft = drafts.getDraft(act.draftId, U);
  assert.equal(draft.conversationId, conv); assert.equal(draft.request, 'Show me the complete MRP workflow.');
  assert.equal(q.answer.answer!.status, 'provisional', 'a generated workflow is never presented as approved');
  assert.ok(q.answer.answer!.sources.length);
  // edit by chat in the same conversation changes the same draft
  const e = await postMessage(conv, U, 'Show this as a swimlane diagram', 'ask', 'standard');
  assert.equal((e.answer.answer!.action as unknown as { draftId: string }).draftId, act.draftId);
  assert.equal(drafts.getDraft(act.draftId, U).doc!.graph.format, 'swimlane');
  assert.equal(drafts.getDraft(act.draftId, U).version, 2);
  // ordinary questions and not-documented requests do not navigate
  const t = await postMessage(conv, U, 'How does the MRP workflow work?', 'ask', 'standard');
  assert.equal(t.answer.answer!.action, undefined);
  const n = await postMessage(createConversation(U).id, U, 'Create a workflow for weather forecasting', 'ask', 'standard');
  assert.equal(n.answer.answer!.action, undefined); assert.equal(n.answer.answer!.status, 'partial');
  assert.ok(getConversation(conv, U).messages.length >= 6, 'the conversation keeps every exchange');
  // compare keeps both names and the changes
  const c = await postMessage(createConversation(U).id, U, 'Compare the Sales Order workflow with the MRP workflow', 'ask', 'standard');
  const cd = drafts.getDraft((c.answer.answer!.action as unknown as { draftId: string }).draftId, U);
  assert.ok(cd.doc!.compare && cd.doc!.compare.with);
});
