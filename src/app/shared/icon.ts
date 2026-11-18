import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { ICONS, ICON_SOURCE } from './icon-data';

/** Module and data-area icon names (shown together in the styleguide). */
export const MODULE_ICON_NAMES = Object.keys(ICONS).filter((n) => n.startsWith('mod-'));
/** Every icon name the app uses, with the Lucide icon it is drawn from. */
export const ICON_NAMES = Object.keys(ICONS);
export { ICON_SOURCE };

/**
 * One line-icon set for the whole app: Lucide (ISC), on a 24px grid, round caps, drawn in the current text colour.
 * The shapes are generated into icon-data.ts by backend/scripts/build-icons.mjs, so nothing is fetched at runtime.
 */
@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'icon', 'aria-hidden': 'true' },
  template: `<svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" fill="none" stroke="currentColor"
    [attr.stroke-width]="stroke()" stroke-linecap="round" stroke-linejoin="round">
    @for (e of shapes(); track $index) {
      @switch (e.t) {
        @case ('circle') { <circle [attr.cx]="e['cx']" [attr.cy]="e['cy']" [attr.r]="e['r']" /> }
        @case ('rect') { <rect [attr.x]="e['x']" [attr.y]="e['y']" [attr.width]="e['width']" [attr.height]="e['height']" [attr.rx]="e['rx']" [attr.ry]="e['ry']" /> }
        @case ('ellipse') { <ellipse [attr.cx]="e['cx']" [attr.cy]="e['cy']" [attr.rx]="e['rx']" [attr.ry]="e['ry']" /> }
        @case ('line') { <line [attr.x1]="e['x1']" [attr.y1]="e['y1']" [attr.x2]="e['x2']" [attr.y2]="e['y2']" /> }
        @case ('polyline') { <polyline [attr.points]="e['points']" /> }
        @case ('polygon') { <polygon [attr.points]="e['points']" /> }
        @default { <path [attr.d]="e['d']" /> }
      }
    }
  </svg>`,
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(24);
  /** 1.75 reads finer than Lucide's default 2 at UI sizes; small icons keep 2 so they do not thin out. */
  protected readonly stroke = computed(() => (this.size() <= 16 ? 2 : 1.75));
  protected readonly shapes = computed(() => ICONS[this.name()] ?? ICONS['doc']);
}
