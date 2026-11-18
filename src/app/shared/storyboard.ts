import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, afterNextRender, effect, inject, input, signal, untracked } from '@angular/core';
import { RouterLink } from '@angular/router';
import { JStep, phaseById, val } from '../data/journey';
import { SimResult } from '../data/sim';
import { Icon } from './icon';

const KIND_LABEL = { user: 'Typed by user', system: 'Filled by WFX', carried: 'Carried from earlier document' } as const;

import { StepMarker } from './states';
@Component({
  selector: 'app-storyboard',
  imports: [RouterLink, Icon, StepMarker],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="story">
      <nav class="story-rail" aria-label="Storyboard steps">
        <ol>
          @for (s of steps(); track s.id; let i = $index) {
            <li [class.on]="active() === s.id" [class.past]="i < activeIndex()">
              <button type="button" (click)="scrollTo(s.id)"><span class="sr-n">{{ i + 1 }}</span><span class="sr-t">{{ s.title }}</span></button>
            </li>
          }
        </ol>
      </nav>

      <div class="story-scenes">
        @for (s of steps(); track s.id; let i = $index) {
          <section class="scene" [id]="'scene-' + s.id" [attr.data-step]="s.id" [class.on]="active() === s.id">
            <div class="scene-text">
              <p class="eyebrow">{{ phaseName(s.phase) }} · step {{ i + 1 }} of {{ steps().length }} · {{ phaseSource(s.phase) }}</p>
              <h2 class="scene-title">{{ s.title }}</h2>
              <wfx-step-marker class="actor-pill" [actor]="s.actor" [size]="18" [showLabel]="true" />
              <p class="scene-short">{{ v(s.short) }}</p>
              <ul class="bpd-points">@for (p of s.points; track $index) { <li>{{ v(p) }}</li> }</ul>
              @if (s.formula; as fo) { <p class="scene-formula"><strong>{{ fo.label }}</strong> = {{ fo.expr }}</p> }
              <a class="small" [routerLink]="['/theory', s.theory]">Read the theory →</a>
            </div>

            <div class="screen" aria-label="Mock WFX screen">
              <div class="screen-bar"><span></span><span></span><span></span><em>{{ s.screen?.title ?? s.doc }}</em></div>
              <div class="screen-body">
                @if (s.screen) {
                  @for (fl of s.screen.fields; track fl.label; let fi = $index) {
                    <div class="sf" [class]="'sf k-' + fl.kind" [style.--fi]="fi" [title]="kind[fl.kind]">
                      <span class="sf-label">{{ fl.label }}</span>
                      <span class="sf-value">{{ v(fl.value) }}</span>
                    </div>
                  }
                } @else if (s.table) {
                  <div class="table-scroll">
                    <table>
                      <thead><tr>@for (c of s.table.columns; track c) { <th scope="col">{{ c }}</th> }</tr></thead>
                      <tbody>@for (row of s.table.rows(result()); track $index; let ri = $index) { <tr class="sf-row" [style.--fi]="ri">@for (c of row; track $index) { <td>{{ c }}</td> }</tr> }</tbody>
                    </table>
                  </div>
                } @else if (s.facts) {
                  @for (fa of s.facts; track fa.label; let fi = $index) {
                    <div class="sf k-system" [style.--fi]="fi"><span class="sf-label">{{ fa.label }}</span><span class="sf-value">{{ v(fa.value) }}</span></div>
                  }
                } @else {
                  <div class="screen-empty">
                    <app-icon [name]="s.icon" [size]="44" />
                    <span>{{ s.doc }}</span>
                  </div>
                }
              </div>
            </div>
          </section>
        }
        <p class="story-legend small">
          <span class="sf-key k-user">Typed by user</span>
          <span class="sf-key k-system">Filled by WFX</span>
          <span class="sf-key k-carried">Carried from an earlier document</span>
        </p>
      </div>
    </div>
  `,
})
export class Storyboard {
  readonly steps = input.required<JStep[]>();
  readonly result = input.required<SimResult>();
  /** Step to scroll to when the storyboard opens. */
  readonly focus = input<string | null>(null);

  protected readonly kind = KIND_LABEL;
  protected readonly active = signal<string | null>(null);
  protected readonly activeIndex = signal(0);
  private readonly host = inject(ElementRef<HTMLElement>);
  private io: IntersectionObserver | null = null;

  constructor() {
    afterNextRender(() => {
      const root = this.host.nativeElement as HTMLElement;
      const win = root.ownerDocument.defaultView;
      if (!win || !('IntersectionObserver' in win)) return;
      this.io = new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            const id = (e.target as HTMLElement).dataset['step']!;
            e.target.classList.add('seen');
            this.active.set(id);
            this.activeIndex.set(this.steps().findIndex((s) => s.id === id));
          }
        }
      }, { rootMargin: '-45% 0px -45% 0px' });
      this.observe();
      const f = untracked(this.focus);
      if (f) setTimeout(() => this.scrollTo(f, 'auto'), 120);
    });
    effect(() => {
      this.steps();
      queueMicrotask(() => this.observe());
    });
    inject(DestroyRef).onDestroy(() => this.io?.disconnect());
  }

  private observe(): void {
    if (!this.io) return;
    this.io.disconnect();
    (this.host.nativeElement as HTMLElement).querySelectorAll('.scene').forEach((el) => this.io!.observe(el));
  }

  protected scrollTo(id: string, behavior: ScrollBehavior = 'smooth'): void {
    const el = (this.host.nativeElement as HTMLElement).querySelector(`#scene-${CSS.escape(id)}`);
    el?.scrollIntoView({ behavior, block: 'center' });
  }
  protected phaseName(id: string): string {
    return phaseById(id).name;
  }
  protected phaseSource(id: string): string {
    return phaseById(id).source;
  }
  protected v(x: Parameters<typeof val>[0]): string {
    return val(x, this.result());
  }
}
