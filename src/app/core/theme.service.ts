import { DOCUMENT, Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type Theme = 'light' | 'dark';
const KEY = 'wfx-theme';

type VTDocument = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };

/**
 * Light/dark theme with an ink-splash reveal: the new theme spreads from the toggle button
 * (View Transitions API + an ink-blot mask). Falls back to an instant switch.
 */
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private readonly doc = inject(DOCUMENT) as VTDocument;
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly theme = signal<Theme>('light');

  constructor() {
    if (!this.browser) return;
    const set = this.doc.documentElement.dataset['theme'] as Theme | undefined;
    const prefersDark = this.doc.defaultView?.matchMedia('(prefers-color-scheme: dark)').matches;
    this.theme.set(set ?? (prefersDark ? 'dark' : 'light'));
  }

  toggle(origin?: HTMLElement): void {
    const next: Theme = this.theme() === 'dark' ? 'light' : 'dark';
    const root = this.doc.documentElement;
    const apply = () => {
      root.dataset['theme'] = next;
      this.theme.set(next);
      try { localStorage.setItem(KEY, next); } catch { /* storage blocked */ }
    };
    const reduced = this.doc.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!this.doc.startViewTransition || reduced) {
      apply();
      return;
    }
    const win = this.doc.defaultView!;
    const r = origin?.getBoundingClientRect();
    const x = r ? r.left + r.width / 2 : win.innerWidth - 40;
    const y = r ? r.top + r.height / 2 : 32;
    root.style.setProperty('--ink-x', `${Math.round(x)}px`);
    root.style.setProperty('--ink-y', `${Math.round(y)}px`);
    root.classList.add('theme-anim');
    const t = this.doc.startViewTransition(apply);
    t.finished.finally(() => root.classList.remove('theme-anim'));
  }
}
