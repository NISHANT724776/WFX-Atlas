// Question mapping: the enriched knowledge, per module. Counts of knowledge units, canonical questions, variations,
// keywords and terminology; which questions map back to their own unit; what needs review. Editors approve, reject,
// edit and add questions; approvers approve units; "Try a question" shows what a question maps to.
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { Status } from '../shared/status';
import { KbGate, KbTabs } from './shared';

interface ModRow { module: string; entries: number; enriched: boolean; units?: number; canonical?: number; variations?: number; keywords?: number; terms?: number; mapped?: number; checked?: number; toReview?: number; misrouted?: number; unitsToReview?: number; insufficient?: number; approved?: number }
interface Summary { modules: ModRow[]; configured: string[]; enrichedAt: string | null; embedder: string | null; claude: boolean }
interface ClaudeReport { added: number; duplicates: number; asked: number; failed: { unit: string; reason: string }[]; rejected: { reason: string }[]; tokens: number; model: string }
interface UnitRow { id: string; topic: string; aspect: string; canonical_q: string; confidence: string; review: string; review_note: string; entry_status: string; questions: number; misrouted: number }
interface Q { id: number; text: string; norm: string; category: string; origin: string; status: string; duplicate_of: string | null; self_rank: number | null }
interface Unit { id: string; module: string; submodule: string; topic: string; aspect: string; canonical_q: string; answer: string; entry_ids: string[]; screen: string; keywords: string[]; related_modules: string[]; source_ref: string; entry_status: string; confidence: string; review: string; review_note: string; updated_at: string; questions: Q[] }
interface Match { unitId: string; module: string; topic: string; score: number; confidence: number; viaQuestion: string }

const FILTERS = [['', 'All'], ['generated', 'Not reviewed'], ['needs-review', 'Needs review'], ['approved', 'Approved'], ['insufficient', 'Insufficient source'], ['misrouted', 'Misrouted questions'], ['llm', 'Claude proposals to review']] as const;
const CATEGORIES = ['direct', 'conversational', 'informal', 'problem', 'process', 'technical', 'terminology', 'short', 'contextual'];

@Component({
  selector: 'app-question-mapping',
  imports: [KbGate, KbTabs, FormsModule, Status],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="kb-h1">Question mapping</h1>
    <kb-gate next="/question-mapping">
      <kb-tabs />
      <p class="muted">Each knowledge entry is cut into answerable units, and each unit gets the questions people may ask for it. The assistant matches a question against these (and the original text) as well as by keywords. Generated questions are proposals until reviewed.</p>

      @if (sum(); as s) {
        <section class="kb-panel kb-pad">
          <h2 class="kb-sec-title">Modules</h2>
          <div class="qm-scroll">
            <table class="qm-table">
              <thead><tr><th>Module</th><th>Units</th><th>Canonical</th><th>Variations</th><th>Keywords</th><th>Terms</th><th>Map back</th><th>Not reviewed</th><th>Misrouted</th><th>Insufficient</th><th></th></tr></thead>
              <tbody>
                @for (m of s.modules; track m.module) {
                  <tr [class.qm-on]="m.module === module()">
                    <td><button type="button" class="qm-link" (click)="pick(m)" [disabled]="!m.enriched">{{ m.module }}</button><span class="muted small qm-sub">{{ m.entries }} entries</span></td>
                    @if (m.enriched) {
                      <td>{{ m.units }}</td><td>{{ m.canonical }}</td><td>{{ m.variations }}</td><td>{{ m.keywords }}</td><td>{{ m.terms }}</td>
                      <td>{{ m.mapped }}/{{ m.checked }}</td><td>{{ m.toReview }}</td><td [class.kb-bad]="!!m.misrouted">{{ m.misrouted }}</td><td [class.kb-bad]="!!m.insufficient">{{ m.insufficient }}</td>
                    } @else { <td colspan="9" class="muted small">Not enriched yet</td> }
                    <td class="qm-actions">@if (kb.can('editor')) { <button type="button" class="btn small" [disabled]="busy()" (click)="regenerate(m.module)">{{ m.enriched ? 'Regenerate' : 'Enrich' }}</button>
                      @if (m.enriched && s.claude) { <button type="button" class="btn small" [disabled]="busy()" (click)="claudeModule(m.module)" title="Claude writes user-style questions for up to 10 units that have none from Claude yet">Claude: write questions</button> } }</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          @if (!s.claude) { <p class="small muted">Claude is not active, so it cannot write questions yet: add ANTHROPIC_API_KEY to the server's .env and record the approval in Admin › AI provider.</p> }
          <p class="small muted">Map back: generated questions that, asked again, land on their own unit. Embedder: {{ s.embedder ?? '–' }} · last run {{ s.enrichedAt?.slice(0, 16)?.replace('T', ' ') ?? 'never' }}.</p>
        </section>
      } @else if (error()) { <wfx-status kind="error" title="Could not load the question mapping" [detail]="error()" /> } @else { <wfx-status kind="loading" title="Loading the question mapping" /> }

      <section class="kb-panel kb-pad">
        <h2 class="kb-sec-title">Try a question</h2>
        <form class="kb-row" (submit)="$event.preventDefault(); tryIt()">
          <label class="qm-grow">Question <input [(ngModel)]="tryQ" name="tryQ" placeholder="e.g. why can't I remove a delivery" /></label>
          <label>Previous topic <input [(ngModel)]="tryCtx" name="tryCtx" placeholder="optional" /></label>
          <button class="btn primary" type="submit" [disabled]="!tryQ.trim()">Match</button>
        </form>
        @if (matches(); as ms) {
          <ol class="qm-matches">
            @for (m of ms; track m.unitId) {
              <li><button type="button" class="qm-link" (click)="open(m.unitId)">{{ m.topic }}</button> <span class="muted small">{{ m.module }} · score {{ m.score }} · via “{{ m.viaQuestion }}”</span></li>
            }
          </ol>
        }
      </section>

      @if (module()) {
        <section class="kb-panel kb-pad">
          <h2 class="kb-sec-title">{{ module() }} · knowledge units</h2>
          <div class="kb-row">
            <div class="qm-chips" role="group" aria-label="Filter">
              @for (f of filters; track f[0]) { <button type="button" class="chip-btn" [attr.aria-pressed]="filter() === f[0]" [class.on]="filter() === f[0]" (click)="setFilter(f[0])">{{ f[1] }}</button> }
            </div>
            <label class="qm-grow">Find <input [ngModel]="text()" (ngModelChange)="text.set($event); loadUnits()" name="text" placeholder="topic, entry id or question" /></label>
          </div>
          <div class="qm-split">
            <ul class="qm-units">
              @for (u of units(); track u.id) {
                <li><button type="button" class="qm-unit" [class.on]="u.id === sel()?.id" (click)="open(u.id)">
                  <strong>{{ u.topic }}</strong>
                  <span class="small muted">{{ u.aspect }} · {{ u.questions }} questions @if (u.misrouted) { · <span class="kb-bad">{{ u.misrouted }} misrouted</span> }</span>
                  <span class="qm-badges"><span class="kb-badge">{{ u.review }}</span><span class="kb-badge">{{ u.confidence }}</span></span>
                </button></li>
              } @empty { <li><wfx-status kind="empty" title="No units match" [compact]="true" /></li> }
            </ul>
            <div class="qm-detail">
              @if (sel(); as u) {
                <p class="small muted">{{ u.id }} · {{ u.submodule || u.module }} · source status {{ u.entry_status }} · confidence {{ u.confidence }}</p>
                <h3 class="qm-h">{{ u.canonical_q }}</h3>
                <pre class="qm-answer">{{ u.answer }}</pre>
                <p class="small"><strong>Source:</strong> {{ u.source_ref }}</p>
                <p class="small"><strong>Entries:</strong> {{ u.entry_ids.join(', ') }} @if (u.related_modules.length) { · <strong>Related modules:</strong> {{ u.related_modules.join(', ') }} }</p>
                <p class="qm-chips">@for (k of u.keywords; track k) { <span class="kb-badge">{{ k }}</span> }</p>
                <p class="small">Review: <strong>{{ u.review }}</strong> @if (u.review_note) { – {{ u.review_note }} }</p>
                @if (kb.can('editor') && sum()?.claude) { <div class="kb-row"><button type="button" class="btn small" [disabled]="busy()" (click)="claudeUnit(u.id)">Ask Claude for more questions</button><span class="small muted">They arrive as proposals for you to approve or reject.</span></div> }
                @if (kb.can('approver')) {
                  <div class="kb-row"><button type="button" class="btn small primary" [disabled]="busy()" (click)="review('approved')">Approve unit</button>
                  <button type="button" class="btn small" [disabled]="busy()" (click)="review('needs-review')">Mark for review</button></div>
                }
                <table class="qm-table">
                  <thead><tr><th>Question</th><th>Type</th><th>Status</th><th></th></tr></thead>
                  <tbody>
                    @for (q of u.questions; track q.id) {
                      <tr [class.qm-rejected]="q.status === 'rejected'">
                        <td>@if (editing() === q.norm) { <input class="qm-edit" [(ngModel)]="editText" name="edit" (keydown.enter)="save(q)" /> } @else { {{ q.text }} }
                          @if (q.self_rank && q.self_rank > 1) { <span class="kb-bad small" title="Asked again, this question lands on another unit first"> · maps elsewhere (rank {{ q.self_rank }})</span> }
                          @if (q.duplicate_of) { <span class="small muted"> · same as {{ q.duplicate_of }}</span> }</td>
                        <td class="small">{{ q.category }}@if (q.origin !== 'template') { · {{ q.origin }} }</td>
                        <td class="small">{{ q.status }}</td>
                        <td class="qm-actions">@if (kb.can('editor')) {
                          @if (editing() === q.norm) { <button type="button" class="btn small" (click)="save(q)">Save</button> }
                          @else {
                            <button type="button" class="btn small" [disabled]="busy() || q.status === 'approved'" (click)="setQ(q, 'approved')">Approve</button>
                            <button type="button" class="btn small" [disabled]="busy() || q.status === 'rejected'" (click)="setQ(q, 'rejected')">Reject</button>
                            <button type="button" class="btn small" [disabled]="busy()" (click)="edit(q)">Edit</button>
                          } }</td>
                      </tr>
                    }
                  </tbody>
                </table>
                @if (kb.can('editor')) {
                  <form class="kb-row" (submit)="$event.preventDefault(); addQ()">
                    <label class="qm-grow">Add a question <input [(ngModel)]="newQ" name="newQ" placeholder="how a user would ask it" /></label>
                    <label>Type <select [(ngModel)]="newCat" name="newCat">@for (c of categories; track c) { <option [value]="c">{{ c }}</option> }</select></label>
                    <button class="btn" type="submit" [disabled]="busy() || newQ.trim().length < 3">Add</button>
                  </form>
                }
              } @else { <wfx-status kind="empty" title="Choose a unit" detail="Its answer, source and questions appear here." [compact]="true" /> }
            </div>
          </div>
        </section>
      }
      @if (msg()) { <p class="small" role="status">{{ msg() }}</p> }
    </kb-gate>
  `,
})
export default class QuestionMapping {
  protected readonly kb = inject(KbService);
  protected readonly filters = FILTERS;
  protected readonly categories = CATEGORIES;
  protected readonly sum = signal<Summary | null>(null);
  protected readonly error = signal('');
  protected readonly module = signal('');
  protected readonly filter = signal('');
  protected readonly text = signal('');
  protected readonly units = signal<UnitRow[]>([]);
  protected readonly sel = signal<Unit | null>(null);
  protected readonly matches = signal<Match[] | null>(null);
  protected readonly busy = signal(false);
  protected readonly msg = signal('');
  protected readonly editing = signal<string | null>(null);
  protected editText = '';
  protected newQ = '';
  protected newCat = 'informal';
  protected tryQ = '';
  protected tryCtx = '';
  protected readonly enriched = computed(() => this.sum()?.modules.filter((m) => m.enriched) ?? []);

  constructor() {
    inject(SeoService).set({ title: 'Question mapping', description: 'Knowledge units, question variations and terminology the assistant uses to understand questions.', path: '/question-mapping', noindex: true });
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      await this.kb.init();
      if (!this.kb.user()) return;
      const s = await this.kb.get<Summary>('/enrichment/summary');
      this.sum.set(s);
      if (!this.module()) { const first = s.modules.find((m) => m.enriched); if (first) { this.module.set(first.module); await this.loadUnits(); } }
    } catch (e) { this.error.set((e as Error).message); }
  }

  protected async pick(m: ModRow): Promise<void> { this.module.set(m.module); this.sel.set(null); await this.loadUnits(); }
  protected async setFilter(f: string): Promise<void> { this.filter.set(f); await this.loadUnits(); }

  protected async loadUnits(): Promise<void> {
    const q = new URLSearchParams({ module: this.module(), filter: this.filter(), q: this.text() });
    const r = await this.kb.get<{ units: UnitRow[] }>(`/enrichment/units?${q}`);
    this.units.set(r.units);
  }

  protected async open(id: string): Promise<void> {
    const u = await this.kb.get<Unit>(`/enrichment/units/${encodeURIComponent(id)}`);
    if (u.module !== this.module()) { this.module.set(u.module); await this.loadUnits(); }
    this.sel.set(u);
    this.editing.set(null);
  }

  private async act(fn: () => Promise<Unit | null | void>, done: string): Promise<void> {
    this.busy.set(true);
    this.msg.set('');
    try {
      const u = await fn();
      if (u) this.sel.set(u);
      await Promise.all([this.loadUnits(), this.kb.get<Summary>('/enrichment/summary').then((s) => this.sum.set(s))]);
      if (done) this.msg.set(done);
    } catch (e) { this.msg.set((e as Error).message); } finally { this.busy.set(false); }
  }

  protected setQ(q: Q, status: 'approved' | 'rejected'): void {
    const id = this.sel()!.id;
    void this.act(() => this.kb.post<Unit>(`/enrichment/units/${encodeURIComponent(id)}/questions`, { norm: q.norm, status }), status === 'approved' ? 'Question approved.' : 'Question rejected; it is no longer used for matching.');
  }
  protected edit(q: Q): void { this.editing.set(q.norm); this.editText = q.text; }
  protected save(q: Q): void {
    const id = this.sel()!.id;
    const text = this.editText.trim();
    this.editing.set(null);
    if (!text || text === q.text) return;
    void this.act(() => this.kb.post<Unit>(`/enrichment/units/${encodeURIComponent(id)}/questions`, { norm: q.norm, text, status: 'approved' }), 'Question saved.');
  }
  protected addQ(): void {
    const id = this.sel()!.id;
    const text = this.newQ.trim();
    this.newQ = '';
    void this.act(() => this.kb.post<Unit>(`/enrichment/units/${encodeURIComponent(id)}/questions`, { text, category: this.newCat }), 'Question added.');
  }
  protected review(review: 'approved' | 'needs-review'): void {
    const id = this.sel()!.id;
    void this.act(() => this.kb.post<Unit>(`/enrichment/units/${encodeURIComponent(id)}/review`, { review }), review === 'approved' ? 'Unit approved.' : 'Unit marked for review.');
  }
  protected regenerate(module: string): void {
    void this.act(async () => {
      const r = await this.kb.post<{ units: number; questions: number }>('/enrichment/regenerate', { module });
      this.msg.set(`${module}: ${r.units} units, ${r.questions} questions.`);
      this.module.set(module);
      return null;
    }, `${module} regenerated.`);
  }
  private claudeMsg(r: ClaudeReport): string {
    return `Claude (${r.model}) wrote questions for ${r.asked - r.failed.length} of ${r.asked} unit(s): ${r.added} new, ${r.duplicates} already there, ${r.rejected.length} refused by the checks${r.failed.length ? `, ${r.failed.length} failed (${r.failed[0].reason})` : ''}. ${r.tokens.toLocaleString()} tokens. Review them under "Claude proposals to review".`;
  }
  protected claudeUnit(id: string): void {
    void this.act(async () => {
      const r = await this.kb.post<ClaudeReport>('/enrichment/claude', { unitId: id });
      this.msg.set(this.claudeMsg(r));
      return this.kb.get<Unit>(`/enrichment/units/${encodeURIComponent(id)}`);
    }, '');
  }
  protected claudeModule(module: string): void {
    void this.act(async () => {
      const r = await this.kb.post<ClaudeReport>('/enrichment/claude', { module, limit: 10 });
      this.module.set(module);
      this.filter.set('llm');
      this.msg.set(this.claudeMsg(r));
      return null;
    }, '');
  }
  protected async tryIt(): Promise<void> {
    const r = await this.kb.post<{ matches: Match[] }>('/enrichment/try', { q: this.tryQ, context: this.tryCtx });
    this.matches.set(r.matches);
  }
}
