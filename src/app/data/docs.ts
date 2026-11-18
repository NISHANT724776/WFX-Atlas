// The WFX data model as real documents: each screen's header and grids with the actual rows,
// and for every column how its value is produced and where it comes from.
import { COLORS, SIZES } from './catalog';
import { consChain } from './cons';
import { SO_ACTIONS, SO_APPROVAL_SCENARIOS, SO_CONCEPTS, SO_DESYNC_STEPS, SO_EX_FACTORY, SO_PACKING, SO_PACKING_EXAMPLE, SO_PURCHASE_DEMAND, SO_SPLIT_SCENARIOS, SO_SUBTOTAL, SO_UPCHARGE_SCENARIOS } from './salesorder';
import { MRP_ADJUST_SCENARIOS, ARTICLE_CODE_RULES, ARTICLE_CODE_SECTIONS, BOM_CONCEPTS, DEPENDENCY_TYPES, UOM_TYPES } from './concepts';
import {
  ADHOC_INDENT, BBB_MATERIAL, BOM_59, COSTING_59, FPO_ALLOC, FPO_QTY, GRN, MRP_L1, MRP_L2, OC_BREAKUP,
  PROD_INDENT_L2, RM_59, RMPO_1229, RMPO_1230, ROUTING_59, STYLE_59,
} from './records';

/** key = identifies the row · entered = typed/selected · calc = calculated by WFX
 *  link = points to a row of another document · copied = value pulled from another document. */
export type ColType = 'key' | 'entered' | 'calc' | 'link' | 'copied';
export type Cell = string | number;
export type Row = Record<string, Cell>;

export interface Source { doc: string; col: string; }

export interface Col {
  key: string;
  label: string;
  type: ColType;
  num?: boolean;
  /** Columns of the same grid this one is calculated from. */
  uses?: string[];
  /** Formula id in calculations.ts. */
  calc?: string;
  /** Formula written out for this column. */
  formula?: string;
  /** Document/column the value comes from (link: the target row has the same value in that column). */
  from?: Source;
  note?: string;
  /** Cell opens the colour or size dependency of the row (BOM lines). */
  dep?: 'color' | 'size';
}

export interface Grid { id: string; title: string; cols: Col[]; rows: Row[]; group?: string; }
export interface HeaderField { label: string; value: string; type: ColType; from?: Source; }
export interface Shot { src: string; alt: string; }
export interface Tab { label: string; doc: string; }

export interface Doc {
  id: string;
  chapter: string;
  name: string;
  screen: string;
  summary: string;
  tabs?: Tab[];
  subtabs?: Tab[];
  header: HeaderField[];
  grids: Grid[];
  shots?: Shot[];
  theory?: string;
}

export const CHAPTERS = [
  { id: 'setup', name: 'Style setup', note: 'Adi TShirt (NIS-59) · captured from live WFX screens' },
  { id: 'order', name: 'Booking, order & production', note: 'Flannel Shirt Adi (NIS-58) · from the Excel trial' },
  { id: 'admin', name: 'Admin & setup rules', note: 'Rules explained by the WFX functional owner' },
  { id: 'sales', name: 'Sales Order (re-write)', note: 'From the Sprint 1-3 specifications · permissions and settings not included' },
];

const colour = (c: string) => { const x = COLORS.find((k) => k.code === c); return x ? `${x.name} (${c})` : c; };
const size = (s: string) => SIZES.find((k) => k.code === s)?.display ?? s;
const r2 = (n: number) => Math.round(n * 100) / 100;

const BOM_TABS: Tab[] = [{ label: 'Materials', doc: 'bom-materials' }, { label: 'Routing', doc: 'routing-processes' }, { label: 'Cost', doc: 'bom-cost' }];
const ROUTING_TABS: Tab[] = [{ label: 'Processes', doc: 'routing-processes' }, { label: 'Operations', doc: 'routing-operations' }, { label: 'Material Linkage', doc: 'material-linkage' }];
const BOM_HEADER: HeaderField[] = [
  { label: 'Article', value: 'Adi TShirt (NIS-59)', type: 'copied', from: { doc: 'apparel', col: 'value' } },
  { label: 'BOM', value: 'Production BOM #1 DP', type: 'entered' },
  { label: 'Version', value: 'V1', type: 'key' },
  { label: 'Status', value: 'Approved', type: 'entered' },
  { label: 'Currency / Date', value: 'INR · 11-11-2026', type: 'entered' },
  { label: 'Order Qty Expected / Actual', value: '34,000 / 0', type: 'entered' },
];
const shot = (name: string, alt: string): Shot => ({ src: `/screens/${name}.webp`, alt });


const soRules = (id: string, title: string, groups: string[]): Grid => ({
  id, title, cols: [
    { key: 'name', label: 'Topic', type: 'key' }, { key: 'group', label: 'Area', type: 'entered' },
    { key: 'meaning', label: 'What it means', type: 'entered' }, { key: 'where', label: 'Where', type: 'entered' }, { key: 'example', label: 'Example', type: 'entered' },
  ], rows: SO_CONCEPTS.filter((c) => groups.includes(c.group)).map((c) => ({ name: c.name, group: c.group, meaning: c.definition, where: c.where, example: c.example ?? '' })),
});

export const DOCS: Doc[] = [
  // ═════════ Chapter 1 · Style setup (NIS-59, live WFX) ═════════
  {
    id: 'rm-techpack', chapter: 'setup', name: 'Raw Material Techpacks', screen: 'Catalogs › Fabric / Trims › Techpack', theory: 'rm-techpack',
    summary: 'Every material the T-shirt needs is created once as its own techpack: one fabric and three trims. The BOM lines point to these article codes.',
    header: [{ label: 'Libraries', value: 'Cotton Fabrics · Nish_trims · N_Trims', type: 'entered' }, { label: 'Colour card / Size range', value: 'Nis_colors · ERPSIZE', type: 'copied' }],
    grids: [{ id: 'rm', title: 'Materials', cols: [
      { key: 'code', label: 'Article Code', type: 'key' },
      { key: 'name', label: 'Article Name', type: 'entered' },
      { key: 'type', label: 'Techpack Type', type: 'entered' },
      { key: 'materialType', label: 'Material Type', type: 'entered' },
      { key: 'consUom', label: 'Consumption UOM', type: 'entered', note: 'The unit the BOM consumption is expressed in.' },
      { key: 'pricePer', label: 'Price Per', type: 'entered', note: 'Fabric is priced per colour/size, trims per article.' },
      { key: 'bypass', label: 'Bypass Material Check on Production GRN', type: 'entered' },
    ], rows: RM_59.map((m) => ({ code: m.code, name: m.name, type: m.type, materialType: m.materialType, consUom: m.consUom, pricePer: m.pricePer, bypass: m.bypass })) }],
    shots: [shot('rm-fabric-n8', 'WFX Textiles/Fabric techpack of N-8 Finished_FABRIC'), shot('rm-thread-t1', 'WFX Trims techpack of T-1 Spun Polyester Sewing Thread'),
      shot('rm-cufflinks-ns1-1', 'WFX Trims techpack of NS1-1 Cufflings_flanel'), shot('rm-polybag-pp1', 'WFX Trims techpack of PP-1 Garment Polybag')],
  },
  {
    id: 'apparel', chapter: 'setup', name: 'Apparel Techpack', screen: 'Catalogs › Apparel › Detail', theory: 'apparel-style',
    summary: 'The garment itself. It fixes buyer, colour card, size range and purchase UOM – everything below inherits these.',
    header: [{ label: 'Article', value: 'Adi TShirt (NIS-59)', type: 'key' }, { label: 'Buyer', value: 'GAP Kids · Kids-Tops-Knits', type: 'entered' }],
    grids: [{ id: 'detail', title: 'Detail', cols: [
      { key: 'field', label: 'Field', type: 'key' }, { key: 'value', label: 'Value', type: 'entered' }, { key: 'how', label: 'How it is set', type: 'entered' },
    ], rows: [
      { field: 'Article Code', value: STYLE_59.code, how: 'System coding' },
      { field: 'Article Name / Description', value: `${STYLE_59.name} · ${STYLE_59.description}`, how: 'Typed' },
      { field: 'Buyer / Department', value: `${STYLE_59.buyer} · ${STYLE_59.dept}`, how: 'Selected' },
      { field: 'Division', value: STYLE_59.division, how: 'Selected' },
      { field: 'Product Group / Sub-Category', value: `${STYLE_59.productGroup} · ${STYLE_59.subCategory}`, how: 'Selected' },
      { field: 'Purchase UOM', value: STYLE_59.purchaseUom, how: 'Selected' },
      { field: 'Color Card / Size Range', value: `${STYLE_59.colorCard} · ${STYLE_59.sizeRange}`, how: 'From colour and size masters' },
      { field: 'Price Per', value: STYLE_59.pricePer, how: 'Selected' },
      { field: 'Color Definition / Style Type', value: `${STYLE_59.colorDefinition} · ${STYLE_59.styleType}`, how: 'Read-only, from material type' },
    ] }],
    shots: [shot('apparel-nis59', 'WFX Apparel techpack detail of Adi TShirt (NIS-59)')],
  },
  {
    id: 'bom-materials', chapter: 'setup', name: 'BOM · Materials', screen: 'Apparel › BOM › Materials', theory: 'bom-materials', tabs: BOM_TABS,
    summary: 'One line per material: how much one T-shirt consumes, with wastage, and what it costs. Value flows to the Cost tab; each line is linked to a process on the Routing tab.',
    header: BOM_HEADER,
    grids: [{ id: 'lines', title: 'Materials (4)', group: 'section', cols: [
      { key: 'line', label: 'Line', type: 'key', num: true },
      { key: 'article', label: 'Article Code', type: 'link', from: { doc: 'rm-techpack', col: 'code' } },
      { key: 'name', label: 'Article Name', type: 'copied', from: { doc: 'rm-techpack', col: 'name' } },
      { key: 'purchaseUom', label: 'Purchase UOM', type: 'entered' },
      { key: 'consUom', label: 'Cons UOM', type: 'copied', from: { doc: 'rm-techpack', col: 'consUom' } },
      { key: 'colors', label: 'Material Colors', type: 'entered', dep: 'color', note: 'Colour dependency (Table): each style colour is mapped to a material colour from the Nis_colors colour card. Click a cell to see the mapping.' },
      { key: 'sizes', label: 'Material Sizes', type: 'entered', dep: 'size', note: 'Size dependency: each style size is mapped to a material size from the ERPSIZE size range. Click a cell to see the mapping.' },
      { key: 'totalCons', label: 'Total Cons Qty', type: 'entered', num: true },
      { key: 'perItem', label: 'Cons per Item', type: 'entered', num: true },
      { key: 'consQty', label: 'Cons Qty', type: 'calc', num: true, uses: ['totalCons', 'perItem'], calc: 'bom-cons-qty', formula: 'Total Cons Qty ÷ Cons per Item' },
      { key: 'loss', label: 'Loss %', type: 'entered', num: true, note: 'Applied first: Cons × 1 ÷ (1 − Loss %).' },
      { key: 'inclLoss', label: 'Cons incl Loss', type: 'calc', num: true, uses: ['consQty', 'loss'], calc: 'bom-cons-loss', formula: 'Cons Qty × 1 ÷ (1 − Loss %)' },
      { key: 'wastage', label: 'Wastage %', type: 'entered', num: true },
      { key: 'inclWastage', label: 'Cons incl Wastage', type: 'calc', num: true, uses: ['inclLoss', 'wastage'], calc: 'bom-cons-wastage', formula: 'Cons incl Loss + (Cons incl Loss × Wastage %)' },
      { key: 'shrink', label: 'Shrinkage %', type: 'entered', num: true, note: 'Applied last: Cons incl Wastage ÷ (1 − Shrinkage %).' },
      { key: 'finalCons', label: 'Final Consumption', type: 'calc', num: true, uses: ['inclWastage', 'shrink'], calc: 'bom-final-cons', formula: 'Cons incl Wastage ÷ (1 − Shrinkage %)  (the total consumption)' },
      { key: 'supplier', label: 'Supplier', type: 'entered' },
      { key: 'price', label: 'Purchase Price', type: 'entered', num: true },
      { key: 'factor', label: 'Conversion', type: 'copied', num: true, note: 'Purchase → Cons UOM factor from UOM Conversion; 1 when none is maintained.' },
      { key: 'cuomPrice', label: 'Cons UOM Price', type: 'calc', num: true, uses: ['price', 'factor'], calc: 'bom-cons-uom-price', formula: 'Purchase Price × Conversion' },
      { key: 'value', label: 'Value', type: 'calc', num: true, uses: ['finalCons', 'cuomPrice'], calc: 'bom-value', formula: 'Final Consumption × Cons UOM Price' },
    ], rows: BOM_59.map((l) => ({
      line: l.line, section: `${l.section} Section`, article: l.article, name: l.name, purchaseUom: l.purchaseUom, consUom: l.consUom,
      colors: 'By style colour', sizes: 'By style size', totalCons: l.totalCons, perItem: l.perItem, consQty: l.wfx.consQty, loss: l.lossPct, inclLoss: l.wfx.consQty, wastage: l.wastagePct,
      inclWastage: l.wfx.inclWastage, shrink: 0, finalCons: l.wfx.finalCons, supplier: l.supplier, price: l.purchasePrice, factor: l.conversion,
      cuomPrice: l.wfx.consUomPrice, value: l.wfx.value,
    })) },
    { id: 'chain', title: 'Consumption chain – worked example (Cons 2)', cols: [
      { key: 'case', label: 'Case', type: 'key' },
      { key: 'cons', label: 'Cons Qty', type: 'entered', num: true },
      { key: 'loss', label: 'Loss %', type: 'entered', num: true },
      { key: 'wastage', label: 'Wastage %', type: 'entered', num: true },
      { key: 'shrink', label: 'Shrinkage %', type: 'entered', num: true },
      { key: 'factor', label: 'Loss Factor', type: 'calc', num: true, uses: ['loss'], calc: 'bom-loss-factor', formula: '1 ÷ (1 − Loss %)' },
      { key: 'inclLoss', label: 'Cons incl Loss', type: 'calc', num: true, uses: ['cons', 'factor'], calc: 'bom-cons-loss', formula: 'Cons × Loss Factor' },
      { key: 'inclWastage', label: 'Cons incl Wastage', type: 'calc', num: true, uses: ['inclLoss', 'wastage'], calc: 'bom-cons-wastage', formula: 'Cons incl Loss + Cons incl Loss × Wastage %' },
      { key: 'total', label: 'Total Consumption', type: 'calc', num: true, uses: ['inclWastage', 'shrink'], calc: 'bom-final-cons', formula: 'Cons incl Wastage ÷ (1 − Shrinkage %)' },
    ], rows: [
      { case: 'Loss + wastage + shrinkage', l: 5, w: 5, s: 5 }, { case: 'Only wastage', l: 0, w: 5, s: 0 },
      { case: 'Only loss', l: 5, w: 0, s: 0 }, { case: 'Only shrinkage', l: 0, w: 0, s: 5 },
    ].map((x) => { const c = consChain(2, x.l, x.w, x.s); const f = (n: number) => Math.round(n * 1e6) / 1e6;
      return { case: x.case, cons: 2, loss: x.l, wastage: x.w, shrink: x.s, factor: f(c.lossFactor), inclLoss: f(c.inclLoss), inclWastage: f(c.inclWastage), total: f(c.total) }; }) }],
    shots: [shot('bom-materials-1', 'WFX BOM Materials tab: total cons qty and cons per item'), shot('bom-materials-2', 'WFX BOM Materials tab: cons qty, wastage % and final consumption'),
      shot('bom-materials-price', 'WFX BOM Materials tab: supplier, cons UOM price, purchase price and value'),
      shot('bom-colour-dependency-n8', 'WFX Color Dependency popup for line N-8'), shot('bom-size-dependency-n8', 'WFX Size Dependency popup for line N-8')],
  },
  {
    id: 'routing-processes', chapter: 'setup', name: 'BOM · Routing · Processes', screen: 'Apparel › BOM › Routing › Processes', theory: 'bom-routing', tabs: BOM_TABS, subtabs: ROUTING_TABS,
    summary: 'The processes that make the T-shirt, in order. Each Process Rate comes from its operation (Cost Of × Production Time) and is summed into Production Cost.',
    header: [...BOM_HEADER.slice(0, 2), { label: 'Routing', value: '#1 · Approved', type: 'entered' }, { label: 'Used For', value: 'All colours × sizes', type: 'entered' }],
    grids: [{ id: 'processes', title: 'Processes (3)', cols: [
      { key: 'seq', label: 'Seq', type: 'key', num: true },
      { key: 'process', label: 'Production Process', type: 'key' },
      { key: 'code', label: 'Process Code', type: 'entered' },
      { key: 'output', label: 'Output Item', type: 'entered' },
      { key: 'after', label: 'After Process', type: 'link', from: { doc: 'routing-processes', col: 'process' } },
      { key: 'rate', label: 'Process Rate', type: 'calc', num: true, calc: 'routing-process-rate', formula: 'Cost Of × Production Time (Operations tab)', from: { doc: 'routing-operations', col: 'rate' } },
    ], rows: ROUTING_59.map((p) => ({ seq: p.seq, process: p.process, code: p.code, output: p.output || '—', after: p.after || '—', rate: p.wfxRate })) }],
    shots: [shot('routing-processes', 'WFX Routing Processes tab with process rates 300, 10 and 15')],
  },
  {
    id: 'routing-operations', chapter: 'setup', name: 'BOM · Routing · Operations', screen: 'Apparel › BOM › Routing › Operations', theory: 'bom-routing', tabs: BOM_TABS, subtabs: ROUTING_TABS,
    summary: 'Operation parameters per process: machine, efficiency, Cost Of and time. Cost Of × Production Time becomes the Process Rate.',
    header: [...BOM_HEADER.slice(0, 2), { label: 'Target Production Efficiency', value: '100 %', type: 'entered' }],
    grids: [{ id: 'operations', title: 'Operations (3)', cols: [
      { key: 'process', label: 'Production Process', type: 'link', from: { doc: 'routing-processes', col: 'process' } },
      { key: 'efficiency', label: 'Efficiency %', type: 'entered', num: true, note: 'Default 0 % – does not change the rate.' },
      { key: 'costOf', label: 'Cost Of', type: 'entered', num: true, note: 'Default cost rate per unit of production time.' },
      { key: 'operation', label: 'Operation / Sub Operation', type: 'entered' },
      { key: 'machine', label: 'Machine Sub Category', type: 'entered' },
      { key: 'lossPct', label: 'Loss %', type: 'entered', num: true },
      { key: 'totalTime', label: 'Total Time', type: 'entered', num: true },
      { key: 'productionTime', label: 'Production Time', type: 'entered', num: true },
      { key: 'rate', label: 'Cost Of × Time', type: 'calc', num: true, uses: ['costOf', 'productionTime'], calc: 'routing-process-rate', formula: 'Cost Of × Production Time – shown as Process Rate' },
    ], rows: ROUTING_59.map((p) => ({ process: p.process, efficiency: p.efficiencyPct, costOf: p.costOf, operation: p.operation, machine: p.machine, lossPct: p.lossPct, totalTime: p.totalTime, productionTime: p.productionTime, rate: p.costOf * p.productionTime })) }],
    shots: [shot('routing-operations-1', 'WFX Routing Operations tab: efficiency, cost of, machine'), shot('routing-operations-2', 'WFX Routing Operations tab: total and production time')],
  },
  {
    id: 'material-linkage', chapter: 'setup', name: 'BOM · Routing · Material Linkage', screen: 'Apparel › BOM › Routing › Material Linkage', theory: 'bom-routing', tabs: BOM_TABS, subtabs: ROUTING_TABS,
    summary: 'Each BOM line is mapped to the process that consumes it – the fabric is issued to cutting, thread and cufflinks to sewing, the polybag to packing.',
    header: BOM_HEADER.slice(0, 2),
    grids: [{ id: 'linkage', title: 'Materials (4)', cols: [
      { key: 'line', label: 'Line', type: 'link', num: true, from: { doc: 'bom-materials', col: 'line' } },
      { key: 'article', label: 'Article Code', type: 'link', from: { doc: 'rm-techpack', col: 'code' } },
      { key: 'consUom', label: 'Cons UOM', type: 'copied', from: { doc: 'bom-materials', col: 'consUom' } },
      { key: 'wastage', label: 'Wastage %', type: 'copied', num: true, from: { doc: 'bom-materials', col: 'wastage' } },
      { key: 'process', label: 'Process', type: 'link', from: { doc: 'routing-processes', col: 'process' }, note: 'Selected here – the only entered value on this tab.' },
      { key: 'consQty', label: 'Cons Qty', type: 'copied', num: true, from: { doc: 'bom-materials', col: 'consQty' } },
      { key: 'final', label: 'Cons incl Wastage & Loss', type: 'copied', num: true, from: { doc: 'bom-materials', col: 'finalCons' } },
    ], rows: BOM_59.map((l) => ({ line: l.line, article: l.article, consUom: l.consUom, wastage: l.wastagePct, process: l.process, consQty: l.wfx.consQty, final: l.wfx.finalCons })) }],
    shots: [shot('routing-linkage-1', 'WFX Material Linkage tab: materials mapped to processes'), shot('routing-linkage-2', 'WFX Material Linkage tab: cons qty and cons incl wastage')],
  },
  {
    id: 'bom-cost', chapter: 'setup', name: 'BOM · Cost', screen: 'Apparel › BOM › Cost', theory: 'bom-costing', tabs: BOM_TABS,
    summary: 'Material value by section plus process rates give the Total Cost per piece, which is compared with the selling price after and before discount.',
    header: BOM_HEADER,
    grids: [
      { id: 'sections', title: 'Materials by section', cols: [
        { key: 'section', label: 'Section', type: 'key' },
        { key: 'lines', label: 'Lines', type: 'copied', from: { doc: 'bom-materials', col: 'line' } },
        { key: 'total', label: 'Total Cost', type: 'calc', num: true, calc: 'cost-section', formula: 'Σ Value of the section lines', from: { doc: 'bom-materials', col: 'value' } },
        { key: 'budget', label: 'Budget', type: 'entered', num: true },
        { key: 'additional', label: 'Additional Cost', type: 'entered', num: true },
      ], rows: [
        { section: 'Fabric Section', lines: '1 · N-8', total: COSTING_59.wfx.fabricTotal, budget: 0, additional: 0 },
        { section: 'Trim Section', lines: '2 · T-1, 3 · NS1-1, 4 · PP-1', total: COSTING_59.wfx.trimTotal, budget: 0, additional: 0 },
      ] },
      { id: 'production', title: 'Production cost (3)', cols: [
        { key: 'process', label: 'Process', type: 'link', from: { doc: 'routing-processes', col: 'process' } },
        { key: 'basis', label: 'Basis', type: 'entered' },
        { key: 'currency', label: 'Currency', type: 'entered' },
        { key: 'value', label: 'Value (CS Curr)', type: 'copied', num: true, from: { doc: 'routing-processes', col: 'rate' } },
      ], rows: ROUTING_59.map((p) => ({ process: p.process, basis: 'Amount', currency: 'INR', value: p.wfxRate })) },
      { id: 'summary', title: 'Cost summary', cols: [
        { key: 'item', label: 'Item', type: 'key' },
        { key: 'value', label: 'Value (INR)', type: 'calc', num: true },
        { key: 'how', label: 'How WFX gets it', type: 'calc' },
      ], rows: [
        { item: 'Material Cost', value: r2(COSTING_59.wfx.fabricTotal + COSTING_59.wfx.trimTotal), how: 'Fabric 24,750 + Trim 40.72' },
        { item: 'Production Cost', value: 325, how: 'VCutting 300 + Sewing 10 + VPacking 15' },
        { item: 'Recipe / Indirect / CM', value: 0, how: 'Entered (none)' },
        { item: 'Total Cost', value: COSTING_59.wfx.totalCost, how: 'Material + Production + others' },
        { item: 'Selling Price', value: COSTING_59.sellingPrice, how: 'Entered and locked' },
        { item: 'Discount 10 %', value: COSTING_59.wfx.discountAmt, how: '4,000 × 10 %' },
        { item: 'Profit', value: COSTING_59.wfx.profit, how: '(4,000 − 400) − 25,115.72 → −597.66 % of 3,600' },
        { item: 'Markup', value: COSTING_59.wfx.markup, how: '4,000 − 25,115.72 → −84.07 % of cost' },
      ] },
    ],
    shots: [shot('cost-materials', 'WFX BOM Cost tab: section totals and production cost'), shot('cost-consumption', 'WFX BOM Cost tab: consumption columns'),
      shot('cost-colours', 'WFX BOM Cost tab: material colour per garment colour'), shot('cost-price', 'WFX BOM Cost tab: price and value columns'),
      shot('cost-summary', 'WFX BOM Cost summary: total cost 25,115.72, selling price 4,000, discount 10 %, profit −597.66 %, markup −84.07 %')],
  },

  // ═════════ Chapter 2 · Booking, order & production (NIS-58, Excel) ═════════
  {
    id: 'bom-58', chapter: 'order', name: 'BOM used by the order', screen: 'Apparel › BOM › Materials (NIS-58)', theory: 'bom-materials',
    summary: 'The Flannel Shirt Adi (NIS-58) BOM line that the booking, MRP and FPO quantities are exploded with: 1.5 KG_Nis of N-8 per shirt.',
    header: [{ label: 'BOM', value: 'NIS-58|#1 DP|V1', type: 'key' }, { label: 'Expected Order Qty', value: '34,000', type: 'entered' }],
    grids: [{ id: 'line', title: 'Materials (1)', cols: [
      { key: 'article', label: 'Article Code', type: 'link', from: { doc: 'rm-techpack', col: 'code' } },
      { key: 'totalCons', label: 'Total Cons Qty', type: 'entered', num: true },
      { key: 'perItem', label: 'Cons per Item', type: 'entered', num: true },
      { key: 'finalCons', label: 'Final Consumption', type: 'calc', num: true, uses: ['totalCons', 'perItem'], calc: 'bom-final-cons', formula: '3 ÷ 2 with 0 % wastage' },
      { key: 'cuomPrice', label: 'Cons UOM Price', type: 'calc', num: true, calc: 'bom-cons-uom-price', formula: '15 × 1,000' },
      { key: 'colours', label: 'Colours used', type: 'entered' },
    ], rows: [{ article: 'N-8', totalCons: 3, perItem: 2, finalCons: 1.5, cuomPrice: 15000, colours: 'BALSAM TREE, Cosmic sky purple, Happy Pink' }] }],
  },
  {
    id: 'bbb', chapter: 'order', name: 'Buyer Block Booking', screen: 'Order › Buyer Block Booking › Material Details', theory: 'buyer-block-booking',
    summary: 'Fabric booked per colour/size before the order exists. Indented Qty is written back from the Adhoc Indent.',
    header: [{ label: 'Block Booking No.', value: 'PPJ179', type: 'key' }, { label: 'Type / Season', value: 'Projection · AW26', type: 'entered' }, { label: 'Buyer', value: 'GAP Kids', type: 'copied' }],
    grids: [{ id: 'material', title: 'Material Details (6)', cols: [
      { key: 'key', label: 'Material Line Key', type: 'key' },
      { key: 'article', label: 'Article', type: 'link', from: { doc: 'rm-techpack', col: 'code' } },
      { key: 'colour', label: 'Colour', type: 'entered' },
      { key: 'size', label: 'Size', type: 'entered' },
      { key: 'units', label: 'Units', type: 'entered', num: true, note: 'Requirement = BBB qty × Cons (Auto MRP configuration).' },
      { key: 'rate', label: 'Rate', type: 'entered', num: true },
      { key: 'value', label: 'Value', type: 'calc', num: true, uses: ['units', 'rate'], calc: 'bbb-material-value', formula: 'Units × Rate' },
      { key: 'indented', label: 'Indented Qty', type: 'copied', num: true, from: { doc: 'adhoc-indent', col: 'indentQty' } },
      { key: 'balance', label: 'Balance to Indent', type: 'calc', num: true, uses: ['units', 'indented'], calc: 'bbb-balance', formula: 'Units − Indented Qty' },
    ], rows: BBB_MATERIAL.map((l) => ({ key: `PPJ179.1|N-8|${l.color}|${l.size}`, article: 'N-8', colour: colour(l.color), size: size(l.size), units: l.units, rate: l.rate, value: l.value, indented: l.indented, balance: l.balance })) }],
  },
  {
    id: 'adhoc-indent', chapter: 'order', name: 'BBB Adhoc Indent', screen: 'Sourcing › Adhoc Indents', theory: 'adhoc-indent',
    summary: 'Raised from the booking ("Generate Indent Requirement"). Each line points back to a booking material line; Ordered Qty comes back from the PO.',
    header: [{ label: 'Indent No.', value: 'PPM-000735-001', type: 'key' }, { label: 'Indent Type', value: 'Buyer Block Booking', type: 'entered' }, { label: 'Status', value: 'Completed', type: 'calc' }],
    grids: [{ id: 'lines', title: 'Indent lines (6)', cols: [
      { key: 'key', label: 'Indent Line Key', type: 'key' },
      { key: 'booking', label: 'Booking Material Line', type: 'link', from: { doc: 'bbb', col: 'key' } },
      { key: 'booked', label: 'Booked Units', type: 'copied', num: true, from: { doc: 'bbb', col: 'units' } },
      { key: 'balance', label: 'Balance Units', type: 'calc', num: true, uses: ['booked'], calc: 'indent-balance', formula: 'Booked − Previous indent' },
      { key: 'indentQty', label: 'Indent Qty', type: 'entered', num: true },
      { key: 'rate', label: 'Rate', type: 'copied', num: true, from: { doc: 'bbb', col: 'rate' } },
      { key: 'ordered', label: 'Ordered Qty', type: 'copied', num: true, from: { doc: 'rmpo-1229', col: 'ordered' } },
      { key: 'open', label: 'Open Qty', type: 'calc', num: true, uses: ['indentQty', 'ordered'], calc: 'indent-open', formula: 'Indent Qty − Ordered − Adjustments' },
    ], rows: ADHOC_INDENT.map((l) => ({ key: `PPM-000735-001|${l.sno}`, booking: `PPJ179.1|N-8|${l.color}|${l.size}`, booked: l.booked, balance: l.balance, indentQty: l.indentQty, rate: l.rate, ordered: l.ordered, open: l.open })) }],
  },
  {
    id: 'rmpo-1229', chapter: 'order', name: 'RMPO 1229', screen: 'Sourcing › Raw Material PO', theory: 'rmpo',
    summary: 'Purchase order for the booked fabric. Value uses the PO price (10), not the indent rate (5). Shipped Qty comes back from the GRN.',
    header: [{ label: 'Order No.', value: 'FAB/PPJ/Rmpo/PPS12/1229', type: 'key' }, { label: 'Supplier', value: 'GAP Kids_Nis', type: 'entered' }, { label: 'Status', value: 'Confirmed', type: 'entered' }],
    grids: [{ id: 'lines', title: 'Article Detail (6)', cols: [
      { key: 'key', label: 'PO Line', type: 'key' },
      { key: 'indentLine', label: 'Indent Line', type: 'link', from: { doc: 'adhoc-indent', col: 'key' } },
      { key: 'colour', label: 'Colour', type: 'copied' },
      { key: 'size', label: 'Size', type: 'copied' },
      { key: 'ordered', label: 'Ordered Qty', type: 'entered', num: true },
      { key: 'price', label: 'Price per Unit', type: 'entered', num: true },
      { key: 'value', label: 'Total Value', type: 'calc', num: true, uses: ['ordered', 'price'], calc: 'rmpo-value', formula: 'Ordered Qty × Price per Unit' },
      { key: 'shipped', label: 'Shipped Qty', type: 'copied', num: true, from: { doc: 'grn', col: 'accepted' } },
      { key: 'open', label: 'Open Qty', type: 'calc', num: true, uses: ['ordered', 'shipped'], calc: 'rmpo-open', formula: 'Ordered − Shipped' },
      { key: 'stockKey', label: 'Stock Key', type: 'copied' },
    ], rows: RMPO_1229.map((l) => ({ key: `1229|${l.sno}`, indentLine: `PPM-000735-001|${l.indentLine}`, colour: colour(l.color), size: size(l.size), ordered: l.ordered, price: l.price, value: l.value, shipped: l.shipped, open: l.open, stockKey: `N-8|${l.color}|${l.size}` })) }],
  },
  {
    id: 'grn', chapter: 'order', name: 'GRN', screen: 'Inventory › GRN', theory: 'grn',
    summary: 'Fabric received against RMPO 1229. Accepted qty becomes stock under the stock key, still tagged with booking PPJ179.',
    header: [{ label: 'Receipt Type', value: 'ASN from Supplier – Against PO', type: 'entered' }, { label: 'Receiving Site', value: 'ACHIEVER CUT STORE', type: 'entered' }],
    grids: [{ id: 'lines', title: 'GRN Qty (6)', cols: [
      { key: 'poLine', label: 'PO Line', type: 'link', from: { doc: 'rmpo-1229', col: 'key' } },
      { key: 'ordered', label: 'Ordered Qty', type: 'copied', num: true, from: { doc: 'rmpo-1229', col: 'ordered' } },
      { key: 'balance', label: 'Balance Qty', type: 'calc', num: true, uses: ['ordered'], calc: 'grn-balance', formula: 'Ordered − Previously received + Returned' },
      { key: 'received', label: 'Received Qty', type: 'entered', num: true },
      { key: 'rejected', label: 'Rejected Qty', type: 'entered', num: true },
      { key: 'accepted', label: 'Accepted Qty', type: 'calc', num: true, uses: ['received', 'rejected'], calc: 'grn-accepted', formula: 'Received − Rejected' },
      { key: 'value', label: 'Value', type: 'calc', num: true, uses: ['accepted'], calc: 'grn-accepted', formula: 'Accepted × Rate (10)' },
      { key: 'stockKey', label: 'Stock Key', type: 'copied', from: { doc: 'rmpo-1229', col: 'stockKey' } },
    ], rows: GRN.map((l) => ({ poLine: `1229|${l.sno}`, ordered: l.ordered, balance: l.balance, received: l.received, rejected: l.rejected, accepted: l.accepted, value: l.value, stockKey: `N-8|${RMPO_1229[l.sno - 1].color}|${RMPO_1229[l.sno - 1].size}` })) }],
  },
  {
    id: 'oc', chapter: 'order', name: 'Sales Order (OC)', screen: 'Order › Purchase Order from Buyer › Quantity BreakUp', theory: 'buyer-po',
    summary: 'The confirmed buyer order: pieces per colour × size. Confirming it runs MRP.',
    header: [{ label: 'OC No', value: 'GAPS.NEWOC -249.1', type: 'key' }, { label: 'BOM', value: '#1 DP', type: 'link', from: { doc: 'bom-58', col: 'article' } }, { label: 'Block Booking', value: 'PPJ179/1', type: 'link', from: { doc: 'bbb', col: 'key' } }],
    grids: [{ id: 'breakup', title: 'Add Quantity BreakUp (4)', cols: [
      { key: 'key', label: 'BreakUp Key', type: 'key' },
      { key: 'colour', label: 'Colour', type: 'entered' },
      { key: 'size', label: 'Size', type: 'entered' },
      { key: 'qty', label: 'Qty', type: 'entered', num: true },
      { key: 'price', label: 'Selling Price', type: 'entered', num: true },
      { key: 'value', label: 'Total Value', type: 'calc', num: true, uses: ['qty', 'price'], calc: 'oc-value', formula: 'Qty × Selling Price' },
    ], rows: OC_BREAKUP.map((l) => ({ key: `-249.1|${l.color}|${l.size}`, colour: colour(l.color), size: size(l.size), qty: l.qty, price: l.price, value: l.value })) }],
  },
  {
    id: 'mrp', chapter: 'order', name: 'MRP', screen: 'Planning › MRP', theory: 'mrp',
    summary: 'Level 1 = garments to make (from the OC). Level 2 = fabric to buy: garment qty × BOM final consumption. Running Level 1 for the full qty generates the child indents. Any level can take a negative, but a child indent is reduced or cancelled only by a negative at its parent level, and only after MRP is re-run.',
    header: [{ label: 'Order', value: 'GAPS.NEWOC -249.1', type: 'copied' }, { label: 'Triggered by', value: 'OC confirmation', type: 'calc' }],
    grids: [
      { id: 'l1', title: 'Level 1 – Garment (4)', cols: [
        { key: 'key', label: 'L1 Key', type: 'key' },
        { key: 'oc', label: 'OC Line', type: 'link', from: { doc: 'oc', col: 'key' } },
        { key: 'req', label: 'Actual Requirement', type: 'copied', num: true, from: { doc: 'oc', col: 'qty' } },
        { key: 'mrpPct', label: 'MRP %', type: 'entered', num: true },
        { key: 'reqQty', label: 'Req Qty', type: 'calc', num: true, uses: ['req', 'mrpPct'], calc: 'mrp-l1-req', formula: 'Actual Requirement × MRP % × (1 + Loss %)' },
        { key: 'demand', label: 'Demand Type', type: 'calc', calc: 'mrp-demand' },
      ], rows: MRP_L1.map((l) => ({ key: `L1|${l.color}|${l.size}`, oc: `-249.1|${l.color}|${l.size}`, req: l.req, mrpPct: l.mrpPct, reqQty: l.reqQty, demand: 'Production' })) },
      { id: 'l2', title: 'Level 2 – Fabric N-8 (4)', cols: [
        { key: 'key', label: 'L2 Key', type: 'key' },
        { key: 'parent', label: 'Parent L1', type: 'link', from: { doc: 'mrp', col: 'key' } },
        { key: 'garment', label: 'Garment Req Qty', type: 'copied', num: true, from: { doc: 'mrp', col: 'reqQty' } },
        { key: 'finalCons', label: 'Final Consumption', type: 'copied', num: true, from: { doc: 'bom-58', col: 'finalCons' } },
        { key: 'reqQty', label: 'Req Qty', type: 'calc', num: true, uses: ['garment', 'finalCons'], calc: 'mrp-l2-req', formula: 'Garment Req Qty × Final Consumption' },
        { key: 'demand', label: 'Demand Type', type: 'calc', calc: 'mrp-demand' },
      ], rows: MRP_L2.map((l) => ({ key: `L2|${l.color}|${l.size}`, parent: `L1|${l.color}|${l.size}`, garment: l.garmentReq, finalCons: l.finalCons, reqQty: l.reqQty, demand: 'Purchase' })) },
      { id: 'adjust', title: 'Adjustment scenarios (Level 1 = 500)', cols: [
        { key: 'enteredAt', label: 'Entered at', type: 'entered', note: 'Every level can take a negative; only one entered at the parent level changes the child indent.' },
        { key: 'adjustment', label: 'MRP Adjustment', type: 'entered', num: true, note: 'Negative quantity the user enters at MRP.' },
        { key: 'level1', label: 'Level 1 Qty', type: 'copied', num: true },
        { key: 'net', label: 'Net Level 1 Qty', type: 'calc', num: true, uses: ['level1', 'adjustment'], calc: 'mrp-adjust', formula: 'Level 1 Qty + Adjustment (when entered at Level 1)' },
        { key: 'finalCons', label: 'Final Consumption', type: 'copied', num: true, from: { doc: 'bom-58', col: 'finalCons' } },
        { key: 'child', label: 'Child Indent Qty', type: 'calc', num: true, uses: ['net', 'finalCons'], calc: 'mrp-adjust', formula: 'Net Level 1 Qty × Final Consumption (+ Adjustment when entered at Level 2)' },
        { key: 'result', label: 'Result', type: 'calc', note: 'Full quantity generates the child indent; part reduces it; the whole quantity cancels it.' },
      ], rows: MRP_ADJUST_SCENARIOS.map((x) => ({ enteredAt: x.enteredAt, adjustment: x.adjustment, level1: x.level1, net: x.net, finalCons: x.finalCons, child: x.child, result: x.result })) },
    ],
  },
  {
    id: 'so-indent', chapter: 'order', name: 'Sales Order Indent', screen: 'Sourcing › Indent (MRP – Production)', theory: 'production-indents',
    summary: 'MRP Level 2 written as an indent. Booking stock with the same stock key is reserved first (In-house Adj.); only the rest is ordered.',
    header: [{ label: 'Indent No.', value: 'PPM-000738-001', type: 'key' }, { label: 'Indent Type', value: 'Production (MRP Level 2)', type: 'calc' }, { label: 'Price', value: '15,000 / KG_Nis', type: 'copied', from: { doc: 'bom-58', col: 'cuomPrice' } }],
    grids: [{ id: 'lines', title: 'Indent lines (4)', cols: [
      { key: 'key', label: 'Indent Line Key', type: 'key' },
      { key: 'mrp', label: 'MRP L2 Line', type: 'link', from: { doc: 'mrp', col: 'key' } },
      { key: 'stockKey', label: 'Stock Key', type: 'link', from: { doc: 'grn', col: 'stockKey' } },
      { key: 'indentQty', label: 'Indent Qty', type: 'copied', num: true, from: { doc: 'mrp', col: 'reqQty' } },
      { key: 'puom', label: 'Purchase UOM Qty', type: 'calc', num: true, uses: ['indentQty'], calc: 'pi-purchase-uom', formula: 'Indent Qty × 1,000' },
      { key: 'stock', label: 'BBB Stock Available', type: 'copied', num: true, from: { doc: 'grn', col: 'accepted' } },
      { key: 'inhouse', label: 'In-house Adj.', type: 'calc', num: true, uses: ['indentQty', 'stock'], calc: 'pi-inhouse-adj', formula: 'MIN(Indent Qty, BBB stock)' },
      { key: 'ordered', label: 'Ordered Qty', type: 'calc', num: true, uses: ['indentQty', 'inhouse'], calc: 'pi-ordered', formula: 'Indent Qty − In-house Adj.' },
    ], rows: PROD_INDENT_L2.map((l) => ({ key: `PPM-000738-001|${l.sno}`, mrp: `L2|${l.color}|${l.size}`, stockKey: `N-8|${l.color}|${l.size}`, indentQty: l.indentQty, puom: l.purchaseUomQty, stock: l.bbbStock, inhouse: l.inHouseAdj, ordered: l.ordered })) }],
  },
  {
    id: 'rmpo-1230', chapter: 'order', name: 'RMPO 1230', screen: 'Sourcing › Raw Material PO', theory: 'rmpo',
    summary: 'Purchase order only for the part of the sales-order indent not covered by booking stock.',
    header: [{ label: 'Order No.', value: 'FAB/PPJ/Rmpo/PPS12/1230', type: 'key' }, { label: 'Status', value: 'Unconfirmed', type: 'entered' }],
    grids: [{ id: 'lines', title: 'Article Detail (4)', cols: [
      { key: 'indentLine', label: 'Indent Line', type: 'link', from: { doc: 'so-indent', col: 'key' } },
      { key: 'indentQty', label: 'Indent Qty', type: 'copied', num: true, from: { doc: 'so-indent', col: 'indentQty' } },
      { key: 'inhouse', label: 'In-house Adj.', type: 'copied', num: true, from: { doc: 'so-indent', col: 'inhouse' } },
      { key: 'ordered', label: 'Ordered Qty', type: 'copied', num: true, from: { doc: 'so-indent', col: 'ordered' } },
      { key: 'shipped', label: 'Shipped Qty', type: 'entered', num: true },
      { key: 'open', label: 'Open Qty', type: 'calc', num: true, uses: ['ordered', 'shipped'], calc: 'rmpo-open', formula: 'Ordered − Shipped' },
    ], rows: RMPO_1230.map((l) => ({ indentLine: `PPM-000738-001|${l.sno}`, indentQty: l.indentQty, inhouse: l.inHouseAdj, ordered: l.ordered, shipped: l.shipped, open: l.open })) }],
  },
  {
    id: 'fpo', chapter: 'order', name: 'FPO', screen: 'Production › Factory Production Order', theory: 'fpo',
    summary: 'Pieces released to the factory, the fabric they need, and how much of it is already reserved versus still on order.',
    header: [{ label: 'FPO No.', value: 'PPS12FP0158', type: 'key' }, { label: 'Production Order', value: 'PPS12SO/11325', type: 'copied' }, { label: 'Factory', value: 'Nishant_Fab_ltd', type: 'entered' }],
    grids: [
      { id: 'qty', title: 'FPO Qty – Colour/Size (4)', cols: [
        { key: 'key', label: 'Breakdown Key', type: 'key' },
        { key: 'oc', label: 'OC Line', type: 'link', from: { doc: 'oc', col: 'key' } },
        { key: 'allocated', label: 'Allocated Qty', type: 'copied', num: true, from: { doc: 'oc', col: 'qty' } },
        { key: 'reduced', label: 'Reduced at FPO', type: 'entered', num: true },
        { key: 'fpoQty', label: 'FPO Qty', type: 'calc', num: true, uses: ['allocated', 'reduced'], calc: 'fpo-qty', formula: 'Allocated − Reduced' },
        { key: 'finalCons', label: 'Final Consumption', type: 'copied', num: true, from: { doc: 'bom-58', col: 'finalCons' } },
        { key: 'fabric', label: 'Fabric Qty Reqd', type: 'calc', num: true, uses: ['fpoQty', 'finalCons'], calc: 'fpo-fabric', formula: 'FPO Qty × Final Consumption' },
      ], rows: FPO_QTY.map((l) => ({ key: `FP0158|${l.color}|${l.size}`, oc: `-249.1|${l.color}|${l.size}`, allocated: l.allocated, reduced: l.reduced, fpoQty: l.fpoQty, finalCons: l.finalCons, fabric: l.fabricReqd })) },
      { id: 'alloc', title: 'Stock Material Allocation (4)', cols: [
        { key: 'indentLine', label: 'Indent Line', type: 'link', from: { doc: 'so-indent', col: 'key' } },
        { key: 'reqd', label: 'Qty Reqd', type: 'copied', num: true, from: { doc: 'fpo', col: 'fabric' } },
        { key: 'instructed', label: 'Net Qty Instructed', type: 'copied', num: true, from: { doc: 'so-indent', col: 'inhouse' } },
        { key: 'open', label: 'Open Qty', type: 'calc', num: true, uses: ['reqd', 'instructed'], calc: 'fpo-alloc-open', formula: 'Qty Reqd − Net Qty Instructed' },
      ], rows: FPO_ALLOC.map((l, i) => ({ indentLine: `PPM-000738-001|${i + 1}`, reqd: l.qtyReqd, instructed: l.netInstructed, open: l.open })) },
    ],
  },

  // ═════════ Chapter 3 · Admin & setup rules (explained by the functional owner) ═════════
  {
    id: 'article-coding', chapter: 'admin', name: 'Article Code Definition', screen: 'Admin › System Coding › Article Code', theory: 'rm-techpack',
    summary: 'How article codes (and names) are generated. Manual: the user types it. Automatic: the code is the code sections of the matching rule joined in Sort order. Rules differ per category.',
    header: [
      { label: 'Category', value: 'Textiles/Fabric', type: 'entered' },
      { label: 'Logic', value: 'Automatic (or Manual)', type: 'entered' },
      { label: 'Used on', value: 'Techpack › Article Code / Article Name', type: 'link', from: { doc: 'rm-techpack', col: 'code' } },
    ],
    grids: [
      { id: 'rules', title: 'Rules', cols: [
        { key: 'rule', label: 'Rule', type: 'key' },
        { key: 'materialType', label: 'Material Type', type: 'entered', note: 'The rule applies to techpacks with this material type.' },
        { key: 'productGroup', label: 'Product Group', type: 'entered', note: '"ALL Other" applies to every product group.' },
        { key: 'subCategory', label: 'Sub Category', type: 'entered' },
        { key: 'section', label: 'Code Section', type: 'entered', note: 'One part of the code, chosen from the Code Section list.' },
        { key: 'value', label: 'Value', type: 'entered', note: 'Typed text or separator; empty when the section is read from the techpack (Material Type, Product Group…).' },
        { key: 'sort', label: 'Sort', type: 'entered', num: true, note: 'Order of the sections in the code: 10, 20, 30…' },
      ], rows: ARTICLE_CODE_RULES.flatMap((r) => r.parts.map((q, i) => ({ rule: i === 0 ? `Rule ${r.rule}` : '', materialType: i === 0 ? r.materialType : '', productGroup: i === 0 ? r.productGroup : '', subCategory: i === 0 ? r.subCategory : '', section: q.section, value: q.value, sort: q.sort }))) },
      { id: 'sections', title: 'Code Section list', cols: [
        { key: 'name', label: 'Code Section', type: 'key' }, { key: 'meaning', label: 'Meaning', type: 'entered' },
      ], rows: ARTICLE_CODE_SECTIONS.map((x) => ({ name: x.name, meaning: x.meaning })) },
    ],
    shots: [shot('article-code-definition', 'WFX Article Code Definition for category Textiles/Fabric with automatic logic and code sections'), shot('article-code-sections', 'List of code sections that can be picked in an Article Code Definition')],
  },
  {
    id: 'uom-types', chapter: 'admin', name: 'UOM types', screen: 'Raw material techpack › UOM', theory: 'rm-techpack',
    summary: 'Three kinds of unit run through WFX: the unit stock is kept in, the unit the BOM consumes in, and the unit the material is bought in. A conversion factor links purchase to consumption.',
    header: [{ label: 'Conversion', value: 'Cons UOM Price = Purchase Price × Conversion Factor', type: 'calc' }],
    grids: [{ id: 'types', title: 'UOM types', cols: [
      { key: 'name', label: 'UOM type', type: 'key' }, { key: 'meaning', label: 'Meaning', type: 'entered' },
      { key: 'where', label: 'Set on', type: 'entered' }, { key: 'example', label: 'Example', type: 'entered' },
    ], rows: UOM_TYPES.map((c) => ({ name: c.name, meaning: c.definition, where: c.where, example: c.example ?? '' })) }],
  },
  {
    id: 'dependency-types', chapter: 'admin', name: 'Colour & size dependency types', screen: 'BOM › Materials › Dependency', theory: 'bom-materials',
    summary: 'Each BOM line says how it takes its colours and sizes from the apparel: directly (Base), through a map the user keeps (Table), or not at all (None).',
    header: [{ label: 'Table map', value: 'Apparel colour/size → material colour/size from the material masters', type: 'entered' }],
    grids: [{ id: 'types', title: 'Dependency types', cols: [
      { key: 'kind', label: 'Dependency', type: 'key' }, { key: 'name', label: 'Type', type: 'entered' },
      { key: 'meaning', label: 'Meaning', type: 'entered' }, { key: 'example', label: 'Example', type: 'entered' },
    ], rows: DEPENDENCY_TYPES.map((c) => ({ kind: c.group, name: c.name, meaning: c.definition, example: c.example ?? '' })) }],
  },
  {
    id: 'bom-types', chapter: 'admin', name: 'BOM types, versions & indent rule', screen: 'Apparel › BOM › header', theory: 'bom-materials',
    summary: 'A BOM is kept version-wise with a cost sheet (currency, date and time). One BOM is the Standard BOM and acts as the budget. Missing User Group / Purchase Officer leaves the post-MRP indent Inactive.',
    header: [{ label: 'Created by', value: 'Copy from template or copy from item', type: 'entered' }, { label: 'Standard BOM', value: 'Star or Standard BOM option', type: 'entered' }],
    grids: [{ id: 'rules', title: 'BOM rules', cols: [
      { key: 'name', label: 'Topic', type: 'key' }, { key: 'group', label: 'Kind', type: 'entered' },
      { key: 'meaning', label: 'What it means', type: 'entered' }, { key: 'where', label: 'Where', type: 'entered' },
    ], rows: BOM_CONCEPTS.map((c) => ({ name: c.name, group: c.group, meaning: c.definition, where: c.where })) }],
  },


  // ═════════ Chapter 4 · Sales Order re-write (from the Sprint 1-3 specifications) ═════════
  {
    id: 'so-structure', chapter: 'sales', name: 'Sales Order · Structure & pricing', screen: 'Sales › Sales Order › New', theory: 'buyer-po',
    summary: 'One transaction page for an order: Order Information, Other Details, Delivery and Items, Instructions, Documents and History. An order holds deliveries, a delivery holds articles, an article holds a colour/size breakup priced by the Tech Pack Price Per.',
    header: [{ label: 'Screen title', value: 'Add Sales Order · Edit Sales Order · Sales Order', type: 'calc' }, { label: 'Entry points', value: 'Add New Order (list) · Purchase Order from Buyer', type: 'entered' }],
    grids: [
      { id: 'levels', title: 'Levels', cols: [
        { key: 'level', label: 'Level', type: 'key' }, { key: 'holds', label: 'Holds', type: 'entered' }, { key: 'keys', label: 'Key fields', type: 'entered' },
      ], rows: [
        { level: 'Sales Order (Main OC)', holds: 'Deliveries', keys: 'Sales Order No, Category, Buyer, Buyer Division/Dept, Order Season' },
        { level: 'Delivery (Delivery OC)', holds: 'Articles', keys: 'Delivery Buyer Order Ref, Buyer / OC Delivery Date, Mode of Shipment, Destination, Bill To' },
        { level: 'Article', holds: 'Colour/Size breakup', keys: 'Article Name/Code, Buyer Style Ref, Order Type, Packing Type, Extra Production %' },
        { level: 'Colour / Size line', holds: 'Quantity and price', keys: 'Colour, Size, Selling Price, Quantity Breakup, Total Quantity, Total Value' },
      ] },
      soRules('rules', 'Structure, pricing and quantity rules', ['Structure', 'Pricing', 'Quantity']),
    ],
  },
  {
    id: 'so-actions', chapter: 'sales', name: 'Sales Order · Delivery & order actions', screen: 'Sales Order list · context menus', theory: 'buyer-po',
    summary: 'Add, copy, delete, split, cancel, close and reopen a delivery; cancel, close, revise or split/shuffle a whole order. Remarks are required for cancel, close and reopen, and every action is written to History.',
    header: [{ label: 'Duplicate check', value: 'Buyer Order Ref + Buyer Delivery Date + OC Delivery Date + Mode of Shipment', type: 'calc' }],
    grids: [
      { id: 'actions', title: 'Actions', cols: [
        { key: 'action', label: 'Action', type: 'key' }, { key: 'where', label: 'Where', type: 'entered' }, { key: 'needs', label: 'Needs', type: 'entered' },
        { key: 'result', label: 'Result', type: 'calc' }, { key: 'rule', label: 'Rule', type: 'entered' },
      ], rows: SO_ACTIONS.map((a) => ({ action: a.action, where: a.where, needs: a.needs, result: a.result, rule: a.rule })) },
      { id: 'split', title: 'Split – worked example (Red / S, M, L = 100, 200, 200)', cols: [
        { key: 'mode', label: 'Mode', type: 'entered' }, { key: 'input', label: 'Entered', type: 'entered' }, { key: 'line', label: 'Colour / Size', type: 'key' },
        { key: 'existing', label: 'Existing Qty', type: 'copied', num: true },
        { key: 'moved', label: 'Moved Qty', type: 'calc', num: true, uses: ['existing', 'input'], calc: 'so-split-pct', formula: 'Existing × % ÷ 100 (percentage) · Entered qty × line share (quantity)' },
        { key: 'remaining', label: 'Remaining Qty', type: 'calc', num: true, uses: ['existing', 'moved'], calc: 'so-split-qty', formula: 'Existing − Moved' },
      ], rows: SO_SPLIT_SCENARIOS.map((x) => ({ mode: x.mode, input: x.input, line: x.line, existing: x.existing, moved: x.moved, remaining: x.remaining })) },
      soRules('rules', 'Delivery, order and control rules', ['Delivery actions', 'Order actions', 'Controls']),
    ],
  },
  {
    id: 'so-approval', chapter: 'sales', name: 'Sales Order · Approval', screen: 'Approval Centre · Sales Order', theory: 'buyer-po',
    summary: 'An order goes for approval depending on the approver value: 0 never, -1 always, otherwise only above the limit. Approval can be single level, multi level or parallel (multiple approvers).',
    header: [{ label: 'Approve at', value: 'Home › Approval Centre › Sales Order › Pending Approval', type: 'entered' }],
    grids: [
      { id: 'limit', title: 'Approval value – worked example', cols: [
        { key: 'limit', label: 'Approval Value', type: 'entered', num: true }, { key: 'value', label: 'Order Value', type: 'copied', num: true },
        { key: 'goes', label: 'Goes for approval', type: 'calc', uses: ['limit', 'value'], calc: 'so-approval-limit', formula: '0 never · -1 always · otherwise Order Value > Limit' },
      ], rows: SO_APPROVAL_SCENARIOS.map((x) => ({ limit: x.limit, value: x.value, goes: x.goes })) },
      soRules('rules', 'Approval modes', ['Approval']),
    ],
  },
  {
    id: 'so-pricing', chapter: 'sales', name: 'Sales Order · Price, desync & sub total', screen: 'Delivery selling price · Desync Price OC list', theory: 'buyer-po',
    summary: 'The selling price follows Price Per from the Tech Pack and can carry an upcharge or discount. The cost sheet or BOM price is the source of truth: a mismatch makes the OC Desynced until it is synced.',
    header: [{ label: 'Setting', value: 'OC Price Validation with selling price in cost sheet = ON', type: 'entered' }],
    grids: [
      { id: 'upcharge', title: 'Upcharge / discount', cols: [
        { key: 'level', label: 'Price Per level', type: 'copied' }, { key: 'base', label: 'Base Selling Price', type: 'copied', num: true },
        { key: 'adj', label: 'Upcharge / Discount', type: 'entered', num: true },
        { key: 'final', label: 'Final Selling Price', type: 'calc', num: true, uses: ['base', 'adj'], calc: 'so-upcharge', formula: 'Base ± Upcharge/Discount' },
        { key: 'kind', label: 'Kind', type: 'calc' },
      ], rows: SO_UPCHARGE_SCENARIOS.map((x) => ({ level: x.level, base: x.base, adj: x.adj, final: x.final, kind: x.kind })) },
      { id: 'desync', title: 'Desync walk-through', cols: [
        { key: 'step', label: 'Step', type: 'key' }, { key: 'costSheet', label: 'Cost Sheet / BOM Price', type: 'copied', num: true },
        { key: 'oc', label: 'OC Selling Price', type: 'entered', calc: 'so-desync' }, { key: 'state', label: 'State', type: 'calc', calc: 'so-desync', formula: 'Desynced when OC price ≠ cost sheet price' },
      ], rows: SO_DESYNC_STEPS.map((x) => ({ step: x.step, costSheet: x.costSheet, oc: x.oc, state: x.state })) },
      { id: 'subtotal', title: 'Sub Total on print and proforma invoice', cols: [
        { key: 'delivery', label: 'Delivery', type: 'key' }, { key: 'value', label: 'Value', type: 'copied', num: true }, { key: 'currency', label: 'Currency', type: 'copied' },
        { key: 'rate', label: 'Rate to order currency', type: 'entered', num: true },
        { key: 'subTotal', label: 'Sub Total (INR)', type: 'calc', num: true, uses: ['value', 'rate'], calc: 'so-subtotal', formula: 'Value × Rate' },
      ], rows: SO_SUBTOTAL.map((x) => ({ delivery: x.delivery, value: x.value, currency: x.currency, rate: Math.round(x.rate * 1e6) / 1e6, subTotal: x.subTotal })) },
      soRules('rules', 'Price sync rules', ['Price sync']),
    ],
  },
  {
    id: 'so-types', chapter: 'sales', name: 'Sales Order · Order types & transfer price', screen: 'Sales Order › Order Type / Fulfilment Type', theory: 'buyer-po',
    summary: 'Back Order, CM, Purchase and Make to Stock each create different follow-on documents. Purchase Demand turns manufactured quantity into bought quantity. Transfer Price orders run between an order company and an execution company.',
    header: [{ label: 'Rule', value: 'Parent-level change + MRP re-run changes the child indent', type: 'calc' }],
    grids: [
      { id: 'purchase-demand', title: 'Purchase Demand (Level 1 = 1,000)', cols: [
        { key: 'level1', label: 'Level 1 Style Qty', type: 'copied', num: true }, { key: 'pd', label: 'Purchase Demand', type: 'entered', num: true },
        { key: 'make', label: 'Manufacture Qty', type: 'calc', num: true, uses: ['level1', 'pd'], calc: 'so-purchase-demand', formula: 'Level 1 − Purchase Demand' },
        { key: 'finalCons', label: 'Final Consumption', type: 'copied', num: true, from: { doc: 'bom-58', col: 'finalCons' } },
        { key: 'material', label: 'Material Indent Qty', type: 'calc', num: true, uses: ['make', 'finalCons'], calc: 'so-purchase-demand', formula: '(Level 1 − Purchase Demand) × Final Consumption' },
        { key: 'result', label: 'Result', type: 'calc' },
      ], rows: SO_PURCHASE_DEMAND.map((x) => ({ level1: x.level1, pd: x.purchaseDemand, make: x.manufacture, finalCons: x.finalCons, material: x.materialIndent, result: x.result })) },
      soRules('rules', 'Order type and transfer price rules', ['Order types', 'Transfer price']),
    ],
  },
  {
    id: 'so-packing', chapter: 'sales', name: 'Sales Order · Packing & pieces', screen: 'Delivery › Article › Packing Type', theory: 'buyer-po',
    summary: 'Packing Type decides how the Color/Size popup works and how pieces are counted. Add Qty adds extra independent breakup grids for prepack cases.',
    header: [{ label: 'Open point', value: 'PCS = PP × Size and PCS = PP × TBA to be confirmed', type: 'calc' }],
    grids: [
      { id: 'types', title: 'Packing types', cols: [
        { key: 'type', label: 'Packing Type', type: 'key' }, { key: 'popup', label: 'Colour/Size popup', type: 'entered' }, { key: 'pp', label: 'PP column', type: 'entered' },
        { key: 'rule', label: 'Rule', type: 'entered' }, { key: 'pcs', label: 'Pieces', type: 'calc', calc: 'so-pack-pcs' }, { key: 'addQty', label: 'Add Qty tool', type: 'entered' },
      ], rows: SO_PACKING.map((x) => ({ type: x.type, popup: x.popup, pp: x.pp, rule: x.rule, pcs: x.pcs, addQty: x.addQty })) },
      { id: 'example', title: 'Solid Color / Assorted Size – example (to confirm)', cols: [
        { key: 'type', label: 'Packing Type', type: 'key' }, { key: 'ratioS', label: 'PP S', type: 'entered', num: true }, { key: 'ratioM', label: 'PP M', type: 'entered', num: true },
        { key: 'ratioL', label: 'PP L', type: 'entered', num: true }, { key: 'packs', label: 'Packs', type: 'entered', num: true },
        { key: 'pcs', label: 'PCS', type: 'calc', num: true, uses: ['ratioS', 'ratioM', 'ratioL', 'packs'], calc: 'so-pack-pcs', formula: '(PP S + PP M + PP L) × Packs' },
      ], rows: SO_PACKING_EXAMPLE.map((x) => ({ type: x.type, ratioS: x.ratioS, ratioM: x.ratioM, ratioL: x.ratioL, packs: x.packs, pcs: x.pcs })) },
    ],
  },
  {
    id: 'so-other', chapter: 'sales', name: 'Sales Order · Dates, TNA, EDI & others', screen: 'Sales Order list · Sales › Codes', theory: 'buyer-po',
    summary: 'Ex-factory days fill the OC delivery date, TNA templates are attached per order or style, EDI Buyer PO imports orders through mapped packages, and flex fields and block booking extend the order.',
    header: [{ label: 'Ex-factory', value: 'OC Delivery Date = Buyer Delivery Date − days', type: 'calc' }],
    grids: [
      { id: 'exfactory', title: 'Ex-factory days', cols: [
        { key: 'buyerDate', label: 'Buyer Delivery Date', type: 'entered' }, { key: 'days', label: 'Ex-factory days', type: 'copied', num: true },
        { key: 'ocDate', label: 'OC Delivery Date', type: 'calc', uses: ['buyerDate', 'days'], calc: 'so-ex-factory', formula: 'Buyer Delivery Date − days' },
      ], rows: SO_EX_FACTORY.map((x) => ({ buyerDate: x.buyerDate, days: x.days, ocDate: x.ocDate })) },
      soRules('rules', 'Dates, TNA, EDI and other rules', ['Dates', 'TNA', 'EDI', 'Other']),
    ],
  },

];

export const docById = (id: string) => DOCS.find((d) => d.id === id);

/** Columns in other documents that take a value from this document. */
export function consumers(docId: string) {
  const out: { doc: Doc; grid: Grid; col: Col }[] = [];
  for (const d of DOCS) for (const g of d.grids) for (const c of g.cols) if (c.from?.doc === docId && d.id !== docId) out.push({ doc: d, grid: g, col: c });
  return out;
}

// Colour / size dependency of the Adi TShirt (NIS-59) BOM lines, traced from the masters.
// Source: the Color Dependency and Size Dependency popups of BOM #1 DP, line N-8 (Finished_FABRIC),
// both dependency type [Table]. Trim lines: only what the Cost tab shows (garment colour = material colour
// for BALSAM TREE and Cosmic sky purple; Small S on the Materials tab).
// ─────────────────────────────────────────────────────────────────────────────

/** mapped = material colour/size chosen · not-used = shown as [Not Used] · not-captured = popup not captured for this line
 *  not-on-article = the master value is not in the article's base list. */
export type DepStatus = 'mapped' | 'not-used' | 'not-captured' | 'not-on-article';
export interface DepRow { code: string; label: string; hex?: string; onArticle: boolean; material: string | null; materialHex?: string; status: DepStatus; }
export interface Dependency {
  kind: 'color' | 'size';
  article: string;
  articleName: string;
  type: string;
  master: string;
  masterCount: number;
  rows: DepRow[];
  complete: boolean;
  note: string;
  shot?: Shot;
}

/** Base list of Adi TShirt (NIS-59) as shown in the dependency popups. */
const ARTICLE_COLOURS = ['372', '3909', '475'];
const ARTICLE_SIZES = SIZES.map((z) => z.code); // all 7 sizes of ERPSIZE

/** Mapping per BOM line article: garment code → material code (null = [Not Used]). Missing article = popup not captured. */
const COLOUR_DEP: Record<string, Record<string, string | null>> = {
  'N-8': { '372': '372', '3909': '3909', '475': '475' },
};
const SIZE_DEP: Record<string, Record<string, string | null>> = {
  'N-8': { '34S': '34S', '38M': '38M', '42L1': '42L1', '46XL': null, '50XXL': null, '22/10': null, 'TBA': null },
};
/** Seen on other screens for the trim lines (Cost tab colour columns, Materials tab size cell). */
const TRIM_COLOURS_SEEN: Record<string, string> = { '372': '372', '3909': '3909' };
const TRIM_SIZES_SEEN: Record<string, string> = { '34S': '34S' };

export function dependencyFor(kind: 'color' | 'size', article: string, articleName = ''): Dependency {
  const full = kind === 'color' ? COLOUR_DEP[article] : SIZE_DEP[article];
  const seen = kind === 'color' ? TRIM_COLOURS_SEEN : TRIM_SIZES_SEEN;
  const onList = kind === 'color' ? ARTICLE_COLOURS : ARTICLE_SIZES;
  const status = (code: string): { material: string | null; status: DepStatus } => {
    if (!onList.includes(code)) return { material: null, status: 'not-on-article' };
    if (full) {
      const m = full[code];
      return m ? { material: m, status: 'mapped' } : { material: null, status: 'not-used' };
    }
    return seen[code] ? { material: seen[code], status: 'mapped' } : { material: null, status: 'not-captured' };
  };
  const rows: DepRow[] = kind === 'color'
    ? COLORS.map((c) => {
        const s = status(c.code);
        const m = s.material ? COLORS.find((x) => x.code === s.material) : undefined;
        return { code: c.code, label: `${c.name} (${c.code})`, hex: c.hex, onArticle: onList.includes(c.code), material: m ? `${m.name} (${m.code})` : null, materialHex: m?.hex, status: s.status };
      })
    : SIZES.map((z) => {
        const s = status(z.code);
        const m = s.material ? SIZES.find((x) => x.code === s.material) : undefined;
        return { code: z.code, label: z.display, onArticle: onList.includes(z.code), material: m ? m.display : null, status: s.status };
      });
  const isFabric = article === 'N-8';
  const note = kind === 'color'
    ? (isFabric
      ? 'Color Dependency popup, line N-8: Adi TShirt has 3 colours and each uses the same fabric colour. The routing "Used For" also lists Light Green and True Black, but they are not in the BOM colour dependency, so they generate no fabric demand.'
      : 'The Color Dependency popup for this trim line was not captured. The Cost tab shows BALSAM TREE → BALSAM TREE and Cosmic sky purple → Cosmic sky purple on every line.')
    : (isFabric
      ? 'Size Dependency popup, line N-8: all 7 ERPSIZE sizes are on the article; Small, Medium and Large L1 use the same fabric size, the others are [Not Used] – no fabric is planned for them.'
      : 'The Size Dependency popup for this trim line was not captured. The Materials tab shows Small S (34S).');
  return {
    kind, article, articleName, type: 'Table',
    master: kind === 'color' ? 'Colour Card · Nis_colors' : 'Size Range · ERPSIZE',
    masterCount: kind === 'color' ? COLORS.length : SIZES.length,
    rows, complete: !!full, note,
    shot: isFabric ? (kind === 'color'
      ? shot('bom-colour-dependency-n8', 'WFX Color Dependency popup for BOM #1 DP line N-8: BALSAM TREE, Cosmic sky purple and Happy Pink mapped to the same fabric colours')
      : shot('bom-size-dependency-n8', 'WFX Size Dependency popup for BOM #1 DP line N-8: Small, Medium and Large L1 mapped, other sizes Not Used')) : undefined,
  };
}

/** Values that mean "nothing filled in" – used to hide empty columns. */
export const EMPTY_VALUES = new Set<Cell>([0, '', '—', '[Select]', '0.0000', '0.00']);
