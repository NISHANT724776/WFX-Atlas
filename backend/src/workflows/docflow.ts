// A workflow from what DOCUMENTS say. Until now workflows could only be drawn from hand-written library entries, so a process
// described in a specification (Kit/Pack, for example) came out as "not documented". This reads the document sections that
// describe the process and builds a structured graph from them:
//   • the step list ("Step by Step Working", "Process / Workflow") becomes the main path,
//   • conditions in the text ("If the Ratio type is Size Ratio then …, if Color Ratio then …", "single PO for a Pack; multiple
//     POs for a KIT", "Component Type: Single (Pack) or Multi (Kit)", "(optional)") become decisions with labelled branches,
//   • validations, business rules and user messages are attached to the step they are about,
//   • field tables of a screen/tab become the inputs of the step that works on that screen,
//   • statuses ("Open = …, Approved = …") become a separate state-transition graph.
// Every node and branch keeps the document, version and section it came from. A rule that cannot be tied to a step is kept as
// a workflow-level exception, never dropped and never placed by guessing.
import { all } from '../db.ts';
import { normalize, stem } from '../search/lexicon.ts';
import { search } from '../search/search.ts';
import { frame, layout } from './designer.ts';
import type { Graph, Ref, WEdge, WNode } from './designer.ts';

interface Chunk { id: number; kind: string; heading: string; text: string; docId: string; docVersion: number; locator: string; status: string }
interface DocInfo { id: string; title: string; module: string; submodule: string; status: string; version: number; score: number }
export interface DocFlow { graph: Graph; lifecycle: Graph | null; notes: string[]; primary: DocInfo; others: DocInfo[] }

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'will', 'can', 'then', 'into', 'its', 'has', 'have', 'been', 'was', 'were', 'when', 'where', 'each', 'one', 'all', 'any', 'user', 'system', 'also', 'not', 'only']);
const toks = (s: string) => normalize(s).split(' ').filter((w) => w.length > 2 && !STOP.has(w)).map(stem);
const overlap = (a: string[], b: Set<string>) => a.filter((w) => b.has(w)).length;
const tail = (heading: string) => heading.split(' › ').pop() ?? heading;
const lines = (t: string) => t.split('\n').map((l) => l.trim()).filter(Boolean);
const bullet = (l: string) => /^([•\-*·▪]|\d+[.)])\s+/.test(l);
const unbullet = (l: string) => l.replace(/^([•\-*·▪]|\d+[.)])\s+/, '').trim();
const short = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s);

const PROCESS = /\b(step by step|process|workflow|procedure|how it works|flow)\b/i;
const RULES = /\b(validation|business rule|key functional|acceptance|rules?)\b/i;
const ASSUME = /\b(assumption|dependenc|prerequisite|out of scope)\b/i;

function docsFor(subject: string): DocInfo[] {
  const sr = search(subject, { limit: 80 });
  if (sr.unknownUnits.length) return [];
  const score = new Map<string, number>();
  for (const h of sr.hits) if (h.docId && h.isCurrent && h.coverage >= 0.6) score.set(h.docId, (score.get(h.docId) ?? 0) + h.score * (0.5 + h.coverage) + (h.titleCoverage > 0 ? 1 : 0));
  // documents whose own title is about the subject count even when few passages rank
  const q = new Set(toks(subject));
  for (const d of all<{ id: string; title: string }>('SELECT id, title FROM documents')) { const t = new Set(toks(d.title)); if (q.size && [...q].every((w) => t.has(w))) score.set(d.id, (score.get(d.id) ?? 0) + 2); }
  const out: DocInfo[] = [];
  for (const [id, s] of score) {
    const d = all<Record<string, unknown>>('SELECT * FROM documents WHERE id = ?', id)[0];
    if (d) out.push({ id, title: String(d['title']), module: String(d['module'] ?? ''), submodule: String(d['submodule'] ?? ''), status: String(d['knowledge_status']), version: Number(d['current_version']), score: s });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 8);
}

const chunksOf = (d: DocInfo): Chunk[] =>
  all<Record<string, unknown>>("SELECT id, kind, heading, text, doc_id, doc_version, locator, status FROM chunks WHERE doc_id = ? AND doc_version = ? AND kind IN ('section', 'data_row') AND is_current = 1 ORDER BY id", d.id, d.version)
    .map((r) => ({ id: Number(r['id']), kind: String(r['kind']), heading: String(r['heading']), text: String(r['text']), docId: String(r['doc_id']), docVersion: Number(r['doc_version']), locator: String(r['locator'] ?? ''), status: String(r['status']) }));

interface Step { title: string; description: string; optional: boolean; parallel: boolean; locator: string }

function stepsOf(chunks: Chunk[]): { steps: Step[]; heading: string } | null {
  let best: { steps: Step[]; heading: string } | null = null;
  for (const c of chunks) {
    if (c.kind !== 'section' || !PROCESS.test(tail(c.heading)) || /screen|message|words used|lifecycle|status/i.test(tail(c.heading))) continue;
    const ls = lines(c.text);
    const picked = ls.filter(bullet).length >= 3 ? ls.filter(bullet).map(unbullet) : ls.filter((l) => l.length > 12 && !/:$/.test(l) && !/^(example|note)\b/i.test(l));
    const steps = picked.map((t): Step => {
      const m = /^([^.:]{3,80})[.:]\s+(.+)$/.exec(t);
      const title = m ? m[1].trim() : short(t.split(/[,;—]|\s-\s/)[0].trim(), 80);
      return { title, description: t, optional: /\(optional\)|\boptional(ly)?\b/i.test(t), parallel: /\b(in parallel|simultaneously|at the same time|meanwhile)\b/i.test(t), locator: c.locator };
    }).filter((s) => s.title.length >= 3);
    if (steps.length >= 3 && (!best || steps.length > best.steps.length)) best = { steps, heading: c.heading };
  }
  return best;
}

interface Branch { cond: string; outcome: string }
interface Decision { question: string; branches: Branch[]; context: string; locator: string; sentence: string }

const cleanOutcome = (o: string) => o.replace(/\.$/, '').replace(/^(then|while\s+\w+ing|in that case)\s+/i, '').replace(/^(it|the system)\s+(will\s+)?/i, '').replace(/^\w/, (c) => c.toUpperCase());
const sentences = (t: string) => t.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+(?=[A-Z•(])|\s*•\s+/).map((s) => s.trim()).filter((s) => s.length > 15);

/** Decisions stated by the text: if/when/where chains, "A for X; B for Y" contrasts, and "A or B" choices with a stated consequence. */
function decisionsOf(chunks: Chunk[]): Decision[] {
  const out: Decision[] = [];
  const key = (q: string) => q.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const add = (d: Decision) => { if (d.branches.length >= 2 && !out.some((x) => key(x.question) === key(d.question))) out.push(d); };
  for (const c of chunks) {
    if (c.kind === 'section') {
      for (const s of sentences(c.text)) {
        // "If the Ratio type is Size Ratio then …, if Color Ratio then …"
        const parts = s.split(/\s*[,;&]\s*(?=(?:and\s+)?(?:if|when|where|in case)\b)|(?<=\.)\s*(?=(?:if|when|where)\b)/i);
        if (parts.length >= 2) {
          const br = parts.map((p) => /^(?:and\s+)?(?:if|when|where|in case)\s+(.+?)\s*(?:,|—|\bthen\b)\s*(.+)$/i.exec(p.trim())).filter((m): m is RegExpExecArray => !!m);
          if (br.length >= 2) {
            const first = br[0][1];
            const question = short(first.replace(/^the\s+/i, '').replace(/\b(is|are|equals?)\b.*$/i, '').trim() || first, 48);
            add({ question: `${question}?`, branches: br.map((m) => ({ cond: short(m[1].replace(/^the\s+/i, '').replace(/^.*\b(?:is|are)\s+/i, ''), 48), outcome: cleanOutcome(m[2]) })), context: `${c.heading} ${s}`, locator: c.locator, sentence: s });
          }
        }
        // "single PO for a Pack; multiple POs for a KIT"
        const con = /([^;()]{4,60}?)\s+for an?\s+([A-Za-z/][\w/ -]{1,24}?)\s*;\s*([^;()]{4,60}?)\s+for an?\s+([A-Za-z/][\w/ -]{1,24}?)(?=[)\s.,]|$)/i.exec(s);
        if (con) add({ question: `${short(con[2], 20)} or ${short(con[4], 20)}?`, branches: [{ cond: con[2].trim(), outcome: con[1].replace(/^[(\s]+/, '').trim() }, { cond: con[4].trim(), outcome: con[3].replace(/^[(\s]+/, '').trim() }], context: `${c.heading} ${s}`, locator: c.locator, sentence: s });
      }
    }
  }
  // "Field: A or B" rows with a consequence line for each option elsewhere ("Color Ratio — one size, many colours")
  for (const c of chunks.filter((x) => x.kind === 'data_row')) {
    const m = /^(?:Field|Column):\s*([^;]+);.*?Rules?:\s*(.+)$/i.exec(c.text);
    if (!m) continue;
    const opts = m[2].replace(/\(see[^)]*\)/i, '').split(/\s+or\s+/i).map((o) => o.trim().replace(/[.]$/, ''));
    if (opts.length !== 2 || opts.some((o) => o.length < 3 || o.length > 40 || /^(up to|a whole|pick|free|as per)/i.test(o))) continue;
    const consequence = (o: string) => {
      const key = o.replace(/\s*\(.*\)/, '').trim().toLowerCase();
      for (const k of chunks.filter((x) => x.kind === 'section')) for (const l of lines(k.text)) {
        const t = unbullet(l);
        if (t.toLowerCase().startsWith(key) && /[—:-]\s*\S/.test(t.slice(key.length, key.length + 4))) return t.slice(key.length).replace(/^\s*[—:-]\s*/, '').replace(/\.$/, '');
      }
      return '';
    };
    const branches = opts.map((o) => ({ cond: o, outcome: consequence(o) }));
    // a plain "A or B" field is only a decision when the document says what each choice leads to
    if (branches.some((b) => b.outcome)) add({ question: `${short(m[1].replace(/\(.*\)/, '').trim(), 28)}?`, branches, context: `${c.heading} ${c.text}`, locator: c.locator, sentence: c.text });
  }
  return out.slice(0, 6);
}

const ROLE = /^(?:the\s+)?(planner|costing team|merchandiser|buyer|approver|supplier|store (?:keeper|team)|inventory team|production team|sourcing team|designer|admin(?:istrator)?)\s+(?:will|can|should|must|clicks?|selects?|creates?|raises?|approves?|checks?|adds?)\b/i;
const SCREEN = /\b(?:[Oo]n|[Ii]n|[Ff]rom|[Aa]t)\s+the\s+["“]?([A-Z][\w/&' -]{2,40}?)["”]?\s+(tab|screen|page|list|pop-?up)\b/;

/** Builds a workflow from the best document(s) for a subject, or null when no document describes a process for it. */
export function docFlow(subject: string): DocFlow | null {
  const docs = docsFor(subject);
  let primary: DocInfo | null = null, chunks: Chunk[] = [], found: ReturnType<typeof stepsOf> = null;
  for (const d of docs) {
    const cs = chunksOf(d), s = stepsOf(cs);
    if (s && (!found || d === docs[0])) { if (!primary) { primary = d; chunks = cs; found = s; } }
  }
  if (!primary || !found) return null;
  const doc = primary;
  const src = (locator: string) => `${doc.id} v${doc.version} · ${doc.title}${locator ? ` · ${locator.replace(/^§\s*/, '§ ')}` : ''}`;
  const g: Graph = {
    id: '', name: `${doc.title}`, description: `Built from ${doc.id} (${doc.title}), section "${tail(found.heading)}".`, direction: 'TD', nodes: [], edges: [], preconditions: '', postconditions: '', exceptions: '', relatedTransactions: '',
    source: `${doc.id} v${doc.version}`, status: 'Draft', version: 0, basisNote: `Steps, conditions, validations and field rules were read from ${doc.id} "${doc.title}" (${doc.status}). Each step names its section; Start and End are added by the designer.`,
    module: doc.module, format: 'flowchart', references: [{ id: doc.id, title: doc.title, kind: 'document', status: doc.status }], submodule: doc.submodule, assumptions: [], missing: [], dependencies: [], relatedDocuments: [],
  };
  const notes: string[] = [`Read the process from ${doc.id} "${doc.title}" (${doc.status}), section "${tail(found.heading)}".`];

  // main path
  let n = 0;
  const mk = (type: WNode['type'], label: string, description: string, locator: string, basis: WNode['basis'] = 'documented'): WNode => {
    const role = ROLE.exec(description.trim())?.[1] ?? '';
    const screen = SCREEN.exec(description)?.[1] ?? '';
    return { id: `n${++n}`, type, label, description, role: role ? role.replace(/^\w/, (c) => c.toUpperCase()) : '', transaction: '', basis, note: '', lane: screen || undefined, section: tail(found!.heading), sources: [src(locator)] };
  };
  const stepNodes = found.steps.map((s) => mk('activity', s.title, s.description, s.locator));
  g.nodes.push(...stepNodes);
  const succ = (i: number) => stepNodes[i + 1]?.id ?? '';
  // sequence, with optional steps as a gateway that can be skipped, and "at the same time" steps as parallel paths
  let k = 0;
  const link = (from: string, to: string, label = '', kind: WEdge['kind'] = 'sequence', condition = '') => g.edges.push({ id: `e${++k}`, from, to, label, kind, ...(condition ? { condition } : {}) });
  for (let i = 0; i < stepNodes.length; i++) {
    const cur = stepNodes[i], next = stepNodes[i + 1], step = found.steps[i];
    if (!next) break;
    if (found.steps[i + 1].optional) {
      const gate = mk('decision', `${short(found.steps[i + 1].title.replace(/\s*\(optional\)/i, ''), 34)}?`, 'The source marks the next step as optional.', found.steps[i + 1].locator);
      g.nodes.push(gate);
      link(cur.id, gate.id);
      link(gate.id, next.id, 'yes', 'condition', 'wanted');
      const after = stepNodes[i + 2];
      if (after) link(gate.id, after.id, 'no (optional)', 'optional', 'not wanted');
      continue;
    }
    if (step.parallel && stepNodes[i + 2]) { link(cur.id, next.id, '', 'parallel'); link(cur.id, stepNodes[i + 2].id, '', 'parallel'); continue; }
    if (i > 0 && found.steps[i - 1].parallel) continue;
    link(cur.id, next.id);
  }
  // optional steps still continue to what follows them
  for (let i = 1; i < stepNodes.length - 1; i++) if (found.steps[i].optional && !g.edges.some((e) => e.from === stepNodes[i].id)) link(stepNodes[i].id, stepNodes[i + 1].id);

  // matching a statement to the step it is about
  const stepTokens = stepNodes.map((s) => new Set(toks(`${s.label} ${s.description}`)));
  const bestStep = (text: string, min = 2): WNode | null => {
    const t = toks(text);
    let bi = -1, bs = 0;
    stepTokens.forEach((st, i) => { const o = overlap(t, st); const sc = o + (o ? 0.01 * i : 0); if (o >= min && sc > bs) { bs = sc; bi = i; } });
    return bi >= 0 ? stepNodes[bi] : null;
  };

  // decisions
  const unplaced: string[] = [];
  for (const d of decisionsOf(chunks)) {
    const at = bestStep(`${d.context}`, 2);
    if (!at) { unplaced.push(`${d.question} ${d.branches.map((b) => `${b.cond}${b.outcome ? ` → ${b.outcome}` : ''}`).join(' | ')} (${src(d.locator)})`); continue; }
    const gate = mk('decision', d.question, d.sentence, d.locator);
    g.nodes.push(gate);
    // the decision sits right after the step; every branch rejoins where the step used to lead
    const target = g.edges.find((e) => e.from === at.id)?.to;
    g.edges = g.edges.filter((e) => e.from !== at.id);
    link(at.id, gate.id);
    for (const b of d.branches) {
      if (b.outcome) {
        const o = mk('activity', short(cleanOutcome(b.outcome), 70), b.outcome, d.locator);
        g.nodes.push(o);
        link(gate.id, o.id, short(b.cond, 40), 'condition', b.cond);
        if (target) link(o.id, target);
      } else if (target) link(gate.id, target, short(b.cond, 40), 'condition', b.cond);
    }
  }

  // validations, rules, messages and field rules → the step they are about
  const attach = (n: WNode, key: 'validations' | 'inputs', text: string) => { (n[key] ??= []).push(text); };
  for (const c of chunks) {
    const h = tail(c.heading);
    if (c.kind === 'section' && RULES.test(h)) {
      for (const l of lines(c.text)) {
        const t = unbullet(l);
        if (t.length < 15) continue;
        const at = bestStep(t, 2);
        const line = `${t} (${doc.id} § ${h})`;
        if (at) attach(at, 'validations', line); else g.exceptions = `${g.exceptions}${g.exceptions ? '\n' : ''}${line}`;
      }
    } else if (c.kind === 'section' && ASSUME.test(h)) {
      for (const l of lines(c.text)) { const t = unbullet(l); if (t.length > 8) g.assumptions.push(/out of scope/i.test(h) ? `Out of scope: ${t}` : t); }
    } else if (c.kind === 'data_row') {
      const m = /^When:\s*([^;]+);\s*Title:\s*([^;]+);\s*Message:\s*(.+)$/i.exec(c.text);
      if (m) {
        const at = bestStep(`${m[1]} ${m[2]}`, 1);
        const line = `${m[2].trim()}: ${m[3].trim()} (when ${m[1].trim().toLowerCase()}) (${doc.id} § ${h})`;
        if (at) attach(at, 'validations', line); else g.exceptions = `${g.exceptions}${g.exceptions ? '\n' : ''}${line}`;
        continue;
      }
      // a field of a screen/tab: it is an input of the step that works on that screen
      const f = /^(?:Field|Column|Term|Menu option):\s*([^;]+);(.*)$/i.exec(c.text);
      if (f && /\b(tab|screen|page|pop-?up|list)\b/i.test(c.heading)) {
        const at = bestStep(`${c.heading}`, 2);
        if (at && (at.inputs?.length ?? 0) < 14) attach(at, 'inputs', `${f[1].trim()}${f[2] ? ` — ${f[2].replace(/;\s*/g, '; ').replace(/^\s*;?\s*/, '').trim()}` : ''}`);
      }
    }
  }
  for (const u of unplaced) g.exceptions = `${g.exceptions}${g.exceptions ? '\n' : ''}Condition not tied to a step: ${u}`;

  // status lifecycle: "Open = still being worked on. Approved = final and locked."
  let lifecycle: Graph | null = null;
  for (const c of chunks.filter((x) => x.kind === 'data_row')) {
    if (!/\bstatus(es)?\b/i.test(c.text)) continue;
    const states = [...c.text.matchAll(/\b([A-Z][a-z]+)\s*=\s*([^.;]+)/g)].map((m) => ({ name: m[1], text: m[2].trim() }));
    if (states.length < 2) continue;
    lifecycle = { ...g, id: '', name: `${doc.title} · status lifecycle`, description: `Statuses named in ${doc.id}.`, nodes: [], edges: [], format: 'lifecycle', exceptions: '', assumptions: [], missing: [], references: g.references };
    const ids = states.map((s, i) => { const nd: WNode = { id: `st${i + 1}`, type: 'state', label: s.name, description: s.text, role: '', transaction: '', basis: 'documented', note: '', sources: [src(c.locator)] }; lifecycle!.nodes.push(nd); return nd.id; });
    for (let i = 0; i + 1 < ids.length; i++) {
      const verb = stepNodes.find((s) => stem(normalize(s.label).split(' ')[0] ?? '') === stem(normalize(states[i + 1].name).replace(/d$/, '')) || toks(s.label).includes(stem(states[i + 1].name.toLowerCase().replace(/d$/, ''))));
      lifecycle.edges.push({ id: `t${i + 1}`, from: ids[i], to: ids[i + 1], label: verb ? verb.label : '', kind: 'transition' });
    }
    layout(frame(lifecycle));
    break;
  }

  // other documents about the same subject, and whether they disagree
  const others = docs.filter((d) => d.id !== doc.id);
  for (const o of others.slice(0, 7)) {
    if (g.relatedDocuments.length < 5) g.relatedDocuments.push({ id: o.id, title: o.title, kind: 'document', status: o.status });
    const os = stepsOf(chunksOf(o));
    if (os) {
      const a = new Set(found.steps.flatMap((s) => toks(s.title))), b = new Set(os.steps.flatMap((s) => toks(s.title)));
      const inter = [...a].filter((x) => b.has(x)).length, jac = inter / (a.size + b.size - inter || 1);
      if (jac < 0.3) g.missing.push(`${o.id} "${o.title}" also describes a process for this subject and differs from ${doc.id} (similarity ${Math.round(jac * 100)} %). This workflow follows ${doc.id}; resolve the difference before approving.`);
    }
  }
  // the owner's diagrams and screenshots about the subject
  const q = new Set(toks(subject));
  for (const im of all<Record<string, unknown>>("SELECT id, title, current_version FROM documents WHERE doc_type = 'diagram' OR ext IN ('png', 'jpg', 'jpeg', 'webp')")) {
    const t = new Set(toks(String(im['title'])));
    if (q.size && [...q].every((w) => t.has(w)) && !g.relatedDocuments.some((r) => r.id === im['id'])) g.relatedDocuments.push({ id: String(im['id']), title: String(im['title']), kind: 'image', status: 'source-documented' });
  }
  g.relatedTransactions = g.relatedTransactions || doc.module;
  // steps with no documented rule or validation say so; nothing is invented
  const bare = stepNodes.filter((s) => !s.validations?.length).length;
  if (bare === stepNodes.length) g.missing.push('The document states no validation or business rule that could be tied to a specific step.');
  layout(frame(g));
  g.edges = g.edges.filter((e) => e.from !== e.to);
  notes.push(`${found.steps.length} documented steps, ${g.nodes.filter((x) => x.type === 'decision').length} decision(s), ${stepNodes.filter((s) => s.validations?.length).length} step(s) with validations or messages, ${stepNodes.filter((s) => s.inputs?.length).length} with field rules.`);
  if (lifecycle) notes.push(`Status lifecycle found: ${lifecycle.nodes.map((s) => s.label).join(' → ')}.`);
  if (g.missing.length) notes.push(`${g.missing.length} open point(s) listed under Missing information.`);
  return { graph: g, lifecycle, notes, primary: doc, others };
}
