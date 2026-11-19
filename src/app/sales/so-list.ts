// Sales › Sales Order List (Sprint-01 §3): Main OC Wise (default) or Style Wise over the same orders, search by order
// number / article / buyer order ref, Status and Buyer filters, sort by created-on, server paging, row menu, Export
// (what the list shows), the Approval Centre and the Add New Order popup (Category → Buyer → OK → the order screen).
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { Status } from '../shared/status';
import { KbGate } from '../platform/shared';
import { SoApi, type SoListRow, type SoMasters } from './so-api';

@Component({
  selector: 'app-so-list',
  imports: [KbGate, FormsModule, DecimalPipe, RouterLink, Status],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <kb-gate next="/sales-order">
      <div class="so-head">
        <h1 class="so-title">Sales Orders</h1>
        <span class="so-count">{{ selected().size }} selected</span>
        <span class="so-spacer"></span>
        @if (approvals().length) { <button type="button" class="btn small" (click)="showApprovals.set(!showApprovals())">Approval Centre <span class="so-pill">{{ approvals().length }}</span></button> }
        @if (kb.can('admin')) { <a class="btn small" routerLink="/sales-order-setup">Setup</a> }
        @if (canCreate()) { <button type="button" class="btn primary" (click)="openNew()">+ Add New Order</button> }
      </div>

      @if (showApprovals()) {
        <section class="so-panel">
          <h2 class="so-h2">Approval Centre · Sales Order · Pending Approval</h2>
          <table class="so-grid"><thead><tr><th>Order</th><th>Buyer</th><th>Level</th><th class="num">Value</th><th>Sent</th></tr></thead>
            <tbody>@for (a of approvals(); track a.approval_id) {
              <tr><td><a [routerLink]="['/sales-order', a.id]">{{ a.so_no }}</a></td><td>{{ a.buyer }}</td><td>{{ a.level }}</td><td class="num">{{ a.value | number: '1.2-2' }}</td><td>{{ a.sent_at.slice(0, 16).replace('T', ' ') }}</td></tr>
            }</tbody></table>
        </section>
      }

      <div class="so-toolbar">
        <label class="so-search"><span class="visually-hidden">Search</span>
          <input type="search" [ngModel]="q()" (ngModelChange)="search($event)" placeholder="Search by order no, article or buyer order ref" /></label>
        <div class="so-seg" role="group" aria-label="Grouping">
          <button type="button" [class.on]="mode() === 'main'" [attr.aria-pressed]="mode() === 'main'" (click)="setMode('main')">Main OC Wise</button>
          <button type="button" [class.on]="mode() === 'style'" [attr.aria-pressed]="mode() === 'style'" (click)="setMode('style')">Style Wise</button>
        </div>
        <label><span class="visually-hidden">Status</span><select [ngModel]="status()" (ngModelChange)="status.set($event); reload(1)"><option value="">All statuses</option>@for (s of masters()?.statuses ?? []; track s) { <option [value]="s">{{ s }}</option> }</select></label>
        <label><span class="visually-hidden">Buyer</span><select [ngModel]="buyer()" (ngModelChange)="buyer.set($event); reload(1)"><option value="">All buyers</option>@for (b of masters()?.buyers ?? []; track b.code) { <option [value]="b.code">{{ b.name }}</option> }</select></label>
        <button type="button" class="btn small" (click)="sort.set(sort() === 'desc' ? 'asc' : 'desc'); reload(1)" [attr.aria-label]="'Sort by created on, ' + (sort() === 'desc' ? 'newest first' : 'oldest first')">Created on {{ sort() === 'desc' ? '↓' : '↑' }}</button>
        <button type="button" class="btn small" (click)="reload()">Refresh</button>
        <div class="so-menu">
          <button type="button" class="btn small" aria-haspopup="menu" [attr.aria-expanded]="headMenu()" (click)="headMenu.set(!headMenu())">⋮</button>
          @if (headMenu()) { <div class="so-menu-list" role="menu"><button role="menuitem" type="button" (click)="exportCsv(); headMenu.set(false)">Export (as shown)</button></div> }
        </div>
      </div>

      @if (error()) { <wfx-status kind="error" title="Could not load the orders" [detail]="error()" /> }
      <div class="so-scroll">
        <table class="so-grid">
          <thead><tr>
            <th class="chk"><input type="checkbox" aria-label="Select all on this page" [checked]="allChecked()" (change)="toggleAll($any($event.target).checked)" /></th>
            <th>Order No</th><th>{{ mode() === 'style' ? 'Style / Article' : 'Articles' }}</th><th>Status</th><th>Buyer</th><th>Season</th>
            <th class="num">Order Qty</th><th class="num">ASN Qty</th><th class="num">GDN Qty</th><th class="num">Value</th><th class="num">Deliveries</th>
            <th>Buyer Order Date</th><th>Buyer Delivery</th><th>OC Delivery</th><th>Created</th><th class="act"></th>
          </tr></thead>
          <tbody>
            @for (r of rows(); track rowKey(r)) {
              <tr [class.sel]="selected().has(rowKey(r))">
                <td class="chk"><input type="checkbox" [attr.aria-label]="'Select ' + r.soNo" [checked]="selected().has(rowKey(r))" (change)="toggle(rowKey(r))" /></td>
                <td><a [routerLink]="['/sales-order', r.id]" class="so-no">{{ r.soNo }}</a></td>
                <td>@if (mode() === 'style') { <strong>{{ r.article }}</strong> <span class="muted">{{ r.articleName }}</span> } @else { {{ r.article || '–' }} }</td>
                <td><span class="so-chip" [attr.data-s]="r.status">{{ r.status }}</span></td>
                <td>{{ r.buyerName }}</td><td>{{ r.season || '–' }}</td>
                <td class="num">{{ r.qty | number }}</td><td class="num" title="Shipping documents are not held in Atlas yet">{{ r.asnQty }}</td><td class="num" title="Shipping documents are not held in Atlas yet">{{ r.gdnQty }}</td>
                <td class="num">{{ r.value | number: '1.2-2' }}</td><td class="num">{{ r.deliveries }}</td>
                <td>{{ r.buyerOrderDate || '–' }}</td><td>{{ r.buyerDeliveryDate || '–' }}</td><td>{{ r.ocDeliveryDate || '–' }}</td>
                <td class="small">{{ r.createdAt.slice(0, 10) }} · {{ r.createdBy }}</td>
                <td class="act"><div class="so-menu">
                  <button type="button" class="btn small" aria-haspopup="menu" [attr.aria-label]="'Actions for ' + r.soNo" (click)="rowMenu.set(rowMenu() === rowKey(r) ? null : rowKey(r))">⋮</button>
                  @if (rowMenu() === rowKey(r)) {
                    <div class="so-menu-list right" role="menu">
                      <a role="menuitem" [routerLink]="['/sales-order', r.id]">Open</a>
                      @if (can('sync-price')) { <button role="menuitem" type="button" (click)="act(r, 'sync-price')">Sync price with cost sheet</button> }
                      @if (can('cancel-order') && !['Cancelled', 'Closed'].includes(r.status)) { <button role="menuitem" type="button" (click)="ask(r, 'cancel')">Cancel order</button> }
                      @if (can('close-order') && !['Cancelled', 'Closed'].includes(r.status)) { <button role="menuitem" type="button" (click)="ask(r, 'close')">Close order</button> }
                    </div>
                  }
                </div></td>
              </tr>
            } @empty { <tr><td colspan="16"><wfx-status kind="empty" [title]="loading() ? 'Loading…' : 'No sales orders yet'" [detail]="loading() ? undefined : 'Use + Add New Order to create the first one.'" [compact]="true" /></td></tr> }
          </tbody>
        </table>
      </div>
      <div class="so-pager">
        <span class="small muted">Showing {{ from() }}–{{ to() }} of {{ total() }}</span>
        <label class="small">Rows <select [ngModel]="size()" (ngModelChange)="size.set(+$event); reload(1)"><option [ngValue]="10">10</option><option [ngValue]="20">20</option><option [ngValue]="50">50</option><option [ngValue]="100">100</option></select></label>
        <button type="button" class="btn small" [disabled]="page() <= 1" (click)="reload(page() - 1)">‹ Prev</button>
        <span class="small">Page {{ page() }} of {{ pages() }}</span>
        <button type="button" class="btn small" [disabled]="page() >= pages()" (click)="reload(page() + 1)">Next ›</button>
      </div>
      @if (msg()) { <p class="small" role="status">{{ msg() }}</p> }

      @if (newOpen()) {
        <div class="so-scrim" (click)="newOpen.set(false)"></div>
        <div class="so-dialog" role="dialog" aria-modal="true" aria-labelledby="so-new-t">
          <header><h2 id="so-new-t">Add New Order</h2><button type="button" class="so-x" aria-label="Close" (click)="newOpen.set(false)">×</button></header>
          <form (submit)="$event.preventDefault(); create()">
            <label>Category <span class="so-req">*</span>
              <select [(ngModel)]="newCat" name="cat" (ngModelChange)="newBuyer = ''" required><option value="">[Select]</option>@for (c of masters()?.categories ?? []; track c.code) { <option [value]="c.code">{{ c.name }}</option> }</select></label>
            <label>Buyer <span class="so-req">*</span>
              <select [(ngModel)]="newBuyer" name="buyer" required [disabled]="!newCat"><option value="">[Select]</option>@for (b of buyersOf(newCat); track b.code) { <option [value]="b.code">{{ b.name }}</option> }</select></label>
            @if (layoutNote()) { <p class="small muted">{{ layoutNote() }}</p> }
            @if (newErr()) { <p class="small kb-bad" role="alert">{{ newErr() }}</p> }
            <footer><button type="button" class="btn" (click)="newOpen.set(false)">Cancel</button><button type="submit" class="btn primary" [disabled]="!newCat || !newBuyer || busy()">OK</button></footer>
          </form>
        </div>
      }

      @if (remarkFor(); as rf) {
        <div class="so-scrim" (click)="remarkFor.set(null)"></div>
        <div class="so-dialog" role="dialog" aria-modal="true" aria-labelledby="so-rem-t">
          <header><h2 id="so-rem-t">{{ rf.action === 'cancel' ? 'Cancel' : 'Close' }} {{ rf.row.soNo }}</h2><button type="button" class="so-x" aria-label="Close" (click)="remarkFor.set(null)">×</button></header>
          <form (submit)="$event.preventDefault(); act(rf.row, rf.action, remarks)">
            @if (rf.action === 'cancel') { <p class="small">All Delivery OCs of this Main OC will be cancelled.</p> }
            <label>Remarks <span class="so-req">*</span><textarea [(ngModel)]="remarks" name="rem" rows="3" required></textarea></label>
            <footer><button type="button" class="btn" (click)="remarkFor.set(null)">Back</button><button type="submit" class="btn primary" [disabled]="!remarks.trim() || busy()">{{ rf.action === 'cancel' ? 'Cancel order' : 'Close order' }}</button></footer>
          </form>
        </div>
      }
    </kb-gate>
  `,
})
export default class SoList {
  protected readonly kb = inject(KbService);
  private readonly api = inject(SoApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly masters = signal<SoMasters | null>(null);
  protected readonly rows = signal<SoListRow[]>([]);
  protected readonly total = signal(0);
  protected readonly page = signal(1);
  protected readonly size = signal(20);
  protected readonly mode = signal<'main' | 'style'>('main');
  protected readonly q = signal('');
  protected readonly status = signal('');
  protected readonly buyer = signal('');
  protected readonly sort = signal<'asc' | 'desc'>('desc');
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly msg = signal('');
  protected readonly busy = signal(false);
  protected readonly selected = signal(new Set<string>());
  protected readonly rowMenu = signal<string | null>(null);
  protected readonly headMenu = signal(false);
  protected readonly approvals = signal<{ approval_id: number; id: number; so_no: string; buyer: string; level: number; value: number; sent_at: string }[]>([]);
  protected readonly showApprovals = signal(false);
  protected readonly tools = signal<string[]>([]);
  protected readonly newOpen = signal(false);
  protected readonly newErr = signal('');
  protected readonly layoutNote = signal('');
  protected readonly remarkFor = signal<{ row: SoListRow; action: 'cancel' | 'close' } | null>(null);
  protected newCat = '';
  protected newBuyer = '';
  protected remarks = '';
  private timer: ReturnType<typeof setTimeout> | undefined;
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / this.size())));
  protected readonly from = computed(() => (this.total() ? (this.page() - 1) * this.size() + 1 : 0));
  protected readonly to = computed(() => Math.min(this.total(), this.page() * this.size()));
  protected readonly allChecked = computed(() => this.rows().length > 0 && this.rows().every((r) => this.selected().has(this.rowKey(r))));
  protected readonly canCreate = computed(() => this.tools().includes('create'));

  constructor() {
    inject(SeoService).set({ title: 'Sales Orders', description: 'Sales Order list: Main OC wise or Style wise.', path: '/sales-order', noindex: true });
    void this.init();
  }
  private async init(): Promise<void> {
    await this.kb.init();
    if (!this.kb.user()) return;
    try {
      this.masters.set(await this.api.masters());
      const t = await this.api.tools();
      this.tools.set(t);
      await Promise.all([this.reload(1), this.loadApprovals()]);
      if (this.route.snapshot.queryParamMap.get('new') === '1' && this.canCreate()) this.openNew();
    } catch (e) { this.error.set((e as Error).message); }
  }
  protected can(t: string): boolean { return this.tools().includes(t); }
  protected rowKey(r: SoListRow): string { return `${r.id}|${r.article}`; }
  protected buyersOf(cat: string) { return (this.masters()?.buyers ?? []).filter((b) => b.category === cat); }

  protected async reload(page = this.page()): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const r = await this.api.list({ mode: this.mode(), q: this.q(), status: this.status(), buyer: this.buyer(), page, size: this.size(), sort: this.sort() });
      this.rows.set(r.rows); this.total.set(r.total); this.page.set(r.page);
      this.selected.set(new Set());
    } catch (e) { this.error.set((e as Error).message); } finally { this.loading.set(false); }
  }
  private async loadApprovals(): Promise<void> { try { this.approvals.set((await this.api.approvals()).pending); } catch { /* not an approver */ } }
  protected search(v: string): void { this.q.set(v); clearTimeout(this.timer); this.timer = setTimeout(() => void this.reload(1), 300); }
  protected setMode(m: 'main' | 'style'): void { if (this.mode() !== m) { this.mode.set(m); void this.reload(1); } }
  protected toggle(k: string): void { const s = new Set(this.selected()); if (s.has(k)) s.delete(k); else s.add(k); this.selected.set(s); }
  protected toggleAll(on: boolean): void { this.selected.set(on ? new Set(this.rows().map((r) => this.rowKey(r))) : new Set()); }

  protected openNew(): void { this.newCat = this.masters()?.categories.length === 1 ? this.masters()!.categories[0].code : ''; this.newBuyer = ''; this.newErr.set(''); this.layoutNote.set(''); this.newOpen.set(true); }
  protected async create(): Promise<void> {
    this.busy.set(true);
    this.newErr.set('');
    try {
      const r = await this.api.create(this.newCat, this.newBuyer);
      this.newOpen.set(false);
      void this.router.navigate(['/sales-order', r.id]);
    } catch (e) { this.newErr.set((e as Error).message); } finally { this.busy.set(false); }
  }
  protected ask(row: SoListRow, action: 'cancel' | 'close'): void { this.rowMenu.set(null); this.remarks = ''; this.remarkFor.set({ row, action }); }
  protected async act(row: SoListRow, action: string, remarks = ''): Promise<void> {
    this.rowMenu.set(null);
    this.busy.set(true);
    try {
      const r = await this.api.orderAction(Number(row.id), { action, remarks });
      this.remarkFor.set(null);
      this.msg.set(action === 'sync-price' ? `${row.soNo}: ${(r as { synced?: number }).synced ?? 0} price(s) synced.` : `${row.soNo} ${action === 'cancel' ? 'cancelled' : 'closed'}.`);
      await this.reload();
    } catch (e) { this.msg.set((e as Error).message); } finally { this.busy.set(false); }
  }
  /** Export only what the list shows: current filters, sort and page (Sprint-3 Export). */
  protected exportCsv(): void {
    const head = ['Order No', this.mode() === 'style' ? 'Article' : 'Articles', 'Status', 'Buyer', 'Season', 'Order Qty', 'ASN Qty', 'GDN Qty', 'Value', 'Deliveries', 'Buyer Order Date', 'Buyer Delivery Date', 'OC Delivery Date', 'Created'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [head.map(esc).join(','), ...this.rows().map((r) => [r.soNo, r.article, r.status, r.buyerName, r.season, r.qty, r.asnQty, r.gdnQty, r.value, r.deliveries, r.buyerOrderDate, r.buyerDeliveryDate, r.ocDeliveryDate, r.createdAt.slice(0, 10)].map(esc).join(','))];
    const url = URL.createObjectURL(new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = `sales-orders-${this.mode()}-p${this.page()}.csv`; a.click();
    URL.revokeObjectURL(url);
  }
}
