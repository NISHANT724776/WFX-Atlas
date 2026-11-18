import { Directive, ElementRef, OnDestroy, afterNextRender, inject, input } from '@angular/core';

let observer: IntersectionObserver | null = null;

/**
 * Fades an element up when it scrolls into view. Content is only hidden once the browser
 * has marked <html class="reveal-ready">, so prerendered HTML stays fully visible.
 */
@Directive({ selector: '[appReveal]', host: { class: 'reveal', '[style.--reveal-delay]': 'delay() + "ms"' } })
export class Reveal implements OnDestroy {
  readonly delay = input(0, { alias: 'appReveal', transform: (v: unknown) => Number(v) || 0 });
  private readonly el = inject(ElementRef<HTMLElement>);

  constructor() {
    afterNextRender(() => {
      const node = this.el.nativeElement as HTMLElement;
      const win = node.ownerDocument.defaultView;
      if (!win || !('IntersectionObserver' in win)) return;
      node.ownerDocument.documentElement.classList.add('reveal-ready');
      observer ??= new IntersectionObserver((entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            observer!.unobserve(e.target);
          }
        }
      }, { rootMargin: '0px 0px -8% 0px' });
      observer.observe(node);
    });
  }

  ngOnDestroy(): void {
    observer?.unobserve(this.el.nativeElement);
  }
}
