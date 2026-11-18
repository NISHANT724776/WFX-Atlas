import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { KbGate, KbTabs } from './shared';

interface Dash {
  totals: Partial<Record<string, number>>;
  pendingApprovals: { id: string; version: number; status: string; title: string; type: string; module: string | null; updated_at: string }[];
  recentUpdates: { at: string; entry_id: string; action: string; changed_by: string; reason?: string }[];
  recentTopics: { topic: string; hits: number; last: string }[];
  gaps: { question: string; missing: string; times: number; last: string }[];
  conversations: { id: string; title: string; updatedAt: string; messages: number }[];
  documentsByStatus: { status: string; n: number }[];
}

@Component({
  selector: 'app-dashboard',
  imports: [KbGate, KbTabs, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="kb-h1">Dashboard</h1>
    <kb-gate next="/dashboard">
      <kb-tabs />
      @if (d(); as d) {
        <div class="kb-tiles">
          @for (t of tiles.slice(0, 6); track t.key) {
            <a class="kb-tile" [routerLink]="t.link" [queryParams]="t.query ?? null"><span class="kb-tile-n">{{ d.totals[t.key] ?? 0 }}</span><span class="kb-tile-l">{{ t.label }}</span></a>
          }
        </div>
        <div class="kb-grid2">
          <section class="kb-panel kb-pad">
            <h2>Waiting for review</h2>
            @if (d.pendingApprovals.length) {
              <ul class="kb-list">@for (p of d.pendingApprovals; track p.id + p.version) {
                <li><a [routerLink]="['/rulebook']" [queryParams]="{ id: p.id }">{{ p.title }}</a> <span class="kb-badge" [attr.data-s]="p.status">{{ p.status }}</span><span class="muted small"> {{ p.id }} v{{ p.version }}</span></li>
              }</ul>
            } @else { <p class="muted">Nothing is waiting.</p> }
          </section>
          <section class="kb-panel kb-pad">
            <h2>Knowledge gaps</h2>
            @if (d.gaps.length) {
              <ul class="kb-list">@for (g of d.gaps; track g.question) { <li><a routerLink="/assistant" [queryParams]="{ q: g.question }">{{ g.question }}</a> <span class="muted small">×{{ g.times }}</span></li> }</ul>
            } @else { <p class="muted">No gaps recorded yet.</p> }
          </section>
          </div>
        <details class="kb-more"><summary>Recent activity</summary>
        <div class="kb-grid2">
          <section class="kb-panel kb-pad">
            <h2>Recent knowledge updates</h2>
            <ul class="kb-list">@for (u of d.recentUpdates; track $index) { <li><span class="muted small">{{ u.at | date: 'd MMM, HH:mm' }}</span> {{ u.action }} · <a [routerLink]="u.entry_id.startsWith('DOC-') ? '/library' : '/rulebook'" [queryParams]="u.entry_id.startsWith('DOC-') ? { doc: u.entry_id } : { id: u.entry_id }">{{ u.entry_id }}</a> <span class="muted small">by {{ u.changed_by }}</span></li> }</ul>
          </section>
          <section class="kb-panel kb-pad">
            <h2>Recently asked topics</h2>
            @if (d.recentTopics.length) { <ul class="kb-list">@for (t of d.recentTopics; track t.topic) { <li>{{ t.topic }} <span class="muted small">×{{ t.hits }}</span></li> }</ul> }
            @else { <p class="muted">No questions yet.</p> }
            <h2>Your recent conversations</h2>
            @if (d.conversations.length) { <ul class="kb-list">@for (c of d.conversations; track c.id) { <li><a routerLink="/assistant" [queryParams]="{ c: c.id }">{{ c.title }}</a> <span class="muted small">{{ c.messages }} messages</span></li> }</ul> }
            @else { <p class="muted">None yet. <a routerLink="/assistant">Ask a question</a>.</p> }
          </section>
        </div></details>
      } @else if (error()) { <p class="kb-bad">{{ error() }}</p> } @else { <p class="muted">Loading…</p> }
    </kb-gate>
  `,
})
export default class DashboardPage {
  private readonly kb = inject(KbService);
  protected readonly d = signal<Dash | null>(null);
  protected readonly error = signal('');
  protected readonly tiles: { key: string; label: string; link: string; query?: Record<string, string> }[] = [
    { key: 'documents', label: 'Documents', link: '/library' }, { key: 'rulesConfirmed', label: 'Approved rules', link: '/rulebook', query: { type: 'rule', status: 'Active' } },
    { key: 'rulesProvisional', label: 'Rules in review', link: '/rulebook', query: { type: 'rule', status: 'Under Review' } },
    { key: 'candidatesNew', label: 'To review', link: '/library' }, { key: 'gaps', label: 'Unanswered questions', link: '/dashboard' }, { key: 'workflows', label: 'Workflows', link: '/rulebook', query: { type: 'workflow' } },
    { key: 'modules', label: 'Modules', link: '/rulebook', query: { type: 'module' } }, { key: 'transactions', label: 'Transactions', link: '/transactions' }, { key: 'calculationsRunnable', label: 'Runnable calculations', link: '/calc-lab' },
    { key: 'dataModels', label: 'Data models', link: '/rulebook', query: { type: 'model' } }, { key: 'terms', label: 'Glossary terms', link: '/rulebook', query: { type: 'term' } }, { key: 'procedures', label: 'Procedures', link: '/rulebook', query: { type: 'procedure' } },
  ];
  constructor() {
    inject(SeoService).set({ title: 'Knowledge dashboard', description: 'Documents, rules, workflows and knowledge gaps of the WFX knowledge platform.', path: '/dashboard', noindex: true, crumbs: [{ label: 'Dashboard', path: '/dashboard' }] });
    effect(() => { if (this.kb.user() && !this.d()) void this.load(); });
  }
  private async load() {
    try { this.d.set(await this.kb.get<Dash>('/dashboard')); } catch (e) { this.error.set((e as Error).message); }
  }
}
