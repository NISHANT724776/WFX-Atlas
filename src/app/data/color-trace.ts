import { COLORS, SIZES } from './catalog';
import {
  ADHOC_INDENT, BBB_MATERIAL, BOM_COLOR_DEP, FPO_ALLOC, FPO_QTY, GRN, MRP_L1, MRP_L2, OC_BREAKUP,
  PROD_INDENT_L2, PROD_ORDER_COLOR, RMPO_1229, RMPO_1230, ROUTING_PROCESSES, STYLE_COLORS, QtyLine,
} from './records';

export interface TraceStage {
  step: number;
  slug: string;
  stage: string;
  doc: string;
  present: boolean;
  qty?: number;
  uom?: string;
  detail: string;
  bySize?: { size: string; qty: number }[];
}

export interface TraceAlert {
  level: 'info' | 'warn';
  text: string;
}

export interface ColorTrace {
  code: string;
  name: string;
  stages: TraceStage[];
  alerts: TraceAlert[];
  stockKeys: string[];
}

const sizeLabel = (code: string) => SIZES.find((s) => s.code === code)?.display ?? code;

function pick<T extends QtyLine>(rows: T[], color: string, f: (r: T) => number) {
  const own = rows.filter((r) => r.color === color);
  return {
    total: own.reduce((a, r) => a + f(r), 0),
    bySize: own.map((r) => ({ size: sizeLabel(r.size), qty: f(r) })),
    count: own.length,
  };
}

export function traceColor(code: string): ColorTrace | undefined {
  const color = COLORS.find((c) => c.code === code);
  if (!color) return undefined;

  const inStyle = STYLE_COLORS.includes(code);
  const bomMat = BOM_COLOR_DEP[code] ?? null;
  const bbb = pick(BBB_MATERIAL, code, (r) => r.units);
  const ind = pick(ADHOC_INDENT, code, (r) => r.indentQty);
  const po1 = pick(RMPO_1229, code, (r) => r.ordered);
  const grn = pick(GRN, code, (r) => r.accepted);
  const oc = pick(OC_BREAKUP, code, (r) => r.qty);
  const l1 = pick(MRP_L1, code, (r) => r.reqQty);
  const l2 = pick(MRP_L2, code, (r) => r.reqQty);
  const pi = pick(PROD_INDENT_L2, code, (r) => r.indentQty);
  const adj = pick(PROD_INDENT_L2, code, (r) => r.inHouseAdj);
  const po2 = pick(RMPO_1230, code, (r) => r.ordered);
  const prodOrd = PROD_ORDER_COLOR.find((p) => p.color === code);
  const fpo = pick(FPO_QTY, code, (r) => r.fpoQty);
  const fab = pick(FPO_QTY, code, (r) => r.fabricReqd);
  const open = pick(FPO_ALLOC, code, (r) => r.open);

  const stages: TraceStage[] = [
    { step: 1, slug: 'masters', stage: 'Colour Card', doc: 'Nis_colors', present: true,
      detail: `${color.name} (${code}) is defined in colour card Nis_colors.` },
    { step: 2, slug: 'apparel-style', stage: 'Style base colour', doc: 'Flannel Shirt Adi (NIS-58)', present: inStyle,
      detail: inStyle ? 'On the base colour list of Flannel Shirt Adi (NIS-58) – can be ordered.' : 'Not on the style – cannot be ordered for Flannel Shirt Adi (NIS-58).' },
    { step: 3, slug: 'bom-materials', stage: 'BOM colour dependency', doc: 'NIS-58|#1 DP|V1|1', present: !!bomMat,
      detail: bomMat ? `Mapped to fabric N-8 colour ${bomMat}. MRP will create fabric demand for this colour.` : 'Not mapped ([Not Used]) – no fabric demand would be generated.' },
    { step: 7, slug: 'buyer-block-booking', stage: 'Block booking', doc: 'PPJ179', present: bbb.count > 0, qty: bbb.total, uom: 'KG_Nis',
      detail: bbb.count ? `${bbb.total} KG_Nis of N-8 booked.` : 'Not booked.', bySize: bbb.bySize },
    { step: 8, slug: 'adhoc-indent', stage: 'Adhoc indent', doc: 'PPM-000735-001', present: ind.count > 0, qty: ind.total, uom: 'KG_Nis',
      detail: ind.count ? `${ind.total} KG_Nis indented against the booking.` : 'No indent line.', bySize: ind.bySize },
    { step: 9, slug: 'rmpo', stage: 'RMPO (booking)', doc: 'FAB/PPJ/Rmpo/PPS12/1229', present: po1.count > 0, qty: po1.total, uom: 'KG_Nis',
      detail: po1.count ? `${po1.total} KG_Nis ordered at 10 INR.` : 'Not ordered.', bySize: po1.bySize },
    { step: 10, slug: 'grn', stage: 'GRN – stock in', doc: 'GRN against 1229', present: grn.count > 0, qty: grn.total, uom: 'KG_Nis',
      detail: grn.count ? `${grn.total} KG_Nis accepted into ACHIEVER CUT STORE, tagged PPJ179.` : 'Nothing received.', bySize: grn.bySize },
    { step: 11, slug: 'buyer-po', stage: 'Buyer order (OC)', doc: 'GAPS.NEWOC -249.1', present: oc.count > 0, qty: oc.total, uom: 'PCS',
      detail: oc.count ? `${oc.total} PCS ordered.` : 'Not ordered by the buyer.', bySize: oc.bySize },
    { step: 12, slug: 'mrp', stage: 'MRP Level 1 (garment)', doc: 'MRP – OC GAPS.NEWOC -249.1', present: l1.count > 0, qty: l1.total, uom: 'PCS',
      detail: l1.count ? `${l1.total} PCS production demand.` : 'No demand.', bySize: l1.bySize },
    { step: 12, slug: 'mrp', stage: 'MRP Level 2 (fabric)', doc: 'MRP – N-8', present: l2.count > 0, qty: l2.total, uom: 'KG_Nis',
      detail: l2.count ? `${l2.total} KG_Nis purchase demand (× 1.5 final consumption).` : 'No demand.', bySize: l2.bySize },
    { step: 13, slug: 'production-indents', stage: 'Production indent', doc: 'PPM-000738-001', present: pi.count > 0, qty: pi.total, uom: 'KG_Nis',
      detail: pi.count ? `${pi.total} KG_Nis indented; ${adj.total} adjusted in-house from booking stock.` : 'No indent line.', bySize: pi.bySize },
    { step: 9, slug: 'rmpo', stage: 'RMPO (MRP)', doc: 'FAB/PPJ/Rmpo/PPS12/1230', present: po2.count > 0, qty: po2.total, uom: 'KG_Nis',
      detail: po2.count ? `${po2.total} KG_Nis ordered for the gap (Unconfirmed, open).` : 'Not ordered.', bySize: po2.bySize },
    { step: 14, slug: 'production-order', stage: 'Production order', doc: 'PPS12SO/11325', present: !!prodOrd, qty: prodOrd?.allocated, uom: 'PCS',
      detail: prodOrd ? `${prodOrd.allocated} PCS allocated to FPO (${prodOrd.pct} %).` : 'Not in the production order.' },
    { step: 15, slug: 'fpo', stage: 'FPO', doc: 'PPS12FP0158', present: fpo.count > 0, qty: fpo.total, uom: 'PCS',
      detail: fpo.count ? `${fpo.total} PCS in production needing ${fab.total} KG_Nis; ${open.total} KG_Nis still open.` : 'Not in production.', bySize: fpo.bySize },
    { step: 15, slug: 'fpo', stage: 'FPPO processes', doc: ROUTING_PROCESSES.map((p) => p.process).join(' → '), present: fpo.count > 0, qty: fpo.count ? fpo.total : undefined, uom: 'PCS per process',
      detail: fpo.count ? `${fpo.total} PCS required at each of ${ROUTING_PROCESSES.length} processes.` : 'No process orders.' },
  ];

  const alerts: TraceAlert[] = [];
  if (inStyle && !bomMat) alerts.push({ level: 'warn', text: 'On the style but not mapped in the BOM. If a buyer orders it, MRP will create no fabric demand.' });
  if (bomMat && !oc.count) alerts.push({ level: 'info', text: 'Mapped in the BOM but not on the current OC – no demand yet.' });
  const unreserved = grn.total - adj.total;
  if (grn.count && unreserved > 0) alerts.push({ level: 'warn', text: `${unreserved} KG_Nis of booking stock (PPJ179) is received but not reserved by any production indent.` });
  if (po2.count) alerts.push({ level: 'info', text: `${po2.total} KG_Nis is still open on RMPO 1230 – cutting for this colour is limited to ${adj.total} KG_Nis until it arrives.` });
  if (!inStyle) alerts.push({ level: 'info', text: 'Exists only in the colour card.' });

  const stockKeys = Array.from(new Set([...GRN, ...PROD_INDENT_L2].filter((r) => r.color === code).map((r) => `N-8|${code}|${r.size}`)));

  return { code, name: color.name, stages, alerts, stockKeys };
}
