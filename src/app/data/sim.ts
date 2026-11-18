import { COLORS, SIZES } from './catalog';
import { BBB_MATERIAL, OC_BREAKUP } from './records';

/** Status of the Adhoc Indent at the moment the Buyer Block Booking is linked to a sales order. */
export type IndentStatus = 'none' | 'po' | 'asn' | 'grn';

export interface SimInput {
  /** Garments booked per BBB SKU line. */
  bbbQtyPerSku: number;
  /** Consumption applied on the booking (Auto MRP configuration). Flannel Shirt Adi (NIS-58) booked 100 KG for 100 pcs → 1. */
  bbbCons: number;
  /** BOM final consumption used by MRP for the sales order. */
  bomCons: number;
  /** Total sales-order quantity (split over colour/size like OC GAPS.NEWOC -249.1). */
  soQty: number;
  linked: boolean;
  status: IndentStatus;
  /** % of the ordered quantity shipped (ASN) or received (GRN). Partial adjustment is supported. */
  progressPct: number;
}

export const DEFAULT_SIM: SimInput = {
  bbbQtyPerSku: 100,
  bbbCons: 1,
  bomCons: 1.5,
  soQty: 1000,
  linked: true,
  status: 'grn',
  progressPct: 100,
};

export interface SkuRow {
  key: string;
  color: string;
  colorName: string;
  size: string;
  bbbReq: number;
  available: number;
  soPcs: number;
  soFabric: number;
  adjusted: number;
  toBuy: number;
  inOrder: boolean;
}

export type AdjType = 'In-House Adjustment' | 'On Order Adjustment' | 'No adjustment';

export interface SimResult {
  input: SimInput;
  rows: SkuRow[];
  bbbTotal: number;
  bbbValue: number;
  adhocQty: number;
  poQty: number;
  asnQty: number;
  grnQty: number;
  availableTotal: number;
  soPcs: number;
  soFabric: number;
  adjusted: number;
  adjType: AdjType;
  toBuy: number;
  unreserved: number;
  bbbRate: number;
}

const OC_TOTAL = OC_BREAKUP.reduce((a, l) => a + l.qty, 0);
const round = (n: number) => Math.round(n * 100) / 100;
const colorName = (c: string) => COLORS.find((x) => x.code === c)?.name ?? c;
const sizeName = (s: string) => SIZES.find((x) => x.code === s)?.display ?? s;

export function simulate(i: SimInput): SimResult {
  const pct = Math.min(100, Math.max(0, i.progressPct)) / 100;
  const share = i.status === 'none' ? 0 : i.status === 'po' ? 1 : pct;
  const bbbRate = BBB_MATERIAL[0]?.rate ?? 0;

  const bbb = BBB_MATERIAL.map((l) => {
    const req = round(i.bbbQtyPerSku * i.bbbCons);
    return { color: l.color, size: l.size, req, available: round(req * share) };
  });

  const keys = new Set([...bbb.map((b) => `${b.color}|${b.size}`), ...OC_BREAKUP.map((o) => `${o.color}|${o.size}`)]);
  const rows: SkuRow[] = [...keys].map((key) => {
    const [color, size] = key.split('|');
    const b = bbb.find((x) => x.color === color && x.size === size);
    const o = OC_BREAKUP.find((x) => x.color === color && x.size === size);
    const soPcs = o ? round((o.qty / OC_TOTAL) * i.soQty) : 0;
    const soFabric = round(soPcs * i.bomCons);
    const available = b?.available ?? 0;
    const adjusted = i.linked && o ? round(Math.min(soFabric, available)) : 0;
    return {
      key: `N-8|${color}|${size}`, color, colorName: colorName(color), size: sizeName(size),
      bbbReq: b?.req ?? 0, available, soPcs, soFabric, adjusted, toBuy: round(soFabric - adjusted), inOrder: !!o,
    };
  });

  const sum = (f: (r: SkuRow) => number) => round(rows.reduce((a, r) => a + f(r), 0));
  const bbbTotal = sum((r) => r.bbbReq);
  const adjusted = sum((r) => r.adjusted);
  const adjType: AdjType = !i.linked || i.status === 'none' || adjusted === 0
    ? 'No adjustment' : i.status === 'grn' ? 'In-House Adjustment' : 'On Order Adjustment';

  return {
    input: i,
    rows,
    bbbTotal,
    bbbValue: round(bbbTotal * bbbRate),
    adhocQty: bbbTotal,
    poQty: i.status === 'none' ? 0 : bbbTotal,
    asnQty: i.status === 'asn' || i.status === 'grn' ? round(bbbTotal * (i.status === 'asn' ? pct : 1)) : 0,
    grnQty: i.status === 'grn' ? round(bbbTotal * pct) : 0,
    availableTotal: sum((r) => r.available),
    soPcs: sum((r) => r.soPcs),
    soFabric: sum((r) => r.soFabric),
    adjusted,
    adjType,
    toBuy: sum((r) => r.toBuy),
    unreserved: round(sum((r) => r.available) - adjusted),
    bbbRate,
  };
}

export const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 2 });
