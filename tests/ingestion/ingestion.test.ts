// Ingestion pipeline: every supported format, candidates, duplicates, versions and diffs, untouched originals,
// rejected files, and re-indexing from the saved analyses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, sandbox } from '../helpers.ts';

const box = sandbox('empty');
const { ingestBuffer, readRegistry, reindexDocuments } = await import('../../backend/src/ingest/pipeline.ts');
const { readZip, writeZip } = await import('../../backend/src/ingest/zip.ts');
const { extractPdf } = await import('../../backend/src/ingest/pdf.ts');
const { all, get } = await import('../../backend/src/db.ts');
const { sha256 } = await import('../../backend/src/util.ts');

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const p = (t: string, style = '', list = false) => `<w:p>${style || list ? `<w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : ''}</w:pPr>` : ''}<w:r><w:t xml:space="preserve">${t}</w:t></w:r></w:p>`;
const cell = (t: string) => `<w:tc>${p(t)}</w:tc>`;
function docx(extra = ''): Buffer {
  const body = [
    p('RMPO Open Quantity', 'Heading1'),
    p('Open Qty is the quantity still to be received against the order.'),
    p('Open Qty = Order Qty - Received Qty'),
    p('Received Qty must not exceed Order Qty.'),
    extra,
    p('Steps', 'Heading2'), p('Open the RMPO list', '', true), p('Select the order', '', true), p('Check the open quantity', '', true),
    `<w:tbl><w:tr>${cell('Field')}${cell('Qty')}</w:tr><w:tr>${cell('Order Qty')}${cell('100')}</w:tr><w:tr>${cell('Received Qty')}${cell('40')}</w:tr></w:tbl>`,
  ].join('');
  return writeZip([
    { name: '[Content_Types].xml', data: Buffer.from('<?xml version="1.0"?><Types/>') },
    { name: 'word/document.xml', data: Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><w:document ${W}><w:body>${body}</w:body></w:document>`) },
    { name: 'word/styles.xml', data: Buffer.from(`<w:styles ${W}><w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/></w:style></w:styles>`) },
  ]);
}

test('zip writer and reader round trip', () => {
  const z = readZip(writeZip([{ name: 'a/b.txt', data: Buffer.from('hello') }]));
  assert.equal(z.get('a/b.txt')!.read().toString(), 'hello');
});

test('DOCX: headings, paragraphs, lists, tables; candidates; extracted file; original untouched', async () => {
  const buf = docx();
  const r = await ingestBuffer(buf, { originalName: 'RMPO spec.docx', knowledgeStatus: 'source-documented', uploadedBy: 'test' });
  assert.equal(r.status, 'created', r.message);
  assert.equal(r.quality, 'complete');
  const doc = readRegistry().documents.find((d) => d.id === r.documentId)!;
  const v = doc.versions[0];
  assert.equal(sha256(fs.readFileSync(path.join(box.knowledge, v.stored_path))), sha256(buf));
  const text = fs.readFileSync(path.join(box.knowledge, v.extracted_path!), 'utf8');
  assert.match(text, /# RMPO Open Quantity/);
  assert.match(text, /\| Order Qty \| 100 \|/);
  assert.match(text, /• Select the order/);
  const kinds = new Set(all<{ kind: string }>('SELECT kind FROM candidates WHERE doc_id = ?', r.documentId).map((x) => x.kind));
  for (const k of ['definition', 'formula', 'validation', 'workflow_steps', 'table']) assert.ok(kinds.has(k), `candidate ${k}`);
  assert.ok(Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ?', r.documentId)!.n) >= 3);
});

test('same file again is a duplicate; a changed file with a variant name is a new version with a diff', async () => {
  const again = await ingestBuffer(docx(), { originalName: 'copy of anything.docx' });
  assert.equal(again.status, 'duplicate');
  const v2 = await ingestBuffer(docx(p('Short Qty = Received Qty - Accepted Qty')), { originalName: 'RMPO spec (1).docx' });
  assert.equal(v2.status, 'new-version', v2.message);
  assert.equal(v2.version, 2);
  assert.ok(v2.diff!.formulas_added.some((f) => /Short Qty/.test(f)), JSON.stringify(v2.diff));
  const cur = Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ? AND is_current = 1 AND doc_version = 1', v2.documentId)!.n);
  assert.equal(cur, 0, 'version 1 chunks are history, not current');
});

test('XLSX, CSV, JSON: tables with column types, units and identifiers', async () => {
  const sheet = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>3</v></c></row><row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2"><v>120</v></c><c r="C2"><v>2.5</v></c></row></sheetData></worksheet>';
  const xlsx = writeZip([
    { name: 'xl/workbook.xml', data: Buffer.from('<workbook><sheets><sheet name="BOM Lines" sheetId="1" r:id="rId1"/></sheets></workbook>') },
    { name: 'xl/_rels/workbook.xml.rels', data: Buffer.from('<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>') },
    { name: 'xl/sharedStrings.xml', data: Buffer.from('<sst><si><t>Article Code</t></si><si><t>Qty</t></si><si><t>N-8</t></si><si><t>Wastage %</t></si></sst>') },
    { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
  ]);
  const x = await ingestBuffer(xlsx, { originalName: 'bom.xlsx' });
  assert.equal(x.status, 'created', x.message);
  const xt = JSON.parse(fs.readFileSync(path.join(box.knowledge, readRegistry().documents.find((d) => d.id === x.documentId)!.versions[0].analysis_path!), 'utf8')).tables[0];
  assert.deepEqual(xt.headers, ['Article Code', 'Qty', 'Wastage %']);
  assert.deepEqual(xt.types, ['text', 'integer', 'decimal']);
  assert.equal(xt.units['Wastage %'], '%');
  const csv = await ingestBuffer(Buffer.from('PO No,Date,Qty,Rate\nRMPO-1229,2026-11-01,100,10.5\nRMPO-1230,2026-11-02,50,12\n'), { originalName: 'po.csv' });
  const ct = JSON.parse(fs.readFileSync(path.join(box.knowledge, readRegistry().documents.find((d) => d.id === csv.documentId)!.versions[0].analysis_path!), 'utf8')).tables[0];
  assert.deepEqual(ct.types, ['text', 'date', 'integer', 'decimal']);
  assert.ok(ct.identifiers.includes('PO No'));
  const json = await ingestBuffer(Buffer.from(JSON.stringify([{ code: 'A', qty: 1 }, { code: 'B', qty: 2 }])), { originalName: 'rows.json' });
  assert.equal(json.status, 'created');
  assert.ok(Number(get<{ n: number }>("SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ? AND kind = 'data_row'", json.documentId)!.n) === 2);
});

test('Markdown with Mermaid, Mermaid files, HTML and rule-format TXT keep their structure', async () => {
  const md = await ingestBuffer(Buffer.from('# Flow\n\nIntro text.\n\n```mermaid\nflowchart TD\nA[Indent] --> B{Stock?}\nB -- yes --> C[In-house adjustment]\nB -- no --> D[RMPO]\n```\n\n| Col | Val |\n| --- | --- |\n| a | 1 |\n'), { originalName: 'flow.md' });
  assert.equal(md.status, 'created');
  assert.ok(Number(get<{ n: number }>("SELECT COUNT(*) AS n FROM chunks WHERE doc_id = ? AND kind = 'diagram'", md.documentId)!.n) === 1);
  const mmd = await ingestBuffer(Buffer.from('graph LR\nS([Start]) --> Q{Approved?}\nQ -->|yes| E([End])'), { originalName: 'approval.mmd' });
  assert.equal(mmd.stats!['quality'], 'complete');
  const html = await ingestBuffer(Buffer.from('<html><head><title>Spec</title><script>alert(1)</script></head><body><h1>Sales Order</h1><p>The order has deliveries.</p><table><tr><th>Field</th><th>Type</th></tr><tr><td>OC No</td><td>Key</td></tr></table></body></html>'), { originalName: 'spec.html' });
  const htext = fs.readFileSync(path.join(box.knowledge, readRegistry().documents.find((d) => d.id === html.documentId)!.versions[0].extracted_path!), 'utf8');
  assert.match(htext, /# Sales Order/);
  assert.doesNotMatch(htext, /alert\(1\)/, 'scripts are not kept as content');
  const txt = await ingestBuffer(Buffer.from('RULE ID: CALC-X-1\nRULE NAME: X\nFORMULA / LOGIC: X = A - B\nSOURCE: owner\nVERSION: 1\nSTATUS: Draft\n'), { originalName: 'rules.txt' });
  assert.ok(all<{ kind: string }>('SELECT kind FROM candidates WHERE doc_id = ?', txt.documentId).some((c) => c.kind === 'entry'));
});

test('untrusted files are rejected: wrong signature, unsupported type, empty', async () => {
  const fake = await ingestBuffer(Buffer.from('this is not an image'), { originalName: 'photo.png' });
  assert.equal(fake.status, 'rejected');
  assert.match(fake.message, /not a PNG/);
  assert.equal((await ingestBuffer(Buffer.from('MZ...'), { originalName: 'tool.exe' })).status, 'rejected');
  assert.equal((await ingestBuffer(Buffer.alloc(0), { originalName: 'empty.txt' })).status, 'rejected');
  assert.equal((await ingestBuffer(Buffer.from([0x50, 0x4b, 0, 0]), { originalName: 'bad.pdf' })).status, 'rejected');
});

test('PDF text extraction works on the real Inventory/QC manual (when present)', (t) => {
  const reg = JSON.parse(fs.readFileSync(path.join(ROOT, 'knowledge', 'metadata', 'source_registry.json'), 'utf8')) as { documents: { ext: string; versions: { stored_path: string }[] }[] };
  const pdf = reg.documents.find((d) => d.ext === 'pdf');
  const file = pdf ? path.join(ROOT, 'knowledge', pdf.versions[0].stored_path) : '';
  if (!pdf || !fs.existsSync(file)) { t.skip('no PDF in the library'); return; }
  const r = extractPdf(fs.readFileSync(file));
  assert.ok(r.pages.length >= 1);
  assert.ok(r.pages.join(' ').length > 500);
  assert.match(r.pages.join(' '), /GRN|QC|inventory/i);
});

test('re-indexing rebuilds the same document chunks from the saved analyses', async () => {
  const before = Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM chunks WHERE doc_id IS NOT NULL')!.n);
  const r = await reindexDocuments();
  assert.equal(r.chunks, before);
  assert.equal(r.documents, readRegistry().documents.length);
});
