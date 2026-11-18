import { ChangeDetectionStrategy, Component, computed, effect, inject, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { COLOR_CARDS, COLORS } from '../data/catalog';
import { traceColor } from '../data/color-trace';
import { NotFoundBody } from './not-found';

@Component({
  selector: 'app-color-card-detail',
  imports: [RouterLink, DecimalPipe, NotFoundBody],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (info(); as c) {
      <p class="eyebrow">Colour card</p>
      <h1>{{ c.name }}</h1>
      <p class="lead">{{ c.description }} Used by Flannel Shirt Adi (NIS-58) and fabric N-8. Pick a colour to track it end to end.</p>

      <ul class="color-grid">
        @for (r of rows(); track r.code) {
          <li>
            <a class="color-tile" [routerLink]="['/color-cards', c.slug, r.slug]">
              <span class="swatch xl" [style.background]="r.hex" aria-hidden="true"></span>
              <span><strong>{{ r.name }}</strong> <span class="muted">({{ r.code }})</span></span>
              <span class="tags">
                <span class="tag" [class.on]="r.inStyle">Style</span>
                <span class="tag" [class.on]="r.inBom">BOM</span>
                <span class="tag" [class.on]="r.ordered">Ordered</span>
                @if (r.warn) { <span class="tag warn">Needs review</span> }
              </span>
            </a>
          </li>
        }
      </ul>

      <section>
        <h2>Dependency and quantity matrix</h2>
        <p class="small muted">Quantity of each colour at every step (KG_Nis for fabric documents, PCS for garment documents). ✓ = present without a quantity, — = not present.</p>
        <div class="table-scroll" tabindex="0" aria-label="Colour matrix (scrollable)">
          <table class="matrix">
            <thead>
              <tr>
                <th scope="col">Colour</th>
                @for (h of headers; track $index) { <th scope="col">{{ h.stage }}<span class="block muted small">{{ h.uom }}</span></th> }
              </tr>
            </thead>
            <tbody>
              @for (r of rows(); track r.code) {
                <tr>
                  <th scope="row"><a [routerLink]="['/color-cards', c.slug, r.slug]"><span class="swatch" [style.background]="r.hex" aria-hidden="true"></span> {{ r.name }}</a></th>
                  @for (s of r.cells; track $index) {
                    <td class="num" [class.off]="!s.present">
                      @if (!s.present) { — } @else if (s.qty !== undefined) { {{ s.qty | number }} } @else { ✓ }
                    </td>
                  }
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else {
      <app-not-found-body />
    }
  `,
})
export default class ColorCardDetailPage {
  readonly card = input<string>('');
  private readonly seo = inject(SeoService);

  protected readonly info = computed(() => COLOR_CARDS.find((c) => c.slug === this.card()));
  protected readonly rows = computed(() =>
    COLORS.filter((c) => c.card === this.card()).map((c) => {
      const t = traceColor(c.code)!;
      const st = t.stages;
      return {
        ...c,
        inStyle: st[1].present,
        inBom: st[2].present,
        ordered: st.find((s) => s.slug === 'buyer-po')!.present,
        warn: t.alerts.some((a) => a.level === 'warn'),
        cells: st.slice(1),
      };
    }),
  );
  protected readonly headers = traceColor('372')!.stages.slice(1).map((s) => ({ stage: s.stage, uom: s.uom ?? '' }));

  constructor() {
    effect(() => {
      const c = this.info();
      const path = `/color-cards/${this.card()}`;
      if (!c) {
        this.seo.set({ title: 'Page not found', description: 'This colour card does not exist in the WFX Knowledge Hub.', path, noindex: true });
        return;
      }
      this.seo.set({
        title: `Colour card ${c.name}`,
        description: `${c.description} See which colours reach the BOM, block booking, buyer order, MRP and FPO, with quantities at each step.`,
        path,
        crumbs: [{ label: 'Colour Cards', path: '/color-cards' }, { label: c.name, path }],
      });
    });
  }
}
