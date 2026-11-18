// Empty, loading and error states — one component instead of bare "Loading…" text. Loading announces itself politely,
// an error is an alert and can carry a retry action (projected content). Styling: design-system/components.css.
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'wfx-status',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'wfx-status', '[attr.data-kind]': 'kind()', '[class.compact]': 'compact()',
    '[attr.role]': "kind() === 'error' ? 'alert' : kind() === 'loading' ? 'status' : null",
    '[attr.aria-live]': "kind() === 'loading' ? 'polite' : null",
    '[attr.aria-busy]': "kind() === 'loading' ? 'true' : null",
  },
  template: `
    @switch (kind()) {
      @case ('loading') { <span class="wfx-status-bar" aria-hidden="true"><i></i></span> }
      @case ('empty') {
        <svg class="wfx-status-ic" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M3.5 13.5 6 6.5h12l2.5 7v5a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1Z" /><path d="M3.5 13.5h5l1.2 2.2h4.6l1.2-2.2h5" /></svg>
      }
      @case ('error') {
        <svg class="wfx-status-ic" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5.5" /><path d="M12 16.4v.1" /></svg>
      }
    }
    <span class="wfx-status-text">
      <span class="wfx-status-title">{{ title() }}</span>
      @if (detail()) { <span class="wfx-status-detail">{{ detail() }}</span> }
    </span>
    <span class="wfx-status-actions"><ng-content /></span>
  `,
})
export class Status {
  readonly kind = input<'loading' | 'empty' | 'error'>('loading');
  readonly title = input.required<string>();
  readonly detail = input<string | undefined>(undefined);
  /** Inline, left-aligned, no frame: for a state inside a card or list. */
  readonly compact = input(false);
}
