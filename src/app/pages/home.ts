import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { STATIC_PAGES } from '../data/catalog';
import { MODULES } from '../data/modules';
import { Icon } from '../shared/icon';

import { HeroMotif } from '../shared/hero-motif';
@Component({
  selector: 'app-home',
  imports: [RouterLink, Icon, HeroMotif],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="hero">
      <div class="hero-text">
        <p class="eyebrow">WFX Atlas · ERP knowledge</p>
        <h1>Every WFX transaction, <em>explained</em> and connected.</h1>
        <p class="lead">Pick a module to see its workflow, data model, formulas and theory. Nothing else gets in the way.</p>
        <form class="hero-ask" role="search" (submit)="ask($event, hq.value)">
          <label for="hero-q" class="visually-hidden">Ask a question or give a command</label>
          <input #hq id="hero-q" type="search" placeholder="Ask, or say: make a workflow from techpack to production order" autocomplete="off" />
          <button class="btn primary" type="submit">Ask</button>
        </form>
      </div>
      <div class="hero-art"><wfx-hero-motif /></div>
    </section>

    <section class="pick" aria-labelledby="pick-h">
      <h2 id="pick-h" class="pick-title">Choose a module</h2>
      <div class="pick-row" role="group" aria-label="Modules">
        @for (m of modules; track m.id; let i = $index) {
          <button type="button" class="pick-mod" [class.on]="m.id === sel()?.id" [attr.aria-pressed]="m.id === sel()?.id" [style.--i]="i" (click)="toggle(m.id)">
            <span class="pick-ic"><app-icon [name]="m.icon" [size]="28" /></span>
            <strong>{{ m.name }}</strong>
          </button>
        }
      </div>

      @if (sel(); as m) {
        <div class="pick-panel swap-in" aria-live="polite">
          <p class="pick-blurb"><strong>{{ m.name }}</strong> · {{ m.blurb }}</p>
          <div class="pick-actions">
            @if (m.steps.length) {
              <a class="pick-act" routerLink="/workflows" [queryParams]="{ steps: m.steps.join(',') }"><app-icon name="route" [size]="22" /><strong>Workflow</strong><span>Step by step</span></a>
            }
            @if (m.docs.length) {
              <a class="pick-act" routerLink="/data-model" [queryParams]="{ module: m.id }"><app-icon name="table" [size]="22" /><strong>Data model</strong><span>How data moves</span></a>
            }
            <a class="pick-act" routerLink="/data" [queryParams]="{ area: m.dataArea }"><app-icon name="list" [size]="22" /><strong>Guides &amp; records</strong><span>How-to and the data</span></a>
            @if (m.txns.length) {
              <a class="pick-act" routerLink="/calculations" [queryParams]="{ module: m.id }"><app-icon name="calc" [size]="22" /><strong>Formulas</strong><span>How it is calculated</span></a>
              <a class="pick-act" routerLink="/theory" [queryParams]="{ module: m.id }"><app-icon name="doc" [size]="22" /><strong>Theory</strong><span>Short explanations</span></a>
            }
          </div>
        </div>
      } @else {
        <p class="dm-hint"><span class="dm-pulse"></span>Tap a module to open what you need.</p>
      }
    </section>
  `,
})
export default class HomePage {
  private readonly router = inject(Router);
  protected readonly modules = MODULES;
  private readonly picked = signal<string | null>(null);
  protected readonly sel = computed(() => MODULES.find((m) => m.id === this.picked()) ?? null);

  constructor() {
    const p = STATIC_PAGES[0];
    inject(SeoService).set({ title: p.title, description: p.description, path: '/' });
  }

  protected toggle(id: string): void {
    this.picked.update((v) => (v === id ? null : id));
  }

  protected ask(ev: Event, q: string): void {
    ev.preventDefault();
    if (q.trim()) this.router.navigate(['/assistant'], { queryParams: { q: q.trim() } });
  }
}
