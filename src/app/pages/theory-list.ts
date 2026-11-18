import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { SITE, STATIC_PAGES, TXN_INDEX } from '../data/catalog';
import { MODULES, moduleById } from '../data/modules';
import { THEORY_SUMMARY } from '../data/theory-extras';
import { txnBySlug } from '../data/transactions';
import { ModulePicker } from '../shared/module-picker';

const WITH_THEORY = MODULES.filter((m) => m.txns.length);

@Component({
  selector: 'app-theory-list',
  imports: [RouterLink, ModulePicker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head">
      <p class="eyebrow">Theory</p>
      <h1>Every transaction in <em>one line</em></h1>
      <p class="lead">Choose a module, then open the transaction you want. Each page starts with the one-line answer.</p>
    </header>

    <app-module-picker [modules]="modules" [selected]="sel()?.id" label="Modules" (pick)="pick($event)" />

    @if (sel(); as m) {
      <section class="swap-in" aria-live="polite">
        <p class="muted small pick-blurb">{{ m.name }} · {{ m.blurb }}</p>
        <div class="theory-grid">
          @for (t of items(); track t.slug) {
            <a class="theory-card" [routerLink]="['/theory', t.slug]"><strong>{{ t.name }}</strong><span>{{ t.oneLine }}</span></a>
          }
        </div>
      </section>
    } @else {
      <p class="dm-hint"><span class="dm-pulse"></span>Tap a module to see its transactions.</p>
    }
  `,
})
export default class TheoryListPage {
  /** ?module= opens a module straight away (used by links from the home page and the assistant). */
  readonly module = input<string | undefined>(undefined);
  protected readonly modules = WITH_THEORY;
  private readonly picked = signal<string | null | undefined>(undefined);
  protected readonly sel = computed(() => moduleById(this.picked() === undefined ? this.module() : this.picked() ?? undefined));
  protected readonly items = computed(() => (this.sel()?.txns ?? []).map((slug) => ({ slug, name: txnBySlug(slug)?.name ?? slug, oneLine: THEORY_SUMMARY[slug]?.oneLine ?? '' })));

  constructor() {
    const p = STATIC_PAGES.find((x) => x.path === '/theory')!;
    inject(SeoService).set({
      title: p.title, description: p.description, path: p.path, crumbs: [{ label: 'Theory', path: p.path }],
      schema: [{
        '@type': 'ItemList',
        itemListElement: TXN_INDEX.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, url: `${SITE.url}/theory/${t.slug}` })),
      }],
    });
  }

  protected pick(id: string | null): void { this.picked.set(id); }
}
