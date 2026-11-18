import { ChangeDetectionStrategy, Component, ElementRef, PLATFORM_ID, effect, inject, signal, viewChild } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { NavigationEnd, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { filter } from 'rxjs';
import { ChatService } from '../core/chat.service';
import { KbService } from '../core/kb.service';
import { ChatThread } from './chat-thread';

const STARTERS = ['Make a workflow from techpack to production order', 'What is BOM?', 'How is Total cons calculated?', 'What is Split Shuffle?', 'Show the data model of MRP'];

/**
 * Floating assistant (bottom right). The conversation lives in ChatService, so "Open full view" continues the same
 * chat on the /assistant page, where large tables and long lists are shown in full.
 */
@Component({
  selector: 'app-chat-widget',
  imports: [ChatThread],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (!onAssistantPage()) {
      @defer (when open()) {
        @if (open()) {
        <section class="chat" role="dialog" aria-label="WFX assistant" (keydown.escape)="close()">
          <header class="chat-head">
            <span><strong>WFX assistant</strong><span class="chat-sub">{{ chat.aiOn() ? 'AI mode · grounded on the hub\\'s data' : 'Workflows, data model, formulas, theory' }}</span></span>
            <span class="chat-tools">
              @if (chat.ai().enabled) {
                @if (chat.ai().providers.length > 1) {
                  <label class="visually-hidden" for="chat-provider">AI provider</label>
                  <select id="chat-provider" class="chat-provider" [value]="chat.provider()" (change)="chat.setProvider($any($event.target).value)">
                    @for (p of chat.ai().providers; track p) { <option [value]="p" [selected]="p === chat.provider()">{{ chat.label(p) }}</option> }
                  </select>
                }
                <button type="button" class="chat-ai" [class.on]="chat.aiOn()" [attr.aria-pressed]="chat.aiOn()" (click)="chat.toggleAi()">AI {{ chat.aiOn() ? 'on' : 'off' }}</button>
              }
              <button type="button" class="chat-x" aria-label="Open the assistant full page" title="Open full page" (click)="full()">⤢</button>
              <button type="button" class="chat-x" aria-label="Close assistant" (click)="close()">✕</button>
            </span>
          </header>
          <div class="chat-body" #body aria-live="polite">
            <div class="msg bot"><p>Hi! I can <strong>build a workflow</strong> from the steps you name, explain a <strong>data model</strong>, a <strong>formula</strong> or a <strong>theory</strong> page, and open big answers in full view.</p></div>
            @if (!chat.msgs().length) {
              <p class="chat-chips">@for (s of starters; track s) { <button type="button" class="chip-btn" (click)="ask(s)">{{ s }}</button> }</p>
            }
            <app-chat-thread [msgs]="chat.msgs()" [busy]="chat.busy()" [aiEnabled]="chat.ai().enabled" [label]="labelFn"
              (ask)="chat.send($event)" (askAi)="chat.askAi($event)" (openFull)="chat.openFull($event)" (navigated)="close()" />
          </div>
          <form class="chat-form" (submit)="submit($event, box.value); box.value = ''">
            <label class="visually-hidden" for="chat-q">Your question</label>
            <input #box id="chat-q" type="text" placeholder="Ask or give a command…" autocomplete="off" />
            <button type="submit" class="btn primary" [disabled]="chat.busy()">Send</button>
          </form>
        </section>
        }
      }
      <button type="button" class="chat-fab" [class.open]="open()" [attr.aria-expanded]="open()" aria-label="Open WFX assistant" (click)="toggle()">
        @if (open()) {
          <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
        } @else {
          <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H11l-4.2 3.6c-.6.5-1.5.1-1.5-.7V16A2.5 2.5 0 0 1 4 13.5z" fill="currentColor"/><circle cx="9" cy="9.5" r="1.1" fill="var(--bg)"/><circle cx="12" cy="9.5" r="1.1" fill="var(--bg)"/><circle cx="15" cy="9.5" r="1.1" fill="var(--bg)"/></svg>
        }
      </button>
    }
  `,
})
export class ChatWidget {
  protected readonly chat = inject(ChatService);
  private readonly kb = inject(KbService);
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private readonly body = viewChild<ElementRef<HTMLElement>>('body');

  protected readonly starters = STARTERS;
  protected readonly open = signal(false);
  protected readonly onAssistantPage = signal(this.router.url.split(/[?#]/)[0] === '/assistant');
  protected readonly labelFn = (p: string) => this.chat.label(p);

  constructor() {
    this.router.events.pipe(filter((e): e is NavigationEnd => e instanceof NavigationEnd), takeUntilDestroyed())
      .subscribe((e) => this.onAssistantPage.set(e.urlAfterRedirects.split(/[?#]/)[0] === '/assistant'));
    // keep the newest message in view
    effect(() => {
      this.chat.msgs();
      this.chat.busy();
      const el = this.body()?.nativeElement;
      if (el) queueMicrotask(() => (el.scrollTop = el.scrollHeight));
    });
  }

  protected toggle(): void {
    this.open.update((v) => !v);
    if (this.open() && this.browser) { void this.chat.loadStatus(); void this.kb.init(); }
  }
  protected close(): void { this.open.set(false); }
  protected full(): void { this.close(); this.chat.openFull(null); }
  protected submit(ev: Event, value: string): void {
    ev.preventDefault();
    this.ask(value);
  }
  /** Signed in with the knowledge server reachable: the grounded assistant answers (and opens the Workflow Designer for a workflow request). */
  protected ask(text: string): void {
    const t = text.trim();
    if (!t) return;
    if (this.kb.available() && this.kb.user()) { this.close(); void this.router.navigate(['/assistant'], { queryParams: { q: t, c: null } }); return; }
    void this.chat.send(t);
  }
}
