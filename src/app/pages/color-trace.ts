import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { COLOR_CARDS, COLORS } from '../data/catalog';
import { traceColor } from '../data/color-trace';
import { NotFoundBody } from './not-found';

@Component({
  selector: 'app-color-trace',
  imports: [RouterLink, DecimalPipe, NotFoundBody],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (data(); as d) {
      <div class="trace-head">
        <span class="swatch hero-swatch" [style.background]="d.color.hex" aria-hidden="true"></span>
        <div>
          <p class="eyebrow">Colour tracking · {{ d.card.name }}</p>
          <h1>{{ d.color.name }} ({{ d.color.code }})</h1>
          <p class="lead">Every WFX transaction this colour touches for Flannel Shirt Adi (NIS-58) and fabric N-8, in flow order.</p>
        </div>
      </div>

      <nav class="color-switch" [attr.aria-label]="'Other colours in ' + d.card.name">
        @for (c of siblings(); track c.code) {
          <a [routerLink]="['/color-cards', d.card.slug, c.slug]" [class.active]="c.code === d.color.code" [attr.aria-current]="c.code === d.color.code ? 'page' : null">
            <span class="swatch" [style.background]="c.hex" aria-hidden="true"></span>{{ c.name }}
          </a>
        }
      </nav>

      @if (d.trace.alerts.length) {
        <section aria-label="Findings">
          @for (a of d.trace.alerts; track a.text) {
            <p class="alert" [class]="a.level">{{ a.text }}</p>
          }
        </section>
      }

      @if (d.trace.stockKeys.length) {
        <p class="small">Stock keys: @for (k of d.trace.stockKeys; track k) { <code>{{ k }}</code> }</p>
      }

      <ol class="timeline">
        @for (s of d.trace.stages; track $index) {
          <li [class.off]="!s.present">
            <span class="dot" aria-hidden="true">{{ s.present ? '✓' : '–' }}</span>
            <div class="tl-body">
              <div class="tl-row">
                <a [routerLink]="['/theory', s.slug]" class="tl-stage">{{ s.stage }}</a>
                @if (s.qty !== undefined && s.present) { <span class="tl-qty">{{ s.qty | number }} {{ s.uom }}</span> }
              </div>
              <p class="small muted">{{ s.doc }}</p>
              <p class="small">{{ s.detail }}</p>
              @if (s.bySize?.length) {
                <ul class="size-split">
                  @for (b of s.bySize; track $index) { <li>{{ b.size }}: <strong>{{ b.qty | number }}</strong></li> }
                </ul>
              }
            </div>
          </li>
        }
      </ol>
      <p><a [routerLink]="['/color-cards', d.card.slug]">← Back to all colours of {{ d.card.name }}</a></p>
    } @else {
      <app-not-found-body />
    }
  `,
})
export default class ColorTracePage {
  readonly card = input<string>('');
  readonly color = input<string>('');
  private readonly seo = inject(SeoService);

  protected readonly data = computed(() => {
    const card = COLOR_CARDS.find((c) => c.slug === this.card());
    const color = COLORS.find((c) => c.slug === this.color() && c.card === this.card());
    if (!card || !color) return undefined;
    return { card, color, trace: traceColor(color.code)! };
  });
  protected readonly siblings = computed(() => COLORS.filter((c) => c.card === this.card()));

  constructor() {
    effect(() => {
      const d = this.data();
      const path = `/color-cards/${this.card()}/${this.color()}`;
      if (!d) {
        this.seo.set({ title: 'Page not found', description: 'This colour does not exist in the WFX Knowledge Hub.', path, noindex: true });
        return;
      }
      const label = `${d.color.name} (${d.color.code})`;
      this.seo.set({
        title: `Track colour ${label}`,
        description: `Follow ${label} from colour card ${d.card.name} through style, BOM dependency, block booking, purchase, GRN, buyer order, MRP and FPO with quantities by size.`,
        path,
        crumbs: [
          { label: 'Colour Cards', path: '/color-cards' },
          { label: d.card.name, path: `/color-cards/${d.card.slug}` },
          { label, path },
        ],
      });
    });
  }
}
