import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { DEFAULT_SIM, IndentStatus, SimInput, SimResult, fmt } from '../data/sim';

type NumKey = 'bbbQtyPerSku' | 'bbbCons' | 'bomCons' | 'soQty';

@Component({
  selector: 'app-sim-panel',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="rail-card sim" aria-labelledby="sim-title">
      <div class="rail-head">
        <h2 id="sim-title" class="rail-title">Try a scenario</h2>
        <button type="button" class="linkish small" (click)="reset()">Reset to WFX values</button>
      </div>

      <p class="sim-label">Adhoc Indent status when the booking is linked</p>
      <div class="seg-row" role="radiogroup" aria-label="Adhoc Indent status">
        @for (s of statuses; track s.id) {
          <button type="button" role="radio" class="seg-sm" [class.on]="input().status === s.id" [attr.aria-checked]="input().status === s.id" (click)="set('status', s.id)">{{ s.label }}</button>
        }
      </div>

      <label class="sim-range" [class.off]="input().status === 'none' || input().status === 'po'">
        <span>{{ input().status === 'asn' ? 'Shipped on ASN' : 'Received on GRN' }} <strong>{{ input().progressPct }} %</strong></span>
        <input type="range" min="0" max="100" step="5" [value]="input().progressPct" [disabled]="input().status === 'none' || input().status === 'po'"
               (input)="setNum('progressPct', $event)" aria-label="Percent shipped or received" />
      </label>

      <label class="switch">
        <input type="checkbox" [checked]="input().linked" (change)="set('linked', $any($event.target).checked)" />
        <span class="track" aria-hidden="true"><span></span></span>
        Booking linked to the sales order
      </label>

      <details class="sim-more">
        <summary>Quantities</summary>
        @for (f of fields; track f.key) {
          <label class="sim-num"><span>{{ f.label }}</span>
            <input type="number" inputmode="decimal" [attr.min]="0" [attr.step]="f.step" [value]="input()[f.key]" (input)="setNum(f.key, $event)" /></label>
        }
      </details>

      @if (result(); as r) {
        <dl class="sim-out">
          <div><dt>Booked (BBB)</dt><dd>{{ f(r.bbbTotal) }} KG</dd></div>
          <div><dt>Order needs</dt><dd>{{ f(r.soFabric) }} KG</dd></div>
          <div class="hl"><dt>{{ r.adjType }}</dt><dd>{{ f(r.adjusted) }} KG</dd></div>
          <div><dt>Still to buy</dt><dd>{{ f(r.toBuy) }} KG</dd></div>
          @if (r.unreserved > 0) { <div class="warn"><dt>Booking stock left unreserved</dt><dd>{{ f(r.unreserved) }} KG</dd></div> }
        </dl>
      }
    </section>
  `,
})
export class SimPanel {
  readonly input = input.required<SimInput>();
  readonly result = input.required<SimResult>();
  readonly simChange = output<SimInput>();

  protected readonly statuses: { id: IndentStatus; label: string }[] = [
    { id: 'none', label: 'Not ordered' }, { id: 'po', label: 'PO created' }, { id: 'asn', label: 'ASN done' }, { id: 'grn', label: 'GRN done' },
  ];
  protected readonly fields: { key: NumKey; label: string; step: number }[] = [
    { key: 'bbbQtyPerSku', label: 'BBB qty per colour/size', step: 10 },
    { key: 'bbbCons', label: 'Cons used on BBB', step: 0.1 },
    { key: 'bomCons', label: 'BOM final consumption', step: 0.1 },
    { key: 'soQty', label: 'Sales order qty (pcs)', step: 100 },
  ];

  protected f(n: number): string { return fmt(n); }
  protected set<K extends keyof SimInput>(k: K, v: SimInput[K]): void {
    this.simChange.emit({ ...this.input(), [k]: v });
  }
  protected setNum(k: NumKey | 'progressPct', ev: Event): void {
    const v = parseFloat((ev.target as HTMLInputElement).value);
    this.simChange.emit({ ...this.input(), [k]: Number.isFinite(v) && v >= 0 ? v : 0 });
  }
  protected reset(): void {
    this.simChange.emit({ ...DEFAULT_SIM });
  }
}
