// Workflow designer model: a workflow is a graph of nodes and edges stored as a WORKFLOW entry in the TXT library
// (NODES / EDGES lines), so it is versioned and approved like any other knowledge. Graphs can be read from stored
// entries (workflows, procedures), from written text or from Mermaid, then validated, compared and turned into test paths.
// Nodes keep their basis: documented (from a stored source), proposed (written by the user) or inferred (added by the
// system, e.g. start/end) – nothing is presented as documented unless a source says so.
import { parseMermaid, toMermaid } from '../ingest/diagram.ts';
import { getEntry } from '../knowledge/repo.ts';
import { makeEntry, stepsOf } from '../knowledge/txt.ts';
import type { Entry } from '../knowledge/txt.ts';
import { idPart, today } from '../util.ts';

export type NodeType = 'start' | 'end' | 'activity' | 'decision' | 'parallel' | 'exception' | 'state';
/** What a connection means (the renderer styles each kind; a decision's branches are 'condition'). */
export type EdgeKind = 'sequence' | 'condition' | 'optional' | 'parallel' | 'dependency' | 'data' | 'transition';
export const EDGE_KINDS: EdgeKind[] = ['sequence', 'condition', 'optional', 'parallel', 'dependency', 'data', 'transition'];
export type Basis = 'documented' | 'proposed' | 'inferred';
export interface RuleRef { id: string; title: string; status: string; category: string }
export interface Ref { id: string; title: string; kind: string; status: string }
/** One step. The optional fields are what the documentation says about it (never filled in by guessing). */
export interface WNode {
  id: string; type: NodeType; label: string; role: string; transaction: string; basis: Basis; note: string; x?: number; y?: number;
  inputs?: string[]; outputs?: string[]; rules?: RuleRef[]; dependencies?: string[]; validations?: string[]; images?: { src: string; caption: string }[];
  sources?: string[]; lane?: string; section?: string; description?: string;
  /** The user placed boxes by hand: the picture keeps x and y instead of arranging itself. */
  pinned?: boolean;
}
/** The pictures one workflow can be drawn as. They all read the same nodes and edges. */
export type Format = 'flowchart' | 'swimlane' | 'bpmn' | 'decision-tree' | 'hierarchy' | 'timeline' | 'lifecycle' | 'dependency' | 'mindmap' | 'dataflow' | 'guide' | 'sections';
export const FORMATS: Format[] = ['flowchart', 'swimlane', 'bpmn', 'decision-tree', 'hierarchy', 'timeline', 'lifecycle', 'dependency', 'mindmap', 'dataflow', 'guide', 'sections'];
export interface WEdge { from: string; to: string; label: string; id?: string; kind?: EdgeKind; condition?: string }
export interface Graph {
  id: string; name: string; description: string; direction: 'TD' | 'LR'; nodes: WNode[]; edges: WEdge[];
  preconditions: string; postconditions: string; exceptions: string; relatedTransactions: string;
  source: string; status: string; version: number; basisNote: string;
  module: string; format: Format; references: Ref[];
  submodule: string; assumptions: string[]; missing: string[]; dependencies: string[]; relatedDocuments: Ref[];
}

const empty = (id = '', name = ''): Graph => ({ id, name, description: '', direction: 'TD', nodes: [], edges: [], preconditions: '', postconditions: '', exceptions: '', relatedTransactions: '', source: '', status: 'Draft', version: 0, basisNote: '', module: '', format: 'flowchart', references: [], submodule: '', assumptions: [], missing: [], dependencies: [], relatedDocuments: [] });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'n';
function uniqueId(base: string, used: Set<string>): string { let id = base, n = 2; while (used.has(id)) id = `${base}_${n++}`; used.add(id); return id; }

/** Adds Start/End nodes (marked inferred) when the graph has none. */
export function frame(g: Graph): Graph {
  if (!g.nodes.length) return g;
  const hasIn = new Set(g.edges.map((e) => e.to)), hasOut = new Set(g.edges.map((e) => e.from));
  const used = new Set(g.nodes.map((n) => n.id));
  if (!g.nodes.some((n) => n.type === 'start')) {
    const id = uniqueId('start', used);
    const firsts = g.nodes.filter((n) => !hasIn.has(n.id));
    g.nodes.unshift({ id, type: 'start', label: 'Start', role: '', transaction: '', basis: 'inferred', note: '', x: undefined, y: undefined });
    for (const f of firsts.length ? firsts : [g.nodes[1]]) g.edges.push({ from: id, to: f.id, label: '' });
  }
  if (!g.nodes.some((n) => n.type === 'end')) {
    const id = uniqueId('finish', used);
    const lasts = g.nodes.filter((n) => n.type !== 'start' && !hasOut.has(n.id));
    g.nodes.push({ id, type: 'end', label: 'End', role: '', transaction: '', basis: 'inferred', note: '', x: undefined, y: undefined });
    for (const l of lasts) g.edges.push({ from: l.id, to: id, label: '' });
  }
  return g;
}

/** A stored workflow or procedure as a graph. */
export function graphFromEntry(id: string, version?: number): Graph | null {
  const e = getEntry(id, version);
  if (!e) return null;
  const f = e.fields;
  const g = { ...empty(e.id, e.title), description: f['DESCRIPTION'] ?? f['CONTENT'] ?? '', source: f['SOURCE'] ?? '', status: e.status, version: e.version, preconditions: f['PRECONDITIONS'] ?? '', postconditions: f['POSTCONDITIONS'] ?? '', exceptions: f['EXCEPTIONS'] ?? f['NOTES'] ?? '', relatedTransactions: f['RELATED TRANSACTIONS'] ?? '', direction: (f['DIRECTION'] === 'LR' ? 'LR' : 'TD') as 'TD' | 'LR' };
  if (f['NODES']) {
    // designer format: id | type | label | role | transaction | basis | note | x | y
    for (const line of stepsOf(f['NODES'])) {
      const p = line.split('|').map((x) => x.trim());
      if (!p[0]) continue;
      g.nodes.push({ id: p[0], type: (p[1] as NodeType) || 'activity', label: p[2] || p[0], role: p[3] ?? '', transaction: p[4] ?? '', basis: (p[5] as Basis) || 'proposed', note: p[6] ?? '', x: p[7] ? Number(p[7]) : undefined, y: p[8] ? Number(p[8]) : undefined });
    }
    for (const line of stepsOf(f['EDGES'])) {
      const p = line.split('|').map((x) => x.trim());
      if (p[0] && p[1]) g.edges.push({ from: p[0], to: p[1], label: p[2] ?? '', ...(p[3] && EDGE_KINDS.includes(p[3] as EdgeKind) ? { kind: p[3] as EdgeKind } : {}), ...(p[4] ? { condition: p[4] } : {}) });
    }
    g.module = f['MODULE'] ?? ''; g.submodule = f['SUBMODULE'] ?? ''; g.format = (FORMATS.includes(f['FORMAT'] as Format) ? f['FORMAT'] : 'flowchart') as Format;
    g.assumptions = stepsOf(f['ASSUMPTIONS']); g.missing = stepsOf(f['MISSING INFORMATION']); g.dependencies = stepsOf(f['DEPENDENCIES']);
    for (const line of stepsOf(f['REFERENCES'])) { const p = line.split('|').map((x) => x.trim()); if (p[0]) g.references.push({ id: p[0], title: p[1] ?? p[0], kind: p[2] ?? '', status: p[3] ?? '' }); }
    for (const line of stepsOf(f['RELATED DOCUMENTS'])) { const p = line.split('|').map((x) => x.trim()); if (p[0]) g.relatedDocuments.push({ id: p[0], title: p[1] ?? p[0], kind: 'document', status: p[2] ?? '' }); }
    readDetails(g, f['NODE DETAILS'] ?? '');
    g.basisNote = 'Saved designer workflow; each node shows whether it is documented, proposed or inferred.';
    return g;
  }
  const lines = stepsOf(f['STEPS']);
  // "A Style & BOM setup (A) – example values …" → the phase letter and its name
  const phases = new Map(stepsOf(f['PHASES']).map((l) => { const m = /^(\S+)\s+(.+?)(?:\s+\([^)]*\))?(?:\s+[–-]\s+.*)?$/.exec(l); return m ? [m[1], m[2]] as [string, string] : ['', '']; }));
  const used = new Set<string>();
  const ids: string[] = [];
  for (const line of lines) {
    const p = line.split('|').map((x) => x.trim());
    const structured = p.length >= 4;
    const id = uniqueId(structured ? slug(p[0]) : `s${ids.length + 1}`, used);
    ids.push(id);
    const phase = structured ? phases.get(p[1]) : undefined;
    g.nodes.push({ id, type: 'activity', label: structured ? p[3] : line, role: structured ? p[2] : '', transaction: structured ? (p[4] ?? '').replace(/^transaction:\s*/, '').replace(/^-$/, '') : '', basis: 'documented', note: structured ? (p[5] ?? '').replace(/^screen:\s*/, '') : '', ...(phase ? { section: phase } : {}) });
  }
  const prereq = stepsOf(f['PREREQUISITES']);
  if (prereq.length) {
    // documented prerequisite links ("bom ← style")
    const byStep = new Map(lines.map((l, i) => [slug(l.split('|')[0].trim()), ids[i]]));
    for (const line of prereq) {
      const [to, from] = line.split('←').map((x) => x.trim());
      for (const fr of (from ?? '').split(',').map((x) => slug(x.trim()))) if (byStep.has(fr) && byStep.has(slug(to))) g.edges.push({ from: byStep.get(fr)!, to: byStep.get(slug(to))!, label: '' });
    }
    g.basisNote = 'Steps and prerequisite links are documented; Start and End are added by the designer.';
  } else {
    for (let i = 1; i < ids.length; i++) g.edges.push({ from: ids[i - 1], to: ids[i], label: '' });
    g.basisNote = 'Steps are documented in this order; the links between them follow that order. Start and End are added by the designer.';
  }
  return layout(frame(g));
}

/** A workflow from written text (numbered or bulleted steps, "if … then … else …" decisions) or Mermaid source. */
export function graphFromText(text: string, name = 'New workflow'): Graph {
  const g = empty('', name);
  g.source = `Written by the user on ${today()}`;
  const src = text.trim();
  if (/^(flowchart|graph|stateDiagram)\b/i.test(src)) {
    const d = parseMermaid(src);
    for (const n of d.nodes) g.nodes.push({ id: slug(n.id), type: n.type === 'decision' || n.type === 'start' || n.type === 'end' ? n.type : 'activity', label: n.label, role: '', transaction: '', basis: 'proposed', note: '' });
    for (const e of d.edges) g.edges.push({ from: slug(e.from), to: slug(e.to), label: e.label });
    g.direction = d.direction === 'LR' ? 'LR' : 'TD';
    return layout(frame(g));
  }
  const used = new Set<string>();
  const lines = src.split(/\n|(?<=[.;])\s+(?=\d+[.)]\s)/).map((l) => l.trim().replace(/^(\d+[.)]|[-•*]|step \d+:?)\s*/i, '')).filter(Boolean);
  let prev: string | null = null;
  let pendingNo: { from: string; label: string } | null = null;
  for (const line of lines) {
    // "If <condition>, <yes> [, else <no>]" or "If <condition> then <yes> …": the condition ends at the first comma or "then"
    let dec: string[] | null = null;
    const ifm = /^if\s+(.+)$/i.exec(line.replace(/\.$/, ''));
    if (ifm) {
      const body = ifm[1];
      const cut = /\s+then\s+|,\s*|:\s*/i.exec(body);
      if (cut) {
        const cond = body.slice(0, cut.index).trim();
        const [yes, no] = body.slice(cut.index + cut[0].length).split(/[,;]?\s*\b(?:else|otherwise)\b\s*/i).map((x) => x.trim().replace(/^then\s+/i, ''));
        if (cond && yes) dec = [line, cond, yes, no ?? ''];
      }
    }
    if (dec) {
      const q = uniqueId(slug(`check_${dec[1]}`), used);
      g.nodes.push({ id: q, type: 'decision', label: `${dec[1].replace(/[?]$/, '')}?`, role: '', transaction: '', basis: 'proposed', note: '' });
      if (prev) g.edges.push({ from: prev, to: q, label: '' });
      const yes = uniqueId(slug(dec[2]), used);
      g.nodes.push({ id: yes, type: 'activity', label: dec[2], role: '', transaction: '', basis: 'proposed', note: '' });
      g.edges.push({ from: q, to: yes, label: 'yes' });
      if (dec[3]) { // eslint-disable-line
        const no = uniqueId(slug(dec[3]), used);
        g.nodes.push({ id: no, type: 'activity', label: dec[3], role: '', transaction: '', basis: 'proposed', note: '' });
        g.edges.push({ from: q, to: no, label: 'no' });
        pendingNo = { from: no, label: '' };
      } else pendingNo = { from: q, label: 'no' };
      prev = yes;
      continue;
    }
    const id = uniqueId(slug(line), used);
    const role = /^(the\s+)?(user|system|merchandiser|planner|buyer|supplier|approver|store|inventory team|production team|sourcing team)\b/i.exec(line)?.[2] ?? '';
    g.nodes.push({ id, type: /\b(error|reject|fail|exception)\b/i.test(line) ? 'exception' : 'activity', label: line, role, transaction: '', basis: 'proposed', note: '' });
    if (prev) g.edges.push({ from: prev, to: id, label: '' });
    if (pendingNo) { g.edges.push({ from: pendingNo.from, to: id, label: pendingNo.label }); pendingNo = null; }
    prev = id;
  }
  return layout(frame(g));
}

/** Simple layered layout: longest path from the start decides the row; positions are only set where missing. */
export function layout(g: Graph): Graph {
  const out = new Map<string, string[]>();
  for (const e of g.edges) out.set(e.from, [...(out.get(e.from) ?? []), e.to]);
  const level = new Map<string, number>();
  const starts = g.nodes.filter((n) => n.type === 'start' || !g.edges.some((e) => e.to === n.id));
  const queue = starts.map((s) => s.id);
  for (const s of queue) level.set(s, 0);
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    const n = queue.shift()!;
    for (const m of out.get(n) ?? []) {
      const l = (level.get(n) ?? 0) + 1;
      if (!level.has(m) || (level.get(m)! < l && l < g.nodes.length)) { level.set(m, l); queue.push(m); }
    }
  }
  const rows = new Map<number, WNode[]>();
  for (const n of g.nodes) { const l = level.get(n.id) ?? 0; rows.set(l, [...(rows.get(l) ?? []), n]); }
  for (const [l, list] of rows) list.forEach((n, i) => {
    if (n.x !== undefined && n.y !== undefined && !Number.isNaN(n.x)) return;
    const across = i * 230 - ((list.length - 1) * 230) / 2 + 400;
    if (g.direction === 'LR') { n.x = 40 + l * 230; n.y = 60 + i * 110; } else { n.x = across; n.y = 40 + l * 110; }
  });
  return g;
}

export interface Problem { level: 'error' | 'warning'; message: string; nodes?: string[] }
/** Structure checks: start/end, references, reachability, dead ends, decisions, loops. */
export function validate(g: Graph): Problem[] {
  const p: Problem[] = [];
  const ids = new Set(g.nodes.map((n) => n.id));
  if (ids.size !== g.nodes.length) p.push({ level: 'error', message: 'Two nodes have the same ID.' });
  const starts = g.nodes.filter((n) => n.type === 'start'), ends = g.nodes.filter((n) => n.type === 'end');
  if (!starts.length) p.push({ level: 'error', message: 'There is no Start node.' });
  if (!ends.length) p.push({ level: 'error', message: 'There is no End node.' });
  for (const e of g.edges) if (!ids.has(e.from) || !ids.has(e.to)) p.push({ level: 'error', message: `A connection points to a missing node (${e.from} → ${e.to}).` });
  const out = new Map<string, string[]>(), inc = new Map<string, number>();
  for (const e of g.edges) { out.set(e.from, [...(out.get(e.from) ?? []), e.to]); inc.set(e.to, (inc.get(e.to) ?? 0) + 1); }
  const seen = new Set<string>();
  const stack = starts.map((s) => s.id);
  while (stack.length) { const n = stack.pop()!; if (seen.has(n)) continue; seen.add(n); stack.push(...(out.get(n) ?? [])); }
  const unreachable = g.nodes.filter((n) => !seen.has(n.id));
  if (unreachable.length && starts.length) p.push({ level: 'error', message: `Not reachable from Start: ${unreachable.map((n) => n.label).join(', ')}.`, nodes: unreachable.map((n) => n.id) });
  const dead = g.nodes.filter((n) => n.type !== 'end' && !(out.get(n.id)?.length));
  if (dead.length) p.push({ level: 'error', message: `Dead end (no way forward and not an End): ${dead.map((n) => n.label).join(', ')}.`, nodes: dead.map((n) => n.id) });
  for (const n of g.nodes.filter((x) => x.type === 'start' && (inc.get(x.id) ?? 0) > 0)) p.push({ level: 'warning', message: `Start "${n.label}" has incoming connections.`, nodes: [n.id] });
  for (const d of g.nodes.filter((n) => n.type === 'decision')) {
    const branches = g.edges.filter((e) => e.from === d.id);
    if (branches.length < 2) p.push({ level: 'error', message: `Decision "${d.label}" needs at least two branches.`, nodes: [d.id] });
    if (branches.some((b) => !b.label)) p.push({ level: 'warning', message: `Decision "${d.label}" has a branch without a condition.`, nodes: [d.id] });
  }
  // loops: back edges in a depth-first walk
  const state = new Map<string, number>();
  const loops: string[] = [];
  const walk = (n: string) => { state.set(n, 1); for (const m of out.get(n) ?? []) { if (state.get(m) === 1) loops.push(`${n} → ${m}`); else if (!state.get(m)) walk(m); } state.set(n, 2); };
  for (const s of starts) if (!state.get(s.id)) walk(s.id);
  if (loops.length) p.push({ level: 'warning', message: `Loops (check that each has an exit condition): ${loops.join('; ')}.` });
  const undocumented = g.nodes.filter((n) => n.basis !== 'documented' && n.type !== 'start' && n.type !== 'end');
  if (undocumented.length) p.push({ level: 'warning', message: `${undocumented.length} step(s) are proposed or inferred, not documented by a source: ${undocumented.slice(0, 6).map((n) => n.label).join(', ')}${undocumented.length > 6 ? ' …' : ''}.` });
  return p;
}

/** Every path from a Start to an End (capped): each becomes a test scenario; decision branches name the condition. */
export function testPaths(g: Graph, max = 50): { name: string; steps: string[] }[] {
  const out = new Map<string, WEdge[]>();
  for (const e of g.edges) out.set(e.from, [...(out.get(e.from) ?? []), e]);
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  const paths: { name: string; steps: string[] }[] = [];
  const go = (id: string, steps: string[], conds: string[], visited: Set<string>) => {
    if (paths.length >= max) return;
    const n = byId.get(id);
    if (!n) return;
    const here = n.type === 'start' || n.type === 'end' ? steps : [...steps, n.label];
    if (n.type === 'end') { paths.push({ name: conds.length ? conds.join(' · ') : 'Main path', steps: here }); return; }
    for (const e of out.get(id) ?? []) {
      if (visited.has(e.to)) continue; // loops are walked once
      go(e.to, here, e.label ? [...conds, `${n.label} → ${e.label}`] : conds, new Set([...visited, e.to]));
    }
  };
  for (const s of g.nodes.filter((n) => n.type === 'start')) go(s.id, [], [], new Set([s.id]));
  return paths;
}

/** What changed between two versions of a workflow. */
export function diff(a: Graph, b: Graph) {
  const na = new Map(a.nodes.map((n) => [n.id, n])), nb = new Map(b.nodes.map((n) => [n.id, n]));
  const ek = (e: WEdge) => `${e.from}→${e.to}`;
  const ea = new Map(a.edges.map((e) => [ek(e), e])), eb = new Map(b.edges.map((e) => [ek(e), e]));
  return {
    nodesAdded: [...nb.values()].filter((n) => !na.has(n.id)).map((n) => n.label),
    nodesRemoved: [...na.values()].filter((n) => !nb.has(n.id)).map((n) => n.label),
    nodesChanged: [...nb.values()].filter((n) => na.has(n.id) && (na.get(n.id)!.label !== n.label || na.get(n.id)!.type !== n.type || na.get(n.id)!.role !== n.role)).map((n) => `${na.get(n.id)!.label} → ${n.label}`),
    edgesAdded: [...eb.keys()].filter((k) => !ea.has(k)),
    edgesRemoved: [...ea.keys()].filter((k) => !eb.has(k)),
    conditionsChanged: [...eb.values()].filter((e) => ea.has(ek(e)) && ea.get(ek(e))!.label !== e.label).map((e) => `${ek(e)}: "${ea.get(ek(e))!.label}" → "${e.label}"`),
  };
}

export const DETAIL_KEYS = ['inputs', 'outputs', 'rules', 'dependencies', 'validations', 'images', 'sources', 'lane', 'section', 'description'] as const;
export const graphToMermaid = (g: Graph) => toMermaid(g.nodes.map((n) => ({ id: n.id, label: `${n.label}${n.basis !== 'documented' && n.type !== 'start' && n.type !== 'end' ? ` (${n.basis})` : ''}`, type: n.type === 'decision' || n.type === 'start' || n.type === 'end' ? n.type : 'activity' })), g.edges, g.direction);

/** The TXT entry for a designer workflow (saved as a Draft through the normal rule lifecycle). */
export function graphToEntry(g: Graph, author: string): Entry {
  const clean = (s: string) => s.replace(/\|/g, '/').replace(/\n/g, ' ').trim();
  const id = g.id && /^WF-/.test(g.id) ? g.id : `WF-${idPart(g.name || 'WORKFLOW')}`;
  return makeEntry('workflow', id, {
    'WORKFLOW NAME': g.name || id, DESCRIPTION: g.description, DIRECTION: g.direction,
    NODES: g.nodes.map((n) => [n.id, n.type, clean(n.label), clean(n.role), clean(n.transaction), n.basis, clean(n.note), Math.round(n.x ?? 0), Math.round(n.y ?? 0)].join(' | ')).join('\n'),
    EDGES: g.edges.map((e) => [e.from, e.to, clean(e.label), e.kind ?? '', clean(e.condition ?? '')].join(' | ')).join('\n'),
    PRECONDITIONS: g.preconditions, POSTCONDITIONS: g.postconditions, EXCEPTIONS: g.exceptions, 'RELATED TRANSACTIONS': g.relatedTransactions,
    MODULE: g.module, SUBMODULE: g.submodule, FORMAT: g.format,
    ASSUMPTIONS: g.assumptions.map(clean).join('\n'), 'MISSING INFORMATION': g.missing.map(clean).join('\n'), DEPENDENCIES: g.dependencies.map(clean).join('\n'),
    'RELATED DOCUMENTS': g.relatedDocuments.map((r) => [r.id, clean(r.title), r.status].join(' | ')).join('\n'),
    REFERENCES: g.references.map((r) => [r.id, clean(r.title), r.kind, r.status].join(' | ')).join('\n'),
    'NODE DETAILS': writeDetails(g),
    STEPS: g.nodes.filter((n) => n.type !== 'start' && n.type !== 'end').map((n, i) => `${i + 1}. ${clean(n.label)}`).join('\n'),
    SOURCE: g.source || `Workflow designer, ${author}, ${today()}`, VERSION: String(g.version || 1), STATUS: 'Draft', 'CREATED DATE': today(), 'LAST UPDATED': today(),
  });
}

const SEP = ' ;; ';
const oneLine = (s: string) => s.replace(/\|/g, '/').replace(/\s+/g, ' ').replace(/;;/g, ';').trim();
/** NODE DETAILS lines: "<node id> | <key> | value ;; value". Rules keep only their IDs (title and status are read live). */
function writeDetails(g: Graph): string {
  const out: string[] = [];
  for (const n of g.nodes) {
    const put = (k: string, v: string[] | undefined) => { const vs = (v ?? []).map(oneLine).filter(Boolean); if (vs.length) out.push(`${n.id} | ${k} | ${vs.join(SEP)}`); };
    put('inputs', n.inputs); put('outputs', n.outputs); put('rules', n.rules?.map((r) => r.id)); put('dependencies', n.dependencies); put('validations', n.validations);
    put('images', n.images?.map((i) => `${i.src} ~ ${i.caption}`)); put('sources', n.sources);
    if (n.description) put('description', [n.description]);
    if (n.pinned) put('pinned', ['1']);
    if (n.lane) put('lane', [n.lane]);
    if (n.section) put('section', [n.section]);
  }
  return out.join('\n');
}
function readDetails(g: Graph, text: string): void {
  const byId = new Map(g.nodes.map((n) => [n.id, n]));
  for (const line of stepsOf(text)) {
    const [id, key, ...rest] = line.split('|').map((x) => x.trim());
    const n = byId.get(id);
    const vals = rest.join('|').split(SEP).map((x) => x.trim()).filter(Boolean);
    if (!n || !vals.length) continue;
    if (key === 'inputs' || key === 'outputs' || key === 'dependencies' || key === 'validations' || key === 'sources') n[key] = vals;
    else if (key === 'rules') n.rules = vals.map((rid) => { const e = getEntry(rid); return { id: rid, title: e?.title ?? rid, status: e?.status ?? '', category: e?.category ?? '' }; });
    else if (key === 'images') n.images = vals.map((v) => { const [src, ...cap] = v.split('~'); return { src: src.trim(), caption: cap.join('~').trim() }; });
    else if (key === 'lane') n.lane = vals[0];
    else if (key === 'description') n.description = vals.join(' ');
    else if (key === 'pinned') n.pinned = true;
    else if (key === 'section') n.section = vals[0];
  }
}
