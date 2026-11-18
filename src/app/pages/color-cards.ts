import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { COLOR_CARDS, COLORS, STATIC_PAGES } from '../data/catalog';

@Component({
  selector: 'app-color-cards',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1>Colour cards</h1>
    <p class="lead">A colour card is the palette a style and its materials draw colours from. Open a card to see which
      colours are actually used, and follow any colour through every WFX transaction.</p>
    <div class="card-grid">
      @for (c of cards; track c.slug) {
        <a class="card link-card" [routerLink]="['/color-cards', c.slug]">
          <strong>{{ c.name }}</strong>
          <span class="muted small">{{ c.description }}</span>
          <span class="swatch-row" aria-hidden="true">
            @for (col of colorsOf(c.slug); track col.code) { <span class="swatch lg" [style.background]="col.hex"></span> }
          </span>
        </a>
      }
    </div>
  `,
})
export default class ColorCardsPage {
  protected readonly cards = COLOR_CARDS;
  constructor() {
    const p = STATIC_PAGES.find((x) => x.path === '/color-cards')!;
    inject(SeoService).set({ title: p.title, description: p.description, path: p.path, crumbs: [{ label: 'Colour Cards', path: p.path }] });
  }
  protected colorsOf(card: string) {
    return COLORS.filter((c) => c.card === card);
  }
}
