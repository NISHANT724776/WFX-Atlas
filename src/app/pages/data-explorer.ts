import { ChangeDetectionStrategy, Component, afterNextRender, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { SqlResult, SqlService, TableInfo } from '../core/sql.service';
import { STATIC_PAGES } from '../data/catalog';
import { AppModule } from '../data/modules';
import { ModulePicker } from '../shared/module-picker';

/** Areas of the data, with plain names. (The files behind them are never shown.) */
const AREAS: AppModule[] = [
  { id: 'masters', name: 'Masters', icon: 'mod-masters', blurb: 'Colours, sizes, units and article coding', docs: [], txns: [], steps: [], dataArea: '' },
  { id: 'product-development', name: 'Style & BOM', icon: 'mod-style', blurb: 'Techpacks, BOM, routing and cost', docs: [], txns: [], steps: [], dataArea: '' },
  { id: 'sourcing', name: 'Booking & sourcing', icon: 'mod-booking', blurb: 'Block booking, indents, purchase and receipt', docs: [], txns: [], steps: [], dataArea: '' },
  { id: 'order', name: 'Sales Order', icon: 'mod-sales', blurb: 'Orders, deliveries, approval, price and packing', docs: [], txns: [], steps: [], dataArea: '' },
  { id: 'planning', name: 'Planning', icon: 'mod-planning', blurb: 'MRP and sales order indents', docs: [], txns: [], steps: [], dataArea: '' },
  { id: 'production', name: 'Production', icon: 'mod-production', blurb: 'Production order and FPO', docs: [], txns: [], steps: [], dataArea: '' },
  { id: 'inventory', name: 'Inventory, QC & WMS', icon: 'mod-inventory', blurb: 'GRN, quality check, returns, GDI and GDN, mobile app', docs: [], txns: [], steps: [], dataArea: 'inventory' },
  { id: 'tna', name: 'TNA', icon: 'mod-tna', blurb: 'Time and Action calendar guide', docs: [], txns: [], steps: [], dataArea: 'tna' },
  { id: 'knowledge', name: 'Definitions & formulas', icon: 'mod-definitions', blurb: 'Transactions, fields, formulas and terms', docs: [], txns: [], steps: [], dataArea: '' },
];

const WORDS: Record<string, string> = {
  bom: 'BOM', oc: 'OC', uom: 'UOM', mrp: 'MRP', grn: 'GRN', rmpo: 'RMPO', fpo: 'FPO', fppo: 'FPPO', bbb: 'BBB', id: 'ID', sku: 'SKU', hts: 'HTS', gac: 'GAC', pcd: 'PCD',
  po: 'PO', asn: 'ASN', gdn: 'GDN', tna: 'TNA', so: 'SO', cm: 'CM', rm: 'RM', pp: 'PP', pct: '%', qty: 'Qty', cons: 'Cons', csv: 'CSV', l1: 'Level 1', l2: 'Level 2',
  nis: 'NIS', tba: 'TBA', eta: 'ETA', etd: 'ETD', fob: 'FOB', fa: 'F/A', ui: 'UI', sql: 'SQL', n: 'No.', cs: 'CS', wfx: 'WFX', dp: 'DP', apparel: 'Apparel',
};
const SMALL = new Set(['of', 'to', 'in', 'on', 'and', 'for', 'per', 'the', 'a', 'by']);

/** snake_case → "Plain Words": bom_materials → "BOM Materials", cons_incl_wastage → "Cons incl Wastage". */
export function humanize(name: string): string {
  return name.split(/[_\s]+/).filter(Boolean).map((w, i) => {
    const lower = w.toLowerCase();
    if (WORDS[lower]) return WORDS[lower];
    if (i > 0 && SMALL.has(lower)) return lower;
    if (lower === 'incl') return 'incl';
    return lower.charAt(0).toUpperCase() + lower.slice(1);
  }).join(' ');
}

import { Status } from '../shared/status';
@Component({
  selector: 'app-data-explorer',
  imports: [RouterLink, ModulePicker, Status],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head">
      <p class="eyebrow">Data</p>
      <h1>Look things up in the <em>data</em></h1>
      <p class="lead">Pick an area, then a topic, and see the records in a simple table. No technical knowledge needed.</p>
    </header>

    @if (error()) {
      <wfx-status kind="error" title="The data could not be loaded" [detail]="error()" />
    } @else if (!tables().length) {
      <wfx-status kind="loading" title="Getting the data ready" detail="Loading the WFX tables into your browser. This takes a moment the first time." />
    } @else {
      <app-module-picker [modules]="areas" [selected]="areaId()" label="Areas of the data" (pick)="pickArea($event)" />

      @if (area(); as a) {
        <section class="swap-in" aria-live="polite">
          <p class="muted small pick-blurb">{{ a.name }} · {{ a.blurb }}</p>
          <div class="topic-grid">
            @for (t of topics(); track t.table) {
              <button type="button" class="topic" [class.on]="t.table === topic()?.table" [attr.aria-pressed]="t.table === topic()?.table" (click)="pickTopic(t)">
                <strong>{{ title(t) }}</strong>
                <span class="topic-desc">{{ blurb(t) }}</span>
                <span class="topic-n">{{ t.rows }} {{ t.rows === 1 ? 'record' : 'records' }}</span>
              </button>
            }
          </div>
        </section>
      } @else {
        <p class="dm-hint"><span class="dm-pulse"></span>Tap an area to see what you can look up.</p>
      }

      @if (topic(); as t) {
        <section class="lookup swap-in" aria-label="Records">
          <div class="lookup-head">
            <div>
              <h2 class="lookup-title">{{ title(t) }}</h2>
              <p class="muted small">{{ blurb(t) }}</p>
            </div>
            <button type="button" class="dm-x" (click)="topic.set(null)" aria-label="Close this table">×</button>
          </div>
          @if (loading()) {
            <wfx-status kind="loading" title="Loading the records" [compact]="true" />
          } @else if (result(); as r) {
            <div class="lookup-bar">
              <label class="search lookup-search"><span class="visually-hidden">Search these records</span>
                <input type="search" placeholder="Search these records" [value]="q()" (input)="q.set($any($event.target).value); shown.set(25)" /></label>
              <span class="muted small">{{ filtered().length }} of {{ r.rows.length }} {{ r.rows.length === 1 ? 'record' : 'records' }}</span>
              @if (emptyCols() > 0) {
                <button type="button" class="linkish small" (click)="showEmpty.set(!showEmpty())">{{ showEmpty() ? 'Hide' : 'Show' }} {{ emptyCols() }} empty {{ emptyCols() === 1 ? 'column' : 'columns' }}</button>
              }
            </div>
            <div class="table-scroll" tabindex="0" aria-label="Records (scrollable)">
              <table class="friendly">
                <thead><tr>@for (c of cols(); track c.index) { <th scope="col">{{ c.label }}</th> }</tr></thead>
                <tbody>
                  @for (row of visibleRows(); track $index) {
                    <tr>@for (c of cols(); track c.index) { <td [class.num]="isNum(row[c.index])">{{ show(row[c.index]) }}</td> }</tr>
                  } @empty {
                    <tr><td [attr.colspan]="cols().length" class="muted">Nothing matches “{{ q() }}”.</td></tr>
                  }
                </tbody>
              </table>
            </div>
            @if (filtered().length > shown()) {
              <p class="lookup-more"><button type="button" class="btn" (click)="shown.set(shown() + 25)">Show 25 more</button></p>
            }
          }
        </section>
      }

      <p class="muted small data-assist">Can’t find it? <a routerLink="/assistant">Ask the assistant</a> in plain words.</p>

      <details class="adv">
        <summary>For technical users: run your own query</summary>
        <p class="muted small">Tables you can query: {{ tableNames() }}.</p>
        <label for="sql" class="visually-hidden">SQL query</label>
        <textarea id="sql" rows="4" spellcheck="false" [value]="sql()" (input)="sql.set($any($event.target).value)" (keydown.control.enter)="runSql()" (keydown.meta.enter)="runSql()"></textarea>
        <p class="dx-actions"><button type="button" class="btn primary" (click)="runSql()">Run</button><span class="small muted">Ctrl + Enter</span></p>
        @if (sqlError()) { <p class="alert warn">{{ sqlError() }}</p> }
        @if (sqlResult(); as r) {
          <div class="table-scroll dx-result" tabindex="0" aria-label="Query result (scrollable)">
            <table class="friendly">
              <thead><tr>@for (c of r.columns; track $index) { <th scope="col">{{ label(c) }}</th> }</tr></thead>
              <tbody>@for (row of r.rows; track $index) { <tr>@for (v of row; track $index) { <td [class.num]="isNum(v)">{{ show(v) }}</td> }</tr> }</tbody>
            </table>
          </div>
        }
      </details>
    }
  `,
})
export default class DataExplorerPage {
  /** ?area= opens an area straight away. */
  readonly area0 = input<string | undefined>(undefined, { alias: 'area' });
  private readonly sqlService = inject(SqlService);
  protected readonly areas = AREAS;
  protected readonly tables = signal<TableInfo[]>([]);
  protected readonly error = signal('');
  private readonly pickedArea = signal<string | null | undefined>(undefined);
  protected readonly areaId = computed(() => (this.pickedArea() === undefined ? this.area0() ?? null : this.pickedArea()));
  protected readonly area = computed(() => AREAS.find((a) => a.id === this.areaId()) ?? null);
  protected readonly topics = computed(() => this.tables().filter((t) => t.module === this.areaId()));
  protected readonly topic = signal<TableInfo | null>(null);
  protected readonly result = signal<SqlResult | null>(null);
  protected readonly loading = signal(false);
  protected readonly q = signal('');
  protected readonly shown = signal(25);
  protected readonly showEmpty = signal(false);

  protected readonly cols = computed(() => {
    const r = this.result();
    if (!r) return [];
    return r.columns.map((c, index) => ({ index, label: humanize(c) }))
      .filter((c) => this.showEmpty() || r.rows.some((row) => row[c.index] !== null && row[c.index] !== ''));
  });
  protected readonly emptyCols = computed(() => {
    const r = this.result();
    return r ? r.columns.length - r.columns.filter((_, i) => r.rows.some((row) => row[i] !== null && row[i] !== '')).length : 0;
  });
  protected readonly filtered = computed(() => {
    const r = this.result();
    const q = this.q().trim().toLowerCase();
    if (!r) return [];
    return q ? r.rows.filter((row) => row.some((v) => String(v ?? '').toLowerCase().includes(q))) : r.rows;
  });
  protected readonly visibleRows = computed(() => this.filtered().slice(0, this.shown()));
  protected readonly tableNames = computed(() => this.tables().map((t) => t.table).join(', '));

  // advanced
  protected readonly sql = signal('SELECT * FROM bom_materials LIMIT 20;');
  protected readonly sqlResult = signal<SqlResult | null>(null);
  protected readonly sqlError = signal('');

  constructor() {
    inject(SeoService).set({ ...STATIC_PAGES.find((p) => p.path === '/data')!, crumbs: [{ label: 'Data', path: '/data' }] });
    afterNextRender(async () => {
      try {
        this.tables.set((await this.sqlService.manifest()).tables);
      } catch (e) {
        this.error.set(`Could not get the data ready: ${(e as Error).message}`);
      }
    });
  }

  protected pickArea(id: string | null): void {
    this.pickedArea.set(id);
    this.topic.set(null);
  }
  protected title(t: TableInfo): string {
    return t.table.startsWith('manual_') ? `${AREAS.find((a) => a.id === t.module)?.name ?? humanize(t.table.slice(7))} guide` : humanize(t.table);
  }
  protected blurb(t: TableInfo): string {
    const first = /^.*?[.](\s|$)/.exec(t.description);
    return (first ? first[0] : t.description).trim();
  }
  protected label(c: string): string { return humanize(c); }

  protected async pickTopic(t: TableInfo): Promise<void> {
    if (this.topic()?.table === t.table) return this.topic.set(null);
    this.topic.set(t);
    this.q.set('');
    this.shown.set(25);
    this.showEmpty.set(false);
    this.loading.set(true);
    try {
      this.result.set(await this.sqlService.query(`SELECT * FROM "${t.table}"`));
    } catch {
      this.result.set(null);
    } finally {
      this.loading.set(false);
    }
  }

  protected async runSql(): Promise<void> {
    this.sqlError.set('');
    try {
      this.sqlResult.set(await this.sqlService.query(this.sql()));
    } catch (e) {
      this.sqlResult.set(null);
      this.sqlError.set((e as Error).message);
    }
  }

  protected isNum(v: unknown) { return typeof v === 'number'; }
  protected show(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v);
  }
}
