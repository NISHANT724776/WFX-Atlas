import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { STATIC_PAGES } from '../data/catalog';
import { CALCULATIONS } from '../data/calculations';
import { MODULES, moduleById } from '../data/modules';
import { TRANSACTIONS, txnBySlug } from '../data/transactions';
import { ModulePicker } from '../shared/module-picker';

type Filter = 'all' | 'verified' | 'assumed';

import { FormulaBadge } from '../shared/states';
@Component({
  selector: 'app-calculations',
  imports: [RouterLink, ModulePicker, FormulaBadge],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head">
    <p class="eyebrow">Formulas</p>
    <h1>Calculation <em>library</em></h1>
    <p class="lead">Every formula in the flow with a worked example. <strong>Verified</strong> formulas reproduce
      the value WFX showed on screen. <strong>To confirm</strong> formulas could not be proved by the sample data yet
      and carry an open question.</p>
    </header>

    <app-module-picker [modules]="modules" [selected]="sel()?.id" label="Modules" (pick)="pick($event)" />

    <label class="search"><span class="visually-hidden">Filter formulas</span>
      <input type="search" placeholder="Filter, e.g. wastage, markup, MRP" [value]="q()" (input)="q.set($any($event.target).value)" /></label>

    <div class="toolbar" role="group" aria-label="Filter by status">
      <button type="button" class="seg" [class.on]="filter() === 'all'" [attr.aria-pressed]="filter() === 'all'" (click)="filter.set('all')">All ({{ all.length }})</button>
      <button type="button" class="seg" [class.on]="filter() === 'verified'" [attr.aria-pressed]="filter() === 'verified'" (click)="filter.set('verified')">Verified ({{ count('verified') }})</button>
      <button type="button" class="seg" [class.on]="filter() === 'assumed'" [attr.aria-pressed]="filter() === 'assumed'" (click)="filter.set('assumed')">To confirm ({{ count('assumed') }})</button>
    </div>

    @if (!sel() && !q().trim()) {
      <p class="dm-hint"><span class="dm-pulse"></span>Tap a module to see its formulas, or type above to search all of them.</p>
    } @else if (!groups().length) { <p class="muted">No formula matches “{{ q() }}”. <a routerLink="/assistant" [queryParams]="{ q: q() }">Ask the assistant instead →</a></p> }
    @for (g of groups(); track g.slug) {
      <section>
        <h2><a [routerLink]="['/theory', g.slug]">{{ g.step }}. {{ g.name }}</a></h2>
        <div class="calc-list">
          @for (c of g.calcs; track c.id) {
            <div class="formula-card" [id]="c.id">
              <div class="fc-head"><strong>{{ c.name }}</strong>
                <wfx-formula-badge [status]="c.status" [question]="c.question" verifiedLabel="Verified in WFX" /></div>
              <code class="fc-formula">{{ c.formula }}</code>
              <details class="fc-more">
                <summary>Explanation and example</summary>
                <p class="small">{{ c.explanation }}</p>
                <p class="small"><strong>Example:</strong> {{ c.example }}</p>
              </details>
              @if (c.question) { <p class="small question"><strong>Open question:</strong> {{ c.question }}</p> }
            </div>
          }
        </div>
      </section>
    }
  `,
})
export default class CalculationsPage {
  protected readonly all = CALCULATIONS;
  protected readonly filter = signal<Filter>('all');
  protected readonly q = signal('');
  /** ?module= opens a module straight away. */
  readonly module = input<string | undefined>(undefined);
  protected readonly modules = MODULES.filter((m) => m.txns.length);
  private readonly picked = signal<string | null | undefined>(undefined);
  protected readonly sel = computed(() => moduleById(this.picked() === undefined ? this.module() : this.picked() ?? undefined));
  protected pick(id: string | null): void { this.picked.set(id); }
  protected readonly groups = computed(() => {
    const f = this.filter();
    const q = this.q().trim().toLowerCase();
    const hit = (c: (typeof CALCULATIONS)[number]) => !q || `${c.name} ${c.formula} ${c.explanation}`.toLowerCase().includes(q);
    const m = this.sel();
    // a search looks across every module; otherwise only the chosen module is shown
    if (!q && !m) return [];
    return TRANSACTIONS.filter((t) => q || !m || m.txns.includes(t.slug)).map((t) => ({
      slug: t.slug, step: t.step, name: t.name,
      calcs: CALCULATIONS.filter((c) => c.txn === t.slug && (f === 'all' || c.status === f) && hit(c)),
    })).filter((g) => g.calcs.length);
  });

  constructor() {
    const p = STATIC_PAGES.find((x) => x.path === '/calculations')!;
    inject(SeoService).set({ title: p.title, description: p.description, path: p.path, crumbs: [{ label: 'Calculations', path: p.path }] });
  }
  protected count(s: Filter) {
    return CALCULATIONS.filter((c) => c.status === s).length;
  }
  protected txnName(slug: string) {
    return txnBySlug(slug)?.name ?? slug;
  }
}
