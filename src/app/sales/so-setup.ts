// Sales Order setup (admin): Screen Layout Configurator (company level) for Sales Order New / List, Additional Fields
// (Add Field popup), View Configurator (buyer-wise New views, one-per-user List views, user permissions), approvers
// with approval value (0 never, -1 always, > 0 above that value), tool permissions per role and the settings.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { Status } from '../shared/status';
import { KbGate } from '../platform/shared';

interface Field { key: string; label: string; level: string; section: string; visibility: string; type: string; multi: number; options: string; validation: string; system: number }
interface Slc extends Field { field: string; visible: number; mandatory: number; editable: number; position: number }
interface View { id: number; name: string; listType: 'New' | 'List'; buyers: string[]; fields: { field: string; visible: boolean; mandatory?: boolean; editable?: boolean; position: number }[]; listScope: string; users: number[] }
interface Setup { fields: Field[]; slcNew: Slc[]; slcList: Slc[]; views: View[]; users: { id: number; username: string; displayName: string; role: string }[]; approvers: { user_id: number; approval_limit: number; is_final: number }[]; tools: Record<string, string[]>; allTools: string[]; settings: Record<string, string>; buyers: { code: string; name: string }[] }

@Component({
  selector: 'app-so-setup',
  imports: [KbGate, FormsModule, RouterLink, Status],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <kb-gate role="admin" next="/sales-order-setup">
      <div class="so-head"><a routerLink="/sales-order" class="btn small" aria-label="Back to Sales Orders">‹</a><h1 class="so-title">Sales Order setup</h1></div>
      <nav class="so-tabs" aria-label="Setup sections">@for (t of tabs; track t) { <button type="button" [class.on]="tab() === t" (click)="tab.set(t)">{{ t }}</button> }</nav>
      @if (msg()) { <p class="small" role="status">{{ msg() }}</p> }
      @if (s(); as st) {
        @if (tab() === 'Screen Layout (SLC)') {
          <section class="so-panel">
            <div class="so-dhead"><div class="so-seg" role="group"><button type="button" [class.on]="lt() === 'New'" (click)="lt.set('New'); loadSlc()">Sales Order New</button><button type="button" [class.on]="lt() === 'List'" (click)="lt.set('List'); loadSlc()">Sales Order List</button></div>
              <span class="so-spacer"></span><label class="small">Find <input [(ngModel)]="find" name="find" /></label><button type="button" class="btn small primary" (click)="saveSlc()">Save SLC</button></div>
            <p class="small muted">Company level: every user inherits it; views can only show fields that are visible here. "Always" fields cannot be hidden. Mandatory and Editable apply to Sales Order New only.</p>
            <div class="so-scroll"><table class="so-grid">
              <thead><tr><th>#</th><th>Field</th><th>Level</th><th>Section</th><th>Visible</th>@if (lt() === 'New') { <th>Mandatory</th><th>Editable</th> }<th>Move</th></tr></thead>
              <tbody>@for (r of slcFiltered(); track r.field; let i = $index) {
                <tr><td>{{ r.position }}</td><td>{{ r.label }}@if (!r.system) { <span class="so-chip">additional</span> }</td><td class="small">{{ r.level }}</td><td class="small">{{ r.section }}</td>
                  <td><input type="checkbox" [(ngModel)]="r.visible" [name]="'v' + r.field" [disabled]="r.visibility === 'Always'" [attr.aria-label]="'Visible: ' + r.label" /></td>
                  @if (lt() === 'New') { <td><input type="checkbox" [(ngModel)]="r.mandatory" [name]="'m' + r.field" [disabled]="!r.visible" [attr.aria-label]="'Mandatory: ' + r.label" /></td><td><input type="checkbox" [(ngModel)]="r.editable" [name]="'e' + r.field" [attr.aria-label]="'Editable: ' + r.label" /></td> }
                  <td><button type="button" class="btn small" (click)="move(r, -1)" aria-label="Move up">↑</button><button type="button" class="btn small" (click)="move(r, 1)" aria-label="Move down">↓</button>@if (!r.system) { <button type="button" class="btn small" (click)="delField(r.field)">Delete</button> }</td></tr>
              }</tbody></table></div>
          </section>
          <section class="so-panel">
            <h2 class="so-h2">Add Field (Additional Fields)</h2>
            <form class="so-form" (submit)="$event.preventDefault(); addField()">
              <label>Field name <input [(ngModel)]="af.label" name="afl" /></label>
              <label>Field type <select [(ngModel)]="af.fieldType" name="aft">@for (t of fieldTypes; track t) { <option [value]="t">{{ t }}</option> }</select></label>
              @if (af.fieldType === 'Dropdown') { <label>Options (comma separated) <input [(ngModel)]="af.options" name="afo" /></label><label class="so-check"><input type="checkbox" [(ngModel)]="af.multi" name="afm" /> Multi-select</label> }
              <label>Validation type <select [(ngModel)]="af.validation" name="afv"><option>None</option><option>Alphanumeric</option><option>Numeric</option></select></label>
              <div class="so-actions"><button type="submit" class="btn small primary" [disabled]="af.label.trim().length < 2">Add field</button></div>
            </form>
            <p class="small muted">A new field is hidden until you tick Visible in the SLC above and save.</p>
          </section>
        }

        @if (tab() === 'Views') {
          <section class="so-panel">
            <div class="so-dhead"><h2 class="so-h2">Views</h2><span class="so-spacer"></span><button type="button" class="btn small" (click)="newView('New')">+ New view (Sales Order New)</button><button type="button" class="btn small" (click)="newView('List')">+ New view (Sales Order List)</button></div>
            <table class="so-grid"><thead><tr><th>Name</th><th>List type</th><th>Buyers / scope</th><th>Users</th><th></th></tr></thead>
              <tbody>@for (v of st.views; track v.id) { <tr><td>{{ v.name }}</td><td>{{ v.listType }}</td><td>{{ v.listType === 'New' ? v.buyers.join(', ') : v.listScope }}</td><td>{{ v.users.length }}</td><td><button type="button" class="btn small" (click)="editView(v)">Edit</button><button type="button" class="btn small" (click)="delView(v)">Delete</button></td></tr> }
                @empty { <tr><td colspan="5"><wfx-status kind="empty" title="No views yet" detail="Without a view everyone gets the Default view (the SLC)." [compact]="true" /></td></tr> }</tbody></table>
          </section>
          @if (ve(); as v) {
            <section class="so-panel">
              <h2 class="so-h2">{{ v.id ? 'Edit' : 'New' }} view · Sales Order {{ v.listType }}</h2>
              <div class="so-form">
                <label>View name <input [(ngModel)]="v.name" name="vn" /></label>
                @if (v.listType === 'New') {
                  <fieldset class="so-fs"><legend>Buyers (a buyer can have one New view)</legend>@for (b of st.buyers; track b.code) { <label class="so-check"><input type="checkbox" [checked]="v.buyers.includes(b.code)" (change)="tog(v.buyers, b.code)" /> {{ b.name }}</label> }</fieldset>
                } @else {
                  <label>Records shown <select [(ngModel)]="v.listScope" name="vs"><option value="all">All permitted (current behaviour)</option><option value="created">Created Order Permission (my orders)</option><option value="created-and-buyer">Created Order & Buyer wise permission</option></select></label>
                }
                <fieldset class="so-fs"><legend>Users permitted{{ v.listType === 'List' ? ' (one List view per user)' : '' }}</legend>@for (u of st.users; track u.id) { <label class="so-check"><input type="checkbox" [checked]="v.users.includes(u.id)" (change)="tog(v.users, u.id)" /> {{ u.displayName }} <span class="muted small">{{ u.role }}</span></label> }</fieldset>
              </div>
              <div class="so-scroll"><table class="so-grid"><thead><tr><th>Field</th><th>Section</th><th>Show</th>@if (v.listType === 'New') { <th>Mandatory</th><th>Editable</th> }<th>Move</th></tr></thead>
                <tbody>@for (f of v.fields; track f.field) {
                  <tr><td>{{ labelOf(f.field) }}</td><td class="small">{{ sectionOf(f.field) }}</td><td><input type="checkbox" [(ngModel)]="f.visible" [name]="'vf' + f.field" /></td>
                    @if (v.listType === 'New') { <td><input type="checkbox" [(ngModel)]="f.mandatory" [name]="'vm' + f.field" /></td><td><input type="checkbox" [(ngModel)]="f.editable" [name]="'ve' + f.field" /></td> }
                    <td><button type="button" class="btn small" (click)="vmove(v, f, -1)">↑</button><button type="button" class="btn small" (click)="vmove(v, f, 1)">↓</button></td></tr>
                }</tbody></table></div>
              <div class="so-actions"><button type="button" class="btn" (click)="ve.set(null)">Cancel</button><button type="button" class="btn primary" (click)="saveView(v)">Save view</button></div>
            </section>
          }
        }

        @if (tab() === 'Approvers & permissions') {
          <section class="so-panel">
            <h2 class="so-h2">Approvers</h2>
            <p class="small muted">Approval value: 0 = never goes for approval · −1 = always · above 0 = when the order value exceeds it. Final approver ends a multi-level chain.</p>
            <table class="so-grid"><thead><tr><th>User</th><th>Approver</th><th>Approval value</th><th>Final approver</th></tr></thead>
              <tbody>@for (a of appr(); track a.userId) { <tr><td>{{ a.name }} <span class="muted small">{{ a.role }}</span></td><td><input type="checkbox" [(ngModel)]="a.on" [name]="'ao' + a.userId" /></td><td><input type="number" [(ngModel)]="a.limit" [name]="'al' + a.userId" [disabled]="!a.on" /></td><td><input type="checkbox" [(ngModel)]="a.isFinal" [name]="'af' + a.userId" [disabled]="!a.on" /></td></tr> }</tbody></table>
            <div class="so-actions"><button type="button" class="btn small primary" (click)="saveApprovers()">Save approvers</button></div>
          </section>
          <section class="so-panel">
            <h2 class="so-h2">Tool permissions (Sales Order New)</h2>
            <div class="so-scroll"><table class="so-grid"><thead><tr><th>Tool</th>@for (r of roles; track r) { <th>{{ r }}</th> }</tr></thead>
              <tbody>@for (t of st.allTools; track t) { <tr><td>{{ t }}</td>@for (r of roles; track r) { <td><input type="checkbox" [checked]="!!tools()[r]?.includes(t)" (change)="togTool(r, t)" [attr.aria-label]="r + ' ' + t" /></td> }</tr> }</tbody></table></div>
            <div class="so-actions"><button type="button" class="btn small primary" (click)="saveTools()">Save permissions</button></div>
          </section>
          <section class="so-panel">
            <h2 class="so-h2">Settings</h2>
            <label class="so-check"><input type="checkbox" [(ngModel)]="set.price" name="sp" /> OC price validation with the cost sheet selling price (desync check, price pickup from the cost sheet)</label>
            <label class="so-check"><input type="checkbox" [(ngModel)]="set.multi" name="sm" /> Multi-level approval (each non-final approver names the next)</label>
            <div class="so-actions"><button type="button" class="btn small primary" (click)="saveSettings()">Save settings</button></div>
          </section>
        }
      } @else { <wfx-status kind="loading" title="Loading the setup" /> }
    </kb-gate>
  `,
})
export default class SoSetup {
  private readonly kb = inject(KbService);
  protected readonly tabs = ['Screen Layout (SLC)', 'Views', 'Approvers & permissions'];
  protected readonly tab = signal(this.tabs[0]);
  protected readonly s = signal<Setup | null>(null);
  protected readonly lt = signal<'New' | 'List'>('New');
  protected readonly slc = signal<Slc[]>([]);
  protected readonly msg = signal('');
  protected readonly ve = signal<View | null>(null);
  protected readonly appr = signal<{ userId: number; name: string; role: string; on: boolean; limit: number; isFinal: boolean }[]>([]);
  protected readonly tools = signal<Record<string, string[] | undefined>>({});
  protected readonly roles = ['viewer', 'editor', 'approver', 'admin'];
  protected readonly fieldTypes = ['Alphanumeric', 'Dropdown', 'Date', 'Numeric Box', 'Text Box'];
  protected find = '';
  protected af = { label: '', fieldType: 'Text Box', options: '', multi: false, validation: 'None' };
  protected set = { price: true, multi: false };
  protected readonly slcFiltered = computed(() => this.slc());

  constructor() { inject(SeoService).set({ title: 'Sales Order setup', description: 'SLC, views and approvals for Sales Order.', path: '/sales-order-setup', noindex: true }); void this.load(); }
  private async load(): Promise<void> {
    await this.kb.init();
    if (!this.kb.can('admin')) return;
    const s = await this.kb.get<Setup>('/so/setup');
    this.s.set(s);
    this.loadSlc();
    this.tools.set(structuredClone(s.tools));
    this.set = { price: s.settings['oc_price_validation'] === '1', multi: s.settings['multi_level_approval'] === '1' };
    this.appr.set(s.users.filter((u) => ['approver', 'admin'].includes(u.role)).map((u) => { const a = s.approvers.find((x) => x.user_id === u.id); return { userId: u.id, name: u.displayName, role: u.role, on: !!a, limit: a?.approval_limit ?? -1, isFinal: !!a?.is_final }; }));
  }
  protected loadSlc(): void { const s = this.s(); if (s) this.slc.set(structuredClone(this.lt() === 'New' ? s.slcNew : s.slcList).filter((r) => !this.find || r.label.toLowerCase().includes(this.find.toLowerCase()))); }
  private async act<T>(fn: () => Promise<T>, done: string): Promise<T | undefined> {
    try { const r = await fn(); this.msg.set(done); return r; } catch (e) { this.msg.set((e as Error).message); return undefined; }
  }
  protected move(r: Slc, d: number): void { const a = [...this.slc()]; const i = a.indexOf(r); const j = i + d; if (j < 0 || j >= a.length) return; [a[i], a[j]] = [a[j], a[i]]; a.forEach((x, k) => (x.position = k + 1)); this.slc.set(a); }
  protected async saveSlc(): Promise<void> {
    if (this.find) { this.msg.set('Clear Find before saving, so every field keeps its place.'); return; }
    if (await this.act(() => this.kb.request('PUT', `/so/setup/slc/${this.lt()}`, { rows: this.slc().map((r) => ({ field: r.field, visible: r.visible ? 1 : 0, mandatory: r.mandatory ? 1 : 0, editable: r.editable ? 1 : 0, position: r.position })) }), `SLC for Sales Order ${this.lt()} saved.`) !== undefined) await this.load();
  }
  protected async addField(): Promise<void> {
    const body = { label: this.af.label, fieldType: this.af.fieldType, multi: this.af.multi, options: this.af.options.split(',').map((x) => x.trim()).filter(Boolean), validation: this.af.validation };
    if (await this.act(() => this.kb.post('/so/setup/fields', body), `Field "${this.af.label}" added (hidden until shown in the SLC).`) !== undefined) { this.af = { label: '', fieldType: 'Text Box', options: '', multi: false, validation: 'None' }; await this.load(); }
  }
  protected async delField(key: string): Promise<void> { if (confirm('Delete this additional field?') && (await this.act(() => this.kb.request('DELETE', `/so/setup/fields/${key}`), 'Field deleted.')) !== undefined) await this.load(); }
  private viewFields(lt: 'New' | 'List', existing: View['fields'] = []) {
    const slc = (lt === 'New' ? this.s()!.slcNew : this.s()!.slcList).filter((r) => r.visible);
    const by = new Map(existing.map((f) => [f.field, f]));
    return slc.map((r, i) => by.get(r.field) ?? { field: r.field, visible: true, mandatory: !!r.mandatory, editable: !!r.editable, position: i + 1 }).sort((a, b) => a.position - b.position);
  }
  protected newView(lt: 'New' | 'List'): void { this.ve.set({ id: 0, name: '', listType: lt, buyers: [], fields: this.viewFields(lt), listScope: 'all', users: [] }); }
  protected editView(v: View): void { this.ve.set({ ...structuredClone(v), fields: this.viewFields(v.listType, v.fields) }); }
  protected labelOf(k: string): string { return this.s()!.fields.find((f) => f.key === k)?.label ?? k; }
  protected sectionOf(k: string): string { return this.s()!.fields.find((f) => f.key === k)?.section ?? ''; }
  protected vmove(v: View, f: View['fields'][number], d: number): void { const i = v.fields.indexOf(f); const j = i + d; if (j < 0 || j >= v.fields.length) return; [v.fields[i], v.fields[j]] = [v.fields[j], v.fields[i]]; v.fields.forEach((x, k) => (x.position = k + 1)); this.ve.set({ ...v }); }
  protected tog<T>(list: T[], x: T): void { const i = list.indexOf(x); if (i >= 0) list.splice(i, 1); else list.push(x); this.ve.set({ ...this.ve()! }); }
  protected async saveView(v: View): Promise<void> {
    const saved = await this.act(() => this.kb.post<View>('/so/setup/views', { id: v.id || undefined, name: v.name, listType: v.listType, buyers: v.buyers, fields: v.fields, listScope: v.listScope }), `View "${v.name}" saved.`);
    if (!saved) return;
    await this.act(() => this.kb.request('PUT', `/so/setup/views/${saved.id}/users`, { users: v.users }), `View "${v.name}" saved with its users.`);
    this.ve.set(null);
    await this.load();
  }
  protected async delView(v: View): Promise<void> { if (confirm(`Delete the view "${v.name}"?`) && (await this.act(() => this.kb.request('DELETE', `/so/setup/views/${v.id}`), 'View deleted.')) !== undefined) await this.load(); }
  protected async saveApprovers(): Promise<void> { await this.act(() => this.kb.request('PUT', '/so/setup/approvers', { approvers: this.appr().filter((a) => a.on).map((a) => ({ userId: a.userId, limit: Number(a.limit), isFinal: a.isFinal })) }), 'Approvers saved.'); }
  protected togTool(role: string, t: string): void { const m = structuredClone(this.tools()); const l = (m[role] ??= []); const i = l.indexOf(t); if (i >= 0) l.splice(i, 1); else l.push(t); this.tools.set(m); }
  protected async saveTools(): Promise<void> { await this.act(() => this.kb.request('PUT', '/so/setup/tools', { tools: this.tools() }), 'Tool permissions saved.'); }
  protected async saveSettings(): Promise<void> { await this.act(() => this.kb.request('PUT', '/so/setup/settings', { settings: { oc_price_validation: this.set.price ? '1' : '0', multi_level_approval: this.set.multi ? '1' : '0' } }), 'Settings saved.'); }
}
