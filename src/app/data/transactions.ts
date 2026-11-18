import type { Transaction } from './types';
import { TXN_INDEX, COLORS, SIZES } from './catalog';
import {
  ADHOC_INDENT, BBB_MATERIAL, FPO_ALLOC, FPO_QTY, GRN, MRP_L1, MRP_L2, OC_BREAKUP,
  PROD_INDENT_L2, PROD_ORDER_COLOR, RMPO_1229, RMPO_1230, ROUTING_PROCESSES, STYLE_COLORS, BOM_COLOR_DEP, BOM_SIZE_DEP,
  BOM_59, COSTING_59, RM_59, ROUTING_59, STYLE_59,
} from './records';

const idx = (slug: string) => {
  const e = TXN_INDEX.find((t) => t.slug === slug);
  if (!e) throw new Error(`Unknown transaction ${slug}`);
  return { slug: e.slug, step: e.step, name: e.name, module: e.module, description: e.description };
};
const sizeName = (code: string) => SIZES.find((s) => s.code === code)?.display ?? code;
const sum = (n: number[]) => Math.round(n.reduce((a, b) => a + b, 0) * 100) / 100;

export const TRANSACTIONS: Transaction[] = [
  // 1 ────────────────────────────────────────────────────────────────
  {
    ...idx('masters'),
    screen: 'Setup › Colour Card / Size Range / UOM',
    theory: [
      'Masters are the shared vocabulary of WFX. A colour card groups colour codes; a size range groups size codes; the UOM master lists units, and the UOM conversion table says how one unit converts to another for a specific material.',
      'Nothing in a transaction can use a colour, size or unit that is not in a master. Styles pick a colour card and size range, and every downstream line (BOM, booking, OC, MRP, FPO) carries the same codes, which is what lets you trace one colour from design to the factory floor.',
    ],
    keys: [
      { name: 'Colour', format: 'Colour Code (inside a Colour Card)', example: '372 in Nis_colors' },
      { name: 'Size', format: 'Size Code (inside a Size Range)', example: '34S in ERPSIZE' },
      { name: 'UOM Conversion', format: 'Article Code | From UOM | To UOM', example: 'N-8|KG_Nis|meter' },
    ],
    upstream: [],
    downstream: [
      { slug: 'apparel-style', what: 'Base colour list and base size list' },
      { slug: 'bom-materials', what: 'UOM conversion factor (Cons UOM Price)' },
      { slug: 'buyer-block-booking', what: 'Colour and size on material lines' },
      { slug: 'buyer-po', what: 'Colour × size quantity breakup' },
    ],
    fieldGroups: [
      { title: 'Colour Master', fields: [
        { name: 'Color Code', kind: 'key', definition: 'Unique code of the colour within its colour card.' },
        { name: 'Color Name', kind: 'entered', definition: 'Display name shown with the code everywhere, e.g. "BALSAM TREE (372)".' },
        { name: 'Color Card', kind: 'entered', definition: 'The palette the colour belongs to. A style or material can only use colours of its own colour card.' },
      ] },
      { title: 'Size Master', fields: [
        { name: 'Size Code', kind: 'key', definition: 'Unique size code in the size range.' },
        { name: 'Size Name', kind: 'entered', definition: 'Readable size name.' },
        { name: 'Display Name', kind: 'calculated', definition: 'Size Name + (Size Code), e.g. "Small S (34S)".' },
      ] },
      { title: 'UOM Conversion', fields: [
        { name: 'From UOM / To UOM', kind: 'entered', definition: 'Units being converted. Both must exist in the UOM master.' },
        { name: 'Factor', kind: 'entered', definition: 'How many To-UOM units make one From-UOM unit. 1 KG_Nis = 1,000 meter for N-8.' },
      ] },
    ],
    calcs: [],
    checks: [],
    tables: [
      { title: 'Colour Master – Nis_colors', columns: ['Color Code', 'Color Name', 'Color Card'], colorCol: 0,
        rows: COLORS.map((c) => [c.code, c.name, 'Nis_colors']) },
      { title: 'Size Master – ERPSIZE', columns: ['Size Code', 'Size Name', 'Display Name'],
        rows: SIZES.map((s) => [s.code, s.name, s.display]) },
      { title: 'UOM Master & Conversion', columns: ['Article', 'From UOM', 'To UOM', 'Factor', 'Remarks'],
        rows: [['N-8', 'KG_Nis', 'meter', 1000, 'Back-calculated from BOM: Cons UOM Price 15,000 ÷ Purchase Price 15. Not maintained on the RM techpack.']] },
    ],
    cases: [
      { kind: 'mismatch', title: 'Conversion lives in the BOM, not the RM techpack',
        body: 'The RM techpack for N-8 shows Secondary UOM Conversion = 0, while the BOM uses 1,000. The factor had to be back-calculated from the BOM price. Keep the conversion on the material master so every transaction reads the same value.' },
    ],
  },
  // 2 ────────────────────────────────────────────────────────────────
  {
    ...idx('apparel-style'),
    screen: 'Product Development › Apparel Techpack',
    theory: [
      'The style (apparel techpack) is the finished-goods article. It fixes the buyer, department, colour card and size range, and lists which of those colours and sizes the style is offered in (base colour list, base size list).',
      'The base lists are the "rows" that the BOM dependency maps from: every style colour must be mapped to a material colour or explicitly left as Not Used.',
    ],
    keys: [{ name: 'Article Code', format: 'Style code', example: 'NIS-58' }],
    upstream: [{ slug: 'masters', what: 'Colour card Nis_colors and size range ERPSIZE' }],
    downstream: [
      { slug: 'bom-materials', what: 'BOM header (article) and colour/size dependency rows' },
      { slug: 'buyer-block-booking', what: 'Buyer and buyer department' },
      { slug: 'buyer-po', what: 'Style, buyer, department and UOM on the OC' },
      { slug: 'mrp', what: 'Article code and name of Level 1 demand' },
    ],
    fieldGroups: [
      { title: 'Detail', fields: [
        { name: 'Article Code', kind: 'key', definition: 'Style code. Flannel Shirt Adi (NIS-58).' },
        { name: 'Article Name', kind: 'entered', definition: 'Flannel Shirt Adi.' },
        { name: 'Buyer / Buyer Department', kind: 'entered', definition: 'GAP Kids / Kids-Tops-Knits. Copied to booking and OC.' },
        { name: 'Color Card', kind: 'entered', definition: 'Nis_colors – limits which colours the style may use.' },
        { name: 'Size/Width Range', kind: 'entered', definition: 'ERPSIZE – limits which sizes the style may use.' },
        { name: 'Purchase UOM', kind: 'entered', definition: 'PCS. The UOM the garment is ordered and planned in.' },
        { name: 'Price Per', kind: 'entered', definition: 'Color/Size – price can differ by colour and size.' },
        { name: 'Color Definition', kind: 'entered', definition: 'Single Colors – each garment colour is one solid colour.' },
      ] },
      { title: 'Base Colour List', fields: [
        { name: 'Color Code', kind: 'linked', from: 'masters', fromField: 'Colour Master', definition: 'Colour offered on the style.' },
        { name: 'Sort Order / In-Active', kind: 'entered', definition: 'Display order and whether the colour is blocked for new orders.' },
      ] },
    ],
    calcs: [],
    checks: [],
    tables: [
      { title: 'Base Colour List', columns: ['Color Code', 'Color Name', 'In-Active'], colorCol: 0,
        rows: STYLE_COLORS.map((c) => [c, COLORS.find((x) => x.code === c)!.name, 'No']) },
      { title: 'Adi TShirt (NIS-59) – techpack header (live WFX)', columns: ['Field', 'Value', 'How it is set'],
        rows: [
          ['Article Code / Name', `${STYLE_59.code} · ${STYLE_59.name}`, 'Code from system coding, name typed'],
          ['Article Description', STYLE_59.description, 'Typed'],
          ['Buyer / Department', `${STYLE_59.buyer} · ${STYLE_59.dept}`, 'Selected'],
          ['Division', STYLE_59.division, 'Selected'],
          ['Product Group / Sub-Category', `${STYLE_59.productGroup} · ${STYLE_59.subCategory}`, 'Selected (sub-category mandatory)'],
          ['Purchase UOM', STYLE_59.purchaseUom, 'Selected (mandatory)'],
          ['Color Card / Size Range', `${STYLE_59.colorCard} · ${STYLE_59.sizeRange}`, 'From colour and size masters'],
          ['Price Per', STYLE_59.pricePer, 'Selected'],
          ['Color Definition / Style Type', `${STYLE_59.colorDefinition} · ${STYLE_59.styleType}`, 'Read-only (from material type)'],
        ] },
      { title: 'Base Size List', columns: ['Size Code', 'Size'],
        rows: ['34S', '38M', '42L1', '46XL', '50XXL', '22/10', 'TBA'].map((s) => [s, sizeName(s)]) },
    ],
    cases: [
      { kind: 'rule', title: 'Colour must be on the style before it can be ordered',
        body: 'The OC colour × size breakup offers only base-list colours. TBA is in the colour card but not on the style, so it can never reach an order for Flannel Shirt Adi (NIS-58).' },
    ],
  },
  // 3 ────────────────────────────────────────────────────────────────
  {
    ...idx('bom-materials'),
    screen: 'Product Development › BOM › Materials',
    theory: [
      'The Bill of Materials lists every raw material needed to make one garment. Each line says which material, how much of it per garment (consumption), what allowances are added (wastage, loss, shrinkage), what it costs, and – through dependency – which material colour/size is used for each garment colour/size.',
      'Final Consumption is the single most important number on the BOM: MRP multiplies garment quantity by it to get fabric demand, and FPO multiplies factory quantity by it to get fabric to issue.',
      'Price is entered per Purchase UOM (what the supplier invoices) and converted to Cons UOM (what the garment consumes) using the material UOM conversion.',
    ],
    keys: [
      { name: 'BOM ID', format: 'Article | BOM Name | Version', example: 'NIS-58|#1 DP|V1' },
      { name: 'BOM Line ID', format: 'BOM ID | Line', example: 'NIS-58|#1 DP|V1|1' },
    ],
    upstream: [
      { slug: 'apparel-style', what: 'Article, base colours and base sizes' },
      { slug: 'rm-techpack', what: 'Material article N-8, Cons UOM, buying price' },
      { slug: 'masters', what: 'UOM conversion factor 1,000' },
    ],
    downstream: [
      { slug: 'bom-routing', what: 'Material linkage to a process' },
      { slug: 'bom-costing', what: 'Material cost by section' },
      { slug: 'buyer-po', what: 'BOM selected on the delivery OC' },
      { slug: 'mrp', what: 'Final Consumption and dependency for BOM explosion' },
      { slug: 'production-indents', what: 'Cons, wastage, CSV and price on the fabric indent' },
      { slug: 'fpo', what: 'Final Consumption for fabric requirement' },
    ],
    fieldGroups: [
      { title: 'BOM Header', fields: [
        { name: 'Article Code', kind: 'linked', from: 'apparel-style', fromField: 'Article Code', definition: 'Style the BOM belongs to.' },
        { name: 'BOM Name / Type / Version', kind: 'entered', definition: '#1 DP, Production BOM, V1. Together with article they form the BOM ID.' },
        { name: 'Order Qty – Expected', kind: 'entered', definition: 'Planning quantity (34,000 PCS) used for costing estimates; does not drive MRP.' },
      ] },
      { title: 'Material line – quantity', fields: [
        { name: 'Article Code', kind: 'linked', from: 'rm-techpack', fromField: 'Article Code', definition: 'Raw material used (N-8 Finished_FABRIC).' },
        { name: 'Purchase UOM / Cons UOM', kind: 'entered', definition: 'meter / KG_Nis. Bought per meter, consumed per KG_Nis.' },
        { name: 'Color Dependency / Size Dependency', kind: 'entered', definition: '"Table": each style colour/size is mapped individually to a material colour/size.' },
        { name: 'Total Cons Qty', kind: 'entered', definition: 'Material needed for "Cons per Item" garments (3 KG_Nis).' },
        { name: 'Cons per Item', kind: 'entered', definition: 'Number of garments Total Cons Qty covers (2).' },
        { name: 'Cons Qty', kind: 'calculated', calc: 'bom-cons-qty', definition: 'Net consumption for one garment.' },
        { name: 'Wastage %', kind: 'entered', definition: 'Planned cutting/marker wastage.' },
        { name: 'Loss %', kind: 'entered', definition: 'Process loss (dyeing, finishing, handling). Applied first, as 1 ÷ (1 − Loss %).' },
        { name: 'Shrinkage %', kind: 'entered', definition: 'Expected shrinkage after wash/finishing. Applied last, as a division by (1 − Shrinkage %).' },
        { name: 'Cons incl Loss', kind: 'calculated', calc: 'bom-cons-loss', definition: 'Cons Qty × 1 ÷ (1 − Loss %).' },
        { name: 'Cons incl Wastage', kind: 'calculated', calc: 'bom-cons-wastage', definition: 'Cons incl Loss plus Wastage % of it.' },
        { name: 'Cons incl Shrinkage', kind: 'calculated', calc: 'bom-cons-shrinkage', definition: 'Cons incl Wastage ÷ (1 − Shrinkage %).' },
        { name: 'Final Consumption', kind: 'calculated', calc: 'bom-final-cons', definition: 'The total consumption per garment, the last figure of the chain, used by MRP and FPO.' },
      ] },
      { title: 'Material line – price', fields: [
        { name: 'CSV', kind: 'entered', definition: 'Customer Supplied Value – value of material the buyer supplies free of charge.' },
        { name: 'Supplier / Currency / Delivery Terms', kind: 'entered', definition: 'GAP Kids_Nis, INR, C & F.' },
        { name: 'Purchase Price', kind: 'entered', definition: 'Price per Purchase UOM (15 INR per meter).' },
        { name: 'Conversion Factor', kind: 'linked', from: 'masters', fromField: 'UOM Conversion', definition: 'Purchase-to-Cons UOM factor (1,000).' },
        { name: 'Cons UOM Price', kind: 'calculated', calc: 'bom-cons-uom-price', definition: 'Price per Cons UOM.' },
        { name: 'Value / Value (CS Curr)', kind: 'calculated', calc: 'bom-value', definition: 'Cost of the line per garment.' },
      ] },
    ],
    calcs: ['bom-cons-qty', 'bom-loss-factor', 'bom-cons-loss', 'bom-cons-wastage', 'bom-cons-shrinkage', 'bom-final-cons', 'bom-cons-uom-price', 'bom-value', 'bom-value-cs', 'bom-dependency'],
    checks: [
      { label: 'Cons Qty', workbook: 1.5, wfx: 1.5, match: true },
      { label: 'Final Consumption', workbook: 1.5, wfx: 1.5, match: true },
      { label: 'Cons UOM Price', workbook: 15000, wfx: 15000, match: true },
      { label: 'Value', workbook: 22500, wfx: 22500, match: true },
      { label: 'Adi TShirt (NIS-59) N-8 Cons incl Wastage (1.5 × 10 % + 1.5)', workbook: 1.65, wfx: 1.65, match: true },
      { label: 'Adi TShirt (NIS-59) T-1 Cons incl Wastage (2 × 2 % + 2)', workbook: 2.04, wfx: 2.04, match: true },
      { label: 'Adi TShirt (NIS-59) N-8 Value (1.65 × 15,000)', workbook: 24750, wfx: 24750, match: true },
      { label: 'Adi TShirt (NIS-59) trims value (20.40 + 16.32 + 4.00)', workbook: 40.72, wfx: 40.72, match: true },
    ],
    tables: [
      { title: 'Adi TShirt (NIS-59) Materials tab – quantity (live WFX)', columns: ['Line', 'Section', 'Article', 'Purchase UOM', 'Cons UOM', 'Total Cons', 'Per Item', 'Cons Qty', 'Wastage %', 'Incl Wastage', 'Loss %', 'Final Cons'],
        rows: BOM_59.map((l) => [l.line, l.section, `${l.article} ${l.name}`, l.purchaseUom, l.consUom, l.totalCons, l.perItem, l.wfx.consQty, l.wastagePct, l.wfx.inclWastage, l.lossPct, l.wfx.finalCons]) },
      { title: 'Adi TShirt (NIS-59) Materials tab – price (live WFX)', columns: ['Line', 'Article', 'Supplier', 'Purchase Price', 'Factor', 'Cons UOM Price', 'Value (INR)'],
        rows: BOM_59.map((l) => [l.line, l.article, l.supplier, l.purchasePrice, l.conversion, l.wfx.consUomPrice, l.wfx.value]) },
      { title: 'Dependency – Colour (style colour → material colour)', columns: ['Style Color', 'Material Color', 'Used'], colorCol: 0,
        rows: Object.entries(BOM_COLOR_DEP).map(([c, m]) => [c, m ? `${COLORS.find((x) => x.code === m)!.name} (${m})` : '[Not Used]', m ? 'Yes' : 'No']) },
      { title: 'Dependency – Size (style size → material size)', columns: ['Style Size', 'Material Size', 'Used'],
        rows: Object.entries(BOM_SIZE_DEP).map(([s, m]) => [sizeName(s), m ?? '[Not Used]', m ? 'Yes' : 'No']) },
    ],
    cases: [
      { kind: 'observation', title: 'Dependency covers more than the order',
        body: 'Three colours (372, 3909, 475) and three sizes (34S, 38M, 42L1) are mapped, but the OC only orders 372 and 3909 in 34S and 38M. Mapping is a capability, not a demand – MRP only explodes what is ordered.' },
      { kind: 'rule', title: 'No UOM conversion maintained → factor 1 (default)',
        body: 'Adi TShirt (NIS-59) line 2 (T-1) is bought in PCS and consumed in meter. No PCS→meter conversion is maintained, so WFX uses the default factor 1: Cons UOM Price = Purchase Price (10 = 10). Maintain a material-wise UOM conversion when the units really differ (e.g. metres per cone).' },
      { kind: 'mismatch', title: 'Purchase UOM differs from the RM techpack',
        body: 'BOM purchase UOM is meter while the RM techpack says KG_Nis. Indents and POs followed the techpack (KG_Nis), while the BOM price is per meter. Check which UOM the supplier really invoices.' },
    ],
  },
  // 4 ────────────────────────────────────────────────────────────────
  {
    ...idx('bom-routing'),
    screen: 'Product Development › BOM › Routing',
    theory: [
      'Routing is the ordered list of production processes that turn materials into the garment. Each process has an output item, the process it follows, and a rate. Operations break a process into machine-level steps with time.',
      'Material linkage tells WFX which process consumes a BOM material – fabric N-8 is required for VCutting. This is why the Level 2 production indent shows "Required For: VCutting".',
    ],
    keys: [
      { name: 'Routing ID', format: 'BOM ID | R<no>', example: 'NIS-58|#1 DP|V1|R1' },
      { name: 'Process ID', format: 'Routing ID | Seq', example: 'NIS-58|#1 DP|V1|R1|2' },
    ],
    upstream: [{ slug: 'bom-materials', what: 'BOM ID and material lines for linkage' }],
    downstream: [
      { slug: 'bom-costing', what: 'Process rates → Production Cost' },
      { slug: 'production-indents', what: '"Required For" process on the fabric indent' },
      { slug: 'fpo', what: 'Processes of the FPPO' },
    ],
    fieldGroups: [
      { title: 'Processes', fields: [
        { name: 'Seq / Production Process', kind: 'entered', definition: 'Order and name of the process.' },
        { name: 'Output Item', kind: 'entered', definition: 'Semi-finished output (Cut PCS, Sew PCS).' },
        { name: 'After Process', kind: 'entered', definition: 'Process that must finish first.' },
        { name: 'After Process Valid?', kind: 'calculated', calc: 'routing-after-valid', definition: 'Checks the predecessor exists earlier in the routing.' },
        { name: 'Process Rate', kind: 'calculated', calc: 'routing-process-rate', definition: 'Cost per piece for the process = Cost Of × Production Time from the Operations tab; summed into Production Cost.' },
      ] },
      { title: 'Operations', fields: [
        { name: 'Efficiency %', kind: 'entered', definition: 'Operation efficiency, left at its default (0 %); it does not change the process rate. Target Production Efficiency % is 100 % on the routing.' },
        { name: 'Cost Of', kind: 'entered', definition: 'Default cost rate of the sub-operation per unit of production time (3.00 for VCutting).' },
        { name: 'Operation / Sub Operation', kind: 'entered', definition: 'From the operation library (VCutting, Sewing, VPacking).' },
        { name: 'Machine Sub Category', kind: 'entered', definition: 'Machine used (MD Electronics-Laptops, Mobile-Vivo).' },
        { name: 'Loss % / Cost per Qty', kind: 'entered', definition: 'Operation loss and fixed cost per qty (0 on Adi TShirt (NIS-59)).' },
        { name: 'Total Time / Production Time', kind: 'entered', definition: 'Time of the operation (100 for VCutting, 5 for Sewing and VPacking).' },
      ] },
      { title: 'Material Linkage', fields: [
        { name: 'Linked Process', kind: 'entered', definition: 'Process that consumes the BOM material.' },
        { name: 'Colors Used / Sizes Used', kind: 'calculated', definition: 'Count of "Used" rows in the BOM dependency (3 / 3).' },
      ] },
    ],
    calcs: ['routing-after-valid', 'routing-process-rate', 'routing-linkage'],
    checks: [],
    tables: [
      { title: 'Processes', columns: ['Seq', 'Process', 'Code', 'Output', 'After', 'Rate', 'Total Time'],
        rows: ROUTING_PROCESSES.map((p) => [p.seq, p.process, p.code, p.output || '—', p.after || 'First process', p.rate, p.time]) },
      { title: 'Adi TShirt (NIS-59) Operations tab → Process Rate (live WFX)', columns: ['Process', 'Operation', 'Machine', 'Efficiency %', 'Cost Of', 'Production Time', 'Cost Of × Time', 'Process Rate (WFX)'],
        rows: ROUTING_59.map((p) => [p.process, p.operation, p.machine, p.efficiencyPct, p.costOf, p.productionTime, p.costOf * p.productionTime, p.wfxRate]) },
      { title: 'Adi TShirt (NIS-59) Material Linkage tab', columns: ['Line', 'Article', 'Cons UOM', 'Wastage %', 'Cons Qty', 'Incl Wastage & Loss', 'Linked Process'],
        rows: BOM_59.map((l) => [l.line, `${l.article} ${l.name}`, l.consUom, l.wastagePct, l.wfx.consQty, l.wfx.finalCons, l.process]) },
    ],
    cases: [
      { kind: 'rule', title: 'Every routing process becomes an FPPO',
        body: 'When the FPO is released, each of VCutting, Sewing and VPacking receives the full FPO quantity per colour/size as Required Qty.' },
    ],
  },
  // 5 ────────────────────────────────────────────────────────────────
  {
    ...idx('bom-costing'),
    screen: 'Product Development › BOM › Cost',
    theory: [
      'Costing rolls up the BOM into a per-piece cost and compares it with the selling price. Material cost comes from BOM line values grouped by section; production cost comes from routing process rates.',
      'Profit % = (selling price after discount − total cost) ÷ selling price after discount. Markup % = (selling price before discount − total cost) ÷ total cost. Adi TShirt (NIS-59): −597.66 % and −84.07 %.',
    ],
    keys: [{ name: 'BOM ID', format: 'Article | BOM Name | Version', example: 'NIS-58|#1 DP|V1' }],
    upstream: [
      { slug: 'bom-materials', what: 'Line Value (CS Curr) by section' },
      { slug: 'bom-routing', what: 'Process rates' },
    ],
    downstream: [],
    fieldGroups: [
      { title: 'Cost Summary (per piece)', fields: [
        { name: 'Material Cost', kind: 'calculated', calc: 'cost-material', definition: 'Sum of section totals.' },
        { name: 'Production Cost', kind: 'calculated', calc: 'cost-production', definition: 'Sum of process rates.' },
        { name: 'Recipe / Indirect / CM Costs', kind: 'entered', definition: 'Other cost buckets added to the total.' },
        { name: 'Total Cost', kind: 'calculated', calc: 'cost-total', definition: 'Full cost per piece.' },
        { name: 'Selling Price / Discount %', kind: 'entered', definition: 'Price the apparel is actually sold at (NIS-59: 4,000, locked) and the discount as a % of it (10 % = 400).' },
        { name: 'Net Selling Price', kind: 'calculated', calc: 'cost-net-selling', definition: 'Selling price after discount.' },
        { name: 'Profit / Profit % / Markup %', kind: 'calculated', calc: 'cost-profit', definition: 'Margin results.' },
        { name: 'Target Profit %', kind: 'entered', definition: 'Target margin shown next to Profit (21 %).' },
      ] },
    ],
    calcs: ['cost-section', 'cost-material', 'cost-production', 'cost-total', 'cost-net-selling', 'cost-profit', 'cost-profit-pct', 'cost-markup-pct'],
    checks: [
      { label: 'Total Cost', workbook: 22825, wfx: 22825, match: true },
      { label: 'Profit', workbook: -19825, wfx: -19825, match: true },
      { label: 'Profit %', workbook: -6.6083, wfx: -6.6083, match: true },
      { label: 'Markup %', workbook: -0.8686, wfx: -0.8686, match: true },
      { label: 'Adi TShirt (NIS-59) Total Cost', workbook: 25115.72, wfx: 25115.72, match: true },
      { label: 'Adi TShirt (NIS-59) Discount (4,000 × 10 %)', workbook: 400, wfx: 400, match: true },
      { label: 'Adi TShirt (NIS-59) Profit (3,600 − 25,115.72)', workbook: -21515.72, wfx: -21515.72, match: true },
      { label: 'Adi TShirt (NIS-59) Profit %', workbook: '−597.66 %', wfx: '−597.66 %', match: true },
      { label: 'Adi TShirt (NIS-59) Markup (4,000 − 25,115.72)', workbook: -21115.72, wfx: -21115.72, match: true },
      { label: 'Adi TShirt (NIS-59) Markup %', workbook: '−84.07 %', wfx: '−84.07 %', match: true },
    ],
    tables: [
      { title: 'Adi TShirt (NIS-59) cost summary (live WFX)', columns: ['Item', 'Value (INR)', 'How'],
        rows: [
          ['Fabric section', COSTING_59.wfx.fabricTotal, 'N-8 1.65 × 15,000'],
          ['Trim section', COSTING_59.wfx.trimTotal, '20.40 + 16.32 + 4.00'],
          ['Production cost', 325, 'VCutting 300 + Sewing 10 + VPacking 15'],
          ['Total cost', COSTING_59.wfx.totalCost, 'Material + production'],
          ['Selling price', COSTING_59.sellingPrice, 'Entered, locked'],
          ['Discount', COSTING_59.wfx.discountAmt, '10 % of selling price'],
          ['Profit', COSTING_59.wfx.profit, '3,600 − 25,115.72 → −597.66 % of net selling'],
          ['Markup', COSTING_59.wfx.markup, '4,000 − 25,115.72 → −84.07 % of total cost'],
        ] },
      { title: 'Materials by section', columns: ['Section', 'Total Cost', 'Budget', 'Additional Cost'],
        rows: [['Fabric Section', 22500, 0, 0], ['Service', 0, 0, 0], ['Yarn Category', 0, 0, 0], ['Misc Section', 0, 0, 0], ['Trim Section', 0, 0, 0]] },
      { title: 'Production cost', columns: ['Process', 'Basis', 'Currency', 'Value'],
        rows: [['VCutting', 'Amount', 'INR', 300], ['VPacking', 'Amount', 'INR', 15], ['Sewing', 'Amount', 'INR', 10]] },
    ],
    cases: [
      { kind: 'rule', title: 'Profit uses the discounted price, Markup does not',
        body: 'Adi TShirt (NIS-59): Profit = 4,000 − 10 % − 25,115.72 = −21,515.72 (−597.66 % of 3,600). Markup = 4,000 − 25,115.72 = −21,115.72 (−84.07 % of cost). The 400 difference is exactly the discount.' },
      { kind: 'observation', title: 'Costing is in INR, the OC is in USD',
        body: 'Costing selling price is 3,000 INR while the OC selling price is 33.3333 USD per piece. Costing does not read the OC price; keep them aligned manually or through the costing-sheet currency.' },
    ],
  },
  // 6 ────────────────────────────────────────────────────────────────
  {
    ...idx('rm-techpack'),
    screen: 'Product Development › Raw Material Techpack (Textile/Fabric)',
    theory: [
      'The raw-material techpack is the master of a purchasable material. It defines UOMs (consumption, purchase, storage, secondary), the colour card, how the material depends on garment colour/size, and default buying price.',
      'Material Dependency = ColorSize means stock and demand are kept per colour and size, which is why the stock key is Article|Colour|Size (e.g. N-8|372|34S).',
    ],
    keys: [
      { name: 'Article Code', format: 'Material code', example: 'N-8' },
      { name: 'Stock Key', format: 'Article | Colour | Size', example: 'N-8|372|34S' },
    ],
    upstream: [{ slug: 'masters', what: 'Colour card and size range' }],
    downstream: [
      { slug: 'bom-materials', what: 'Material line article, UOM' },
      { slug: 'buyer-block-booking', what: 'Material on booking lines' },
      { slug: 'adhoc-indent', what: 'Article and UOM on indent lines' },
      { slug: 'mrp', what: 'Article of Level 2 demand' },
    ],
    fieldGroups: [
      { title: 'Detail', fields: [
        { name: 'Article Code / Name', kind: 'key', definition: 'N-8 Finished_FABRIC.' },
        { name: 'Product Group / Sub-Category', kind: 'entered', definition: 'Knitted Fabric / Rib Fabric.' },
        { name: 'Consumption UOM', kind: 'entered', definition: 'KG_Nis – UOM used in BOM consumption.' },
        { name: 'Purchase UOM / Storage UOM', kind: 'entered', definition: 'KG_Nis / KG_Nis.' },
        { name: 'Secondary UOM Conversion', kind: 'entered', definition: '0 – not maintained (see case).' },
        { name: 'Material Dependency', kind: 'entered', definition: 'ColorSize – demand and stock tracked per colour and size.' },
        { name: 'Buying Price', kind: 'entered', definition: '15.' },
        { name: 'MOQ/Rounding Option', kind: 'entered', definition: 'Color – MOQ rounding is applied per colour.' },
        { name: 'Season', kind: 'entered', definition: 'Fall 2024.' },
      ] },
    ],
    calcs: [],
    checks: [
      { label: 'Consumption UOM = BOM Cons UOM', workbook: 'KG_Nis', wfx: 'KG_Nis', match: true },
      { label: 'Purchase UOM = BOM Purchase UOM', workbook: 'KG_Nis', wfx: 'meter', match: false },
      { label: 'Storage UOM = Purchase UOM', workbook: 'KG_Nis', wfx: 'KG_Nis', match: true },
      { label: 'Secondary UOM Conversion = Masters conversion', workbook: 0, wfx: 1000, match: false },
      { label: 'Purchase UOM = Indent UOM', workbook: 'KG_Nis', wfx: 'KG_Nis', match: true },
      { label: 'Season = BBB Season', workbook: 'Fall 2024', wfx: 'AW26', match: false },
      { label: 'Indent supplier (header) = RMPO supplier', workbook: 'NS_N1', wfx: 'GAP Kids_Nis', match: false },
      { label: 'Indent rate = RMPO price', workbook: 5, wfx: 10, match: false },
    ],
    tables: [
      { title: 'Raw materials used by Adi TShirt (NIS-59) (live WFX)', columns: ['Article', 'Name', 'Library', 'Type', 'Material Type', 'Cons UOM', 'Price Per', 'Bypass check on prod. GRN'],
        rows: RM_59.map((m) => [m.code, m.name, m.library, m.type, m.materialType, m.consUom, m.pricePer, m.bypass]) },
    ],
    cases: [
      { kind: 'observation', title: 'Trims are techpacks too',
        body: 'Sewing thread T-1, cufflinks NS1-1 and polybag PP-1 are each a Trims techpack with their own Consumption UOM and Price Per = Article. Unlike fabric N-8 they are not priced per colour/size.' },
      { kind: 'mismatch', title: 'Four cross-document mismatches',
        body: 'Purchase UOM (KG_Nis vs meter on BOM), conversion (0 vs 1,000), season (Fall 2024 vs AW26) and supplier/rate (NS_N1 at 5 on the indent vs GAP Kids_Nis at 10 on the RMPO). WFX allows each override, so they need review rather than a system fix.' },
    ],
  },
  // 7 ────────────────────────────────────────────────────────────────
  {
    ...idx('buyer-block-booking'),
    screen: 'Order › Buyer Block Booking',
    theory: [
      'A Buyer Block Booking (BBB) is a projection: the buyer signals expected volume before confirming styles. It lets sourcing reserve and buy long-lead material (fabric) early, by colour and size.',
      'Material bought against the booking is stocked with the booking number. When the confirmed OC arrives and MRP runs, that stock is adjusted in-house automatically, so only the gap is purchased again.',
    ],
    keys: [
      { name: 'Block Booking No.', format: 'Code', example: 'PPJ179' },
      { name: 'Booking Line No.', format: 'Booking . Line', example: 'PPJ179.1' },
      { name: 'Material Line Key', format: 'Booking Line | Article | Colour | Size', example: 'PPJ179.1|N-8|475|38M' },
    ],
    upstream: [
      { slug: 'apparel-style', what: 'Buyer and department' },
      { slug: 'rm-techpack', what: 'Material article' },
      { slug: 'masters', what: 'Colours and sizes' },
      { slug: 'buyer-po', what: 'Linked OC (qty and value)' },
    ],
    downstream: [{ slug: 'adhoc-indent', what: 'Booked units and booking line reference' }],
    fieldGroups: [
      { title: 'Header', fields: [
        { name: 'Buyer Block Booking Type', kind: 'entered', definition: 'Projection.' },
        { name: 'Season / Currency', kind: 'entered', definition: 'AW26 / INR.' },
        { name: 'Total Material Qty / Value', kind: 'calculated', definition: 'Sum of material units (600) and value (3,000).' },
        { name: 'Total Material Indented / Balance', kind: 'calculated', definition: 'Units indented (600) and still to indent (0).' },
      ] },
      { title: 'Material Details', fields: [
        { name: 'Units', kind: 'entered', definition: 'Quantity booked per colour/size in material UOM.' },
        { name: 'Rate', kind: 'entered', definition: 'Booking rate (5).' },
        { name: 'Value', kind: 'calculated', calc: 'bbb-material-value', definition: 'Units × Rate.' },
        { name: 'Indented Qty', kind: 'linked', from: 'adhoc-indent', fromField: 'Indent Qty', definition: 'Pulled back from the adhoc indent.' },
        { name: 'Balance to Indent', kind: 'calculated', calc: 'bbb-balance', definition: 'Units − Indented Qty.' },
      ] },
    ],
    calcs: ['bbb-material-value', 'bbb-balance'],
    checks: [
      { label: 'Booking Qty', workbook: 100, wfx: 100, match: true },
      { label: 'Material lines', workbook: 6, wfx: 6, match: true },
      { label: 'Total Material Units', workbook: 600, wfx: 600, match: true },
    ],
    tables: [
      { title: 'Material Details (PPJ179.1, N-8)', columns: ['Color', 'Size', 'Units', 'Rate', 'Value', 'Indented', 'Balance'], colorCol: 0,
        rows: BBB_MATERIAL.map((l) => [l.color, sizeName(l.size), l.units, l.rate, l.value, l.indented, l.balance]) },
    ],
    cases: [
      { kind: 'observation', title: 'Happy Pink is booked but never ordered',
        body: 'PPJ179 booked 200 KG_Nis of Happy Pink (475). The confirmed OC has no Happy Pink, so that stock stays unreserved after MRP. Use the colour tracker to see it.' },
      { kind: 'mismatch', title: 'Booking qty vs linked OC qty',
        body: 'Booking line qty is 100 PCS while the linked OC GAPS.NEWOC -249.1 is 1,000 PCS. The booking under-projected the order 10×.' },
    ],
  },
  // 8 ────────────────────────────────────────────────────────────────
  {
    ...idx('adhoc-indent'),
    screen: 'Sourcing › Indent (Adhoc – Buyer Block Booking)',
    theory: [
      'An indent is an internal request to buy material. An adhoc indent is raised manually (not by MRP); here it is raised against booking PPJ179 so the material carries the booking reference.',
      'Each indent line can only take up to the booking balance. Once a PO covers the full indent qty the open qty becomes 0 and the indent is Completed.',
    ],
    keys: [
      { name: 'Indent No.', format: 'PPM-xxxxxx-xxx', example: 'PPM-000735-001' },
      { name: 'Indent Line Key', format: 'Indent | S.No', example: 'PPM-000735-001|1' },
    ],
    upstream: [
      { slug: 'buyer-block-booking', what: 'Booking line, booked units' },
      { slug: 'rm-techpack', what: 'Article and UOM' },
      { slug: 'rmpo', what: 'Ordered qty (indent log)' },
    ],
    downstream: [{ slug: 'rmpo', what: 'Indent lines → RMPO 1229 lines' }, { slug: 'buyer-block-booking', what: 'Indented qty' }],
    fieldGroups: [
      { title: 'Indent lines', fields: [
        { name: 'Booked Units', kind: 'linked', from: 'buyer-block-booking', fromField: 'Units', definition: 'Quantity booked on the matching booking material line.' },
        { name: 'Prev. Indent Qty', kind: 'calculated', definition: 'Already indented against the same booking line.' },
        { name: 'Balance Units', kind: 'calculated', calc: 'indent-balance', definition: 'Booked − previously indented.' },
        { name: 'Indent Qty', kind: 'entered', definition: 'Quantity requested now.' },
        { name: 'Rate', kind: 'linked', from: 'buyer-block-booking', fromField: 'Rate', definition: 'Booking rate (5).' },
        { name: 'Ordered Qty', kind: 'linked', from: 'rmpo', fromField: 'Ordered Qty', definition: 'Quantity placed on POs.' },
        { name: 'Open Qty / Line Status', kind: 'calculated', calc: 'indent-open', definition: 'Uncovered quantity and status.' },
      ] },
    ],
    calcs: ['indent-balance', 'indent-open'],
    checks: [
      { label: 'Total Indent Qty', workbook: 600, wfx: 600, match: true },
      { label: 'Total Ordered Qty', workbook: 600, wfx: 600, match: true },
      { label: 'Total Open Qty', workbook: 0, wfx: 0, match: true },
      { label: 'Status', workbook: 'Completed', wfx: 'Completed', match: true },
    ],
    tables: [
      { title: 'Indent lines – PPM-000735-001', columns: ['S.No', 'Color', 'Size', 'Booked', 'Balance', 'Indent Qty', 'Rate', 'Ordered', 'Open'], colorCol: 1,
        rows: ADHOC_INDENT.map((l) => [l.sno, l.color, sizeName(l.size), l.booked, l.balance, l.indentQty, l.rate, l.ordered, l.open]) },
    ],
    cases: [
      { kind: 'mismatch', title: 'Supplier and rate change between indent and PO',
        body: 'Header supplier is NS_N1 at rate 5; the RMPO was placed on GAP Kids_Nis at 10. Indent rate is a reference, the PO price is what values the purchase.' },
    ],
  },
  // 9 ────────────────────────────────────────────────────────────────
  {
    ...idx('rmpo'),
    screen: 'Sourcing › Raw Material Purchase Order',
    theory: [
      'The RMPO is the commitment to the supplier. Lines come from indent lines; quantity can be increased by MOQ/MCQ/MSQ rules or additional qty; value is ordered qty × PO price plus surcharge.',
      'Two RMPOs exist for Flannel Shirt Adi (NIS-58): 1229 against the adhoc (booking) indent – fully received – and 1230 against the MRP production indent for the 1,100 KG_Nis not covered by booking stock.',
    ],
    keys: [
      { name: 'Order No.', format: 'FAB/<co>/Rmpo/<member>/<no>', example: 'FAB/PPJ/Rmpo/PPS12/1229' },
      { name: 'PO Line Key', format: 'Order No | S.No', example: 'FAB/PPJ/Rmpo/PPS12/1229|1' },
    ],
    upstream: [
      { slug: 'adhoc-indent', what: 'Indent lines (1229)' },
      { slug: 'production-indents', what: 'Level 2 indent open qty (1230)' },
      { slug: 'grn', what: 'Shipped qty' },
    ],
    downstream: [{ slug: 'grn', what: 'PO lines to receive' }, { slug: 'adhoc-indent', what: 'Ordered qty / indent log' }],
    fieldGroups: [
      { title: 'Article detail', fields: [
        { name: 'Indent Qty / Indent Rate', kind: 'linked', from: 'adhoc-indent', fromField: 'Indent Qty', definition: 'What the indent requested.' },
        { name: 'Ordered Qty', kind: 'entered', definition: 'Qty placed on the supplier.' },
        { name: 'Additional Qty', kind: 'entered', definition: 'Extra over indent (e.g. MOQ rounding).' },
        { name: 'Price per Unit', kind: 'entered', definition: 'PO price (10).' },
        { name: 'Total Value / Total Net Value', kind: 'calculated', calc: 'rmpo-value', definition: 'Qty × price (+ surcharge).' },
        { name: 'Shipped Qty', kind: 'linked', from: 'grn', fromField: 'Accepted Qty', definition: 'Received against the line.' },
        { name: 'Open Qty', kind: 'calculated', calc: 'rmpo-open', definition: 'Ordered − shipped.' },
        { name: 'Qty (Storing UOM)', kind: 'calculated', calc: 'rmpo-storing-qty', definition: 'Qty in stock UOM.' },
        { name: 'Stock Key / Booking No', kind: 'linked', definition: 'N-8|colour|size and PPJ179 – the stock lands tagged with the booking.' },
      ] },
    ],
    calcs: ['rmpo-value', 'rmpo-open', 'rmpo-storing-qty'],
    checks: [
      { label: 'Total Ordered Qty (1229)', workbook: 600, wfx: 600, match: true },
      { label: 'Total Value (1229)', workbook: 6000, wfx: 6000, match: true },
      { label: 'Total Ordered Qty (1230)', workbook: 1100, wfx: 1100, match: true },
    ],
    tables: [
      { title: 'RMPO 1229 – against adhoc indent (Confirmed)', columns: ['S.No', 'Indent Line', 'Color', 'Size', 'Ordered', 'Price', 'Value', 'Shipped', 'Open'], colorCol: 2,
        rows: RMPO_1229.map((l) => [l.sno, l.indentLine, l.color, sizeName(l.size), l.ordered, l.price, l.value, l.shipped, l.open]) },
      { title: 'RMPO 1230 – against production indent PPM-000738-001 (Unconfirmed)', columns: ['S.No', 'Color', 'Size', 'Indent Qty', 'In-house Adj.', 'Ordered', 'Shipped', 'Open'], colorCol: 1,
        rows: RMPO_1230.map((l) => [l.sno, l.color, sizeName(l.size), l.indentQty, l.inHouseAdj, l.ordered, l.shipped, l.open]) },
    ],
    cases: [
      { kind: 'rule', title: 'PO line order ≠ indent line order',
        body: 'RMPO 1229 line 1 comes from indent line 2. Always join PO to indent by the Indent Line Ref, never by line number.' },
    ],
  },
  // 10 ───────────────────────────────────────────────────────────────
  {
    ...idx('grn'),
    screen: 'Inventory › GRN (ASN from Supplier – Against PO)',
    theory: [
      'A Goods Receipt Note records material physically received at a site against a PO. Balance qty limits what can be received; accepted qty (received − rejected) becomes stock with the PO\'s stock key and booking number.',
      'Accepted qty flows back to the RMPO as shipped qty and closes its open qty.',
    ],
    keys: [{ name: 'GRN Line Key', format: 'GRN No | S.No', example: '(GRN no. generated on save)|1' }],
    upstream: [{ slug: 'rmpo', what: 'PO lines, rate, stock key, booking no.' }],
    downstream: [
      { slug: 'rmpo', what: 'Shipped qty' },
      { slug: 'production-indents', what: 'Stock available for in-house adjustment' },
    ],
    fieldGroups: [
      { title: 'GRN Qty', fields: [
        { name: 'Ordered Qty', kind: 'linked', from: 'rmpo', fromField: 'Ordered Qty', definition: 'PO line qty.' },
        { name: 'Prev. Recd. / Returned Qty', kind: 'entered', definition: 'Earlier receipts and returns.' },
        { name: 'Balance Qty', kind: 'calculated', calc: 'grn-balance', definition: 'Receivable now.' },
        { name: 'Received / Rejected Qty', kind: 'entered', definition: 'Physical receipt and QC rejection.' },
        { name: 'Accepted Qty / Value', kind: 'calculated', calc: 'grn-accepted', definition: 'Stock-in qty and value.' },
        { name: 'Excess/Short vs Balance', kind: 'calculated', calc: 'grn-excess', definition: 'Over/under receipt.' },
      ] },
    ],
    calcs: ['grn-balance', 'grn-accepted', 'grn-excess'],
    checks: [
      { label: 'Total Balance Qty', workbook: 600, wfx: 600, match: true },
      { label: 'Total Received Qty', workbook: 600, wfx: 600, match: true },
      { label: 'Total Rejected Qty', workbook: 0, wfx: 0, match: true },
    ],
    tables: [
      { title: 'GRN lines against RMPO 1229', columns: ['S.No', 'Color', 'Size', 'Ordered', 'Balance', 'Received', 'Rejected', 'Accepted', 'Value'], colorCol: 1,
        rows: GRN.map((l) => [l.sno, l.color, sizeName(l.size), l.ordered, l.balance, l.received, l.rejected, l.accepted, l.value]) },
    ],
    cases: [
      { kind: 'rule', title: 'Stock remembers its booking',
        body: 'Received stock carries Booking No PPJ179. That tag is what lets the later production indent find it and adjust 100 KG_Nis per colour/size in-house.' },
    ],
  },
  // 11 ───────────────────────────────────────────────────────────────
  {
    ...idx('buyer-po'),
    screen: 'Order › Purchase Order from Buyer (OC)',
    theory: [
      'The buyer purchase order, captured as an Order Confirmation (OC), is the confirmed demand. A main OC holds one or more delivery OCs; each delivery OC has a BOM, a delivery date and a colour × size quantity breakup.',
      'Confirming the OC triggers MRP: the breakup becomes Level 1 garment demand and is exploded through the BOM.',
    ],
    keys: [
      { name: 'Main OC No', format: 'Code', example: 'GAPS.NEWOC -249' },
      { name: 'Service/OC No', format: 'Main OC . n', example: 'GAPS.NEWOC -249.1' },
      { name: 'BreakUp Key', format: 'OC | Colour | Size', example: 'GAPS.NEWOC -249.1|372|34S' },
    ],
    upstream: [
      { slug: 'apparel-style', what: 'Style, buyer, department, UOM' },
      { slug: 'bom-materials', what: 'BOM #1 DP on the delivery OC' },
      { slug: 'masters', what: 'Colours and sizes for the breakup' },
      { slug: 'buyer-block-booking', what: 'Block Booking No PPJ179/1' },
    ],
    downstream: [
      { slug: 'mrp', what: 'Level 1 demand per colour/size' },
      { slug: 'production-order', what: 'OC qty and delivery date' },
      { slug: 'buyer-block-booking', what: 'Linked OC detail' },
    ],
    fieldGroups: [
      { title: 'Delivery OC', fields: [
        { name: 'Order Type', kind: 'entered', definition: 'Confirmed – only confirmed orders drive MRP.' },
        { name: 'BOM', kind: 'linked', from: 'bom-materials', fromField: 'BOM Name', definition: '#1 DP – the BOM MRP explodes.' },
        { name: 'Selling Price / CM Price', kind: 'entered', definition: '33.3333 USD / 0.' },
        { name: 'Fulfillment Type / SubType', kind: 'entered', definition: 'Manufacture / Job Work.' },
        { name: 'Block Booking No', kind: 'linked', from: 'buyer-block-booking', fromField: 'Block Booking No.', definition: 'Booking the OC consumes.' },
      ] },
      { title: 'Quantity breakup', fields: [
        { name: 'Qty', kind: 'entered', definition: 'Pieces per colour × size.' },
        { name: 'Total Value', kind: 'calculated', calc: 'oc-value', definition: 'Qty × (Selling + CM).' },
        { name: 'Color/Size used in BOM?', kind: 'calculated', definition: 'Check against BOM dependency – an unmapped colour would create no fabric demand.' },
      ] },
    ],
    calcs: ['oc-value'],
    checks: [
      { label: 'Total Qty', workbook: 1000, wfx: 1000, match: true },
      { label: 'Total Value', workbook: 33333.3, wfx: 33333.3, match: true },
    ],
    tables: [
      { title: 'Add Quantity BreakUp – GAPS.NEWOC -249.1', columns: ['Color', 'Size', 'Qty', 'Selling Price', 'Total Value', 'In BOM?'], colorCol: 0,
        rows: OC_BREAKUP.map((l) => [l.color, sizeName(l.size), l.qty, l.price, l.value, 'Yes']) },
    ],
    cases: [
      { kind: 'rule', title: 'MRP auto-runs on confirmation',
        body: 'Reference on the MRP list: "Indent generated automatically on confirmation of OC". Both production indents (Level 1 and Level 2) were created by that run.' },
    ],
  },
  // 12 ───────────────────────────────────────────────────────────────
  {
    ...idx('mrp'),
    screen: 'Planning › MRP (Style-wise)',
    theory: [
      'MRP converts confirmed order quantity into requirements level by level. Level 1 is the garment itself (production demand). Level 2 is every BOM material, found by multiplying Level 1 quantity by Final Consumption for the mapped material colour/size (purchase demand).',
      'Demand type decides the next document: production demand → production order; purchase demand for fabric/trims → RMPO; purchase demand for a garment should create a GMPO.',
    ],
    keys: [
      { name: 'L1 Key', format: 'OC | Colour | Size', example: 'GAPS.NEWOC -249.1|372|38M' },
      { name: 'L2 Key', format: 'OC | Material | Colour | Size', example: 'GAPS.NEWOC -249.1|N-8|372|38M' },
    ],
    upstream: [
      { slug: 'buyer-po', what: 'Colour × size qty' },
      { slug: 'bom-materials', what: 'Final consumption and dependency' },
      { slug: 'apparel-style', what: 'Article' },
    ],
    downstream: [{ slug: 'production-indents', what: 'Level 1 manufacture indent and Level 2 production indent' }],
    fieldGroups: [
      { title: 'Level 1 – Garment', fields: [
        { name: 'Actual Requirement', kind: 'linked', from: 'buyer-po', fromField: 'Qty', definition: 'OC qty for the colour/size.' },
        { name: 'MRP % / Loss %', kind: 'entered', definition: 'Planning multiplier (1 = 100 %) and loss allowance.' },
        { name: 'Req Qty', kind: 'calculated', calc: 'mrp-l1-req', definition: 'Planned requirement.' },
        { name: 'Demand Type / Production Qty / Purchase Qty', kind: 'calculated', calc: 'mrp-demand', definition: 'Split of requirement into make vs buy.' },
      ] },
      { title: 'Level 2 – Fabric', fields: [
        { name: 'Garment Req Qty', kind: 'linked', from: 'mrp', fromField: 'Level 1 Req Qty', definition: 'Parent requirement.' },
        { name: 'Final Consumption', kind: 'linked', from: 'bom-materials', fromField: 'Final Consumption', definition: '1.5 KG_Nis per piece.' },
        { name: 'Actual Requirement / Req Qty', kind: 'calculated', calc: 'mrp-l2-req', definition: 'Fabric needed.' },
        { name: 'Purchase Qty', kind: 'calculated', calc: 'mrp-demand', definition: 'Fabric to buy.' },
      ] },
    ],
    calcs: ['mrp-l1-req', 'mrp-l2-req', 'mrp-demand'],
    checks: [
      { label: 'L1 Req Qty total', workbook: 1000, wfx: 1000, match: true },
      { label: 'L2 Req Qty total', workbook: 1500, wfx: 1500, match: true },
    ],
    tables: [
      { title: 'Level 1 – Garment (production demand)', columns: ['Color', 'Size', 'Actual Req', 'MRP %', 'Req Qty', 'Production Qty'], colorCol: 0,
        rows: MRP_L1.map((l) => [l.color, sizeName(l.size), l.req, l.mrpPct, l.reqQty, l.productionQty]) },
      { title: 'Level 2 – Fabric N-8 (purchase demand)', columns: ['Color', 'Size', 'Garment Req', 'Final Cons', 'Actual Req', 'Purchase Qty'], colorCol: 0,
        rows: MRP_L2.map((l) => [l.color, sizeName(l.size), l.garmentReq, l.finalCons, l.actualReq, l.purchaseQty]) },
    ],
    cases: [
      { kind: 'mismatch', title: 'Garment purchase demand creates an RMPO',
        body: 'When a garment is bought instead of made, WFX should raise a GMPO (Garment Purchase Order). It currently raises an RMPO.' },
      { kind: 'rule', title: 'Indent type depends on level',
        body: 'Level 1 → Manufacture indent (PPM-000737-001). Level 2 → Production indent (PPM-000738-001).' },
    ],
  },
  // 13 ───────────────────────────────────────────────────────────────
  {
    ...idx('production-indents'),
    screen: 'Sourcing › Indent (MRP generated)',
    theory: [
      'MRP writes its requirements as indents. The Level 1 manufacture indent asks production to make 1,000 garments. The Level 2 production indent asks purchasing for 1,500 KG_Nis of N-8.',
      'Before ordering, the production indent adjusts available stock with the same stock key in-house. 400 KG_Nis from booking PPJ179 (100 per colour/size) is reserved, so only 1,100 goes to RMPO 1230.',
    ],
    keys: [
      { name: 'Indent No.', format: 'PPM-xxxxxx-xxx', example: 'PPM-000737-001 (L1), PPM-000738-001 (L2)' },
      { name: 'Stock Key', format: 'Article | Colour | Size', example: 'N-8|3909|38M' },
    ],
    upstream: [
      { slug: 'mrp', what: 'L1 and L2 requirement lines' },
      { slug: 'bom-materials', what: 'Cons, wastage, CSV, price' },
      { slug: 'bom-routing', what: 'Required-for process (VCutting)' },
      { slug: 'grn', what: 'Booking stock for in-house adjustment' },
    ],
    downstream: [
      { slug: 'rmpo', what: 'RMPO 1230 for open qty' },
      { slug: 'fpo', what: 'Indent lines for material allocation' },
    ],
    fieldGroups: [
      { title: 'Level 2 indent lines', fields: [
        { name: 'Indent Qty', kind: 'linked', from: 'mrp', fromField: 'Level 2 Req Qty', definition: 'Fabric requirement in Cons UOM.' },
        { name: 'Purchase UOM Indent Qty', kind: 'calculated', calc: 'pi-purchase-uom', definition: 'Requirement in purchase UOM.' },
        { name: 'BBB Stock Available', kind: 'linked', from: 'grn', fromField: 'Accepted Qty', definition: 'Booking stock with the same stock key.' },
        { name: 'In-house Adj.', kind: 'calculated', calc: 'pi-inhouse-adj', definition: 'Stock reserved for this indent.' },
        { name: 'Ordered Qty', kind: 'calculated', calc: 'pi-ordered', definition: 'Qty sent to RMPO.' },
        { name: 'Price', kind: 'linked', from: 'bom-materials', fromField: 'Cons UOM Price', calc: 'pi-price', definition: '15,000 per KG_Nis.' },
      ] },
    ],
    calcs: ['pi-purchase-uom', 'pi-inhouse-adj', 'pi-ordered', 'pi-price'],
    checks: [
      { label: 'L1 Total Indent Qty', workbook: 1000, wfx: 1000, match: true },
      { label: 'L2 Total Indent Qty', workbook: 1500, wfx: 1500, match: true },
      { label: 'L2 Total Purchase UOM Indent Qty', workbook: 1500000, wfx: 1500000, match: true },
      { label: 'L2 Total Ordered Qty', workbook: 1100, wfx: 1100, match: true },
      { label: 'L2 Total In-house Adj.', workbook: 400, wfx: 400, match: true },
    ],
    tables: [
      { title: 'Level 2 indent lines – PPM-000738-001', columns: ['S.No', 'Color', 'Size', 'Indent Qty', 'Purchase UOM Qty', 'BBB Stock', 'In-house Adj.', 'Ordered', 'Open'], colorCol: 1,
        rows: PROD_INDENT_L2.map((l) => [l.sno, l.color, sizeName(l.size), l.indentQty, l.purchaseUomQty, l.bbbStock, l.inHouseAdj, l.ordered, l.open]) },
    ],
    cases: [
      { kind: 'observation', title: 'Purchase UOM qty looks huge',
        body: '1,500 KG_Nis × 1,000 = 1,500,000 meter. The factor is correct for the master data, but confirm 1 KG = 1,000 meter is realistic for this fabric before releasing the PO.' },
    ],
  },
  // 14 ───────────────────────────────────────────────────────────────
  {
    ...idx('production-order'),
    screen: 'Production › My Production Orders',
    theory: [
      'A production order represents the Level 1 manufacture demand of an OC. "Add Style Quantities" decides, per colour, how much goes into the factory production order – Qty % can hold some back.',
    ],
    keys: [{ name: 'Production Order No', format: 'Code', example: 'PPS12SO/11325' }],
    upstream: [{ slug: 'buyer-po', what: 'OC qty, delivery date, style' }],
    downstream: [{ slug: 'fpo', what: 'Allocated qty per colour' }],
    fieldGroups: [
      { title: 'Add Style Quantities – Colour', fields: [
        { name: 'Qty', kind: 'linked', from: 'buyer-po', fromField: 'Qty', definition: 'OC qty for the colour (sum of sizes).' },
        { name: 'Qty %', kind: 'entered', definition: 'Share of the qty released to FPO.' },
        { name: 'Allocated to FPO', kind: 'calculated', calc: 'po-allocated', definition: 'Qty × Qty %.' },
      ] },
    ],
    calcs: ['po-allocated'],
    checks: [
      { label: 'Ordered Qty', workbook: 1000, wfx: 1000, match: true },
      { label: 'BALSAM TREE allocated', workbook: 300, wfx: 300, match: true },
      { label: 'Cosmic sky purple allocated', workbook: 700, wfx: 700, match: true },
    ],
    tables: [
      { title: 'Style quantities by colour', columns: ['Color', 'Qty', 'Qty %', 'Allocated to FPO'], colorCol: 0,
        rows: PROD_ORDER_COLOR.map((l) => [l.color, l.qty, l.pct, l.allocated]) },
    ],
    cases: [],
  },
  // 15 ───────────────────────────────────────────────────────────────
  {
    ...idx('fpo'),
    screen: 'Production › Factory Production Order / FPPO',
    theory: [
      'The Factory Production Order (FPO) releases quantity to a factory. WFX explodes it again through the BOM to get fabric required, then allocates stock: what is already reserved (from booking stock) is "instructed", the rest stays open until RMPO 1230 is received.',
      'Each routing process becomes a Factory Production Process Order (FPPO) carrying the full FPO qty per colour/size.',
    ],
    keys: [
      { name: 'FPO No.', format: 'Code', example: 'PPS12FP0158' },
      { name: 'Breakdown Key', format: 'FPO | Colour | Size', example: 'PPS12FP0158|372|34S' },
      { name: 'FPPO Line Key', format: 'FPO | Colour | Size | Process', example: 'PPS12FP0158|372|34S|Sewing' },
    ],
    upstream: [
      { slug: 'production-order', what: 'Allocated qty' },
      { slug: 'bom-materials', what: 'Final consumption' },
      { slug: 'production-indents', what: 'Indent lines and in-house adjustment' },
      { slug: 'bom-routing', what: 'Processes' },
    ],
    downstream: [],
    fieldGroups: [
      { title: 'FPO Qty – Colour/Size', fields: [
        { name: 'Allocated Qty', kind: 'linked', from: 'production-order', fromField: 'Allocated to FPO', definition: 'Qty released per colour/size.' },
        { name: 'Reduced at FPO', kind: 'entered', definition: 'Manual reduction.' },
        { name: 'FPO Qty', kind: 'calculated', calc: 'fpo-qty', definition: 'Qty in production.' },
        { name: 'Fabric Qty Reqd', kind: 'calculated', calc: 'fpo-fabric', definition: 'FPO qty × final consumption.' },
      ] },
      { title: 'Stock FPO Material Allocation', fields: [
        { name: 'Qty. Reqd.', kind: 'linked', from: 'fpo', fromField: 'Fabric Qty Reqd', definition: 'Fabric needed.' },
        { name: 'Qty. Instructed / Net Qty. Instructed', kind: 'linked', from: 'production-indents', fromField: 'In-house Adj.', definition: 'Stock already reserved.' },
        { name: 'Open Qty.', kind: 'calculated', calc: 'fpo-alloc-open', definition: 'Still to arrive.' },
      ] },
      { title: 'FPPO', fields: [
        { name: 'Required Qty', kind: 'linked', from: 'fpo', fromField: 'FPO Qty', definition: 'Per process, per colour/size.' },
        { name: 'Ordered / Received / Reallocation Qty', kind: 'entered', definition: 'Progress against the process.' },
        { name: 'Open Qty', kind: 'calculated', calc: 'fppo-open', definition: 'Remaining.' },
      ] },
    ],
    calcs: ['fpo-qty', 'fpo-fabric', 'fpo-alloc-open', 'fppo-open'],
    checks: [
      { label: 'FPO Production Qty', workbook: 1000, wfx: 1000, match: true },
      { label: 'Material Qty Reqd (total)', workbook: 1500, wfx: 1500, match: true },
      { label: 'Material Open Qty (total)', workbook: 1100, wfx: 1100, match: true },
      { label: 'Net Qty Instructed (total)', workbook: 400, wfx: 400, match: true },
      { label: 'VCutting / Sewing / VPacking Open Qty', workbook: 1000, wfx: 1000, match: true },
    ],
    tables: [
      { title: 'FPO Qty – colour/size and fabric requirement', columns: ['Color', 'Size', 'Order Qty', 'Allocated', 'Reduced', 'FPO Qty', 'Final Cons', 'Fabric Reqd'], colorCol: 0,
        rows: FPO_QTY.map((l) => [l.color, sizeName(l.size), l.orderQty, l.allocated, l.reduced, l.fpoQty, l.finalCons, l.fabricReqd]) },
      { title: 'Stock FPO material allocation', columns: ['Color', 'Size', 'Qty Reqd', 'Net Instructed', 'Open', 'Available'], colorCol: 0,
        rows: FPO_ALLOC.map((l) => [l.color, sizeName(l.size), l.qtyReqd, l.netInstructed, l.open, l.available]) },
      { title: 'FPPO – processes', columns: ['S.No', 'Process', 'Required', 'Ordered', 'Received', 'Open'],
        rows: ROUTING_PROCESSES.map((p) => [p.seq, p.process, 1000, 0, 0, 1000]) },
    ],
    cases: [
      { kind: 'observation', title: 'Open material = RMPO 1230',
        body: `FPO material open qty (${sum(FPO_ALLOC.map((l) => l.open))}) equals RMPO 1230 open qty (${sum(RMPO_1230.map((l) => l.open))}). Cutting can start only for the 400 KG_Nis already instructed until that PO is received.` },
    ],
  },
];

export const txnBySlug = (slug: string): Transaction | undefined => TRANSACTIONS.find((t) => t.slug === slug);
