import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { SITE, STATIC_PAGES } from '../data/catalog';
import { GLOSSARY } from '../data/glossary';
import { txnBySlug } from '../data/transactions';

@Component({
  selector: 'app-glossary',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>WFX glossary</h1>
    <p class="lead">Plain-language definitions of the terms used across WFX transactions.</p>
    <label class="search">
      <span class="visually-hidden">Filter terms</span>
      <input type="search" placeholder="Filter terms, e.g. wastage" [value]="q()" (input)="q.set($any($event.target).value)" />
    </label>
    <dl class="glossary">
      @for (t of terms(); track t.slug) {
        <div class="term" [id]="t.slug">
          <dt>{{ t.term }}</dt>
          <dd>{{ t.definition }}
            @if (t.txn) { <a class="small" [routerLink]="['/theory', t.txn]">See {{ name(t.txn) }}</a> }
          </dd>
        </div>
      } @empty {
        <p class="muted">No term matches “{{ q() }}”. Try <a routerLink="/ask" [queryParams]="{ q: q() }">asking the knowledge base</a>.</p>
      }
    </dl>
  `,
})
export default class GlossaryPage {
  protected readonly q = signal('');
  protected readonly terms = computed(() => {
    const q = this.q().trim().toLowerCase();
    const list = [...GLOSSARY].sort((a, b) => a.term.localeCompare(b.term));
    return q ? list.filter((t) => (t.term + ' ' + t.definition).toLowerCase().includes(q)) : list;
  });

  constructor() {
    const p = STATIC_PAGES.find((x) => x.path === '/glossary')!;
    inject(SeoService).set({
      title: p.title, description: p.description, path: p.path, crumbs: [{ label: 'Glossary', path: p.path }],
      schema: [{
        '@type': 'DefinedTermSet',
        name: 'WFX ERP glossary',
        url: SITE.url + p.path,
        hasDefinedTerm: GLOSSARY.map((t) => ({ '@type': 'DefinedTerm', name: t.term, description: t.definition, url: `${SITE.url}${p.path}#${t.slug}` })),
      }],
    });
  }
  protected name(slug: string) {
    return txnBySlug(slug)?.name ?? slug;
  }
}
