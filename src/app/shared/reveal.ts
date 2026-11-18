import { Directive, ElementRef, afterNextRender, inject, input } from '@angular/core';
import { revealOnce } from '../core/motion';

/**
 * Plays the shared enter animation once, when the element scrolls into view (core/motion.ts revealOnce).
 * The optional value is a delay in steps of the 40 ms stagger token, capped at 8, so a list cascades and
 * the rest arrives together. Prerendered HTML stays visible: the element is only hidden once the script runs.
 */
@Directive({ selector: '[appReveal]', host: { '[style.animation-delay]': 'delay()' } })
export class Reveal {
  /** Position in a list (0, 1, 2 …); older pages passed milliseconds, which are read as 40 ms steps. */
  readonly step = input(0, { alias: 'appReveal', transform: (v: unknown) => Number(v) || 0 });
  protected readonly delay = () => `calc(${Math.min(this.step() >= 40 ? Math.round(this.step() / 40) : this.step(), 8)} * var(--wfx-stagger))`;
  private readonly el = inject(ElementRef<HTMLElement>);

  constructor() {
    afterNextRender(() => revealOnce(this.el.nativeElement as HTMLElement, 'enter'));
  }
}
