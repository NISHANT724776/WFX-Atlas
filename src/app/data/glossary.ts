import { SO_CONCEPTS } from './salesorder';
import { ARTICLE_CODING, BOM_CONCEPTS, DEPENDENCY_TYPES, MRP_CONCEPTS, UOM_TYPES } from './concepts';

export interface Term {
  term: string;
  slug: string;
  definition: string;
  txn?: string;
}

const t = (term: string, definition: string, txn?: string): Term => ({
  term, definition, txn,
  slug: term.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, ''),
});

const fromConcept = (c: { name: string; group: string; definition: string }, txn: string): Term =>
  t(c.group.includes('dependency') ? `${c.group} – ${c.name}` : c.name, c.definition, txn);

export const GLOSSARY: Term[] = [
  t('Colour dependency', 'How a BOM line takes its colours. Three types: Base Colour (apparel colours used directly), Table (the user maps each apparel colour to a material colour from the material colour master) and None (no colour).', 'bom-materials'),
  t('Size dependency', 'How a BOM line takes its sizes. Three types: Base Size (apparel sizes used directly), Table (the user maps apparel sizes to material sizes) and None (no size).', 'bom-materials'),
  ...DEPENDENCY_TYPES.map((c) => fromConcept(c, 'bom-materials')),
  ...UOM_TYPES.map((c) => fromConcept(c, 'rm-techpack')),
  ...BOM_CONCEPTS.map((c) => fromConcept(c, 'bom-materials')),
  ...ARTICLE_CODING.map((c) => fromConcept(c, 'rm-techpack')),
  ...MRP_CONCEPTS.map((c) => fromConcept(c, 'mrp')),
  ...SO_CONCEPTS.map((c) => fromConcept(c, 'buyer-po')),
  t('BOM (Bill of Materials)', 'The list of every material one garment needs – how much of each (consumption with wastage), in which colour and size, at what price – plus the routing (processes) and the cost sheet. MRP and FPO use its Final Consumption to plan and issue material.', 'bom-materials'),
  t('Techpack', 'The master record of an article in WFX: an Apparel techpack for the garment, and a Fabric or Trims techpack for each raw material.', 'rm-techpack'),
  t('Apparel Article', 'The finished garment, e.g. Adi TShirt (NIS-59) or Flannel Shirt Adi (NIS-58), with buyer, colour card, size range and purchase UOM.', 'apparel-style'),
  t('Cost Sheet', 'The Cost tab of the BOM: material cost by section plus production cost gives Total Cost, compared with the selling price for Profit and Markup.', 'bom-costing'),
  t('Process Rate', 'Cost of one routing process per piece = Cost Of × Production Time from the Operations tab.', 'bom-routing'),
  t('Colour Card', 'Named palette of colour codes (e.g. Nis_colors). Styles and materials pick one, and may only use its colours.', 'masters'),
  t('Size Range', 'Named list of size codes (e.g. ERPSIZE) a style or material can use.', 'masters'),
  t('Conversion Factor', 'Number of To-UOM units in one From-UOM unit for a material. N-8: 1 KG_Nis = 1,000 meter.', 'masters'),
  t('Cons UOM', 'Consumption unit of measure – the unit the BOM consumption is expressed in (KG_Nis for N-8).', 'bom-materials'),
  t('Purchase UOM', 'Unit the supplier sells and invoices in. Price is entered per purchase UOM.', 'bom-materials'),
  t('Storage UOM', 'Unit stock is kept in after GRN.', 'rm-techpack'),
  t('Total Cons Qty', 'Material quantity that covers "Cons per Item" garments. Cons Qty = Total Cons Qty ÷ Cons per Item.', 'bom-materials'),
  t('Cons per Item', 'Number of garments the Total Cons Qty is measured for.', 'bom-materials'),
  t('Wastage %', 'Allowance for material lost in marker/cutting waste.', 'bom-materials'),
  t('Loss %', 'Process loss such as dyeing or finishing loss. It is the first step of the chain: the system turns it into a Loss Factor = 1 ÷ (1 − Loss %) and multiplies the Cons Qty by it.', 'bom-materials'),
  t('Loss factor', 'Loss Factor = 1 ÷ (1 − Loss %). With 5 % loss the factor is 1.052632.', 'bom-materials'),
  t('Shrinkage %', 'Allowance for size reduction after washing or finishing. It is the last step of the chain: Cons incl Shrinkage = Cons incl Wastage ÷ (1 − Shrinkage %).', 'bom-materials'),
  t('Final Consumption', 'The last figure of the consumption chain, also called the total consumption of the line: Cons × 1/(1 − Loss %), then + Wastage %, then ÷ (1 − Shrinkage %). MRP and FPO multiply quantity by it.', 'bom-materials'),
  t('Total consumption', 'The final figure of the chain loss → wastage → shrinkage, i.e. Final Consumption. If only one of loss, wastage or shrinkage is filled, only that step runs and its result becomes the total consumption. Not the same as Total Cons Qty, the quantity the user enters for Cons per Item garments.', 'bom-materials'),
  t('Cons UOM Price', 'Purchase price converted to one consumption unit: Purchase Price × Conversion Factor.', 'bom-materials'),
  t('CSV', 'Customer Supplied Value – value of material supplied by the buyer, recorded on the BOM line.', 'bom-materials'),
  t('Colour Dependency', 'Rule mapping each garment colour to the material colour used. "Table" = mapped colour by colour; unmapped colours are [Not Used].', 'bom-materials'),
  t('Size Dependency', 'Rule mapping each garment size to the material size used.', 'bom-materials'),
  t('Routing', 'Ordered list of production processes (VCutting → Sewing → VPacking) with rates and operations.', 'bom-routing'),
  t('Material Linkage', 'Link between a BOM material and the routing process that consumes it.', 'bom-routing'),
  t('Profit %', '(Selling price after discount − Total cost) ÷ selling price after discount × 100.', 'bom-costing'),
  t('Markup %', '(Selling price before discount − Total cost) ÷ Total cost × 100.', 'bom-costing'),
  t('Discount %', 'Percentage taken off the selling price before profit is calculated (10 % of 4,000 = 400).', 'bom-costing'),
  t('Target Profit %', 'The margin the costing aims for, shown next to Profit (21 % on Adi TShirt (NIS-59)).', 'bom-costing'),
  t('Cost Of', 'Default cost rate of a sub-operation per unit of production time on the routing Operations tab.', 'bom-routing'),
  t('Default conversion factor', 'When no material-wise UOM conversion is maintained, WFX uses factor 1 between purchase UOM and cons UOM.', 'bom-materials'),
  t('Production Time', 'Time an operation takes; Process Rate = Cost Of × Production Time.', 'bom-routing'),
  t('Trims', 'Non-fabric materials such as sewing thread, cufflinks and polybags; each has its own techpack.', 'rm-techpack'),
  t('Stock Key', 'Article | Colour | Size identifier used to hold and find stock (e.g. N-8|372|34S).', 'rm-techpack'),
  t('Material Dependency', 'RM techpack setting (e.g. ColorSize) deciding at which level stock and demand are tracked.', 'rm-techpack'),
  t('BBB (Buyer Block Booking)', 'Projection booking used to buy long-lead material before the confirmed order.', 'buyer-block-booking'),
  t('Adhoc Indent', 'Manually raised purchase request, here against a block booking.', 'adhoc-indent'),
  t('Manufacture Indent', 'MRP Level 1 indent asking production to make the garment.', 'production-indents'),
  t('Production Indent', 'MRP Level 2 indent asking purchasing to buy material for production.', 'production-indents'),
  t('In-house Adj.', 'Part of an indent covered by stock already in house (e.g. booking stock).', 'production-indents'),
  t('On Order Adj.', 'Part of an indent covered by an existing open purchase order.', 'production-indents'),
  t('Open Qty', 'Quantity not yet covered or received. Meaning depends on the document: indent (not ordered), PO (not shipped), FPPO (not received).'),
  t('MOQ / MCQ / MSQ', 'Minimum order / colour / size quantity rules that can round PO quantity up.', 'rmpo'),
  t('RMPO', 'Raw Material Purchase Order placed on a supplier.', 'rmpo'),
  t('GMPO', 'Garment Purchase Order – expected for bought-in garments; WFX currently raises an RMPO instead.', 'mrp'),
  t('GRN', 'Goods Receipt Note – receipt of material against a PO at a site.', 'grn'),
  t('Accepted Qty', 'Received − Rejected. Only accepted qty becomes stock.', 'grn'),
  t('OC (Order Confirmation)', 'Confirmed buyer order. A main OC has delivery OCs, each with a colour × size breakup.', 'buyer-po'),
  t('MRP', 'Material Requirement Planning – explodes confirmed demand level by level into production and purchase requirements.', 'mrp'),
  t('MRP %', 'Planning multiplier on actual requirement (1 = 100 %).', 'mrp'),
  t('Demand Type', 'Production (make, next BOM level) or Purchase (buy, creates a PO).', 'mrp'),
  t('Production Order', 'Level 1 make order for an OC; decides colour quantities released to the factory.', 'production-order'),
  t('FPO', 'Factory Production Order – quantity released to a specific factory.', 'fpo'),
  t('FPPO', 'Factory Production Process Order – one per routing process per FPO.', 'fpo'),
  t('Qty Instructed', 'Stock reserved for an FPO material line.', 'fpo'),
];
