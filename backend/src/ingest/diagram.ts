// Mermaid diagrams → nodes, edges, decisions, labels, direction, start and end points (flowchart / graph, state,
// sequence and ER diagrams). Structure is kept, not flattened to text.

export interface DNode { id: string; label: string; shape: string; type: 'start' | 'end' | 'decision' | 'activity' | 'entity' | 'participant' | 'state' }
export interface DEdge { from: string; to: string; label: string; style: string }
export interface Diagram { kind: 'flowchart' | 'state' | 'sequence' | 'er' | 'other'; direction: string; nodes: DNode[]; edges: DEdge[]; starts: string[]; ends: string[]; groups: { name: string; nodes: string[] }[]; problems: string[] }

const SHAPES: [RegExp, string][] = [
  [/^\(\((.*)\)\)$/, 'circle'], [/^\(\[(.*)\]\)$/, 'stadium'], [/^\[\[(.*)\]\]$/, 'subroutine'], [/^\[\((.*)\)\]$/, 'database'],
  [/^\{\{(.*)\}\}$/, 'hexagon'], [/^\{(.*)\}$/, 'decision'], [/^\[(.*)\]$/, 'box'], [/^\((.*)\)$/, 'round'], [/^>(.*)\]$/, 'flag'],
];

function parseNodeRef(raw: string): { id: string; label?: string; shape?: string } | null {
  const s = raw.trim().replace(/:::\w+$/, '');
  const m = /^([A-Za-z0-9_.\-]+)(.*)$/.exec(s);
  if (!m) return null;
  const rest = m[2].trim();
  if (!rest) return { id: m[1] };
  for (const [re, shape] of SHAPES) {
    const x = re.exec(rest);
    if (x) return { id: m[1], label: x[1].replace(/^"|"$/g, '').trim(), shape };
  }
  return { id: m[1], label: rest };
}

const EDGE = /\s*(<?(?:-->|---|-\.->|-\.-|==>|===|--[ox]|<-->)|--\s*[^-][^>]*?\s*-->|==\s*[^=][^>]*?\s*==>|-\.\s*[^.]+?\s*\.->)\s*(?:\|([^|]*)\|)?\s*/;

export function parseMermaid(src: string): Diagram {
  const lines = src.replace(/\r/g, '').split(/\n|;/).map((l) => l.replace(/%%.*$/, '').trim()).filter(Boolean);
  const d: Diagram = { kind: 'other', direction: '', nodes: [], edges: [], starts: [], ends: [], groups: [], problems: [] };
  if (!lines.length) return d;
  const first = lines[0];
  const node = (id: string, label?: string, shape?: string, type?: DNode['type']) => {
    let n = d.nodes.find((x) => x.id === id);
    if (!n) { n = { id, label: label ?? id, shape: shape ?? 'box', type: type ?? (shape === 'decision' ? 'decision' : 'activity') }; d.nodes.push(n); }
    else if (label) { n.label = label; if (shape) { n.shape = shape; if (shape === 'decision') n.type = 'decision'; } }
    return n;
  };
  if (/^(flowchart|graph)\b/i.test(first)) {
    d.kind = 'flowchart';
    d.direction = (/^(?:flowchart|graph)\s+(\w+)/i.exec(first)?.[1] ?? 'TD').toUpperCase();
    let group: { name: string; nodes: string[] } | null = null;
    for (const line of lines.slice(1)) {
      if (/^subgraph\b/i.test(line)) { group = { name: line.replace(/^subgraph\s*/i, '').replace(/^\w+\s*\["?(.*?)"?\]$/, '$1'), nodes: [] }; d.groups.push(group); continue; }
      if (/^end$/i.test(line)) { group = null; continue; }
      if (/^(classDef|class|style|linkStyle|click|direction)\b/i.test(line)) continue;
      // split a chained statement "A --> B -- yes --> C"
      const parts: string[] = [];
      const labels: string[] = [];
      const styles: string[] = [];
      let rest = line;
      let m: RegExpExecArray | null;
      while ((m = EDGE.exec(rest))) {
        parts.push(rest.slice(0, m.index));
        const arrow = m[1];
        const inline = /^(?:--|==|-\.)\s*(.+?)\s*(?:-->|==>|\.->)$/.exec(arrow)?.[1];
        labels.push((m[2] ?? inline ?? '').trim());
        styles.push(arrow.includes('.') ? 'dotted' : arrow.includes('=') ? 'thick' : 'solid');
        rest = rest.slice(m.index + m[0].length);
      }
      parts.push(rest);
      const groupsOfRefs = parts.map((p) => p.split('&').map(parseNodeRef).filter((x): x is NonNullable<typeof x> => !!x));
      for (const refs of groupsOfRefs) for (const r of refs) { node(r.id, r.label, r.shape); if (group && !group.nodes.includes(r.id)) group.nodes.push(r.id); }
      for (let i = 0; i + 1 < groupsOfRefs.length; i++) {
        for (const a of groupsOfRefs[i]) for (const b of groupsOfRefs[i + 1]) d.edges.push({ from: a.id, to: b.id, label: labels[i] ?? '', style: styles[i] ?? 'solid' });
      }
    }
  } else if (/^stateDiagram/i.test(first)) {
    d.kind = 'state';
    for (const line of lines.slice(1)) {
      const m = /^(\[\*\]|[\w.]+)\s*-->\s*(\[\*\]|[\w.]+)\s*(?::\s*(.*))?$/.exec(line);
      if (!m) continue;
      const a = m[1] === '[*]' ? 'START' : m[1], b = m[2] === '[*]' ? 'END' : m[2];
      node(a, a === 'START' ? 'Start' : a, 'state', a === 'START' ? 'start' : 'state');
      node(b, b === 'END' ? 'End' : b, 'state', b === 'END' ? 'end' : 'state');
      d.edges.push({ from: a, to: b, label: m[3] ?? '', style: 'solid' });
    }
  } else if (/^sequenceDiagram/i.test(first)) {
    d.kind = 'sequence';
    for (const line of lines.slice(1)) {
      const p = /^(?:participant|actor)\s+(\w+)(?:\s+as\s+(.+))?$/i.exec(line);
      if (p) { node(p[1], p[2] ?? p[1], 'participant', 'participant'); continue; }
      const m = /^([\w ]+?)\s*(-{1,2}>>?|-{1,2}x|-{1,2}\))\s*\+?-?([\w ]+?)\s*:\s*(.*)$/.exec(line);
      if (m) { node(m[1].trim(), undefined, 'participant', 'participant'); node(m[3].trim(), undefined, 'participant', 'participant'); d.edges.push({ from: m[1].trim(), to: m[3].trim(), label: m[4], style: m[2].startsWith('--') ? 'dotted' : 'solid' }); }
    }
  } else if (/^erDiagram/i.test(first)) {
    d.kind = 'er';
    let inEntity: DNode | null = null;
    for (const line of lines.slice(1)) {
      if (inEntity) { if (line === '}') inEntity = null; else inEntity.label += `\n${line}`; continue; }
      const ent = /^([\w-]+)\s*\{$/.exec(line);
      if (ent) { inEntity = node(ent[1], ent[1], 'entity', 'entity'); continue; }
      const m = /^([\w-]+)\s+([|o}{]{1,2}(?:--|\.\.)[|o}{]{1,2})\s+([\w-]+)\s*:\s*"?(.*?)"?$/.exec(line);
      if (m) { node(m[1], m[1], 'entity', 'entity'); node(m[3], m[3], 'entity', 'entity'); d.edges.push({ from: m[1], to: m[3], label: `${m[4]} (${m[2]})`, style: m[2].includes('..') ? 'dotted' : 'solid' }); }
    }
  } else {
    d.problems.push(`Diagram type "${first}" is kept as text only.`);
  }
  if (d.kind === 'flowchart' || d.kind === 'state') {
    const hasIn = new Set(d.edges.map((e) => e.to)), hasOut = new Set(d.edges.map((e) => e.from));
    for (const n of d.nodes) {
      if (!hasIn.has(n.id) && hasOut.has(n.id)) { d.starts.push(n.id); if (n.type === 'activity' && /^(start|begin)/i.test(n.label)) n.type = 'start'; }
      if (hasIn.has(n.id) && !hasOut.has(n.id)) { d.ends.push(n.id); if (n.type === 'activity' && /^(end|stop|finish|done)/i.test(n.label)) n.type = 'end'; }
    }
    if (!d.starts.length && d.nodes.length) d.problems.push('No start node: every node has an incoming edge (the flow loops).');
    if (!d.ends.length && d.nodes.length) d.problems.push('No end node: every node has an outgoing edge.');
    const isolated = d.nodes.filter((n) => !hasIn.has(n.id) && !hasOut.has(n.id));
    if (isolated.length && d.edges.length) d.problems.push(`Unconnected nodes: ${isolated.map((n) => n.id).join(', ')}.`);
  }
  return d;
}

/** Readable text of a diagram, for search and for the extracted TXT file. */
export function diagramText(d: Diagram): string {
  const label = (id: string) => d.nodes.find((n) => n.id === id)?.label.split('\n')[0] ?? id;
  const lines = [`${d.kind} diagram${d.direction ? ` (direction ${d.direction})` : ''}: ${d.nodes.length} nodes, ${d.edges.length} connections.`];
  if (d.starts.length) lines.push(`Starts at: ${d.starts.map(label).join(', ')}.`);
  if (d.ends.length) lines.push(`Ends at: ${d.ends.map(label).join(', ')}.`);
  const decisions = d.nodes.filter((n) => n.type === 'decision');
  if (decisions.length) lines.push(`Decisions: ${decisions.map((n) => n.label).join('; ')}.`);
  for (const e of d.edges) lines.push(`${label(e.from)} → ${label(e.to)}${e.label ? ` [${e.label}]` : ''}`);
  for (const p of d.problems) lines.push(`Note: ${p}`);
  return lines.join('\n');
}

/** Builds Mermaid flowchart source from nodes and edges. */
/** Mermaid words that cannot be node IDs ("end" and "style" break a flowchart). */
export const MERMAID_RESERVED = /^(end|style|class|classdef|click|graph|subgraph|direction|linkstyle|flowchart|default|call|href)$/i;
export const mermaidId = (id: string) => { const s = id.replace(/[^A-Za-z0-9_]/g, '_'); return MERMAID_RESERVED.test(s) ? `n_${s}` : s; };

export function toMermaid(nodes: { id: string; label: string; type?: string }[], edges: { from: string; to: string; label?: string }[], direction = 'TD'): string {
  const safe = mermaidId;
  const esc = (s: string) => s.replace(/"/g, "'").replace(/\n/g, ' ');
  const shape = (n: { id: string; label: string; type?: string }) => (n.type === 'decision' ? `{"${esc(n.label)}"}` : n.type === 'start' || n.type === 'end' ? `(["${esc(n.label)}"])` : `["${esc(n.label)}"]`);
  return [`flowchart ${direction}`, ...nodes.map((n) => `  ${safe(n.id)}${shape(n)}`), ...edges.map((e) => `  ${safe(e.from)} -->${e.label ? `|${esc(e.label)}|` : ''} ${safe(e.to)}`)].join('\n');
}
