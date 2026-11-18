import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { KbGate, KbTabs } from './shared';
import { SectionSwitch } from '../shared/section-switch';

type Basis = 'documented' | 'proposed' | 'inferred';
type Card = '1:1' | '1:N' | 'N:1' | 'M:N';
interface Attr { name: string; kind: string; type: string; pk: boolean; fk: string; formula: string; rule: string; from: string; note: string; basis: Basis }
interface Ent { id: string; name: string; basis: Basis; note: string; attributes: Attr[] }
interface Rel { from: string; to: string; cardinality: Card; label: string; basis: Basis }
interface Model { id: string; name: string; level: 'captured' | 'conceptual' | 'logical'; screen: string; summary: string; source: string; status: string; version: number; basisNote: string; requirement: string; entities: Ent[]; relationships: Rel[] }
interface View {
  model: Model; checks: { level: string; entity: string; message: string }[]; mermaid: string; ddl: string;
  dictionary: { columns: string[]; rows: string[][] }; matches: { entity: string; model: string; title: string }[];
  versions?: { version: number; status: string; file: string }[]; notUnderstood?: string[];
}
interface Listing { captured: { id: string; title: string; status: string; version: number; screen: string }[]; drafts: { id: string; title: string; status: string; version: number; level: string }[] }

const BW = 230, ROW = 17, HEAD = 30, MAXROWS = 12;

@Component({
  selector: 'app-data-modelling',
  imports: [KbGate, KbTabs, FormsModule, RouterLink, SectionSwitch],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section-switch group="data" />
    <h1 class="kb-h1">Data modelling studio</h1>
    <kb-gate next="/data-modelling">
      <kb-tabs />
      <div class="kb-filter">
        <select [ngModel]="loadId" (ngModelChange)="open($event)" name="load" aria-label="Open a data model">
          <option value="">Open a data model…</option>
          <option value="DM-MAP">Map of all captured WFX documents</option>
          <optgroup label="Captured from WFX screens">@for (m of list().captured; track m.id) { <option [value]="m.id">{{ m.title }}</option> }</optgroup>
          @if (list().drafts.length) { <optgroup label="Drafts and approved designs">@for (m of list().drafts; track m.id + m.version) { <option [value]="m.id">{{ m.title }} ({{ m.status }})</option> }</optgroup> }
        </select>
        <button class="btn small" type="button" (click)="showGen.set(!showGen())">New from a requirement</button>
        <button class="btn small" type="button" (click)="blank()">Blank</button>
      </div>
      @if (showGen()) {
        <section class="kb-panel kb-pad">
          <p class="small muted">One statement per line. Understood: <code>Entity: attribute (key), attribute: type, *required attribute</code> · <code>An order has many lines</code> · <code>Each line belongs to one order</code> · <code>An order has one invoice</code> · <code>A and B are many-to-many</code>. Everything you write is a <em>proposal</em>; statements that are not understood are listed, never guessed.</p>
          <input class="kb-wide" [(ngModel)]="genName" name="gn" placeholder="Model name" />
          <textarea rows="7" class="kb-wide" [(ngModel)]="genText" name="gt" [placeholder]="example"></textarea>
          <button class="btn primary small" type="button" (click)="generate()" [disabled]="!genText.trim()">Draft the model</button>
        </section>
      }
      @if (src(); as m) {
        <section class="kb-panel kb-pad">
          <div class="kb-row">
            @if (editable()) { <label>Name <input [(ngModel)]="m.name" name="nm" (ngModelChange)="touch()" /></label> } @else { <h2 class="dm-title">{{ m.name }}</h2> }
            <span class="kb-badge" [attr.data-s]="m.level === 'captured' ? 'Active' : 'proposed'">{{ levelLabel(m) }}</span>
            <span class="muted small">{{ m.id || 'not saved yet' }}{{ m.version ? ' · v' + m.version + ' (' + m.status + ')' : '' }}{{ m.screen ? ' · ' + m.screen : '' }}</span>
          </div>
          <p class="small muted">{{ m.basisNote }}</p>
          @if (m.summary) { <p class="small">{{ m.summary }}</p> }
          @if (notUnderstood().length) {
            <div class="kb-banner kb-warnbox small"><strong>Not understood (nothing was guessed):</strong><ul>@for (s of notUnderstood(); track $index) { <li>{{ s }}</li> }</ul></div>
          }
          @if (view()?.matches?.length) {
            <p class="small">Captured WFX models with the same name:
              @for (x of view()!.matches; track x.entity) { <button type="button" class="chip-btn" (click)="open(x.model)">{{ x.entity }} → {{ x.title }}</button> }
            </p>
          }
          <div class="kb-row wd-tools" role="toolbar" aria-label="Model tools">
            @if (m.level !== 'captured') {
              <span class="small">View:</span>
              <button class="btn small" type="button" [class.on]="mode() === 'as-is'" (click)="setMode('as-is')">Conceptual (as written)</button>
              <button class="btn small" type="button" [class.on]="mode() === 'logical'" (click)="setMode('logical')">Logical (keys, junction tables)</button>
            }
            <button class="btn small" type="button" (click)="zoom.set(zoom() * 1.2)" aria-label="Zoom in">＋</button>
            <button class="btn small" type="button" (click)="zoom.set(zoom() / 1.2)" aria-label="Zoom out">－</button>
            <button class="btn small" type="button" (click)="arrange()">Arrange</button>
            @if (editable()) {
              <button class="btn small" type="button" (click)="addEntity()">+ Entity</button>
              <button class="btn small" type="button" (click)="removeEntity()" [disabled]="!selEdit()">Delete entity</button>
            } @else if (m.id !== 'DM-MAP') {
              <button class="btn small" type="button" (click)="copyToDraft()">Use as the start of a draft</button>
            }
          </div>
          <div class="wd-canvas" (wheel)="wheel($event)">
            <svg [attr.width]="size().w * zoom()" [attr.height]="size().h * zoom()" [attr.viewBox]="'0 0 ' + size().w + ' ' + size().h" role="img" [attr.aria-label]="'Entity relationship diagram ' + m.name"
                 (pointermove)="move($event)" (pointerup)="drop()" (pointerleave)="drop()">
              @for (r of shown().relationships; track $index) {
                @let ln = line(r);
                @if (ln) {
                  <g class="dm-rel" [attr.data-basis]="r.basis">
                    <path [attr.d]="ln.d" />
                  </g>
                }
              }
              @for (e of shown().entities; track e.id) {
                @let p = pos(e.id);
                <g class="dm-ent" [attr.data-basis]="e.basis" [class.sel]="sel() === e.id" [attr.transform]="'translate(' + p.x + ',' + p.y + ')'"
                   tabindex="0" role="button" [attr.aria-label]="e.name + ', ' + e.attributes.length + ' attributes, ' + e.basis" (pointerdown)="grab($event, e)" (click)="sel.set(e.id)" (dblclick)="openLinked(e)" (keydown.enter)="sel.set(e.id)">
                  <rect [attr.width]="bw" [attr.height]="heightOf(e)" rx="8" />
                  <rect [attr.width]="bw" [attr.height]="head" rx="8" class="dm-head" />
                  <text x="10" y="20" class="dm-name">{{ short(e.name, 30) }}</text>
                  @for (a of e.attributes.slice(0, maxRows); track $index; let i = $index) {
                    <text x="10" [attr.y]="head + 14 + i * row" class="dm-attr" [attr.data-kind]="a.kind" [attr.data-basis]="a.basis">{{ a.pk ? '🔑 ' : a.fk ? '↗ ' : '' }}{{ short(a.name, 24) }}</text>
                    <text [attr.x]="bw - 8" [attr.y]="head + 14 + i * row" class="dm-kind" text-anchor="end">{{ a.type || a.kind }}</text>
                  }
                  @if (e.attributes.length > maxRows) { <text x="10" [attr.y]="head + 14 + maxRows * row" class="dm-kind">+ {{ e.attributes.length - maxRows }} more</text> }
                  @if (!e.attributes.length) { <text x="10" [attr.y]="head + 16" class="dm-kind">{{ short(e.note || 'no attributes stated', 34) }}</text> }
                </g>
              }
              <!-- labels last, so boxes never hide them -->
              @for (r of shown().relationships; track $index) {
                @let ln = line(r);
                @if (ln) {
                  <g class="dm-rel-labels" aria-hidden="true">
                    <text [attr.x]="ln.ax" [attr.y]="ln.ay" class="dm-card">{{ ln.ca }}</text>
                    <text [attr.x]="ln.bx" [attr.y]="ln.by" class="dm-card">{{ ln.cb }}</text>
                    <text [attr.x]="ln.mx" [attr.y]="ln.my" class="wd-elabel" text-anchor="middle"><title>{{ r.label }} ({{ r.basis }})</title>{{ short(r.label, 22) }}</text>
                  </g>
                }
              }
            </svg>
          </div>
          <p class="small muted">Drag entities to move them · double-click a linked document to open it · Ctrl + scroll to zoom · solid border = documented (captured from WFX), dashed = proposed, dotted = inferred by the studio · 🔑 key · ↗ link to another entity.</p>
          <div class="kb-grid2">
            <div>
              @if (selShown(); as e) {
                <h3>{{ e.name }} <span class="muted small">({{ e.basis }})</span></h3>
                @if (e.note) { <p class="small muted">{{ e.note }}</p> }
                @if (selEdit(); as ed) {
                  <div class="kb-form">
                    <label>Entity name <input name="en" [(ngModel)]="ed.name" (ngModelChange)="touch()" /></label>
                  </div>
                  <div class="table-scroll"><table class="small dm-attrs">
                    <thead><tr><th>Attribute</th><th>Type</th><th>Key</th><th>Refers to</th><th></th></tr></thead>
                    <tbody>
                      @for (a of ed.attributes; track $index; let i = $index) {
                        <tr>
                          <td><input [name]="'an' + i" [(ngModel)]="a.name" (ngModelChange)="editedAttr(a)" [attr.aria-label]="'Attribute ' + (i + 1) + ' name'" /></td>
                          <td><input [name]="'at' + i" [(ngModel)]="a.type" (ngModelChange)="editedAttr(a)" size="8" [attr.aria-label]="'Attribute ' + (i + 1) + ' type'" /></td>
                          <td><input type="checkbox" [name]="'ap' + i" [(ngModel)]="a.pk" (ngModelChange)="editedAttr(a)" [attr.aria-label]="'Attribute ' + (i + 1) + ' is a key'" /></td>
                          <td><select [name]="'af' + i" [(ngModel)]="a.fk" (ngModelChange)="editedAttr(a)" [attr.aria-label]="'Attribute ' + (i + 1) + ' refers to'"><option value="">–</option>@for (o of others(ed); track o) { <option [value]="o">{{ o }}</option> }</select></td>
                          <td><button type="button" class="btn small" (click)="ed.attributes.splice(i, 1); touch()" [attr.aria-label]="'Remove ' + a.name">✕</button></td>
                        </tr>
                      }
                    </tbody>
                  </table></div>
                  <button class="btn small" type="button" (click)="ed.attributes.push(newAttr()); touch()">+ Attribute</button>
                  <h3>Relationships</h3>
                  <ul class="kb-list small">
                    @for (r of m.relationships; track $index; let i = $index) {
                      @if (r.from === ed.id || r.to === ed.id) {
                        <li>{{ nameOf(r.from) }}
                          <select [name]="'rc' + i" [(ngModel)]="r.cardinality" (ngModelChange)="touch()" aria-label="Cardinality"><option value="1:1">one to one</option><option value="1:N">one to many</option><option value="N:1">many to one</option><option value="M:N">many to many</option></select>
                          {{ nameOf(r.to) }} <input [name]="'rl' + i" [(ngModel)]="r.label" (ngModelChange)="touch()" size="12" aria-label="Relationship label" />
                          <span class="muted">({{ r.basis }})</span>
                          <button type="button" class="btn small" (click)="m.relationships.splice(i, 1); touch()" aria-label="Remove relationship">✕</button>
                        </li>
                      }
                    }
                  </ul>
                  <div class="kb-row">
                    <select [(ngModel)]="relTo" name="rt" aria-label="Related entity"><option value="">Relate to…</option>@for (o of m.entities; track o.id) { @if (o.id !== ed.id) { <option [value]="o.id">{{ o.name }}</option> } }</select>
                    <select [(ngModel)]="relCard" name="rcd" aria-label="Cardinality of the new relationship"><option value="1:N">one to many</option><option value="N:1">many to one</option><option value="1:1">one to one</option><option value="M:N">many to many</option></select>
                    <button class="btn small" type="button" [disabled]="!relTo" (click)="addRel(ed)">Add relationship</button>
                  </div>
                } @else {
                  <div class="table-scroll"><table class="small">
                    <thead><tr><th>Field</th><th>Kind</th><th>Formula / rule</th><th>Comes from</th></tr></thead>
                    <tbody>@for (a of e.attributes; track $index) { <tr><td>{{ a.pk ? '🔑 ' : '' }}{{ a.name }}</td><td>{{ a.type || a.kind }}</td><td>{{ a.formula }}@if (a.rule) { <br /><a [routerLink]="['/rulebook']" [queryParams]="{ id: a.rule }">{{ a.rule }}</a> }</td><td>{{ a.from || a.fk }}</td></tr> }</tbody>
                  </table></div>
                  @if (m.level !== 'captured') { <p class="small muted">Added by the logical view; edit the conceptual view to change it.</p> }
                }
              } @else { <p class="muted small">Select an entity to see {{ editable() ? 'and edit ' : '' }}its attributes.</p> }
              @if (editable()) {
                <h3>Requirement</h3>
                <textarea rows="3" class="kb-wide" [(ngModel)]="m.requirement" name="req" (ngModelChange)="touch()" aria-label="Requirement text"></textarea>
              }
            </div>
            <div>
              <h3>Checks (normalisation and structure)</h3>
              @if (view()?.checks?.length) { <ul class="kb-list small dm-checks">@for (c of view()!.checks; track $index) { <li [class.kb-bad]="c.level === 'error'" [class.kb-warn]="c.level === 'warning'"><strong>{{ c.entity }}</strong>: {{ c.message }}</li> }</ul> }
              @else { <p class="small">No problems found.</p> }
              <div class="kb-row">
                @if (editable() && kb.can('editor')) { <button class="btn primary small" type="button" (click)="save()">Save {{ mode() === 'logical' ? 'logical model' : 'model' }} as draft</button> }
                <button class="btn small" type="button" (click)="downloadDdl()">Download DDL draft</button>
                <button class="btn small" type="button" (click)="copy(view()?.mermaid ?? '')">{{ copied() ? 'Copied' : 'Copy Mermaid ER' }}</button>
                @if (m.id && m.id !== 'DM-MAP') { <a class="small" [routerLink]="['/rulebook']" [queryParams]="{ id: m.id }">Open in the Rulebook</a> }
              </div>
              @if (msg()) { <p class="small" [class.kb-bad]="bad()">{{ msg() }}</p> }
            </div>
          </div>
          <div class="kb-row dm-out" role="tablist" aria-label="Model outputs">
            @for (t of outs; track t.k) { <button type="button" role="tab" class="chip-btn" [class.on]="out() === t.k" [attr.aria-selected]="out() === t.k" (click)="out.set(t.k)">{{ t.label }}</button> }
          </div>
          @if (view(); as v) {
            @switch (out()) {
              @case ('dict') {
                <div class="table-scroll"><table class="small"><thead><tr>@for (c of v.dictionary.columns; track c) { <th>{{ c }}</th> }</tr></thead>
                  <tbody>@for (r of v.dictionary.rows; track $index) { <tr>@for (c of r; track $index) { <td>{{ c }}</td> }</tr> }</tbody></table></div>
              }
              @case ('ddl') { <pre class="kb-code">{{ v.ddl }}</pre> }
              @case ('mermaid') { <pre class="kb-code">{{ v.mermaid }}</pre> }
            }
          }
        </section>
      }
    </kb-gate>
  `,
})
export default class DataModellingPage {
  protected readonly kb = inject(KbService);
  private readonly route = inject(ActivatedRoute);
  protected readonly bw = BW; protected readonly row = ROW; protected readonly head = HEAD; protected readonly maxRows = MAXROWS;
  protected readonly example = 'Supplier: code (key), name, country\nPurchase order: po no (key), order date: date\nA purchase order has many lines\nEach purchase order belongs to one supplier\nLine: item, qty: decimal, rate: decimal';
  protected readonly outs = [{ k: 'dict', label: 'Data dictionary' }, { k: 'ddl', label: 'DDL draft (proposed)' }, { k: 'mermaid', label: 'Mermaid ER' }] as const;
  protected readonly list = signal<Listing>({ captured: [], drafts: [] });
  protected readonly src = signal<Model | null>(null);
  protected readonly view = signal<View | null>(null);
  protected readonly mode = signal<'as-is' | 'logical'>('as-is');
  protected readonly rev = signal(0);
  protected readonly sel = signal<string | null>(null);
  protected readonly zoom = signal(1);
  protected readonly showGen = signal(false);
  protected readonly notUnderstood = signal<string[]>([]);
  protected readonly out = signal<'dict' | 'ddl' | 'mermaid'>('dict');
  protected readonly msg = signal(''); protected readonly bad = signal(false); protected readonly copied = signal(false);
  protected loadId = ''; protected genName = ''; protected genText = ''; protected relTo = ''; protected relCard: Card = '1:N';
  private positions = new Map<string, { x: number; y: number }>();
  private dragging: { id: string; dx: number; dy: number; svg: SVGSVGElement } | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;

  protected readonly editable = computed(() => { this.rev(); const m = this.src(); return !!m && m.level !== 'captured'; });
  /** What the canvas shows: the editable model itself, or the server's logical / captured view of it. */
  protected readonly shown = computed<Model>(() => { this.rev(); const m = this.src(); return (this.mode() === 'as-is' && m?.level !== 'captured' ? m : this.view()?.model) ?? m ?? ({ entities: [], relationships: [] } as unknown as Model); });
  protected readonly selShown = computed(() => { this.rev(); return this.shown().entities.find((e) => e.id === this.sel()) ?? null; });
  protected readonly selEdit = computed(() => { this.rev(); return this.editable() ? this.src()!.entities.find((e) => e.id === this.sel()) ?? null : null; });
  protected readonly size = computed(() => {
    this.rev(); const es = this.shown().entities;
    return { w: Math.max(800, ...es.map((e) => this.pos(e.id).x + BW + 40)), h: Math.max(360, ...es.map((e) => this.pos(e.id).y + this.heightOf(e) + 40)) };
  });

  constructor() {
    inject(SeoService).set({ title: 'Data modelling studio', description: 'Captured WFX document models and proposed conceptual and logical data models.', path: '/data-modelling', noindex: true, crumbs: [{ label: 'Data modelling', path: '/data-modelling' }] });
    effect(() => { if (this.kb.user() && !this.list().captured.length) void this.refreshList().then(() => { const id = this.route.snapshot.queryParamMap.get('id'); if (id) void this.open(id); }); });
  }
  private async refreshList() { this.list.set(await this.kb.get<Listing>('/models')); }
  private apply(v: View, keepSrc = false) {
    this.view.set(v);
    if (!keepSrc) { this.src.set(structuredClone(v.model)); this.sel.set(null); this.positions.clear(); this.layout(); }
    else this.layout(false);
    this.rev.update((x) => x + 1);
  }
  protected async open(id: string) {
    if (!id) return; this.loadId = id; this.msg.set(''); this.notUnderstood.set([]); this.mode.set('as-is');
    this.apply(await this.kb.get<View>(`/models/${encodeURIComponent(id)}`));
  }
  protected async generate() {
    const v = await this.kb.post<View>('/models/draft', { text: this.genText, name: this.genName || 'New data model' });
    this.mode.set('as-is'); this.loadId = ''; this.apply(v); this.notUnderstood.set(v.notUnderstood ?? []); this.showGen.set(false); this.msg.set('');
  }
  protected blank() {
    const m: Model = { id: '', name: 'New data model', level: 'conceptual', screen: '', summary: '', source: '', status: 'Draft', version: 0, basisNote: 'Proposed model. Nothing in it is confirmed WFX knowledge until it is reviewed and approved.', requirement: '', entities: [], relationships: [] };
    this.loadId = ''; this.mode.set('as-is'); this.notUnderstood.set([]); this.src.set(m); this.positions.clear(); this.addEntity();
  }
  protected copyToDraft() {
    const m = this.src(); if (!m) return;
    const d: Model = { ...structuredClone(m), id: '', name: `${m.name} (draft)`, level: 'conceptual', status: 'Draft', version: 0, basisNote: `Draft started from the captured model ${m.id}. Captured fields stay marked documented; anything you add is proposed. Not WFX database schema.`, source: `Started from captured model ${m.id}` };
    this.loadId = ''; this.src.set(d); this.mode.set('as-is'); this.touch();
  }
  protected setMode(m: 'as-is' | 'logical') { this.mode.set(m); this.sel.set(null); this.recheck(0); }
  /** Re-check after a change (debounced); the server returns checks, dictionary, DDL, Mermaid and the logical view. */
  protected touch() { this.rev.update((x) => x + 1); this.recheck(400); }
  private recheck(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(async () => {
      const m = this.src(); if (!m) return;
      if (m.level === 'captured') { this.apply(await this.kb.get<View>(`/models/${encodeURIComponent(m.id)}${this.mode() === 'logical' ? '?view=logical' : ''}`), true); return; }
      this.apply(await this.kb.post<View>('/models/check', { model: m, view: this.mode() }), true);
    }, ms);
  }
  protected editedAttr(a: Attr) { if (a.basis !== 'proposed') a.basis = 'proposed'; this.touch(); }
  protected newAttr(): Attr { return { name: 'new attribute', kind: 'attribute', type: '', pk: false, fk: '', formula: '', rule: '', from: '', note: '', basis: 'proposed' }; }
  protected addEntity() {
    const m = this.src(); if (!m) return;
    const ids = new Set(m.entities.map((e) => e.id)); let i = m.entities.length + 1; while (ids.has(`entity_${i}`)) i++;
    const e: Ent = { id: `entity_${i}`, name: `Entity ${i}`, basis: 'proposed', note: '', attributes: [] };
    m.entities.push(e);
    const s = this.sel() ? this.positions.get(this.sel()!) : null;
    this.positions.set(e.id, { x: (s?.x ?? 20) + BW + 60, y: s?.y ?? 20 });
    this.sel.set(e.id); this.touch();
  }
  protected removeEntity() {
    const m = this.src(), id = this.sel(); if (!m || !id) return;
    const name = m.entities.find((e) => e.id === id)?.name;
    m.entities = m.entities.filter((e) => e.id !== id);
    m.relationships = m.relationships.filter((r) => r.from !== id && r.to !== id);
    for (const e of m.entities) for (const a of e.attributes) if (a.fk === name) a.fk = '';
    this.sel.set(null); this.touch();
  }
  protected addRel(e: Ent) {
    const m = this.src(); if (!m || !this.relTo) return;
    m.relationships.push({ from: e.id, to: this.relTo, cardinality: this.relCard, label: this.relCard === 'N:1' ? 'belongs to' : 'has', basis: 'proposed' });
    this.relTo = ''; this.touch();
  }
  /** Double-click on a linked captured document opens it. */
  protected openLinked(e: Ent) { const m = this.src(); if (m && e.id !== m.id && this.list().captured.some((c) => c.id === e.id)) void this.open(e.id); }
  protected others(e: Ent) { return (this.src()?.entities ?? []).filter((x) => x.id !== e.id).map((x) => x.name); }
  protected nameOf(id: string) { return this.src()?.entities.find((e) => e.id === id)?.name ?? id; }
  protected levelLabel(m: Model) { return m.level === 'captured' ? 'Captured from WFX (screen level)' : this.mode() === 'logical' ? 'Proposed · logical view' : 'Proposed · conceptual'; }
  protected short(s: string, n = 28) { return s.length > n ? `${s.slice(0, n - 1)}…` : s; }
  protected heightOf(e: Ent) { return HEAD + Math.max(1, Math.min(e.attributes.length, MAXROWS) + (e.attributes.length > MAXROWS ? 1 : 0)) * ROW + 10; }
  protected pos(id: string) { return this.positions.get(id) ?? { x: 20, y: 20 }; }
  protected arrange() { this.positions.clear(); this.layout(); this.rev.update((x) => x + 1); }
  /** Columns by distance from the first entity along relationships; new entities are placed without moving the rest. */
  private layout(all = true) {
    const m = this.shown(); if (!m) return;
    const es = m.entities; if (!es.length) return;
    const adj = new Map<string, string[]>(es.map((e) => [e.id, []]));
    for (const r of m.relationships) { adj.get(r.from)?.push(r.to); adj.get(r.to)?.push(r.from); }
    const layer = new Map<string, number>();
    for (const root of es) {
      if (layer.has(root.id)) continue;
      const base = layer.size ? 0 : 0; layer.set(root.id, base);
      const q = [root.id];
      while (q.length) { const id = q.shift()!; for (const n of adj.get(id) ?? []) if (!layer.has(n)) { layer.set(n, layer.get(id)! + 1); q.push(n); } }
    }
    const perCol = Math.max(1, Math.ceil(Math.sqrt(es.length)));
    const cols = new Map<number, number>(); // column → next y
    const isolatedBase = Math.max(0, ...[...layer.values()]) + 1;
    let iso = 0;
    for (const e of es) {
      if (!all && this.positions.has(e.id)) continue;
      let c = layer.get(e.id) ?? 0;
      if (!(adj.get(e.id) ?? []).length && es.length > 1) { c = isolatedBase + Math.floor(iso / perCol); iso++; }
      const y = cols.get(c) ?? 20;
      this.positions.set(e.id, { x: 20 + c * (BW + 140), y });
      cols.set(c, y + this.heightOf(e) + 30);
    }
  }
  protected line(r: Rel) {
    this.rev();
    const es = this.shown().entities;
    const a = es.find((e) => e.id === r.from), b = es.find((e) => e.id === r.to);
    if (!a || !b) return null;
    const pa = this.pos(a.id), pb = this.pos(b.id);
    const right = pb.x >= pa.x + BW / 2;
    const left = pb.x + BW / 2 <= pa.x;
    const x1 = right ? pa.x + BW : left ? pa.x : pa.x + BW, y1 = pa.y + 15;
    const x2 = right ? pb.x : left ? pb.x + BW : pb.x + BW, y2 = pb.y + 15;
    const c = right || left ? Math.max(40, Math.abs(x2 - x1) / 2) : 60;
    const d = right ? `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}` : left ? `M${x1},${y1} C${x1 - c},${y1} ${x2 + c},${y2} ${x2},${y2}` : `M${x1},${y1} C${x1 + c},${y1} ${x2 + c},${y2} ${x2},${y2}`;
    const [ca, cb] = ({ '1:1': ['1', '1'], '1:N': ['1', 'N'], 'N:1': ['N', '1'], 'M:N': ['M', 'N'] } as const)[r.cardinality];
    // cardinalities just below the line at each end, the label above the middle of the line
    return { d, ca, cb, ax: right ? x1 + 5 : x1 - 12, ay: y1 + 14, bx: right ? x2 - 12 : x2 + 5, by: y2 + 14, mx: (x1 + x2) / 2 + (right || left ? 0 : 60), my: (y1 + y2) / 2 - 7 };
  }
  protected grab(ev: PointerEvent, e: Ent) {
    const svg = (ev.currentTarget as SVGGElement).ownerSVGElement!;
    const p = this.point(ev, svg), q = this.pos(e.id);
    this.dragging = { id: e.id, dx: p.x - q.x, dy: p.y - q.y, svg };
  }
  protected move(ev: PointerEvent) {
    if (!this.dragging) return;
    const p = this.point(ev, this.dragging.svg);
    this.positions.set(this.dragging.id, { x: Math.max(0, Math.round(p.x - this.dragging.dx)), y: Math.max(0, Math.round(p.y - this.dragging.dy)) });
    this.rev.update((x) => x + 1);
  }
  protected drop() { this.dragging = null; }
  private point(ev: PointerEvent, svg: SVGSVGElement) { const r = svg.getBoundingClientRect(); return { x: (ev.clientX - r.left) / this.zoom(), y: (ev.clientY - r.top) / this.zoom() }; }
  protected wheel(ev: WheelEvent) { if (!ev.ctrlKey) return; ev.preventDefault(); this.zoom.set(Math.min(3, Math.max(0.3, this.zoom() * (ev.deltaY < 0 ? 1.1 : 0.9)))); }
  protected async save() {
    const m = this.mode() === 'logical' ? this.view()?.model : this.src();
    if (!m) return;
    try {
      const r = await this.kb.post<{ id: string; version: number }>('/models/save', { model: { ...m, id: this.src()!.id, name: this.src()!.name, requirement: this.src()!.requirement } });
      this.bad.set(false); await this.refreshList(); await this.open(r.id);
      this.msg.set(`Saved ${r.id} version ${r.version} as Draft. Approve it in the Rulebook; even approved, it remains a proposed design, not WFX schema.`);
    } catch (e) { this.bad.set(true); this.msg.set((e as Error).message); }
  }
  protected downloadDdl() {
    const v = this.view(), m = this.src(); if (!v || !m) return;
    const url = URL.createObjectURL(new Blob([v.ddl], { type: 'text/plain' }));
    const a = document.createElement('a'); a.href = url; a.download = `${(m.id || m.name).replace(/[^\w-]+/g, '-').toLowerCase()}-proposed.sql`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  protected async copy(t: string) { try { await navigator.clipboard.writeText(t); this.copied.set(true); setTimeout(() => this.copied.set(false), 1500); } catch { /* blocked */ } }
}
