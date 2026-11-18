// Workflow designer: graphs from stored workflows and procedures, from text and Mermaid, validation, test paths,
// saving as a versioned entry, comparing versions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from '../helpers.ts';

sandbox('copy');
const { indexLibrary } = await import('../../backend/src/index/indexer.ts');
const d = await import('../../backend/src/workflows/designer.ts');
const { saveDraft, transition } = await import('../../backend/src/rules/rules.ts');
indexLibrary();

test('stored end-to-end flow: documented steps and prerequisite links, inferred start/end, valid', () => {
  const g = d.graphFromEntry('WF-E2E-MATERIAL-FLOW')!;
  assert.ok(g.nodes.filter((n) => n.basis === 'documented').length >= 30);
  assert.deepEqual(g.nodes.filter((n) => n.basis === 'inferred').map((n) => n.type).sort(), ['end', 'start']);
  assert.deepEqual(d.validate(g).filter((p) => p.level === 'error'), []);
  assert.ok(d.testPaths(g).length >= 2);
  assert.ok(g.nodes.every((n) => Number.isFinite(n.x) && Number.isFinite(n.y)), 'laid out');
});

test('procedure steps become a linear documented flow', () => {
  const g = d.graphFromEntry('PROC-INVENTORY-WMS-DISPATCH')!;
  assert.ok(g.nodes.length >= 4);
  assert.match(g.basisNote, /in this order/);
  assert.equal(d.testPaths(g).length, 1);
});

test('text: decisions with yes/no branches, roles, everything marked proposed', () => {
  const g = d.graphFromText('1. Merchandiser raises the indent\n2. If stock is available, do in-house adjustment, else create RMPO\n3. Store makes the GRN', 'Indent to GRN');
  const dec = g.nodes.find((n) => n.type === 'decision')!;
  assert.equal(dec.label, 'stock is available?');
  assert.deepEqual(g.edges.filter((e) => e.from === dec.id).map((e) => e.label).sort(), ['no', 'yes']);
  assert.equal(g.nodes.find((n) => n.label.startsWith('Merchandiser'))!.role, 'Merchandiser');
  assert.ok(g.nodes.filter((n) => n.type === 'activity').every((n) => n.basis === 'proposed'));
  assert.deepEqual(d.validate(g).filter((p) => p.level === 'error'), []);
  assert.deepEqual(d.testPaths(g).map((p) => p.name).sort(), ['stock is available? → no', 'stock is available? → yes']);
});

test('Mermaid input keeps decisions and conditions', () => {
  const g = d.graphFromText('flowchart LR\nA([Start]) --> B{Approved?}\nB -- yes --> C[Create PO]\nB -- no --> D([End])\nC --> D');
  assert.equal(g.direction, 'LR');
  assert.ok(g.edges.some((e) => e.label === 'yes'));
  assert.deepEqual(d.validate(g).filter((p) => p.level === 'error'), []);
});

test('validation finds missing start/end, dead ends, unreachable steps, one-branch decisions, loops', () => {
  const g = { ...d.graphFromText('a\nb'), nodes: [] as never[], edges: [] as never[] };
  g.nodes.push({ id: 's', type: 'start', label: 'Start', role: '', transaction: '', basis: 'inferred', note: '' } as never, { id: 'a', type: 'activity', label: 'A', role: '', transaction: '', basis: 'proposed', note: '' } as never, { id: 'q', type: 'decision', label: 'Q?', role: '', transaction: '', basis: 'proposed', note: '' } as never, { id: 'z', type: 'activity', label: 'Z', role: '', transaction: '', basis: 'proposed', note: '' } as never);
  g.edges.push({ from: 's', to: 'a', label: '' } as never, { from: 'a', to: 'q', label: '' } as never, { from: 'q', to: 'a', label: '' } as never);
  const msgs = d.validate(g).map((p) => p.message).join('\n');
  assert.match(msgs, /no End node/);
  assert.match(msgs, /Not reachable from Start: Z/);
  assert.match(msgs, /Dead end/);
  assert.match(msgs, /needs at least two branches/);
  assert.match(msgs, /Loops/);
});

test('save as a versioned entry, reload with positions, compare versions', () => {
  const g = d.graphFromText('Raise indent\nIf approved then create PO\nSend PO', 'Indent approval flow');
  const v1 = saveDraft(d.graphToEntry(g, 'tester'), 'tester', 'editor');
  assert.equal(v1.version, 1);
  transition(v1.id, 1, 'Active', 'approver', 'approver');
  const back = d.graphFromEntry(v1.id)!;
  assert.equal(back.nodes.length, g.nodes.length);
  assert.equal(back.nodes.find((n) => n.type === 'decision')!.x, g.nodes.find((n) => n.type === 'decision')!.x);
  back.nodes.find((n) => n.label === 'Send PO')!.label = 'Send PO to supplier';
  back.edges.push({ from: back.nodes.find((n) => n.type === 'decision')!.id, to: back.nodes.find((n) => n.type === 'end')!.id, label: 'rejected' });
  const v2 = saveDraft(d.graphToEntry(back, 'tester'), 'tester', 'editor');
  assert.equal(v2.version, 2);
  const c = d.diff(d.graphFromEntry(v1.id, 1)!, d.graphFromEntry(v1.id, 2)!);
  assert.deepEqual(c.nodesChanged, ['Send PO → Send PO to supplier']);
  assert.equal(c.edgesAdded.length, 1);
  assert.match(d.graphToMermaid(back), /n_end|finish/);
});
