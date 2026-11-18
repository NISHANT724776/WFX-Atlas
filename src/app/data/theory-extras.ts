export interface Fact { label: string; value: string; }

/** The one-line answer and the headline numbers shown at the top of each theory page. */
export const THEORY_SUMMARY: Record<string, { oneLine: string; facts: Fact[] }> = {
  'masters': { oneLine: 'The shared lists – colours, sizes and units – that every WFX document must pick from.',
    facts: [{ label: 'Colour card', value: 'Nis_colors (8)' }, { label: 'Size range', value: 'ERPSIZE (7)' }, { label: 'N-8 conversion', value: '1 KG_Nis = 1,000 m' }] },
  'apparel-style': { oneLine: 'The finished garment: who buys it, which colour card and size range it uses, and how it is purchased and priced.',
    facts: [{ label: 'Styles traced', value: 'Flannel Shirt Adi (NIS-58) · Adi TShirt (NIS-59)' }, { label: 'Buyer', value: 'GAP Kids' }, { label: 'Purchase UOM', value: 'PCS' }] },
  'bom-materials': { oneLine: 'How much of each material one garment needs, at what price, and which material colour goes with which garment colour.',
    facts: [{ label: 'Adi TShirt (NIS-59) lines', value: 'Fabric 1 · Trims 3' }, { label: 'Cons incl wastage', value: '1.5 × 10 % + 1.5 = 1.65' }, { label: 'Material value', value: '24,790.72 / pc' }] },
  'bom-routing': { oneLine: 'The ordered processes that make the garment, what each costs (Cost Of × Production Time) and which material each consumes.',
    facts: [{ label: 'Processes', value: 'VCutting · Sewing · VPacking' }, { label: 'Rates', value: '300 + 10 + 15 = 325' }, { label: 'Linkage', value: 'Fabric → Cut, trims → Sew/Pack' }] },
  'bom-costing': { oneLine: 'Cost per piece – material plus production – against the selling price: Profit uses the price after discount, Markup the price before it.',
    facts: [{ label: 'Adi TShirt (NIS-59) total cost', value: '25,115.72' }, { label: 'Profit', value: '−597.66 %' }, { label: 'Markup', value: '−84.07 %' }] },
  'rm-techpack': { oneLine: 'The master of a purchasable material – fabric or trim: its units, colour card, pricing basis and how stock is tracked.',
    facts: [{ label: 'Fabric', value: 'N-8 (KG_Nis)' }, { label: 'Trims', value: 'T-1 · NS1-1 · PP-1' }, { label: 'Stock key', value: 'Article | Colour | Size' }] },
  'buyer-block-booking': { oneLine: 'A projection that lets you book and buy long-lead fabric before the buyer confirms the order.',
    facts: [{ label: 'Booking', value: 'PPJ179' }, { label: 'Booked', value: '600 KG_Nis' }, { label: 'Value', value: '3,000' }] },
  'adhoc-indent': { oneLine: 'A purchase request raised by hand against the block booking – not by MRP and not for a sales order.',
    facts: [{ label: 'Indent', value: 'PPM-000735-001' }, { label: 'Type', value: 'Buyer Block Booking' }, { label: 'Qty', value: '600 KG_Nis' }] },
  'rmpo': { oneLine: 'The purchase order to the supplier. Value = ordered qty × PO price; open qty closes as GRN accepts material.',
    facts: [{ label: 'RMPO 1229 (BBB)', value: '600 KG · 6,000' }, { label: 'RMPO 1230 (sales order)', value: '1,100 KG' }] },
  'grn': { oneLine: 'Receipt of material against a PO. Only accepted qty becomes stock, tagged with the PO\'s booking.',
    facts: [{ label: 'Received', value: '600 KG_Nis' }, { label: 'Accepted', value: '600' }, { label: 'Value', value: '6,000' }] },
  'buyer-po': { oneLine: 'The confirmed buyer order. Its colour × size breakup is the demand MRP plans from.',
    facts: [{ label: 'OC', value: 'GAPS.NEWOC -249.1' }, { label: 'Qty', value: '1,000 pcs' }, { label: 'Value', value: 'USD 33,333.30' }] },
  'mrp': { oneLine: 'Turns the buyer order into requirements: garment to make (Level 1) and materials to buy (Level 2).',
    facts: [{ label: 'Level 1', value: '1,000 pcs' }, { label: 'Level 2', value: '1,500 KG_Nis' }, { label: 'Formula', value: 'qty × final cons' }] },
  'production-indents': { oneLine: 'The two indents MRP raises for a sales order: a Manufacture Indent to make the garment and a Production Indent to buy the fabric.',
    facts: [{ label: 'Manufacture (L1)', value: '1,000 pcs' }, { label: 'Production (L2)', value: '1,500 KG' }, { label: 'From BBB stock', value: '400 KG' }] },
  'production-order': { oneLine: 'The make order for the sales order; decides colour quantities released to the factory.',
    facts: [{ label: 'Order', value: 'PPS12SO/11325' }, { label: 'Allocated', value: '1,000 pcs' }] },
  'fpo': { oneLine: 'Releases quantity to a factory, checks fabric against it and creates one process order per routing step.',
    facts: [{ label: 'FPO', value: 'PPS12FP0158' }, { label: 'Fabric ready / open', value: '400 / 1,100 KG' }, { label: 'Processes', value: '3 × 1,000 pcs' }] },
};

/** Why the BBB indent and the sales-order indents are different documents. */
export const INDENT_COMPARISON = {
  columns: ['', 'BBB Adhoc Indent', 'Manufacture Indent (L1)', 'Production Indent (L2)'],
  rows: [
    ['Raised by', 'A person, manually', 'MRP, automatically', 'MRP, automatically'],
    ['Raised against', 'Buyer Block Booking PPJ179', 'Sales order GAPS.NEWOC -249.1', 'Sales order GAPS.NEWOC -249.1'],
    ['Asks to', 'Buy fabric', 'Make the garment', 'Buy fabric'],
    ['Quantity comes from', 'Booked balance units', 'OC colour × size qty', 'Garment qty × BOM final consumption'],
    ['Example', 'PPM-000735-001 · 600 KG', 'PPM-000737-001 · 1,000 pcs', 'PPM-000738-001 · 1,500 KG'],
    ['Stock check', 'None', 'None', 'Reserves BBB stock first (400 KG)'],
    ['Next document', 'RMPO 1229', 'Production Order', 'RMPO 1230 (1,100 KG)'],
  ],
};
