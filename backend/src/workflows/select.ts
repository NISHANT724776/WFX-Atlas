// Diagram selection. A process is measured (steps, decisions, roles/lanes, parallel paths, transactions, states, depth, how
// tree-shaped it is, time cues, how much data moves) and the picture that fits what was measured is recommended, with the reason.
// The other pictures that make sense for the same structure are listed too: one process can need several views, and every view
// is drawn from the same nodes and edges, so switching never changes the business logic.
import type { Format, Graph } from './designer.ts';

export interface Metrics {
  activities: number; decisions: number; roles: number; lanes: number; parallel: number; transactions: number; states: number;
  maxBranching: number; depth: number; treeShaped: boolean; hasLoop: boolean; timeCues: number; levelCue: boolean; dataLinks: number; images: number; edges: number;
}
export interface Selection { recommended: Format; reasons: string[]; alternatives: { format: Format; reason: string }[]; metrics: Metrics; requested: Format | null }

const WANTS: [RegExp, Format][] = [
  [/\bbpmn\b/i, 'bpmn'], [/\bswim ?lanes?\b|\bcross[- ]functional\b/i, 'swimlane'], [/\bdecision trees?\b/i, 'decision-tree'],
  [/\b(state|status) (transition|diagram|machine)\b|\blife ?cycle\b/i, 'lifecycle'], [/\btime ?lines?\b|\bgantt\b/i, 'timeline'],
  [/\bhierarch(y|ical)\b|\borg chart\b|\btree diagram\b/i, 'hierarchy'], [/\bmind ?maps?\b/i, 'mindmap'],
  [/\bdependenc(y|ies) (graph|map|diagram)\b/i, 'dependency'], [/\bdata ?flows?\b/i, 'dataflow'], [/\b(illustrated|visual) (process )?guide\b|\bstep[- ]by[- ]step guide\b/i, 'guide'],
  [/\bflow ?chart\b/i, 'flowchart'],
];

export function measure(g: Graph, hasLifecycle = false): Metrics {
  const steps = g.nodes.filter((n) => n.type !== 'start' && n.type !== 'end');
  const out = new Map<string, string[]>(), inc = new Map<string, number>();
  for (const e of g.edges) { out.set(e.from, [...(out.get(e.from) ?? []), e.to]); inc.set(e.to, (inc.get(e.to) ?? 0) + 1); }
  // depth: longest path from a start (loops cut)
  const rank = new Map<string, number>();
  const q = g.nodes.filter((n) => !inc.get(n.id)).map((n) => n.id);
  for (const s of q) rank.set(s, 0);
  let guard = 0;
  while (q.length && guard++ < 6000) { const x = q.shift()!; for (const m of out.get(x) ?? []) { const l = (rank.get(x) ?? 0) + 1; if ((rank.get(m) ?? -1) < l && l < g.nodes.length) { rank.set(m, l); q.push(m); } } }
  const state = new Map<string, number>(); let loop = false;
  const walk = (n: string) => { state.set(n, 1); for (const m of out.get(n) ?? []) { if (state.get(m) === 1) loop = true; else if (!state.get(m)) walk(m); } state.set(n, 2); };
  for (const n of g.nodes.filter((x) => !inc.get(x.id))) if (!state.get(n.id)) walk(n.id);
  const text = steps.map((n) => `${n.label} ${n.description ?? ''}`).join(' ');
  const roles = new Set(steps.map((n) => n.role).filter(Boolean));
  const lanes = new Set(steps.map((n) => n.lane || n.role).filter(Boolean));
  return {
    activities: steps.filter((n) => n.type === 'activity' || n.type === 'exception').length,
    decisions: steps.filter((n) => n.type === 'decision').length,
    roles: roles.size, lanes: lanes.size,
    parallel: steps.filter((n) => n.type === 'parallel').length + g.edges.filter((e) => e.kind === 'parallel').length,
    transactions: new Set(steps.map((n) => n.transaction).filter(Boolean)).size,
    states: steps.filter((n) => n.type === 'state').length + (hasLifecycle ? 2 : 0),
    maxBranching: Math.max(0, ...[...out.values()].map((v) => v.length)),
    depth: Math.max(0, ...rank.values()),
    treeShaped: g.nodes.length > 2 && g.nodes.every((n) => (inc.get(n.id) ?? 0) <= 1),
    hasLoop: loop,
    timeCues: (text.match(/\b(days?|weeks?|hours?|deadline|tat|due date|schedule[ds]?|within \d+)\b/gi) ?? []).length,
    levelCue: /\blevel\s*[-‑]?\d\b.*\blevel\s*[-‑]?\d\b/i.test(text) || /\b(parent|child|master|sub-?\w+)\b.*\b(child|sub-?\w+|master)\b/i.test(text),
    dataLinks: steps.filter((n) => (n.inputs?.length ?? 0) > 0 && (n.outputs?.length ?? 0) > 0).length,
    images: steps.reduce((a, n) => a + (n.images?.length ?? 0), 0) + g.relatedDocuments.filter((r) => r.kind === 'image').length,
    edges: g.edges.length,
  };
}

/** Recommends one picture for the structure, explains why, and lists the other pictures that suit it. */
export function selectDiagram(g: Graph, request = '', hasLifecycle = false): Selection {
  const m = measure(g, hasLifecycle);
  const reasons: string[] = [];
  let rec: Format = 'flowchart';
  const wanted = WANTS.find(([re]) => re.test(request))?.[1] ?? null;
  const txnNodes = g.nodes.filter((n) => n.transaction).length;
  const multiLane = Math.max(m.roles, m.lanes) >= 2;
  if (wanted && (wanted !== 'lifecycle' || hasLifecycle)) { rec = wanted; reasons.push(`You asked for a ${wanted.replace('-', ' ')}.`); }
  else if (m.states >= 3 && m.decisions === 0 && g.nodes.some((n) => n.type === 'state')) { rec = 'lifecycle'; reasons.push(`The process is a sequence of ${m.states} statuses with transitions between them.`); }
  else if (m.decisions >= 3 && m.decisions / Math.max(1, m.activities + m.decisions) >= 0.3 && !multiLane) { rec = 'decision-tree'; reasons.push(`${m.decisions} of ${m.activities + m.decisions} steps are decisions, so the outcomes of each condition matter more than the order.`); }
  else if (multiLane && (m.parallel >= 1 || m.decisions >= 2)) { rec = 'bpmn'; reasons.push(`${Math.max(m.roles, m.lanes)} roles or modules hand work to each other, with ${m.decisions} decision(s)${m.parallel ? ` and ${m.parallel} parallel path(s)` : ''}: a BPMN-style process with gateways shows both handovers and branching.`); }
  else if (multiLane) { rec = 'swimlane'; reasons.push(`Work moves between ${Math.max(m.roles, m.lanes)} roles or modules: swimlanes show who does what and where it is handed over.`); }
  else if (txnNodes >= 4 && m.transactions >= Math.min(4, g.nodes.length - 2) && m.transactions >= 0.75 * (g.nodes.length - 2)) { rec = 'dependency'; reasons.push(`Most boxes are separate transactions (${m.transactions}); the links are dependencies between them.`); }
  else if (m.treeShaped && m.levelCue) { rec = 'hierarchy'; reasons.push('The steps form a parent-child structure with levels.'); }
  else if (m.timeCues >= 3) { rec = 'timeline'; reasons.push(`The text refers to timing ${m.timeCues} times, so the order in time is what matters.`); }
  else if (m.activities <= 6 && m.decisions === 0) { rec = 'flowchart'; reasons.push(`A short sequence of ${m.activities} steps with no decisions reads best as a plain flowchart.`); }
  else if (m.decisions >= 1) { rec = 'flowchart'; reasons.push(`One main path with ${m.decisions} decision(s) and no separate roles: a flowchart with decision branches.`); }
  else reasons.push('A single path through one area of work: a flowchart.');
  if (m.hasLoop) reasons.push('It contains a loop; check that each loop has an exit.');

  const alt: { format: Format; reason: string }[] = [];
  const add = (format: Format, reason: string) => { if (format !== rec && !alt.some((a) => a.format === format)) alt.push({ format, reason }); };
  add('flowchart', 'The plain order of steps and decisions.');
  if (m.lanes >= 1 || m.roles >= 1) add('swimlane', 'Group the steps by role, screen or module.');
  if (multiLane || m.decisions >= 1) add('bpmn', 'Gateways and events: standard process notation.');
  if (m.decisions >= 1) add('decision-tree', 'Start from the conditions and follow each outcome.');
  add('hierarchy', 'The same steps as a parent-child tree.');
  add('timeline', 'The steps laid out in order along a time axis.');
  if (txnNodes >= 2) add('dependency', 'What depends on what between the transactions.');
  if (m.dataLinks >= 2) add('dataflow', 'The data each step takes in and hands on.');
  add('mindmap', 'The process as branches from one centre, for an overview.');
  if (m.activities >= 3) add('guide', 'An illustrated step-by-step guide with the details of each step.');
  if (hasLifecycle) add('lifecycle', 'The statuses and what moves between them.');
  return { recommended: rec, reasons, alternatives: alt, metrics: m, requested: wanted };
}
