import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { AppModule } from '../data/modules';
import { Icon } from './icon';

/** A row of module icons. Selecting one reveals that module's content; selecting it again hides it. */
@Component({
  selector: 'app-module-picker',
  imports: [Icon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="pick-row compact" role="group" [attr.aria-label]="label()">
      @for (m of modules(); track m.id; let i = $index) {
        <button type="button" class="pick-mod" [class.on]="m.id === selected()" [attr.aria-pressed]="m.id === selected()" [style.--i]="i" (click)="pick.emit(m.id === selected() ? null : m.id)">
          <span class="pick-ic"><app-icon [name]="m.icon" [size]="24" /></span>
          <strong>{{ m.name }}</strong>
        </button>
      }
    </div>
  `,
})
export class ModulePicker {
  readonly modules = input.required<AppModule[]>();
  readonly selected = input<string | null | undefined>(null);
  readonly label = input('Modules');
  readonly pick = output<string | null>();
}
