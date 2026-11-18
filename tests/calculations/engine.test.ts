// Calculation engine: grammar, safety, errors, generated test cases, and the migrated rules recomputed against the
// values captured from WFX (data/*.csv). A mismatch here means a stored formula disagrees with real WFX output.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCsv, ROOT } from '../helpers.ts';
import { CalcError, evaluate, generateTests, parseSpec } from '../../backend/src/calc/engine.ts';
import { loadLibrary } from '../../backend/src/knowledge/library.ts';

process.env['WFX_KNOWLEDGE_DIR'] = `${ROOT}/knowledge`;
const lib = loadLibrary();
const rule = (id: string) => {
  const e = lib.entries.find((x) => x.id === id);
  assert.ok(e, `${id} exists in the library`);
  return e!;
};
const spec = (expr: string, inputs: string) => parseSpec({ EXPRESSION: expr, 'CALC INPUTS': inputs })!;

test('grammar: precedence, parentheses, unary minus, functions, comparisons', () => {
  const s = spec('a1 = 2 + 3 * 4\na2 = (2 + 3) * 4\na3 = -x + 10\na4 = MIN(x, 3, 9)\na5 = ROUND(10 / 3, 2)\na6 = IF(x > 4, 1, 0)\na7 = x × 2 ÷ 4 − 1', 'x | X | number | required');
  const r = evaluate(s, { x: 5 });
  assert.equal(r.ok, true);
  assert.deepEqual([r.values['a1'], r.values['a2'], r.values['a3'], r.values['a4'], r.values['a5'], r.values['a6'], r.values['a7']], [14, 20, 5, 3, 3.33, 1, 1.5]);
  assert.equal(r.steps.length, 7);
});

test('safety: code, property access and unknown names are rejected at parse time', () => {
  const bad = ['x = process.exit()', "x = require('fs')", 'x = constructor', 'x = a; y = 2', 'x = this', 'x = `a`', 'x = EVAL(1)', 'x = 1 ** 2'];
  for (const b of bad) assert.throws(() => spec(b, 'a | A | number | required'), CalcError, b);
  assert.throws(() => spec('a = 1', 'a | A | number | required'), /overwrite an input/);
  assert.throws(() => parseSpec({ EXPRESSION: 'x = y', 'CALC INPUTS': 'Y | Y | number | required' }), /lower case/);
});

test('input handling: missing, invalid, defaults, warnings, division by zero', () => {
  const s = spec('r = a / (1 - p / 100)', 'a | A | quantity | required\np | P | percent | default 0');
  assert.equal(evaluate(s, {}).ok, false);
  assert.match(evaluate(s, {}).errors[0], /Missing input: A/);
  assert.match(evaluate(s, { a: 'abc' }).errors[0], /not a number/);
  const d = evaluate(s, { a: '1,000' });
  assert.equal(d.result, 1000);
  assert.equal(d.inputsUsed.find((i) => i.name === 'p')!.defaulted, true);
  assert.match(evaluate(s, { a: 1, p: 150 }).warnings[0], /outside 0–100/);
  assert.match(evaluate(s, { a: 1, p: 100 }).errors[0], /Division by zero/);
  assert.match(evaluate(s, { a: -5 }).warnings[0], /negative/);
});

test('consumption chain: the owner\'s worked examples (TEST CASES) and generated cases all pass', () => {
  const e = rule('CALC-CONSUMPTION-CHAIN');
  const s = parseSpec(e.fields)!;
  const cases = generateTests(s, e.fields['TEST CASES']);
  const failed = cases.filter((c) => !c.pass);
  assert.equal(failed.length, 0, failed.map((c) => `${c.name}: ${c.detail}`).join('\n'));
  assert.ok(cases.filter((c) => c.kind === 'standard').length >= 4);
  assert.ok(['zero', 'minimum', 'maximum', 'null', 'invalid', 'boundary'].every((k) => cases.some((c) => c.kind === k)));
  assert.ok(Math.abs(evaluate(s, { cons_qty: 2, loss_pct: 5, wastage_pct: 5, shrinkage_pct: 5 }).result! - 2.326869806) < 1e-8);
});

test('every rule with an EXPRESSION parses', () => {
  const withExpr = lib.entries.filter((e) => e.fields['EXPRESSION']);
  assert.ok(withExpr.length >= 40, `found ${withExpr.length}`);
  for (const e of withExpr) assert.doesNotThrow(() => parseSpec(e.fields), e.id);
});

// rule → captured table → which columns feed which inputs → which column holds the WFX value
const CHECKS: { id: string; csv: string; inputs: Record<string, string | number>; expect: [string, string]; tol?: number }[] = [
  { id: 'CALC-GRN-ACCEPTED', csv: 'data/sourcing/grn.csv', inputs: { received_qty: 'received_qty', rejected_qty: 'rejected_qty' }, expect: ['accepted_qty', 'accepted_qty'] },
  { id: 'CALC-BBB-MATERIAL-VALUE', csv: 'data/sourcing/bbb.csv', inputs: { units: 'units', rate: 'rate' }, expect: ['value', 'value'] },
  { id: 'CALC-BBB-BALANCE', csv: 'data/sourcing/bbb.csv', inputs: { units: 'units', indented_qty: 'indented_qty' }, expect: ['balance_to_indent', 'balance_to_indent'] },
  { id: 'CALC-RMPO-VALUE', csv: 'data/sourcing/rmpo_1229.csv', inputs: { ordered_qty: 'ordered_qty', price_per_unit: 'price_per_unit' }, expect: ['total_value', 'total_value'] },
  { id: 'CALC-RMPO-OPEN', csv: 'data/sourcing/rmpo_1229.csv', inputs: { ordered_qty: 'ordered_qty', shipped_qty: 'shipped_qty' }, expect: ['open_qty', 'open_qty'] },
  { id: 'CALC-RMPO-OPEN', csv: 'data/sourcing/rmpo_1230.csv', inputs: { ordered_qty: 'ordered_qty', shipped_qty: 'shipped_qty' }, expect: ['open_qty', 'open_qty'] },
  { id: 'CALC-PI-ORDERED', csv: 'data/planning/so_indent.csv', inputs: { indent_qty: 'indent_qty', in_house_adj: 'in_house_adj' }, expect: ['ordered_qty', 'ordered_qty'] },
  { id: 'CALC-PI-INHOUSE-ADJ', csv: 'data/planning/so_indent.csv', inputs: { indent_qty: 'indent_qty', bbb_stock_available: 'bbb_stock_available' }, expect: ['in_house_adj', 'in_house_adj'] },
  { id: 'CALC-PI-PURCHASE-UOM', csv: 'data/planning/so_indent.csv', inputs: { indent_qty: 'indent_qty', conversion_factor: 1000 }, expect: ['purchase_uom_indent_qty', 'purchase_uom_qty'] },
  { id: 'CALC-MRP-L2-REQ', csv: 'data/planning/mrp_l2.csv', inputs: { garment_req_qty: 'garment_req_qty', final_consumption: 'final_consumption' }, expect: ['actual_requirement', 'req_qty'] },
  { id: 'CALC-MRP-L1-REQ', csv: 'data/planning/mrp_l1.csv', inputs: { actual_requirement: 'actual_requirement', mrp_pct: 'mrp_pct' }, expect: ['req_qty', 'req_qty'] },
  { id: 'CALC-FPO-QTY', csv: 'data/production/fpo_qty.csv', inputs: { allocated_qty: 'allocated_qty', reduced_at_fpo: 'reduced_at_fpo' }, expect: ['fpo_qty', 'fpo_qty'] },
  { id: 'CALC-FPO-FABRIC', csv: 'data/production/fpo_qty.csv', inputs: { fpo_qty: 'fpo_qty', final_consumption: 'final_consumption' }, expect: ['fabric_qty_reqd', 'fabric_qty_reqd'] },
  { id: 'CALC-FPO-ALLOC-OPEN', csv: 'data/production/fpo_alloc.csv', inputs: { qty_reqd: 'qty_reqd', qty_instructed: 'net_qty_instructed' }, expect: ['open_qty', 'open_qty'] },
  { id: 'CALC-OC-VALUE', csv: 'data/order/oc.csv', inputs: { qty: 'qty', selling_price: 'selling_price' }, expect: ['total_value', 'total_value'], tol: 0.01 },
  { id: 'CALC-BOM-CONS-QTY', csv: 'data/product-development/bom_materials.csv', inputs: { total_cons_qty: 'total_cons_qty', cons_per_item: 'cons_per_item' }, expect: ['cons_qty', 'cons_qty'] },
  { id: 'CALC-BOM-FINAL-CONS', csv: 'data/product-development/bom_materials.csv', inputs: { cons_qty: 'cons_qty', loss_pct: 'loss_pct', wastage_pct: 'wastage_pct', shrinkage_pct: 'shrinkage_pct' }, expect: ['final_consumption', 'final_consumption'], tol: 0.0001 },
  { id: 'CALC-ROUTING-PROCESS-RATE', csv: 'data/product-development/routing_operations.csv', inputs: { cost_of: 'cost_of', production_time: 'production_time' }, expect: ['process_rate', 'cost_of_time'] },
  { id: 'CALC-CONSUMPTION-CHAIN', csv: 'data/product-development/bom_consumption_chain.csv', inputs: { cons_qty: 'cons_qty', loss_pct: 'loss_pct', wastage_pct: 'wastage_pct', shrinkage_pct: 'shrinkage_pct' }, expect: ['total_consumption', 'total_consumption'], tol: 0.00001 },
];

for (const c of CHECKS) {
  test(`${c.id} reproduces the captured WFX values in ${c.csv}`, () => {
    const s = parseSpec(rule(c.id).fields)!;
    const rows = readCsv(c.csv).filter((r) => Object.values(c.inputs).every((col) => typeof col === 'number' || (r[col] !== undefined && r[col] !== '')));
    assert.ok(rows.length > 0, 'the table has rows');
    for (const row of rows) {
      const inputs = Object.fromEntries(Object.entries(c.inputs).map(([k, col]) => [k, typeof col === 'number' ? col : row[col]]));
      const r = evaluate(s, inputs);
      assert.equal(r.ok, true, r.errors.join(' '));
      const want = Number(row[c.expect[1]]);
      const got = r.values[c.expect[0]];
      assert.ok(Math.abs(got - want) <= (c.tol ?? 1e-6) * Math.max(1, Math.abs(want)), `${c.id}: inputs ${JSON.stringify(inputs)} gave ${got}, WFX shows ${want}`);
    }
  });
}
