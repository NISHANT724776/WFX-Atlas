import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

const GROUPS = {
  workflows: [
    { path: '/workflows', label: 'Guided workflows', hint: 'Pick steps and read the documented flow' },
    { path: '/workflow-designer', label: 'Workflow designer', hint: 'Generate, edit, version and save workflows' },
  ],
  data: [
    { path: '/data-model', label: 'Documented data model', hint: 'How the data moves between documents' },
    { path: '/data-modelling', label: 'Data modelling studio', hint: 'Captured models, drafts, logical view, DDL' },
  ],
} as const;

/** Two pages that belong to one top-bar entry: a small switch at the top of each. */
@Component({
  selector: 'section-switch',
  imports: [RouterLink, RouterLinkActive],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <nav class="sec-switch" [attr.aria-label]="group() === 'workflows' ? 'Workflow views' : 'Data model views'">
      @for (t of items(); track t.path) { <a [routerLink]="t.path" routerLinkActive="on" [title]="t.hint">{{ t.label }}</a> }
    </nav>
  `,
})
export class SectionSwitch {
  readonly group = input.required<'workflows' | 'data'>();
  protected items() { return GROUPS[this.group()]; }
}
