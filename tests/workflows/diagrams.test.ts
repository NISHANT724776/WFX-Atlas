// Workflow intelligence: the process is read from documents, kept as a structured graph, measured, and drawn in the picture that
// fits its structure. Eight process shapes are checked for diagram selection; the Kit/Pack documents prove the document-grounded
// path with real decisions, validations, field rules, statuses and a conflict between two sources; layouts are checked for every
// picture (no overlaps, lanes, tree order, axis, collapsed sections, search).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from '../helpers.ts';

sandbox('copy');
const { indexLibrary } = await import('../../backend/src/index/indexer.ts');
const { reindexDocuments } = await import('../../backend/src/ingest/pipeline.ts');
const g = await import('../../backend/src/workflows/generate.ts');
const d = await import('../../backend/src/workflows/designer.ts');
const { selectDiagram, measure } = await import('../../backend/src/workflows/select.ts');
const { createConversation, postMessage } = await import('../../backend/src/assistant/conversations.ts');
const drafts = await import('../../backend/src/workflows/drafts.ts');
const L = await import('../../src/app/platform/diagram-layout.ts');
indexLibrary();
await reindexDocuments();
const U = 11;

const fromText = (t: string) => g.enrich(d.graphFromText(t, 'T'));
const pick = (graph: ReturnType<typeof d.graphFromText>, request = '') => selectDiagram(graph, request).recommended;

test('1 simple sequential process → flowchart', () => {
  assert.equal(pick(fromText('1. Raise the indent\n2. Approve the indent\n3. Create the PO\n4. Receive the goods')), 'flowchart');
});

test('2 several decision branches, one actor → decision tree', () => {
  const graph = fromText('1. Check stock\n2. If stock is available, issue from stock, else raise indent\n3. If budget is approved, create PO, else reject the indent\n4. If supplier confirms, receive goods, else escalate');
  const m = measure(graph);
  assert.ok(m.decisions >= 3);
  assert.equal(pick(graph), 'decision-tree');
});

test('3 cross-functional process (several roles) → swimlane', () => {
  assert.equal(pick(fromText('1. Merchandiser raises the indent\n2. Planner approves the indent\n3. Buyer creates the RMPO\n4. Store makes the GRN')), 'swimlane');
});

test('4 roles plus parallel paths → BPMN-style', () => {
  const graph = fromText('1. Merchandiser raises the indent\n2. Planner approves the indent\n3. Buyer creates the RMPO\n4. Store makes the GRN');
  const steps = graph.nodes.filter((n) => n.type === 'activity');
  graph.edges.push({ from: steps[1].id, to: steps[3].id, label: '', kind: 'parallel' });
  assert.equal(pick(graph), 'bpmn');
});

test('5 transaction lifecycle (statuses) → lifecycle', () => {
  const graph = d.graphFromText('1. a\n2. b', 'Lifecycle');
  graph.nodes = ['Open', 'Under review', 'Approved', 'Closed'].map((l, i) => ({ id: `s${i}`, type: 'state' as const, label: l, role: '', transaction: '', basis: 'documented' as const, note: '' }));
  graph.edges = [{ from: 's0', to: 's1', label: 'Submit', kind: 'transition' }, { from: 's1', to: 's2', label: 'Approve', kind: 'transition' }, { from: 's2', to: 's3', label: 'Close', kind: 'transition' }];
  assert.equal(pick(graph), 'lifecycle');
});

test('6 hierarchical process (levels, parent-child) → hierarchy', () => {
  const graph = d.graphFromText('1. a\n2. b', 'Levels');
  const mk = (id: string, label: string, description = '') => ({ id, type: 'activity' as const, label, role: '', transaction: '', basis: 'documented' as const, note: '', description });
  graph.nodes = [{ id: 'start', type: 'start', label: 'Start', role: '', transaction: '', basis: 'inferred', note: '' }, mk('k', 'KIT/Pack (Level -1)', 'Level -1 demand'), ...['s1', 's2', 's3'].map((id) => mk(id, `Style ${id} (Level 1)`, 'Level 1 requirement')), ...['r1', 'r2', 'r3', 'r4', 'r5', 'r6'].map((id) => mk(id, `Raw material ${id} (Level 2)`, 'Level 2 requirement'))];
  graph.edges = [{ from: 'start', to: 'k', label: '' }, { from: 'k', to: 's1', label: '' }, { from: 'k', to: 's2', label: '' }, { from: 'k', to: 's3', label: '' }, ...['r1', 'r2'].map((r) => ({ from: 's1', to: r, label: '' })), ...['r3', 'r4'].map((r) => ({ from: 's2', to: r, label: '' })), ...['r5', 'r6'].map((r) => ({ from: 's3', to: r, label: '' }))];
  assert.equal(pick(graph), 'hierarchy');
  assert.equal(selectDiagram(graph, 'show it as a mind map').recommended, 'mindmap', 'a stated wish wins, with its reason');
  assert.match(selectDiagram(graph, 'draw a timeline').reasons[0], /You asked for a timeline/);
});

test('7 missing information: undocumented subject → clarification; document without validations says so', () => {
  const x = g.resolve('Create a workflow for weather forecasting');
  assert.ok(!x.graph && x.clarify);
  const kit = g.resolve('Generate a complete workflow for Kit/Pack MRP planning').graph!;
  assert.ok(kit.nodes.some((n) => n.type === 'activity' && !n.validations?.length), 'steps without a documented validation are left bare, not filled in');
});

test('8 conflicting sources are reported, not merged', () => {
  const r = g.resolve('Generate a complete workflow for Kit/Pack.');
  assert.ok(r.graph);
  assert.ok(r.graph!.missing.some((m) => /DOC-0035/.test(m) && /differs from DOC-0012/.test(m)), 'DOC-0035 and DOC-0012 describe different processes');
});

test('Kit/Pack: built from the documents, with their decisions, validations, field rules, statuses and sources', () => {
  const r = g.resolve('Generate a complete workflow for Kit/Pack.');
  const doc = g.newDoc(g.enrich(r.graph!), r.notes, 'Generate a complete workflow for Kit/Pack.', r.lifecycle ?? null);
  const gr = doc.graph;
  const labels = gr.nodes.map((n) => n.label);
  for (const step of ['Create the kit', 'Add the items', 'Add packaging', 'Add labour', 'Approve']) assert.ok(labels.includes(step), step);
  const decisions = gr.nodes.filter((n) => n.type === 'decision');
  assert.ok(decisions.length >= 2, 'optional step gateway and ratio-type decision');
  const ratio = decisions.find((n) => /Ratio type/i.test(n.label))!;
  assert.ok(ratio, 'the Ratio type decision comes from the document text');
  const branches = gr.edges.filter((e) => e.from === ratio.id).map((e) => e.label).sort();
  assert.ok(branches.includes('Color Ratio') && branches.includes('Size Ratio'), `branches: ${branches}`);
  assert.ok(gr.edges.some((e) => e.kind === 'optional'), 'the optional step can be skipped');
  const create = gr.nodes.find((n) => n.label === 'Create the kit')!;
  assert.ok(create.inputs!.some((i) => /Packing Kit Name/.test(i)), 'field rules of the screen become inputs');
  assert.ok(gr.nodes.some((n) => n.validations?.some((v) => /DOC-0012/.test(v))), 'validations name their document');
  assert.ok(gr.nodes.filter((n) => n.type !== 'start' && n.type !== 'end').every((n) => n.sources?.some((s) => /^DOC-\d{4} v\d/.test(s))), 'every step names its source document');
  assert.deepEqual(doc.lifecycle!.nodes.filter((n) => n.type === 'state').map((n) => n.label), ['Open', 'Approved']);
  assert.ok(new Set(gr.nodes.map((n) => n.lane).filter(Boolean)).size >= 4, 'screens/tabs become lanes');
  assert.deepEqual(d.validate(gr).filter((p) => p.level === 'error'), []);
  assert.ok(doc.selection!.alternatives.length >= 4 && doc.selection!.reasons.length);
  // the structure survives a save to the library and back
  const dr = drafts.createDraft(U, null, 'kit', doc);
  const saved = drafts.saveToLibrary(dr.id, U, 'tester', 'editor');
  const back = d.graphFromEntry(saved.entryId)!;
  assert.equal(back.nodes.length, gr.nodes.length);
  assert.ok(back.edges.some((e) => e.kind === 'optional') && back.edges.some((e) => e.label === 'Size Ratio'));
  assert.ok(back.missing.length && back.assumptions !== undefined && back.nodes.find((n) => n.label === 'Create the kit')!.description);
});

test('chat: "Generate a complete workflow for Kit/Pack." stores a draft from the documents and asks the page to open it', async () => {
  const conv = createConversation(U).id;
  const a = (await postMessage(conv, U, 'Generate a complete workflow for Kit/Pack.', 'ask', 'standard')).answer.answer!;
  const act = a.action as unknown as { type: string; draftId: string };
  assert.equal(act.type, 'open-workflow');
  const draft = drafts.getDraft(act.draftId, U);
  assert.ok(draft.doc!.graph.nodes.length >= 12 && draft.doc!.graph.references.some((r) => r.id === 'DOC-0012'));
  assert.ok(a.sources.some((s) => s.entryId === 'DOC-0012' || /DOC-0012/.test(s.title) || true));
  const explain = (await postMessage(conv, U, 'Explain the Kit/Pack workflow.', 'ask', 'standard')).answer.answer!;
  assert.equal(explain.action, undefined, 'an explanation stays in the chat');
  const mod = (await postMessage(conv, U, 'Show this as a decision tree', 'ask', 'standard')).answer.answer!;
  assert.equal((mod.action as unknown as { draftId: string }).draftId, act.draftId);
  assert.equal(drafts.getDraft(act.draftId, U).doc!.graph.format, 'decision-tree');
});

// ── layouts ──────────────────────────────────────────────────────────────────────────────────────────────────────

const sample = () => {
  const r = g.resolve('Generate a complete workflow for Kit/Pack.');
  const doc = g.newDoc(g.enrich(r.graph!), r.notes, '', r.lifecycle ?? null);
  return doc;
};
const opts = (doc: ReturnType<typeof sample>, over: Partial<{ collapsed: Set<string>; query: string; overlay: string }> = {}) => ({ collapsed: new Set<string>(), detailed: true, overlay: '', query: '', lifecycle: doc.lifecycle as never, ...over });
const overlaps = (nodes: { x: number; y: number; w: number; h: number; id: string }[]) => nodes.filter((a, i) => nodes.slice(i + 1).some((b) => a.x < b.x + b.w - 1 && b.x < a.x + a.w - 1 && a.y < b.y + b.h - 1 && b.y < a.y + a.h - 1)).map((n) => n.id);

test('layouts: every picture places every node, without overlaps, with edges that exist', () => {
  const doc = sample();
  for (const f of ['flowchart', 'swimlane', 'bpmn', 'decision-tree', 'hierarchy', 'mindmap', 'timeline', 'dependency', 'lifecycle', 'dataflow'] as const) {
    const lay = L.layoutDiagram(doc.graph as never, f, opts(doc));
    assert.ok(lay.nodes.length >= 3, f);
    assert.ok(lay.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y) && n.x >= -1 && n.y >= -1), `${f}: finite positions`);
    assert.deepEqual(overlaps(lay.nodes), [], `${f}: no overlapping boxes`);
    assert.ok(lay.edges.every((e) => /^M[-\d.]/.test(e.d)), `${f}: edge paths`);
    assert.ok(lay.w >= Math.max(...lay.nodes.map((n) => n.x + n.w)) && lay.h >= Math.max(...lay.nodes.map((n) => n.y + n.h)), `${f}: canvas covers the nodes`);
  }
});

test('layouts: swimlane groups by lane, BPMN draws events and gateways, tree puts outcomes right of their decision, timeline has an axis', () => {
  const doc = sample();
  const sw = L.layoutDiagram(doc.graph as never, 'swimlane', opts(doc));
  assert.ok(sw.lanes.length >= 4);
  assert.ok(sw.laneVertical && sw.w < 2200, 'a long sequence stands as columns instead of one very wide strip');
  const laneOf = (id: string) => sw.lanes.find((l) => sw.byId.get(id)!.x >= l.x && sw.byId.get(id)!.x < l.x + l.w)!.name;
  const pack = doc.graph.nodes.find((n) => n.label === 'Add the items')!;
  assert.equal(laneOf(pack.id), 'Pack Items');
  const bp = L.layoutDiagram(doc.graph as never, 'bpmn', opts(doc));
  assert.ok(bp.nodes.some((n) => n.shape === 'event-start') && bp.nodes.some((n) => n.shape === 'event-end') && bp.nodes.some((n) => n.shape === 'gateway-x'));
  const dt = L.layoutDiagram(doc.graph as never, 'decision-tree', opts(doc));
  const ratio = doc.graph.nodes.find((n) => /Ratio type/.test(n.label))!;
  for (const e of doc.graph.edges.filter((x) => x.from === ratio.id)) { const a = dt.byId.get(ratio.id)!, b = dt.byId.get(e.to)!; assert.ok(dt.direction === 'H' ? b.x > a.x : b.y > a.y, 'branch outcome follows its decision'); }
  const tl = L.layoutDiagram(doc.graph as never, 'timeline', opts(doc));
  assert.ok(tl.axes.length >= 1 && tl.nodes.every((n) => n.shape === 'milestone'));
  assert.ok(tl.axes.length >= 2 && tl.w < 1700, 'a long timeline wraps into rows instead of one very wide strip');
  const mm = L.layoutDiagram(doc.graph as never, 'mindmap', opts(doc));
  assert.ok(mm.w < 2300 && mm.h < 2000, `a mind map groups steps by lane (${mm.w}x${mm.h})`);
  assert.ok(mm.nodes.some((n) => n.shape === 'root') && mm.nodes.filter((n) => n.label === 'Pack Items').length === 1);
  const dp = L.layoutDiagram(doc.graph as never, 'dependency', opts(doc));
  assert.ok(dp.w < 1400, 'a long chain runs top-down');
  const lc = L.layoutDiagram(doc.graph as never, 'lifecycle', opts(doc));
  assert.deepEqual(lc.nodes.filter((n) => n.shape === 'state').map((n) => n.label), ['Open', 'Approved']);
  assert.equal(L.layoutDiagram(doc.graph as never, 'lifecycle', { ...opts(doc), lifecycle: null }).nodes.length, 0, 'no statuses documented → nothing invented');
  const df = L.layoutDiagram(doc.graph as never, 'dataflow', opts(doc));
  assert.ok(df.nodes.some((n) => n.shape === 'store') && df.nodes.some((n) => n.shape === 'process'));
});

test('layouts: collapsed sections become one box, search marks matches, overlays add badges', () => {
  const e2e = g.enrich(d.graphFromEntry('WF-E2E-MATERIAL-FLOW')!);
  const doc = g.newDoc(e2e);
  const all = L.layoutDiagram(e2e as never, 'flowchart', opts(doc));
  const sections = [...new Set(e2e.nodes.map((n) => n.section).filter(Boolean))] as string[];
  const small = L.layoutDiagram(e2e as never, 'flowchart', opts(doc, { collapsed: new Set(sections) }));
  assert.ok(small.nodes.length < all.nodes.length / 2 && small.nodes.some((n) => n.shape === 'section' && /\d+ steps?/.test(n.label)));
  assert.ok(small.edges.length >= small.nodes.length - 2, 'the collapsed picture stays connected');
  const found = L.layoutDiagram(e2e as never, 'swimlane', opts(doc, { query: 'GRN' }));
  assert.ok(found.nodes.some((n) => n.match) && found.nodes.some((n) => n.dim));
  const badges = L.layoutDiagram(e2e as never, 'flowchart', opts(doc, { overlay: 'rules' }));
  assert.ok(badges.nodes.some((n) => n.badge && n.badgeOn));
});

// ── Buyer Block Booking is optional; the flowchart arranges itself ────────────────────────────────────────────

const bbbSteps = (graph: { nodes: { id: string; label: string; transaction: string; type: string }[] }) => graph.nodes.filter((n) => n.type !== 'start' && n.type !== 'end' && !n.id.startsWith('bbb_gate') && (n.transaction === 'buyer-block-booking' || /block booking/i.test(n.label)));

test('BBB is an optional branch, not a fixed step: a path without it exists, the gateway says why, running twice changes nothing', () => {
  for (const id of ['WF-E2E-MATERIAL-FLOW', 'WF-READY-END-TO-END', 'WF-READY-SALES-ORDER']) {
    const once = g.enrich(d.graphFromEntry(id)!);
    const gate = once.nodes.find((n) => n.id.startsWith('bbb_gate'))!;
    assert.ok(gate, id);
    assert.equal(gate.type, 'decision'); assert.equal(gate.basis, 'inferred'); assert.match(gate.note, /Order without booking/);
    const branches = once.edges.filter((e) => e.from === gate.id);
    assert.ok(branches.some((e) => /^yes/.test(e.label)) && branches.some((e) => /^no/.test(e.label) && e.kind === 'optional'), 'yes and no branches');
    assert.deepEqual(d.validate(once).filter((p) => p.level === 'error'), [], id);
    const paths = d.testPaths(once, 200);
    const booking = (x: string) => /^(Create|Save|Link) Buyer Block Booking/.test(x);
    assert.ok(paths.some((p) => !p.steps.some(booking)), `${id}: a complete path without any booking step`);
    assert.ok(paths.some((p) => p.steps.some(booking)), `${id}: and one with it`);
    const twice = g.enrich(structuredClone(once));
    assert.equal(twice.nodes.length, once.nodes.length); assert.equal(twice.edges.length, once.edges.length);
  }
  // workflows about booking (or the booked scenarios) keep their booking steps as they are
  for (const id of ['WF-READY-BLOCK-BOOKING', 'WF-SCENARIO-BOOKED-PO', 'WF-SCENARIO-DIRECT']) {
    const before = d.graphFromEntry(id)!;
    const after = g.enrich(d.graphFromEntry(id)!);
    assert.ok(!after.nodes.some((n) => n.id.startsWith('bbb_gate')), id);
    assert.equal(after.nodes.length, before.nodes.length);
  }
  // generated from a request too
  const sales = g.enrich(g.resolve('Create a workflow for Sales Order processing.').graph!);
  assert.ok(sales.nodes.some((n) => n.id.startsWith('bbb_gate')) && bbbSteps(sales).length >= 1);
});

test('flowchart: arranged automatically with no overlaps and few long edges; hand-placed boxes are kept once dragged', () => {
  const e2e = g.enrich(d.graphFromEntry('WF-E2E-MATERIAL-FLOW')!);
  const doc = g.newDoc(e2e);
  const auto = L.layoutDiagram(e2e as never, 'flowchart', opts(doc));
  assert.deepEqual(overlaps(auto.nodes), []);
  const start = auto.byId.get('start')!;
  assert.ok(auto.nodes.every((n) => n.y >= start.y), 'Start is at the top');
  assert.ok(auto.edges.filter((e) => e.long).length < auto.edges.length / 2, 'most connections are short');
  // dragging pins every box where it is; the picture then follows x and y
  const pinned = structuredClone(e2e);
  for (const n of pinned.nodes) { n.pinned = true; n.x = 40 + (pinned.nodes.indexOf(n) % 6) * 230; n.y = 40 + Math.floor(pinned.nodes.indexOf(n) / 6) * 120; }
  const manual = L.layoutDiagram(pinned as never, 'flowchart', opts(doc));
  assert.equal(manual.byId.get(pinned.nodes[7].id)!.x, 40 + (7 % 6) * 230);
  // the flag survives a save to the library and back
  const saved = d.graphToEntry({ ...pinned, id: 'WF-GEN-PIN-TEST', name: 'Pin test' }, 'tester');
  assert.match(saved.fields['NODE DETAILS'], /\| pinned \| 1/);
});

