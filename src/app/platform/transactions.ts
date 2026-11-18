import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { KbGate, KbTabs } from './shared';

interface Row { id: string; title: string; module: string; status: string; version: number; slug: string; purpose: string }
interface Section { key: string; label: string; value: unknown; documented: boolean }
interface Page { transaction: { id: string; title: string; status: string; version: number; file: string }; sections: Section[]; notDocumented: string[] }

@Component({
  selector: 'app-transactions',
  imports: [KbGate, KbTabs, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="kb-h1">Transaction explorer</h1>
    <kb-gate next="/transactions">
      <kb-tabs />
      <div class="kb-split">
        <ul class="kb-list kb-entrylist">@for (t of rows(); track t.id) {
          <li [class.sel]="t.id === page()?.transaction?.id"><a [routerLink]="[]" [queryParams]="{ id: t.id }">{{ t.title }}</a><br /><span class="muted small">{{ t.module }}</span></li>
        }</ul>
        @if (page(); as p) {
          <article class="kb-panel kb-pad kb-detail">
            <h2>{{ p.transaction.title }} <span class="kb-badge" [attr.data-s]="p.transaction.status">{{ p.transaction.status }}</span></h2>
            <p class="muted small">{{ p.transaction.id }} v{{ p.transaction.version }} · knowledge/{{ p.transaction.file }} · <a [routerLink]="['/rulebook']" [queryParams]="{ id: p.transaction.id }">Edit in the Rulebook</a></p>
            @for (s of p.sections; track s.key) {
              @if (s.documented) {
                <section class="kb-sec">
                  <p class="kb-sec-title">{{ s.label }}</p>
                  @if (isText(s.value)) { <p class="kb-pre">{{ s.value }}</p> }
                  @else if (s.key === 'fields') {
                    <div class="table-scroll"><table><thead><tr><th>Field</th><th>Group</th><th>How it gets its value</th><th>Meaning</th><th>Comes from / rule</th></tr></thead>
                      <tbody>@for (f of asList(s.value); track $index) { <tr><td>{{ f['name'] }}</td><td>{{ f['group'] }}</td><td>{{ f['type'] }}</td><td>{{ f['definition'] }}</td><td>{{ f['source'] || f['calculation'] }}</td></tr> }</tbody></table></div>
                  } @else if (s.key === 'screenshots') {
                    <div class="kb-shots">@for (src of asList(s.value); track $index) { <img [src]="src" alt="WFX screen captured for this transaction" loading="lazy" /> }</div>
                  } @else {
                    <ul class="kb-list">@for (x of asList(s.value); track $index) { <li>@if (x['id']) { <a [routerLink]="[x['type'] === 'document' || String(x['id']).startsWith('DOC-') ? '/library' : '/rulebook']" [queryParams]="String(x['id']).startsWith('DOC-') ? { doc: x['id'] } : { id: x['id'] }">{{ x['title'] }}</a> } @else { {{ x['title'] }} } @if (x['formula']) { <span class="small"> — {{ x['formula'] }}</span> } @if (x['status']) { <span class="kb-badge" [attr.data-s]="x['status']">{{ x['status'] }}</span> }</li> }</ul>
                  }
                </section>
              }
            }
            <section class="kb-sec" data-kind="missing"><p class="kb-sec-title">Not documented yet</p><p class="small">{{ p.notDocumented.join(' · ') }}</p><p class="small muted">These sections stay empty until you provide the information; nothing is filled in from general ERP knowledge.</p></section>
          </article>
        } @else { <p class="muted kb-pad">Pick a transaction.</p> }
      </div>
    </kb-gate>
  `,
})
export default class TransactionsPage {
  private readonly kb = inject(KbService);
  private readonly route = inject(ActivatedRoute);
  protected readonly rows = signal<Row[]>([]);
  protected readonly page = signal<Page | null>(null);
  protected readonly String = String;
  constructor() {
    inject(SeoService).set({ title: 'Transaction explorer', description: 'Documentation page of every WFX transaction in the knowledge base.', path: '/transactions', noindex: true, crumbs: [{ label: 'Transactions', path: '/transactions' }] });
    effect(() => { if (this.kb.user() && !this.rows().length) void this.kb.get<{ transactions: Row[] }>('/transactions').then((r) => this.rows.set(r.transactions)); });
    this.route.queryParamMap.subscribe((p) => { const id = p.get('id'); if (id) void this.kb.init().then(() => this.kb.get<Page>(`/transactions/${encodeURIComponent(id)}`)).then((x) => this.page.set(x)); });
  }
  protected isText(v: unknown) { return typeof v === 'string'; }
  protected asList(v: unknown): Record<string, string>[] { return Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? { title: x } : x)) : []; }
}
