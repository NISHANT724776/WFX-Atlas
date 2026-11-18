import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import type { FieldKind } from '../data/types';

const LABEL: Record<FieldKind, string> = {
  key: 'Key',
  entered: 'Entered',
  linked: 'From another transaction',
  calculated: 'Calculated',
};

@Component({
  selector: 'app-kind-badge',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<span class="badge" [class]="'kind-' + kind()">{{ label() }}</span>`,
})
export class KindBadge {
  readonly kind = input.required<FieldKind>();
  protected readonly label = computed(() => LABEL[this.kind()]);
}
