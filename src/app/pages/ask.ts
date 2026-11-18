import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, effect, inject, input, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { SeoService } from '../core/seo.service';
import { SqlService } from '../core/sql.service';
import { STATIC_PAGES } from '../data/catalog';
import { Answer, AnswerEngine } from '../data/answer';
import { search } from '../data/search';

const KIND_LABEL: Record<string, string> = {
  formula: 'Calculated by WFX', entered: 'Entered by the user', copied: 'Taken from another document', lineage: 'Where it comes from and goes',
  guide: 'Step-by-step guide', workflow: 'Workflow', definition: 'Definition', data: 'From the data files', search: 'Closest matches', none: 'Not found',
};

@Component({
  selector: 'app-ask',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="page-head">
      <p class="eyebrow">Ask</p>
      <h1>Ask anything about <em>WFX</em></h1>
      <p class="lead">Answers come from the hub's own data files, read with SQL: definitions, formulas, where a value comes from and
        where it goes next, or the actual numbers on a BOM line. No AI service is involved.</p>
    </header>

    <form class="ask-form" role="search" (submit)="submit($event, box.value)">
      <label for="ask-q" class="visually-hidden">Your question</label>
      <input #box id="ask-q" type="search" name="q" [value]="q()" placeholder="e.g. How is Cons incl Wastage calculated?" autocomplete="off" />
      <button class="btn primary" type="submit">Ask</button>
    </form>
    <p class="ask-examples">
      @for (ex of examples; track ex) { <a class="chip-link" [routerLink]="['/ask']" [queryParams]="{ q: ex }">{{ ex }}</a> }
    </p>

    @if (q()) {
      @if (loading()) {
        <p class="muted">Looking it up…</p>
      } @else if (answer(); as a) {
        <article class="answer swap-in" aria-live="polite">
          <p class="eyebrow">{{ kindLabel[a.kind] }}</p>
          <h2 class="answer-title">{{ a.title }}</h2>
          <p class="answer-text">{{ a.text }}</p>

          @if (a.formula) { <code class="answer-formula">{{ a.formula }}</code> }
          @if (a.example) { <p class="answer-example">{{ a.example }}</p> }
          @if (a.status === 'assumed' && a.openQuestion) { <p class="alert warn small"><strong>Still to confirm:</strong> {{ a.openQuestion }}</p> }

          @if (a.inputs?.length) {
            <p class="answer-line"><span class="muted small">Calculated from</span>
              @for (i of a.inputs; track i) { <a class="chip-link" [routerLink]="['/ask']" [queryParams]="{ q: 'How is ' + i + ' calculated?' }">{{ i }}</a> }</p>
          }
          @if (a.feeds?.length) {
            <div class="answer-feeds">
              <p class="muted small">Used next in</p>
              <ul>@for (f of a.feeds; track $index) { <li><strong>{{ f.label }}</strong> <span class="muted">· {{ f.where }}</span>@if (f.formula) { <code>{{ f.formula }}</code> }</li> }</ul>
            </div>
          }
          @for (x of a.more ?? []; track x.title) {
            <div class="chat-alsocard"><p class="chat-also">Also relevant</p><p class="chat-title">{{ x.title }}</p><p>{{ x.text }}</p>
              @if (x.points?.length) { <ul>@for (p of x.points!; track $index) { <li>{{ p }}</li> }</ul> }</div>
          }
          @if (a.points?.length) { <ul class="answer-points">@for (p of a.points; track $index) { <li>{{ p }}</li> }</ul> }

          @if (a.table; as t) {
            <p class="muted small">{{ t.caption }}</p>
            <div class="table-scroll" tabindex="0" aria-label="Data (scrollable)">
              <table>
                <thead><tr>@for (c of t.columns; track $index) { <th scope="col">{{ c }}</th> }</tr></thead>
                <tbody>@for (r of t.rows; track $index) { <tr>@for (v of r; track $index) { <td [class.num]="isNum(v)">{{ show(v) }}</td> }</tr> }</tbody>
              </table>
            </div>
          }

          @if (a.links.length) {
            <p class="answer-links">@for (l of a.links; track l.label) { <a [routerLink]="l.path" [queryParams]="l.query ?? null">{{ l.label }} →</a> }</p>
          }
          @if (a.sql.length) {
            <details class="answer-sql">
              <summary>How this was found · {{ a.sql.length }} SQL {{ a.sql.length === 1 ? 'query' : 'queries' }}</summary>
              @for (s of a.sql; track $index) { <pre>{{ s }}</pre> }
            </details>
          }
        </article>

        @if (a.related.length) {
          <p class="ask-related"><span class="muted small">Ask next</span>
            @for (r of a.related; track r) { <a class="chip-link" [routerLink]="['/ask']" [queryParams]="{ q: r }">{{ r }}</a> }</p>
        }
        @if (others().length) {
          <section class="ask-others">
            <h3 class="h-small">Also related</h3>
            <ul class="hit-list">
              @for (h of others(); track h.doc.id) {
                <li><a [routerLink]="h.doc.link" [fragment]="h.doc.fragment" [queryParams]="h.doc.query ?? null"><strong>{{ h.doc.title }}</strong></a>
                  <span class="badge">{{ h.doc.type }}</span><span class="small muted block">{{ h.doc.context }}</span></li>
              }
            </ul>
          </section>
        }
      } @else if (error()) {
        <p class="alert warn">{{ error() }}</p>
      }
    }
  `,
})
export default class AskPage {
  /** Bound from ?q=. */
  readonly q = input<string>('');
  private readonly router = inject(Router);
  private readonly engine = new AnswerEngine(inject(SqlService));
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly kindLabel = KIND_LABEL;
  protected readonly examples = [
    'What is BOM?', 'How is Total Cons Qty calculated?', 'How is Cons incl Wastage calculated?', 'How is Process Rate calculated?',
    'Where does Final Consumption come from?', 'What is the value of N-8?', 'How is Markup calculated?', 'What is In-house Adj.?',
  ];
  protected readonly answer = signal<Answer | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly others = computed(() => {
    const q = this.q(), a = this.answer();
    if (!q || !a) return [];
    return search(q, 6).filter((h) => h.doc.title !== a.title).slice(0, 5);
  });

  constructor() {
    const p = STATIC_PAGES.find((x) => x.path === '/ask')!;
    inject(SeoService).set({ title: p.title, description: p.description, path: p.path, crumbs: [{ label: 'Ask', path: p.path }] });
    effect(() => {
      const question = this.q();
      if (!question || !this.browser) { this.answer.set(null); return; }
      this.loading.set(true);
      this.error.set('');
      this.engine.ask(question)
        .then((a) => this.answer.set(a))
        .catch((e: Error) => { this.answer.set(null); this.error.set(`Could not answer: ${e.message}`); })
        .finally(() => this.loading.set(false));
    });
  }

  protected submit(ev: Event, value: string): void {
    ev.preventDefault();
    this.router.navigate(['/ask'], { queryParams: { q: value.trim() || null } });
  }
  protected isNum(v: unknown) { return typeof v === 'number'; }
  protected show(v: unknown) {
    if (v === null || v === undefined || v === '') return '—';
    return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v);
  }
}
