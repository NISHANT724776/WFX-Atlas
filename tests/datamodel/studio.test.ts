// Data modelling studio: captured models keep documented links and invent no schema; drafts from a requirement are
// proposals (relationships, many-to-many, logical keys and junction tables marked inferred); checks; ER, dictionary,
// DDL; saved drafts round-trip and never answer data-model questions as confirmed WFX knowledge.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from '../helpers.ts';

sandbox('copy');
const { indexLibrary } = await import('../../backend/src/index/indexer.ts');
const s = await import('../../backend/src/datamodel/studio.ts');
const { saveDraft } = await import('../../backend/src/rules/rules.ts');
const { answerQuestion } = await import('../../backend/src/assistant/answer.ts');
indexLibrary();

test('all 28 captured models open; GRN lines take their values from RMPO 1229 (documented)', () => {
  assert.equal(s.listModels().captured.length, 28);
  for (const c of s.listModels().captured) assert.ok(s.openModel(c.id)!.entities.length >= 1, c.id);
  const m = s.openModel('DM-GRN')!;
  assert.equal(m.level, 'captured');
  const grid = m.entities.find((e) => e.name === 'GRN · GRN Qty')!;
  assert.equal(grid.attributes.find((a) => a.name === 'Accepted Qty')!.rule, 'CALC-GRN-ACCEPTED');
  const link = m.relationships.find((r) => r.from === grid.id && r.to === 'DM-RMPO-1229')!;
  assert.equal(link.basis, 'documented');
  assert.match(link.label, /PO Line.*Ordered Qty.*Stock Key/);
  assert.equal(m.relationships.find((r) => r.to === grid.id)!.basis, 'inferred', 'a grid holding the lines of its document is an inference');
});

test('captured outputs: no foreign keys or table claims; DDL labelled as not WFX schema', () => {
  const v = s.modelView(s.openModel('DM-BOM-MATERIALS')!);
  assert.match(v.ddl, /^-- PROPOSED DRAFT – NOT THE WFX DATABASE SCHEMA\./);
  assert.doesNotMatch(v.ddl, /FOREIGN KEY \(/);
  assert.match(v.mermaid, /^erDiagram/);
  assert.ok(v.dictionary.rows.some((r) => r[1] === 'Final Consumption' && r[5].includes('CALC-BOM-FINAL-CONS')));
  assert.ok(v.checks.some((c) => /copy of rm-techpack/.test(c.message)), 'copied fields flagged (3NF)');
  const map = s.openModel('DM-MAP')!;
  assert.equal(map.entities.length, 28);
  assert.ok(map.relationships.some((r) => r.from === 'DM-GRN' && r.to === 'DM-RMPO-1229'));
});

const REQ = `Supplier: code (key), name, country
A purchase order has many lines.
Each purchase order belongs to one supplier.
Line: item, qty: decimal, rate: decimal, delivery date
A style can have many colours and a colour can be used by many styles.
Orders and seasons are many-to-many
Orders get approved quickly.`;

test('draft from a requirement: entities, cardinalities, unknown sentences reported, everything proposed', () => {
  const { model, notUnderstood } = s.draftFromText(REQ, 'PO design');
  assert.deepEqual(notUnderstood, ['Orders get approved quickly.']);
  const nm = (id: string) => model.entities.find((e) => e.id === id)!.name;
  const card = (a: string, b: string) => model.relationships.find((r) => nm(r.from) === a && nm(r.to) === b)?.cardinality;
  assert.equal(card('Purchase Order', 'Line'), '1:N');
  assert.equal(card('Purchase Order', 'Supplier'), 'N:1');
  assert.equal(card('Style', 'Colour'), 'M:N');
  assert.equal(card('Order', 'Season'), 'M:N');
  assert.ok(model.entities.every((e) => e.basis === 'proposed'));
  assert.equal(model.entities.find((e) => e.name === 'Supplier')!.attributes.find((a) => a.name === 'code')!.pk, true);
  assert.equal(model.entities.find((e) => e.name === 'Line')!.attributes.find((a) => a.name === 'qty')!.type, 'decimal');
});

test('"has many" plus "belongs to one" for the same pair stays one-to-many; opposite "many" sides become many-to-many', () => {
  const a = s.draftFromText('An order has many lines\nEach line belongs to one order').model;
  assert.equal(a.relationships.length, 1); assert.equal(a.relationships[0].cardinality, '1:N');
  const b = s.draftFromText('A style has many colours\nA colour has many styles').model;
  assert.equal(b.relationships[0].cardinality, 'M:N');
});

test('logical view: surrogate keys, foreign keys on the many side, junction table (all inferred); checks', () => {
  const { model } = s.draftFromText(REQ, 'PO design');
  const l = s.toLogical(model);
  const po = l.entities.find((e) => e.name === 'Purchase Order')!;
  assert.ok(po.attributes.some((a) => a.pk && a.basis === 'inferred'));
  assert.equal(po.attributes.find((a) => a.fk === 'Supplier')!.basis, 'inferred');
  assert.ok(l.entities.find((e) => e.name === 'Line')!.attributes.some((a) => a.fk === 'Purchase Order'));
  const j = l.entities.find((e) => e.name === 'Style Colour')!;
  assert.equal(j.basis, 'inferred'); assert.equal(j.attributes.filter((a) => a.pk).length, 2);
  assert.ok(!l.relationships.some((r) => r.cardinality === 'M:N'));
  const ddl = s.toDdl(model);
  assert.match(ddl, /CREATE TABLE style_colour[\s\S]*PRIMARY KEY \(style_id, colour_id\)/);
  assert.match(ddl, /FOREIGN KEY \(purchase_order_id\) REFERENCES purchase_order/);
  const checks = s.checkModel(model);
  assert.ok(checks.some((c) => c.entity === 'Line' && /No key/.test(c.message)));
  assert.ok(checks.some((c) => c.entity === 'Purchase Order' && /No attributes/.test(c.message)));
  assert.ok(checks.some((c) => /Many-to-many/.test(c.message)));
  const bad = structuredClone(model); bad.entities[0].attributes.push({ ...bad.entities[0].attributes[0], name: 'x', pk: false, fk: 'Nowhere' });
  assert.ok(s.checkModel(bad).some((c) => c.level === 'error' && /Nowhere/.test(c.message)));
  const rep = s.draftFromText('Order: size1, size2, colours').model;
  assert.ok(s.checkModel(rep).some((c) => /repeating group/.test(c.message)));
});

test('saved draft round-trips through TXT, is a Draft, and is never used as a confirmed data-model answer', () => {
  const { model } = s.draftFromText('GRN: grn no (key), remarks\nA GRN has many cartons\nCarton: carton no (key), weight: decimal', 'Carton receipt');
  const out = saveDraft(s.modelToEntry(model, 'tester'), 'tester', 'editor', 'test');
  assert.equal(out.id, 'DM-DRAFT-CARTON-RECEIPT');
  const back = s.openModel(out.id)!;
  assert.equal(back.status, 'Draft');
  assert.deepEqual(back.entities.map((e) => [e.name, e.attributes.length]), model.entities.map((e) => [e.name, e.attributes.length]));
  assert.equal(back.relationships[0].cardinality, '1:N');
  assert.equal(back.requirement, model.requirement.trim());
  assert.ok(s.listModels().drafts.some((d) => d.id === out.id));
  assert.ok(s.capturedMatches(back).some((m) => m.model === 'DM-GRN'), 'linked to the captured GRN model by name');
  // a captured model id can never be overwritten by a draft
  assert.notEqual(s.modelToEntry({ ...model, id: 'DM-GRN' }, 't').id, 'DM-GRN');
  const a = answerQuestion('show the data model of carton receipt', { mode: 'data_model' });
  assert.notEqual(a.status, 'confirmed');
});
