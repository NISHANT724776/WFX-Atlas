// Content extraction per file type into one structured model: headings, paragraphs, lists, tables (with headers,
// column types, units and identifiers), diagrams (nodes and edges) and page/sheet locators. Never flattened blindly.
import { extractPdf } from './pdf.ts';
import { diagramText, parseMermaid } from './diagram.ts';
import type { Diagram } from './diagram.ts';
import { readZip } from './zip.ts';
import { parseTxt } from '../knowledge/txt.ts';

export type BlockType = 'heading' | 'para' | 'list' | 'table' | 'code' | 'diagram';
export interface Block { type: BlockType; text: string; level?: number; table?: number; page?: number; sheet?: string; diagram?: Diagram; lang?: string }
export interface TableData { name: string; headers: string[]; types: string[]; units: Record<string, string>; identifiers: string[]; rows: string[][]; truncated: boolean }
export interface DocModel {
  format: string;
  title: string;
  blocks: Block[];
  tables: TableData[];
  quality: 'complete' | 'partial' | 'metadata-only';
  notes: string[];
  meta: Record<string, string | number>;
  /** TXT files written in the knowledge format: their entries, for review. */
  entries?: { idKey: string; id: string; fields: Record<string, string> }[];
}

export const SUPPORTED = ['txt', 'md', 'markdown', 'csv', 'json', 'docx', 'xlsx', 'xls', 'doc', 'pdf', 'html', 'htm', 'mmd', 'mermaid', 'png', 'jpg', 'jpeg', 'webp'];
const MAX_ROWS_KEPT = 5000;

// ── helpers ────────────────────────────────────────────────────────────
const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', bull: '•', middot: '·', times: '×', divide: '÷', deg: '°', rarr: '→' };
export const decodeEntities = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
  if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)); return Number.isFinite(n) ? String.fromCodePoint(n) : m; }
  return ENT[e.toLowerCase()] ?? m;
});
const attr = (attrs: string, name: string) => new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(attrs)?.[1] ?? new RegExp(`${name}\\s*=\\s*'([^']*)'`).exec(attrs)?.[1];
const TAG = /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)/gi;
const clean = (s: string) => s.replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').trim();

export function inferType(values: string[]): string {
  const v = values.map((x) => x.trim()).filter((x) => x !== '' && x !== '—' && x !== '-');
  if (!v.length) return 'empty';
  if (v.every((x) => /^[-+]?\d+$/.test(x.replace(/,/g, '')))) return 'integer';
  if (v.every((x) => /^[-+]?(\d+(\.\d+)?|\.\d+)(e[-+]?\d+)?$/i.test(x.replace(/,/g, '')))) return 'decimal';
  if (v.every((x) => /^\d{4}-\d{2}-\d{2}([ T].*)?$|^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}$|^\d{1,2}[ -][A-Za-z]{3}[ -]\d{2,4}$/.test(x))) return 'date';
  if (v.every((x) => /^(true|false|yes|no|y|n)$/i.test(x))) return 'boolean';
  if (v.every((x) => /^[-+]?\d+(\.\d+)?\s*%$/.test(x))) return 'percent';
  return 'text';
}

export function makeTable(name: string, rows: string[][]): TableData {
  const nonEmpty = rows.filter((r) => r.some((c) => c.trim()));
  const width = Math.max(0, ...nonEmpty.map((r) => r.length));
  const headers = (nonEmpty[0] ?? []).map((h, i) => clean(h) || `Column ${i + 1}`);
  while (headers.length < width) headers.push(`Column ${headers.length + 1}`);
  const body = nonEmpty.slice(1).map((r) => headers.map((_, i) => clean(r[i] ?? '')));
  const types = headers.map((_, i) => inferType(body.map((r) => r[i])));
  const units: Record<string, string> = {};
  const identifiers: string[] = [];
  headers.forEach((h, i) => {
    const u = /\(([^)]{1,12})\)\s*$/.exec(h)?.[1];
    if (u) units[h] = u;
    else if (/%|percent|pct/i.test(h) || types[i] === 'percent') units[h] = '%';
    else if (/\b(qty|quantity)\b/i.test(h)) units[h] = 'quantity (unit of the row)';
    else if (/\b(price|rate|value|amount|cost)\b/i.test(h)) units[h] = 'amount (currency of the row)';
    const vals = body.map((r) => r[i]).filter(Boolean);
    if (/(^|[\s_])(id|code|no|number|key|ref)$/i.test(h) || (vals.length > 3 && new Set(vals).size === vals.length && types[i] === 'text' && i === 0)) identifiers.push(h);
  });
  return { name, headers, types, units, identifiers, rows: body.slice(0, MAX_ROWS_KEPT), truncated: body.length > MAX_ROWS_KEPT };
}

const tableText = (t: TableData, max = 20) => [t.headers.join(' | '), ...t.rows.slice(0, max).map((r) => r.join(' | '))].join('\n') + (t.rows.length > max ? `\n… ${t.rows.length - max} more rows` : '');

export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  const s = text.replace(/^﻿/, '');
  const delim = (s.split('\n')[0].match(/;/g)?.length ?? 0) > (s.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : (s.split('\n')[0].includes('\t') && !s.split('\n')[0].includes(',') ? '\t' : ',');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); cell = ''; out.push(row); row = []; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }
  return out.filter((r) => r.some((c) => c.trim() !== ''));
}

// ── per format ─────────────────────────────────────────────────────────
function fromDocx(buf: Buffer): DocModel {
  const zip = readZip(buf);
  const doc = zip.get('word/document.xml');
  if (!doc) throw new Error('This .docx has no word/document.xml.');
  const styleNames = new Map<string, string>();
  const styleLevels = new Map<string, number>();
  const stylesXml = zip.get('word/styles.xml')?.read().toString('utf8') ?? '';
  for (const m of stylesXml.matchAll(/<w:style\b[^>]*w:styleId="([^"]+)"[^>]*>([\s\S]*?)<\/w:style>/g)) {
    const name = /<w:name w:val="([^"]+)"/.exec(m[2])?.[1] ?? '';
    styleNames.set(m[1], name);
    const lvl = /<w:outlineLvl w:val="(\d)"/.exec(m[2])?.[1];
    if (lvl !== undefined) styleLevels.set(m[1], Number(lvl) + 1);
  }
  const headingLevel = (styleId: string) => {
    const n = (styleNames.get(styleId) ?? styleId).toLowerCase();
    const h = /^heading\s*(\d)/.exec(n) ?? /^heading(\d)/i.exec(styleId);
    if (h) return Number(h[1]);
    if (n === 'title') return 1;
    if (n === 'subtitle') return 2;
    return styleLevels.get(styleId) ?? 0;
  };
  const xml = doc.read().toString('utf8');
  const blocks: Block[] = [];
  const tables: TableData[] = [];
  let images = 0;
  // state
  let para: { text: string; style: string; list: boolean; outline: number } | null = null;
  const tableStack: { rows: string[][]; row: string[] | null; cell: string[] | null }[] = [];
  for (const m of xml.matchAll(TAG)) {
    const [, , close, name, attrs, self, text] = m;
    if (text !== undefined) { if (para && /<w:t[\s>]/.test('')) para.text += ''; continue; }
    if (!name) continue;
    if (name === 'w:t' && !close && !self) {
      // the text node follows this tag; read it directly
      const after = xml.slice((m.index ?? 0) + m[0].length);
      const t = after.slice(0, after.indexOf('</w:t>'));
      if (para) para.text += decodeEntities(t);
      continue;
    }
    if (!para && name !== 'w:p' && !name.startsWith('w:t')) { /* fall through for table tags */ }
    switch (name) {
      case 'w:p':
        if (!close && !self) para = { text: '', style: '', list: false, outline: 0 };
        else if (close && para) {
          const t = clean(para.text);
          const cellOwner = tableStack[tableStack.length - 1];
          if (cellOwner?.cell) { if (t) cellOwner.cell.push(t); }
          else if (t) {
            const lvl = headingLevel(para.style) || (para.outline ? para.outline : 0);
            if (lvl && t.length < 200) blocks.push({ type: 'heading', level: Math.min(lvl, 6), text: t });
            else blocks.push({ type: para.list ? 'list' : 'para', text: t });
          }
          para = null;
        }
        break;
      case 'w:pStyle': if (para) para.style = attr(attrs, 'w:val') ?? ''; break;
      case 'w:numPr': if (para) para.list = true; break;
      case 'w:outlineLvl': if (para) para.outline = Number(attr(attrs, 'w:val') ?? -1) + 1; break;
      case 'w:tab': if (para && !close) para.text += '\t'; break;
      case 'w:br': case 'w:cr': if (para && !close) para.text += '\n'; break;
      case 'w:drawing': case 'w:pict': if (!close) images++; break;
      case 'w:tbl':
        if (!close) tableStack.push({ rows: [], row: null, cell: null });
        else {
          const t = tableStack.pop();
          if (!t) break;
          const parent = tableStack[tableStack.length - 1];
          if (parent?.cell) parent.cell.push(t.rows.map((r) => r.join(' | ')).join(' / '));
          else if (t.rows.length) {
            const td = makeTable(`Table ${tables.length + 1}`, t.rows);
            tables.push(td);
            blocks.push({ type: 'table', text: tableText(td), table: tables.length - 1 });
          }
        }
        break;
      case 'w:tr': { const t = tableStack[tableStack.length - 1]; if (!t) break; if (!close) t.row = []; else if (t.row) { t.rows.push(t.row); t.row = null; } break; }
      case 'w:tc': { const t = tableStack[tableStack.length - 1]; if (!t) break; if (!close) t.cell = []; else if (t.cell && t.row) { t.row.push(t.cell.join('\n')); t.cell = null; } break; }
    }
  }
  const core = zip.get('docProps/core.xml')?.read().toString('utf8') ?? '';
  const meta: Record<string, string | number> = {};
  for (const k of ['dc:title', 'dc:creator', 'cp:lastModifiedBy', 'dcterms:created', 'dcterms:modified', 'cp:revision']) {
    const v = new RegExp(`<${k}[^>]*>([^<]*)</${k}>`).exec(core)?.[1];
    if (v) meta[k.split(':')[1]] = decodeEntities(v);
  }
  const notes: string[] = [];
  if (images) notes.push(`${images} embedded image(s) kept inside the original file; text inside images is not read.`);
  const firstHeading = blocks.find((b) => b.type === 'heading')?.text;
  return { format: 'docx', title: String(meta['title'] || firstHeading || ''), blocks, tables, quality: 'complete', notes, meta: { ...meta, images } };
}

function fromXlsx(buf: Buffer): DocModel {
  const zip = readZip(buf);
  const shared: string[] = [];
  const ss = zip.get('xl/sharedStrings.xml')?.read().toString('utf8') ?? '';
  for (const si of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(decodeEntities([...si[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join('')));
  const wb = zip.get('xl/workbook.xml')?.read().toString('utf8') ?? '';
  const rels = zip.get('xl/_rels/workbook.xml.rels')?.read().toString('utf8') ?? '';
  const target = new Map([...rels.matchAll(/<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)"/g)].map((m) => [m[1], m[2]]));
  const blocks: Block[] = [];
  const tables: TableData[] = [];
  const colIndex = (ref: string) => { const l = /^[A-Z]+/.exec(ref)?.[0] ?? 'A'; let n = 0; for (const c of l) n = n * 26 + (c.charCodeAt(0) - 64); return n - 1; };
  for (const sm of wb.matchAll(/<sheet\b[^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)) {
    const name = decodeEntities(sm[1]);
    let t = target.get(sm[2]) ?? '';
    t = t.startsWith('/') ? t.slice(1) : `xl/${t}`;
    const sheet = zip.get(t)?.read().toString('utf8');
    if (!sheet) continue;
    const rows: string[][] = [];
    for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const row: string[] = [];
      for (const cm of rm[1].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const a = cm[1], inner = cm[2] ?? '';
        const r = attr(a, 'r') ?? '';
        const type = attr(a, 't');
        let v = /<v>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
        if (type === 's') v = shared[Number(v)] ?? '';
        else if (type === 'inlineStr') v = [...inner.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('');
        else if (type === 'b') v = v === '1' ? 'TRUE' : 'FALSE';
        const idx = r ? colIndex(r) : row.length;
        while (row.length < idx) row.push('');
        row[idx] = decodeEntities(v);
      }
      rows.push(row);
    }
    blocks.push({ type: 'heading', level: 1, text: `Sheet: ${name}`, sheet: name });
    if (rows.some((r) => r.some((c) => c.trim()))) {
      const td = makeTable(name, rows);
      tables.push(td);
      blocks.push({ type: 'table', text: tableText(td), table: tables.length - 1, sheet: name });
    }
  }
  return { format: 'xlsx', title: '', blocks, tables, quality: 'complete', notes: [], meta: { sheets: tables.length } };
}

function fromHtml(src: string, format = 'html'): DocModel {
  const blocks: Block[] = [];
  const tables: TableData[] = [];
  let buf = '', skip = 0, title = '', inTitle = false, heading = 0, listItem = false;
  const tstack: { rows: string[][]; row: string[] | null; cell: string | null }[] = [];
  const flush = () => {
    const t = clean(decodeEntities(buf));
    buf = '';
    if (!t) return;
    const tb = tstack[tstack.length - 1];
    if (tb && tb.cell !== null) { tb.cell += (tb.cell ? ' ' : '') + t; return; }
    if (heading) blocks.push({ type: 'heading', level: heading, text: t });
    else blocks.push({ type: listItem ? 'list' : 'para', text: t });
  };
  for (const m of src.matchAll(TAG)) {
    const [, cdata, close, rawName, , , text] = m;
    if (text !== undefined || cdata !== undefined) { if (!skip) { if (inTitle) title += text ?? ''; else buf += (text ?? cdata ?? ''); } continue; }
    if (!rawName) continue;
    const name = rawName.toLowerCase();
    if (name === 'script' || name === 'style' || name === 'noscript' || name === 'svg') { skip += close ? -1 : 1; skip = Math.max(0, skip); continue; }
    if (skip) continue;
    if (name === 'title') { inTitle = !close; continue; }
    if (/^h[1-6]$/.test(name)) { flush(); heading = close ? 0 : Number(name[1]); continue; }
    if (name === 'li') { flush(); listItem = !close; continue; }
    if (name === 'table') { flush(); if (!close) tstack.push({ rows: [], row: null, cell: null }); else { const t = tstack.pop(); if (t?.rows.length) { const td = makeTable(`Table ${tables.length + 1}`, t.rows); tables.push(td); blocks.push({ type: 'table', text: tableText(td), table: tables.length - 1 }); } } continue; }
    const tb = tstack[tstack.length - 1];
    if (name === 'tr' && tb) { flush(); if (!close) tb.row = []; else if (tb.row) { tb.rows.push(tb.row); tb.row = null; } continue; }
    if ((name === 'td' || name === 'th') && tb) { if (!close) { flush(); tb.cell = ''; } else { flush(); if (tb.row) tb.row.push(tb.cell ?? ''); tb.cell = null; } continue; }
    if (['p', 'div', 'section', 'article', 'br', 'ul', 'ol', 'dl', 'dt', 'dd', 'header', 'footer', 'main', 'nav', 'aside', 'figure', 'figcaption', 'blockquote', 'pre', 'hr'].includes(name)) flush();
  }
  flush();
  return { format, title: clean(decodeEntities(title)) || blocks.find((b) => b.type === 'heading')?.text || '', blocks, tables, quality: 'complete', notes: [], meta: {} };
}

function fromMarkdown(src: string): DocModel {
  const blocks: Block[] = [];
  const tables: TableData[] = [];
  const lines = src.replace(/\r/g, '').split('\n');
  let para: string[] = [];
  const flush = () => { const t = clean(para.join(' ')); if (t) blocks.push({ type: 'para', text: t }); para = []; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const fence = /^```\s*(\w*)/.exec(l);
    if (fence) {
      flush();
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      const code = body.join('\n');
      if (/^mermaid$/i.test(fence[1])) { const d = parseMermaid(code); blocks.push({ type: 'diagram', text: diagramText(d), diagram: d, lang: 'mermaid' }); }
      else blocks.push({ type: 'code', text: code, lang: fence[1] });
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    if (h) { flush(); blocks.push({ type: 'heading', level: h[1].length, text: h[2].trim() }); continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '')) {
      flush();
      const rows: string[][] = [];
      const cells = (x: string) => x.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      rows.push(cells(l));
      i += 2;
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(cells(lines[i++]));
      i--;
      const td = makeTable(`Table ${tables.length + 1}`, rows);
      tables.push(td);
      blocks.push({ type: 'table', text: tableText(td), table: tables.length - 1 });
      continue;
    }
    const li = /^\s*([-*+]|\d+[.)])\s+(.*)$/.exec(l);
    if (li) { flush(); blocks.push({ type: 'list', text: li[2].trim() }); continue; }
    if (!l.trim()) { flush(); continue; }
    para.push(l);
  }
  flush();
  return { format: 'md', title: blocks.find((b) => b.type === 'heading')?.text ?? '', blocks, tables, quality: 'complete', notes: [], meta: {} };
}

function fromText(src: string): DocModel {
  const parsed = parseTxt(src);
  if (parsed.entries.length) {
    const blocks: Block[] = [];
    for (const e of parsed.entries) {
      blocks.push({ type: 'heading', level: 2, text: `${e.id}: ${e.fields['RULE NAME'] ?? e.fields['TERM'] ?? e.fields['TITLE'] ?? ''}` });
      blocks.push({ type: 'para', text: Object.entries(e.fields).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n') });
    }
    return { format: 'txt', title: '', blocks, tables: [], quality: 'complete', notes: parsed.problems.map((p) => `Line ${p.line}: ${p.message}`), meta: { entries: parsed.entries.length }, entries: parsed.entries.map((e) => ({ idKey: e.idKey, id: e.id, fields: e.fields })) };
  }
  const blocks: Block[] = [];
  for (const para of src.replace(/\r/g, '').split(/\n\s*\n/)) {
    const lines = para.split('\n').map((l) => l.trim()).filter(Boolean);
    if (!lines.length) continue;
    const first = lines[0];
    const isHeading = lines.length >= 1 && first.length <= 90 && !/[.;,]$/.test(first) && (/^[A-Z0-9][A-Z0-9 &/()\-–:]{3,}$/.test(first) || /^\d+(\.\d+)*\.?\s+\S/.test(first) || /:$/.test(first));
    if (isHeading) { blocks.push({ type: 'heading', level: (/^(\d+(\.\d+)*)/.exec(first)?.[1].split('.').filter(Boolean).length ?? 1), text: first.replace(/:$/, '') }); lines.shift(); }
    for (const l of lines) {
      const li = /^([-*•]|\d+[.)])\s+(.*)$/.exec(l);
      if (li) blocks.push({ type: 'list', text: li[2] });
      else {
        const last = blocks[blocks.length - 1];
        if (last && last.type === 'para') last.text += ` ${l}`;
        else blocks.push({ type: 'para', text: l });
      }
    }
  }
  return { format: 'txt', title: blocks.find((b) => b.type === 'heading')?.text ?? '', blocks, tables: [], quality: 'complete', notes: [], meta: {} };
}

function fromJson(src: string): DocModel {
  let data: unknown;
  try { data = JSON.parse(src); } catch (e) { throw new Error(`Invalid JSON: ${(e as Error).message}`); }
  const blocks: Block[] = [];
  const tables: TableData[] = [];
  const asTable = (name: string, arr: unknown[]) => {
    const objs = arr.filter((x) => x && typeof x === 'object' && !Array.isArray(x)) as Record<string, unknown>[];
    if (objs.length < arr.length * 0.8 || !objs.length) return false;
    const keys = [...new Set(objs.flatMap((o) => Object.keys(o)))].slice(0, 80);
    const val = (v: unknown) => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v).slice(0, 200) : String(v));
    const td = makeTable(name, [keys, ...objs.map((o) => keys.map((k) => val(o[k])))]);
    tables.push(td);
    blocks.push({ type: 'table', text: tableText(td), table: tables.length - 1 });
    return true;
  };
  if (Array.isArray(data)) { if (!asTable('Records', data)) blocks.push({ type: 'para', text: JSON.stringify(data).slice(0, 20000) }); }
  else if (data && typeof data === 'object') {
    const lines: string[] = [];
    const walk = (v: unknown, path: string, depth: number) => {
      if (lines.length > 3000) return;
      if (Array.isArray(v)) { if (depth < 3 && v.length && asTable(path || 'Records', v)) return; lines.push(`${path}: ${JSON.stringify(v).slice(0, 300)}`); return; }
      if (v && typeof v === 'object' && depth < 5) { for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k, depth + 1); return; }
      lines.push(`${path}: ${String(v)}`);
    };
    walk(data, '', 0);
    if (lines.length) blocks.push({ type: 'para', text: lines.join('\n') });
  }
  return { format: 'json', title: '', blocks, tables, quality: 'complete', notes: [], meta: {} };
}

function fromCsv(src: string, name: string): DocModel {
  const rows = parseCsv(src);
  const td = makeTable(name, rows);
  return { format: 'csv', title: '', blocks: [{ type: 'table', text: tableText(td), table: 0 }], tables: [td], quality: 'complete', notes: td.truncated ? [`Only the first ${MAX_ROWS_KEPT} rows are indexed.`] : [], meta: { rows: td.rows.length, columns: td.headers.length } };
}

function imageInfo(buf: Buffer, ext: string): DocModel {
  let width = 0, height = 0;
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) { width = buf.readUInt32BE(16); height = buf.readUInt32BE(20); }
  else if (buf[0] === 0xff && buf[1] === 0xd8) {
    let p = 2;
    while (p + 9 < buf.length) {
      if (buf[p] !== 0xff) { p++; continue; }
      const marker = buf[p + 1];
      const len = buf.readUInt16BE(p + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) { height = buf.readUInt16BE(p + 5); width = buf.readUInt16BE(p + 7); break; }
      p += 2 + len;
    }
  } else if (buf.toString('latin1', 0, 4) === 'RIFF' && buf.toString('latin1', 8, 12) === 'WEBP') {
    const kind = buf.toString('latin1', 12, 16);
    if (kind === 'VP8X') { width = 1 + buf.readUIntLE(24, 3); height = 1 + buf.readUIntLE(27, 3); }
    else if (kind === 'VP8 ') { width = buf.readUInt16LE(26) & 0x3fff; height = buf.readUInt16LE(28) & 0x3fff; }
    else if (kind === 'VP8L') { const b = buf.readUInt32LE(21); width = (b & 0x3fff) + 1; height = ((b >> 14) & 0x3fff) + 1; }
  }
  return {
    format: ext, title: '', blocks: [], tables: [], quality: 'metadata-only',
    notes: ['Image stored unchanged. Text and diagrams inside images are not read: that needs a vision model, which is not authorised or configured. Add a written description to make it searchable.'],
    meta: { width, height },
  };
}

/** Best-effort text recovery from legacy binary Office files (.doc, .xls): readable runs only, structure lost. */
function legacyOffice(buf: Buffer, ext: string): DocModel {
  const runs: string[] = [];
  const u16 = buf.toString('utf16le');
  for (const m of u16.matchAll(/[\x20-\x7e -ɏ‐-‧€\n\r\t]{6,}/g)) runs.push(m[0]);
  const a = buf.toString('latin1');
  for (const m of a.matchAll(/[\x20-\x7e\n\r\t]{12,}/g)) runs.push(m[0]);
  const seen = new Set<string>();
  const lines = runs.map((r) => clean(r)).filter((r) => r.length >= 6 && /[a-z]{3}/i.test(r) && (r.match(/[a-z]/gi)?.length ?? 0) / r.length > 0.55 && !seen.has(r) && (seen.add(r), true));
  return {
    format: ext, title: '', blocks: lines.map((l) => ({ type: 'para' as const, text: l })), tables: [], quality: 'partial',
    notes: [`Legacy .${ext} format: text recovered on a best-effort basis; tables, headings and formatting are lost. Save the file as .${ext === 'doc' ? 'docx' : 'xlsx'} and upload it again for a complete extraction.`],
    meta: {},
  };
}

/** Checks the first bytes match the extension (uploads are untrusted). Returns a problem or null. */
export function checkSignature(buf: Buffer, ext: string): string | null {
  const head = buf.subarray(0, 12);
  const is = (bytes: number[]) => bytes.every((b, i) => head[i] === b);
  const zip = is([0x50, 0x4b, 0x03, 0x04]);
  const ole = is([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  switch (ext) {
    case 'docx': case 'xlsx': return zip ? null : 'The file is not a valid Office Open XML (ZIP) file.';
    case 'doc': case 'xls': return ole ? null : (zip ? `This is a newer Office file; rename it to .${ext}x.` : 'The file is not a legacy Office file.');
    case 'pdf': return buf.subarray(0, 1024).toString('latin1').includes('%PDF') ? null : 'The file is not a PDF.';
    case 'png': return is([0x89, 0x50, 0x4e, 0x47]) ? null : 'The file is not a PNG image.';
    case 'jpg': case 'jpeg': return is([0xff, 0xd8, 0xff]) ? null : 'The file is not a JPEG image.';
    case 'webp': return head.toString('latin1', 0, 4) === 'RIFF' && head.toString('latin1', 8, 12) === 'WEBP' ? null : 'The file is not a WebP image.';
    default: return buf.subarray(0, 8192).includes(0) ? 'A text file must not contain binary data.' : null;
  }
}

export function extract(buf: Buffer, ext: string, name: string): DocModel {
  const e = ext.toLowerCase();
  const text = () => buf.toString('utf8').replace(/^﻿/, '');
  switch (e) {
    case 'docx': return fromDocx(buf);
    case 'xlsx': return fromXlsx(buf);
    case 'pdf': {
      const r = extractPdf(buf);
      const blocks: Block[] = [];
      r.pages.forEach((p, i) => {
        for (const para of p.split(/\n{2,}/)) {
          const t = clean(para.replace(/\n/g, ' '));
          if (!t) continue;
          const heading = t.length < 90 && /^(\d+(\.\d+)*\.?\s+)?[A-Z][^.!?]*$/.test(t) && !/[,;]$/.test(t) && t.split(' ').length <= 12;
          blocks.push({ type: heading ? 'heading' : 'para', level: heading ? 2 : undefined, text: t, page: i + 1 });
        }
      });
      return { format: 'pdf', title: '', blocks, tables: [], quality: r.notes.some((n) => /No text layer|encrypted/.test(n)) ? 'partial' : 'complete', notes: r.notes, meta: { pages: r.pages.length } };
    }
    case 'html': case 'htm': return fromHtml(text());
    case 'md': case 'markdown': return fromMarkdown(text());
    case 'mmd': case 'mermaid': { const d = parseMermaid(text()); return { format: 'mermaid', title: '', blocks: [{ type: 'diagram', text: diagramText(d), diagram: d, lang: 'mermaid' }], tables: [], quality: d.kind === 'other' ? 'partial' : 'complete', notes: d.problems, meta: { nodes: d.nodes.length, edges: d.edges.length } }; }
    case 'csv': return fromCsv(text(), name);
    case 'json': return fromJson(text());
    case 'txt': return fromText(text());
    case 'png': case 'jpg': case 'jpeg': case 'webp': return imageInfo(buf, e);
    case 'doc': case 'xls': return legacyOffice(buf, e);
  }
  throw new Error(`File type .${e} is not supported (supported: ${SUPPORTED.join(', ')}).`);
}
