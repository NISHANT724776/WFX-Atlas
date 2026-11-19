import { FLOW_INDEX } from './catalog';
import { BOM_59, RM_59, ROUTING_59 } from './records';
import { SimResult, fmt } from './sim';

export type Actor = 'user' | 'system';
/** How a value on a WFX screen is produced. */
export type ScreenKind = 'user' | 'system' | 'carried';

type Dyn = string | ((r: SimResult) => string);

export interface ScreenField { label: string; value: Dyn; kind: ScreenKind; }
export interface JFact { label: string; value: Dyn; }
export interface JTable { columns: string[]; rows: (r: SimResult) => string[][]; }

export interface Phase { id: string; letter: string; name: string; /** Where the example numbers come from. */ source: string; }

export interface JStep {
  id: string;
  phase: string;
  actor: Actor;
  icon: string;
  title: string;
  /** Theory page for this step. */
  theory: string;
  /** WFX screen or document. */
  doc: string;
  short: Dyn;
  points: Dyn[];
  facts?: JFact[];
  table?: JTable;
  formula?: { label: string; expr: string; note?: string };
  screen?: { title: string; fields: ScreenField[] };
  keyPoint?: string;
  /** Marks the step whose outcome depends on the simulator's Adhoc Indent status. */
  scenario?: boolean;
  /** Step that only happens once the Adhoc Indent reaches this status. */
  needs?: 'po' | 'asn' | 'grn';
}

export const PHASES: Phase[] = [
  { id: 'A', letter: 'A', name: 'Style & BOM setup', source: 'Adi TShirt (NIS-59) · live WFX' },
  { id: 'B', letter: 'B', name: 'Buyer Block Booking & material requirement', source: 'Flannel Shirt Adi (NIS-58) · Excel trial' },
  { id: 'C', letter: 'C', name: 'Adhoc Indent & procurement', source: 'Flannel Shirt Adi (NIS-58) · Excel trial' },
  { id: 'D', letter: 'D', name: 'Sales Order & MRP', source: 'Flannel Shirt Adi (NIS-58) · Excel trial' },
  { id: 'E', letter: 'E', name: 'Automatic adjustment', source: 'Flannel Shirt Adi (NIS-58) · Excel trial' },
  { id: 'F', letter: 'F', name: 'Buy the gap & produce', source: 'Flannel Shirt Adi (NIS-58) · Excel trial' },
];

const kg = (n: number) => `${fmt(n)} KG`;

export const STEPS: JStep[] = [
  // ── A. Style & BOM setup (NIS-59, captured live in WFX) ───────────────
  { id: 'masters', phase: 'A', actor: 'user', icon: 'swatch', title: 'Masters ready', theory: 'masters', doc: 'Colour card · Size range · UOM',
    short: 'Colours, sizes and units that every techpack and BOM line must use.',
    points: ['Colour card Nis_colors and size range ERPSIZE are used by the style, the fabric and the trims.', 'N-8 converts 1 KG_Nis = 1,000 meter.'],
    screen: { title: 'Setup › Colour Card', fields: [
      { label: 'Colour Card', value: 'Nis_colors', kind: 'user' }, { label: 'Colours', value: '8', kind: 'user' },
      { label: 'Size Range', value: 'ERPSIZE', kind: 'user' }, { label: 'UOM conversion (N-8)', value: '1 KG_Nis = 1,000 meter', kind: 'user' }] } },
  { id: 'rm', phase: 'A', actor: 'user', icon: 'roll', title: 'Create material techpacks', theory: 'rm-techpack', doc: 'Fabric N-8 + trims T-1, NS1-1, PP-1',
    short: 'One techpack per raw material: fabric N-8 and three trims – sewing thread, cufflinks and polybag.',
    points: ['Fabric N-8: Cons UOM KG_Nis, priced per colour/size.', 'Trims: T-1 thread (meter), NS1-1 cufflinks (PCS), PP-1 polybag (PCS), priced per article.', 'All use the colour and size masters.'],
    table: { columns: ['Article', 'Name', 'Type', 'Cons UOM', 'Price Per'], rows: () => RM_59.map((m) => [m.code, m.name, m.type, m.consUom, m.pricePer]) },
    screen: { title: 'Trims › Spun Polyester Sewing Thread (T-1)', fields: [
      { label: 'Material Type', value: 'Spun Polyester Sewing Thread', kind: 'user' }, { label: 'Article Name', value: 'Spun Polyester Sewing Thread', kind: 'user' },
      { label: 'Consumption UOM', value: 'meter', kind: 'user' }, { label: 'Price Per', value: 'Article', kind: 'user' },
      { label: 'Bypass Material Check On Production GRN', value: 'Disable', kind: 'user' }, { label: 'Per Size Consumption', value: 'No', kind: 'user' },
      { label: 'Order Qty Multiple', value: '0.00', kind: 'system' }, { label: 'Requirement Multiple', value: '0.0000', kind: 'system' }] } },
  { id: 'style', phase: 'A', actor: 'user', icon: 'shirt', title: 'Create apparel techpack', theory: 'apparel-style', doc: 'Apparel Adi TShirt (NIS-59)',
    short: 'The Adi TShirt (NIS-59) for GAP Kids, using colour card Nis_colors and size range ERPSIZE.',
    points: ['Buyer GAP Kids, department Kids-Tops-Knits.', 'Purchase UOM PCS; Price Per Color/Size.', 'Colour Definition and Style Type come from the material type (read-only).'],
    screen: { title: 'Apparel › Detail', fields: [
      { label: 'Article Code', value: 'NIS-59', kind: 'system' }, { label: 'Article Name', value: 'Adi TShirt', kind: 'user' },
      { label: 'Article Description', value: 'Adidas', kind: 'user' }, { label: 'Buyer', value: 'GAP Kids', kind: 'user' },
      { label: 'Buyer Department', value: 'Kids-Tops-Knits', kind: 'user' }, { label: 'Sub-Category', value: 'Knitted_FAB_N', kind: 'user' },
      { label: 'Purchase UOM', value: 'PCS', kind: 'user' }, { label: 'Color Card', value: 'Nis_colors', kind: 'carried' },
      { label: 'Size/Width Range', value: 'ERPSIZE', kind: 'carried' }, { label: 'Color Definition', value: 'Single Colors', kind: 'system' }] } },
  { id: 'bom', phase: 'A', actor: 'user', icon: 'bom', title: 'BOM – Materials', theory: 'bom-materials', doc: 'Production BOM #1 DP · V1',
    short: '4 lines: fabric N-8 1.65 KG, thread 2.04 m, cufflinks 2.04, polybag 1 per T-shirt.',
    points: ['Cons Qty = Total Cons ÷ Cons per Item (3 ÷ 2 = 1.5).', 'Cons incl Wastage = Cons × Wastage % + Cons (1.5 × 10 % + 1.5 = 1.65).', 'Value = Final Cons × Cons UOM Price (1.65 × 15,000 = 24,750).'],
    formula: { label: 'Cons incl Wastage', expr: 'Cons Qty × Wastage % + Cons Qty', note: 'Verified on Adi TShirt (NIS-59). With loss or shrinkage the chain is Loss → Wastage → Shrinkage.' },
    table: { columns: ['Line', 'Article', 'Cons UOM', 'Cons', 'Wastage %', 'Final cons', 'Price', 'Value'],
      rows: () => BOM_59.map((l) => [String(l.line), l.article, l.consUom, fmt(l.wfx.consQty), fmt(l.wastagePct), fmt(l.wfx.finalCons), fmt(l.wfx.consUomPrice), fmt(l.wfx.value)]) },
    screen: { title: 'BOM › Materials (N-8)', fields: [
      { label: 'Article', value: 'N-8 Finished_FABRIC', kind: 'carried' }, { label: 'Purchase / Cons UOM', value: 'meter / KG_Nis', kind: 'carried' },
      { label: 'Total Cons Qty', value: '3', kind: 'user' }, { label: 'Cons per Item', value: '2', kind: 'user' },
      { label: 'Cons Qty', value: '1.5', kind: 'system' }, { label: 'Wastage %', value: '10', kind: 'user' },
      { label: 'Cons incl Wastage', value: '1.65', kind: 'system' }, { label: 'Final Consumption', value: '1.65', kind: 'system' },
      { label: 'Purchase Price', value: '15', kind: 'user' }, { label: 'Cons UOM Price', value: '15,000', kind: 'system' },
      { label: 'Value', value: '24,750', kind: 'system' }, { label: 'Material Colors / Sizes', value: 'BALSAM TREE · Small S (34S)…', kind: 'user' }] } },
  { id: 'routing', phase: 'A', actor: 'user', icon: 'route', title: 'Routing – Processes', theory: 'bom-routing', doc: 'Routing #1 · Approved',
    short: 'VCutting → Sewing → VPacking, used for every colour and size.',
    points: ['Output items: Cut PCS, Sew PCS.', 'After Process sets the order.', 'Process Rate is filled from the Operations tab.'],
    table: { columns: ['Process', 'Output', 'After', 'Rate'], rows: () => ROUTING_59.map((p) => [p.process, p.output || '—', p.after || 'First', fmt(p.wfxRate)]) } },
  { id: 'operations', phase: 'A', actor: 'user', icon: 'cog', title: 'Routing – Operations', theory: 'bom-routing', doc: 'Operations tab',
    short: 'Each operation has a machine, a Cost Of and a production time; together they give the process rate.',
    points: ['VCutting 3 × 100 = 300.', 'Sewing 2 × 5 = 10.', 'VPacking 3 × 5 = 15.', 'Target Production Efficiency 100 %.'],
    formula: { label: 'Process Rate', expr: 'Cost Of × Production Time', note: 'Matches the screen with ×; to confirm (it was described as +).' },
    table: { columns: ['Operation', 'Machine', 'Cost Of', 'Production time', 'Rate'], rows: () => ROUTING_59.map((p) => [p.operation, p.machine, fmt(p.costOf), fmt(p.productionTime), fmt(p.costOf * p.productionTime)]) } },
  { id: 'linkage', phase: 'A', actor: 'user', icon: 'link', title: 'Routing – Material linkage', theory: 'bom-routing', doc: 'Material Linkage tab',
    short: 'Each BOM line is mapped to the process that consumes it.',
    points: ['N-8 fabric → VCutting.', 'T-1 thread and NS1-1 cufflinks → Sewing.', 'PP-1 polybag → VPacking.'],
    table: { columns: ['Article', 'Process', 'Final cons'], rows: () => BOM_59.map((l) => [`${l.article} ${l.name}`, l.process, fmt(l.wfx.finalCons)]) } },
  { id: 'costing', phase: 'A', actor: 'system', icon: 'calc', title: 'BOM – Cost', theory: 'bom-costing', doc: 'Cost tab',
    short: 'Total cost 25,115.72 against selling price 4,000 less 10 % discount.',
    points: ['Fabric 24,750 + Trim 40.72 + Production 325 = 25,115.72.', 'Profit = 3,600 − 25,115.72 = −21,515.72 (−597.66 %).', 'Markup = 4,000 − 25,115.72 = −21,115.72 (−84.07 %).'],
    formula: { label: 'Profit % / Markup %', expr: '(Net selling − Total cost) ÷ Net selling  /  (Selling − Total cost) ÷ Total cost' },
    facts: [{ label: 'Total cost', value: '25,115.72' }, { label: 'Selling / discount', value: '4,000 / 10 %' }, { label: 'Profit', value: '−597.66 %' }, { label: 'Markup', value: '−84.07 %' }],
    screen: { title: 'BOM › Cost', fields: [
      { label: 'Fabric Section Total Cost', value: '24,750 Rs', kind: 'system' }, { label: 'Trim Section Total Cost', value: '40.72 Rs', kind: 'system' },
      { label: 'Production Cost', value: '325', kind: 'carried' }, { label: 'Total Cost', value: '25,115.72 INR', kind: 'system' },
      { label: 'Selling Price', value: '4,000.00 INR', kind: 'user' }, { label: 'Discount', value: '10 % (400 INR)', kind: 'user' },
      { label: 'Profit', value: '−597.66 % (−21,515.72)', kind: 'system' }, { label: 'Markup', value: '−84.07 % (−21,115.72)', kind: 'system' }] } },
  { id: 'approve', phase: 'A', actor: 'user', icon: 'check', title: 'Approve the BOM', theory: 'bom-materials', doc: 'BOM status Open → Approved',
    short: 'Adi TShirt (NIS-59) #1 DP moved from Open to Approved; only approved BOMs appear in the block-booking BOM dropdown.',
    points: ['Routing #1 is Approved as well.'],
    keyPoint: 'Only approved BOMs are shown in the BBB BOM dropdown.' },

  // ── B. Buyer Block Booking ──────────────────────────────────────────
  { id: 'bbb-create', phase: 'B', actor: 'user', icon: 'clipboard', title: 'Create Buyer Block Booking', theory: 'buyer-block-booking', doc: 'BBB PPJ179',
    short: 'A projection for GAP Kids, season AW26 – before any confirmed order.',
    points: ['Block Booking Type: Projection / Season.', 'Currency INR, OC cut-off date set.'],
    screen: { title: 'Order › Buyer Block Booking', fields: [
      { label: 'Block Booking No.', value: 'PPJ179', kind: 'system' }, { label: 'Buyer', value: 'GAP Kids', kind: 'carried' },
      { label: 'Buyer Division/Dept.', value: 'Kids-Tops-Knits', kind: 'carried' }, { label: 'Booking Type', value: 'Projection', kind: 'user' },
      { label: 'Season', value: 'AW26', kind: 'user' }, { label: 'Currency', value: 'INR', kind: 'user' }] } },
  { id: 'bbb-details', phase: 'B', actor: 'user', icon: 'list', title: 'Add booking details', theory: 'buyer-block-booking', doc: 'Booking line PPJ179.1',
    short: (r) => `Booking line PPJ179.1 with ${fmt(r.input.bbbQtyPerSku)} per colour/size, delivery date and product group.`,
    points: ['Each booking line can carry many colour/size material lines.'] },
  { id: 'bbb-article', phase: 'B', actor: 'user', icon: 'cube', title: 'Select article', theory: 'buyer-block-booking', doc: 'Booking line › Article',
    short: 'The article the booking is for. The BOM list is filtered by it.',
    points: ['Flannel Shirt Adi (NIS-58) trial: the booking line was saved as [All Other] and linked to OC article Flannel Shirt Adi (NIS-58).'] },
  { id: 'bbb-bom', phase: 'B', actor: 'user', icon: 'bom', title: 'Select approved BOM', theory: 'buyer-block-booking', doc: 'BOM #1 DP',
    short: 'Pick an approved BOM; "Add From Catalog" is hidden once a BOM is selected.',
    points: ['BOMs are filtered by the selected article.', 'Only approved BOMs are listed.'],
    keyPoint: 'Add From Catalog is hidden when a BOM is selected.' },
  { id: 'bbb-populate', phase: 'B', actor: 'system', icon: 'gear', title: 'Auto-populate materials', theory: 'buyer-block-booking', doc: 'Material Details',
    short: 'WFX copies every material of the BOM into the booking.',
    points: ['Materials are auto-populated from the BOM.', 'Units editability depends on the Auto MRP configuration.'],
    keyPoint: 'Units column editability depends on Auto MRP configuration.' },
  { id: 'bbb-materials', phase: 'B', actor: 'system', icon: 'table', title: 'Material requirement', theory: 'buyer-block-booking', doc: 'Material Details',
    short: (r) => `Requirement per colour/size = ${fmt(r.input.bbbQtyPerSku)} × ${fmt(r.input.bbbCons)} = ${kg(r.input.bbbQtyPerSku * r.input.bbbCons)}; total ${kg(r.bbbTotal)}.`,
    points: ['Requirement % is calculated automatically.', 'One line per material × colour × size.'],
    formula: { label: 'Requirement Qty (Requirement %)', expr: 'Buyer Block Booking Quantity × BOM Consumption (Cons)', note: 'As per Auto MRP configuration. Flannel Shirt Adi (NIS-58) booked 100 KG for 100 pcs, i.e. Cons 1 on the booking – to confirm.' },
    table: { columns: ['Material', 'Colour', 'Size', 'BBB qty', 'Cons', 'Requirement', 'Rate'],
      rows: (r) => r.rows.filter((x) => x.bbbReq).map((x) => ['N-8', x.colorName, x.size, fmt(r.input.bbbQtyPerSku), fmt(r.input.bbbCons), kg(x.bbbReq), fmt(r.bbbRate)]) },
    keyPoint: 'Requirement % is calculated automatically.' },
  { id: 'bbb-save', phase: 'B', actor: 'user', icon: 'save', title: 'Save Buyer Block Booking', theory: 'buyer-block-booking', doc: 'BBB PPJ179',
    short: (r) => `Saved: ${kg(r.bbbTotal)} of fabric, value ${fmt(r.bbbValue)}.`,
    points: ['Totals: material qty, value, indented and balance.'],
    facts: [{ label: 'Total material', value: (r) => kg(r.bbbTotal) }, { label: 'Value', value: (r) => `${fmt(r.bbbTotal)} × ${fmt(r.bbbRate)} = ${fmt(r.bbbValue)}` }] },

  // ── C. Adhoc Indent & procurement ───────────────────────────────────
  { id: 'gen-indent', phase: 'C', actor: 'user', icon: 'play', title: 'Generate indent requirement', theory: 'adhoc-indent', doc: 'BBB › Generate Indent Requirement',
    short: 'The user clicks "Generate Indent Requirement" on the booking.',
    points: ['Starts the system-created Adhoc Indent.'] },
  { id: 'adhoc', phase: 'C', actor: 'system', icon: 'doc', title: 'System creates Adhoc Indent', theory: 'adhoc-indent', doc: 'Adhoc Indent PPM-000735-001',
    short: (r) => `Adhoc Indent with every BOM material, requirement ${kg(r.adhocQty)} and the BBB reference.`,
    points: ['Reads BBB and BOM.', 'Calculates requirement.', 'Stores the BBB reference – this is what links it to a sales order later.', 'Can be processed to PO, ASN and GRN.'],
    screen: { title: 'Sourcing › Indent', fields: [
      { label: 'Indent No.', value: 'PPM-000735-001', kind: 'system' }, { label: 'Indent Type', value: 'Buyer Block Booking', kind: 'system' },
      { label: 'Booking No', value: 'PPJ179', kind: 'carried' }, { label: 'Article', value: 'Finished_FABRIC (N-8)', kind: 'carried' },
      { label: 'Total Indent Qty', value: (r) => kg(r.adhocQty), kind: 'system' }, { label: 'Rate', value: '5', kind: 'carried' }] } },
  { id: 'po', phase: 'C', actor: 'user', icon: 'cart', title: 'Raise PO', theory: 'rmpo', doc: 'RMPO 1229', needs: 'po',
    short: (r) => `PO to the supplier for ${kg(r.adhocQty)} at 10 = ${fmt(r.adhocQty * 10)}.`,
    points: ['PO price 10 values the purchase (indent rate 5 is only a reference).', 'Stock key and booking no. travel with every line.'] },
  { id: 'asn', phase: 'C', actor: 'user', icon: 'truck', title: 'Supplier ASN', theory: 'grn', doc: 'ASN against RMPO 1229', needs: 'asn',
    short: (r) => `Supplier ships ${kg(r.asnQty)} (advance shipping notice).`,
    points: ['Shipped quantity is now on the way but not yet in stock.'] },
  { id: 'grn', phase: 'C', actor: 'user', icon: 'box', title: 'GRN – receive', theory: 'grn', doc: 'GRN against RMPO 1229', needs: 'grn',
    short: (r) => `${kg(r.grnQty)} accepted into ACHIEVER CUT STORE, tagged PPJ179.`,
    points: ['Accepted = Received − Rejected.', 'Stock remembers the booking, so a sales order can claim it.'] },

  // ── D. Sales Order & MRP ────────────────────────────────────────────
  { id: 'oc', phase: 'D', actor: 'user', icon: 'order', title: 'Create Sales Order (OC)', theory: 'buyer-po', doc: 'OC GAPS.NEWOC -249.1',
    short: (r) => `${fmt(r.soPcs)} pcs by colour × size with BOM #1 DP selected.`,
    points: ['Colour × size breakup is the demand MRP plans from.'],
    table: { columns: ['Colour', 'Size', 'Pcs'], rows: (r) => r.rows.filter((x) => x.inOrder).map((x) => [x.colorName, x.size, fmt(x.soPcs)]) } },
  { id: 'link', phase: 'D', actor: 'user', icon: 'link', title: 'Link Buyer Block Booking', theory: 'buyer-po', doc: 'OC › Block Booking No',
    short: (r) => (r.input.linked ? 'PPJ179/1 is linked while creating the sales order and the order is confirmed.' : 'Not linked – the booking stock cannot be adjusted to this order.'),
    points: ['The link is what allows automatic adjustment.'] },
  { id: 'mrp', phase: 'D', actor: 'system', icon: 'gear', title: 'MRP runs on confirmation', theory: 'mrp', doc: 'MRP – Style-wise',
    short: (r) => `Level 1: ${fmt(r.soPcs)} pcs to make. Level 2: ${fmt(r.soPcs)} × ${fmt(r.input.bomCons)} = ${kg(r.soFabric)} to buy.`,
    points: ['Level 1 → Manufacture Indent.', 'Level 2 → Production (Sales Order) Indent.'],
    formula: { label: 'Level 2 requirement', expr: 'Garment qty × BOM Final Consumption' } },
  { id: 'mfg-indent', phase: 'D', actor: 'system', icon: 'doc', title: 'Manufacture Indent', theory: 'production-indents', doc: 'PPM-000737-001 · Level 1',
    short: (r) => `Asks production to make ${fmt(r.soPcs)} pcs.`, points: ['Leads to the Production Order.'] },
  { id: 'so-indent', phase: 'D', actor: 'system', icon: 'doc', title: 'Sales Order Indent', theory: 'production-indents', doc: 'PPM-000738-001 · Level 2',
    short: (r) => `Asks purchasing for ${kg(r.soFabric)} of fabric – before adjustment.`,
    points: ['Per colour/size line, with stock key N-8|colour|size.'] },

  // ── E. Automatic adjustment ─────────────────────────────────────────
  { id: 'adjust', phase: 'E', actor: 'system', icon: 'scale', title: 'Automatic adjustment', theory: 'production-indents', doc: 'Sales Order Indent', scenario: true,
    short: (r) => (r.adjType === 'No adjustment' ? 'Nothing is adjusted.' : `${r.adjType} of ${kg(r.adjusted)} at SKU level.`),
    points: ['Adjustment is always at SKU level (stock key).', 'Only available quantity is adjusted.', 'Partial adjustment is supported.'],
    table: { columns: ['Stock key', 'Needed', 'Available from BBB', 'Adjusted', 'To buy'],
      rows: (r) => r.rows.filter((x) => x.inOrder).map((x) => [x.key, kg(x.soFabric), kg(x.available), kg(x.adjusted), kg(x.toBuy)]) },
    formula: { label: 'Adjusted per SKU', expr: 'MIN(Sales Order Indent qty, BBB quantity available at the Adhoc Indent status)' } },
  { id: 'so-updated', phase: 'E', actor: 'system', icon: 'chart', title: 'Sales Order Indent updated', theory: 'production-indents', doc: 'PPM-000738-001',
    short: (r) => `${kg(r.soFabric)} − ${kg(r.adjusted)} adjusted = ${kg(r.toBuy)} still to buy.`,
    points: ['Full traceability: BBB → Indent → PO → ASN → GRN → Sales Order.'],
    facts: [{ label: 'Adjusted', value: (r) => kg(r.adjusted) }, { label: 'Type', value: (r) => r.adjType }, { label: 'Still to buy', value: (r) => kg(r.toBuy) }, { label: 'BBB left unreserved', value: (r) => kg(r.unreserved) }] },

  // ── F. Buy the gap & produce ────────────────────────────────────────
  { id: 'rmpo-gap', phase: 'F', actor: 'user', icon: 'cart', title: 'PO for the gap', theory: 'rmpo', doc: 'RMPO 1230',
    short: (r) => `Purchase order only for the ${kg(r.toBuy)} not covered by the booking.`, points: ['Flannel Shirt Adi (NIS-58): 1,100 KG, Unconfirmed.'] },
  { id: 'prod-order', phase: 'F', actor: 'user', icon: 'factory', title: 'Production Order', theory: 'production-order', doc: 'PPS12SO/11325',
    short: 'Decides how much of each colour is released to the factory (Qty %).', points: ['BALSAM TREE 300, Cosmic sky purple 700 at 100 %.'] },
  { id: 'fpo', phase: 'F', actor: 'user', icon: 'factory', title: 'Factory Production Order', theory: 'fpo', doc: 'PPS12FP0158',
    short: (r) => `${fmt(r.soPcs)} pcs released; fabric ${kg(r.soFabric)}: ${kg(r.adjusted)} ready, ${kg(r.toBuy)} open.`,
    points: ['Fabric Qty Reqd = FPO qty × Final Consumption.', 'Instructed qty = stock already reserved.'] },
  { id: 'fppo', phase: 'F', actor: 'system', icon: 'cog', title: 'Process orders (FPPO)', theory: 'fpo', doc: 'VCutting · Sewing · VPacking',
    short: (r) => `Each routing process gets ${fmt(r.soPcs)} pcs to produce.`, points: ['Open Qty = Required − Received − Reallocation.'] },
];

export const stepById = (id: string) => STEPS.find((s) => s.id === id);
export const phaseById = (id: string) => PHASES.find((p) => p.id === id)!;
export const val = (v: Dyn, r: SimResult) => (typeof v === 'function' ? v(r) : v);

/** Steps between two end points (inclusive), in flow order. */
/** The steps of a ready-made workflow: its exact list when it has one, otherwise its unbroken range. */
export function presetSteps(p: { from: string; to: string; steps?: string[] }): JStep[] {
  return p.steps ? STEPS.filter((s) => p.steps!.includes(s.id)) : pathBetween(p.from, p.to);
}

export function pathBetween(from: string, to: string): JStep[] {
  let a = STEPS.findIndex((s) => s.id === from);
  let b = STEPS.findIndex((s) => s.id === to);
  if (a < 0) a = 0;
  if (b < 0) b = STEPS.length - 1;
  if (a > b) [a, b] = [b, a];
  return STEPS.slice(a, b + 1);
}

/** Preset (named workflow) that contains a step – used by theory pages. */
export function presetsForTheory(slug: string) {
  const out: { preset: (typeof FLOW_INDEX)[number]; step: JStep }[] = [];
  for (const p of FLOW_INDEX) {
    const steps = presetSteps(p).filter((s) => s.theory === slug);
    if (steps.length) out.push({ preset: p, step: steps[0] });
  }
  return out;
}

export const ADJUST_SCENARIOS = [
  { status: 'none' as const, title: 'Adhoc Indent not ordered', conditions: ['No PO against the Adhoc Indent'], type: 'No adjustment',
    text: 'Nothing is on order or in stock yet, so nothing can be adjusted.', confirm: true },
  { status: 'po' as const, title: 'Scenario 1 · PO created', conditions: ['PO created against Adhoc Indent', 'ASN not done', 'GRN not done'], type: 'On Order Adjustment',
    text: 'The ordered quantity from the Adhoc Indent is adjusted against the indent of the linked sales order.', confirm: false },
  { status: 'asn' as const, title: 'Scenario 2 · ASN completed', conditions: ['PO created', 'ASN completed', 'GRN not done'], type: 'On Order Adjustment',
    text: 'The ASN quantity under the Adhoc Indent is adjusted to the indent of the linked sales order.', confirm: false },
  { status: 'grn' as const, title: 'Scenario 3 · GRN completed', conditions: ['GRN completed'], type: 'In-House Adjustment',
    text: 'Inventory received (GRN) against the Adhoc Indent is adjusted in-house to the indent of the linked sales order.', confirm: false },
];

/** Soft prerequisites: a step normally needs these steps first (shown as a hint, never blocks the chain). */
export const REQUIRES: Record<string, string[]> = {
  bom: ['style'], routing: ['bom'], operations: ['routing'], linkage: ['operations'], costing: ['bom'], approve: ['costing'],
  'bbb-details': ['bbb-create'], 'bbb-article': ['bbb-details'], 'bbb-bom': ['bbb-article'], 'bbb-populate': ['bbb-bom'], 'bbb-materials': ['bbb-populate'], 'bbb-save': ['bbb-create'],
  'gen-indent': ['bbb-save'], adhoc: ['gen-indent'], po: ['adhoc'], asn: ['po'], grn: ['asn'],
  oc: ['style'], link: ['oc'], mrp: ['oc'], 'mfg-indent': ['mrp'], 'so-indent': ['mrp'],
  adjust: ['so-indent'], 'so-updated': ['adjust'], 'rmpo-gap': ['so-indent'], 'prod-order': ['so-indent'], fpo: ['prod-order'], fppo: ['fpo'],
};

/** Steps grouped for the selector: Phase → group → sub-steps. Every step id appears exactly once. */
export const STEP_GROUPS: { id: string; phase: string; title: string; steps: string[] }[] = [
  { id: 'techpacks', phase: 'A', title: 'Masters & techpacks', steps: ['masters', 'rm', 'style'] },
  { id: 'bom', phase: 'A', title: 'BOM, routing & cost', steps: ['bom', 'routing', 'operations', 'linkage', 'costing', 'approve'] },
  { id: 'bbb', phase: 'B', title: 'Buyer Block Booking', steps: ['bbb-create', 'bbb-details', 'bbb-article', 'bbb-bom', 'bbb-populate', 'bbb-materials', 'bbb-save'] },
  { id: 'adhoc', phase: 'C', title: 'Adhoc indent', steps: ['gen-indent', 'adhoc'] },
  { id: 'procure', phase: 'C', title: 'Purchase & receipt', steps: ['po', 'asn', 'grn'] },
  { id: 'order', phase: 'D', title: 'Sales Order', steps: ['oc', 'link'] },
  { id: 'mrp', phase: 'D', title: 'MRP & indents', steps: ['mrp', 'mfg-indent', 'so-indent'] },
  { id: 'adjust', phase: 'E', title: 'Adjustment', steps: ['adjust', 'so-updated'] },
  { id: 'gap', phase: 'F', title: 'Buy the gap', steps: ['rmpo-gap'] },
  { id: 'produce', phase: 'F', title: 'Production', steps: ['prod-order', 'fpo', 'fppo'] },
];

/**
 * Scenarios: a business situation = which steps happen + how far the booking got.
 * Picking one ticks its steps and sets the simulator; every step stays tickable afterwards.
 */
export interface Scenario { id: string; name: string; note: string; steps: string[]; status?: 'none' | 'po' | 'asn' | 'grn'; }
const BOOKING = ['bbb-create', 'bbb-details', 'bbb-article', 'bbb-bom', 'bbb-populate', 'bbb-materials', 'bbb-save', 'gen-indent', 'adhoc'];
const ORDER_ON = ['oc', 'link', 'mrp', 'so-indent', 'adjust', 'so-updated', 'rmpo-gap', 'prod-order', 'fpo', 'fppo'];
export const SCENARIOS: Scenario[] = [
  { id: 'direct', name: 'Order without booking', note: 'Techpack → sales order → MRP → indent → production', steps: ['style', 'oc', 'mrp', 'so-indent', 'prod-order'] },
  { id: 'direct-buy', name: 'Buy everything for the order', note: 'No booking: PO for the full need, then production', steps: ['style', 'oc', 'mrp', 'so-indent', 'rmpo-gap', 'prod-order', 'fpo', 'fppo'], status: 'none' },
  { id: 'booked-po', name: 'Booked, PO raised', note: 'PO exists, nothing shipped or received yet: on-order adjustment', steps: [...BOOKING, 'po', ...ORDER_ON], status: 'po' },
  { id: 'booked-asn', name: 'Booked, supplier shipped (ASN)', note: 'ASN done, no GRN: on-order adjustment from the ASN', steps: [...BOOKING, 'po', 'asn', ...ORDER_ON], status: 'asn' },
  { id: 'booked-grn', name: 'Booked, fabric received (GRN)', note: 'Stock is in house: in-house adjustment', steps: [...BOOKING, 'po', 'asn', 'grn', ...ORDER_ON], status: 'grn' },
  { id: 'style', name: 'Style setup only', note: 'Techpacks, BOM, routing, cost and approval', steps: ['masters', 'rm', 'style', 'bom', 'routing', 'operations', 'linkage', 'costing', 'approve'] },
];

/** True when the chain includes the Adhoc Indent, so the booking scenario simulator makes sense. */
export const hasBooking = (steps: JStep[]) => steps.some((s) => s.id === 'adhoc' || s.id === 'link' || s.id === 'adjust' || s.id === 'so-updated');
