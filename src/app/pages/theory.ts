import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { COLORS, SITE } from '../data/catalog';
import { calcById } from '../data/calculations';
import { presetsForTheory } from '../data/journey';
import { BOM_COLOR_DEP } from '../data/records';
import { INDENT_COMPARISON, THEORY_SUMMARY } from '../data/theory-extras';
import { TRANSACTIONS, txnBySlug } from '../data/transactions';
import type { Calculation } from '../data/types';
import { CostSheet } from '../shared/cost-sheet';
import { ColorChip } from '../shared/color-chip';
import { DataTableView } from '../shared/data-table';
import { KindBadge } from '../shared/kind-badge';
import { Reveal } from '../shared/reveal';
import { NotFoundBody } from './not-found';

type Tab = 'overview' | 'formulas' | 'fields' | 'data' | 'cases';

import { FormulaBadge } from '../shared/states';
@Component({
  selector: 'app-theory',
  imports: [RouterLink, FormulaBadge, KindBadge, DataTableView, CostSheet, ColorChip, Reveal, NotFoundBody],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (txn(); as t) {
      <article>
        <header class="page-head">
          <p class="eyebrow">{{ t.module }}</p>
          <h1>{{ t.name }}</h1>
          @if (summary(); as s) {
            <p class="one-line">{{ s.oneLine }}</p>
            <dl class="facts big">
              @for (f of s.facts; track f.label; let i = $index) {
                <div [appReveal]="i * 70"><dt>{{ f.label }}</dt><dd>{{ f.value }}</dd></div>
              }
            </dl>
          }
          @if (inFlows().length) {
            <p class="in-flow">
              <span class="muted small">Appears in</span>
              @for (x of inFlows(); track x.preset.slug) {
                <a class="flow-pill" [routerLink]="['/workflows', x.preset.slug]" [queryParams]="{ step: x.step.id }">
                  {{ x.preset.name }} · {{ x.step.title }} ▸
                </a>
              }
            </p>
          }
        </header>

        <div class="tabs" role="tablist" aria-label="Sections">
          @for (tb of tabs(); track tb.id) {
            <button type="button" role="tab" [id]="'tab-' + tb.id" [attr.aria-selected]="tab() === tb.id" [attr.aria-controls]="'panel-' + tb.id"
                    [class.on]="tab() === tb.id" (click)="tab.set(tb.id)">{{ tb.label }}@if (tb.count) { <span class="count">{{ tb.count }}</span> }</button>
          }
        </div>

        <!-- All panels are rendered (crawlers and search see everything); only the active one is shown. -->
        <section role="tabpanel" id="panel-overview" aria-labelledby="tab-overview" class="panel-body" [hidden]="tab() !== 'overview'">
          <div class="overview-grid">
            <div>
              <h2 class="h-sm">How it works</h2>
              @for (p of t.theory; track $index) { <p>{{ p }}</p> }
            </div>
            <aside class="side-card">
              <h3>WFX screen</h3>
              <p class="small">{{ t.screen }}</p>
              <h3>Comes from</h3>
              @if (t.upstream.length) {
                <ul class="mini-links">
                  @for (u of t.upstream; track u.slug) { <li><a [routerLink]="['/theory', u.slug]">{{ name(u.slug) }}</a><span>{{ u.what }}</span></li> }
                </ul>
              } @else { <p class="muted small">Start of the chain.</p> }
              <h3>Leads to</h3>
              @if (t.downstream.length) {
                <ul class="mini-links">
                  @for (d of t.downstream; track d.slug) { <li><a [routerLink]="['/theory', d.slug]">{{ name(d.slug) }}</a><span>{{ d.what }}</span></li> }
                </ul>
              } @else { <p class="muted small">End of the chain.</p> }
            </aside>
          </div>

          @if (isIndent()) {
            <h2 class="h-sm">BBB indent vs sales-order indents</h2>
            <div class="table-scroll compare">
              <table>
                <thead><tr>@for (c of compare.columns; track $index) { <th scope="col" [class.hl]="hl($index)">{{ c }}</th> }</tr></thead>
                <tbody>
                  @for (r of compare.rows; track $index) {
                    <tr>@for (c of r; track $index; let ci = $index) { @if (ci === 0) { <th scope="row">{{ c }}</th> } @else { <td [class.hl]="hl(ci)">{{ c }}</td> } }</tr>
                  }
                </tbody>
              </table>
            </div>
          }

          @if (t.slug === 'bom-materials' || t.slug === 'bom-routing' || t.slug === 'bom-costing') {
            <app-cost-sheet />
          }
          @if (t.slug === 'bom-materials') {
            <h2 class="h-sm">Colour dependency</h2>
            <p class="muted">Each style colour maps to one fabric colour. Click a colour to follow it through every workflow.</p>
            <ul class="dep-map">
              @for (d of deps; track d.code) {
                <li [class.unused]="!d.material">
                  <app-color-chip [code]="d.code" /><span class="dep-arrow" aria-hidden="true">→</span>
                  @if (d.material) { <span>N-8 · <app-color-chip [code]="d.material" /></span> } @else { <span class="muted">Not used – no fabric demand</span> }
                </li>
              }
            </ul>
          }

          <h2 class="h-sm">Keys</h2>
          <div class="key-list">
            @for (k of t.keys; track k.name) {
              <div class="key-item"><strong>{{ k.name }}</strong><span class="muted small">{{ k.format }}</span><code>{{ k.example }}</code></div>
            }
          </div>
        </section>

        <section role="tabpanel" id="panel-formulas" aria-labelledby="tab-formulas" class="panel-body" [hidden]="tab() !== 'formulas'">
          @if (calcs().length) {
            <div class="calc-list">
              @for (c of calcs(); track c.id) {
                <div class="formula-card">
                  <div class="fc-head"><strong>{{ c.name }}</strong><wfx-formula-badge [status]="c.status" [question]="c.question" verifiedLabel="Verified in WFX" /></div>
                  <code class="fc-formula">{{ c.formula }}</code>
                  <p class="small">{{ c.explanation }}</p>
                  <p class="small"><strong>Example:</strong> {{ c.example }}</p>
                  @if (c.question) { <p class="small question"><strong>Open question:</strong> {{ c.question }}</p> }
                </div>
              }
            </div>
          } @else { <p class="muted">No calculations – every value here is entered or copied from another transaction.</p> }
          @if (t.checks.length) {
            <h2 class="h-sm">Checked against the WFX screen</h2>
            <div class="check-grid">
              @for (c of t.checks; track c.label) {
                <div class="check" [class.bad]="!c.match">
                  <span class="check-mark" aria-hidden="true">{{ c.match ? '✓' : '✕' }}</span>
                  <span><strong>{{ c.label }}</strong><span class="small muted block">Workbook {{ c.workbook }} · WFX {{ c.wfx }}</span></span>
                </div>
              }
            </div>
          }
        </section>

        <section role="tabpanel" id="panel-fields" aria-labelledby="tab-fields" class="panel-body" [hidden]="tab() !== 'fields'">
          <p class="small muted legend-line"><app-kind-badge kind="key" /> identifies the record <app-kind-badge kind="entered" /> typed by the user
            <app-kind-badge kind="linked" /> pulled automatically <app-kind-badge kind="calculated" /> derived by WFX</p>
          @for (g of t.fieldGroups; track g.title) {
            <details class="field-acc" [open]="$first">
              <summary>{{ g.title }} <span class="muted small">{{ g.fields.length }} fields</span></summary>
              <ul class="field-rows">
                @for (f of g.fields; track f.name) {
                  <li>
                    <div class="fr-top"><strong>{{ f.name }}</strong> <app-kind-badge [kind]="f.kind" /></div>
                    <p class="small">{{ f.definition }}</p>
                    @if (f.from || f.calc) {
                      <p class="small fr-src">
                        @if (f.from) { From <a [routerLink]="['/theory', f.from]">{{ name(f.from) }}</a>@if (f.fromField) { › {{ f.fromField }} } }
                        @if (f.calc) { Formula: <a routerLink="/calculations" [fragment]="f.calc">{{ calcName(f.calc) }}</a> }
                      </p>
                    }
                  </li>
                }
              </ul>
            </details>
          }
        </section>

        <section role="tabpanel" id="panel-data" aria-labelledby="tab-data" class="panel-body" [hidden]="tab() !== 'data'">
          @for (tb of t.tables; track tb.title) { <app-data-table [table]="tb" /> }
          @empty { <p class="muted">No line data recorded for this transaction yet.</p> }
        </section>

        <section role="tabpanel" id="panel-cases" aria-labelledby="tab-cases" class="panel-body" [hidden]="tab() !== 'cases'">
          @for (c of t.cases; track c.title) {
            <div class="case" [class]="c.kind">
              <span class="badge" [class]="c.kind">{{ caseLabel[c.kind] }}</span>
              <h3>{{ c.title }}</h3>
              <p>{{ c.body }}</p>
            </div>
          } @empty { <p class="muted">No cases recorded yet.</p> }
        </section>

        <nav class="pager" aria-label="Previous and next transaction">
          @if (prev(); as p) { <a [routerLink]="['/theory', p.slug]" rel="prev">← {{ p.name }}</a> } @else { <span></span> }
          @if (next(); as n) { <a [routerLink]="['/theory', n.slug]" rel="next">{{ n.name }} →</a> }
        </nav>
      </article>
    } @else {
      <app-not-found-body />
    }
  `,
})
export default class TheoryPage {
  readonly slug = input<string>('');
  /** Optional ?view= query parameter that opens a tab directly. */
  readonly view = input<string | undefined>(undefined);
  private readonly seo = inject(SeoService);

  protected readonly tab = signal<Tab>('overview');
  protected readonly txn = computed(() => txnBySlug(this.slug()));
  protected readonly summary = computed(() => THEORY_SUMMARY[this.slug()]);
  protected readonly inFlows = computed(() => presetsForTheory(this.slug()));
  protected readonly calcs = computed(() => (this.txn()?.calcs ?? []).map(calcById).filter((c): c is Calculation => !!c));
  protected readonly isIndent = computed(() => this.slug() === 'adhoc-indent' || this.slug() === 'production-indents');
  protected readonly prev = computed(() => { const t = this.txn(); return t ? TRANSACTIONS.find((x) => x.step === t.step - 1) : undefined; });
  protected readonly next = computed(() => { const t = this.txn(); return t ? TRANSACTIONS.find((x) => x.step === t.step + 1) : undefined; });
  protected readonly tabs = computed(() => {
    const t = this.txn();
    if (!t) return [];
    return [
      { id: 'overview' as Tab, label: 'Overview', count: 0 },
      { id: 'formulas' as Tab, label: 'Formulas & checks', count: this.calcs().length + t.checks.length },
      { id: 'fields' as Tab, label: 'Fields', count: t.fieldGroups.reduce((a, g) => a + g.fields.length, 0) },
      { id: 'data' as Tab, label: 'Sample data', count: t.tables.length },
      { id: 'cases' as Tab, label: 'Cases', count: t.cases.length },
    ];
  });

  protected readonly compare = INDENT_COMPARISON;
  protected readonly caseLabel = { rule: 'Rule', observation: 'Observation', mismatch: 'Mismatch' } as const;
  protected readonly deps = COLORS.map((c) => ({ code: c.code, material: BOM_COLOR_DEP[c.code] ?? null }));

  constructor() {
    effect(() => {
      const t = this.txn();
      const path = `/theory/${this.slug()}`;
      if (!t) {
        this.seo.set({ title: 'Page not found', description: 'This transaction does not exist in the WFX Knowledge Hub.', path, noindex: true });
        return;
      }
      const s = THEORY_SUMMARY[t.slug];
      this.seo.set({
        title: t.name,
        description: s ? `${s.oneLine} ${t.description}`.slice(0, 300) : t.description,
        path,
        crumbs: [{ label: 'Theory', path: '/theory' }, { label: t.name, path }],
        schema: [{ '@type': 'TechArticle', headline: t.name, description: s?.oneLine ?? t.description, url: SITE.url + path, about: 'WFX ERP', articleSection: t.module, inLanguage: 'en' }],
      });
    });
    // reset to the overview tab when moving to another transaction
    effect(() => {
      this.slug();
      const v = this.view() as Tab | undefined;
      this.tab.set(v && ['overview', 'formulas', 'fields', 'data', 'cases'].includes(v) ? v : 'overview');
    });
  }

  /** Highlights the column of the indent being read. */
  protected hl(col: number): boolean {
    return this.slug() === 'adhoc-indent' ? col === 1 : this.slug() === 'production-indents' ? col >= 2 : false;
  }
  protected name(slug: string): string {
    return txnBySlug(slug)?.name ?? slug;
  }
  protected calcName(id: string): string {
    return calcById(id)?.name ?? id;
  }
}
