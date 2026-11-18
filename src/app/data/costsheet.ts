import { consChain } from './cons';
import { BOM_59, BomLine59, COSTING_59, ROUTING_59 } from './records';

/** Editable inputs of a BOM cost sheet. Defaults = Adi TShirt (NIS-59) #1 DP as captured from WFX. */
export interface CsLineIn {
  line: number; section: 'Fabric' | 'Trim'; article: string; name: string; purchaseUom: string; consUom: string; process: string;
  totalCons: number; perItem: number; wastagePct: number; lossPct: number; shrinkagePct: number; purchasePrice: number; conversion: number;
}
export interface CsProcIn { seq: number; process: string; costOf: number; productionTime: number; }
export interface CsInput { lines: CsLineIn[]; processes: CsProcIn[]; sellingPrice: number; discountPct: number; targetProfitPct: number; }

export interface CsLineOut extends CsLineIn { consQty: number; lossFactor: number; inclLoss: number; inclWastage: number; finalCons: number; consUomPrice: number; value: number; }
export interface CsProcOut extends CsProcIn { rate: number; materials: string[]; }
export interface CsResult {
  lines: CsLineOut[];
  sections: { name: string; total: number }[];
  processes: CsProcOut[];
  materialCost: number; productionCost: number; totalCost: number;
  discountAmt: number; netSelling: number; profit: number; profitPct: number; markup: number; markupPct: number;
  targetGap: number;
}

const r = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export const defaultCostSheet = (): CsInput => ({
  lines: BOM_59.map((l: BomLine59) => ({
    line: l.line, section: l.section, article: l.article, name: l.name, purchaseUom: l.purchaseUom, consUom: l.consUom, process: l.process,
    totalCons: l.totalCons, perItem: l.perItem, wastagePct: l.wastagePct, lossPct: l.lossPct, shrinkagePct: 0, purchasePrice: l.purchasePrice, conversion: l.conversion,
  })),
  processes: ROUTING_59.map((p) => ({ seq: p.seq, process: p.process, costOf: p.costOf, productionTime: p.productionTime })),
  sellingPrice: COSTING_59.sellingPrice,
  discountPct: COSTING_59.discountPct,
  targetProfitPct: COSTING_59.targetProfitPct,
});

export function computeCostSheet(i: CsInput): CsResult {
  const lines = i.lines.map((l) => {
    const consQty = l.perItem ? l.totalCons / l.perItem : 0;
    const ch = consChain(consQty, l.lossPct, l.wastagePct, l.shrinkagePct);  // verified: loss → wastage → shrinkage
    const { inclWastage, inclLoss, lossFactor } = ch;
    const finalCons = ch.total;
    const consUomPrice = l.purchasePrice * l.conversion;                     // verified
    const value = finalCons * consUomPrice;                                  // verified
    return { ...l, consQty: r(consQty), lossFactor: r(lossFactor, 6), inclLoss: r(inclLoss, 6), inclWastage: r(inclWastage, 6), finalCons: r(finalCons, 6), consUomPrice: r(consUomPrice), value: r(value, 2) };
  });
  const sectionNames = [...new Set(lines.map((l) => l.section))];
  const sections = sectionNames.map((name) => ({ name, total: r(lines.filter((l) => l.section === name).reduce((a, l) => a + l.value, 0), 2) }));
  const processes = i.processes.map((p) => ({
    ...p, rate: r(p.costOf * p.productionTime, 2),                            // Cost Of × Production Time
    materials: lines.filter((l) => l.process === p.process).map((l) => l.article),
  }));
  const materialCost = r(sections.reduce((a, s) => a + s.total, 0), 2);
  const productionCost = r(processes.reduce((a, p) => a + p.rate, 0), 2);
  const totalCost = r(materialCost + productionCost, 2);
  const discountAmt = r(i.sellingPrice * i.discountPct / 100, 2);
  const netSelling = r(i.sellingPrice - discountAmt, 2);
  const profit = r(netSelling - totalCost, 2);
  const profitPct = netSelling ? r(profit / netSelling * 100, 2) : 0;
  const markup = r(i.sellingPrice - totalCost, 2);
  const markupPct = totalCost ? r(markup / totalCost * 100, 2) : 0;
  return { lines, sections, processes, materialCost, productionCost, totalCost, discountAmt, netSelling, profit, profitPct, markup, markupPct, targetGap: r(profitPct - i.targetProfitPct, 2) };
}

/** Values WFX showed for Adi TShirt (NIS-59) – used to prove the engine reproduces the screen. */
export const WFX_59 = { ...COSTING_59.wfx, productionCost: 325 };
