import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Msg } from '../core/chat.service';

/** The conversation, as shown in the floating pop-up (compact) and on the full page (full tables, no limits). */
@Component({
  selector: 'app-chat-thread',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (m of msgs(); track $index) {
      @if (m.role === 'user') {
        <div class="msg user" [attr.data-i]="$index"><p>{{ m.text }}</p></div>
      } @else if (m.ai) {
        <div class="msg bot ai" [attr.data-i]="$index">
          <p class="chat-understood">AI answer · {{ label()(m.ai.provider) }} · {{ m.ai.coverage === 'hub' ? 'from the hub' : m.ai.coverage === 'mixed' ? 'hub + general knowledge' : 'general knowledge' }}</p>
          @if (m.gap) { <p class="chat-gap" role="note">{{ m.gap }}</p> }
          <p class="chat-pre">{{ m.text }}</p>
          @if (m.ai.sources.length) { <p class="chat-src">Based on: {{ m.ai.sources.join(' · ') }}</p> }
        </div>
      } @else if (m.answer; as a) {
        <div class="msg bot" [attr.data-i]="$index">
          @if (m.understood) { <p class="chat-understood">Understood: {{ m.understood }}</p> }
          @if (m.gap) { <p class="chat-gap" role="note">{{ m.gap }}</p> }
          <p class="chat-title">{{ a.title }}</p>
          <p>{{ a.text }}</p>
          @if (a.chain; as ch) {
            <ol class="chat-chain">
              @for (c of ch; track $index) {
                @if (c.gap) { <li class="gap" title="Flow steps left out here">⋯ {{ c.gap }}</li> }
                <li><span>{{ $index + 1 }}</span>{{ c.title }}</li>
              }
            </ol>
          }
          @if (a.formula) { <code class="chat-formula">{{ a.formula }}</code> }
          @if (a.example) { <p class="chat-ex">{{ a.example }}</p> }
          @if (a.points?.length) { <ul>@for (p of (full() ? a.points! : a.points!.slice(0, 5)); track $index) { <li>{{ p }}</li> }</ul> }
          @for (x of a.more ?? []; track x.title) {
            <div class="chat-alsocard">
              <p class="chat-also">Also relevant</p>
              <p class="chat-title">{{ x.title }}</p>
              <p>{{ x.text }}</p>
              @if (x.points?.length) { <ul>@for (p of (full() ? x.points! : x.points!.slice(0, 4)); track $index) { <li>{{ p }}</li> }</ul> }
            </div>
          }
          @if (a.feeds?.length && full()) {
            <p class="muted small">Used next in</p>
            <ul>@for (f of a.feeds!; track $index) { <li><strong>{{ f.label }}</strong> · {{ f.where }}@if (f.formula) { <code>{{ f.formula }}</code> }</li> }</ul>
          }
          @if (a.table; as t) {
            <p class="muted small">{{ t.caption }}</p>
            <div class="table-scroll chat-table" [class.tall]="full()" tabindex="0"><table>
              <thead><tr>@for (c of t.columns; track $index) { <th scope="col">{{ c }}</th> }</tr></thead>
              <tbody>@for (r of (full() ? t.rows : t.rows.slice(0, 6)); track $index) { <tr>@for (v of r; track $index) { <td [class.num]="isNum(v)">{{ show(v) }}</td> }</tr> }</tbody>
            </table></div>
          }
          @if (!full() && isBig(m)) {
            <p class="chat-links"><button type="button" class="chat-more" (click)="openFull.emit($index)">Open full view ⤢</button>
              <span class="muted small">{{ bigNote(m) }}</span></p>
          }
          @if (a.links.length) { <p class="chat-links">@for (l of a.links.slice(0, full() ? 6 : 3); track l.label) { <a [routerLink]="l.path" [queryParams]="l.query ?? null" (click)="navigated.emit()">{{ l.label }} →</a> }</p> }
          @if (a.related.length) { <p class="chat-chips">@for (r of a.related.slice(0, 3); track r) { <button type="button" class="chip-btn" (click)="ask.emit(r)">{{ r }}</button> }</p> }
          @if (full() && a.sql.length) { <details class="answer-sql"><summary>SQL used ({{ a.sql.length }})</summary>@for (s of a.sql; track $index) { <pre>{{ s }}</pre> }</details> }
          @if (aiEnabled() && m.question) { <p class="chat-chips"><button type="button" class="chip-btn chip-ai" [disabled]="busy()" (click)="askAi.emit(m.question!)">Ask AI about this</button></p> }
        </div>
      } @else {
        <div class="msg bot" [attr.data-i]="$index">
          @if (m.gap) { <p class="chat-gap" role="note">{{ m.gap }}</p> }
          <p>{{ m.text }}</p>
          @if (aiEnabled() && m.question) { <p class="chat-chips"><button type="button" class="chip-btn chip-ai" [disabled]="busy()" (click)="askAi.emit(m.question!)">Ask AI (general knowledge)</button></p> }
        </div>
      }
    }
    @if (busy()) { <div class="msg bot"><p class="muted">Thinking…</p></div> }
  `,
})
export class ChatThread {
  readonly msgs = input.required<Msg[]>();
  readonly full = input(false);
  readonly busy = input(false);
  readonly aiEnabled = input(false);
  readonly label = input.required<(p: string) => string>();
  readonly ask = output<string>();
  readonly askAi = output<string>();
  readonly openFull = output<number>();
  readonly navigated = output<void>();

  protected isNum(v: unknown) { return typeof v === 'number'; }
  protected show(v: unknown): string {
    if (v === null || v === undefined || v === '') return '—';
    return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v);
  }
  /** Large answers: a table with more than 6 rows or a list with more than 5 points. */
  protected isBig(m: Msg): boolean {
    const a = m.answer;
    return !!a && ((a.table?.rows.length ?? 0) > 6 || (a.points?.length ?? 0) > 5);
  }
  protected bigNote(m: Msg): string {
    const a = m.answer!;
    return (a.table?.rows.length ?? 0) > 6 ? `${a.table!.rows.length} rows, only 6 shown here` : `${a.points!.length} points, only 5 shown here`;
  }
}
