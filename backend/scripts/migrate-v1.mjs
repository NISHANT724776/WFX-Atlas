// One-time migration of the v1 Knowledge Hub (TypeScript data in src/app/data) into the TXT knowledge library.
//   node backend/scripts/migrate-v1.mjs            writes files that do not exist yet (never overwrites edits)
//   node backend/scripts/migrate-v1.mjs --force    rewrites the generated files (asks nothing; use with care)
//   node backend/scripts/migrate-v1.mjs --check    prints the counts only
// Nothing in src/app/data is changed. Every entry records its source; nothing is invented.
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { settings } from '../src/config.ts';
import { makeEntry, serializeFile, RULE_KEYS } from '../src/knowledge/txt.ts';
import { idPart, sha256, today, writeJson, readJson, ensureDir } from '../src/util.ts';

const force = process.argv.includes('--force');
const checkOnly = process.argv.includes('--check');
const S = settings();
const K = S.knowledge;
const TODAY = today();

// ── load v1 data ──────────────────────────────────────────────────────
const cache = path.join(S.root, 'backend', '.cache');
ensureDir(cache);
const bundle = path.join(cache, 'v1-dump.mjs');
await build({ entryPoints: [path.join(S.root, 'backend', 'scripts', 'v1-dump.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'warning' });
const v1 = (await import(`${pathToFileURL(bundle).href}?t=${Date.now()}`)).dump();

// ── shared helpers ────────────────────────────────────────────────────
const V1 = 'Knowledge Hub v1';
const SRC = {
  so: `Sales Order re-write specifications: D:\\Sprints\\Sales Order Sprint (Sprint-01, Sprint-02, Sprint-3 V2), Sales Order Gaps.docx, Order type handling (Back, purchase, MTS Orders.docx), Purchase Order From Buyer\\Desync Price OC List.docx. Sprint-1 permission and settings sections excluded at the owner's request. Transcribed in ${V1} (src/app/data/salesorder.ts).`,
  concept: `Explained by the WFX functional owner (product owner) in chat, 2026-11-11 to 2026-11-12. Transcribed in ${V1} (src/app/data/concepts.ts).`,
  mrp: `Explained by the product owner and verified against the NIS-58 trial, 2026-11-12. ${V1} (src/app/data/concepts.ts).`,
  calc: `NIS-58 workbook (Downloads\\WFX_Data_Model_Flow_NIS-58_v4.xlsx) and WFX screen captures of Adi TShirt (NIS-59). ${V1} (src/app/data/calculations.ts).`,
  chain: `Product owner's explanation with screenshots, chat 2026-11-12 (example: Cons 2, Loss 5 %, Wastage 5 %, Shrinkage 5 % → 2.326869806). ${V1} (src/app/data/cons.ts).`,
  txn: `NIS-58 workbook and WFX screen captures. ${V1} (src/app/data/transactions.ts).`,
  glossary: `${V1} glossary (src/app/data/glossary.ts), written from the sources of each term's transaction.`,
  journey: `${V1} workflow (src/app/data/journey.ts), built from the NIS-58 workbook and the owner's explanations.`,
  docs: `${V1} data model (src/app/data/docs.ts).`,
  modules: `${V1} module organisation (src/app/data/modules.ts).`,
};
const ASSUMED = /\b(assum(ed|ption)|to be confirmed|to confirm|not confirmed|unconfirmed)\b/i;
const tail = (source, status, created, extra = {}) => ({ ...extra, SOURCE: source, VERSION: '1', STATUS: status, 'CREATED DATE': created, 'LAST UPDATED': TODAY });
const files = new Map(); // rel path → { header, entries }
const add = (rel, header, entry) => {
  if (!files.has(rel)) files.set(rel, { header, entries: [] });
  const f = files.get(rel);
  if (f.entries.some((e) => e.id === entry.id)) throw new Error(`Duplicate ID ${entry.id} in ${rel}`);
  f.entries.push(entry);
};
const unique = new Set();
const uid = (raw) => {
  const id = raw.slice(0, 76).replace(/-+$/, '');
  let out = id, n = 2;
  while (unique.has(out)) out = `${id}-${n++}`;
  unique.add(out);
  return out;
};

const moduleById = Object.fromEntries(v1.modules.map((m) => [m.id, m]));
const moduleOfTxn = (slug) => v1.modules.find((m) => m.txns.includes(slug));
const txnName = (slug) => v1.txnIndex.find((t) => t.slug === slug)?.name ?? slug;
const MODULE_FILE = { rules: 'setup', style: 'style_bom', booking: 'sourcing', sales: 'sales', planning: 'planning', production: 'production', inventory: 'inventory', tna: 'tna' };
const MANUAL_MODULE = { manual_style_bom: 'style', manual_sales_order: 'sales', manual_sourcing: 'booking', manual_inventory_qc_wms: 'inventory', manual_tna: 'tna' };
const HEADER = (title, extra = []) => [title, 'Format: see documentation/ARCHITECTURE.md §4. Generated from the v1 Knowledge Hub on ' + TODAY + '; edit freely, every change is versioned.', ...extra];

// ── modules ───────────────────────────────────────────────────────────
for (const m of v1.modules) {
  const rel = `modules/${MODULE_FILE[m.id] ?? m.id}.txt`;
  add(rel, HEADER(`Module: ${m.name}`), makeEntry('module', uid(`MOD-${idPart(m.id)}`), {
    'MODULE NAME': m.name, DESCRIPTION: m.blurb, SUBMODULES: '',
    TRANSACTIONS: m.txns.map((s) => `${txnName(s)} (${s})`).join('\n'),
    'DATA MODEL DOCUMENTS': m.docs.join(', '), 'WORKFLOW STEPS': m.steps.join(', '),
    ...tail(SRC.modules, 'Active', '2026-11-12'),
  }));
}

// ── procedures (user-manual guide sections) ───────────────────────────
for (const s of v1.manuals) {
  const modId = MANUAL_MODULE[s.table];
  const m = moduleById[modId];
  const rel = `modules/${MODULE_FILE[modId]}.txt`;
  const inferred = /roll functionality/i.test(s.topic);
  add(rel, HEADER(`Module: ${m.name}`), makeEntry('procedure', uid(`PROC-${idPart(MODULE_FILE[modId])}-${idPart(s.topic)}`), {
    TITLE: s.title, TOPIC: s.topic, MODULE: m.name, 'SOURCE DOCUMENT': s.document,
    CONTENT: s.content,
    STEPS: (s.steps ?? []).map((x, i) => `${i + 1}. ${x}`).join('\n'),
    'WHERE IN WFX': s.where ?? '', NOTES: s.notes ?? '',
    ...(inferred ? { INFERENCE: 'The "why" part is an inference written by the assistant from what each step does; the manuals give no written reason. Needs the owner\'s confirmation.' } : {}),
    ...tail(inferred
      ? `Assembled on 2026-11-13 from the WMS Workflow and Inventory/QC manuals (how) plus an inference (why). ${V1} (src/app/data/manuals.ts).`
      : `User manual "${s.document}" supplied by the owner (Downloads), transcribed in ${V1} (src/app/data/manuals.ts).`,
      inferred ? 'Under Review' : 'Active', inferred ? '2026-11-13' : '2026-11-12'),
  }));
}

// ── business rules ────────────────────────────────────────────────────
const TAIL_KEYS = ['SOURCE', 'VERSION', 'STATUS', 'CREATED DATE', 'LAST UPDATED'];
// the specification's rule keys first, then any extra keys, then source/version/status/dates
const ruleFields = (o) => {
  const head = RULE_KEYS.filter((k) => !TAIL_KEYS.includes(k));
  const extras = Object.keys(o).filter((k) => !RULE_KEYS.includes(k));
  return Object.fromEntries([...head, ...extras, ...TAIL_KEYS].map((k) => [k, o[k] ?? '']));
};
const CATEGORY = { Structure: 'Structure', Pricing: 'Pricing', Quantity: 'Quantity', Delivery: 'Delivery action', Approval: 'Approval', Controls: 'Control', 'Order types': 'Order type', 'Transfer price': 'Transfer price', TNA: 'TNA', EDI: 'Integration', Packing: 'Packing' };
const salesHeader = HEADER('Business rules: Sales Order (re-write)', ['Source: Sales Order Sprint 1–3 specifications and related notes. Permission and settings handling is not covered.']);
for (const c of v1.soConcepts) {
  const assumed = ASSUMED.test(`${c.definition} ${c.example ?? ''}`);
  add('business_rules/sales_rules.txt', salesHeader, makeEntry('rule', uid(`RULE-SO-${idPart(c.id.replace(/^so-/, ''))}`), ruleFields({
    'RULE NAME': c.name, MODULE: 'Sales Order', SUBMODULE: 'Sales Order (re-write)', TRANSACTION: 'Sales Order (OC)',
    'RULE CATEGORY': CATEGORY[c.group] ?? c.group, 'FORMULA / LOGIC': c.definition, EXAMPLE: c.example ?? '',
    'SCREEN / LOCATION': c.where, GROUP: c.group,
    ...(assumed ? { 'OPEN QUESTION': 'Marked as assumed in v1; needs the owner\'s confirmation.' } : {}),
    ...tail(SRC.so, assumed ? 'Under Review' : 'Active', '2026-11-12'),
  })));
}
for (const a of v1.soActions) {
  add('business_rules/sales_rules.txt', salesHeader, makeEntry('rule', uid(`RULE-SO-ACTION-${idPart(a.action)}`), ruleFields({
    'RULE NAME': `${a.action} (action)`, MODULE: 'Sales Order', SUBMODULE: 'Sales Order (re-write)', TRANSACTION: 'Sales Order (OC)',
    'RULE CATEGORY': 'Action', 'TRIGGER CONDITION': a.needs, 'FORMULA / LOGIC': a.rule, OUTPUT: a.result, 'SCREEN / LOCATION': a.where,
    ...tail(SRC.so, 'Active', '2026-11-12'),
  })));
}
const setupHeader = HEADER('Business rules: setup (dependency types, UOM, BOM concepts, article coding)');
for (const [list, cat] of [[v1.concepts.DEPENDENCY_TYPES, 'Definition'], [v1.concepts.UOM_TYPES, 'Definition'], [v1.concepts.BOM_CONCEPTS, 'Business Rule'], [v1.concepts.ARTICLE_CODING, 'Business Rule']]) {
  for (const c of list) {
    add('business_rules/general_rules.txt', setupHeader, makeEntry('rule', uid(`RULE-SETUP-${idPart(c.id)}`), ruleFields({
      'RULE NAME': c.group.includes('dependency') ? `${c.group} – ${c.name}` : c.name, MODULE: 'Setup rules', SUBMODULE: c.group,
      TRANSACTION: '', 'RULE CATEGORY': cat, 'FORMULA / LOGIC': c.definition, EXAMPLE: c.example ?? '', 'SCREEN / LOCATION': c.where,
      OPTIONS: c.options ?? '', ...tail(SRC.concept, 'Active', '2026-11-11'),
    })));
  }
}
for (const r of v1.articleCodeRules) {
  const parts = [...r.parts].sort((a, b) => a.sort - b.sort);
  add('business_rules/general_rules.txt', setupHeader, makeEntry('rule', uid(`RULE-ARTICLE-CODE-${idPart(r.rule)}`), ruleFields({
    'RULE NAME': `Article code rule ${r.rule}`, MODULE: 'Setup rules', SUBMODULE: 'Article coding', TRANSACTION: 'Admin › System Coding › Article Code',
    'RULE CATEGORY': 'Configuration', 'APPLICABLE CONDITIONS': `Material Type: ${r.materialType}; Product Group: ${r.productGroup}; Sub Category: ${r.subCategory}`,
    'FORMULA / LOGIC': `Article code = code sections joined in Sort order:\n${parts.map((p) => `${p.sort}: ${p.section}${p.value ? ` = "${p.value}"` : ''}`).join('\n')}`,
    ...tail(SRC.concept, 'Active', '2026-11-11'),
  })));
}
const planHeader = HEADER('Business rules: planning (MRP)');
for (const c of v1.concepts.MRP_CONCEPTS) {
  add('business_rules/planning_rules.txt', planHeader, makeEntry('rule', uid(`RULE-MRP-${idPart(c.id.replace(/^mrp-/, ''))}`), ruleFields({
    'RULE NAME': c.name, MODULE: 'Planning', SUBMODULE: 'MRP', TRANSACTION: 'MRP', 'RULE CATEGORY': 'Business Rule',
    'FORMULA / LOGIC': c.definition, EXAMPLE: c.example ?? '', 'SCREEN / LOCATION': c.where, ...tail(SRC.mrp, 'Active', '2026-11-12'),
  })));
}

// ── calculations (with a restricted expression where the formula is plain arithmetic) ─────────────
// Each expression is a literal transcription of the v1 formula text shown in FORMULA / LOGIC.
const EXPR = {
  'bom-cons-qty': { in: ['total_cons_qty | Total Cons Qty | quantity | required', 'cons_per_item | Cons per Item | quantity | required'], ex: ['cons_qty = total_cons_qty / cons_per_item'], out: 'cons_qty' },
  'bom-loss-factor': { in: ['loss_pct | Loss % | percent | default 0'], ex: ['loss_factor = 1 / (1 - loss_pct / 100)'], out: 'loss_factor' },
  'bom-cons-loss': { in: ['cons_qty | Cons Qty | quantity | required', 'loss_factor | Loss Factor | number | default 1'], ex: ['cons_incl_loss = cons_qty * loss_factor'], out: 'cons_incl_loss' },
  'bom-cons-wastage': { in: ['cons_incl_loss | Cons incl Loss | quantity | required', 'wastage_pct | Wastage % | percent | default 0'], ex: ['cons_incl_wastage = cons_incl_loss + cons_incl_loss * wastage_pct / 100'], out: 'cons_incl_wastage' },
  'bom-cons-shrinkage': { in: ['cons_incl_wastage | Cons incl Wastage | quantity | required', 'shrinkage_pct | Shrinkage % | percent | default 0'], ex: ['cons_incl_shrinkage = cons_incl_wastage / (1 - shrinkage_pct / 100)'], out: 'cons_incl_shrinkage' },
  'bom-final-cons': { in: ['cons_qty | Cons Qty | quantity | required', 'loss_pct | Loss % | percent | default 0', 'wastage_pct | Wastage % | percent | default 0', 'shrinkage_pct | Shrinkage % | percent | default 0'], ex: ['loss_factor = 1 / (1 - loss_pct / 100)', 'cons_incl_loss = cons_qty * loss_factor', 'cons_incl_wastage = cons_incl_loss + cons_incl_loss * wastage_pct / 100', 'final_consumption = cons_incl_wastage / (1 - shrinkage_pct / 100)'], out: 'final_consumption' },
  'bom-cons-uom-price': { in: ['purchase_price | Purchase Price | money | required', 'conversion_factor | Conversion Factor (Purchase UOM → Cons UOM) | number | default 1'], ex: ['cons_uom_price = purchase_price * conversion_factor'], out: 'cons_uom_price' },
  'bom-value': { in: ['final_consumption | Final Consumption | quantity | required', 'cons_uom_price | Cons UOM Price | money | required'], ex: ['value = final_consumption * cons_uom_price'], out: 'value' },
  'bom-value-cs': { in: ['value | Value | money | required', 'exchange_rate | Exchange rate (line → costing-sheet currency) | number | required'], ex: ['value_cs = value * exchange_rate'], out: 'value_cs' },
  'routing-process-rate': { in: ['cost_of | Cost Of | money | required', 'production_time | Production Time | number | required'], ex: ['process_rate = cost_of * production_time'], out: 'process_rate' },
  'cost-total': { in: ['material_cost | Material Cost | money | required', 'production_cost | Production Cost | money | default 0', 'recipe_cost | Recipe | money | default 0', 'indirect_cost | Indirect | money | default 0', 'cm_cost | CM | money | default 0'], ex: ['total_cost = material_cost + production_cost + recipe_cost + indirect_cost + cm_cost'], out: 'total_cost' },
  'cost-net-selling': { in: ['selling_price | Selling Price | money | required', 'discount_pct | Discount % | percent | default 0'], ex: ['net_selling_price = selling_price * (1 - discount_pct / 100)'], out: 'net_selling_price' },
  'cost-profit': { in: ['net_selling_price | Net Selling Price | money | required', 'total_cost | Total Cost | money | required'], ex: ['profit = net_selling_price - total_cost'], out: 'profit' },
  'cost-profit-pct': { in: ['profit | Profit | money | required', 'net_selling_price | Net Selling Price | money | required'], ex: ['profit_pct = profit / net_selling_price * 100'], out: 'profit_pct' },
  'cost-markup-pct': { in: ['selling_price | Selling Price | money | required', 'total_cost | Total Cost | money | required'], ex: ['markup = selling_price - total_cost', 'markup_pct = markup / total_cost * 100'], out: 'markup_pct' },
  'bbb-material-value': { in: ['units | Units | quantity | required', 'rate | Rate | money | required'], ex: ['value = units * rate'], out: 'value' },
  'bbb-balance': { in: ['units | Units | quantity | required', 'indented_qty | Indented Qty | quantity | default 0'], ex: ['balance_to_indent = units - indented_qty'], out: 'balance_to_indent' },
  'indent-balance': { in: ['booked_units | Booked Units | quantity | required', 'previous_indent_qty | Previous Indent Qty | quantity | default 0'], ex: ['balance_units = booked_units - previous_indent_qty'], out: 'balance_units' },
  'indent-open': { in: ['indent_qty | Indent Qty | quantity | required', 'ordered_qty | Ordered Qty | quantity | default 0', 'in_house_adj | In-house Adj. | quantity | default 0', 'on_order_adj | On Order Adj. | quantity | default 0'], ex: ['open_qty = indent_qty - ordered_qty - in_house_adj - on_order_adj'], out: 'open_qty' },
  'rmpo-value': { in: ['ordered_qty | Ordered Qty | quantity | required', 'price_per_unit | Price per Unit | money | required', 'surcharge_value | Surcharge Value | money | default 0'], ex: ['total_value = ordered_qty * price_per_unit', 'total_net_value = total_value + surcharge_value'], out: 'total_net_value' },
  'rmpo-open': { in: ['ordered_qty | Ordered Qty | quantity | required', 'additional_qty | Additional Qty | quantity | default 0', 'shipped_qty | Shipped (GRN accepted) Qty | quantity | default 0'], ex: ['open_qty = ordered_qty + additional_qty - shipped_qty'], out: 'open_qty' },
  'rmpo-storing-qty': { in: ['ordered_qty | Ordered Qty | quantity | required', 'po_to_storing_conversion | PO-to-Storing UOM Conversion | number | default 1'], ex: ['qty_storing_uom = ordered_qty * po_to_storing_conversion'], out: 'qty_storing_uom' },
  'grn-balance': { in: ['ordered_qty | Ordered Qty | quantity | required', 'previously_received_qty | Previously Received Qty | quantity | default 0', 'returned_qty | Returned Qty | quantity | default 0'], ex: ['balance_qty = ordered_qty - previously_received_qty + returned_qty'], out: 'balance_qty' },
  'grn-accepted': { in: ['received_qty | Received Qty | quantity | required', 'rejected_qty | Rejected Qty | quantity | default 0', 'rate | Rate | money | default 0'], ex: ['accepted_qty = received_qty - rejected_qty', 'value = accepted_qty * rate'], out: 'accepted_qty' },
  'grn-excess': { in: ['received_qty | Received Qty | quantity | required', 'balance_qty | Balance Qty | quantity | required'], ex: ['excess_short = received_qty - balance_qty'], out: 'excess_short' },
  'oc-value': { in: ['qty | Qty | quantity | required', 'selling_price | Selling Price | money | required', 'cm_price | CM Price | money | default 0'], ex: ['total_value = qty * (selling_price + cm_price)'], out: 'total_value' },
  'mrp-l1-req': { in: ['actual_requirement | Actual Requirement | quantity | required', 'mrp_pct | MRP % (multiplier, 1 = 100 %) | multiplier | default 1', 'loss_pct | Loss % | percent | default 0'], ex: ['req_qty = actual_requirement * mrp_pct * (1 + loss_pct / 100)'], out: 'req_qty' },
  'mrp-l2-req': { in: ['garment_req_qty | Garment Req Qty | quantity | required', 'final_consumption | BOM Final Consumption | quantity | required'], ex: ['actual_requirement = garment_req_qty * final_consumption'], out: 'actual_requirement' },
  'mrp-adjust': { in: ['parent_qty | Parent Qty | quantity | required', 'adjustment | Adjustment (negative reduces) | quantity | default 0', 'final_consumption | BOM Final Consumption | quantity | required'], ex: ['net_parent_qty = parent_qty + adjustment', 'child_indent_qty = net_parent_qty * final_consumption'], out: 'child_indent_qty' },
  'so-split-pct': { in: ['existing_qty | Existing Quantity | quantity | required', 'split_pct | Split Percentage | percent | required'], ex: ['split_qty = existing_qty * split_pct / 100'], out: 'split_qty' },
  'so-split-qty': { in: ['entered_qty | Entered Quantity | quantity | required', 'line_qty | Line Qty | quantity | required', 'total_selected_qty | Total of the selected lines | quantity | required'], ex: ['line_split_qty = entered_qty * line_qty / total_selected_qty'], out: 'line_split_qty' },
  'so-upcharge': { in: ['base_selling_price | Base Selling Price | money | required', 'upcharge | Upcharge (+) / Discount (−) | money | default 0'], ex: ['final_selling_price = base_selling_price + upcharge'], out: 'final_selling_price' },
  'so-subtotal': { in: ['delivery_value | Delivery Value | money | required', 'exchange_rate | Exchange Rate to the Sales Order Currency | number | default 1'], ex: ['sub_total = delivery_value * exchange_rate'], out: 'sub_total' },
  'so-approval-limit': { in: ['approval_limit | Approval value of the approver | number | required', 'order_value | Order Value | money | required'], ex: ['goes_for_approval = IF(approval_limit == 0, 0, IF(approval_limit == -1, 1, IF(order_value > approval_limit, 1, 0)))'], out: 'goes_for_approval' },
  'so-purchase-demand': { in: ['level1_style_qty | Level 1 Style Qty | quantity | required', 'purchase_demand | Purchase Demand | quantity | default 0', 'final_consumption | BOM Final Consumption | quantity | required'], ex: ['material_indent_qty = (level1_style_qty - purchase_demand) * final_consumption'], out: 'material_indent_qty' },
  'pi-purchase-uom': { in: ['indent_qty | Indent Qty | quantity | required', 'conversion_factor | Conversion Factor | number | default 1'], ex: ['purchase_uom_indent_qty = indent_qty * conversion_factor'], out: 'purchase_uom_indent_qty' },
  'pi-inhouse-adj': { in: ['indent_qty | Indent Qty | quantity | required', 'bbb_stock_available | BBB stock available for the same Stock Key | quantity | default 0'], ex: ['in_house_adj = MIN(indent_qty, bbb_stock_available)'], out: 'in_house_adj' },
  'pi-ordered': { in: ['indent_qty | Indent Qty | quantity | required', 'in_house_adj | In-house Adj. | quantity | default 0', 'on_order_adj | On Order Adj. | quantity | default 0'], ex: ['ordered_qty = indent_qty - in_house_adj - on_order_adj'], out: 'ordered_qty' },
  'po-allocated': { in: ['colour_qty | Colour Qty | quantity | required', 'qty_pct | Qty % | percent | required'], ex: ['allocated = colour_qty * qty_pct / 100'], out: 'allocated' },
  'fpo-qty': { in: ['allocated_qty | Allocated Qty | quantity | required', 'reduced_at_fpo | Reduced at FPO | quantity | default 0'], ex: ['fpo_qty = allocated_qty - reduced_at_fpo'], out: 'fpo_qty' },
  'fpo-fabric': { in: ['fpo_qty | FPO Qty | quantity | required', 'final_consumption | BOM Final Consumption | quantity | required'], ex: ['fabric_qty_reqd = fpo_qty * final_consumption'], out: 'fabric_qty_reqd' },
  'fpo-alloc-open': { in: ['qty_reqd | Qty Reqd | quantity | required', 'qty_instructed | Qty Instructed | quantity | default 0', 'qty_unreserved | Qty Unreserved | quantity | default 0'], ex: ['open_qty = qty_reqd - (qty_instructed - qty_unreserved)'], out: 'open_qty' },
  'fppo-open': { in: ['required_qty | Required Qty | quantity | required', 'received_qty | Received Qty | quantity | default 0', 'reallocation_qty | Reallocation Qty | quantity | default 0'], ex: ['open_qty = required_qty - received_qty - reallocation_qty'], out: 'open_qty' },
};
const CONFLICTS = {
  'routing-process-rate': 'The owner described Process Rate with "+" (Cost Of + Production Time); the captured WFX screen values match "×". Kept Under Review until the owner confirms.',
};
const calcFile = (slug) => {
  const m = moduleOfTxn(slug);
  return `calculations/${m ? MODULE_FILE[m.id] : 'general'}_calculations.txt`;
};
for (const c of v1.calculations) {
  const e = EXPR[c.id];
  const m = moduleOfTxn(c.txn);
  const conflict = CONFLICTS[c.id];
  const status = c.status === 'assumed' || conflict ? 'Under Review' : 'Active';
  add(calcFile(c.txn), HEADER(`Calculation rules: ${m?.name ?? 'General'}`), makeEntry('rule', uid(`CALC-${idPart(c.id)}`), ruleFields({
    'RULE NAME': c.name, MODULE: m?.name ?? '', SUBMODULE: '', TRANSACTION: txnName(c.txn), 'RULE CATEGORY': 'Calculation',
    'BUSINESS PURPOSE': c.explanation, 'INPUT FIELDS': e ? e.in.map((x) => x.split('|')[1].trim()).join('\n') : '',
    'FORMULA / LOGIC': c.formula, OUTPUT: c.formula.includes('=') ? c.formula.split('=')[0].trim() : c.name, EXAMPLE: c.example,
    'CALC INPUTS': e ? e.in.join('\n') : '', EXPRESSION: e ? e.ex.join('\n') : '', 'CALC OUTPUT': e ? e.out : '',
    ...(c.question ? { 'OPEN QUESTION': c.question } : {}), ...(conflict ? { CONFLICT: conflict } : {}),
    'V1 STATUS': c.status === 'verified' ? 'verified (matches a WFX screen value)' : 'assumed (inferred, waiting for confirmation)',
    ...tail(SRC.calc, status, '2026-11-11'),
  })));
}
add('calculations/style_bom_calculations.txt', HEADER('Calculation rules: Style & BOM'), makeEntry('rule', uid('CALC-CONSUMPTION-CHAIN'), ruleFields({
  'RULE NAME': 'Total consumption chain (loss, wastage, shrinkage)', MODULE: 'Style & BOM', SUBMODULE: 'BOM', TRANSACTION: txnName('bom-materials'),
  'RULE CATEGORY': 'Calculation',
  'BUSINESS PURPOSE': 'The final ("total") consumption of a BOM line, after loss, wastage and shrinkage. The owner calls this figure "total cons"; "Total Cons Qty" is the entered column.',
  'INPUT FIELDS': 'Cons Qty\nLoss %\nWastage %\nShrinkage %',
  'FORMULA / LOGIC': 'Loss Factor = 1 ÷ (1 − Loss %)\nCons incl Loss = Cons × Loss Factor\nCons incl Wastage = Cons incl Loss + Cons incl Loss × Wastage %\nTotal (Final) Consumption = Cons incl Wastage ÷ (1 − Shrinkage %)\nEach step is optional: a step whose percentage is not given is left out.',
  'UNIT OF MEASUREMENT': 'Consumption UOM of the BOM line', OUTPUT: 'Total (Final) Consumption',
  EXAMPLE: 'Cons 2, Loss 5 %, Wastage 5 %, Shrinkage 5 % → factor 1.0526316 → 2.1052632 → 2.2105263 → 2.3268698',
  'EXPECTED RESULT': '2.326869806 (owner\'s figure)',
  'EXCEPTION CONDITIONS': 'Not documented: what WFX does when Loss % or Shrinkage % is 100 (the formula divides by zero). The v1 site clamps percentages below 100; that clamp is not a documented WFX rule.',
  'CALC INPUTS': 'cons_qty | Cons Qty | quantity | required\nloss_pct | Loss % | percent | default 0\nwastage_pct | Wastage % | percent | default 0\nshrinkage_pct | Shrinkage % | percent | default 0',
  EXPRESSION: 'loss_factor = 1 / (1 - loss_pct / 100)\ncons_incl_loss = cons_qty * loss_factor\ncons_incl_wastage = cons_incl_loss + cons_incl_loss * wastage_pct / 100\ntotal_consumption = cons_incl_wastage / (1 - shrinkage_pct / 100)',
  'CALC OUTPUT': 'total_consumption',
  'TEST CASES': 'cons_qty=2, loss_pct=5, wastage_pct=5, shrinkage_pct=5 → total_consumption=2.326869806\ncons_qty=2, wastage_pct=5 → total_consumption=2.1\ncons_qty=2, loss_pct=5 → total_consumption=2.105263158\ncons_qty=2, shrinkage_pct=5 → total_consumption=2.105263158',
  'RELATED RULES': 'CALC-BOM-LOSS-FACTOR, CALC-BOM-CONS-LOSS, CALC-BOM-CONS-WASTAGE, CALC-BOM-CONS-SHRINKAGE, CALC-BOM-FINAL-CONS',
  ...tail(SRC.chain, 'Active', '2026-11-12'),
})));

// ── glossary ──────────────────────────────────────────────────────────
const GARMENT = /colou?r|size|consumption|wastage|shrinkage|shade|lot\b|roll|fabric|trim|apparel|style|article|garment|techpack|cut|ratio|pack/i;
for (const t of v1.glossary) {
  const rel = GARMENT.test(t.term) ? 'glossary/garment_manufacturing_terms.txt' : 'glossary/erp_terms.txt';
  const head = rel.includes('garment') ? HEADER('Glossary: garment manufacturing terms as used in WFX') : HEADER('Glossary: WFX ERP terms');
  add(rel, head, makeEntry('term', uid(`TERM-${idPart(t.slug)}`), {
    TERM: t.term, DEFINITION: t.definition, TRANSACTION: t.txn ? `${txnName(t.txn)} (${t.txn})` : '', MODULE: t.txn ? moduleOfTxn(t.txn)?.name ?? '' : '',
    ...tail(SRC.glossary, ASSUMED.test(t.definition) ? 'Under Review' : 'Active', '2026-11-11'),
  }));
}
for (const s of v1.articleCodeSections) {
  add('glossary/erp_terms.txt', HEADER('Glossary: WFX ERP terms'), makeEntry('term', uid(`TERM-CODE-SECTION-${idPart(s.name)}`), {
    TERM: `${s.name} (article code section)`, DEFINITION: s.meaning, TRANSACTION: 'Admin › System Coding › Article Code', MODULE: 'Setup rules', CATEGORY: 'Article code section',
    ...tail(SRC.concept, 'Active', '2026-11-11'),
  }));
}

// ── transactions, fields, dependencies, cases ─────────────────────────
for (const t of v1.transactions) {
  const tid = `TXN-${idPart(t.slug)}`;
  const m = moduleOfTxn(t.slug);
  const sum = v1.theorySummary[t.slug];
  add('transactions/transaction_definitions.txt', HEADER('Transaction definitions'), makeEntry('transaction', uid(tid), {
    'TRANSACTION NAME': t.name, SLUG: t.slug, MODULE: m?.name ?? t.module, 'V1 MODULE LABEL': t.module, STEP: String(t.step),
    'NAVIGATION PATH': t.screen, PURPOSE: t.description, 'ONE LINE': sum?.oneLine ?? '',
    'BUSINESS CONTEXT': (t.theory ?? []).join('\n'),
    KEYS: t.keys.map((k) => `${k.name}: ${k.format} (example ${k.example})`).join('\n'),
    UPSTREAM: t.upstream.map((l) => `${txnName(l.slug)} (${l.slug}): ${l.what}`).join('\n'),
    DOWNSTREAM: t.downstream.map((l) => `${txnName(l.slug)} (${l.slug}): ${l.what}`).join('\n'),
    CALCULATIONS: t.calcs.map((c) => `CALC-${idPart(c)}`).join(', '),
    VERIFICATION: t.checks.map((c) => `${c.label}: workbook ${c.workbook} / WFX ${c.wfx} → ${c.match ? 'match' : 'mismatch'}${c.note ? ` (${c.note})` : ''}`).join('\n'),
    FACTS: (sum?.facts ?? []).map((f) => `${f.label}: ${f.value}`).join('\n'),
    'CAPTURED TABLES': t.tables.map((x) => `${x.title} (${x.rows} rows; ${x.columns.join(', ')})`).join('\n'),
    ...tail(SRC.txn, 'Active', '2026-11-11'),
  }));
  for (const g of t.fieldGroups) {
    for (const f of g.fields) {
      add('transactions/field_definitions.txt', HEADER('Field definitions (screen fields per transaction)'), makeEntry('field', uid(`FLD-${idPart(t.slug)}-${idPart(f.name)}`), {
        'FIELD NAME': f.name, TRANSACTION: `${t.name} (${t.slug})`, 'FIELD GROUP': g.title,
        'FIELD TYPE': { key: 'Key (identifies the record)', entered: 'Entered by the user', linked: 'Linked (copied from another transaction)', calculated: 'Calculated' }[f.kind] ?? f.kind,
        DEFINITION: f.definition,
        'SOURCE TRANSACTION': f.from ? `${txnName(f.from)} (${f.from})` : '', 'SOURCE FIELD': f.fromField ?? '',
        CALCULATION: f.calc ? `CALC-${idPart(f.calc)}` : '',
        ...tail(SRC.txn, 'Active', '2026-11-11'),
      }));
    }
  }
  for (const l of t.downstream) {
    add('transactions/transaction_dependencies.txt', HEADER('Transaction dependencies (upstream → downstream)'), makeEntry('dependency', uid(`DEP-${idPart(t.slug)}-${idPart(l.slug)}`), {
      RELATIONSHIP: `${t.name} → ${txnName(l.slug)}`, 'FROM TRANSACTION': `${t.name} (${t.slug})`, 'TO TRANSACTION': `${txnName(l.slug)} (${l.slug})`,
      DESCRIPTION: l.what, BASIS: 'Downstream link recorded in the v1 transaction page',
      ...tail(SRC.txn, 'Active', '2026-11-11'),
    }));
  }
  t.cases.forEach((c, i) => {
    add('transactions/transaction_cases.txt', HEADER('Cases recorded while capturing transactions: rules, observations and mismatches'), makeEntry('case', uid(`CASE-${idPart(t.slug)}-${i + 1}`), {
      TITLE: c.title, KIND: c.kind, TRANSACTION: `${t.name} (${t.slug})`, MODULE: m?.name ?? t.module, DESCRIPTION: c.body,
      ...tail(SRC.txn, 'Active', '2026-11-11'),
    }));
  });
}
// upstream links that are not mirrored as downstream links elsewhere
for (const t of v1.transactions) {
  for (const l of t.upstream) {
    const id = `DEP-${idPart(l.slug)}-${idPart(t.slug)}`;
    if (unique.has(id) || !v1.txnIndex.some((x) => x.slug === l.slug)) continue;
    add('transactions/transaction_dependencies.txt', HEADER('Transaction dependencies (upstream → downstream)'), makeEntry('dependency', uid(id), {
      RELATIONSHIP: `${txnName(l.slug)} → ${t.name}`, 'FROM TRANSACTION': `${txnName(l.slug)} (${l.slug})`, 'TO TRANSACTION': `${t.name} (${t.slug})`,
      DESCRIPTION: l.what, BASIS: 'Upstream link recorded in the v1 transaction page',
      ...tail(SRC.txn, 'Active', '2026-11-11'),
    }));
  }
}
add('transactions/transaction_cases.txt', HEADER('Cases recorded while capturing transactions: rules, observations and mismatches'), makeEntry('case', uid('CASE-INDENT-COMPARISON'), {
  TITLE: 'BBB Adhoc Indent vs Manufacture Indent (L1) vs Production Indent (L2)', KIND: 'comparison', TRANSACTION: 'Adhoc Indent; MRP; Production Indents', MODULE: 'Booking & sourcing; Planning',
  DESCRIPTION: v1.indentComparison.rows.map((r) => `${r[0]}: ${v1.indentComparison.columns.slice(1).map((c, i) => `${c} = ${r[i + 1]}`).join('; ')}`).join('\n'),
  NOTES: 'The owner insists these are different flows and must never be merged.',
  ...tail(`${V1} (src/app/data/theory-extras.ts), from the NIS-58 trial and the owner's explanation.`, 'Active', '2026-11-11'),
}));

// ── workflows ─────────────────────────────────────────────────────────
const stepLine = (s) => `${s.id} | ${s.phase} | ${s.actor} | ${s.title} | transaction: ${s.theory || '-'} | screen: ${s.doc || '-'}`;
const stepById = Object.fromEntries(v1.steps.map((s) => [s.id, s]));
const wfHeader = HEADER('Workflows', ['STEPS lines: step id | phase | actor (user/system) | title | transaction | screen. PREREQUISITES: step ← required steps.']);
add('workflows/workflows.txt', wfHeader, makeEntry('workflow', uid('WF-E2E-MATERIAL-FLOW'), {
  'WORKFLOW NAME': 'End-to-end flow: masters to process orders (Flannel Shirt Adi (NIS-58), Adi TShirt (NIS-59))',
  DESCRIPTION: 'Every step the v1 hub documents, in order, across style setup, buyer block booking, procurement, sales order, MRP, adjustment and production.',
  PHASES: v1.phases.map((p) => `${p.letter} ${p.name} (${p.id}) – example values from ${p.source}`).join('\n'),
  STEPS: v1.steps.map(stepLine).join('\n'),
  PREREQUISITES: Object.entries(v1.requires).map(([k, v]) => `${k} ← ${v.join(', ')}`).join('\n'),
  'STEP GROUPS': v1.stepGroups.map((g) => `${g.phase} ${g.title}: ${g.steps.join(', ')}`).join('\n'),
  'STEP DETAILS': v1.steps.map((s) => `${s.id}: ${s.short}${s.keyPoint ? ` Key point: ${s.keyPoint}` : ''}${s.needs ? ` (only after the booking indent reaches ${s.needs.toUpperCase()})` : ''}`).join('\n'),
  'DIAGRAM FILES': 'workflows/end_to_end_flow.mmd (Mermaid), workflows/end_to_end_flow.json (nodes and edges)',
  ...tail(SRC.journey, 'Active', '2026-11-11'),
}));
for (const sc of v1.scenarios) {
  add('workflows/workflows.txt', wfHeader, makeEntry('workflow', uid(`WF-SCENARIO-${idPart(sc.id)}`), {
    'WORKFLOW NAME': `Scenario: ${sc.name}`, DESCRIPTION: sc.note, STEPS: sc.steps.map((id) => stepById[id] ? stepLine(stepById[id]) : id).join('\n'),
    'BOOKING STATUS': sc.status ?? '', 'PARENT WORKFLOW': 'WF-E2E-MATERIAL-FLOW',
    ...tail(SRC.journey, 'Active', '2026-11-12'),
  }));
}
for (const f of v1.flows) {
  add('workflows/workflows.txt', wfHeader, makeEntry('workflow', uid(`WF-READY-${idPart(f.slug)}`), {
    'WORKFLOW NAME': `Ready-made: ${f.name}`, DESCRIPTION: `${f.tagline}. ${f.description}`, STEPS: f.steps.map((id) => stepById[id] ? stepLine(stepById[id]) : id).join('\n'),
    'PARENT WORKFLOW': 'WF-E2E-MATERIAL-FLOW', ...tail(`${V1} ready-made workflow (src/app/data/catalog.ts FLOW_INDEX).`, 'Active', '2026-11-11'),
  }));
}
add('workflows/workflows.txt', wfHeader, makeEntry('workflow', uid('WF-TRANSACTION-ORDER'), {
  'WORKFLOW NAME': 'Transaction order (the 15 documented transactions)', DESCRIPTION: 'The order in which the v1 hub documents the transactions.',
  STEPS: [...v1.txnIndex].sort((a, b) => a.step - b.step).map((t) => `${t.step}. ${t.name} (${t.slug}) – ${t.module}`).join('\n'),
  ...tail(`${V1} transaction index (src/app/data/catalog.ts).`, 'Active', '2026-11-11'),
}));

// Mermaid + JSON of the documented prerequisite graph (only documented edges)
const RESERVED = /^(end|style|class|classdef|click|graph|subgraph|direction|linkstyle|flowchart|default|call|href)$/i;
const mid = (id) => { const x = id.replace(/-/g, '_'); return RESERVED.test(x) ? `n_${x}` : x; };
const mm = ['flowchart TD'];
for (const p of v1.phases) {
  mm.push(`  subgraph ${p.id}["${p.letter} · ${p.name}"]`);
  for (const s of v1.steps.filter((x) => x.phase === p.id)) mm.push(`    ${mid(s.id)}["${s.title.replace(/"/g, "'")}"]`);
  mm.push('  end');
}
const edges = [];
for (const [to, froms] of Object.entries(v1.requires)) for (const from of froms) edges.push({ from, to, label: 'requires', basis: 'journey.ts REQUIRES' });
for (const e of edges) mm.push(`  ${mid(e.from)} --> ${mid(e.to)}`);
const flowJson = {
  id: 'WF-E2E-MATERIAL-FLOW', direction: 'TD', source: SRC.journey,
  nodes: v1.steps.map((s) => ({ id: s.id, label: s.title, type: 'activity', phase: s.phase, actor: s.actor, transaction: s.theory, screen: s.doc, status: 'documented' })),
  edges,
};

// ── data models (captured screen-level fields, not the WFX database schema) ─────────────
const chapterOf = Object.fromEntries(v1.chapters.map((c) => [c.id, c]));
for (const d of v1.docs) {
  const ch = chapterOf[d.chapter];
  const colLine = (c) => `${c.label} | ${c.type}${c.formula ? ` | formula: ${c.formula}` : ''}${c.calc ? ` | rule: CALC-${idPart(c.calc)}` : ''}${c.from ? ` | from: ${c.from.doc}.${c.from.col}` : ''}${c.note ? ` | note: ${c.note}` : ''}`;
  add(`data_models/${d.chapter}_documents.txt`, HEADER(`Data models: ${ch?.name ?? d.chapter}`, ['These are screen-level fields captured from WFX screens or specifications, not the WFX database schema.', 'Field lines: label | type (key, entered, calc, link, copied) | formula | rule | source column | note']), makeEntry('model', uid(`DM-${idPart(d.id)}`), {
    'MODEL NAME': d.name, 'MODEL LEVEL': 'Captured screen fields (confirmed from WFX screens/specifications; not database schema)',
    CHAPTER: ch ? `${ch.name} – ${ch.note}` : d.chapter, SCREEN: d.screen, SUMMARY: d.summary,
    'HEADER FIELDS': d.header.map((h) => `${h.label} | ${h.type}${h.from ? ` | from: ${h.from.doc}.${h.from.col}` : ''}`).join('\n'),
    GRIDS: d.grids.map((g) => `[${g.title}] (${g.rows} captured rows)\n${g.cols.map(colLine).join('\n')}`).join('\n'),
    SCREENSHOTS: d.shots.join('\n'), THEORY: d.theory,
    ...tail(SRC.docs + (ch ? ` ${ch.note}.` : ''), 'Active', d.chapter === 'sales' || d.chapter === 'admin' ? '2026-11-12' : '2026-11-11'),
  }));
}

// ── write ─────────────────────────────────────────────────────────────
const counts = {};
for (const { entries } of files.values()) for (const e of entries) counts[e.type] = (counts[e.type] ?? 0) + 1;
console.log(JSON.stringify({ files: files.size, counts }, null, 0));
if (checkOnly) process.exit(0);
const diagramsOnly = process.argv.includes('--diagrams-only');

let written = 0, skipped = 0;
for (const [rel, f] of diagramsOnly ? [] : files) {
  const full = path.join(K, rel);
  if (fs.existsSync(full) && !force) { skipped++; continue; }
  ensureDir(path.dirname(full));
  fs.writeFileSync(full, serializeFile(f.header, f.entries), 'utf8');
  written++;
}
const wfDir = path.join(K, 'workflows');
ensureDir(wfDir);
for (const [name, data] of [['end_to_end_flow.mmd', `${mm.join('\n')}\n`], ['end_to_end_flow.json', `${JSON.stringify(flowJson, null, 2)}\n`]]) {
  const full = path.join(wfDir, name);
  if (!fs.existsSync(full) || force || diagramsOnly) fs.writeFileSync(full, data, 'utf8');
}

// source registry: the v1 data files are the direct sources of the migrated entries
const regFile = path.join(K, 'metadata', 'source_registry.json');
const reg = readJson(regFile, { sources: [], documents: [] });
reg.sources = reg.sources ?? [];
const v1Files = ['modules.ts', 'manuals.ts', 'salesorder.ts', 'concepts.ts', 'calculations.ts', 'cons.ts', 'glossary.ts', 'transactions.ts', 'docs.ts', 'journey.ts', 'theory-extras.ts', 'catalog.ts', 'records.ts'];
for (const f of v1Files) {
  const p = path.join(S.root, 'src', 'app', 'data', f);
  const buf = fs.readFileSync(p);
  const id = `SRC-V1-${idPart(f.replace('.ts', ''))}`;
  const rec = { id, kind: 'repository-file', title: `${V1}: src/app/data/${f}`, path: `src/app/data/${f}`, sha256: sha256(buf), size: buf.length, registered_at: new Date().toISOString(), knowledge_status: 'source-documented', note: 'Hand-transcribed v1 knowledge; migrated into the TXT library on ' + TODAY };
  const i = reg.sources.findIndex((s) => s.id === id);
  if (i >= 0) reg.sources[i] = { ...reg.sources[i], sha256: rec.sha256, size: rec.size };
  else reg.sources.push(rec);
}
reg.documents = reg.documents ?? [];
reg.updated = new Date().toISOString();
writeJson(regFile, reg);
const chFile = path.join(K, 'metadata', 'change_history.json');
const ch = readJson(chFile, []);
if (written) ch.push({ at: new Date().toISOString(), entry_id: '*', action: 'migrated-v1', changed_by: 'migration script', reason: `Migrated ${Object.values(counts).reduce((a, b) => a + b, 0)} entries from the v1 Knowledge Hub into ${written} TXT files${force ? ' (forced rewrite)' : ''}.`, source: 'src/app/data/*.ts' });
writeJson(chFile, ch);
console.log(JSON.stringify({ written, skipped, knowledge: K }));
