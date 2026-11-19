// Sales Order screen (Sprint-01 §4, Sprint-02, Sprint-3): the buyer's configured fields (view or Default SLC) in Order
// Information / Other Details / Additional Fields, Instructions, the Deliveries panel with Add / Copy / Delete / Split /
// Cancel / Close / Reopen, the selected delivery's fields and articles, Confirm → approval, Revise, Cancel / Close order,
// price sync, and the History (activity timeline).
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { Status } from '../shared/status';
import { KbGate } from '../platform/shared';
import { SoArticle } from './so-article';
import { SoApi, type Delivery, type LayoutField, type OrderDetail, type SoMasters } from './so-api';

type Dialog = { kind: 'remarks'; title: string; note?: string; run: (remarks: string) => Promise<unknown> }
  | { kind: 'split' } | { kind: 'confirm' } | { kind: 'revise' } | { kind: 'approve' } | { kind: 'reject' };
const CORE_DELIVERY = new Set(['delivery_buyer_order_ref', 'buyer_delivery_date', 'oc_delivery_date', 'mode_of_shipment', 'country_of_final_destination']);

@Component({
  selector: 'app-so-order',
  imports: [KbGate, FormsModule, DecimalPipe, RouterLink, Status, SoArticle],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <kb-gate [next]="'/sales-order/' + id()">
      @if (d(); as o) {
        <div class="so-head">
          <a routerLink="/sales-order" class="btn small" aria-label="Back to the Sales Order list">‹</a>
          <h1 class="so-title">{{ o.order.so_no }}</h1>
          <span class="so-chip" [attr.data-s]="o.order.displayStatus">{{ o.order.displayStatus }}</span>
          <span class="small muted">{{ o.buyer.name }} · {{ o.order.category }} · view: <span [title]="o.layout.reason">{{ o.layout.view?.name ?? 'Default (SLC)' }}</span></span>
          <span class="so-spacer"></span>
          <span class="small">{{ o.totals.qty | number }} pcs · {{ o.order.currency }} {{ o.totals.value | number: '1.2-2' }} · {{ o.totals.deliveries }} deliveries</span>
        </div>
        <div class="so-actions">
          @if (editable() && can('edit')) { <button type="button" class="btn small" [disabled]="busy()" (click)="saveHeader()">Save</button> }
          @if (editable() && can('confirm')) { <button type="button" class="btn small primary" [disabled]="busy()" (click)="dialog.set({ kind: 'confirm' })">Confirm</button> }
          @if (o.order.status === 'Confirmed' && can('revise')) { <button type="button" class="btn small" (click)="dialog.set({ kind: 'revise' })">Revise</button> }
          @if (myApproval()) { <button type="button" class="btn small primary" (click)="dialog.set({ kind: 'approve' })">Approve</button><button type="button" class="btn small" (click)="dialog.set({ kind: 'reject' })">Reject</button> }
          @if (anyDesync() && can('sync-price')) { <button type="button" class="btn small" (click)="orderAct({ action: 'sync-price' }, 'Prices synced with the cost sheet.')">Sync price</button> }
          @if (!closed() && can('cancel-order')) { <button type="button" class="btn small" (click)="remarks('Cancel order', 'All Delivery OCs of this Main OC will be cancelled.', (r) => orderAct({ action: 'cancel', remarks: r }, 'Order cancelled.'))">Cancel order</button> }
          @if (!closed() && can('close-order')) { <button type="button" class="btn small" (click)="remarks('Close order', '', (r) => orderAct({ action: 'close', remarks: r }, 'Order closed.'))">Close order</button> }
        </div>
        @if (problems().length) { <div class="so-problems" role="alert"><strong>Before confirming:</strong><ul>@for (p of problems(); track p) { <li>{{ p }}</li> }</ul></div> }
        @if (msg()) { <p class="small" role="status">{{ msg() }}</p> }

        <nav class="so-tabs" aria-label="Order sections">
          @for (t of tabs; track t) { <button type="button" [class.on]="tab() === t" [attr.aria-selected]="tab() === t" (click)="tab.set(t)">{{ t }}</button> }
        </nav>

        @if (tab() === 'Info') {
          @for (sec of headerSections(); track sec.name) {
            <section class="so-panel">
              <h2 class="so-h2">{{ sec.name }}</h2>
              <div class="so-form">
                @for (f of sec.fields; track f.key) {
                  <label [class.so-ro]="!canEdit(f)">{{ f.label }}@if (f.mandatory) { <span class="so-req">*</span> }
                    @switch (inputKind(f)) {
                      @case ('select') { <select [(ngModel)]="hv[f.key]" [name]="f.key" [disabled]="!canEdit(f)"><option value="">[Select]</option>@for (x of optionsOf(f); track x) { <option [value]="x">{{ x }}</option> }</select> }
                      @case ('multi') { <select multiple [(ngModel)]="hv[f.key]" [name]="f.key" [disabled]="!canEdit(f)">@for (x of optionsOf(f); track x) { <option [value]="x">{{ x }}</option> }</select> }
                      @case ('date') { <input type="date" [(ngModel)]="hv[f.key]" [name]="f.key" [disabled]="!canEdit(f)" /> }
                      @case ('number') { <input type="number" [(ngModel)]="hv[f.key]" [name]="f.key" [disabled]="!canEdit(f)" /> }
                      @default { <input [(ngModel)]="hv[f.key]" [name]="f.key" [disabled]="!canEdit(f)" /> }
                    }
                  </label>
                }
              </div>
            </section>
          }

          <section class="so-panel so-deliv">
            <aside class="so-dlist">
              <div class="so-dlist-head"><h2 class="so-h2">Deliveries</h2>
                @if (editable() && can('add-delivery')) { <button type="button" class="btn small" aria-label="Add delivery" (click)="addDelivery()">+</button> }</div>
              <ul>
                @for (dl of o.deliveries; track dl.id) {
                  <li [class.on]="dl.id === selId()">
                    <input type="checkbox" [checked]="checked().has(dl.id)" (change)="toggle(dl.id)" [attr.aria-label]="'Select delivery ' + dl.delivery_no" />
                    <button type="button" (click)="select(dl)"><strong>Delivery {{ dl.delivery_no }}</strong>
                      <span class="small muted">{{ dl.lines.map(styleOf).join(', ') || 'no style yet' }}</span>
                      <span class="small"><span class="so-chip" [attr.data-s]="dl.status">{{ dl.status }}</span> {{ dl.totals.qty | number }} pcs</span></button>
                  </li>
                } @empty { <li class="small muted">No delivery yet.</li> }
              </ul>
              @if (checked().size) {
                <div class="so-bulk">
                  <span class="small">{{ checked().size }} selected</span>
                  @if (can('delete-delivery')) { <button type="button" class="btn small" (click)="bulk('delete')">Delete</button> }
                  @if (can('cancel-delivery')) { <button type="button" class="btn small" (click)="bulk('cancel')">Cancel</button> }
                  @if (can('close-delivery')) { <button type="button" class="btn small" (click)="bulk('close')">Close</button> }
                  @if (can('reopen-delivery')) { <button type="button" class="btn small" (click)="bulk('reopen')">Reopen</button> }
                </div>
              }
            </aside>
            <div class="so-dmain">
              @if (sel(); as dl) {
                <div class="so-dhead">
                  <h2 class="so-h2">Delivery {{ dl.delivery_no }} <span class="so-chip" [attr.data-s]="dl.status">{{ dl.status }}</span>@if (dl.split_from) { <span class="small muted"> split from another delivery</span> }</h2>
                  <span class="so-spacer"></span>
                  @if (dEditable()) {
                    @if (can('copy-delivery')) { <button type="button" class="btn small" (click)="dAct({ action: 'copy', ids: [dl.id] }, 'Delivery copied: enter its number, dates and quantities.')">Copy</button> }
                    @if (can('split-delivery')) { <button type="button" class="btn small" (click)="split = { mode: 'percentage', value: null }; dialog.set({ kind: 'split' })">Split</button> }
                  }
                </div>
                @if (dl.remarks) { <p class="small muted">Remarks: {{ dl.remarks }}</p> }
                <div class="so-form">
                  <label>Delivery Buyer Order Ref@if (mand('delivery_buyer_order_ref')) { <span class="so-req">*</span> }<input [(ngModel)]="dv.buyer_order_ref" name="bor" [disabled]="!dEditable()" /></label>
                  <label>Buyer Delivery Date@if (mand('buyer_delivery_date')) { <span class="so-req">*</span> }<input type="date" [(ngModel)]="dv.buyer_delivery_date" name="bdd" [disabled]="!dEditable()" /></label>
                  <label>OC Delivery Date<input type="date" [(ngModel)]="dv.oc_delivery_date" name="ocd" [disabled]="!dEditable()" placeholder="from ex-factory days" /><span class="small muted">Blank = Buyer Delivery Date − ex-factory days</span></label>
                  <label>Mode of Shipment@if (mand('mode_of_shipment')) { <span class="so-req">*</span> }<select [(ngModel)]="dv.shipment_mode" name="msh" [disabled]="!dEditable()"><option value="">[Select]</option>@for (x of lookup('shipment_mode'); track x) { <option [value]="x">{{ x }}</option> }</select></label>
                  <label>Country of Final Destination@if (mand('country_of_final_destination')) { <span class="so-req">*</span> }<select [(ngModel)]="dv.destination" name="dst" [disabled]="!dEditable()"><option value="">[Select]</option>@for (x of lookup('country'); track x) { <option [value]="x">{{ x }}</option> }</select></label>
                  @for (f of deliveryFields(); track f.key) {
                    <label>{{ f.label }}@if (f.mandatory) { <span class="so-req">*</span> }
                      @if (inputKind(f) === 'select') { <select [(ngModel)]="dv.fields[f.key]" [name]="'df' + f.key" [disabled]="!dEditable() || !f.editable"><option value="">[Select]</option>@for (x of optionsOf(f); track x) { <option [value]="x">{{ x }}</option> }</select> }
                      @else if (inputKind(f) === 'date') { <input type="date" [(ngModel)]="dv.fields[f.key]" [name]="'df' + f.key" [disabled]="!dEditable() || !f.editable" /> }
                      @else { <input [(ngModel)]="dv.fields[f.key]" [name]="'df' + f.key" [disabled]="!dEditable() || !f.editable" /> }
                    </label>
                  }
                </div>
                @if (dEditable()) { <div class="so-actions"><button type="button" class="btn small" [disabled]="busy()" (click)="saveDelivery()">Save delivery</button></div> }

                <div class="so-dhead">
                  <h3 class="so-h3">Article Information</h3><span class="so-spacer"></span>
                  @if (dEditable()) {
                    <label class="small">Add article <select [(ngModel)]="newArticle" name="na"><option value="">[Select]</option>@for (a of o.articles; track a.code) { <option [value]="a.code">{{ a.code }} · {{ a.name }}{{ a.is_kit ? ' (kit)' : '' }}</option> }</select></label>
                    <button type="button" class="btn small" [disabled]="!newArticle || busy()" (click)="addArticle()">+ Add Article</button>
                  }
                </div>
                @for (l of dl.lines; track l.id) { <so-article [line]="l" [editable]="dEditable()" (changed)="apply($event)" /> }
                @empty { <wfx-status kind="empty" title="No article yet" detail="Add the style's article, then enter its colour and size quantities." [compact]="true" /> }
                <p class="small"><strong>Delivery total:</strong> {{ dl.totals.qty | number }} pcs · {{ dl.totals.value | number: '1.2-2' }}@if (dl.totals.additional) { · additional {{ dl.totals.additional | number }} }</p>
              } @else { <wfx-status kind="empty" title="Add a delivery" detail="A Main OC holds Delivery OCs; each delivery holds the articles and their colour/size quantities." [compact]="true" /> }
            </div>
          </section>

          @if (o.approvals.length) {
            <section class="so-panel"><h2 class="so-h2">Approval</h2>
              <table class="so-grid"><thead><tr><th>Level</th><th>Approver</th><th>Status</th><th>Remarks</th><th>When</th></tr></thead>
                <tbody>@for (a of o.approvals; track a.id) { <tr><td>{{ a.level }}</td><td>{{ a.approver }}</td><td><span class="so-chip" [attr.data-s]="a.status">{{ a.status }}</span></td><td>{{ a.remarks || '–' }}</td><td>{{ (a.acted_at ?? a.created_at).slice(0, 16).replace('T', ' ') }}</td></tr> }</tbody></table>
            </section>
          }
        }

        @if (tab() === 'Instruction') {
          <section class="so-panel"><div class="so-form so-wide">
            @for (f of instructionFields(); track f.key) { <label>{{ f.label }}<textarea rows="3" [(ngModel)]="iv[f.key]" [name]="'i' + f.key" [disabled]="!editable()"></textarea></label> }
            @empty { <p class="small muted">No instruction field is shown for this buyer (Setup › SLC).</p> }
          </div>@if (editable()) { <div class="so-actions"><button type="button" class="btn small" (click)="saveHeader()">Save instructions</button></div> }</section>
        }

        @if (tab() === 'History') {
          <section class="so-panel"><ol class="so-timeline">
            @for (h of o.history; track h.id) {
              <li><div><strong>{{ h.action }}</strong> <span class="small muted">{{ h.ref }}</span></div>
                @if (h.before || h.after) { <div class="small so-diff">@for (k of diffKeys(h); track k) { <span><code>{{ k }}</code> {{ fmt(h.before?.[k]) }} → {{ fmt(h.after?.[k]) }}</span> }</div> }
                @if (h.remarks) { <div class="small">“{{ h.remarks }}”</div> }
                <div class="small muted">{{ h.user }} · {{ h.at.slice(0, 19).replace('T', ' ') }}</div></li>
            }
          </ol></section>
        }

        @if (dialog(); as dg) {
          <div class="so-scrim" (click)="dialog.set(null)"></div>
          <div class="so-dialog" role="dialog" aria-modal="true" aria-labelledby="so-dg-t">
            @switch (dg.kind) {
              @case ('remarks') {
                <header><h2 id="so-dg-t">{{ $any(dg).title }}</h2><button type="button" class="so-x" aria-label="Close" (click)="dialog.set(null)">×</button></header>
                <form (submit)="$event.preventDefault(); runRemarks()">@if ($any(dg).note) { <p class="small">{{ $any(dg).note }}</p> }
                  <label>Remarks <span class="so-req">*</span><textarea [(ngModel)]="rem" name="rem" rows="3"></textarea></label>
                  <footer><button type="button" class="btn" (click)="dialog.set(null)">Back</button><button class="btn primary" type="submit" [disabled]="!rem.trim() || busy()">OK</button></footer></form>
              }
              @case ('split') {
                <header><h2 id="so-dg-t">Split Delivery {{ sel()?.delivery_no }}</h2><button type="button" class="so-x" aria-label="Close" (click)="dialog.set(null)">×</button></header>
                <form (submit)="$event.preventDefault(); doSplit()">
                  <label>Split by <select [(ngModel)]="split.mode" name="sm"><option value="percentage">Percentage</option><option value="quantity">Quantity</option></select></label>
                  <label>{{ split.mode === 'percentage' ? 'Percentage' : 'Quantity' }} <span class="so-req">*</span><input type="number" min="0" [(ngModel)]="split.value" name="sv" /></label>
                  <p class="small muted">{{ split.mode === 'percentage' ? 'Each colour/size line moves Existing × % ÷ 100 to a new delivery.' : 'The quantity is spread over the lines in proportion to their quantity.' }} Delivery quantity: {{ sel()?.totals?.qty }}.</p>
                  <footer><button type="button" class="btn" (click)="dialog.set(null)">Back</button><button class="btn primary" type="submit" [disabled]="!split.value || busy()">Split</button></footer></form>
              }
              @case ('confirm') {
                <header><h2 id="so-dg-t">Confirm {{ o.order.so_no }}</h2><button type="button" class="so-x" aria-label="Close" (click)="dialog.set(null)">×</button></header>
                <form (submit)="$event.preventDefault(); confirmOrder()">
                  @if (o.approvers.length) {
                    <label>Approver <span class="so-req">*</span><select [(ngModel)]="approverId" name="ap"><option [ngValue]="null">[Select]</option>@for (a of o.approvers; track a.id) { <option [ngValue]="a.id">{{ a.display_name }} · approval value {{ a.approval_limit === -1 ? 'always' : a.approval_limit === 0 ? 'never' : (a.approval_limit | number) }}</option> }</select></label>
                    <p class="small muted">Order value {{ o.totals.value | number: '1.2-2' }}. It goes for approval when the approver’s approval value requires it.</p>
                  } @else { <p class="small">No approver is set up: the order is confirmed directly.</p> }
                  <footer><button type="button" class="btn" (click)="dialog.set(null)">Back</button><button class="btn primary" type="submit" [disabled]="busy() || (o.approvers.length > 0 && !approverId)">Confirm</button></footer></form>
              }
              @case ('revise') {
                <header><h2 id="so-dg-t">Revise {{ o.order.so_no }}</h2><button type="button" class="so-x" aria-label="Close" (click)="dialog.set(null)">×</button></header>
                <form (submit)="$event.preventDefault(); orderAct({ action: 'revise', reason: rev.reason, authorizedBy: rev.by }, 'Revision started: the order shows Confirmed * until it is confirmed again.')">
                  <label>Reason for revision <span class="so-req">*</span><input [(ngModel)]="rev.reason" name="rr" /></label>
                  <label>Revision Authorized By <span class="so-req">*</span><input [(ngModel)]="rev.by" name="rb" /></label>
                  <footer><button type="button" class="btn" (click)="dialog.set(null)">Back</button><button class="btn primary" type="submit" [disabled]="!rev.reason.trim() || !rev.by.trim() || busy()">Revise</button></footer></form>
              }
              @case ('approve') {
                <header><h2 id="so-dg-t">Approve {{ o.order.so_no }}</h2><button type="button" class="so-x" aria-label="Close" (click)="dialog.set(null)">×</button></header>
                <form (submit)="$event.preventDefault(); orderAct({ action: 'approve', remarks: rem, nextApproverId }, 'Approved.')">
                  <label>Remarks <textarea [(ngModel)]="rem" name="ar" rows="2"></textarea></label>
                  <label>Next approver (multi-level approval) <select [(ngModel)]="nextApproverId" name="na"><option [ngValue]="null">None – I am the final approver</option>@for (a of o.approvers; track a.id) { @if (a.id !== kb.user()?.id) { <option [ngValue]="a.id">{{ a.display_name }}</option> } }</select></label>
                  <footer><button type="button" class="btn" (click)="dialog.set(null)">Back</button><button class="btn primary" type="submit" [disabled]="busy()">Approve</button></footer></form>
              }
              @case ('reject') {
                <header><h2 id="so-dg-t">Reject {{ o.order.so_no }}</h2><button type="button" class="so-x" aria-label="Close" (click)="dialog.set(null)">×</button></header>
                <form (submit)="$event.preventDefault(); orderAct({ action: 'reject', remarks: rem }, 'Rejected.')">
                  <label>Remarks <span class="so-req">*</span><textarea [(ngModel)]="rem" name="jr" rows="2"></textarea></label>
                  <footer><button type="button" class="btn" (click)="dialog.set(null)">Back</button><button class="btn primary" type="submit" [disabled]="!rem.trim() || busy()">Reject</button></footer></form>
              }
            }
          </div>
        }
      } @else if (error()) { <wfx-status kind="error" title="Could not open the order" [detail]="error()" /> } @else { <wfx-status kind="loading" title="Opening the order" /> }
    </kb-gate>
  `,
})
export default class SoOrder {
  protected readonly kb = inject(KbService);
  private readonly api = inject(SoApi);
  private readonly seo = inject(SeoService);
  readonly id = input.required<string>();
  protected readonly tabs = ['Info', 'Instruction', 'History'];
  protected readonly tab = signal('Info');
  protected readonly d = signal<OrderDetail | null>(null);
  protected readonly masters = signal<SoMasters | null>(null);
  protected readonly error = signal('');
  protected readonly msg = signal('');
  protected readonly busy = signal(false);
  protected readonly problems = signal<string[]>([]);
  protected readonly selId = signal<number | null>(null);
  protected readonly checked = signal(new Set<number>());
  protected readonly dialog = signal<Dialog | null>(null);
  protected hv: Record<string, unknown> = {};
  protected iv: Record<string, string> = {};
  protected dv: { buyer_order_ref: string; buyer_delivery_date: string; oc_delivery_date: string; shipment_mode: string; destination: string; fields: Record<string, unknown> } = { buyer_order_ref: '', buyer_delivery_date: '', oc_delivery_date: '', shipment_mode: '', destination: '', fields: {} };
  protected newArticle = '';
  protected rem = '';
  protected split: { mode: 'percentage' | 'quantity'; value: number | null } = { mode: 'percentage', value: null };
  protected rev = { reason: '', by: '' };
  protected approverId: number | null = null;
  protected nextApproverId: number | null = null;

  protected readonly editable = computed(() => ['Draft', 'Rejected'].includes(this.d()?.order.status ?? ''));
  protected readonly closed = computed(() => ['Cancelled', 'Closed'].includes(this.d()?.order.status ?? ''));
  protected readonly sel = computed(() => this.d()?.deliveries.find((x) => x.id === this.selId()) ?? null);
  protected readonly dEditable = computed(() => this.editable() && !!this.sel() && !['Cancelled', 'Closed'].includes(this.sel()!.status));
  protected readonly anyDesync = computed(() => !!this.d()?.deliveries.some((x) => x.lines.some((l) => l.desynced)));
  protected readonly myApproval = computed(() => !!this.d()?.approvals.some((a) => a.status === 'Pending' && a.approver_id === this.kb.user()?.id));
  protected readonly headerSections = computed(() => {
    const f = (this.d()?.layout.fields ?? []).filter((x) => x.section !== 'Delivery Level Information' && x.section !== 'Instruction' && x.level !== 'Delivery+SKU');
    return ['Order Information', 'Other Detail', 'Additional Fields'].map((name) => ({ name: name === 'Other Detail' ? 'Other Details' : name, fields: f.filter((x) => x.section === name) })).filter((s) => s.fields.length);
  });
  protected readonly instructionFields = computed(() => (this.d()?.layout.fields ?? []).filter((x) => x.section === 'Instruction'));
  protected readonly deliveryFields = computed(() => (this.d()?.layout.fields ?? []).filter((x) => x.level === 'Delivery' && !CORE_DELIVERY.has(x.key)));

  constructor() { void this.load(); }
  private async load(): Promise<void> {
    await this.kb.init();
    if (!this.kb.user()) return;
    try {
      this.masters.set(await this.api.masters());
      this.apply(await this.api.order(Number(this.id())));
      this.seo.set({ title: this.d()!.order.so_no, description: 'Sales Order', path: `/sales-order/${this.id()}`, noindex: true });
    } catch (e) { this.error.set((e as Error).message); }
  }
  /** New server state: refresh the copies being edited, keep the selected delivery. */
  protected apply(o: OrderDetail): void {
    this.d.set(o);
    this.hv = { ...o.order.header };
    this.iv = { ...o.order.instructions };
    if (!o.deliveries.some((x) => x.id === this.selId())) this.selId.set(o.deliveries[0]?.id ?? null);
    this.loadDelivery();
    this.checked.set(new Set([...this.checked()].filter((x) => o.deliveries.some((d) => d.id === x))));
  }
  private loadDelivery(): void {
    const x = this.sel();
    this.dv = x ? { buyer_order_ref: x.buyer_order_ref, buyer_delivery_date: x.buyer_delivery_date ?? '', oc_delivery_date: x.oc_delivery_date ?? '', shipment_mode: x.shipment_mode, destination: x.destination, fields: { ...x.fields } } : { buyer_order_ref: '', buyer_delivery_date: '', oc_delivery_date: '', shipment_mode: '', destination: '', fields: {} };
  }
  protected select(x: Delivery): void { this.selId.set(x.id); this.loadDelivery(); }
  protected toggle(id: number): void { const s = new Set(this.checked()); if (s.has(id)) s.delete(id); else s.add(id); this.checked.set(s); }
  protected can(t: string): boolean { return !!this.d()?.tools.includes(t); }
  protected canEdit(f: LayoutField): boolean { return this.editable() && f.editable && !['sales_order_no', 'category', 'buyer'].includes(f.key); }
  protected mand(key: string): boolean { return !!this.d()?.layout.fields.find((f) => f.key === key)?.mandatory; }
  protected lookup(list: string): string[] { return this.masters()?.lookups[list] ?? []; }
  protected styleOf = (l: { article: string }) => l.article;
  protected inputKind(f: LayoutField): string { return f.type === 'dropdown' ? (f.multi ? 'multi' : 'select') : f.type === 'lookup' ? 'select' : f.type === 'date' ? 'date' : f.type === 'numeric' ? 'number' : 'text'; }
  protected optionsOf(f: LayoutField): string[] {
    if (f.type === 'dropdown') return f.options;
    const o = this.d()!;
    switch (f.lookup) {
      case 'category': return [o.order.category];
      case 'buyer': return [o.order.buyer];
      case 'department': return o.buyer.departments;
      case 'season': return o.buyer.seasons;
      default: return this.lookup(f.lookup ?? '');
    }
  }
  protected diffKeys(h: { before: Record<string, unknown> | null; after: Record<string, unknown> | null }): string[] { return [...new Set([...Object.keys(h.before ?? {}), ...Object.keys(h.after ?? {})])].slice(0, 8); }
  protected fmt(v: unknown): string { return v === null || v === undefined || v === '' ? '–' : typeof v === 'object' ? JSON.stringify(v) : String(v); }

  private async run<T>(fn: () => Promise<T>, done: string): Promise<T | undefined> {
    this.busy.set(true);
    this.msg.set('');
    try { const r = await fn(); this.msg.set(done); return r; } catch (e) { this.msg.set((e as Error).message); return undefined; } finally { this.busy.set(false); }
  }
  protected async saveHeader(): Promise<void> {
    const o = await this.run(() => this.api.saveHeader(this.d()!.order.id, this.hv, this.iv), 'Saved.');
    if (o) this.apply(o);
  }
  protected async orderAct(body: Record<string, unknown>, done: string): Promise<void> {
    const r = await this.run(() => this.api.orderAction(this.d()!.order.id, body), done);
    if (r) { this.apply(r.order); this.dialog.set(null); this.rem = ''; }
  }
  protected async confirmOrder(): Promise<void> {
    await this.saveHeaderQuiet();
    const r = await this.run(() => this.api.orderAction(this.d()!.order.id, { action: 'confirm', approverId: this.approverId }), '');
    if (!r) return;
    this.apply(r.order);
    this.dialog.set(null);
    this.problems.set(r.problems ?? []);
    this.msg.set(r.problems?.length ? 'Not confirmed: complete the items listed.' : r.status === 'Pending Approval' ? 'Sent for approval.' : 'Sales Order confirmed.');
  }
  private async saveHeaderQuiet(): Promise<void> { if (this.editable()) { try { this.apply(await this.api.saveHeader(this.d()!.order.id, this.hv, this.iv)); } catch { /* reported by confirm */ } } }
  protected async addDelivery(): Promise<void> {
    const r = await this.run(() => this.api.orderAction(this.d()!.order.id, { action: 'add-delivery', delivery: {} }), 'Delivery added: fill its fields and articles.');
    if (r) { this.selId.set(r.deliveryId ?? null); this.apply(r.order); }
  }
  protected async saveDelivery(): Promise<void> {
    const x = this.sel()!;
    const r = await this.run(() => this.api.deliveryAction({ action: 'update', ids: [x.id], delivery: { ...this.dv, buyer_delivery_date: this.dv.buyer_delivery_date || null, oc_delivery_date: this.dv.oc_delivery_date || null } }), `Delivery ${x.delivery_no} saved.`);
    if (r) this.apply(r.order);
  }
  protected async dAct(body: Record<string, unknown>, done: string): Promise<void> {
    const r = await this.run(() => this.api.deliveryAction(body), done);
    if (r) { if (r.deliveryId) this.selId.set(r.deliveryId); this.apply(r.order); this.dialog.set(null); this.rem = ''; }
  }
  protected async addArticle(): Promise<void> {
    const code = this.newArticle;
    await this.dAct({ action: 'add-article', ids: [this.sel()!.id], article: code }, `${code} added: enter its quantities.`);
    this.newArticle = '';
  }
  protected doSplit(): void { void this.dAct({ action: 'split', ids: [this.sel()!.id], mode: this.split.mode, value: this.split.value }, 'Delivery split into a new delivery.'); }
  protected bulk(action: 'delete' | 'cancel' | 'close' | 'reopen'): void {
    const ids = [...this.checked()];
    const names = this.d()!.deliveries.filter((x) => ids.includes(x.id)).map((x) => `Delivery ${x.delivery_no}`).join(', ');
    if (action === 'delete') { if (confirm(`Do you want to delete ${names}?`)) void this.dAct({ action, ids }, `${names} deleted.`); return; }
    const verb = { cancel: 'Cancel', close: 'Close', reopen: 'Reopen' }[action];
    this.remarks(`${verb} ${names}`, action === 'cancel' ? `Do you want to Cancel the selected Delivery Order(s)?` : '', (r) => this.dAct({ action, ids, remarks: r }, `${names}: ${action === 'reopen' ? 'reopened' : action === 'cancel' ? 'cancelled' : 'closed'}.`));
  }
  protected remarks(title: string, note: string, fn: (r: string) => Promise<unknown>): void { this.rem = ''; this.dialog.set({ kind: 'remarks', title, note, run: fn }); }
  protected runRemarks(): void { const dg = this.dialog(); if (dg?.kind === 'remarks') void dg.run(this.rem); }
}
