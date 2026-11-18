// PDF text extraction with page numbers, without dependencies: objects and object streams, Flate-compressed content,
// font ToUnicode maps (needed for PDFs saved from Word), text operators and line breaks. Scanned PDFs (images only)
// have no text layer; they are reported as such.
import { inflateRawSync, inflateSync } from 'node:zlib';

interface Obj { dict: string; stream?: Buffer }

const MAX_STREAM = 60 * 1024 * 1024;

function inflate(data: Buffer): Buffer | null {
  try { return inflateSync(data, { maxOutputLength: MAX_STREAM }); } catch { /* try raw */ }
  try { return inflateRawSync(data.subarray(2), { maxOutputLength: MAX_STREAM }); } catch { return null; }
}

function decodeStream(dict: string, raw: Buffer): Buffer | null {
  if (/\/Filter\s*\[?\s*\/FlateDecode/.test(dict)) return inflate(raw);
  if (/\/Filter/.test(dict)) return null; // images (DCT/JPX/CCITT) and rare text filters are skipped
  return raw;
}

function parseObjects(buf: Buffer): Map<number, Obj> {
  const s = buf.toString('latin1');
  const objs = new Map<number, Obj>();
  const re = /(\d+)\s+(\d+)\s+obj\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s))) {
    const num = Number(m[1]);
    const start = m.index + m[0].length;
    const end = s.indexOf('endobj', start);
    if (end < 0) break;
    const body = s.slice(start, end);
    const si = body.search(/\bstream\r?\n/);
    if (si >= 0) {
      const dict = body.slice(0, si);
      let dataStart = start + si + (body.slice(si).startsWith('stream\r\n') ? 8 : 7);
      const len = /\/Length\s+(\d+)(?!\s+\d+\s+R)/.exec(dict);
      let dataEnd = len ? dataStart + Number(len[1]) : s.indexOf('endstream', dataStart);
      if (dataEnd < dataStart || dataEnd > buf.length) dataEnd = s.indexOf('endstream', dataStart);
      objs.set(num, { dict, stream: buf.subarray(dataStart, dataEnd) });
    } else objs.set(num, { dict: body });
    re.lastIndex = end + 6;
  }
  // objects packed in object streams (PDF 1.5+)
  for (const [, o] of [...objs]) {
    if (!o.stream || !/\/Type\s*\/ObjStm/.test(o.dict)) continue;
    const data = decodeStream(o.dict, o.stream);
    if (!data) continue;
    const n = Number(/\/N\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    const first = Number(/\/First\s+(\d+)/.exec(o.dict)?.[1] ?? 0);
    const text = data.toString('latin1');
    const nums = text.slice(0, first).trim().split(/\s+/).map(Number);
    for (let i = 0; i < n; i++) {
      const id = nums[i * 2], off = nums[i * 2 + 1];
      const next = i + 1 < n ? nums[(i + 1) * 2 + 1] : text.length - first;
      if (!objs.has(id)) objs.set(id, { dict: text.slice(first + off, first + next) });
    }
  }
  return objs;
}

const ref = (s: string | undefined) => (s ? Number(/(\d+)\s+\d+\s+R/.exec(s)?.[1] ?? NaN) : NaN);
/** The value of a dictionary key: a reference, an inline dictionary or an array. */
function dictValue(dict: string, key: string): string | undefined {
  const i = dict.search(new RegExp(`/${key}(?![A-Za-z])`));
  if (i < 0) return undefined;
  let j = i + key.length + 1;
  while (/\s/.test(dict[j] ?? '')) j++;
  if (dict.startsWith('<<', j)) {
    let depth = 0;
    for (let k = j; k < dict.length - 1; k++) {
      if (dict.startsWith('<<', k)) { depth++; k++; } else if (dict.startsWith('>>', k)) { depth--; k++; if (!depth) return dict.slice(j, k + 1); }
    }
    return dict.slice(j);
  }
  if (dict[j] === '[') return dict.slice(j, dict.indexOf(']', j) + 1);
  return /^(\d+\s+\d+\s+R|\/[\w.+-]+|[-\d.]+|\([^)]*\))/.exec(dict.slice(j))?.[0];
}

function resolve(objs: Map<number, Obj>, v: string | undefined): string | undefined {
  if (!v) return v;
  const r = ref(v);
  return Number.isFinite(r) && /^\d+\s+\d+\s+R$/.test(v.trim()) ? objs.get(r)?.dict : v;
}

/** ToUnicode CMap → code → text, and the code width in bytes. */
function parseCMap(text: string): { map: Map<number, string>; bytes: number } {
  const map = new Map<number, string>();
  const hexToStr = (h: string) => { let out = ''; for (let i = 0; i + 4 <= h.length; i += 4) out += String.fromCharCode(parseInt(h.slice(i, i + 4), 16)); return out; };
  let bytes = 1;
  const cs = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*endcodespacerange|begincodespacerange\s*<([0-9A-Fa-f]+)>/.exec(text);
  if (cs) bytes = Math.max(1, Math.round((cs[1] ?? cs[3]).length / 2));
  for (const block of text.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) { map.set(parseInt(m[1], 16), hexToStr(m[2])); bytes = Math.max(bytes, Math.round(m[1].length / 2)); }
  }
  for (const block of text.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    for (const m of block[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([^\]]*)\])/g)) {
      const lo = parseInt(m[1], 16), hi = parseInt(m[2], 16);
      bytes = Math.max(bytes, Math.round(m[1].length / 2));
      if (m[4]) { const base = parseInt(m[4], 16); for (let c = lo; c <= hi && c - lo < 65536; c++) map.set(c, String.fromCharCode(base + (c - lo))); }
      else if (m[5]) { const list = [...m[5].matchAll(/<([0-9A-Fa-f]+)>/g)].map((x) => hexToStr(x[1])); for (let c = lo; c <= hi && c - lo < list.length; c++) map.set(c, list[c - lo]); }
    }
  }
  return { map, bytes };
}

interface Font { map: Map<number, string> | null; bytes: number }

function fontsOf(objs: Map<number, Obj>, pageDict: string, inherited: string | undefined): Map<string, Font> {
  const fonts = new Map<string, Font>();
  const res = resolve(objs, dictValue(pageDict, 'Resources')) ?? inherited;
  if (!res) return fonts;
  const fdict = resolve(objs, dictValue(res, 'Font'));
  if (!fdict) return fonts;
  for (const m of fdict.matchAll(/\/([\w.+-]+)\s+(\d+\s+\d+\s+R)/g)) {
    const f = objs.get(ref(m[2]));
    if (!f) continue;
    const isType0 = /\/Subtype\s*\/Type0/.test(f.dict);
    const tu = objs.get(ref(dictValue(f.dict, 'ToUnicode')));
    let map: Map<number, string> | null = null, bytes = isType0 ? 2 : 1;
    if (tu?.stream) {
      const data = decodeStream(tu.dict, tu.stream);
      if (data) { const c = parseCMap(data.toString('latin1')); map = c.map; bytes = isType0 ? 2 : c.bytes; }
    }
    fonts.set(m[1], { map, bytes });
  }
  return fonts;
}

function decodeText(bytes: Buffer, font: Font | undefined): string {
  if (!font?.map) return bytes.toString('latin1');
  let out = '';
  const w = font.bytes;
  for (let i = 0; i + w <= bytes.length; i += w) {
    const code = w === 2 ? bytes.readUInt16BE(i) : bytes[i];
    out += font.map.get(code) ?? (w === 1 ? String.fromCharCode(code) : '');
  }
  return out;
}

/** Content stream → text, following text operators. */
function runContent(data: Buffer, fonts: Map<string, Font>): string {
  const s = data.toString('latin1');
  let i = 0, out = '', font: Font | undefined, lastY: number | null = null;
  const stack: (string | number | Buffer | (number | Buffer)[])[] = [];
  const readLiteral = (): Buffer => {
    const bytes: number[] = [];
    let depth = 1;
    i++;
    while (i < s.length && depth > 0) {
      const c = s[i];
      if (c === '\\') {
        const n = s[i + 1];
        const esc: Record<string, number> = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
        if (n in esc) { bytes.push(esc[n]); i += 2; continue; }
        if (/[0-7]/.test(n)) { const oct = /^[0-7]{1,3}/.exec(s.slice(i + 1))![0]; bytes.push(parseInt(oct, 8) & 255); i += 1 + oct.length; continue; }
        i += 2; continue;
      }
      if (c === '(') depth++;
      if (c === ')') { depth--; if (!depth) { i++; break; } }
      bytes.push(s.charCodeAt(i) & 255);
      i++;
    }
    return Buffer.from(bytes);
  };
  const readHex = (): Buffer => {
    const end = s.indexOf('>', i);
    const hex = s.slice(i + 1, end).replace(/\s+/g, '');
    i = end + 1;
    return Buffer.from(hex.length % 2 ? `${hex}0` : hex, 'hex');
  };
  const show = (b: Buffer) => { out += decodeText(b, font); };
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '%') { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
    if (c === '(') { stack.push(readLiteral()); continue; }
    if (c === '<' && s[i + 1] !== '<') { stack.push(readHex()); continue; }
    if (c === '<' && s[i + 1] === '<') { const e = s.indexOf('>>', i); i = e < 0 ? s.length : e + 2; continue; }
    if (c === '[') {
      i++;
      const arr: (number | Buffer)[] = [];
      while (i < s.length && s[i] !== ']') {
        if (/\s/.test(s[i])) { i++; continue; }
        if (s[i] === '(') arr.push(readLiteral());
        else if (s[i] === '<') arr.push(readHex());
        else { const m = /^[-+]?\d*\.?\d+/.exec(s.slice(i)); if (m) { arr.push(Number(m[0])); i += m[0].length; } else i++; }
      }
      i++;
      stack.push(arr);
      continue;
    }
    if (c === '/') { const m = /^\/[^\s/<>[\]()%{}]*/.exec(s.slice(i))!; stack.push(m[0]); i += m[0].length; continue; }
    const num = /^[-+]?\d*\.?\d+/.exec(s.slice(i));
    if (num && /[-+.\d]/.test(c)) { stack.push(Number(num[0])); i += num[0].length; continue; }
    const op = /^[A-Za-z'"*]+/.exec(s.slice(i));
    if (!op) { i++; continue; }
    i += op[0].length;
    switch (op[0]) {
      case 'BI': { const e = s.indexOf('EI', i); i = e < 0 ? s.length : e + 2; break; }
      case 'Tf': font = fonts.get(String(stack[stack.length - 2] ?? '').slice(1)); break;
      case 'Tj': { const b = stack[stack.length - 1]; if (Buffer.isBuffer(b)) show(b); break; }
      case "'": case '"': { out += '\n'; const b = stack[stack.length - 1]; if (Buffer.isBuffer(b)) show(b); break; }
      case 'TJ': {
        const arr = stack[stack.length - 1];
        if (Array.isArray(arr)) for (const x of arr) { if (Buffer.isBuffer(x)) show(x); else if (x < -180) out += ' '; }
        break;
      }
      case 'Td': case 'TD': { const ty = Number(stack[stack.length - 1]); const tx = Number(stack[stack.length - 2]); if (ty !== 0) out += '\n'; else if (tx > 0) out += ' '; break; }
      case 'Tm': { const y = Number(stack[stack.length - 1]); if (lastY !== null && Math.abs(y - lastY) > 1) out += '\n'; else if (lastY !== null) out += ' '; lastY = y; break; }
      case 'T*': out += '\n'; break;
      case 'ET': out += '\n'; break;
    }
    stack.length = 0;
  }
  return out;
}

export function extractPdf(buf: Buffer): { pages: string[]; notes: string[] } {
  const notes: string[] = [];
  if (!buf.subarray(0, 1024).toString('latin1').includes('%PDF')) throw new Error('Not a PDF file.');
  if (/\/Encrypt\s/.test(buf.toString('latin1', Math.max(0, buf.length - 4096)))) notes.push('The PDF is encrypted; text may be missing.');
  const objs = parseObjects(buf);
  // page order: walk the page tree from the catalog
  const pages: { dict: string; res?: string }[] = [];
  const catalog = [...objs.values()].find((o) => /\/Type\s*\/Catalog/.test(o.dict));
  const walk = (num: number, inheritedRes: string | undefined, depth: number) => {
    const o = objs.get(num);
    if (!o || depth > 30) return;
    const res = resolve(objs, dictValue(o.dict, 'Resources')) ?? inheritedRes;
    if (/\/Type\s*\/Pages/.test(o.dict)) {
      const kids = dictValue(o.dict, 'Kids') ?? '';
      for (const k of kids.matchAll(/(\d+)\s+\d+\s+R/g)) walk(Number(k[1]), res, depth + 1);
    } else if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push({ dict: o.dict, res });
  };
  if (catalog) walk(ref(dictValue(catalog.dict, 'Pages')), undefined, 0);
  if (!pages.length) for (const o of objs.values()) if (/\/Type\s*\/Page\b/.test(o.dict)) pages.push({ dict: o.dict });
  const texts = pages.map((p) => {
    const fonts = fontsOf(objs, p.dict, p.res);
    const contents = dictValue(p.dict, 'Contents') ?? '';
    let text = '';
    for (const r of contents.matchAll(/(\d+)\s+\d+\s+R/g)) {
      const o = objs.get(Number(r[1]));
      if (!o?.stream) continue;
      const data = decodeStream(o.dict, o.stream);
      if (data) text += runContent(data, fonts);
    }
    return text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim();
  });
  if (!texts.some((t) => t.length > 20)) notes.push('No text layer found: the PDF looks scanned (images only). Text in images needs OCR or a vision model.');
  return { pages: texts, notes };
}
