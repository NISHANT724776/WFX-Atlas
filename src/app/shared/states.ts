// Design-system components for state: the lifecycle chip and chain (the warm ramp), USER vs SYSTEM step markers and
// the Verified / To confirm formula badges. Styling lives in src/design-system/components.css (tokens only).
// Rendered live at /styleguide (section 05).
import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** The Adhoc Indent lifecycle. Warmer = closer to physical stock. Same ids as the scenario simulator. */
export type IndentState = 'none' | 'po' | 'asn' | 'grn';
export const LIFECYCLE: { id: IndentState; label: string; meaning: string }[] = [
  { id: 'none', label: 'Not ordered', meaning: 'nothing committed yet' },
  { id: 'po', label: 'PO created', meaning: 'committed with a supplier' },
  { id: 'asn', label: 'ASN done', meaning: 'shipped, in transit' },
  { id: 'grn', label: 'GRN done', meaning: 'received, physical stock' },
];
const LEVEL: Record<IndentState, number> = { none: 0, po: 1, asn: 2, grn: 3 };

/** One state, as a chip: the dot and the border carry the ramp colour, the label says it in words. */
@Component({
  selector: 'wfx-state-chip',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'wfx-chip', '[attr.data-level]': 'level()', '[attr.data-mode]': 'mode()' },
  template: `<span class="wfx-chip-dot" aria-hidden="true"></span>{{ label() }}`,
})
export class StateChip {
  readonly state = input.required<IndentState>();
  /** current = the state now (filled wash), reached = passed already, ahead = not reached (dashed, quiet). */
  readonly mode = input<'current' | 'reached' | 'ahead'>('current');
  protected readonly level = computed(() => LEVEL[this.state()]);
  protected readonly label = computed(() => LIFECYCLE[LEVEL[this.state()]].label);
}

/** The four states in order with connectors; the current one is marked for assistive technology too. */
@Component({
  selector: 'wfx-lifecycle',
  imports: [StateChip],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ol class="wfx-lifecycle" [attr.aria-label]="label()">
      @for (s of states; track s.id; let i = $index) {
        @if (i > 0) {
          <li class="wfx-lc-link" [attr.data-level]="i" [class.reached]="i <= level()" aria-hidden="true">
            <svg viewBox="0 0 24 12" width="24" height="12"><path d="M1 6h20M16 1.5 21 6l-5 4.5" /></svg>
          </li>
        }
        <li class="wfx-lc-step" [attr.aria-current]="i === level() ? 'step' : null">
          <wfx-state-chip [state]="s.id" [mode]="i === level() ? 'current' : i < level() ? 'reached' : 'ahead'" />
        </li>
      }
    </ol>
  `,
})
export class Lifecycle {
  readonly state = input.required<IndentState>();
  readonly label = input('Adhoc Indent lifecycle');
  protected readonly states = LIFECYCLE;
  protected readonly level = computed(() => LEVEL[this.state()]);
}

/**
 * Who acts in a step, readable without the label: USER is a solid disc (a person does it),
 * SYSTEM is a dashed ring (WFX does it by itself). Only SYSTEM steps may shimmer while processing.
 */
@Component({
  selector: 'wfx-step-marker',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'wfx-marker', '[attr.data-actor]': 'actor()', '[class.wfx-shimmer]': "processing() && actor() === 'system'", role: 'img', '[attr.aria-label]': "actor() === 'user' ? 'User step' : 'System step'" },
  template: `
    <svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" aria-hidden="true">
      @if (actor() === 'user') {
        <circle class="m-disc" cx="12" cy="12" r="11" />
        <circle class="m-glyph-fill" cx="12" cy="9" r="3.2" />
        <path class="m-glyph-fill" d="M6.2 18.2a5.8 5.8 0 0 1 11.6 0Z" />
      } @else {
        <circle class="m-ring" cx="12" cy="12" r="10.25" />
        <path class="m-glyph" d="M12.8 6 8.6 12.6h3.6L11.2 18l4.2-6.6h-3.6Z" />
      }
    </svg>
    @if (showLabel()) { <span class="wfx-marker-label">{{ actor() === 'user' ? 'User' : 'System' }}</span> }
  `,
})
export class StepMarker {
  readonly actor = input.required<'user' | 'system'>();
  readonly size = input(20);
  readonly showLabel = input(false);
  /** A SYSTEM step that is running right now (the shimmer). Ignored for USER steps. */
  readonly processing = input(false);
}

let tipSeq = 0;
/**
 * Formula status. Verified: solid, with a check. To confirm: dashed outline with a question mark, and the open
 * question on hover and on keyboard focus. Different treatments, not a colour swap.
 */
@Component({
  selector: 'wfx-formula-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (status() === 'verified') {
      <span class="wfx-badge" data-kind="verified">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3 8.5 6.5 12 13 4.5" /></svg>{{ verifiedLabel() }}
      </span>
    } @else {
      <span class="wfx-badge" data-kind="confirm" [attr.tabindex]="question() ? 0 : null" [attr.aria-describedby]="question() ? tipId : null">
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><circle cx="8" cy="8" r="6.5" /><path d="M6.2 6.2a1.9 1.9 0 1 1 2.6 1.8c-.5.2-.8.6-.8 1.1v.4M8 11.6v.1" /></svg>To confirm
        @if (question()) { <span class="wfx-tip" role="tooltip" [id]="tipId"><span class="wfx-tip-k">Open question</span>{{ question() }}</span> }
      </span>
    }
  `,
  host: { class: 'wfx-badge-host' },
})
export class FormulaBadge {
  readonly status = input.required<'verified' | 'assumed'>();
  readonly question = input<string | undefined>(undefined);
  readonly verifiedLabel = input('Verified');
  protected readonly tipId = `wfx-tip-${++tipSeq}`;
}
