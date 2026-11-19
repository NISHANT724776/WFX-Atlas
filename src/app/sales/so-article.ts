// One article of a delivery: BOM / price source / routing, Extra Production %, its quantity grids (first, Add Qty,
// Additional Qty) as colour × size matrices. Prepack types take a PP per colour and size ratios (PCS = PP × ratio).
// Upcharge (+) / discount (−) is entered at the Price Per level from the tech pack. Kit articles stay in grid view.
import { ChangeDetectionStrategy, Component, computed, effect, inject, input, output, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SoApi, type Breakup, type Line, type OrderDetail } from './so-api';

const PACKING = ['Solid Color / Solid Size', 'Solid Color / Assorted Size', 'Multiple Prepack'];
interface Grid { packing: string; code: string; prepack: string; cartons: number | null; inseam: string; v: Record<string, number | undefined>; pp: Record<string, number | undefined>; up: Record<string, number | undefined> }

@Component({
  selector: 'so-article',
  imports: [FormsModule, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let l = line();
    <article class="so-art" [class.open]="open()">
      <header class="so-art-head">
        <button type="button" class="so-caret" [attr.aria-expanded]="open()" (click)="open.set(!open())" [attr.aria-label]="(open() ? 'Collapse ' : 'Expand ') + l.name">{{ open() ? '▾' : '▸' }}</button>
        <strong>{{ l.name }}</strong> <code class="so-code">{{ l.article }}</code>
        @if (l.isKit) { <span class="so-chip" title="Kit articles stay in grid view">Kit {{ l.kitName }} · {{ l.kitId }}</span> }
        @if (l.desynced) { <span class="so-chip" data-s="Desynced" [title]="'Cost sheet price is ' + l.sourcePrice">Desynced</span> }
        <span class="so-spacer"></span>
        <span class="small muted">{{ l.totals.qty | number }} pcs · {{ l.totals.value | number: '1.2-2' }}</span>
        @if (!l.isKit) {
          <div class="so-seg small" role="group" aria-label="View"><button type="button" [class.on]="view() === 'grid'" (click)="view.set('grid')">Grid</button><button type="button" [class.on]="view() === 'table'" (click)="view.set('table')">Table</button></div>
        }
        @if (editable()) {
          <button type="button" class="btn small" (click)="addQty(false)" title="Add another quantity breakup under this article">+ Add Qty</button>
          @if (!hasAdditional()) { <button type="button" class="btn small" (click)="addQty(true)">+ Additional Qty</button> }
          <button type="button" class="btn small" (click)="remove()">Delete</button>
        }
      </header>
      @if (open()) {
        <div class="so-art-meta">
          <label>BOM
            <select [ngModel]="l.bom_selected ? l.bom_id : ''" (ngModelChange)="setBom($event)" [disabled]="!editable()">
              <option value="">Automatic ({{ autoBom() }})</option>
              @for (b of approvedBoms(); track b.id) { <option [value]="b.id">{{ b.bom_no }} v{{ b.version }} · {{ b.selling_price | number: '1.2-4' }}</option> }
            </select></label>
          <div><span class="so-k">Price per</span><span>{{ l.price_per }}</span></div>
          <div><span class="so-k">Base price</span><span>{{ l.base_price | number: '1.2-4' }}</span></div>
          <div><span class="so-k">Price from</span><span class="small">{{ l.price_source }}</span></div>
          <div><span class="so-k">Routing</span><span>{{ l.routing || '–' }}</span></div>
          <label>Extra Production % <input type="number" min="0" max="100" step="0.5" [ngModel]="l.extra_production_pct" (change)="setExtra($any($event.target).value)" [disabled]="!editable()" /></label>
          <div><span class="so-k">Planned qty</span><span>{{ l.totals.planned | number }}</span></div>
          @if (l.totals.additional) { <div><span class="so-k">Additional qty</span><span>{{ l.totals.additional | number }}</span></div> }
        </div>
        @for (b of l.breakups; track b.id) {
          @let g = grids()[b.id];
          @if (g) {
          <section class="so-break">
            <div class="so-break-head">
              <strong class="small">{{ b.additional ? 'Additional Qty' : b.seq === 1 ? 'Article Qty Breakup' : 'Add Qty ' + (b.seq - 1) }}</strong>
              <label>Packing Type <select [(ngModel)]="g.packing" [name]="'pt' + b.id" [disabled]="!editable() || b.seq !== 1" [title]="b.seq !== 1 ? 'Frozen to the article’s packing type' : ''">@for (p of packing; track p) { <option [value]="p">{{ p }}</option> }</select></label>
              <label>Packing Code (SKU) <input [(ngModel)]="g.code" [name]="'pc' + b.id" [disabled]="!editable()" /></label>
              @if (g.packing !== packing[0]) { <label>Prepack Code <input [(ngModel)]="g.prepack" [name]="'pp' + b.id" [disabled]="!editable()" /></label> }
              <label>No. of Cartons <input type="number" min="0" [(ngModel)]="g.cartons" [name]="'ct' + b.id" [disabled]="!editable()" /></label>
              @if (l.inseams.length) { <label>Inseam <select [(ngModel)]="g.inseam" [name]="'in' + b.id" [disabled]="!editable()"><option value="">–</option>@for (i of l.inseams; track i) { <option [value]="i">{{ i }}</option> }</select></label> }
              @if (l.price_per === 'Article') { <label>Upcharge (+) / Discount (−) <input type="number" step="0.01" [ngModel]="g.up['*'] ?? 0" (ngModelChange)="g.up['*'] = +$event" [name]="'ua' + b.id" [disabled]="!editable()" /></label> }
              <span class="so-spacer"></span>
              <span class="small">PCS <strong>{{ pcs(l, g) | number }}</strong></span>
              @if (b.seq !== 1 && editable()) { <button type="button" class="btn small" (click)="delBreakup(b)">Remove grid</button> }
            </div>
            @if (view() === 'grid' || l.isKit) {
              <div class="so-scroll">
                <table class="so-matrix">
                  <thead><tr><th>Colour</th>@if (g.packing !== packing[0]) { <th>PP</th> }@for (s of l.sizes; track s.code) { <th class="num">{{ s.name }}<br /><span class="muted small">{{ s.code }}</span></th> }
                    @if (l.price_per === 'Color') { <th>Upcharge</th> }<th class="num">Total Qty</th><th class="num">Selling Price</th><th class="num">Value</th></tr></thead>
                  <tbody>
                    @if (l.price_per === 'Size') {
                      <tr class="so-uprow"><td>Upcharge</td>@if (g.packing !== packing[0]) { <td></td> }@for (s of l.sizes; track s.code) { <td><input type="number" step="0.01" [ngModel]="g.up[s.code] ?? 0" (ngModelChange)="g.up[s.code] = +$event" [disabled]="!editable()" [attr.aria-label]="'Upcharge for ' + s.code" /></td> }<td></td><td></td><td></td></tr>
                    }
                    @for (c of l.colours; track c.code) {
                      <tr>
                        <th scope="row">{{ c.name }} <span class="muted small">{{ c.code }}</span></th>
                        @if (g.packing !== packing[0]) { <td><input type="number" min="0" [ngModel]="g.pp[c.code] ?? null" (ngModelChange)="g.pp[c.code] = +$event" [disabled]="!editable()" [attr.aria-label]="'PP for ' + c.name" /></td> }
                        @for (s of l.sizes; track s.code) {
                          <td><input type="number" min="0" [ngModel]="g.v[c.code + '|' + s.code] ?? null" (ngModelChange)="g.v[c.code + '|' + s.code] = +$event" [disabled]="!editable()" [attr.aria-label]="(g.packing !== packing[0] ? 'Ratio ' : 'Qty ') + c.name + ' ' + s.code" /></td>
                        }
                        @if (l.price_per === 'Color') { <td><input type="number" step="0.01" [ngModel]="g.up[c.code] ?? 0" (ngModelChange)="g.up[c.code] = +$event" [disabled]="!editable()" [attr.aria-label]="'Upcharge for ' + c.name" /></td> }
                        <td class="num">{{ rowQty(l, g, c.code) | number }}</td>
                        <td class="num">{{ rowPrice(l, g, c.code) | number: '1.2-4' }}</td>
                        <td class="num">{{ rowValue(l, g, c.code) | number: '1.2-2' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            } @else {
              <table class="so-grid"><thead><tr><th>Colour</th><th>Size</th><th class="num">Qty</th><th class="num">Selling Price</th><th class="num">Value</th></tr></thead>
                <tbody>@for (cell of b.cells; track cell.colour + cell.size) { <tr><td>{{ cell.colour }}</td><td>{{ cell.size }}</td><td class="num">{{ cell.qty | number }}</td><td class="num">{{ l.base_price + cell.upcharge | number: '1.2-4' }}</td><td class="num">{{ cell.qty * (l.base_price + cell.upcharge) | number: '1.2-2' }}</td></tr> }
                  @empty { <tr><td colspan="5" class="muted small">No quantities saved yet.</td></tr> }</tbody></table>
            }
            @if (g.packing !== packing[0]) { <p class="small muted">Enter the number of prepacks (PP) per colour and the size ratio of one prepack; pieces = PP × ratio.{{ g.packing === packing[1] ? ' One colour only.' : '' }}</p> }
            @if (editable()) { <div class="so-actions"><button type="button" class="btn small primary" [disabled]="busy()" (click)="save(b)">Save quantities</button></div> }
          </section>
          }
        }
      }
      @if (err()) { <p class="small kb-bad" role="alert">{{ err() }}</p> }
    </article>
  `,
})
export class SoArticle {
  private readonly api = inject(SoApi);
  readonly line = input.required<Line>();
  readonly editable = input(false);
  readonly changed = output<OrderDetail>();
  protected readonly packing = PACKING;
  protected readonly open = signal(true);
  protected readonly view = signal<'grid' | 'table'>('grid');
  protected readonly busy = signal(false);
  protected readonly err = signal('');
  protected readonly grids = signal<Record<number, Grid>>({});
  protected readonly approvedBoms = computed(() => this.line().boms.filter((b) => b.status === 'Approved'));
  protected readonly hasAdditional = computed(() => this.line().breakups.some((b) => b.additional));
  protected readonly autoBom = computed(() => { const b = this.line().boms.find((x) => x.status === 'Approved' && x.accepted); return b ? `latest accepted ${b.bom_no}` : 'no accepted BOM'; });

  constructor() {
    // fresh editable copies whenever the server sends the line again
    effect(() => {
      const l = this.line();
      const out: Record<number, Grid> = {};
      for (const b of l.breakups) out[b.id] = this.toGrid(l, b);
      this.grids.set(out);
    });
  }

  private toGrid(l: Line, b: Breakup): Grid {
    const g: Grid = { packing: b.packing_type, code: b.packing_code, prepack: b.prepack_code, cartons: b.cartons, inseam: b.inseam, v: {}, pp: {}, up: {} };
    for (const c of b.cells) {
      const prepack = b.packing_type !== PACKING[0];
      g.v[`${c.colour}|${c.size}`] = prepack ? c.ratio ?? 0 : c.qty;
      if (prepack && c.pp) g.pp[c.colour] = c.pp;
      g.up[this.upKey(l, c.colour, c.size)] = c.upcharge;
    }
    return g;
  }
  private upKey(l: Line, colour: string, size: string): string { return l.price_per === 'Article' ? '*' : l.price_per === 'Color' ? colour : l.price_per === 'Size' ? size : `${colour}|${size}`; }
  private cellQty(g: Grid, colour: string, size: string): number { const v = g.v[`${colour}|${size}`] ?? 0; return g.packing === PACKING[0] ? v : (g.pp[colour] ?? 0) * v; }
  protected rowQty(l: Line, g: Grid, colour: string): number { return l.sizes.reduce((s, z) => s + this.cellQty(g, colour, z.code), 0); }
  protected rowValue(l: Line, g: Grid, colour: string): number { return l.sizes.reduce((s, z) => s + this.cellQty(g, colour, z.code) * (l.base_price + (g.up[this.upKey(l, colour, z.code)] ?? 0)), 0); }
  protected rowPrice(l: Line, g: Grid, colour: string): number { const q = this.rowQty(l, g, colour); return q ? this.rowValue(l, g, colour) / q : l.base_price + (g.up[this.upKey(l, colour, l.sizes[0]?.code ?? '')] ?? 0); }
  protected pcs(l: Line, g: Grid): number { return l.colours.reduce((s, c) => s + this.rowQty(l, g, c.code), 0); }

  private async run(fn: () => Promise<{ order: OrderDetail }>): Promise<void> {
    this.busy.set(true);
    this.err.set('');
    try { this.changed.emit((await fn()).order); } catch (e) { this.err.set((e as Error).message); } finally { this.busy.set(false); }
  }
  protected save(b: Breakup): void {
    const l = this.line();
    const g = this.grids()[b.id];
    const prepack = g.packing !== PACKING[0];
    const cells: { colour: string; size: string; qty?: number; ratio?: number; pp?: number; upcharge: number }[] = [];
    for (const c of l.colours) for (const s of l.sizes) {
      const v = g.v[`${c.code}|${s.code}`] ?? 0;
      if (!(v > 0)) continue;
      cells.push({ colour: c.code, size: s.code, qty: prepack ? undefined : v, ratio: prepack ? v : undefined, pp: prepack ? g.pp[c.code] ?? 0 : undefined, upcharge: g.up[this.upKey(l, c.code, s.code)] ?? 0 });
    }
    void this.run(() => this.api.saveBreakup(b.id, { packingType: g.packing, packingCode: g.code, prepackCode: g.prepack, cartons: g.cartons, inseam: g.inseam, cells }));
  }
  protected addQty(additional: boolean): void { void this.run(() => this.api.lineAction(this.line().id, { action: 'add-qty', additional })); }
  protected delBreakup(b: Breakup): void { if (confirm('Remove this quantity grid?')) void this.run(() => this.api.saveBreakup(b.id, { action: 'delete' })); }
  protected remove(): void { if (confirm(`Delete ${this.line().name} from this delivery?`)) void this.run(() => this.api.lineAction(this.line().id, { action: 'remove' })); }
  protected setBom(id: string): void { void this.run(() => this.api.lineAction(this.line().id, { action: 'update', bomId: id || '' })); }
  protected setExtra(v: string): void { void this.run(() => this.api.lineAction(this.line().id, { action: 'update', extraProductionPct: Number(v) || 0 })); }
}
