import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { KbService } from '../core/kb.service';
import type { KbMessage } from '../core/kb.service';
import { KbAnswerView, KbTabs } from './shared';
import { KbGuideView, openDestination } from './guide';

const MODES = [
  { id: 'ask', label: 'Ask WFX knowledge', hint: 'Definitions, rules, procedures, calculations, comparisons' },
  { id: 'transaction', label: 'Explain transaction', hint: 'The documentation page of one transaction' },
  { id: 'workflow', label: 'Generate workflow', hint: 'Steps and a flowchart from documented steps only' },
  { id: 'data_model', label: 'Create data model', hint: 'Captured screen-level models; nothing invented' },
  { id: 'rule', label: 'Analyse business rule', hint: 'Understand a rule you write, compare with stored rules' },
  { id: 'calculate', label: 'Calculate', hint: 'Run a stored rule with the numbers in your question' },
  { id: 'ba', label: 'BA copilot', hint: 'Requirement analysis, stories, acceptance criteria, tests' },
];

@Component({
  selector: 'kb-assistant',
  imports: [FormsModule, DatePipe, KbAnswerView, KbTabs, KbGuideView],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <kb-tabs />
    <div class="kb-chat" [class.kb-nohist]="!convs().length && !convQ()">
      <aside class="kb-convs">
        <button class="btn primary small" type="button" (click)="newConv()">+ New</button>
        <input class="kb-convsearch" type="search" placeholder="Search chats" aria-label="Search conversations" [ngModel]="convQ()" (ngModelChange)="searchConvs($event)" name="cq" />
        <ul class="kb-list">@for (c of convs(); track c.id) {
          <li [class.sel]="c.id === convId()">
            @if (renaming() === c.id) {
              <input class="kb-rename" [value]="c.title" #rn (keydown.enter)="rename(c.id, rn.value)" (keydown.escape)="renaming.set(null)" (blur)="rename(c.id, rn.value)" aria-label="Conversation title" />
            } @else {
              <button type="button" class="linklike" (click)="open(c.id)">{{ c.title }}</button>
            }
            <br /><span class="muted small">{{ c.updatedAt | date: 'd MMM, HH:mm' }} · {{ c.messages }}</span>
            <span class="kb-conv-tools"><button type="button" class="linklike small" (click)="renaming.set(c.id)" aria-label="Rename conversation" title="Rename">✎</button><button type="button" class="linklike small" (click)="remove(c.id)" aria-label="Delete conversation" title="Delete">✕</button></span></li>
        } @empty { @if (convQ()) { <li class="muted small">No chat matches.</li> } }</ul>
      </aside>
      <section class="kb-thread-wrap" aria-label="Conversation">
        @if (summary()) { <p class="muted small kb-summary">{{ summary() }}</p> }
        <div class="kb-thread" #thread aria-live="polite">
          @if (guideParam(); as gid) { <div class="kb-answer"><kb-guide [id]="gid" /></div> }
          @if (!msgs().length && !guideParam()) {
            <div class="kb-empty">
              <p>Ask about WFX transactions, rules, calculations or procedures.</p>
              <div class="kb-row">@for (s of starters.slice(0, 4); track s) { <button type="button" class="chip-btn" (click)="send(s)">{{ s }}</button> }</div>
            </div>
          }
          @for (m of msgs(); track m.id; let last = $last) {
            @if (m.role === 'user') { <div class="kb-q"><p>{{ m.content }}</p></div> }
            @else if (m.answer) { <kb-answer [answer]="m.answer" [regenerate]="last" (ask)="send($event)" (again)="regen()" (retryWorkflow)="retryWorkflow($event)" /> }
          }
          @if (busy()) { <p class="kb-typing" aria-live="polite"><span></span><span></span><span></span> Looking it up… <button type="button" class="linklike small" (click)="stop()">Stop</button></p> }
          @if (error()) { <p class="kb-bad">{{ error() }}</p> }
        </div>
        <form class="kb-ask" (ngSubmit)="send(text)">
          <textarea name="text" rows="1" [(ngModel)]="text" (keydown.enter)="enter($event)" placeholder="Ask a question…" aria-label="Your message"></textarea>
          <button class="btn primary" type="submit" [disabled]="busy() || !text.trim()">Send</button>
        </form>
        <details class="kb-opts small"><summary>Options · {{ modeLabel() }}</summary>
          <div class="kb-row">
            <label>Mode <select name="mode" [(ngModel)]="mode" aria-label="Mode">@for (m of modes; track m.id) { <option [value]="m.id">{{ m.label }}</option> }</select></label>
            <label>Detail <select name="depth" [(ngModel)]="depth" aria-label="Answer detail"><option value="brief">Brief</option><option value="standard">Standard</option><option value="detailed">Detailed</option></select></label>
          </div>
          <p class="muted">{{ hint() }}. {{ kb.ai().active ? 'AI writing is on: it may only use the cited sources.' : 'Answers come from the knowledge base only.' }}</p>
        </details>
      </section>
    </div>
  `,
})
export class KbAssistant {
  protected readonly kb = inject(KbService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly initialQ = input<string | undefined>(undefined);
  protected readonly modes = MODES;
  protected readonly convs = signal<{ id: string; title: string; updatedAt: string; messages: number }[]>([]);
  protected readonly convId = signal<string | null>(null);
  protected readonly msgs = signal<KbMessage[]>([]);
  protected readonly summary = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  protected text = ''; protected mode = 'ask'; protected depth = 'standard';
  protected readonly starters = ['Explain the Trims Scan process', 'Show me the Sales Order workflow', 'How do I create an RMPO?', 'Open the GRN screen', 'How is open quantity calculated in RMPO?'];
  protected readonly convQ = signal('');
  protected readonly renaming = signal<string | null>(null);
  protected readonly guideParam = signal<string | null>(null);
  private abort: AbortController | null = null;
  private lastQ = '';
  protected modeLabel() { return MODES.find((m) => m.id === this.mode)?.label ?? ''; }
  protected hint() { return MODES.find((m) => m.id === this.mode)?.hint ?? ''; }

  constructor() {
    void this.loadConvs();
    this.route.queryParamMap.subscribe((p) => { const c = p.get('c'); if (c && c !== this.convId()) void this.open(c); this.guideParam.set(p.get('guide')); });
    effect(() => { const q = this.initialQ()?.trim(); if (q && q !== this.lastQ) { this.lastQ = q; void this.send(q); } });
    effect(() => { this.msgs(); queueMicrotask(() => { const el = this.thread()?.nativeElement; if (el) el.scrollTop = el.scrollHeight; }); });
  }
  private async loadConvs() { this.convs.set((await this.kb.get<{ conversations: never[] }>(`/chat/conversations?q=${encodeURIComponent(this.convQ())}`)).conversations); }
  private searchTimer: ReturnType<typeof setTimeout> | undefined;
  protected searchConvs(q: string) { this.convQ.set(q); clearTimeout(this.searchTimer); this.searchTimer = setTimeout(() => void this.loadConvs(), 250); }
  protected async rename(id: string, title: string) {
    if (this.renaming() !== id) return;
    this.renaming.set(null);
    const t = title.trim();
    if (!t) return;
    try { await this.kb.patch(`/chat/conversations/${id}`, { title: t }); await this.loadConvs(); } catch (e) { this.error.set((e as Error).message); }
  }
  protected stop() { this.abort?.abort(); }
  protected async open(id: string) {
    this.convId.set(id);
    const c = await this.kb.get<{ messages: KbMessage[]; summary: string }>(`/conversations/${id}`);
    this.msgs.set(c.messages); this.summary.set(c.summary);
    void this.router.navigate([], { queryParams: { c: id, q: null }, queryParamsHandling: 'merge', replaceUrl: true });
  }
  protected newConv() { this.convId.set(null); this.msgs.set([]); this.summary.set(''); void this.router.navigate([], { queryParams: { c: null, q: null }, queryParamsHandling: 'merge', replaceUrl: true }); }
  protected async remove(id: string) {
    if (!confirm('Delete this conversation? This cannot be undone.')) return;
    await this.kb.request('DELETE', `/conversations/${id}`);
    if (this.convId() === id) this.newConv();
    await this.loadConvs();
  }
  protected enter(e: Event) { const k = e as KeyboardEvent; if (!k.shiftKey) { k.preventDefault(); void this.send(this.text); } }
  protected async send(text: string) {
    const t = text.trim();
    if (!t || this.busy()) return;
    this.busy.set(true); this.error.set(''); this.text = '';
    try {
      if (!this.convId()) {
        const c = await this.kb.post<{ id: string }>('/conversations', {});
        this.convId.set(c.id);
        // the URL names the conversation (and drops ?q=), so coming back from the designer never asks the question again
        void this.router.navigate([], { queryParams: { c: c.id, q: null }, queryParamsHandling: 'merge', replaceUrl: true });
      }
      this.abort = new AbortController();
      const r = await this.kb.post<{ question: KbMessage; answer: KbMessage }>(`/chat/conversations/${this.convId()}/messages`, { content: t, mode: this.mode, depth: this.depth }, this.abort.signal);
      this.msgs.update((m) => [...m, r.question, r.answer]);
      await this.loadConvs();
      // a workflow request: take the user to the Workflow Designer, which shows the generated draft
      const act = r.answer.answer?.action;
      if (act?.type === 'open-workflow') await this.router.navigate([act.path, act.draftId]);
      // "open the GRN screen": go there straight away (the server already checked the registry and the user's role)
      const nav = r.answer.answer?.navigate ? r.answer.answer.actions?.find((x) => x.id === r.answer.answer!.navigate) : undefined;
      if (nav?.allowed) { const why = await openDestination(this.kb, this.router, nav); if (why) this.error.set(why); }
    } catch (e) {
      if ((e as Error).name === 'AbortError') { this.error.set('Stopped. The question was not answered; ask again when you are ready.'); this.text = t; }
      else { this.error.set((e as Error).message); this.text = t; }
    }
    finally { this.busy.set(false); this.abort = null; }
  }
  /** A workflow that failed to generate: run the stored request again, then open it. */
  protected async retryWorkflow(draftId: string) {
    if (this.busy()) return;
    this.busy.set(true); this.error.set('');
    try { await this.kb.post(`/workflow-drafts/${draftId}/retry`, {}); await this.router.navigate(['/workflow-designer', draftId]); }
    catch (e) { this.error.set(`Retry failed: ${(e as Error).message} Your request is still saved; you can try again.`); }
    finally { this.busy.set(false); }
  }
  protected async regen() {
    if (!this.convId() || this.busy()) return;
    this.busy.set(true);
    try { const m = await this.kb.post<KbMessage>(`/conversations/${this.convId()}/regenerate`, { mode: this.mode, depth: this.depth }); this.msgs.update((x) => [...x, m]); }
    catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }
}
