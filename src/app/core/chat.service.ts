import { Injectable, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import type { Answer, AnswerEngine } from '../data/answer';
import { AiContext, AiCoverage, AiProvider, AiService, AiStatus } from './ai.service';
import { SqlService } from './sql.service';

export interface Msg {
  role: 'user' | 'bot';
  text?: string;
  answer?: Answer;
  understood?: string;
  ai?: { provider: string; sources: string[]; coverage: AiCoverage };
  /** Set when the answer is not (fully) in the hub's own knowledge. */
  gap?: string;
  /** The question behind a rule-based answer, so "Ask AI" can reuse it. */
  question?: string;
}

const LS_AI = 'wfx-chat-ai';
const GAP_AI = "Not in the hub's knowledge: this answer comes from the AI's general knowledge. Please check it in WFX.";
const GAP_MIXED = "Partly not in the hub's knowledge: some of this answer comes from the AI's general knowledge (see the last line).";
const LS_PROVIDER = 'wfx-chat-provider';
const store = {
  get: (k: string) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } },
};

/**
 * One conversation shared by the floating assistant and the full-page assistant.
 * Order of work for every question: commands (workflow, open a page) → rule-based answer from the data (SQL) → AI,
 * when AI mode is on and the rules cannot answer or the user asks for it.
 */
@Injectable({ providedIn: 'root' })
export class ChatService {
  private readonly sql = inject(SqlService);
  private readonly aiService = inject(AiService);
  private readonly router = inject(Router);
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private engine: AnswerEngine | null = null;
  private intent: ((q: string) => Answer | null) | null = null;
  private search: ((q: string, n: number) => { doc: { title: string; type: string; body: string } }[]) | null = null;
  private statusLoaded = false;

  readonly msgs = signal<Msg[]>([]);
  readonly busy = signal(false);
  readonly ai = signal<AiStatus>({ enabled: false, providers: [], default: null });
  readonly aiOn = signal(false);
  readonly provider = signal<AiProvider>('gemini');
  /** Index of the message to bring into view on the full page. */
  readonly focus = signal<number | null>(null);

  async loadStatus(): Promise<void> {
    if (!this.browser || this.statusLoaded) return;
    this.statusLoaded = true;
    const st = await this.aiService.status();
    this.ai.set(st);
    if (!st.enabled) return;
    const saved = store.get(LS_PROVIDER) as AiProvider | null;
    this.provider.set(saved && st.providers.includes(saved) ? saved : st.default ?? st.providers[0]);
    // AI answers by default when it is available; the user can still switch it off
    this.aiOn.set(store.get(LS_AI) !== '0');
  }
  toggleAi(): void {
    this.aiOn.update((v) => !v);
    store.set(LS_AI, this.aiOn() ? '1' : '0');
  }
  setProvider(p: AiProvider): void {
    this.provider.set(p);
    store.set(LS_PROVIDER, p);
  }
  clear(): void { this.msgs.set([]); this.focus.set(null); }

  /** Opens the full-page assistant, scrolled to the given message. */
  openFull(index: number | null = null): void {
    this.focus.set(index);
    void this.router.navigate(['/assistant']);
  }

  async send(text: string): Promise<void> {
    const q = text.trim();
    if (!q || this.busy() || !this.browser) return;
    this.msgs.update((m) => [...m, { role: 'user', text: q }]);
    this.busy.set(true);
    try {
      const a = await this.ruleAnswer(q);
      const weak = a.kind === 'none' || a.kind === 'search' || !!a.gap;
      if (this.aiOn() && weak) { await this.runAi(q); return; }
      this.msgs.update((m) => [...m, a.kind === 'none'
        ? { role: 'bot', text: a.text, question: q }
        : { role: 'bot', answer: a, understood: this.understood(a), question: a.kind === 'workflow' ? undefined : q, gap: a.gap }]);
    } catch {
      this.msgs.update((m) => [...m, { role: 'bot', text: 'Sorry, I could not read the data files. Please try again.' }]);
    } finally {
      this.busy.set(false);
    }
  }

  /** "Ask AI" button under a rule-based answer. */
  async askAi(q: string): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try { await this.runAi(q); } finally { this.busy.set(false); }
  }

  private async ruleAnswer(q: string): Promise<Answer> {
    if (!this.engine) {
      const [{ AnswerEngine }, { search }, { intentAnswer }] = await Promise.all([import('../data/answer'), import('../data/search'), import('../data/assistant-intents')]);
      this.engine = new AnswerEngine(this.sql);
      this.search = search as typeof this.search;
      this.intent = intentAnswer;
    }
    return this.intent!(q) ?? this.engine.ask(q);
  }

  /** Grounding for the AI: the rule-based answer plus the best-matching hub entries. */
  private async contextFor(q: string): Promise<AiContext[]> {
    const ctx: AiContext[] = [];
    try {
      const a = await this.ruleAnswer(q);
      if (a.kind !== 'none') {
        ctx.push({ title: a.title, text: [a.text, a.formula, a.example, ...(a.points ?? [])].filter(Boolean).join(' ') });
        if (a.table) ctx.push({ title: `${a.title} – data`, text: [a.table.columns.join(' | '), ...a.table.rows.slice(0, 6).map((r) => r.join(' | '))].join(' ; ') });
      }
    } catch { /* continue with search hits only */ }
    for (const h of this.search?.(q, 6) ?? []) ctx.push({ title: `${h.doc.type}: ${h.doc.title}`, text: h.doc.body });
    return ctx;
  }

  private async runAi(q: string): Promise<void> {
    try {
      const context = await this.contextFor(q);
      const history = this.msgs().slice(-7, -1).filter((m) => m.text).map((m) => ({ role: m.role === 'user' ? 'user' as const : 'assistant' as const, text: m.text! }));
      const r = await this.aiService.ask(q, context, history, this.provider());
      const coverage = r.coverage ?? (context.length ? 'hub' : 'general');
      const gap = coverage === 'general' ? GAP_AI : coverage === 'mixed' ? GAP_MIXED : undefined;
      this.msgs.update((m) => [...m, { role: 'bot', text: r.answer, ai: { provider: r.provider, sources: r.sources.slice(0, 4), coverage }, gap }]);
    } catch (e) {
      this.msgs.update((m) => [...m, { role: 'bot', text: `${(e as Error).message || 'The AI service is not available.'}` }]);
    }
  }

  private understood(a: Answer): string {
    const kinds: Record<string, string> = { formula: 'how it is calculated', entered: 'how it is filled', copied: 'where it comes from', lineage: 'where it comes from and goes', definition: 'a definition', data: 'the data on it', search: 'the closest match', workflow: 'a workflow to build', guide: 'a how-to guide' };
    return `${kinds[a.kind] ?? 'your question'} – ${a.title}`;
  }

  label(p: string): string {
    return p === 'gemini' ? 'Gemini' : p === 'claude' ? 'Claude' : p === 'mock' ? 'Test mode' : p;
  }
}
