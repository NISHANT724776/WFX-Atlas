// Transaction records captured for Flannel Shirt Adi (NIS-58) (source: WFX_Data_Model_Flow_NIS-58_v4.xlsx).
// Every number here was entered in or read back from the WFX screens.

export const STYLE = {
  code: 'NIS-58',
  name: 'Flannel Shirt Adi',
  buyer: 'GAP Kids',
  dept: 'Kids-Tops-Knits',
  colorCard: 'Nis_colors',
  sizeRange: 'ERPSIZE',
};

/** Style base colour list (Apparel Style → Base Colors). TBA is not on the style. */
export const STYLE_COLORS = ['372', '3909', '475', '968', '762', '291', '201'];
export const STYLE_SIZES = ['34S', '38M', '42L1', '46XL', '50XXL', '22/10', 'TBA'];

/** BOM line 1 (fabric N-8) colour dependency: style colour → material colour. */
export const BOM_COLOR_DEP: Record<string, string | null> = {
  '372': '372', '3909': '3909', '475': '475',
  '968': null, '762': null, '291': null, '201': null, 'TBA': null,
};
export const BOM_SIZE_DEP: Record<string, string | null> = {
  '34S': '34S', '38M': '38M', '42L1': '42L1',
  '46XL': null, '50XXL': null, '22/10': null, 'TBA': null,
};

/** BOM #1 DP line 1 exactly as keyed in WFX. */
export const BOM_LINE = {
  lineId: 'NIS-58|#1 DP|V1|1',
  section: 'Fabric Section',
  article: 'N-8',
  articleName: 'Finished_FABRIC',
  purchaseUom: 'meter',
  consUom: 'KG_Nis',
  colorDependency: 'Table',
  sizeDependency: 'Table',
  totalConsQty: 3,
  consPerItem: 2,
  wastagePct: 0,
  lossPct: 0,
  shrinkagePct: 0,
  csv: 0,
  supplier: 'GAP Kids_Nis',
  currency: 'INR',
  purchasePrice: 15,
  conversionFactor: 1000,
  // values read back from WFX
  wfxConsQty: 1.5,
  wfxFinalConsumption: 1.5,
  wfxConsUomPrice: 15000,
  wfxValue: 22500,
};

export interface QtyLine { color: string; size: string; }

export const BBB_MATERIAL: (QtyLine & { units: number; rate: number; value: number; indented: number; balance: number })[] = [
  { color: '475', size: '38M', units: 100, rate: 5, value: 500, indented: 100, balance: 0 },
  { color: '475', size: '34S', units: 100, rate: 5, value: 500, indented: 100, balance: 0 },
  { color: '3909', size: '38M', units: 100, rate: 5, value: 500, indented: 100, balance: 0 },
  { color: '3909', size: '34S', units: 100, rate: 5, value: 500, indented: 100, balance: 0 },
  { color: '372', size: '38M', units: 100, rate: 5, value: 500, indented: 100, balance: 0 },
  { color: '372', size: '34S', units: 100, rate: 5, value: 500, indented: 100, balance: 0 },
];

export const ADHOC_INDENT: (QtyLine & { sno: number; booked: number; prev: number; balance: number; indentQty: number; rate: number; ordered: number; open: number })[] = [
  { sno: 1, color: '372', size: '38M', booked: 100, prev: 0, balance: 100, indentQty: 100, rate: 5, ordered: 100, open: 0 },
  { sno: 2, color: '372', size: '34S', booked: 100, prev: 0, balance: 100, indentQty: 100, rate: 5, ordered: 100, open: 0 },
  { sno: 3, color: '3909', size: '38M', booked: 100, prev: 0, balance: 100, indentQty: 100, rate: 5, ordered: 100, open: 0 },
  { sno: 4, color: '3909', size: '34S', booked: 100, prev: 0, balance: 100, indentQty: 100, rate: 5, ordered: 100, open: 0 },
  { sno: 5, color: '475', size: '38M', booked: 100, prev: 0, balance: 100, indentQty: 100, rate: 5, ordered: 100, open: 0 },
  { sno: 6, color: '475', size: '34S', booked: 100, prev: 0, balance: 100, indentQty: 100, rate: 5, ordered: 100, open: 0 },
];

export const RMPO_1229: (QtyLine & { sno: number; indentLine: number; indentQty: number; indentRate: number; ordered: number; price: number; value: number; shipped: number; open: number })[] = [
  { sno: 1, indentLine: 2, color: '372', size: '34S', indentQty: 100, indentRate: 5, ordered: 100, price: 10, value: 1000, shipped: 100, open: 0 },
  { sno: 2, indentLine: 1, color: '372', size: '38M', indentQty: 100, indentRate: 5, ordered: 100, price: 10, value: 1000, shipped: 100, open: 0 },
  { sno: 3, indentLine: 4, color: '3909', size: '34S', indentQty: 100, indentRate: 5, ordered: 100, price: 10, value: 1000, shipped: 100, open: 0 },
  { sno: 4, indentLine: 3, color: '3909', size: '38M', indentQty: 100, indentRate: 5, ordered: 100, price: 10, value: 1000, shipped: 100, open: 0 },
  { sno: 5, indentLine: 6, color: '475', size: '34S', indentQty: 100, indentRate: 5, ordered: 100, price: 10, value: 1000, shipped: 100, open: 0 },
  { sno: 6, indentLine: 5, color: '475', size: '38M', indentQty: 100, indentRate: 5, ordered: 100, price: 10, value: 1000, shipped: 100, open: 0 },
];

export const GRN: (QtyLine & { sno: number; ordered: number; prevRecd: number; returned: number; balance: number; received: number; rejected: number; accepted: number; rate: number; value: number })[] =
  RMPO_1229.map((l) => ({ sno: l.sno, color: l.color, size: l.size, ordered: 100, prevRecd: 0, returned: 0, balance: 100, received: 100, rejected: 0, accepted: 100, rate: 10, value: 1000 }));

export const OC_BREAKUP: (QtyLine & { qty: number; price: number; value: number })[] = [
  { color: '372', size: '34S', qty: 100, price: 33.3333, value: 3333.33 },
  { color: '372', size: '38M', qty: 200, price: 33.3333, value: 6666.66 },
  { color: '3909', size: '34S', qty: 300, price: 33.3333, value: 9999.99 },
  { color: '3909', size: '38M', qty: 400, price: 33.3333, value: 13333.32 },
];

export const MRP_L1: (QtyLine & { req: number; mrpPct: number; lossPct: number; reqQty: number; productionQty: number; purchaseQty: number })[] = [
  { color: '372', size: '38M', req: 200, mrpPct: 1, lossPct: 0, reqQty: 200, productionQty: 200, purchaseQty: 0 },
  { color: '372', size: '34S', req: 100, mrpPct: 1, lossPct: 0, reqQty: 100, productionQty: 100, purchaseQty: 0 },
  { color: '3909', size: '38M', req: 400, mrpPct: 1, lossPct: 0, reqQty: 400, productionQty: 400, purchaseQty: 0 },
  { color: '3909', size: '34S', req: 300, mrpPct: 1, lossPct: 0, reqQty: 300, productionQty: 300, purchaseQty: 0 },
];

export const MRP_L2: (QtyLine & { garmentReq: number; finalCons: number; actualReq: number; reqQty: number; purchaseQty: number })[] = [
  { color: '372', size: '38M', garmentReq: 200, finalCons: 1.5, actualReq: 300, reqQty: 300, purchaseQty: 300 },
  { color: '372', size: '34S', garmentReq: 100, finalCons: 1.5, actualReq: 150, reqQty: 150, purchaseQty: 150 },
  { color: '3909', size: '38M', garmentReq: 400, finalCons: 1.5, actualReq: 600, reqQty: 600, purchaseQty: 600 },
  { color: '3909', size: '34S', garmentReq: 300, finalCons: 1.5, actualReq: 450, reqQty: 450, purchaseQty: 450 },
];

export const PROD_INDENT_L2: (QtyLine & { sno: number; indentQty: number; conversion: number; purchaseUomQty: number; bbbStock: number; ordered: number; inHouseAdj: number; open: number })[] = [
  { sno: 1, color: '372', size: '34S', indentQty: 150, conversion: 1000, purchaseUomQty: 150000, bbbStock: 100, ordered: 50, inHouseAdj: 100, open: 0 },
  { sno: 2, color: '372', size: '38M', indentQty: 300, conversion: 1000, purchaseUomQty: 300000, bbbStock: 100, ordered: 200, inHouseAdj: 100, open: 0 },
  { sno: 3, color: '3909', size: '34S', indentQty: 450, conversion: 1000, purchaseUomQty: 450000, bbbStock: 100, ordered: 350, inHouseAdj: 100, open: 0 },
  { sno: 4, color: '3909', size: '38M', indentQty: 600, conversion: 1000, purchaseUomQty: 600000, bbbStock: 100, ordered: 500, inHouseAdj: 100, open: 0 },
];

export const RMPO_1230: (QtyLine & { sno: number; indentQty: number; inHouseAdj: number; ordered: number; shipped: number; open: number })[] = [
  { sno: 1, color: '372', size: '34S', indentQty: 150, inHouseAdj: 100, ordered: 50, shipped: 0, open: 50 },
  { sno: 2, color: '372', size: '38M', indentQty: 300, inHouseAdj: 100, ordered: 200, shipped: 0, open: 200 },
  { sno: 3, color: '3909', size: '34S', indentQty: 450, inHouseAdj: 100, ordered: 350, shipped: 0, open: 350 },
  { sno: 4, color: '3909', size: '38M', indentQty: 600, inHouseAdj: 100, ordered: 500, shipped: 0, open: 500 },
];

export const PROD_ORDER_COLOR = [
  { color: '372', qty: 300, pct: 100, allocated: 300 },
  { color: '3909', qty: 700, pct: 100, allocated: 700 },
];

export const FPO_QTY: (QtyLine & { orderQty: number; pct: number; allocated: number; reduced: number; fpoQty: number; finalCons: number; fabricReqd: number })[] = [
  { color: '372', size: '34S', orderQty: 100, pct: 100, allocated: 100, reduced: 0, fpoQty: 100, finalCons: 1.5, fabricReqd: 150 },
  { color: '372', size: '38M', orderQty: 200, pct: 100, allocated: 200, reduced: 0, fpoQty: 200, finalCons: 1.5, fabricReqd: 300 },
  { color: '3909', size: '34S', orderQty: 300, pct: 100, allocated: 300, reduced: 0, fpoQty: 300, finalCons: 1.5, fabricReqd: 450 },
  { color: '3909', size: '38M', orderQty: 400, pct: 100, allocated: 400, reduced: 0, fpoQty: 400, finalCons: 1.5, fabricReqd: 600 },
];

export const FPO_ALLOC: (QtyLine & { qtyReqd: number; netInstructed: number; open: number; available: number })[] = [
  { color: '372', size: '34S', qtyReqd: 150, netInstructed: 100, open: 50, available: 0 },
  { color: '372', size: '38M', qtyReqd: 300, netInstructed: 100, open: 200, available: 0 },
  { color: '3909', size: '34S', qtyReqd: 450, netInstructed: 100, open: 350, available: 0 },
  { color: '3909', size: '38M', qtyReqd: 600, netInstructed: 100, open: 500, available: 0 },
];

export const ROUTING_PROCESSES = [
  { seq: 1, process: 'VCutting', code: 'VCutting01-1', output: 'Cut PCS', after: '', rate: 300, time: 100 },
  { seq: 2, process: 'Sewing', code: 'Service/257', output: 'Sew PCS', after: 'VCutting', rate: 10, time: 5 },
  { seq: 3, process: 'VPacking', code: 'VPacking-5', output: '', after: 'Sewing', rate: 15, time: 5 },
];

export const COSTING = {
  materialCost: 22500,
  productionCost: 325,
  recipe: 0,
  indirect: 0,
  cm: 0,
  sellingPrice: 3000,
  discountPct: 0,
  targetProfitPct: 0.21,
  wfxTotalCost: 22825,
  wfxProfit: -19825,
  wfxProfitPct: -6.6083,
  wfxMarkupPct: -0.8686,
};

// ─────────────────────────────────────────────────────────────────────────────
// Adi TShirt (NIS-59) – captured live from WFX QA (screenshots, 11 Nov 2026).
// Production BOM #1 DP V1, INR, expected order qty 34,000, status Approved.
// ─────────────────────────────────────────────────────────────────────────────

export const STYLE_59 = {
  code: 'NIS-59', name: 'Adi TShirt', description: 'Adidas', buyer: 'GAP Kids', dept: 'Kids-Tops-Knits',
  division: 'Gurgaon-24175COM-AD', productGroup: 'KNITTED!', subCategory: 'Knitted_FAB_N', materialType: 'Knitted_FAB_N',
  purchaseUom: 'PCS', colorCard: 'Nis_colors', sizeRange: 'ERPSIZE', pricePer: 'Color/Size', colorDefinition: 'Single Colors', styleType: 'Single',
};

/** Raw-material techpacks used by the Adi TShirt (NIS-59) BOM. */
export const RM_59 = [
  { code: 'N-8', name: 'Finished_FABRIC', library: 'Cotton Fabrics', type: 'Textiles/Fabric', materialType: 'Knitted_FAB_N', consUom: 'KG_Nis', purchaseUom: 'KG_Nis', pricePer: 'Color/Size', dependency: 'ColorSize', bypass: '[Select]' },
  { code: 'T-1', name: 'Spun Polyester Sewing Thread', library: 'Nish_trims', type: 'Trims', materialType: 'Spun Polyester Sewing Thread', consUom: 'meter', purchaseUom: '—', pricePer: 'Article', dependency: '—', bypass: 'Disable' },
  { code: 'NS1-1', name: 'Cufflings_flanel', library: 'N_Trims', type: 'Trims', materialType: 'COTTONSHIRTERPNtype', consUom: 'PCS', purchaseUom: '—', pricePer: 'Article', dependency: '—', bypass: 'Disable' },
  { code: 'PP-1', name: 'Garment Polybag', library: 'Nish_trims', type: 'Trims', materialType: 'Polybag Garment Packaging', consUom: 'PCS', purchaseUom: '—', pricePer: 'Article', dependency: '—', bypass: '[Select]' },
];

export interface BomLine59 {
  line: number; section: 'Fabric' | 'Trim'; article: string; name: string; purchaseUom: string; consUom: string;
  totalCons: number; perItem: number; wastagePct: number; lossPct: number; purchasePrice: number; conversion: number;
  process: string; supplier: string;
  /** Values read from the WFX screen. */
  wfx: { consQty: number; inclWastage: number; finalCons: number; consUomPrice: number; value: number };
}

export const BOM_59: BomLine59[] = [
  { line: 1, section: 'Fabric', article: 'N-8', name: 'Finished_FABRIC', purchaseUom: 'meter', consUom: 'KG_Nis', totalCons: 3, perItem: 2, wastagePct: 10, lossPct: 0, purchasePrice: 15, conversion: 1000, process: 'VCutting', supplier: 'GAP Kids_Nis',
    wfx: { consQty: 1.5, inclWastage: 1.65, finalCons: 1.65, consUomPrice: 15000, value: 24750 } },
  { line: 2, section: 'Trim', article: 'T-1', name: 'Spun Polyester Sewing Thread', purchaseUom: 'PCS', consUom: 'meter', totalCons: 2, perItem: 1, wastagePct: 2, lossPct: 0, purchasePrice: 10, conversion: 1, process: 'Sewing', supplier: 'GAP Kids_Nis',
    wfx: { consQty: 2, inclWastage: 2.04, finalCons: 2.04, consUomPrice: 10, value: 20.4 } },
  { line: 3, section: 'Trim', article: 'NS1-1', name: 'Cufflings_flanel', purchaseUom: 'PCS', consUom: 'PCS', totalCons: 2, perItem: 1, wastagePct: 2, lossPct: 0, purchasePrice: 8, conversion: 1, process: 'Sewing', supplier: 'GAP Kids_Nis',
    wfx: { consQty: 2, inclWastage: 2.04, finalCons: 2.04, consUomPrice: 8, value: 16.32 } },
  { line: 4, section: 'Trim', article: 'PP-1', name: 'Garment Polybag', purchaseUom: 'PCS', consUom: 'PCS', totalCons: 1, perItem: 1, wastagePct: 0, lossPct: 0, purchasePrice: 4, conversion: 1, process: 'VPacking', supplier: 'GAP Kids_Nis',
    wfx: { consQty: 1, inclWastage: 1, finalCons: 1, consUomPrice: 4, value: 4 } },
];

/** Routing #1 (Approved) – processes and their operation parameters. */
export const ROUTING_59 = [
  { seq: 1, process: 'VCutting', code: 'VCutting01-1', output: 'Cut PCS', after: '', operation: 'VCutting', machine: 'MD Electronics-Laptops', efficiencyPct: 0, costOf: 3, lossPct: 0, totalTime: 100, productionTime: 100, wfxRate: 300 },
  { seq: 2, process: 'Sewing', code: 'Service/257', output: 'Sew PCS', after: 'VCutting', operation: 'Sewing', machine: 'Mobile-Vivo', efficiencyPct: 0, costOf: 2, lossPct: 0, totalTime: 5, productionTime: 5, wfxRate: 10 },
  { seq: 3, process: 'VPacking', code: 'VPacking-5', output: '', after: 'Sewing', operation: 'VPacking', machine: 'MD Electronics-Laptops', efficiencyPct: 0, costOf: 3, lossPct: 0, totalTime: 5, productionTime: 5, wfxRate: 15 },
];

export const COSTING_59 = {
  sellingPrice: 4000,
  discountPct: 10,
  targetProfitPct: 21,
  recipe: 0, indirect: 0, cm: 0,
  wfx: { fabricTotal: 24750, trimTotal: 40.72, totalCost: 25115.72, discountAmt: 400, profit: -21515.72, profitPct: -597.66, markup: -21115.72, markupPct: -84.07 },
};
