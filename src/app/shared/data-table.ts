import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { DecimalPipe } from '@angular/common';
import type { DataTable } from '../data/types';
import { ColorChip } from './color-chip';

@Component({
  selector: 'app-data-table',
  imports: [ColorChip, DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <figure class="table-card">
      <figcaption>{{ table().title }}</figcaption>
      <div class="table-scroll" tabindex="0" [attr.aria-label]="table().title + ' (scrollable table)'">
        <table>
          <thead>
            <tr>
              @for (c of table().columns; track $index) { <th scope="col">{{ c }}</th> }
            </tr>
          </thead>
          <tbody>
            @for (row of table().rows; track $index) {
              <tr>
                @for (cell of row; track $index; let ci = $index) {
                  <td [class.num]="isNum(cell)">
                    @if (ci === table().colorCol) {
                      <app-color-chip [code]="'' + cell" />
                    } @else if (isNum(cell)) {
                      {{ $any(cell) | number: '1.0-4' }}
                    } @else {
                      {{ cell }}
                    }
                  </td>
                }
              </tr>
            }
          </tbody>
        </table>
      </div>
      @if (table().note) { <p class="muted small">{{ table().note }}</p> }
    </figure>
  `,
})
export class DataTableView {
  readonly table = input.required<DataTable>();
  protected isNum(v: unknown): boolean {
    return typeof v === 'number';
  }
}
