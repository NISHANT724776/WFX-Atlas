import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { COLORS } from '../data/catalog';

/** Colour code rendered as a swatch chip that opens the colour tracker. */
@Component({
  selector: 'app-color-chip',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (color(); as c) {
      <a class="chip" [routerLink]="['/color-cards', c.card, c.slug]" [title]="'Track ' + c.name + ' (' + c.code + ') across all transactions'">
        <span class="swatch" [style.background]="c.hex" aria-hidden="true"></span>
        {{ c.name }} <span class="muted">({{ c.code }})</span>
      </a>
    } @else {
      <span>{{ code() }}</span>
    }
  `,
})
export class ColorChip {
  readonly code = input.required<string>();
  protected readonly color = computed(() => COLORS.find((c) => c.code === this.code()));
}
