import { ChangeDetectionStrategy, Component, ElementRef, PLATFORM_ID, afterNextRender, computed, effect, inject, input, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { RouterLink } from '@angular/router';
import { ChatService } from '../core/chat.service';
import { KbService } from '../core/kb.service';
import { KbAssistant } from '../platform/kb-assistant';
import { SeoService } from '../core/seo.service';
import { STATIC_PAGES } from '../data/catalog';
import { ChatThread } from '../shared/chat-thread';

const IDEAS = [
  { group: 'Build a workflow', items: ['Make a workflow from techpack to production order', 'Build a workflow with techpack, sales order, MRP, indent and production order', 'Make an end to end workflow without block booking'] },
  { group: 'Data model', items: ['Show the data model of MRP', 'Show the data model of BOM', 'What is the Sales Order structure?'] },
  { group: 'Formulas', items: ['How is Total cons calculated?', 'How does MRP adjustment work?', 'How is Markup calculated?'] },
  { group: 'Theory', items: ['What is BOM?', 'What is Split Shuffle?', 'Open the theory of GRN'] },
];

import { Status } from '../shared/status';
@Component({
  selector: 'app-assistant',
  imports: [ChatThread, RouterLink, KbAssistant, Status],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!grounded()) {
    <header class="page-head">
      <p class="eyebrow">Assistant</p>
      <h1>Ask, build and understand – <em>in one place</em></h1>
      <p class="lead">Describe a workflow and it is built for you, or ask about a data model, a formula or a theory page. Large answers are shown here in full.</p>
    </header>
    }
    @if (grounded()) {
      <kb-assistant [initialQ]="q()" />
    } @else {
    @if (kb.available() && !kb.user()) {
      <p class="kb-banner"><a routerLink="/login" [queryParams]="{ next: '/assistant' }">Sign in</a> to use the knowledge assistant: answers from the whole knowledge base (documents, rules, calculations) with sources and a knowledge status.</p>
    }
    <div class="as-layout">
      <aside class="as-side">
        @for (g of ideas; track g.group) {
          <p class="h-small">{{ g.group }}</p>
          @for (i of g.items; track i) { <button type="button" class="as-idea" [disabled]="chat.busy()" (click)="chat.send(i)">{{ i }}</button> }
        }
        <p class="muted small as-links"><a routerLink="/workflows">Workflow builder</a> · <a routerLink="/data-model">Data model</a> · <a routerLink="/calculations">Formulas</a> · <a routerLink="/theory">Theory</a></p>
      </aside>

      <section class="as-main" aria-label="Conversation">
        <div class="as-bar">
          @if (chat.ai().enabled) {
            @if (chat.ai().providers.length > 1) {
              <label class="visually-hidden" for="as-provider">AI provider</label>
              <select id="as-provider" class="as-select" [value]="chat.provider()" (change)="chat.setProvider($any($event.target).value)">
                @for (p of chat.ai().providers; track p) { <option [value]="p" [selected]="p === chat.provider()">{{ chat.label(p) }}</option> }
              </select>
            }
            <button type="button" class="chip-btn" [class.on]="chat.aiOn()" [attr.aria-pressed]="chat.aiOn()" (click)="chat.toggleAi()">AI {{ chat.aiOn() ? 'on' : 'off' }}</button>
          } @else {
            <span class="muted small">Answers come from the hub's data. AI mode appears here once it is set up.</span>
          }
          @if (chat.msgs().length) { <button type="button" class="linkish" (click)="chat.clear()">Clear conversation</button> }
        </div>
        <div class="as-thread" #thread aria-live="polite">
          @if (!chat.msgs().length) { <wfx-status kind="empty" title="Nothing asked yet" detail="Pick an idea on the left or type a question below." /> }
          <app-chat-thread [msgs]="chat.msgs()" [full]="true" [busy]="chat.busy()" [aiEnabled]="chat.ai().enabled" [label]="labelFn"
            (ask)="chat.send($event)" (askAi)="chat.askAi($event)" />
        </div>
        <form class="as-form" (submit)="submit($event, box.value); box.value = ''">
          <label class="visually-hidden" for="as-q">Your question or command</label>
          <input #box id="as-q" type="text" placeholder="e.g. Make a workflow from techpack to production order" autocomplete="off" />
          <button type="submit" class="btn primary" [disabled]="chat.busy()">Send</button>
        </form>
      </section>
    </div>
    }
  `,
})
export default class AssistantPage {
  protected readonly chat = inject(ChatService);
  protected readonly kb = inject(KbService);
  /** The knowledge server is reachable and the user is signed in: the grounded assistant replaces the v1 one. */
  protected readonly grounded = computed(() => this.kb.available() && !!this.kb.user());
  /** ?q= sends a question as soon as the page opens (used by the home page ask box). */
  readonly q = input<string | undefined>(undefined);
  private lastQ = '';
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly thread = viewChild<ElementRef<HTMLElement>>('thread');
  protected readonly ideas = IDEAS;
  protected readonly labelFn = (p: string) => this.chat.label(p);

  constructor() {
    const p = STATIC_PAGES.find((x) => x.path === '/assistant')!;
    inject(SeoService).set({ title: p.title, description: p.description, path: p.path, crumbs: [{ label: 'Assistant', path: p.path }] });
    afterNextRender(() => { void this.chat.loadStatus(); void this.kb.init(); });
    effect(() => {
      const q = this.q()?.trim();
      // wait until it is known whether the grounded assistant takes the question
      if (!this.browser || !q || q === this.lastQ || this.kb.state() === 'unknown' || this.grounded()) return;
      this.lastQ = q;
      void this.chat.send(q);
    });
    // bring the focused message (or the newest one) into view
    effect(() => {
      const msgs = this.chat.msgs();
      const focus = this.chat.focus();
      const root = this.thread()?.nativeElement;
      if (!this.browser || !root || !msgs.length) return;
      queueMicrotask(() => {
        const target = root.querySelector<HTMLElement>(`[data-i="${focus ?? msgs.length - 1}"]`);
        target?.scrollIntoView({ block: focus === null ? 'end' : 'start', behavior: 'smooth' });
      });
    });
  }

  protected submit(ev: Event, value: string): void {
    ev.preventDefault();
    this.chat.focus.set(null);
    void this.chat.send(value);
  }
}
