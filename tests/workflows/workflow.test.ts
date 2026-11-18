// Workflow structure: Mermaid parsing (nodes, edges, decisions, labels, start/end, problems), generation round trip,
// and the migrated end-to-end flow (valid references, no cycles, every step reachable from a start).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from '../helpers.ts';
import { diagramText, parseMermaid, toMermaid } from '../../backend/src/ingest/diagram.ts';

test('flowchart: shapes, decisions, labelled and chained edges, parallel (&), subgraphs, start and end', () => {
  const d = parseMermaid(`flowchart LR
    A([Start]) --> B[Create RMPO]
    B --> C{Supplier portal enabled?}
    C -- Yes --> D[Send to portal] --> F[Approved]
    C -->|No| E[Approve internally]
    E & D --> F
    subgraph Receiving
      F --> G[(GRN)]
    end
    G --> H((End))`);
  assert.equal(d.kind, 'flowchart');
  assert.equal(d.direction, 'LR');
  assert.equal(d.nodes.find((n) => n.id === 'C')!.type, 'decision');
  assert.ok(d.edges.some((e) => e.from === 'C' && e.to === 'D' && e.label === 'Yes'));
  assert.ok(d.edges.some((e) => e.from === 'C' && e.to === 'E' && e.label === 'No'));
  assert.ok(d.edges.some((e) => e.from === 'D' && e.to === 'F'));
  assert.ok(d.edges.some((e) => e.from === 'E' && e.to === 'F'));
  assert.deepEqual(d.starts, ['A']);
  assert.deepEqual(d.ends, ['H']);
  assert.equal(d.groups[0].nodes.includes('G'), true);
  assert.deepEqual(d.problems, []);
  assert.match(diagramText(d), /Decisions: Supplier portal enabled\?/);
});

test('problems are reported: loops without a start, unconnected nodes', () => {
  const loop = parseMermaid('graph TD\nA --> B\nB --> A');
  assert.ok(loop.problems.some((p) => /No start node/.test(p)));
  const lonely = parseMermaid('graph TD\nA --> B\nC[Orphan]');
  assert.ok(lonely.problems.some((p) => /Unconnected nodes: C/.test(p)));
});

test('state, sequence and ER diagrams keep their structure', () => {
  const s = parseMermaid('stateDiagram-v2\n[*] --> Draft\nDraft --> Approved : approve\nApproved --> [*]');
  assert.deepEqual([s.kind, s.starts[0], s.ends[0]], ['state', 'START', 'END']);
  const q = parseMermaid('sequenceDiagram\nparticipant U as User\nU->>WFX: Save RMPO\nWFX-->>U: Saved');
  assert.equal(q.edges.length, 2);
  const er = parseMermaid('erDiagram\nRMPO ||--o{ RMPO_LINE : contains\nRMPO_LINE {\n string colour\n}');
  assert.ok(er.edges.some((e) => e.from === 'RMPO' && e.to === 'RMPO_LINE'));
});

test('generated Mermaid parses back to the same nodes and edges', () => {
  const nodes = [{ id: 'start', label: 'Start', type: 'start' }, { id: 's1', label: 'Raise indent', type: 'activity' }, { id: 'q', label: 'Stock available?', type: 'decision' }, { id: 'end', label: 'End', type: 'end' }];
  const edges = [{ from: 'start', to: 's1' }, { from: 's1', to: 'q' }, { from: 'q', to: 'end', label: 'yes' }];
  const back = parseMermaid(toMermaid(nodes, edges));
  assert.equal(back.nodes.length, 4);
  assert.equal(back.edges.length, 3);
  assert.equal(back.nodes.find((n) => n.id === 'q')!.type, 'decision');
  // reserved Mermaid words are prefixed so real renderers accept them ("end" becomes "n_end")
  assert.deepEqual([back.starts, back.ends], [['start'], ['n_end']]);
  assert.equal(back.nodes.find((n) => n.id === 'n_end')!.label, 'End');
});

test('the migrated end-to-end flow: valid references, no cycles, every step reachable', () => {
  const flow = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'workflows', 'end_to_end_flow.json'), 'utf8')) as { nodes: { id: string }[]; edges: { from: string; to: string }[] };
  const ids = new Set(flow.nodes.map((n) => n.id));
  for (const e of flow.edges) { assert.ok(ids.has(e.from), e.from); assert.ok(ids.has(e.to), e.to); }
  // cycle check (depth-first)
  const out = new Map<string, string[]>();
  for (const e of flow.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const state = new Map<string, number>();
  const visit = (n: string): void => { state.set(n, 1); for (const m of out.get(n) ?? []) { assert.notEqual(state.get(m), 1, `cycle through ${m}`); if (!state.get(m)) visit(m); } state.set(n, 2); };
  for (const n of ids) if (!state.get(n)) visit(n);
  // nodes with prerequisites are reachable from steps without prerequisites
  const hasIn = new Set(flow.edges.map((e) => e.to));
  const seen = new Set<string>();
  const stack = [...ids].filter((n) => !hasIn.has(n));
  while (stack.length) { const n = stack.pop()!; if (seen.has(n)) continue; seen.add(n); stack.push(...(out.get(n) ?? [])); }
  assert.equal(seen.size, ids.size);
  const mmd = parseMermaid(fs.readFileSync(path.join(ROOT, 'knowledge', 'workflows', 'end_to_end_flow.mmd'), 'utf8'));
  assert.equal(mmd.edges.length, flow.edges.length);
});
