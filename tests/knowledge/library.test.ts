// TXT format and library: parser/serializer round trip, error reporting, validation, and the migrated library itself
// (every v1 item present, statuses mapped as documented, no invented content markers missing).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { ROOT } from '../helpers.ts';
import { makeEntry, parseTxt, serializeEntry, serializeFile, validateEntry } from '../../backend/src/knowledge/txt.ts';
import { loadLibrary } from '../../backend/src/knowledge/library.ts';

process.env['WFX_KNOWLEDGE_DIR'] = path.join(ROOT, 'knowledge');

test('round trip: multi-line values, blank lines inside values, comments, separators', () => {
  const e = makeEntry('rule', 'CALC-TEST-ONE', { 'RULE NAME': 'Test', 'FORMULA / LOGIC': 'Line one\n\nLine three', SOURCE: 'unit test', VERSION: '1', STATUS: 'Draft' });
  const text = serializeFile(['header comment'], [e, makeEntry('term', 'TERM-X', { TERM: 'X', DEFINITION: 'Y', SOURCE: 's', VERSION: '1', STATUS: 'Active' })]);
  const back = parseTxt(text, 'x.txt');
  assert.equal(back.problems.length, 0);
  assert.equal(back.entries.length, 2);
  assert.equal(back.entries[0].fields['FORMULA / LOGIC'], 'Line one\n\nLine three');
  assert.equal(serializeEntry(back.entries[0]), serializeEntry(e));
  assert.equal(back.entries[1].type, 'term');
});

test('problems are reported, not thrown', () => {
  const r = parseTxt('RULE NAME: orphan\nRULE ID: bad id\nRULE NAME: A\nRULE NAME: B\nnot indented text', 'p.txt');
  assert.ok(r.problems.some((p) => /outside an entry/.test(p.message)));
  assert.ok(r.problems.some((p) => /Invalid ID/.test(p.message)));
  assert.ok(r.problems.some((p) => /appears twice/.test(p.message)));
  assert.ok(r.problems.some((p) => /not indented/.test(p.message)));
});

test('validation names what is missing', () => {
  const p = validateEntry(makeEntry('rule', 'RULE-X', { 'RULE NAME': 'X', STATUS: 'Maybe', VERSION: 'one' }));
  assert.ok(p.some((x) => /SOURCE/.test(x)));
  assert.ok(p.some((x) => /Unknown STATUS/.test(x)));
  assert.ok(p.some((x) => /VERSION/.test(x)));
});

const lib = loadLibrary();

test('the library parses without problems and every entry is valid', () => {
  assert.deepEqual(lib.problems, []);
  const invalid = lib.entries.map((e) => ({ id: e.id, p: validateEntry(e) })).filter((x) => x.p.length);
  assert.deepEqual(invalid, []);
  const keys = new Set<string>();
  for (const e of lib.entries) {
    const k = `${e.id}@${e.fields['VERSION']}`;
    assert.ok(!keys.has(k), `duplicate ${k}`);
    keys.add(k);
  }
});

test('migration kept every v1 item (counts match the v1 data)', async () => {
  const out = path.join(ROOT, 'backend', '.cache', 'v1-dump.test.mjs');
  await build({ entryPoints: [path.join(ROOT, 'backend', 'scripts', 'v1-dump.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'silent' });
  const v1 = (await import(pathToFileURL(out).href)).dump();
  const count = (t: string) => lib.entries.filter((e) => e.type === t && !(e.file ?? '').startsWith('review/')).length;
  const concepts = Object.values(v1.concepts as Record<string, unknown[]>).reduce((a, l) => a + l.length, 0);
  assert.equal(count('module'), v1.modules.length);
  assert.ok(count('procedure') >= v1.manuals.length, 'every v1 manual kept (procedures added later, e.g. the apparel techpack procedure, are extra)');
  assert.equal(count('transaction'), v1.transactions.length);
  assert.equal(count('model'), v1.docs.length);
  assert.ok(count('term') >= v1.glossary.length + v1.articleCodeSections.length, 'every v1 term kept (terms added later are extra)');
  assert.ok(count('field') >= v1.transactions.reduce((a: number, t: { fieldGroups: { fields: unknown[] }[] }) => a + t.fieldGroups.reduce((b, g) => b + g.fields.length, 0), 0), 'every v1 field kept (fields added later are extra)');
  assert.ok(count('rule') >= v1.soConcepts.length + v1.soActions.length + concepts + v1.articleCodeRules.length + v1.calculations.length + 1);
  assert.equal(count('workflow'), 1 + v1.scenarios.length + v1.flows.length + 1);
  // every v1 calculation and Sales Order rule is present by ID
  const ids = new Set(lib.entries.map((e) => e.id));
  for (const c of v1.calculations) assert.ok(ids.has(`CALC-${c.id.toUpperCase()}`), c.id);
  for (const m of v1.manuals) assert.ok(lib.entries.some((e) => e.type === 'procedure' && e.fields['TITLE'] === m.title), m.title);
});

test('statuses follow the documented policy', () => {
  const byId = (id: string) => lib.entries.find((e) => e.id === id)!;
  // assumed in v1 → Under Review, with the open question kept
  for (const id of ['CALC-BOM-VALUE-CS', 'CALC-MRP-L1-REQ', 'CALC-SO-PACK-PCS', 'CALC-FPPO-OPEN']) {
    assert.equal(byId(id).fields['STATUS'], 'Under Review', id);
    assert.ok(byId(id).fields['OPEN QUESTION'], `${id} keeps its open question`);
  }
  // the owner/screen conflict is recorded, not resolved silently
  assert.equal(byId('CALC-ROUTING-PROCESS-RATE').fields['STATUS'], 'Under Review');
  assert.match(byId('CALC-ROUTING-PROCESS-RATE').fields['CONFLICT'], /"\+"/);
  // inferred content is labelled
  const roll = lib.entries.find((e) => e.type === 'procedure' && /roll functionality/i.test(e.fields['TOPIC'] ?? ''))!;
  assert.equal(roll.fields['STATUS'], 'Under Review');
  assert.match(roll.fields['INFERENCE'], /inference/i);
  // every entry says where it comes from
  assert.ok(lib.entries.every((e) => (e.fields['SOURCE'] ?? '').length > 10));
});
