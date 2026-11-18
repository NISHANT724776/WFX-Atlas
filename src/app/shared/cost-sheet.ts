import { ChangeDetectionStrategy, Component, computed, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { CsInput, WFX_59, computeCostSheet, defaultCostSheet } from '../data/costsheet';

type LineKey = 'totalCons' | 'perItem' | 'wastagePct' | 'lossPct' | 'shrinkagePct' | 'purchasePrice';
type ProcKey = 'costOf' | 'productionTime';
type HeadKey = 'sellingPrice' | 'discountPct' | 'targetProfitPct';

@Component({
  selector: 'app-cost-sheet',
  imports: [DecimalPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="cs" aria-labelledby="cs-title">
      <div class="cs-head">
        <div>
          <p class="eyebrow">Live WFX capture · Adi TShirt (NIS-59) · Production BOM #1 DP V1</p>
          <h2 id="cs-title">Interactive BOM cost sheet</h2>
          <p class="muted small">Change any white field. Every column, section total, process rate and the profit and markup recalculate exactly like the WFX Materials, Routing and Cost tabs.</p>
        </div>
        <div class="cs-head-side">
          <span class="badge" [class]="matches() ? 'verified' : 'assumed'">{{ matches() ? 'Matches the WFX screen' : 'Edited – differs from WFX' }}</span>
          <button type="button" class="btn" (click)="reset()">Reset to WFX values</button>
        </div>
      </div>

      <h3 class="cs-step"><span>1</span> Materials tab</h3>
      <p class="cs-formula">Cons Qty = Total Cons ÷ Cons per Item <b>→</b> Cons incl Loss = Cons × 1/(1 − Loss %) <b>→</b> incl Wastage = incl Loss + incl Loss × Wastage % <b>→</b> Final = incl Wastage ÷ (1 − Shrinkage %) <b>→</b> Value = Final × Purchase Price × Factor</p>
      <div class="table-scroll cs-table">
        <table>
          <thead>
            <tr>
              <th scope="col">Line</th><th scope="col">Article</th><th scope="col">Cons UOM</th>
              <th scope="col" class="in">Total cons</th><th scope="col" class="in">Per item</th><th scope="col">Cons qty</th>
              <th scope="col" class="in">Loss %</th><th scope="col">Incl loss</th><th scope="col" class="in">Wastage %</th><th scope="col">Incl wastage</th><th scope="col" class="in">Shrinkage %</th><th scope="col">Final cons</th>
              <th scope="col" class="in">Purchase price</th><th scope="col">Factor</th><th scope="col">Cons UOM price</th><th scope="col">Value</th><th scope="col">Process</th>
            </tr>
          </thead>
          @for (sec of res().sections; track sec.name) {
            <tbody>
              <tr class="cs-sec"><th colspan="15" scope="rowgroup">{{ sec.name }} section</th><td class="num"><strong>{{ sec.total | number: '1.2-2' }}</strong></td><td></td></tr>
              @for (l of linesOf(sec.name); track l.line; let i = $index) {
                <tr>
                  <td>{{ l.line }}</td>
                  <td><strong>{{ l.article }}</strong><span class="block muted small">{{ l.name }}</span></td>
                  <td>{{ l.consUom }}</td>
                  <td class="in"><input type="number" step="0.1" min="0" [value]="l.totalCons" (input)="setLine(l.line, 'totalCons', $event)" [attr.aria-label]="l.article + ' total cons'" /></td>
                  <td class="in"><input type="number" step="1" min="1" [value]="l.perItem" (input)="setLine(l.line, 'perItem', $event)" [attr.aria-label]="l.article + ' cons per item'" /></td>
                  <td class="num">{{ l.consQty | number: '1.4-4' }}</td>
                  <td class="in"><input type="number" step="0.5" min="0" max="99" [value]="l.lossPct" (input)="setLine(l.line, 'lossPct', $event)" [attr.aria-label]="l.article + ' loss %'" /></td>
                  <td class="num">{{ l.inclLoss | number: '1.4-4' }}</td>
                  <td class="in"><input type="number" step="0.5" min="0" [value]="l.wastagePct" (input)="setLine(l.line, 'wastagePct', $event)" [attr.aria-label]="l.article + ' wastage %'" /></td>
                  <td class="num">{{ l.inclWastage | number: '1.4-4' }}</td>
                  <td class="in"><input type="number" step="0.5" min="0" max="99" [value]="l.shrinkagePct" (input)="setLine(l.line, 'shrinkagePct', $event)" [attr.aria-label]="l.article + ' shrinkage %'" /></td>
                  <td class="num"><strong>{{ l.finalCons | number: '1.4-6' }}</strong></td>
                  <td class="in"><input type="number" step="0.5" min="0" [value]="l.purchasePrice" (input)="setLine(l.line, 'purchasePrice', $event)" [attr.aria-label]="l.article + ' purchase price'" /></td>
                  <td class="num">{{ l.conversion | number }}</td>
                  <td class="num">{{ l.consUomPrice | number: '1.2-2' }}</td>
                  <td class="num"><strong>{{ l.value | number: '1.2-2' }}</strong></td>
                  <td>{{ l.process }}</td>
                </tr>
              }
            </tbody>
          }
        </table>
      </div>

      <h3 class="cs-step"><span>2</span> Routing tab – processes, operations, material linkage</h3>
      <p class="cs-formula">Process Rate = Cost Of × Production Time <span class="badge assumed">confirm × vs +</span></p>
      <div class="cs-procs">
        @for (p of res().processes; track p.seq) {
          <div class="cs-proc">
            <span class="cs-proc-n">{{ p.seq }}</span>
            <strong>{{ p.process }}</strong>
            <label>Cost Of <input type="number" step="0.5" min="0" [value]="p.costOf" (input)="setProc(p.seq, 'costOf', $event)" /></label>
            <label>Production time <input type="number" step="1" min="0" [value]="p.productionTime" (input)="setProc(p.seq, 'productionTime', $event)" /></label>
            <span class="cs-rate">{{ p.costOf | number }} × {{ p.productionTime | number }} = <strong>{{ p.rate | number: '1.2-2' }}</strong></span>
            <span class="cs-links">@for (m of p.materials; track m) { <span class="chip-link">{{ m }}</span> } @empty { <span class="muted small">no material linked</span> }</span>
          </div>
        }
      </div>

      <h3 class="cs-step"><span>3</span> Cost tab</h3>
      <div class="cs-summary">
        <div class="cs-tile"><span>Material cost</span><strong>{{ res().materialCost | number: '1.2-2' }}</strong><em>{{ sectionText() }}</em></div>
        <div class="cs-tile"><span>Production cost</span><strong>{{ res().productionCost | number: '1.2-2' }}</strong><em>Σ process rates</em></div>
        <div class="cs-tile key"><span>Total cost</span><strong>{{ res().totalCost | number: '1.2-2' }}</strong><em>material + production (+ recipe, indirect, CM = 0)</em></div>
        <label class="cs-tile edit"><span>Selling price</span><input type="number" step="50" min="0" [value]="input().sellingPrice" (input)="setHead('sellingPrice', $event)" /><em>price the apparel is sold at</em></label>
        <label class="cs-tile edit"><span>Discount %</span><input type="number" step="1" min="0" max="100" [value]="input().discountPct" (input)="setHead('discountPct', $event)" /><em>= {{ res().discountAmt | number: '1.2-2' }} off → net {{ res().netSelling | number: '1.2-2' }}</em></label>
        <div class="cs-tile" [class.neg]="res().profit < 0"><span>Profit</span><strong>{{ res().profitPct | number: '1.2-2' }} %</strong><em>{{ res().netSelling | number: '1.2-2' }} − {{ res().totalCost | number: '1.2-2' }} = {{ res().profit | number: '1.2-2' }} · ÷ net selling</em></div>
        <label class="cs-tile edit"><span>Target profit %</span><input type="number" step="1" [value]="input().targetProfitPct" (input)="setHead('targetProfitPct', $event)" /><em>gap {{ res().targetGap | number: '1.2-2' }} pts</em></label>
        <div class="cs-tile" [class.neg]="res().markup < 0"><span>Markup</span><strong>{{ res().markupPct | number: '1.2-2' }} %</strong><em>{{ input().sellingPrice | number: '1.2-2' }} − {{ res().totalCost | number: '1.2-2' }} = {{ res().markup | number: '1.2-2' }} · ÷ total cost (before discount)</em></div>
      </div>

      <details class="cs-check" [open]="!matches()">
        <summary>Check against the WFX screen ({{ checks().length - mismatches() }} of {{ checks().length }} match)</summary>
        <ul>
          @for (c of checks(); track c.label) {
            <li [class.bad]="!c.ok"><span>{{ c.ok ? '✓' : '✕' }}</span> {{ c.label }}: {{ c.mine | number: '1.2-2' }} <span class="muted">· WFX {{ c.wfx | number: '1.2-2' }}</span></li>
          }
        </ul>
      </details>
      <p class="small muted">Formulas and open questions: <a routerLink="/calculations">formula library</a>.</p>
    </section>
  `,
})
export class CostSheet {
  protected readonly input = signal<CsInput>(defaultCostSheet());
  protected readonly res = computed(() => computeCostSheet(this.input()));

  protected readonly checks = computed(() => {
    const r = this.res();
    const fab = r.sections.find((s) => s.name === 'Fabric')?.total ?? 0;
    const trim = r.sections.find((s) => s.name === 'Trim')?.total ?? 0;
    return [
      { label: 'Fabric section total', mine: fab, wfx: WFX_59.fabricTotal },
      { label: 'Trim section total', mine: trim, wfx: WFX_59.trimTotal },
      { label: 'Production cost', mine: r.productionCost, wfx: WFX_59.productionCost },
      { label: 'Total cost', mine: r.totalCost, wfx: WFX_59.totalCost },
      { label: 'Discount amount', mine: r.discountAmt, wfx: WFX_59.discountAmt },
      { label: 'Profit', mine: r.profit, wfx: WFX_59.profit },
      { label: 'Profit %', mine: r.profitPct, wfx: WFX_59.profitPct },
      { label: 'Markup', mine: r.markup, wfx: WFX_59.markup },
      { label: 'Markup %', mine: r.markupPct, wfx: WFX_59.markupPct },
    ].map((c) => ({ ...c, ok: Math.abs(c.mine - c.wfx) < 0.006 }));
  });
  protected readonly mismatches = computed(() => this.checks().filter((c) => !c.ok).length);
  protected readonly matches = computed(() => this.mismatches() === 0);
  protected readonly sectionText = computed(() => this.res().sections.map((s) => `${s.name} ${s.total.toLocaleString('en-US', { maximumFractionDigits: 2 })}`).join(' + '));

  protected linesOf(section: string) {
    return this.res().lines.filter((l) => l.section === section);
  }
  private num(ev: Event): number {
    const v = parseFloat((ev.target as HTMLInputElement).value);
    return Number.isFinite(v) ? v : 0;
  }
  protected setLine(line: number, key: LineKey, ev: Event): void {
    const v = this.num(ev);
    this.input.update((i) => ({ ...i, lines: i.lines.map((l) => (l.line === line ? { ...l, [key]: v } : l)) }));
  }
  protected setProc(seq: number, key: ProcKey, ev: Event): void {
    const v = this.num(ev);
    this.input.update((i) => ({ ...i, processes: i.processes.map((p) => (p.seq === seq ? { ...p, [key]: v } : p)) }));
  }
  protected setHead(key: HeadKey, ev: Event): void {
    const v = this.num(ev);
    this.input.update((i) => ({ ...i, [key]: v }));
  }
  protected reset(): void {
    this.input.set(defaultCostSheet());
  }
}
