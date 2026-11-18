import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Line icons drawn on a 24×24 grid with the current text colour (1.5px stroke, round cap and join — one family). */
const PATHS: Record<string, string> = {
  swatch: 'M4 20V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v15a3 3 0 0 1-6 0zM10 8l3.5-3.5a1 1 0 0 1 1.4 0l2.8 2.8a1 1 0 0 1 0 1.4L10 16.4M7 20h12a1 1 0 0 0 1-1v-4a1 1 0 0 0-1-1h-3',
  shirt: 'M8 3 3 6l2 5 2-1v11h10V10l2 1 2-5-5-3a4 4 0 0 1-8 0z',
  roll: 'M4 7a3 3 0 1 0 6 0 3 3 0 1 0-6 0zM7 4h11a3 3 0 0 1 0 6H7M10 7v12a1 1 0 0 0 1 1h9M18 10v10',
  bom: 'M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h5',
  route: 'M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM18 9a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM6 15V9a3 3 0 0 1 3-3h7M18 9v6a3 3 0 0 1-3 3H8',
  calc: 'M6 3h12v18H6zM9 7h6M9 12h1M14 12h1M9 16h1M14 16h1',
  check: 'M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6zM9 12l2 2 4-4',
  clipboard: 'M9 4h6v3H9zM9 5H6v16h12V5h-3M9 12h6M9 16h4',
  list: 'M5 4h14v16H5zM9 8h7M9 12h7M9 16h5M7 8h.01M7 12h.01M7 16h.01',
  cube: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM12 12l8-4.5M12 12v9M12 12 4 7.5',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3.1 14H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.2-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 3.1V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  table: 'M4 5h16v14H4zM4 10h16M4 15h16M10 5v14',
  save: 'M5 4h11l3 3v13H5zM8 4v5h7V4M8 20v-6h8v6',
  play: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM10 8.5v7l6-3.5z',
  doc: 'M7 3h7l5 5v13H7zM14 3v5h5M10 13h6M10 17h4',
  cart: 'M3 4h2l2.5 11h10L20 7H6.5M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM17 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
  truck: 'M3 6h11v10H3zM14 10h4l3 3v3h-7M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4zM17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z',
  box: 'M12 3l8 4.5v9L12 21l-8-4.5v-9zM4 7.5l8 4.5 8-4.5M12 12v9M8 5.3l8 4.5',
  order: 'M5 3h14v18l-3-2-2 2-2-2-2 2-2-2-3 2zM9 8h6M9 12h6M9 16h3',
  link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  scale: 'M12 4v16M6 20h12M5 8h14M5 8l-3 6a3 3 0 0 0 6 0zM19 8l-3 6a3 3 0 0 0 6 0zM12 4a1 1 0 1 0 0-2',
  chart: 'M4 20h16M7 16v-5M12 16V8M17 16v-8',
  factory: 'M3 20V10l5 3V10l5 3V10l5 3V4h3v16zM7 17h2M12 17h2M17 17h2',
  cog: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  bolt: 'M13 2 4 14h7l-1 8 9-12h-7z',
};

/** The ten module icons (wfx-ui-pack/assets/icons): apparel-manufacturing marks, drawn as shape lists. */
type Shape = { t: 'path' | 'rect' | 'circle' | 'ellipse'; [attr: string]: string | undefined };
export const MODULE_ICONS: Record<string, Shape[]> = {"mod-booking": [{"t": "rect", "x": "3", "y": "5", "width": "18", "height": "16", "rx": "2"}, {"t": "path", "d": "M3 10h18"}, {"t": "path", "d": "M8 3.2v3.6"}, {"t": "path", "d": "M16 3.2v3.6"}, {"t": "rect", "x": "6.6", "y": "13", "width": "7", "height": "4.6", "rx": "1.2"}], "mod-definitions": [{"t": "path", "d": "M9 4.2C6.4 7.5 6.4 16.5 9 19.8"}, {"t": "path", "d": "M15 4.2c2.6 3.3 2.6 12.3 0 15.6"}, {"t": "path", "d": "M9.6 12h4.8"}, {"t": "circle", "cx": "12", "cy": "8.3", "r": "1"}, {"t": "circle", "cx": "12", "cy": "15.7", "r": "1"}], "mod-inventory": [{"t": "path", "d": "M12 2.8 20.5 7.2v9.6L12 21.2 3.5 16.8V7.2Z"}, {"t": "path", "d": "M3.5 7.2 12 11.6l8.5-4.4"}, {"t": "path", "d": "M12 11.6v9.6"}], "mod-masters": [{"t": "ellipse", "cx": "12", "cy": "5.8", "rx": "8", "ry": "3.1"}, {"t": "path", "d": "M4 5.8v5.3c0 1.71 3.58 3.1 8 3.1s8-1.39 8-3.1V5.8"}, {"t": "path", "d": "M4 11.1v5.3c0 1.71 3.58 3.1 8 3.1s8-1.39 8-3.1v-5.3"}], "mod-planning": [{"t": "path", "d": "M3.2 4.5v17"}, {"t": "rect", "x": "5.4", "y": "6.4", "width": "9", "height": "3.4", "rx": "1.2"}, {"t": "rect", "x": "8.8", "y": "12.3", "width": "9.4", "height": "3.4", "rx": "1.2"}, {"t": "rect", "x": "6.6", "y": "18.1", "width": "7.4", "height": "3.4", "rx": "1.2"}], "mod-production": [{"t": "path", "d": "M3 20.5h18"}, {"t": "path", "d": "M5 20.5V10l4.3 2.7V10l4.3 2.7V10l4.3 2.7V6.5h2.6v14"}], "mod-sales": [{"t": "path", "d": "M6 3h8l5 5v12a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z"}, {"t": "path", "d": "M14 3v5h5"}, {"t": "path", "d": "M8.5 13.5h7"}, {"t": "path", "d": "M8.5 17h4.5"}], "mod-setup": [{"t": "path", "d": "M3 7h18"}, {"t": "path", "d": "M3 12h18"}, {"t": "path", "d": "M3 17h18"}, {"t": "circle", "cx": "8.5", "cy": "7", "r": "2.25", "fill": "var(--icon-bg, none)"}, {"t": "circle", "cx": "15.5", "cy": "12", "r": "2.25", "fill": "var(--icon-bg, none)"}, {"t": "circle", "cx": "6.5", "cy": "17", "r": "2.25", "fill": "var(--icon-bg, none)"}], "mod-style": [{"t": "path", "d": "M9 4 4.4 6.4 3 10.2l3.2 1.2.7-1.6V20h10.2V9.8l.7 1.6 3.2-1.2L19.6 6.4 15 4"}, {"t": "path", "d": "M9 4c1 2.6 5 2.6 6 0"}], "mod-tna": [{"t": "circle", "cx": "12", "cy": "12", "r": "8.5"}, {"t": "path", "d": "M12 4.6V6"}, {"t": "path", "d": "M19.4 12H18"}, {"t": "path", "d": "M12 19.4V18"}, {"t": "path", "d": "M4.6 12H6"}, {"t": "path", "d": "M12 7.2V12l3.4 2.1"}]} as Record<string, Shape[]>;
export const MODULE_ICON_NAMES = Object.keys(MODULE_ICONS);

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'icon', 'aria-hidden': 'true' },
  template: `<svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    @if (shapes(); as list) {
      @for (e of list; track $index) {
        @switch (e.t) {
          @case ('rect') { <rect [attr.x]="e['x']" [attr.y]="e['y']" [attr.width]="e['width']" [attr.height]="e['height']" [attr.rx]="e['rx']" /> }
          @case ('circle') { <circle [attr.cx]="e['cx']" [attr.cy]="e['cy']" [attr.r]="e['r']" [attr.fill]="e['fill']" /> }
          @case ('ellipse') { <ellipse [attr.cx]="e['cx']" [attr.cy]="e['cy']" [attr.rx]="e['rx']" [attr.ry]="e['ry']" /> }
          @default { <path [attr.d]="e['d']" /> }
        }
      }
    } @else { <path [attr.d]="d()" /> }
  </svg>`,
})
export class Icon {
  readonly name = input.required<string>();
  readonly size = input(24);
  protected readonly shapes = computed(() => MODULE_ICONS[this.name()] ?? null);
  protected readonly d = computed(() => PATHS[this.name()] ?? PATHS['doc']);
}
