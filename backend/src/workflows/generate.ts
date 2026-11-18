// Chat → workflow. Decides whether a message asks for a workflow (create / modify / compare) or only talks about one,
// finds the documented process behind a request, turns it into a graph whose steps carry what the documentation says
// about them (inputs, outputs, rules, dependencies, validations, screenshots, sources), and applies edit commands
// written in plain language. Nothing is invented: a step the user adds is marked proposed, and a step without
// documentation says so. A request the knowledge cannot answer returns a clarification, never an empty workflow.
import { all } from '../db.ts';
import { findTransaction, getEntry } from '../knowledge/repo.ts';
import type { EntryRow } from '../knowledge/repo.ts';
import { stepsOf } from '../knowledge/txt.ts';
import { normalize, stem } from '../search/lexicon.ts';
import { search } from '../search/search.ts';
import { diff, frame, graphFromEntry, graphFromText, layout } from './designer.ts';
import { docFlow } from './docflow.ts';
import { selectDiagram } from './select.ts';
import type { Selection } from './select.ts';
import type { Format, Graph, Ref, RuleRef, WNode } from './designer.ts';

export type WfKind = 'create' | 'modify' | 'compare' | 'explain' | 'none';
export interface DraftDoc {
  graph: Graph;
  detail: 'overview' | 'detailed';
  overlay: '' | 'validations' | 'rules' | 'io' | 'dependencies';
  collapsed: string[];
  compare: { with: string; changes: ReturnType<typeof diff> } | null;
  notes: string[];
  /** A second structured graph (statuses and transitions) when the source names statuses. */
  lifecycle: Graph | null;
  /** Why this picture was recommended and which others suit the same structure. */
  selection: Selection | null;
}

// ── intent ───────────────────────────────────────────────────────────────────────────────────────────────────────

const FLOW = /\b(work ?flows?|process ?flows?|flow ?charts?|flow ?diagrams?|swim ?lanes?|process ?maps?|lifecycle|life cycle|diagrams?|end to end flow)\b/;
const MAKE = /\b(create|generate|design|build|make|draw|visuali[sz]e|convert|turn|map out|produce|prepare|display|show|give me|put)\b/;
const STRONG_MAKE = /\b(create|generate|design|build|make|draw|visuali[sz]e|convert|turn|produce|prepare)\b/;
const EXPLAIN = /^(how|what|why|when|where|who|which|explain|describe|tell me|can you explain|does|is|are|do|should|can)\b/;
const EDIT_VERB = /^(please |now |also |then |and )*(add|insert|remove|delete|drop|rename|replace|change|move|swap|connect|link|include|highlight|expand|collapse|switch|set|use|undo|regenerate|show|display|convert|make|turn|hide|list|put)\b/;
const EDIT_OBJECT = /\b(step|steps|node|stage|stages|swim ?lane|validations?|controls?|overview|detail(ed)?|flow ?chart|sections?|phases?|rules?|lane|decision|inputs?|outputs?|dependenc(y|ies)|after|before|workflow|diagram|view|undo)\b/;

/** What a message asks for. `hasDraft`: the conversation already has a workflow draft that edits can apply to. */
export function workflowKind(text: string, mode: string, hasDraft: boolean): WfKind {
  const n = normalize(text.replace(/[→>-]+/g, ' to '));
  const t = n;
  if (!t) return 'none';
  if (FLOW.test(t) && /\b(compare|comparison|versus|vs|difference between)\b/.test(t)) return 'compare';
  if (hasDraft && EDIT_VERB.test(t) && EDIT_OBJECT.test(t) && !(STRONG_MAKE.test(t) && /\b(complete|whole|entire|new|another|different|full)\b/.test(t) && FLOW.test(t) && !/\b(this|it|the workflow|the diagram)\b/.test(t))) return 'modify';
  const asked = FLOW.test(t) && MAKE.test(t);
  if (asked && EXPLAIN.test(t) && !STRONG_MAKE.test(t)) return /\b(show|display)\b/.test(t) && !/^(how|what|why|when|where|who|which)\b/.test(t) ? 'create' : 'explain';
  if (asked) return 'create';
  if (mode === 'workflow') return EXPLAIN.test(t) && !STRONG_MAKE.test(t) ? 'explain' : 'create';
  if (FLOW.test(t) && EXPLAIN.test(t)) return 'explain';
  return 'none';
}

// ── finding the documented process ──────────────────────────────────────────────────────────────────────────────

const LEAD = /\b(please|kindly|can you|could you|i want( you)? to|i need( you)? to|i would like( you)? to|let'?s|lets|now|also|for me|me)\b/g;
const CMD = /\b(create|generate|design|build|make|draw|visuali[sz]e|convert|turn|map out|produce|prepare|display|show|give|put|put together|a|an|the|this|that|into|as|complete|full|entire|whole|detailed|interactive|new|overall|diagram|flowchart|flow chart|process flow|workflow|workflows|flow|swimlane|swim lane|lifecycle|life cycle|process|for|of|to|in|on|with|me)\b/g;
const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The thing the user wants a workflow of ("Create a workflow for Sales Order processing" → "sales order processing"). */
export function subjectOf(text: string): string {
  const n = normalize(text.replace(/[→]+/g, ' to ').replace(/[\/&]/g, ' ')).replace(LEAD, ' ');
  // generic words about the request itself ("processing", "steps", "overview") say nothing about which process is meant
  return clean(n.replace(CMD, ' ')).split(' ').filter((w) => !GENERIC.has(w) && !GENERIC.has(stem(w))).join(' ');
}
const GENERIC = new Set(['process', 'processing', 'processes', 'flow', 'flows', 'workflow', 'workflows', 'step', 'steps', 'procedure', 'procedures', 'lifecycle', 'cycle', 'overview', 'diagram', 'diagrams', 'detail', 'details', 'documented', 'visual', 'visualisation', 'visualization'].flatMap((w) => [w, stem(w)]));

interface Resolution { graph?: Graph; lifecycle?: Graph | null; clarify?: string; suggestions?: string[]; notes: string[] }
const toks = (s: string) => normalize(s).split(' ').filter((w) => w.length > 1 && !['the', 'and', 'for', 'of', 'to', 'in', 'a'].includes(w)).map(stem);

/** The best node of a graph for a few words, by shared stems (null if nothing is close). */
function nodeFor(g: Graph, text: string, skip = new Set(['start', 'end'])): WNode | null {
  const q = toks(text);
  if (!q.length) return null;
  let best: { n: WNode; score: number } | null = null;
  for (const n of g.nodes) {
    if (skip.has(n.type)) continue;
    const t = new Set(toks(`${n.label} ${n.transaction}`));
    const hit = q.filter((w) => t.has(w)).length;
    const score = hit / q.length + hit / (t.size + 1) * 0.2;
    if (hit && (!best || score > best.score)) best = { n, score };
  }
  return best && best.score >= 0.45 ? best.n : null;
}

/** All nodes on a path from `a` to `b` (descendants of a that are ancestors of b). */
function between(g: Graph, a: string, b: string): Set<string> {
  const reach = (start: string, rev: boolean) => {
    const seen = new Set([start]); const stack = [start];
    while (stack.length) { const x = stack.pop()!; for (const e of g.edges) { const [f, t] = rev ? [e.to, e.from] : [e.from, e.to]; if (f === x && !seen.has(t)) { seen.add(t); stack.push(t); } } }
    return seen;
  };
  const down = reach(a, false), up = reach(b, true);
  return new Set([...down].filter((x) => up.has(x)));
}

/** Explicit steps written in the request: numbered/bulleted lines, "A, then B, then C", or Mermaid. */
function explicitSteps(text: string): string | null {
  if (/^\s*(flowchart|graph|stateDiagram)\b/m.test(text) || /```/.test(text)) return text.replace(/```(mermaid)?/g, '').trim();
  const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
  const listed = lines.filter((l) => /^(\d+[.)]|[-•*])\s+\S/.test(l));
  if (listed.length >= 2) return listed.join('\n');
  const afterColon = text.includes(':') ? text.slice(text.indexOf(':') + 1) : text;
  const parts = afterColon.split(/\s*(?:,\s*then|\bthen\b|→|->|;\s*)\s*/i).map((x) => x.replace(/^(and|first|next|finally)\s+/i, '').trim()).filter(Boolean);
  if (parts.length >= 3 && parts.every((x) => x.split(' ').length <= 14)) return parts.join('\n');
  return null;
}

/** Dependencies of a transaction as a small graph: documented upstream → the transaction → documented downstream. */
function dependencyGraph(txn: EntryRow): Graph | null {
  const slug = txn.fields['SLUG'] ?? '';
  const deps = all<{ id: string }>("SELECT id FROM entries WHERE type = 'dependency' AND is_current = 1").map((r) => getEntry(r.id)!).filter(Boolean);
  const slugOf = (s: string | undefined) => /\(([a-z0-9-]+)\)\s*$/.exec(s ?? '')?.[1] ?? '';
  const edges = deps.map((d) => ({ from: slugOf(d.fields['FROM TRANSACTION']), to: slugOf(d.fields['TO TRANSACTION']), label: d.fields['DESCRIPTION'] ?? '' })).filter((e) => e.from && e.to);
  const rel = edges.filter((e) => e.from === slug || e.to === slug);
  if (!rel.length) return null;
  const g = graphShell(`${txn.title} in context`, `Documented upstream and downstream links of ${txn.title}.`);
  const ids = new Map<string, string>();
  const add = (s: string) => {
    if (ids.has(s)) return ids.get(s)!;
    const t = findTransaction(s); const id = `t_${s.replace(/[^a-z0-9]/g, '_')}`;
    ids.set(s, id);
    g.nodes.push({ id, type: 'activity', label: t?.title ?? s, role: '', transaction: s, basis: 'documented', note: s === slug ? 'The transaction asked about' : '' });
    return id;
  };
  add(slug);
  for (const e of rel) g.edges.push({ from: add(e.from), to: add(e.to), label: '' });
  g.basisNote = 'Each box is a documented transaction; each link is a documented dependency (hover a step for what is passed on).';
  for (const e of rel) { const n = g.nodes.find((x) => x.transaction === e.to && e.from !== slug); if (n && e.label) n.note = n.note || `Receives: ${e.label}`; }
  return layout(frame(g));
}

function graphShell(name: string, description: string): Graph {
  return { id: '', name, description, direction: 'TD', nodes: [], edges: [], preconditions: '', postconditions: '', exceptions: '', relatedTransactions: '', source: '', status: 'Draft', version: 0, basisNote: '', module: '', format: 'flowchart', references: [], submodule: '', assumptions: [], missing: [], dependencies: [], relatedDocuments: [] };
}

const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** Finds the documented process for a request and builds its graph; asks for clarification when nothing documents it. */
export function resolve(text: string): Resolution {
  const notes: string[] = [];
  const subject = subjectOf(text);
  const catalogue = () => all<{ title: string }>("SELECT title FROM entries WHERE type = 'workflow' AND is_current = 1 AND id NOT LIKE 'WF-DRAFT%' ORDER BY title").map((r) => r.title).slice(0, 12);

  // 1. steps written in the request
  const steps = explicitSteps(text);
  if (steps) {
    const g = graphFromText(steps, !text.includes(':') && subject && subject.split(' ').length <= 6 && !/\b(business|steps?|following)\b/.test(subject) ? titleCase(subject) : 'Workflow from your description');
    g.basisNote = 'Built from the steps you wrote; every step is marked proposed until a source documents it.';
    notes.push('Built from the steps written in the request.');
    return { graph: g, notes };
  }
  if (!subject || subject.split(' ').length < 1) return { clarify: 'Which process should the workflow show? For example "Sales Order processing", "MRP", "RMPO confirmation" or "end to end, from techpack to production order".', suggestions: catalogue(), notes };

  const e2e = graphFromEntry('WF-E2E-MATERIAL-FLOW');
  // 2. a stretch of the end-to-end flow: "from techpack to production order"
  const chain = /(?:^|\s)(?:from\s+)?(.+?)\s+(?:to|until|through|till)\s+(.+)$/.exec(subject);
  if (chain && e2e) {
    const a = nodeFor(e2e, chain[1]), b = nodeFor(e2e, chain[2]);
    if (a && b && a.id !== b.id) {
      let keep = between(e2e, a.id, b.id);
      if (keep.size < 2) keep = between(e2e, b.id, a.id);
      if (keep.size >= 2) {
        const g = { ...e2e, nodes: e2e.nodes.filter((n) => keep.has(n.id)).map((n) => ({ ...n, x: undefined, y: undefined })), edges: e2e.edges.filter((e) => keep.has(e.from) && keep.has(e.to)) };
        g.id = ''; g.name = `${a.label} to ${b.label}`; g.description = `The documented stretch of the end-to-end flow from "${a.label}" to "${b.label}".`; g.version = 0; g.status = 'Draft';
        g.basisNote = 'Steps and links are taken from the documented end-to-end flow (WF-E2E-MATERIAL-FLOW); Start and End are added by the designer.';
        g.references = [{ id: 'WF-E2E-MATERIAL-FLOW', title: e2e.name, kind: 'workflow', status: getEntry('WF-E2E-MATERIAL-FLOW')?.status ?? '' }];
        notes.push(`Used the documented end-to-end flow between "${a.label}" and "${b.label}".`);
        return { graph: layout(frame(g)), notes };
      }
    }
  }
  // 3. a stored workflow, procedure or transaction that is about the subject
  const sr = search(subject, { kinds: ['workflow', 'procedure', 'transaction'], intent: 'workflow', limit: 14 });
  const hits = sr.hits.filter((h) => h.entryId && h.coverage >= 0.6 && h.titleCoverage > 0 && !sr.unknownUnits.length);
  const pool = hits.length ? hits : sr.hits.filter((h) => h.entryId && h.coverage >= 0.8 && h.titleCoverage > 0);
  const wholeFlow = /\b(end to end|complete|entire|whole|garment|manufactur)/.test(normalize(text)) && !/\b(rmpo|grn|mrp|bom|bbb|fpo)\b/.test(normalize(text));
  let txnFallback: Resolution | null = null;
  const ordered = [...pool].sort((a, b) => Number(['workflow'].includes(b.kind)) - Number(['workflow'].includes(a.kind)) || b.score - a.score);
  for (const h of ordered) {
    const e = getEntry(h.entryId!);
    if (!e) continue;
    if (e.type === 'workflow' || (e.type === 'procedure' && stepsOf(e.fields['STEPS']).length >= 2)) {
      const g = graphFromEntry(e.id);
      if (g && g.nodes.length >= 3) {
        g.id = ''; g.version = 0; g.status = 'Draft'; g.name = e.title;
        g.references = [{ id: e.id, title: e.title, kind: e.type, status: e.status }];
        notes.push(`Used the stored ${e.type} ${e.id} (${e.status}).`);
        if (h.coverage < 1) {
          // only a partial match among the curated entries: a document written about the subject itself is a better source
          const df = docFlow(subject);
          if (df) return { graph: df.graph, lifecycle: df.lifecycle, notes: df.notes };
          notes.push(`This is the closest documented process for "${subject}"; it may not cover everything you asked.`);
        }
        return { graph: g, notes };
      }
    }
    if (e.type === 'transaction' && !txnFallback) {
      const g = dependencyGraph(e);
      if (g) { g.references = [{ id: e.id, title: e.title, kind: 'transaction', status: e.status }]; txnFallback = { graph: g, notes: [...notes, `No step-by-step flow is stored for ${e.title}; showing its documented upstream and downstream links.`] }; }
    }
  }
  // documents (specifications, manuals) that describe the process in their own words
  const fromDocs = docFlow(subject);
  if (fromDocs) return { graph: fromDocs.graph, lifecycle: fromDocs.lifecycle, notes: fromDocs.notes };
  if (txnFallback) return txnFallback;
  if (wholeFlow && e2e) {
    const g = { ...e2e, id: '', version: 0, status: 'Draft' }; g.references = [{ id: 'WF-E2E-MATERIAL-FLOW', title: e2e.name, kind: 'workflow', status: getEntry('WF-E2E-MATERIAL-FLOW')?.status ?? '' }];
    notes.push('Used the documented end-to-end flow.');
    return { graph: g, notes };
  }
  const found = ordered[0] ? getEntry(ordered[0].entryId!) : undefined;
  return {
    clarify: found
      ? `"${found.title}" is documented, but only as text without a step-by-step sequence, so a workflow would mean inventing the order. Paste the steps (one per line, or "A, then B, then C") and I will draw them, marked proposed.`
      : `The stored WFX documentation does not contain a process for "${subject}", so I did not draw one. Paste the steps you have (one per line), name a documented process, or ask for one of these:`,
    suggestions: found ? [] : catalogue(), notes,
  };
}

// ── what the documentation says about each step ─────────────────────────────────────────────────────────────────

interface Lookup { txns: EntryRow[]; rules: EntryRow[]; deps: EntryRow[]; models: EntryRow[] }
let cache: { at: number; lookup: Lookup } | null = null;
function lookup(): Lookup {
  if (cache && Date.now() - cache.at < 2000) return cache.lookup;
  const rows = (type: string) => all<{ id: string }>('SELECT id FROM entries WHERE type = ? AND is_current = 1', type).map((r) => getEntry(r.id)!).filter(Boolean);
  const lookup = { txns: rows('transaction'), rules: rows('rule'), deps: rows('dependency'), models: rows('model') };
  cache = { at: Date.now(), lookup };
  return lookup;
}
export const resetWorkflowCache = () => { cache = null; };

const slugOf = (s: string | undefined) => /\(([a-z0-9-]+)\)\s*$/.exec(s ?? '')?.[1] ?? '';
const lines = (s: string | undefined) => (s ?? '').split('\n').map((x) => x.trim()).filter(Boolean);

/** The transaction a step belongs to: by its transaction slug, then by its wording. */
function transactionOf(n: { label: string; transaction: string }, L: Lookup): EntryRow | undefined {
  if (n.transaction) { const t = L.txns.find((x) => x.fields['SLUG'] === n.transaction) ?? findTransaction(n.transaction); if (t) return t; }
  const label = n.label.toLowerCase();
  const direct = L.txns.find((t) => { const main = t.title.toLowerCase().split(/\s+[–-]\s+|\s*\(/)[0].trim(); return main.length >= 3 && new RegExp(`\\b${main.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(label); });
  return direct;
}

// ── Buyer Block Booking is not part of every order ──────────────────────────────────────────────────────────────

const isBbb = (n: WNode) => n.type !== 'start' && n.type !== 'end' && (n.transaction === 'buyer-block-booking' || /\bblock booking\b|\bBBB\b/i.test(n.label));

/**
 * An order is only sometimes booked against a Buyer Block Booking: the documented scenarios "Order without booking" and "Style setup only"
 * skip it. Every run of BBB steps therefore becomes an optional branch ("Booked against a Buyer Block Booking?" yes → the BBB steps,
 * no → straight on to what follows them). A workflow that is itself about BBB is left as it is. Safe to run twice.
 */
export function makeBookingOptional(g: Graph): Graph {
  const bbb = new Set(g.nodes.filter(isBbb).map((n) => n.id));
  const steps = g.nodes.filter((n) => n.type !== 'start' && n.type !== 'end').length;
  // a workflow about booking itself (or the "booked" scenarios) keeps its booking steps; so does one that already has the gateway
  if (!bbb.size || bbb.size >= steps * 0.55 || /block booking|\bbbb?\b|\bbooked\b|\bbooking\b/i.test(g.name) || g.nodes.some((n) => n.id.startsWith('bbb_gate'))) return g;
  // runs of connected BBB steps
  const seen = new Set<string>(); let gateNo = 0;
  for (const start of g.nodes.filter((n) => bbb.has(n.id))) {
    if (seen.has(start.id)) continue;
    const run = new Set<string>([start.id]); const q = [start.id];
    while (q.length) { const x = q.pop()!; for (const e of g.edges) { const o = e.from === x ? e.to : e.to === x ? e.from : null; if (o && bbb.has(o) && !run.has(o)) { run.add(o); q.push(o); } } }
    run.forEach((id) => seen.add(id));
    const entries = g.edges.filter((e) => run.has(e.to) && !run.has(e.from));
    const isEnd = (id: string) => g.nodes.find((n) => n.id === id)?.type === 'end';
    const exits = [...new Set(g.edges.filter((e) => run.has(e.from) && !run.has(e.to) && !isEnd(e.to)).map((e) => e.to))];
    if (!entries.length) continue; // at the start of the flow: nothing to bypass
    if (!exits.length) {
      // the booking steps are a side branch that leads nowhere else: they simply happen only when the order is booked
      for (const e of entries) { e.kind = 'optional'; e.label = e.label || 'only if the order is booked'; e.condition = 'the order is booked'; }
      continue;
    }
    const first = g.nodes.find((n) => run.has(n.id))!;
    const gate: WNode = {
      id: `bbb_gate${++gateNo === 1 ? '' : `_${gateNo}`}`, type: 'decision', label: 'Booked against a Buyer Block Booking?', role: '', transaction: 'buyer-block-booking', basis: 'inferred',
      note: 'Buyer Block Booking is not part of every order: the documented scenarios "Order without booking" (WF-SCENARIO-DIRECT) and "Style setup only" skip it. The booking steps are an optional branch.',
      description: 'Not every order is booked. If it is, follow the booking steps; if not, continue with the next step.', section: first.section, lane: first.lane, x: undefined as never, y: undefined as never,
      sources: ['WF-SCENARIO-DIRECT · Scenario: Order without booking'],
    };
    g.nodes.splice(g.nodes.indexOf(first), 0, gate);
    // everything that led into the run now leads into the gateway
    const targets = [...new Set(entries.map((e) => e.to))];
    for (const e of entries) e.to = gate.id;
    const seenIn = new Set<string>();
    g.edges = g.edges.filter((e) => { if (e.to !== gate.id) return true; const k = e.from; if (seenIn.has(k)) return false; seenIn.add(k); return true; });
    for (const t of targets) g.edges.push({ from: gate.id, to: t, label: 'yes (booked)', kind: 'condition', condition: 'the order is booked' });
    for (const t of exits) g.edges.push({ from: gate.id, to: t, label: 'no (not booked)', kind: 'optional', condition: 'the order is not booked' });
  }
  for (const n of g.nodes) { n.x = undefined as never; n.y = undefined as never; }
  layout(g);
  return g;
}

/** Fills each step with documented inputs, outputs, rules, dependencies, validations, screenshots and sources. */
export function enrich(g: Graph): Graph {
  makeBookingOptional(g);
  const L = lookup();
  const refs = new Map<string, Ref>(g.references.map((r) => [r.id, r]));
  const modules = new Map<string, number>();
  const trans = new Set<string>();
  for (const n of g.nodes) {
    if (n.type === 'start' || n.type === 'end') continue;
    const t = transactionOf(n, L);
    const label = n.label.toLowerCase();
    const rules = L.rules.filter((r) => {
      const rt = (r.txn ?? '').toLowerCase();
      if (!rt) return false;
      if (t && findTransaction(rt)?.id === t.id) return true;
      return rt.length >= 4 && (label.includes(rt) || (label.length >= 8 && rt.includes(label)));
    });
    if (t) {
      n.transaction = n.transaction || (t.fields['SLUG'] ?? '');
      const mod = t.fields['MODULE'] ?? '';
      if (mod) { n.lane = n.lane || mod; n.section = n.section || mod; modules.set(mod, (modules.get(mod) ?? 0) + 1); }
      trans.add(t.title);
      refs.set(t.id, { id: t.id, title: t.title, kind: 'transaction', status: t.status });
      const ups = L.deps.filter((d) => slugOf(d.fields['TO TRANSACTION']) === t.fields['SLUG']), downs = L.deps.filter((d) => slugOf(d.fields['FROM TRANSACTION']) === t.fields['SLUG']);
      n.dependencies = [...ups.map((d) => `Needs ${d.fields['FROM TRANSACTION']}${d.fields['DESCRIPTION'] ? `: ${d.fields['DESCRIPTION']}` : ''}`), ...downs.map((d) => `Feeds ${d.fields['TO TRANSACTION']}${d.fields['DESCRIPTION'] ? `: ${d.fields['DESCRIPTION']}` : ''}`)].slice(0, 12);
      n.images = L.models.filter((m) => m.fields['THEORY'] === t.fields['SLUG']).flatMap((m) => lines(m.fields['SCREENSHOTS']).filter((s) => /^\/screens\/[\w./-]+$/.test(s)).map((src) => ({ src, caption: m.title }))).slice(0, 4);
      n.sources = [...new Set([`${t.id} · ${t.title} (${t.status})`, ...(t.fields['SOURCE'] ? [t.fields['SOURCE'].slice(0, 160)] : [])])];
      n.inputs = [...lines(t.fields['UPSTREAM']).map((l) => `From upstream: ${l}`)];
      n.outputs = [...lines(t.fields['DOWNSTREAM']).map((l) => `To downstream: ${l}`)];
    } else if (!n.lane) n.lane = n.role ? n.role : 'General';
    if (rules.length) {
      n.rules = rules.slice(0, 10).map((r): RuleRef => ({ id: r.id, title: r.title, status: r.status, category: r.category ?? '' }));
      for (const r of rules.slice(0, 10)) refs.set(r.id, { id: r.id, title: r.title, kind: 'rule', status: r.status });
      n.inputs = [...new Set([...(n.inputs ?? []), ...rules.flatMap((r) => lines(r.fields['INPUT FIELDS']))])].slice(0, 14);
      n.outputs = [...new Set([...(n.outputs ?? []), ...rules.map((r) => r.fields['OUTPUT']).filter(Boolean)])].slice(0, 14);
      n.validations = [...rules.flatMap((r) => lines(r.fields['VALIDATIONS']).map((v) => `${v} (${r.id})`)), ...rules.filter((r) => /^(control|approval)$/i.test(r.category ?? '')).map((r) => `${r.category}: ${r.title} (${r.id})`)].slice(0, 12);
    }
    for (const k of ['inputs', 'outputs', 'dependencies', 'validations', 'images', 'rules'] as const) if (!n[k]?.length) delete n[k];
  }
  g.references = [...refs.values()];
  if (!g.module && modules.size) g.module = [...modules.entries()].sort((a, b) => b[1] - a[1])[0][0];
  if (!g.relatedTransactions && trans.size) g.relatedTransactions = [...trans].join('; ');
  if (!g.source) g.source = g.references.length ? `Generated from ${g.references.filter((r) => r.kind !== 'rule').slice(0, 4).map((r) => r.id).join(', ')}` : g.source;
  return g;
}

/** A draft document: the graph plus the recommended picture (chosen from the structure, or from what the request asked for). */
export function newDoc(graph: Graph, notes: string[] = [], request = '', lifecycle: Graph | null = null): DraftDoc {
  const selection = selectDiagram(graph, request, !!lifecycle);
  graph.format = selection.recommended;
  return { graph, detail: 'detailed', overlay: '', collapsed: [], compare: null, notes, lifecycle, selection };
}

// ── comparing two workflows ─────────────────────────────────────────────────────────────────────────────────────

export function compareRequest(text: string): { a: Resolution; b: Resolution; nameA: string; nameB: string } | { clarify: string } {
  const body = normalize(text).replace(/\b(please|can you|could you|compare|comparison|the|a|an|work ?flows?|process flows?|flows?|diagrams?|difference between|versus|vs)\b/g, ' ');
  const parts = body.split(/\b(?:with|and|against|to|from)\b/).map(clean).filter(Boolean);
  if (parts.length < 2) return { clarify: 'Which two workflows should I compare? For example "Compare the Sales Order workflow with the MRP workflow".' };
  const a = resolve(`workflow for ${parts[0]}`), b = resolve(`workflow for ${parts[1]}`);
  if (!a.graph || !b.graph) return { clarify: `I could not find a documented workflow for ${!a.graph ? `"${parts[0]}"` : `"${parts[1]}"`}, so there is nothing to compare yet.` };
  return { a, b, nameA: a.graph.name, nameB: b.graph.name };
}
export const compareGraphs = (a: Graph, b: Graph) => diff(a, b);

// ── edits written in plain language ─────────────────────────────────────────────────────────────────────────────

export interface EditResult { doc: DraftDoc; reply: string; changed: boolean; ok: boolean }
const FORMAT_WORDS: [RegExp, Format][] = [
  [/\bbpmn\b/, 'bpmn'], [/\bswim ?lanes?\b|\blanes?\b|\bcross functional\b/, 'swimlane'], [/\bdecision trees?\b/, 'decision-tree'], [/\b(state|status) (transition|diagram|machine)\b|\blife ?cycle\b/, 'lifecycle'],
  [/\btime ?lines?\b/, 'timeline'], [/\bhierarch(y|ical)\b|\btree\b/, 'hierarchy'], [/\bmind ?maps?\b/, 'mindmap'], [/\bdependenc(y|ies)\b/, 'dependency'], [/\bdata ?flows?\b/, 'dataflow'],
  [/\b(illustrated|visual)? ?guide\b/, 'guide'], [/\bflow ?chart\b/, 'flowchart'], [/\b(sections?|phases?|grouped|group by)\b/, 'sections'],
];
const fmtOf = (t: string): Format | null => FORMAT_WORDS.find(([re]) => re.test(t))?.[1] ?? null;
const relayout = (g: Graph) => { for (const n of g.nodes) { n.x = undefined; n.y = undefined; } layout(g); };
const uid = (g: Graph, base: string) => { const ids = new Set(g.nodes.map((n) => n.id)); const b = base.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 24) || 'step'; let id = b, i = 2; while (ids.has(id)) id = `${b}_${i++}`; return id; };

export const HELP = 'Things I can change: add a step after/before another ("Add the BOM creation step after article setup"), remove or rename a step, show validations, rules, inputs and outputs or dependencies on the steps, show it as a swimlane, flowchart or grouped sections, switch to an overview or the detailed view, or undo the last change.';

/** Applies one edit command to a draft. The graph is only changed when the command is understood. */
export function applyCommand(input: DraftDoc, text: string, who = 'the user'): EditResult {
  const doc: DraftDoc = structuredClone(input);
  const g = doc.graph;
  const t = normalize(text);
  const raw = text.trim().replace(/[.!]+$/, '');
  const fail = (reply: string): EditResult => ({ doc: input, reply, changed: false, ok: false });
  const done = (reply: string): EditResult => { doc.selection = selectDiagram(doc.graph, '', !!doc.lifecycle); return { doc, reply, changed: true, ok: true }; };
  const stepsText = () => g.nodes.filter((n) => n.type !== 'start' && n.type !== 'end').map((n) => n.label).slice(0, 12).join(', ');

  let m: RegExpExecArray | null;
  // add a step after / before another
  if ((m = /\b(?:add|insert|include|put)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?(?:step\s+(?:called\s+|named\s+|for\s+)?)?["“']?(.+?)["”']?\s*(?:step\s+)?\b(after|before)\b\s+(?:the\s+)?(.+?)(?:\s+step)?$/i.exec(raw))) {
    const label = clean(m[1]).replace(/^(a|an|the)\s+/i, '').replace(/\s+step$/i, '');
    const anchor = nodeFor(g, m[3], new Set(['start', 'end']));
    if (!label) return fail('What should the new step be called?');
    if (!anchor) return fail(`I could not find a step like "${m[3]}". The steps are: ${stepsText()}.`);
    const out = g.edges.filter((e) => e.from === anchor.id), inc = g.edges.filter((e) => e.to === anchor.id);
    if (m[2].toLowerCase() === 'after' && anchor.type === 'decision') return fail(`"${anchor.label}" is a decision with branches; say which branch step the new one comes after.`);
    const node: WNode = { id: uid(g, label), type: 'activity', label: titleCase(label.charAt(0)) + label.slice(1), role: '', transaction: '', basis: 'proposed', note: `Added by ${who} through the chat; not documented as a step of this workflow.` };
    g.nodes.push(node);
    if (m[2].toLowerCase() === 'after') {
      for (const e of out) e.from = node.id;
      g.edges.push({ from: anchor.id, to: node.id, label: '' });
      if (!out.length) g.edges.push({ from: node.id, to: g.nodes.find((n) => n.type === 'end')?.id ?? node.id, label: '' });
    } else {
      for (const e of inc) e.to = node.id;
      g.edges.push({ from: node.id, to: anchor.id, label: '' });
    }
    g.edges = g.edges.filter((e) => e.from !== e.to);
    enrich(g);
    relayout(g);
    const related = node.transaction ? ` It matches the documented transaction "${node.transaction}", whose rules, inputs and screens are attached to the step.` : ' Nothing in the documentation describes this step, so it is marked proposed.';
    return done(`Added "${node.label}" ${m[2].toLowerCase()} "${anchor.label}".${related}`);
  }
  // add a step at the end
  if ((m = /\b(?:add|insert)\s+(?:a\s+|an\s+|the\s+)?(?:new\s+)?step\s+(?:called\s+|named\s+)?["“']?(.+?)["”']?$/i.exec(raw))) {
    const label = clean(m[1]);
    const end = g.nodes.find((n) => n.type === 'end');
    const last = end ? g.edges.filter((e) => e.to === end.id) : [];
    const node: WNode = { id: uid(g, label), type: 'activity', label: label.charAt(0).toUpperCase() + label.slice(1), role: '', transaction: '', basis: 'proposed', note: `Added by ${who} through the chat; not documented as a step of this workflow.` };
    g.nodes.push(node);
    if (end) { for (const e of last) e.to = node.id; g.edges.push({ from: node.id, to: end.id, label: '' }); }
    enrich(g); relayout(g);
    return done(`Added "${node.label}" as the last step (marked proposed).`);
  }
  // remove
  if ((m = /\b(?:remove|delete|drop)\s+(?:the\s+)?(.+?)(?:\s+step)?$/i.exec(raw)) && !/\b(validations?|rules?|overlay)\b/.test(t)) {
    const n = nodeFor(g, m[1]);
    if (!n) return fail(`I could not find a step like "${m[1]}". The steps are: ${stepsText()}.`);
    const inc = g.edges.filter((e) => e.to === n.id), out = g.edges.filter((e) => e.from === n.id);
    g.edges = g.edges.filter((e) => e.to !== n.id && e.from !== n.id);
    g.nodes = g.nodes.filter((x) => x.id !== n.id);
    for (const i of inc) for (const o of out) if (!g.edges.some((e) => e.from === i.from && e.to === o.to)) g.edges.push({ from: i.from, to: o.to, label: i.label || o.label });
    relayout(g);
    return done(`Removed "${n.label}"${inc.length && out.length ? ' and joined the steps around it' : ''}.`);
  }
  // rename
  if ((m = /\brename\s+(?:the\s+)?(.+?)(?:\s+step)?\s+to\s+["“']?(.+?)["”']?$/i.exec(raw))) {
    const n = nodeFor(g, m[1]);
    if (!n) return fail(`I could not find a step like "${m[1]}". The steps are: ${stepsText()}.`);
    const old = n.label; n.label = clean(m[2]); n.basis = n.basis === 'documented' ? 'proposed' : n.basis;
    return done(`Renamed "${old}" to "${n.label}" (a renamed documented step is marked proposed).`);
  }
  // overlays
  const overlay = /\bvalidations?\b|\bcontrols?\b/.test(t) ? 'validations' : /\brules?\b/.test(t) ? 'rules' : /\b(inputs?|outputs?)\b/.test(t) ? 'io' : /\bdependenc(y|ies)\b/.test(t) ? 'dependencies' : null;
  if (overlay && /\b(show|display|add|include|highlight|list|give|what|apply|applicable)\b/.test(t)) {
    enrich(g);
    doc.overlay = overlay; doc.detail = 'detailed';
    const steps = g.nodes.filter((n) => n.type !== 'start' && n.type !== 'end');
    const key = overlay === 'validations' ? 'validations' : overlay === 'rules' ? 'rules' : overlay === 'dependencies' ? 'dependencies' : 'inputs';
    const have = steps.filter((n) => (n[key]?.length ?? 0) > 0);
    const none = steps.filter((n) => !(n[key]?.length));
    const what = overlay === 'io' ? 'inputs and outputs' : overlay;
    const total = have.reduce((a, n) => a + (n[key]?.length ?? 0), 0);
    return done(`${what.charAt(0).toUpperCase() + what.slice(1)} are now shown on the steps: ${total} documented item(s) across ${have.length} of ${steps.length} step(s).${none.length ? ` Not documented for: ${none.slice(0, 8).map((n) => n.label).join(', ')}${none.length > 8 ? ' …' : ''}.` : ''}${overlay === 'validations' && !total ? ' The stored documentation records no validations for these steps; I have not made any up.' : ''}`);
  }
  // clear overlays
  if (/\b(hide|remove|clear|turn off)\b/.test(t) && /\b(validations?|rules?|inputs?|outputs?|overlay|details?)\b/.test(t)) { doc.overlay = ''; return done('Hid the extra detail on the steps.'); }
  // view format and level of detail
  const fmt = fmtOf(t);
  if (fmt && /\b(show|display|switch|convert|change|make|turn|view|use|as|into|in|draw)\b/.test(t)) {
    if (fmt === 'lifecycle' && !doc.lifecycle) return fail('No statuses are documented for this process, so there is no status lifecycle to draw. The other views are available.');
    g.format = fmt;
    doc.collapsed = [];
    const why = doc.selection?.alternatives.find((a) => a.format === fmt)?.reason ?? (doc.selection?.recommended === fmt ? 'This is the recommended view.' : '');
    return done(`Shown as ${fmt === 'bpmn' ? 'a BPMN-style process' : `a ${fmt.replace('-', ' ')}`}; the same steps and links${why ? `. ${why}` : ''}`);
  }
  if (/\b(overview|summary|high level|collapse all|collapsed)\b/.test(t)) { doc.detail = 'overview'; doc.collapsed = [...new Set(g.nodes.map((n) => n.section).filter((s): s is string => !!s))]; if (g.format === 'flowchart') g.format = 'sections'; return done('Switched to the overview: sections are collapsed to one box each.'); }
  if (/\b(detail|detailed|expand all|expand everything|full view|everything)\b/.test(t)) { doc.detail = 'detailed'; doc.collapsed = []; return done('Switched to the detailed view: every step is shown.'); }
  return fail(`I did not understand that change, so I left the workflow as it is. ${HELP}`);
}
