import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { ViewportScroller } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet, Scroll } from '@angular/router';
import { filter } from 'rxjs';
import { SeoService } from './core/seo.service';
import { ThemeService } from './core/theme.service';
import { FLOW_INDEX, TXN_INDEX } from './data/catalog';
import { ChatWidget } from './shared/chat-widget';
import { KbService } from './core/kb.service';
import { KB_TABS } from './platform/tabs';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, ChatWidget],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:click)': 'onDocClick($event)', '(document:keydown.escape)': 'kbOpen.set(false)' },
  templateUrl: './app.html',
})
export class App {
  protected readonly seo = inject(SeoService);
  protected readonly theme = inject(ThemeService);
  protected readonly flows = FLOW_INDEX;
  protected readonly txns = TXN_INDEX;
  protected readonly year = new Date().getFullYear();
  protected readonly nav = [
    { path: '/workflows', label: 'Workflows', also: ['/workflow-designer'] },
    { path: '/data-model', label: 'Data Model', also: ['/data-modelling'] },
    { path: '/theory', label: 'Theory' },
    { path: '/calculations', label: 'Formulas' },
    { path: '/data', label: 'Data' },
  ];
  /** The knowledge platform (assistant, library, rulebook, designers …) lives in one top-bar menu. */
  protected readonly kb = inject(KbService);
  protected readonly kbTabs = computed(() => KB_TABS.filter((t) => !t.role || this.kb.can(t.role)));
  protected readonly kbOpen = signal(false);
  private readonly url = signal('');
  protected readonly kbActive = computed(() => KB_TABS.some((t) => this.url() === t.path || this.url().startsWith(`${t.path}/`)));
  protected readonly more = [
    { path: '/color-cards', label: 'Colour tracking' },
    { path: '/ask', label: 'Ask (search)' },
    { path: '/glossary', label: 'Glossary' },
  ];
  protected readonly menuOpen = signal(false);
  protected on(n: { path: string; also?: string[] }) { const u = this.url(); return [n.path, ...(n.also ?? [])].some((p) => u === p || u.startsWith(`${p}/`)); }
  protected closeMenus() { this.menuOpen.set(false); this.kbOpen.set(false); }
  protected onDocClick(ev: Event) { if (!(ev.target as Element | null)?.closest?.('.kb-menu')) this.kbOpen.set(false); }

  constructor() {
    // Scroll to the top only when the page changes – not when a query parameter (selected step, view) changes.
    const router = inject(Router);
    const scroller = inject(ViewportScroller);
    let lastPath = '';
    this.url.set(router.url.split(/[?#]/)[0]);
    router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed()).subscribe((e) => this.url.set(e.urlAfterRedirects.split(/[?#]/)[0]));
    router.events.pipe(filter((e): e is Scroll => e instanceof Scroll), takeUntilDestroyed()).subscribe((e) => {
      // a skipped navigation (same URL, superseded) has no urlAfterRedirects
      const path = ((e.routerEvent as NavigationEnd).urlAfterRedirects ?? router.url).split(/[?#]/)[0];
      if (e.position) scroller.scrollToPosition(e.position);
      else if (e.anchor) scroller.scrollToAnchor(e.anchor);
      else if (lastPath && path !== lastPath) scroller.scrollToPosition([0, 0]);
      lastPath = path;
    });
  }
}
