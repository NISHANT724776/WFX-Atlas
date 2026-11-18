// Visual step-by-step guide: real screenshots with numbered markers where to tap or click, a short instruction,
// the expected result, Previous / Next, progress and an enlarged view. Also the navigation buttons of an answer:
// they only open destinations the server resolved from the Screen Registry (never a link written by the model).
import { ChangeDetectionStrategy, Component, HostListener, computed, effect, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { KbService } from '../core/kb.service';
import type { KbGuide, KbNavAction } from '../core/kb.service';

/** Opens a registered destination: an app page through the router, a verified outside link in a new tab. */
export async function openDestination(kb: KbService, router: Router, a: KbNavAction | string): Promise<string | null> {
  const nav = typeof a === 'string' ? await kb.get<KbNavAction>(`/chat/navigation/${encodeURIComponent(a)}`) : a;
  if (!nav.allowed) return nav.reason ?? 'You do not have access to this page.';
  if (nav.kind === 'external' && nav.url && /^https:\/\//.test(nav.url)) { window.open(nav.url, '_blank', 'noopener'); return null; }
  if (nav.kind === 'route' && nav.route?.startsWith('/')) { await router.navigate([nav.route], { queryParams: nav.query ?? {} }); return null; }
  return 'This destination is not registered, so it cannot be opened.';
}

@Component({
  selector: 'kb-actions',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (actions().length) {
      <div class="kb-actions" role="group" aria-label="Open in the application">
        @for (a of actions(); track a.id) {
          <button type="button" class="btn small" [class.primary]="a.primary" [disabled]="!a.allowed" [title]="a.allowed ? (a.note ?? '') : (a.reason ?? '')" (click)="go(a)">
            {{ a.kind === 'external' ? '↗ ' : '' }}{{ a.label }}
          </button>
        }
      </div>
      @if (blocked(); as b) { <p class="small kb-warn">{{ b }}</p> }
    }
  `,
})
export class KbActions {
  private readonly kb = inject(KbService);
  private readonly router = inject(Router);
  readonly actions = input<KbNavAction[]>([]);
  protected readonly blocked = signal('');
  protected async go(a: KbNavAction) {
    try { this.blocked.set((await openDestination(this.kb, this.router, a)) ?? ''); } catch (e) { this.blocked.set((e as Error).message); }
  }
}

@Component({
  selector: 'kb-guide',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (g(); as g) {
      <section class="gd" [attr.aria-label]="'Step-by-step guide: ' + g.title">
        <header class="gd-head">
          <div>
            <p class="gd-kicker">{{ g.kind === 'prototype' ? 'Prototype walkthrough · sample data' : 'Step-by-step guide' }}{{ note() ? ' · ' + note() : '' }}</p>
            <h4>{{ g.title }}</h4>
          </div>
          @if (g.prototypeUrl) { <a class="btn small" [href]="g.prototypeUrl" target="_blank" rel="noopener">↗ Open the prototype</a> }
        </header>
        @if (step(); as s) {
          <div class="gd-body">
            <figure class="gd-shot" [class.empty]="!s.image">
              @if (s.image) {
                <button type="button" class="gd-imgbtn" (click)="big.set(true)" aria-label="Enlarge the screenshot">
                  <img [src]="s.image" [alt]="'Screen for step ' + s.n + ': ' + s.title" loading="lazy" />
                  @for (m of s.markers; track $index) {
                    <span class="gd-mark" [style.left.%]="m.x" [style.top.%]="m.y" [style.width.%]="m.w" [style.height.%]="m.h"><span class="gd-pin">{{ $index + 1 }}</span></span>
                  }
                </button>
              } @else { <p class="muted small">No screenshot of this step yet.</p> }
            </figure>
            <div class="gd-text">
              <p class="gd-progress">Step {{ i() + 1 }} of {{ g.steps.length }}</p>
              <div class="gd-bar"><span [style.width.%]="(i() + 1) / g.steps.length * 100"></span></div>
              <h5>{{ s.title }}</h5>
              @if (s.text && s.text !== s.title) { <p>{{ s.text }}</p> }
              @for (m of s.markers; track $index) { <p class="small"><span class="gd-pin inline">{{ $index + 1 }}</span> Tap / click <strong>{{ m.label || 'the highlighted control' }}</strong></p> }
              @if (s.where) { <p class="small muted">In WFX: {{ s.where }}</p> }
              @if (s.result) { <p class="small gd-result">→ {{ s.result }}</p> }
              <div class="gd-nav">
                <button type="button" class="btn small" (click)="go(-1)" [disabled]="i() === 0">‹ Previous</button>
                <button type="button" class="btn small primary" (click)="go(1)" [disabled]="i() === g.steps.length - 1">Next ›</button>
              </div>
            </div>
          </div>
          <ol class="gd-dots" aria-label="Steps">@for (x of g.steps; track x.n; let k = $index) { <li><button type="button" [class.on]="k === i()" (click)="i.set(k)" [attr.aria-label]="'Step ' + x.n + ': ' + x.title" [attr.aria-current]="k === i() ? 'step' : null">{{ x.n }}</button></li> }</ol>
        }
        @if (g.dataNote) { <p class="small muted">{{ g.dataNote }}</p> }
        @for (m of g.missing; track $index) { <p class="small kb-warn">{{ m }}</p> }
        <p class="small muted">Source: {{ g.source }}{{ g.captured ? ' · captured ' + g.captured : '' }}</p>
      </section>
      @if (big() && step()?.image) {
        <div class="gd-overlay" role="dialog" aria-modal="true" aria-label="Enlarged screenshot" (click)="big.set(false)">
          <div class="gd-big" (click)="$event.stopPropagation()">
            <img [src]="step()!.image" [alt]="step()!.title" />
            @for (m of step()!.markers; track $index) { <span class="gd-mark" [style.left.%]="m.x" [style.top.%]="m.y" [style.width.%]="m.w" [style.height.%]="m.h"><span class="gd-pin">{{ $index + 1 }}</span></span> }
          </div>
          <div class="gd-bignav">
            <button type="button" class="btn small" (click)="$event.stopPropagation(); go(-1)" [disabled]="i() === 0">‹ Previous</button>
            <span>Step {{ i() + 1 }} of {{ g.steps.length }} · {{ step()!.title }}</span>
            <button type="button" class="btn small" (click)="$event.stopPropagation(); go(1)" [disabled]="i() === g.steps.length - 1">Next ›</button>
            <button type="button" class="btn small" (click)="big.set(false)">Close</button>
          </div>
        </div>
      }
    } @else if (error()) { <p class="kb-bad small">{{ error() }}</p> } @else { <p class="muted small">Loading the guide…</p> }
  `,
})
export class KbGuideView {
  private readonly kb = inject(KbService);
  readonly id = input.required<string>();
  readonly note = input<string | undefined>(undefined);
  protected readonly g = signal<KbGuide | null>(null);
  protected readonly error = signal('');
  protected readonly i = signal(0);
  protected readonly big = signal(false);
  protected readonly step = computed(() => this.g()?.steps[this.i()] ?? null);
  constructor() {
    effect(() => {
      const id = this.id();
      this.g.set(null); this.i.set(0); this.error.set('');
      this.kb.get<KbGuide>(`/chat/guides/${encodeURIComponent(id)}`).then((x) => this.g.set(x)).catch((e) => this.error.set(`The guide could not be loaded: ${(e as Error).message}`));
    });
  }
  protected go(d: number) { const n = this.g()?.steps.length ?? 0; this.i.set(Math.min(Math.max(this.i() + d, 0), n - 1)); }
  @HostListener('document:keydown', ['$event']) protected key(e: KeyboardEvent) {
    if (!this.big()) return;
    if (e.key === 'Escape') this.big.set(false); else if (e.key === 'ArrowRight') this.go(1); else if (e.key === 'ArrowLeft') this.go(-1);
  }
}
