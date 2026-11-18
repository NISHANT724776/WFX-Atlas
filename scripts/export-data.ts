// Exports every data table of the hub to CSV, one folder per module, plus manifest.json.
// Bundled with esbuild and run before each build (see scripts/export-data.mjs). Output: public/data/<module>/<table>.csv
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { COLORS, SIZES, TXN_INDEX } from '../src/app/data/catalog';
import { CALCULATIONS } from '../src/app/data/calculations';
import { DOCS, dependencyFor } from '../src/app/data/docs';
import { ARTICLE_CODE_RULES, ARTICLE_CODE_SECTIONS, ARTICLE_CODING, BOM_CONCEPTS, DEPENDENCY_TYPES, MRP_CONCEPTS, UOM_TYPES } from '../src/app/data/concepts';
import { SO_ACTIONS, SO_APPROVAL_SCENARIOS, SO_CONCEPTS, SO_DESYNC_STEPS, SO_EX_FACTORY, SO_PACKING, SO_PACKING_EXAMPLE, SO_PURCHASE_DEMAND, SO_SPLIT_SCENARIOS, SO_SUBTOTAL, SO_UPCHARGE_SCENARIOS } from '../src/app/data/salesorder';
import { MANUALS, MANUAL_TABLES } from '../src/app/data/manuals';
import { GLOSSARY } from '../src/app/data/glossary';
import { THEORY_SUMMARY } from '../src/app/data/theory-extras';
import { TRANSACTIONS } from '../src/app/data/transactions';

type Val = string | number | boolean | null | undefined;
interface Table { module: string; name: string; description: string; columns: string[]; rows: Val[][]; document?: string; grid?: string; }

const OUT = join(process.argv[2] ?? 'public', 'data');
const tables: Table[] = [];
const snake = (s: string) => s.toLowerCase().replace(/%/g, ' pct').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

const MODULE_OF: Record<string, string> = {
  'rm-techpack': 'product-development', apparel: 'product-development', 'bom-materials': 'product-development',
  'routing-processes': 'product-development', 'routing-operations': 'product-development', 'material-linkage': 'product-development',
  'bom-cost': 'product-development', 'bom-58': 'product-development',
  bbb: 'sourcing', 'adhoc-indent': 'sourcing', 'rmpo-1229': 'sourcing', grn: 'sourcing', 'rmpo-1230': 'sourcing',
  oc: 'order', mrp: 'planning', 'so-indent': 'planning', fpo: 'production',
};
const ARTICLE_OF_CHAPTER: Record<string, string> = { setup: 'NIS-59', order: 'NIS-58' };

// ── masters ───────────────────────────────────────────────────────────
tables.push({ module: 'masters', name: 'colours', description: 'Colour master – colour card Nis_colors.',
  columns: ['colour_code', 'colour_name', 'colour_card', 'display_hex'], rows: COLORS.map((c) => [c.code, c.name, 'Nis_colors', c.hex]) });
tables.push({ module: 'masters', name: 'sizes', description: 'Size master – size range ERPSIZE.',
  columns: ['size_code', 'size_name', 'display_name', 'size_range'], rows: SIZES.map((s) => [s.code, s.name, s.display, 'ERPSIZE']) });
tables.push({ module: 'masters', name: 'uom_conversion', description: 'Material-wise UOM conversion (factor 1 when none is maintained).',
  columns: ['article_code', 'from_uom', 'to_uom', 'factor'], rows: [['N-8', 'KG_Nis', 'meter', 1000]] });

// ── setup concepts (owner-explained) ──────────────────────────────────
const conceptCols = ['id', 'group_name', 'name', 'option_value', 'definition', 'where_used', 'example'];
const conceptRows = (l: typeof UOM_TYPES) => l.map((c) => [c.id, c.group, c.name, c.options ?? '', c.definition, c.where, c.example ?? '']);
tables.push({ module: 'masters', name: 'uom_types', description: 'The three UOM types: storage, consumption and purchase.', columns: conceptCols, rows: conceptRows(UOM_TYPES) });
tables.push({ module: 'masters', name: 'article_coding', description: 'How article codes and names are generated (manual, or automatic via Admin > System Coding).', columns: conceptCols, rows: conceptRows(ARTICLE_CODING) });
tables.push({ module: 'masters', name: 'article_code_sections', description: 'Code sections that can be chosen in an Article Code Definition.',
  columns: ['code_section', 'meaning'], rows: ARTICLE_CODE_SECTIONS.map((x) => [x.name, x.meaning]) });
tables.push({ module: 'masters', name: 'article_code_rules', description: 'Example automatic article-code rules (category Textiles/Fabric): one row per code section.',
  columns: ['rule', 'material_type', 'product_group', 'sub_category', 'code_section', 'value', 'sort'],
  rows: ARTICLE_CODE_RULES.flatMap((r) => r.parts.map((q) => [r.rule, r.materialType, r.productGroup, r.subCategory, q.section, q.value, q.sort])) });
tables.push({ module: 'product-development', name: 'dependency_types', description: 'Colour and size dependency types of a BOM line: Base, Table, None.', columns: conceptCols, rows: conceptRows(DEPENDENCY_TYPES) });
tables.push({ module: 'product-development', name: 'bom_concepts', description: 'BOM versions, Standard vs Production BOM, creation, master cost sheet and the indent status rule.', columns: conceptCols, rows: conceptRows(BOM_CONCEPTS) });

tables.push({ module: 'planning', name: 'mrp_rules', description: 'How MRP generates child indents and how a negative MRP adjustment reduces or cancels them.', columns: conceptCols, rows: conceptRows(MRP_CONCEPTS) });

// ── Sales Order (OC re-write) ─────────────────────────────────────────
tables.push({ module: 'order', name: 'sales_order_rules', description: 'Sales Order (OC re-write) rules: structure, pricing, quantity, delivery actions, approval, price sync, order types, transfer price, TNA, EDI.', columns: conceptCols, rows: conceptRows(SO_CONCEPTS) });
tables.push({ module: 'order', name: 'sales_order_actions', description: 'Delivery and order actions: where, what is needed, resulting status and rule.',
  columns: ['action', 'where_used', 'needs', 'result', 'rule'], rows: SO_ACTIONS.map((a) => [a.action, a.where, a.needs, a.result, a.rule]) });
tables.push({ module: 'order', name: 'sales_order_approval_scenarios', description: 'Approval value rule worked out: 0 never, -1 always, above 0 only when the order value exceeds the limit.',
  columns: ['approval_limit', 'order_value', 'goes_for_approval'], rows: SO_APPROVAL_SCENARIOS.map((x) => [x.limit, x.value, x.goes]) });
tables.push({ module: 'order', name: 'sales_order_split_scenarios', description: 'Split by percentage (20 %) and by quantity (100 pcs, spread in proportion) over three colour/size lines.',
  columns: ['mode', 'input', 'line', 'existing_qty', 'moved_qty', 'remaining_qty'], rows: SO_SPLIT_SCENARIOS.map((x) => [x.mode, x.input, x.line, x.existing, x.moved, x.remaining]) });
tables.push({ module: 'order', name: 'sales_order_upcharge', description: 'Final Selling Price = Base Selling Price ± Upcharge/Discount, by Price Per level.',
  columns: ['price_per_level', 'base_price', 'upcharge_discount', 'final_price', 'kind'], rows: SO_UPCHARGE_SCENARIOS.map((x) => [x.level, x.base, x.adj, x.final, x.kind]) });
tables.push({ module: 'order', name: 'sales_order_desync_steps', description: 'Desync price walk-through: cost sheet price against OC price.',
  columns: ['step', 'cost_sheet_price', 'oc_price', 'state'], rows: SO_DESYNC_STEPS.map((x) => [x.step, x.costSheet, x.oc, x.state]) });
tables.push({ module: 'order', name: 'sales_order_sub_total', description: 'Sub Total in the sales order currency (value × exchange rate).',
  columns: ['delivery', 'value', 'currency', 'rate_to_order_currency', 'sub_total', 'order_currency'], rows: SO_SUBTOTAL.map((x) => [x.delivery, x.value, x.currency, x.rate, x.subTotal, x.orderCurrency]) });
tables.push({ module: 'order', name: 'sales_order_purchase_demand', description: 'Purchase Demand at Level 1 reduces the material indents on the next MRP run.',
  columns: ['level1_qty', 'purchase_demand', 'manufacture_qty', 'final_consumption', 'material_indent_qty', 'result'], rows: SO_PURCHASE_DEMAND.map((x) => [x.level1, x.purchaseDemand, x.manufacture, x.finalCons, x.materialIndent, x.result]) });
tables.push({ module: 'order', name: 'sales_order_packing', description: 'Packing types and how the pieces are worked out.',
  columns: ['packing_type', 'popup', 'pp_column', 'rule', 'pcs', 'add_qty_tool'], rows: SO_PACKING.map((x) => [x.type, x.popup, x.pp, x.rule, x.pcs, x.addQty]) });
tables.push({ module: 'order', name: 'sales_order_packing_example', description: 'Worked example of Solid Color / Assorted Size (interpretation, to be confirmed).',
  columns: ['packing_type', 'ratio_s', 'ratio_m', 'ratio_l', 'packs', 'pcs'], rows: SO_PACKING_EXAMPLE.map((x) => [x.type, x.ratioS, x.ratioM, x.ratioL, x.packs, x.pcs]) });
tables.push({ module: 'order', name: 'sales_order_ex_factory', description: 'Ex-factory days: OC Delivery Date = Buyer Delivery Date − days.',
  columns: ['buyer_delivery_date', 'ex_factory_days', 'oc_delivery_date'], rows: SO_EX_FACTORY.map((x) => [x.buyerDate, x.days, x.ocDate]) });

// ── user manuals, module by module ────────────────────────────────────
for (const [table, meta] of Object.entries(MANUAL_TABLES)) {
  tables.push({ module: meta.module, name: table, description: meta.description,
    columns: ['document', 'topic', 'title', 'content', 'steps', 'where_used', 'notes'],
    rows: MANUALS.filter((m) => m.table === table).map((m) => [m.document, m.topic, m.title, m.content, (m.steps ?? []).map((x, i) => `${i + 1}. ${x}`).join('\n'), m.where ?? '', m.notes ?? '']) });
}

// ── every document grid as a table ────────────────────────────────────
for (const d of DOCS.filter((x) => x.chapter !== 'admin' && x.chapter !== 'sales')) {
  for (const g of d.grids) {
    const name = d.id === 'bom-materials' ? (g.id === 'lines' ? 'bom_materials' : 'bom_consumption_chain') : d.grids.length > 1 ? `${snake(d.id)}_${snake(g.id)}` : snake(d.id);
    tables.push({
      module: MODULE_OF[d.id] ?? 'other', name, document: d.id, grid: g.id,
      description: `${d.name} – ${g.title}. ${d.summary}`,
      columns: ['apparel_code', ...g.cols.map((c) => snake(c.label))],
      rows: g.rows.map((r) => [ARTICLE_OF_CHAPTER[d.chapter] ?? '', ...g.cols.map((c) => (c.dep ? 'Table' : r[c.key]) as Val)]),
    });
  }
}

// ── BOM colour / size dependency per line (Adi TShirt NIS-59) ─────────
for (const kind of ['color', 'size'] as const) {
  const rows: Val[][] = [];
  for (const line of ['N-8', 'T-1', 'NS1-1', 'PP-1']) {
    const dep = dependencyFor(kind, line);
    for (const r of dep.rows) rows.push(['NIS-59', '#1 DP', line, r.code, r.label, r.onArticle ? 'Yes' : 'No', r.material ?? (r.status === 'not-used' ? '[Not Used]' : ''), r.status]);
  }
  tables.push({ module: 'product-development', name: kind === 'color' ? 'bom_colour_dependency' : 'bom_size_dependency',
    description: `BOM ${kind === 'color' ? 'colour' : 'size'} dependency (type Table) per BOM line of Adi TShirt (NIS-59).`,
    columns: ['apparel_code', 'bom', 'bom_line_article', `${kind === 'color' ? 'colour' : 'size'}_code`, 'master_value', 'on_article', 'material_value', 'status'], rows });
}

// ── knowledge: transactions, fields, formulas, glossary, column lineage ─
tables.push({ module: 'knowledge', name: 'transactions', description: 'Every WFX transaction with its purpose and one-line summary.',
  columns: ['slug', 'step', 'name', 'module', 'screen', 'description', 'one_line', 'theory'],
  rows: TRANSACTIONS.map((t) => [t.slug, t.step, t.name, t.module, t.screen, t.description, THEORY_SUMMARY[t.slug]?.oneLine ?? '', t.theory.join(' ')]) });
tables.push({ module: 'knowledge', name: 'fields', description: 'Fields of each transaction: how they are filled and where they come from.',
  columns: ['transaction', 'field_group', 'field', 'type', 'definition', 'source_transaction', 'source_field', 'calculation_id'],
  rows: TRANSACTIONS.flatMap((t) => t.fieldGroups.flatMap((g) => g.fields.map((f) => [t.slug, g.title, f.name, f.kind, f.definition, f.from ?? '', f.fromField ?? '', f.calc ?? '']))) });
tables.push({ module: 'knowledge', name: 'calculations', description: 'Formula library with worked examples and verification status.',
  columns: ['id', 'transaction', 'name', 'formula', 'explanation', 'example', 'status', 'open_question'],
  rows: CALCULATIONS.map((c) => [c.id, c.txn, c.name, c.formula, c.explanation, c.example, c.status, c.question ?? '']) });
tables.push({ module: 'knowledge', name: 'glossary', description: 'Definitions of WFX terms.',
  columns: ['term', 'definition', 'transaction'], rows: GLOSSARY.map((g) => [g.term, g.definition, g.txn ?? '']) });
tables.push({ module: 'knowledge', name: 'document_columns', description: 'Every column of every document: type, formula and the column it is taken from.',
  columns: ['document', 'document_name', 'grid', 'grid_id', 'column_key', 'column_name', 'label', 'type', 'formula', 'calculated_from', 'source_document', 'source_column', 'calculation_id', 'note'],
  rows: DOCS.flatMap((d) => d.grids.flatMap((g) => g.cols.map((c) => [d.id, d.name, g.title, g.id, c.key, snake(c.label), c.label, c.type, c.formula ?? '',
    (c.uses ?? []).map((u) => g.cols.find((x) => x.key === u)?.label ?? u).join(', '), c.from?.doc ?? '', c.from ? (DOCS.find((x) => x.id === c.from!.doc)?.grids.flatMap((y) => y.cols).find((y) => y.key === c.from!.col)?.label ?? c.from.col) : '',
    c.calc ?? '', c.note ?? '']))) });
tables.push({ module: 'knowledge', name: 'flow', description: 'Transactions in flow order.',
  columns: ['step', 'slug', 'name', 'module', 'description'], rows: TXN_INDEX.map((t) => [t.step, t.slug, t.name, t.module, t.description]) });

// ── write ─────────────────────────────────────────────────────────────
const cell = (v: Val) => {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
rmSync(OUT, { recursive: true, force: true });
const manifest = tables.map((t) => {
  const file = `${t.module}/${t.name}.csv`;
  const path = join(OUT, file);
  mkdirSync(dirname(path), { recursive: true });
  const types = t.columns.map((_, i) => (t.rows.length && t.rows.every((r) => typeof r[i] === 'number' || r[i] === '' || r[i] == null) && t.rows.some((r) => typeof r[i] === 'number') ? 'REAL' : 'TEXT'));
  writeFileSync(path, '﻿' + [t.columns.join(','), ...t.rows.map((r) => r.map(cell).join(','))].join('\r\n') + '\r\n');
  return { module: t.module, table: t.name, file, document: t.document, grid: t.grid, description: t.description, columns: t.columns.map((c, i) => ({ name: c, type: types[i] })), rows: t.rows.length };
});
// plain-text knowledge file (same content as sales_order_rules, readable in any editor)
const txtGroups = [...new Set(SO_CONCEPTS.map((c) => c.group))];
const txt = ['WFX SALES ORDER (OC RE-WRITE) - KNOWLEDGE', 'Source: Sprint 1, 2 and 3 specifications, Sales Order Gaps, order types, Desync Price. Permission and settings handling not included.', '']
  .concat(txtGroups.flatMap((g) => ['=== ' + g.toUpperCase() + ' ===', ...SO_CONCEPTS.filter((c) => c.group === g).flatMap((c) => [c.name, '  ' + c.definition, '  Where: ' + c.where, ...(c.example ? ['  Example: ' + c.example] : []), '']) ])).join('\r\n');
writeFileSync(join(OUT, 'order', 'sales_order_knowledge.txt'), '\uFEFF' + txt);
const texts = [{ module: 'order', file: 'order/sales_order_knowledge.txt', description: 'Sales Order (OC re-write) knowledge as plain text.' }];
writeFileSync(join(OUT, 'manifest.json'), JSON.stringify({ generated: new Date().toISOString(), tables: manifest, texts }, null, 2));
console.log(`exported ${manifest.length} tables to ${OUT}`);
