import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import type { KbEntry } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { KbGate, KbTabs } from './shared';

interface Detail {
  current: KbEntry; pending: KbEntry | null; versions: { version: number; status: string; file: string; updatedAt: string | null; isCurrent: boolean }[];
  history: { version: string; status: string }[]; raw: string;
  relations: { outgoing: { rel: string; toId: string; otherTitle?: string; basis: string; status: string }[]; incoming: { rel: string; fromId: string; otherTitle?: string; basis: string; status: string }[] };
  transitions: { current: string[]; pending: string[] };
}
interface Proposal { understanding: { category: string; transaction: string; module: string; output: string; inputs: string[]; formula: string; expression: string; missing: string[]; questions: string[]; confidence: string }; related: { id: string; title: string; version: number; status: string; formula: string; relation: string; difference: string }[]; draftText: string; problems: string[]; suggestedFile: string; correctionOf: string | null }

const TYPES = ['rule', 'term', 'procedure', 'transaction', 'field', 'workflow', 'model', 'dependency', 'case', 'module'];
const STATUSES = ['Active', 'Approved', 'Under Review', 'Draft'];

@Component({
  selector: 'app-rulebook',
  imports: [KbGate, KbTabs, FormsModule, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="kb-h1">Rulebook</h1>
    <kb-gate next="/rulebook">
      <kb-tabs />
      <div class="kb-filter">
        <select [ngModel]="type()" (ngModelChange)="type.set($event); load()" name="type"><option value="">All types</option>@for (t of types; track t) { <option [value]="t">{{ t }}</option> }</select>
        <select [ngModel]="status()" (ngModelChange)="status.set($event); load()" name="status"><option value="">Any status</option>@for (s of statuses; track s) { <option [value]="s">{{ s }}</option> }</select>
        <input type="search" placeholder="Search rules, terms, procedures…" [ngModel]="q()" (ngModelChange)="q.set($event)" (keydown.enter)="load()" name="q" />
        <span class="muted small">{{ total() }} entries</span>
        @if (kb.can('editor')) { <button class="btn primary small" type="button" (click)="teachOpen.set(!teachOpen())">Teach a rule</button> }
      </div>

      @if (teachOpen()) {
        <section class="kb-panel kb-pad">
          <h2>Teach a rule</h2>
          <p class="small muted">Write the rule as you would explain it, for example: "In RMPO, Open Qty represents the outstanding quantity against the order. The calculation is based on Order Qty minus Received Qty." Nothing is saved until you choose to.</p>
          <textarea rows="3" [(ngModel)]="teachText" name="teach" class="kb-wide"></textarea>
          <button class="btn primary small" type="button" (click)="analyse()" [disabled]="!teachText.trim()">Analyse</button>
          @if (proposal(); as p) {
            <div class="kb-grid2">
              <div>
                <h3>Understood</h3>
                <ul class="kb-list">
                  <li>Category: {{ p.understanding.category }}</li><li>Transaction: {{ p.understanding.transaction || 'not identified' }}</li><li>Module: {{ p.understanding.module || 'not identified' }}</li>
                  @if (p.understanding.output) { <li>Output: {{ p.understanding.output }}</li> }
                  @if (p.understanding.inputs.length) { <li>Inputs: {{ p.understanding.inputs.join(', ') }}</li> }
                  @if (p.understanding.formula) { <li>Formula: {{ p.understanding.formula }}</li> }
                  @if (p.understanding.expression) { <li>Engine expression: <code>{{ p.understanding.expression }}</code></li> }
                </ul>
                @if (p.related.length) {
                  <h3>Stored rules on the same subject</h3>
                  <ul class="kb-list">@for (r of p.related; track r.id) { <li [class.kb-conflict]="r.relation === 'same-output'"><a [routerLink]="[]" [queryParams]="{ id: r.id }">{{ r.id }}</a> v{{ r.version }} ({{ r.status }}): {{ r.formula }} @if (r.difference) { <br /><span class="small">{{ r.difference }}</span> }</li> }</ul>
                }
                @if (p.understanding.questions.length) { <h3>Questions</h3><ul class="kb-list">@for (x of p.understanding.questions; track x) { <li>{{ x }}</li> }</ul> }
                @if (p.understanding.missing.length) { <h3>Missing information</h3><ul class="kb-list small">@for (x of p.understanding.missing; track x) { <li>{{ x }}</li> }</ul> }
              </div>
              <div>
                <h3>Draft entry <span class="muted small">→ {{ p.suggestedFile }}</span></h3>
                <textarea rows="22" class="kb-wide kb-mono" [(ngModel)]="draftText" name="draft"></textarea>
                @for (x of p.problems; track x) { <p class="kb-bad small">{{ x }}</p> }
                <div class="kb-row">
                  @if (p.correctionOf) { <button class="btn small" type="button" (click)="asCorrection(p.correctionOf)">Make it a correction of {{ p.correctionOf }}</button> }
                  <button class="btn primary small" type="button" (click)="save(false)">Save as draft</button>
                  @if (kb.can('approver')) { <button class="btn small" type="button" (click)="save(true)">Save and activate</button> }
                </div>
                @if (saveMsg()) { <p class="small" [class.kb-bad]="saveBad()">{{ saveMsg() }}</p> }
              </div>
            </div>
          }
        </section>
      }

      <div class="kb-split">
        <div class="kb-entrylist">
          <ul class="kb-list">@for (e of items(); track e.id + '@' + e.version + e.file) {
            <li [class.sel]="e.id === selId()"><button type="button" class="linklike" (click)="select(e.id)">{{ e.title }}</button> <span class="kb-badge" [attr.data-s]="e.status">{{ e.status }}</span><br /><span class="muted small">{{ e.id }} · {{ e.type }}{{ e.module ? ' · ' + e.module : '' }}</span></li>
          }</ul>
        </div>
        @if (detail(); as d) {
          <article class="kb-panel kb-pad kb-detail">
            <h2>{{ d.current.title }} <span class="kb-badge" [attr.data-s]="d.current.status">{{ d.current.status }}</span></h2>
            <p class="small muted">{{ d.current.id }} · version {{ d.current.version }} · knowledge/{{ d.current.file }}</p>
            @if (kb.can('editor') && d.transitions.current.length) {
              <div class="kb-row">@for (t of d.transitions.current; track t) { <button class="btn small" type="button" (click)="move(d.current.id, d.current.version, t)">{{ t === 'Active' ? 'Activate' : t === 'Superseded' ? 'Retire (supersede)' : 'Move to ' + t }}</button> }</div>
            }
            @if (d.pending; as p) {
              <div class="kb-pending">
                <p><strong>Version {{ p.version }} is {{ p.status }}</strong> (review/pending.txt). Until it is activated, answers use version {{ d.current.version }}.</p>
                @if (kb.can('editor')) { <div class="kb-row">@for (t of d.transitions.pending; track t) { <button class="btn small" type="button" (click)="move(p.id, p.version, t)">{{ t === 'Active' ? 'Activate v' + p.version : 'Move v' + p.version + ' to ' + t }}</button> }</div> }
              </div>
            }
            <dl class="kb-fields">@for (k of fieldKeys(); track k) { @if (d.current.fields[k]) { <dt>{{ k }}</dt><dd>{{ d.current.fields[k] }}</dd> } }</dl>
            <h3>Versions</h3>
            <ul class="kb-list small">@for (v of d.versions; track v.version + v.file) { <li>v{{ v.version }} · {{ v.status }} · {{ v.file }}{{ v.isCurrent ? ' · current' : '' }}</li> }</ul>
            @if (d.relations.outgoing.length || d.relations.incoming.length) {
              <h3>Connections</h3>
              <ul class="kb-list small">
                @for (r of d.relations.outgoing; track $index) { <li>{{ r.rel }} → <a [routerLink]="[]" [queryParams]="{ id: r.toId }">{{ r.otherTitle || r.toId }}</a> <span class="muted">({{ r.basis }})</span></li> }
                @for (r of d.relations.incoming; track $index) { <li><a [routerLink]="[]" [queryParams]="{ id: r.fromId }">{{ r.otherTitle || r.fromId }}</a> {{ r.rel }} → this <span class="muted">({{ r.basis }})</span></li> }
              </ul>
            }
            <button class="btn small" type="button" (click)="loadImpact(d.current.id)">What depends on this?</button>
            @if (impact().length) { <ul class="kb-list small">@for (i of impact(); track $index) { <li>{{ i.type }} <a [routerLink]="[]" [queryParams]="{ id: i.id }">{{ i.title }}</a> — {{ i.how }}</li> }</ul> }
            <details class="kb-raw"><summary>TXT entry{{ kb.can('editor') ? ' (edit to create a new draft version)' : '' }}</summary>
              <textarea rows="16" class="kb-wide kb-mono" [(ngModel)]="rawText" name="raw" [readonly]="!kb.can('editor')"></textarea>
              @if (kb.can('editor')) { <button class="btn small" type="button" (click)="saveRaw()">Save as new draft version</button> }
              @if (rawMsg()) { <p class="small" [class.kb-bad]="rawBad()">{{ rawMsg() }}</p> }
            </details>
          </article>
        }
      </div>
    </kb-gate>
  `,
})
export default class RulebookPage {
  protected readonly kb = inject(KbService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly types = TYPES;
  protected readonly statuses = STATUSES;
  protected readonly type = signal('');
  protected readonly status = signal('');
  protected readonly q = signal('');
  protected readonly items = signal<KbEntry[]>([]);
  protected readonly total = signal(0);
  protected readonly selId = signal<string | null>(null);
  protected readonly detail = signal<Detail | null>(null);
  protected readonly impact = signal<{ type: string; id: string; title: string; how: string }[]>([]);
  protected readonly teachOpen = signal(false);
  protected readonly proposal = signal<Proposal | null>(null);
  protected readonly saveMsg = signal(''); protected readonly saveBad = signal(false);
  protected readonly rawMsg = signal(''); protected readonly rawBad = signal(false);
  protected teachText = ''; protected draftText = ''; protected rawText = '';
  protected readonly fieldKeys = computed(() => (this.detail()?.current.order ?? []).filter((k) => !/ ID$/.test(k)));
  private started = false;

  constructor() {
    inject(SeoService).set({ title: 'Business rulebook', description: 'Rules, calculations, terms and procedures of the WFX knowledge base, with versions and approval.', path: '/rulebook', noindex: true, crumbs: [{ label: 'Rulebook', path: '/rulebook' }] });
    this.route.queryParamMap.subscribe((p) => {
      if (p.get('type') !== null) this.type.set(p.get('type') ?? '');
      if (p.get('status') !== null) this.status.set(p.get('status') ?? '');
      const t = p.get('teach');
      if (t) { this.teachOpen.set(true); this.teachText = t; }
      const id = p.get('id');
      if (id && id !== this.selId()) void this.select(id, false);
      if (this.started) void this.load();
    });
    effect(() => { if (this.kb.user() && !this.started) { this.started = true; void this.load(); if (this.teachText) void this.analyse(); } });
  }
  protected async load() {
    const qs = new URLSearchParams({ ...(this.type() ? { type: this.type() } : {}), ...(this.status() ? { status: this.status() } : {}), ...(this.q() ? { q: this.q() } : {}), limit: '300' });
    const r = await this.kb.get<{ total: number; items: KbEntry[] }>(`/entries?${qs}`);
    this.items.set(r.items); this.total.set(r.total);
  }
  protected async select(id: string, nav = true) {
    this.selId.set(id); this.impact.set([]); this.rawMsg.set('');
    if (nav) void this.router.navigate([], { queryParams: { id }, queryParamsHandling: 'merge', replaceUrl: true });
    const d = await this.kb.get<Detail>(`/entries/${encodeURIComponent(id)}`);
    this.detail.set(d); this.rawText = d.raw;
  }
  protected async loadImpact(id: string) { this.impact.set((await this.kb.get<{ items: { type: string; id: string; title: string; how: string }[] }>(`/entries/${encodeURIComponent(id)}/impact`)).items); }
  protected async move(id: string, version: number, to: string) {
    const reason = to === 'Rejected' || to === 'Superseded' ? prompt(`Reason for ${to.toLowerCase()}:`) ?? '' : '';
    try { await this.kb.post(`/entries/${encodeURIComponent(id)}/transition`, { to, version, reason }); await this.select(id, false); await this.load(); }
    catch (e) { alert((e as Error).message); }
  }
  protected async analyse() {
    this.saveMsg.set('');
    const p = await this.kb.post<Proposal>('/rules/propose', { text: this.teachText });
    this.proposal.set(p); this.draftText = p.draftText;
  }
  protected asCorrection(id: string) {
    this.draftText = this.draftText.replace(/^RULE ID: .*$/m, `RULE ID: ${id}`).replace(/^CONFLICT:[\s\S]*?(?=^[A-Z][A-Z /]+:)/m, '');
  }
  protected async save(activate: boolean) {
    this.saveBad.set(false);
    try {
      const r = await this.kb.post<{ id: string; version: number; status?: string }>('/entries', { raw: this.draftText, activate, reason: 'Taught in the Rulebook' });
      this.saveMsg.set(`Saved ${r.id} version ${r.version} as ${r.status ?? 'Draft'}.`);
      await this.load(); await this.select(r.id, true);
    } catch (e) { this.saveBad.set(true); this.saveMsg.set((e as Error).message); }
  }
  protected async saveRaw() {
    this.rawBad.set(false);
    try { const r = await this.kb.post<{ id: string; version: number }>('/entries', { raw: this.rawText, reason: 'Edited in the Rulebook' }); this.rawMsg.set(`Saved as draft version ${r.version}. Activate it to replace the current version.`); await this.select(r.id, false); }
    catch (e) { this.rawBad.set(true); this.rawMsg.set((e as Error).message); }
  }
}
