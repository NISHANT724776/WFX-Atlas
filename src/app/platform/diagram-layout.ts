// Layout engine for the workflow designer. One structured graph (nodes and edges) is laid out in the way that suits the chosen
// picture: free positions for a flowchart, lanes for swimlane and BPMN, a tidy tree for decision trees and hierarchies, a radial
// layout for mind maps, a time axis for timelines, layers for dependency graphs and state diagrams, and data stores between
// steps for data flow. Collapsed sections become one box in every picture. No library: the layouts are small and exact.
export type NodeType = 'start' | 'end' | 'activity' | 'decision' | 'parallel' | 'exception' | 'state';
export type Basis = 'documented' | 'proposed' | 'inferred';
export type EdgeKind = 'sequence' | 'condition' | 'optional' | 'parallel' | 'dependency' | 'data' | 'transition';
export type Format = 'flowchart' | 'swimlane' | 'bpmn' | 'decision-tree' | 'hierarchy' | 'timeline' | 'lifecycle' | 'dependency' | 'mindmap' | 'dataflow' | 'guide' | 'sections';

export interface GNode {
  id: string; type: NodeType; label: string; role: string; transaction: string; basis: Basis; note: string; x: number; y: number;
  inputs?: string[]; outputs?: string[]; validations?: string[]; lane?: string; section?: string; description?: string; rules?: unknown[];
  /** The user dragged boxes by hand: the flowchart then keeps x and y instead of arranging itself. */
  pinned?: boolean;
}
export interface GEdge { from: string; to: string; label: string; id?: string; kind?: EdgeKind; condition?: string }
export interface GGraph { name: string; direction: 'TD' | 'LR'; nodes: GNode[]; edges: GEdge[]; format: Format }

export type Shape = 'task' | 'decision' | 'pill' | 'section' | 'state' | 'event-start' | 'event-end' | 'gateway-x' | 'gateway-plus' | 'milestone' | 'process' | 'store' | 'root' | 'dot';
export interface Placed { id: string; shape: Shape; x: number; y: number; w: number; h: number; label: string; lines: string[]; sub: string; type: NodeType | 'section' | 'store' | 'root'; basis: Basis; node: GNode | null; section: string; members: number; badge: string; badgeOn: boolean; match: boolean; dim: boolean }
export interface PlacedEdge { from: string; to: string; label: string; kind: EdgeKind; d: string; lx: number; ly: number; src: number; long: boolean }
export interface Lane { name: string; x: number; y: number; w: number; h: number }
export interface Laid { nodes: Placed[]; edges: PlacedEdge[]; lanes: Lane[]; laneHead: number; laneVertical: boolean; w: number; h: number; axes: { x1: number; x2: number; y: number }[]; byId: Map<string, Placed>; direction: 'H' | 'V' | 'R' }

export interface Options { collapsed: Set<string>; detailed: boolean; overlay: string; query: string; lifecycle: GGraph | null }

const W = 180, H = 56, GX = 70, GY = 54, HEAD = 120;
export const sizeOf = (shape: Shape): [number, number] => {
  switch (shape) {
    case 'event-start': case 'event-end': return [40, 40];
    case 'gateway-x': case 'gateway-plus': return [56, 56];
    case 'decision': return [W, 64];
    case 'pill': return [150, 44];
    case 'state': return [150, 52];
    case 'milestone': return [168, 62];
    case 'process': return [168, 56];
    case 'store': return [150, 40];
    case 'root': return [190, 64];
    case 'dot': return [14, 14];
    default: return [W, H];
  }
};
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);
export function wrap(label: string, max = 24, lines = 3): string[] {
  const out: string[] = []; let cur = '';
  for (const w of label.split(/\s+/)) { if ((cur + ' ' + w).trim().length > max && cur) { out.push(cur); cur = w; } else cur = (cur + ' ' + w).trim(); }
  if (cur) out.push(cur);
  return out.length > lines ? [...out.slice(0, lines - 1), short(out.slice(lines - 1).join(' '), max)] : out;
}

// ── helpers on a graph ────────────────────────────────────────────────────────────────────────────────────────

export function ranks(nodes: { id: string }[], edges: GEdge[]): Map<string, number> {
  const out = new Map<string, string[]>(); const hasIn = new Set<string>();
  for (const e of edges) { out.set(e.from, [...(out.get(e.from) ?? []), e.to]); hasIn.add(e.to); }
  const rank = new Map<string, number>();
  const q = nodes.filter((n) => !hasIn.has(n.id)).map((n) => n.id);
  if (!q.length && nodes[0]) q.push(nodes[0].id);
  for (const s of q) rank.set(s, 0);
  let guard = 0;
  while (q.length && guard++ < 12000) { const n = q.shift()!; for (const m of out.get(n) ?? []) { const l = (rank.get(n) ?? 0) + 1; if ((rank.get(m) ?? -1) < l && l < nodes.length) { rank.set(m, l); q.push(m); } } }
  for (const n of nodes) if (!rank.has(n.id)) rank.set(n.id, 0);
  return rank;
}

/** The graph with each collapsed section replaced by one box; edges inside a section disappear, edges crossing it are kept once. */
function collapse(g: GGraph, collapsed: Set<string>): { nodes: GNode[]; edges: GEdge[] } {
  const memberOf = new Map<string, string>();
  for (const n of g.nodes) if (n.section && collapsed.has(n.section) && n.type !== 'start' && n.type !== 'end') memberOf.set(n.id, `sec:${n.section}`);
  const virtual = new Map<string, GNode & { count: number }>();
  const nodes: GNode[] = [];
  for (const n of g.nodes) {
    const v = memberOf.get(n.id);
    if (!v) { nodes.push(n); continue; }
    const ex = virtual.get(v);
    if (ex) { ex.count++; ex.x = Math.min(ex.x, n.x); ex.y = Math.min(ex.y, n.y); if (n.basis !== 'documented') ex.basis = 'proposed'; continue; }
    const nv = { id: v, type: 'activity' as NodeType, label: '', role: '', transaction: '', basis: 'documented' as Basis, note: '', x: n.x, y: n.y, lane: n.lane, section: n.section, count: 1 };
    virtual.set(v, nv); nodes.push(nv);
  }
  for (const v of virtual.values()) v.label = `${v.section} · ${v.count} step${v.count === 1 ? '' : 's'}`;
  const seen = new Set<string>(); const edges: GEdge[] = [];
  for (const e of g.edges) {
    const f = memberOf.get(e.from) ?? e.from, t = memberOf.get(e.to) ?? e.to, key = `${f}|${t}|${e.label}`;
    if (f === t || seen.has(key)) continue;
    seen.add(key); edges.push({ ...e, from: f, to: t });
  }
  (nodes as (GNode & { count?: number })[]).forEach((n) => { if (virtual.has(n.id)) (n as GNode & { _members?: number })._members = virtual.get(n.id)!.count; });
  return { nodes, edges };
}

const kindOf = (e: GEdge): EdgeKind => e.kind ?? (e.label ? 'condition' : 'sequence');

function badgeOf(n: GNode, overlay: string): { badge: string; badgeOn: boolean } {
  if (n.type === 'start' || n.type === 'end') return { badge: '', badgeOn: false };
  const c = (k: string) => ((n as unknown as Record<string, unknown[] | undefined>)[k]?.length ?? 0);
  if (overlay === 'validations') return { badge: c('validations') ? `${c('validations')} ✓` : '–', badgeOn: c('validations') > 0 };
  if (overlay === 'rules') return { badge: c('rules') ? `${c('rules')} rules` : '–', badgeOn: c('rules') > 0 };
  if (overlay === 'dependencies') return { badge: c('dependencies') ? `${c('dependencies')} deps` : '–', badgeOn: c('dependencies') > 0 };
  if (overlay === 'io') return { badge: c('inputs') || c('outputs') ? `${c('inputs')}→${c('outputs')}` : '–', badgeOn: c('inputs') + c('outputs') > 0 };
  return { badge: '', badgeOn: false };
}

function place(n: GNode, shape: Shape, x: number, y: number, o: Options, over: Partial<Placed> = {}): Placed {
  const [w, h] = sizeOf(shape);
  const q = o.query.trim().toLowerCase();
  const text = `${n.label} ${n.role} ${n.lane ?? ''} ${n.transaction} ${n.description ?? ''}`.toLowerCase();
  const match = !!q && text.includes(q);
  const virtual = n.id.startsWith('sec:');
  const maxChars = shape === 'milestone' ? 22 : shape === 'decision' ? 20 : shape === 'gateway-x' || shape === 'gateway-plus' || shape.startsWith('event') ? 18 : 24;
  return {
    id: n.id, shape: virtual ? 'section' : shape, x, y, w, h, label: n.label, lines: wrap(n.label, maxChars), sub: n.role || '', type: virtual ? 'section' : n.type, basis: n.basis, node: virtual ? null : n,
    section: n.section ?? '', members: (n as GNode & { _members?: number })._members ?? 1, ...badgeOf(n, o.overlay), match, dim: !!q && !match, ...over,
  };
}

// ── edge routing ─────────────────────────────────────────────────────────────────────────────────────────────

type Route = 'V' | 'H' | 'elbowH' | 'elbowV' | 'line';
function connect(a: Placed, b: Placed, route: Route): { d: string; lx: number; ly: number } {
  if (route === 'H' || route === 'elbowH') {
    const fwd = b.x >= a.x + a.w / 2;
    const x1 = fwd ? a.x + a.w : a.x, y1 = a.y + a.h / 2, x2 = fwd ? b.x : b.x + b.w, y2 = b.y + b.h / 2;
    if (route === 'elbowH') { const mx = (x1 + x2) / 2; return { d: `M${x1},${y1} H${mx} V${y2} H${x2}`, lx: mx, ly: (y1 + y2) / 2 - 6 }; }
    const c = Math.max(34, Math.abs(x2 - x1) / 2), s = fwd ? 1 : -1;
    return { d: `M${x1},${y1} C${x1 + s * c},${y1} ${x2 - s * c},${y2} ${x2},${y2}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 - 6 };
  }
  if (route === 'line') { const x1 = a.x + a.w / 2, y1 = a.y + a.h / 2, x2 = b.x + b.w / 2, y2 = b.y + b.h / 2; return { d: `M${x1},${y1} L${x2},${y2}`, lx: (x1 + x2) / 2, ly: (y1 + y2) / 2 - 4 }; }
  const down = b.y >= a.y + a.h / 2;
  const x1 = a.x + a.w / 2, y1 = down ? a.y + a.h : a.y, x2 = b.x + b.w / 2, y2 = down ? b.y : b.y + b.h;
  if (route === 'elbowV') { const my = (y1 + y2) / 2; return { d: `M${x1},${y1} V${my} H${x2} V${y2}`, lx: (x1 + x2) / 2, ly: my - 6 }; }
  const c = Math.max(30, Math.abs(y2 - y1) / 2), s = down ? 1 : -1;
  return { d: `M${x1},${y1} C${x1},${y1 + s * c} ${x2},${y2 - s * c} ${x2},${y2}`, lx: (x1 + x2) / 2 + 8, ly: (y1 + y2) / 2 };
}

function finish(nodes: Placed[], edges: GEdge[], route: Route, lanes: Lane[], o: { w?: number; h?: number; axes?: Laid['axes']; direction?: Laid['direction']; laneHead?: number; laneVertical?: boolean } = {}): Laid {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const placed: PlacedEdge[] = [];
  edges.forEach((e, i) => {
    const a = byId.get(e.from), b = byId.get(e.to);
    if (!a || !b) return;
    const c = connect(a, b, route);
    // a connection that spans several steps is drawn lighter, so the short ones that carry the story stand out
    const long = route === 'H' || route === 'elbowH' ? Math.abs(a.x - b.x) > 420 : route === 'line' ? false : Math.abs(a.y - b.y) > 190;
    placed.push({ from: e.from, to: e.to, label: e.label || e.condition || '', kind: kindOf(e), d: c.d, lx: c.lx, ly: c.ly, src: i, long });
  });
  const w = Math.max(o.w ?? 0, 700, ...nodes.map((n) => n.x + n.w + 40));
  const h = Math.max(o.h ?? 0, 320, ...nodes.map((n) => n.y + n.h + 56));
  return { nodes, edges: placed, lanes, laneHead: o.laneHead ?? 0, laneVertical: o.laneVertical ?? false, w, h, axes: o.axes ?? [], byId, direction: o.direction ?? 'V' };
}

// ── layouts ───────────────────────────────────────────────────────────────────────────────────────────────────

const shapeOf = (n: GNode, bpmn = false): Shape => {
  if (n.id.startsWith('sec:')) return 'section';
  if (n.type === 'decision') return bpmn ? 'gateway-x' : 'decision';
  if (n.type === 'parallel') return bpmn ? 'gateway-plus' : 'decision';
  if (n.type === 'start') return bpmn ? 'event-start' : 'pill';
  if (n.type === 'end') return bpmn ? 'event-end' : 'pill';
  if (n.type === 'state') return 'state';
  return 'task';
};

function flowchart(g: GGraph, o: Options): Laid {
  const { nodes, edges } = collapse(g, o.collapsed);
  // arranged automatically (layers, few crossings) until the user drags a box; then the positions they chose are kept
  if (!g.nodes.some((n) => n.pinned) && nodes.length > 1) {
    const dir: 'H' | 'V' = g.direction === 'LR' ? 'H' : 'V';
    return finish(layered(nodes, edges, o, (n) => shapeOf(n), null, dir), edges, dir, [], { direction: dir });
  }
  const placed = nodes.map((n) => place(n, shapeOf(n), Number.isFinite(n.x) ? n.x : 0, Number.isFinite(n.y) ? n.y : 0, o));
  return finish(placed, edges, g.direction === 'LR' ? 'H' : 'V', [], { direction: g.direction === 'LR' ? 'H' : 'V' });
}

function swimlane(g: GGraph, o: Options, bpmn: boolean): Laid {
  const { nodes, edges } = collapse(g, o.collapsed);
  const rank = ranks(nodes, edges);
  const laneOf = new Map<string, string>();
  for (const n of nodes) if (n.type !== 'start' && n.type !== 'end') laneOf.set(n.id, n.lane || n.role || 'General');
  for (const n of nodes) if (n.type === 'start') laneOf.set(n.id, laneOf.get(edges.find((e) => e.from === n.id)?.to ?? '') ?? 'General');
  for (const n of nodes) if (n.type === 'end') laneOf.set(n.id, laneOf.get(edges.find((e) => e.to === n.id)?.from ?? '') ?? 'General');
  const order: string[] = [];
  for (const n of [...nodes].sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))) { const l = laneOf.get(n.id) ?? 'General'; if (!order.includes(l)) order.push(l); }
  const slot = new Map<string, number>(), used = new Map<string, number>(), depth = new Map<string, number>();
  for (const n of nodes) { const lane = laneOf.get(n.id)!; const key = `${lane}|${rank.get(n.id)}`; const k = used.get(key) ?? 0; used.set(key, k + 1); slot.set(n.id, k); depth.set(lane, Math.max(depth.get(lane) ?? 1, k + 1)); }
  const maxRank = Math.max(0, ...rank.values());
  // a long sequence read left to right gets very wide; with many steps the lanes stand as columns and the flow runs downward
  if (maxRank >= 7 && order.length <= 9) {
    const top = 40, step = H + 40;
    const lanesV: Lane[] = []; let x = 0;
    for (const name of order) { const wid = (depth.get(name) ?? 1) * (W + 24) + 24; lanesV.push({ name, x, y: 0, w: wid, h: top + (maxRank + 1) * step + 10 }); x += wid; }
    const laneX = new Map(lanesV.map((l) => [l.name, l]));
    const placedV = nodes.map((n) => {
      const shape = shapeOf(n, bpmn), [w, h] = sizeOf(shape), lane = laneX.get(laneOf.get(n.id) ?? 'General')!;
      return place(n, shape, lane.x + 12 + (slot.get(n.id) ?? 0) * (W + 24) + (W - w) / 2, top + 14 + (rank.get(n.id) ?? 0) * step + (H - h) / 2, o);
    });
    return finish(placedV, edges, 'V', lanesV, { w: x, h: top + (maxRank + 1) * step + 10, laneVertical: true, direction: 'V' });
  }
  const lanes: Lane[] = []; let y = 0;
  for (const name of order) { const hgt = (depth.get(name) ?? 1) * (H + 22) + 20; lanes.push({ name, x: 0, y, w: 0, h: hgt }); y += hgt; }
  const laneY = new Map(lanes.map((l) => [l.name, l]));
  const placed = nodes.map((n) => {
    const shape = shapeOf(n, bpmn), [w, h] = sizeOf(shape);
    const lane = laneY.get(laneOf.get(n.id) ?? 'General')!;
    const x = HEAD + 30 + (rank.get(n.id) ?? 0) * (W + 56) + (W - w) / 2;
    return place(n, shape, x, lane.y + 12 + (slot.get(n.id) ?? 0) * (H + 22) + (H - h) / 2, o);
  });
  return finish(placed, edges, 'H', lanes, { h: y + 10, laneHead: HEAD, direction: 'H' });
}

/** Spanning tree (first parent wins) with the remaining edges kept as cross links. */
function spanning(nodes: GNode[], edges: GEdge[]) {
  const kids = new Map<string, string[]>(); const parent = new Map<string, string>();
  const out = new Map<string, GEdge[]>();
  for (const e of edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const hasIn = new Set(edges.map((e) => e.to));
  const roots = nodes.filter((n) => !hasIn.has(n.id)).map((n) => n.id);
  if (!roots.length && nodes[0]) roots.push(nodes[0].id);
  const seen = new Set(roots); const q = [...roots];
  while (q.length) { const x = q.shift()!; for (const e of out.get(x) ?? []) if (!seen.has(e.to)) { seen.add(e.to); parent.set(e.to, x); kids.set(x, [...(kids.get(x) ?? []), e.to]); q.push(e.to); } }
  for (const n of nodes) if (!seen.has(n.id)) roots.push(n.id);
  return { kids, parent, roots };
}

function tree(g: GGraph, o: Options, dir: 'H' | 'V'): Laid {
  const { nodes, edges } = collapse(g, o.collapsed);
  const { kids, roots } = spanning(nodes, edges);
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const pos = new Map<string, { d: number; s: number }>();
  let leaf = 0;
  const walk = (id: string, depth: number): number => {
    const ch = kids.get(id) ?? [];
    if (!ch.length) { const s = leaf++; pos.set(id, { d: depth, s }); return s; }
    const ss = ch.map((c) => walk(c, depth + 1));
    const s = (Math.min(...ss) + Math.max(...ss)) / 2; pos.set(id, { d: depth, s }); return s;
  };
  roots.forEach((r) => walk(r, 0));
  const maxDepth = Math.max(0, ...[...pos.values()].map((p) => p.d));
  if (dir === 'H' && maxDepth > 6) dir = 'V';
  const placed = nodes.map((n) => {
    const shape = shapeOf(n), [w, h] = sizeOf(shape), p = pos.get(n.id)!;
    return dir === 'H' ? place(n, shape, 30 + p.d * (W + GX), 30 + p.s * (H + 30) + (H - h) / 2, o) : place(n, shape, 30 + p.s * (W + 36) + (W - w) / 2, 30 + p.d * (H + GY), o);
  });
  // tree edges are elbows; edges that rejoin an earlier branch are drawn as dashed cross links
  const l = finish(placed, edges, dir === 'H' ? 'elbowH' : 'elbowV', [], { direction: dir });
  for (const e of l.edges) { const isTree = kids.get(e.from)?.includes(e.to); if (!isTree && byId.has(e.from)) e.kind = e.kind === 'condition' ? 'condition' : 'dependency'; }
  return l;
}

function mindmap(g: GGraph, o: Options): Laid {
  const { nodes, edges } = collapse(g, o.collapsed);
  const rank = ranks(nodes, edges);
  const steps = nodes.filter((n) => n.type !== 'start' && n.type !== 'end').sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  // the branches: the lanes (screens, roles, modules) or sections the steps belong to; one lane only → groups of four steps in order
  const key = (n: GNode) => n.lane || n.section || '';
  const groups: { name: string; items: GNode[] }[] = [];
  if (new Set(steps.map(key)).size > 1) for (const n of steps) { const k = key(n) || 'General'; const gr = groups.find((x) => x.name === k); if (gr) gr.items.push(n); else groups.push({ name: k, items: [n] }); }
  else for (let i = 0; i < steps.length; i += 4) groups.push({ name: `Steps ${i + 1}–${Math.min(i + 4, steps.length)}`, items: steps.slice(i, i + 4) });
  const order = new Map(steps.map((n, i) => [n.id, i + 1]));
  const rootNode: GNode = { id: '__root', type: 'activity', label: g.name, role: '', transaction: '', basis: 'documented', note: '', x: 0, y: 0 };
  const total = groups.reduce((a, x) => a + Math.max(2, x.items.length), 0) || 1;
  const placed: Placed[] = [place(rootNode, 'root', -95, -32, o, { type: 'root', lines: wrap(g.name, 22, 3) })];
  const links: GEdge[] = [];
  const R1 = 300, R2 = 560, sx = 1.15;
  let a = -Math.PI / 2;
  groups.forEach((gr, gi) => {
    const span = (2 * Math.PI * Math.max(2, gr.items.length)) / total, mid = a + span / 2;
    const gn: GNode = { id: `__g${gi}`, type: 'activity', label: gr.name, role: '', transaction: '', basis: 'documented', note: '', x: 0, y: 0 };
    placed.push(place(gn, 'pill', Math.cos(mid) * R1 * sx - 75, Math.sin(mid) * R1 - 22, o, { lines: wrap(gr.name, 20, 2), w: 150, h: 44, type: 'section', basis: 'documented' }));
    links.push({ from: '__root', to: gn.id, label: '' });
    gr.items.forEach((n, i) => {
      const ang = a + (span * (i + 0.5)) / gr.items.length;
      placed.push(place({ ...n, label: `${order.get(n.id)}. ${n.label}` }, n.type === 'decision' ? 'decision' : 'pill', Math.cos(ang) * R2 * sx - 90, Math.sin(ang) * R2 - 24, o, { w: 180, h: 48 }));
      links.push({ from: gn.id, to: n.id, label: '' });
    });
    a += span;
  });
  const minX = Math.min(...placed.map((p) => p.x)) - 40, minY = Math.min(...placed.map((p) => p.y)) - 40;
  for (const p of placed) { p.x -= minX; p.y -= minY; }
  return finish(placed, links, 'line', [], { direction: 'R' });
}

function layered(nodes: GNode[], edges: GEdge[], o: Options, shapeFor: (n: GNode) => Shape, size: [number, number] | null, dir: 'H' | 'V'): Placed[] {
  const rank = ranks(nodes, edges);
  const out = new Map<string, string[]>(), inc = new Map<string, string[]>();
  for (const e of edges) { out.set(e.from, [...(out.get(e.from) ?? []), e.to]); inc.set(e.to, [...(inc.get(e.to) ?? []), e.from]); }
  // a step that nothing leads into sits just above its first successor, not at the top with a long line down to it
  for (let pass = 0; pass < 2; pass++) for (const n of nodes) {
    if (n.type === 'start' || inc.get(n.id)?.length || !out.get(n.id)?.length) continue;
    const t = Math.min(...out.get(n.id)!.map((m) => rank.get(m) ?? 1)) - 1;
    if (t > (rank.get(n.id) ?? 0)) rank.set(n.id, t);
  }
  const byRank = new Map<number, GNode[]>();
  for (const n of nodes) byRank.set(rank.get(n.id)!, [...(byRank.get(rank.get(n.id)!) ?? []), n]);
  const rankKeys = [...byRank.keys()].sort((a, b) => a - b);
  const order = new Map<string, number>();
  for (const r of rankKeys) byRank.get(r)!.forEach((n, i) => order.set(n.id, i));
  // fewer crossings: reorder each rank by the average position of its neighbours, sweeping down and up
  const avg = (id: string, nb: Map<string, string[]>) => { const ps = (nb.get(id) ?? []).map((x) => order.get(x)).filter((x): x is number => x !== undefined); return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : order.get(id)!; };
  for (let sweep = 0; sweep < 6; sweep++) {
    const down = sweep % 2 === 0;
    for (const r of down ? rankKeys : [...rankKeys].reverse()) {
      const list = byRank.get(r)!;
      const key = new Map(list.map((n) => [n.id, avg(n.id, down ? inc : out)]));
      list.sort((a, b) => key.get(a.id)! - key.get(b.id)! || order.get(a.id)! - order.get(b.id)!);
      list.forEach((n, i) => order.set(n.id, i));
    }
  }
  const maxIn = Math.max(...[...byRank.values()].map((v) => v.length));
  // one column width and row height for the whole graph, so boxes of different sizes never share a cell
  const dims = nodes.map((n) => size ?? sizeOf(shapeFor(n)));
  const cw = Math.max(...dims.map((x) => x[0])), ch = Math.max(...dims.map((x) => x[1]));
  return nodes.map((n) => {
    const shape = shapeFor(n), [w, h] = size ?? sizeOf(shape), r = rank.get(n.id)!, i = order.get(n.id)!, cnt = byRank.get(r)!.length;
    const off = ((maxIn - cnt) / 2) * (dir === 'H' ? ch + 34 : cw + 40);
    return dir === 'H' ? place(n, shape, 30 + r * (cw + 84) + (cw - w) / 2, 30 + i * (ch + 34) + off + (ch - h) / 2, o, { w, h }) : place(n, shape, 30 + i * (cw + 40) + off + (cw - w) / 2, 30 + r * (ch + 60) + (ch - h) / 2, o, { w, h });
  });
}

function dependency(g: GGraph, o: Options): Laid {
  const { nodes, edges } = collapse(g, o.collapsed);
  const inner = nodes.filter((n) => n.type !== 'start' && n.type !== 'end');
  const ids = new Set(inner.map((n) => n.id));
  const es = edges.filter((e) => ids.has(e.from) && ids.has(e.to));
  const dir: 'H' | 'V' = Math.max(0, ...ranks(inner, es).values()) > 6 ? 'V' : 'H';
  const placed = layered(inner, es, o, () => 'task', [160, 46], dir);
  return finish(placed, es.map((e) => ({ ...e, kind: 'dependency' as EdgeKind })), dir, [], { direction: dir });
}

function lifecycle(lc: GGraph | null, o: Options): Laid {
  if (!lc) return finish([], [], 'H', []);
  const placed = layered(lc.nodes, lc.edges, o, (n) => (n.type === 'start' || n.type === 'end' ? 'dot' : 'state'), null, 'H');
  for (const p of placed) if (p.shape === 'dot') p.lines = [];
  return finish(placed, lc.edges.map((e) => ({ ...e, kind: 'transition' as EdgeKind })), 'H', [], { direction: 'H' });
}

function timeline(g: GGraph, o: Options): Laid {
  const { nodes, edges } = collapse(g, o.collapsed);
  const rank = ranks(nodes, edges);
  const seq = [...nodes].filter((n) => n.type !== 'start' && n.type !== 'end').sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const step = 188, perRow = 8, rowH = 330;
  const outLabels = (id: string) => edges.filter((e) => e.from === id && e.label).map((e) => e.label).join(' / ');
  const placed = seq.map((n, i) => {
    const row = Math.floor(i / perRow), col = i % perRow, up = i % 2 === 0, axisY = 200 + row * rowH;
    return place(n, 'milestone', 40 + col * step, up ? axisY - 120 : axisY + 60, o, { sub: n.type === 'decision' ? `decision: ${short(outLabels(n.id), 34)}` : n.lane || n.role || '' });
  });
  const rows = Math.max(1, Math.ceil(seq.length / perRow));
  const axes = Array.from({ length: rows }, (_, r) => ({ x1: 20, x2: 60 + Math.min(perRow, seq.length - r * perRow) * step, y: 200 + r * rowH }));
  const l = finish(placed, [], 'V', [], { axes, w: 80 + Math.min(perRow, seq.length) * step, h: 200 + (rows - 1) * rowH + 170, direction: 'H' });
  // stems from each milestone to its axis
  l.edges = placed.map((p, i) => { const up = i % 2 === 0, cx = p.x + p.w / 2, ay = 200 + Math.floor(i / perRow) * rowH; return { from: p.id, to: p.id, label: '', kind: 'sequence' as EdgeKind, d: up ? `M${cx},${p.y + p.h} V${ay}` : `M${cx},${p.y} V${ay}`, lx: cx, ly: ay, src: -1, long: false }; });
  return l;
}

function dataflow(g: GGraph, o: Options): Laid {
  const { nodes, edges } = collapse(g, o.collapsed);
  const rank = ranks(nodes, edges);
  const steps = nodes.filter((n) => n.type !== 'start' && n.type !== 'end' && n.type !== 'decision').sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  const placed: Placed[] = []; const links: GEdge[] = [];
  const stores = new Map<string, Placed>();
  let y = 30;
  for (const n of steps) {
    const ins = (n.inputs ?? []).slice(0, 4), outs = (n.outputs ?? []).slice(0, 4);
    const rows = Math.max(1, ins.length, outs.length);
    const mid = y + ((rows - 1) * 52) / 2;
    placed.push(place(n, 'process', 330, mid, o));
    ins.forEach((t, i) => { const key = `in|${short(t, 40)}`; let s = stores.get(key); if (!s) { const sn: GNode = { id: `d${stores.size}`, type: 'activity', label: short(t.replace(/^From upstream:\s*/i, ''), 44), role: '', transaction: '', basis: 'documented', note: '', x: 0, y: 0 }; s = place(sn, 'store', 20, y + i * 52, o, { type: 'store', basis: 'documented', node: null, lines: wrap(sn.label, 22, 2) }); stores.set(key, s); placed.push(s); } links.push({ from: s.id, to: n.id, label: '', kind: 'data' }); });
    outs.forEach((t, i) => { const key = `out|${short(t, 40)}`; let s = stores.get(key); if (!s) { const sn: GNode = { id: `d${stores.size}`, type: 'activity', label: short(t.replace(/^To downstream:\s*/i, ''), 44), role: '', transaction: '', basis: 'documented', note: '', x: 0, y: 0 }; s = place(sn, 'store', 640, y + i * 52, o, { type: 'store', basis: 'documented', node: null, lines: wrap(sn.label, 22, 2) }); stores.set(key, s); placed.push(s); } links.push({ from: n.id, to: s.id, label: '', kind: 'data' }); });
    y += rows * 52 + 28;
  }
  return finish(placed, links, 'H', [], { direction: 'H' });
}

/** Lays the graph out for the chosen picture. `guide` has no canvas (it is drawn as cards by the page). */
export function layoutDiagram(g: GGraph, format: Format, o: Options): Laid {
  switch (format) {
    case 'swimlane': return swimlane(g, o, false);
    case 'bpmn': return swimlane(g, o, true);
    case 'decision-tree': return tree(g, o, 'H');
    case 'hierarchy': return tree(g, o, 'V');
    case 'mindmap': return mindmap(g, o);
    case 'timeline': return timeline(g, o);
    case 'dependency': return dependency(g, o);
    case 'lifecycle': return lifecycle(o.lifecycle, o);
    case 'dataflow': return dataflow(g, o);
    case 'sections': case 'flowchart': case 'guide': default: return flowchart(g, o);
  }
}

export const FORMAT_LABELS: Record<Format, string> = {
  flowchart: 'Flowchart', swimlane: 'Swimlane', bpmn: 'BPMN-style process', 'decision-tree': 'Decision tree', hierarchy: 'Hierarchy', timeline: 'Timeline', lifecycle: 'Status lifecycle',
  dependency: 'Dependency graph', mindmap: 'Mind map', dataflow: 'Data flow', guide: 'Illustrated guide', sections: 'Sections',
};

/** The steps in the order the process runs (by depth from the start), for the illustrated guide and the timeline. */
export function orderedSteps(g: GGraph): GNode[] {
  const rank = ranks(g.nodes, g.edges);
  return g.nodes.filter((n) => n.type !== 'start' && n.type !== 'end').sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
}
