// Consumption chain of a BOM line (confirmed by the WFX functional owner): Loss → Wastage → Shrinkage.
// No imports: also bundled by scripts/export-data.ts.

export interface ConsChain { lossFactor: number; inclLoss: number; inclWastage: number; inclShrinkage: number; total: number; }

const pct = (n: number) => Math.min(Math.max(n || 0, 0), 99.9999) / 100;

/** Cons × 1/(1−Loss%) → + Wastage % → ÷ (1−Shrinkage %). A zero percentage leaves that step out. */
export function consChain(cons: number, lossPct: number, wastagePct: number, shrinkagePct: number): ConsChain {
  const lossFactor = 1 / (1 - pct(lossPct));
  const inclLoss = cons * lossFactor;
  const inclWastage = inclLoss + inclLoss * pct(wastagePct);
  const inclShrinkage = inclWastage / (1 - pct(shrinkagePct));
  return { lossFactor, inclLoss, inclWastage, inclShrinkage, total: inclShrinkage };
}
