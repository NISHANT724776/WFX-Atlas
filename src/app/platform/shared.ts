// Shared parts of the platform pages: the access gate, the platform tab bar, a safe Markdown renderer and the
// knowledge-answer renderer (status, sections, calculation, workflow, sources, gaps, follow-ups, copy/export).
import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import { KbActions, KbGuideView } from './guide';
import type { KbAnswer, KbSection, KStatus } from '../core/kb.service';

@Component({
  selector: 'kb-gate',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @switch (view()) {
      @case ('loading') { <p class="muted kb-pad">Connecting to the knowledge server…</p> }
      @case ('offline') {
        <div class="kb-panel kb-pad">
          <h2>Knowledge server not connected</h2>
          <p>This page needs the WFX knowledge server, which stores the documents, rules and conversations. The public pages (workflows, data model, theory, formulas) work without it.</p>
          <p>Start it on the machine that holds the knowledge folder:</p>
          <pre class="kb-code">npm run build
npm run kb:server</pre>
          <p class="muted small">Then open the address it prints (by default http://127.0.0.1:8787/).</p>
        </div>
      }
      @case ('signin') {
        <div class="kb-panel kb-pad">
          <h2>{{ kb.setupRequired() ? 'Create the first admin account' : 'Sign in to continue' }}</h2>
          <p>WFX documentation and rules can be confidential, so the platform needs an account.</p>
          <a class="btn primary" routerLink="/login" [queryParams]="{ next: next() }">{{ kb.setupRequired() ? 'Set up' : 'Sign in' }}</a>
        </div>
      }
      @case ('role') { <div class="kb-panel kb-pad"><h2>Not available for your role</h2><p>This page needs the {{ role() }} role. Ask an admin.</p></div> }
      @default { <ng-content /> }
    }
  `,
})
export class KbGate {
  protected readonly kb = inject(KbService);
  readonly role = input<'viewer' | 'editor' | 'approver' | 'admin'>('viewer');
  readonly next = input('/dashboard');
  protected readonly view = computed(() => {
    const s = this.kb.state();
    if (s === 'unknown') return 'loading';
    if (s === 'offline') return 'offline';
    if (!this.kb.user()) return 'signin';
    if (!this.kb.can(this.role())) return 'role';
    return 'ok';
  });
  constructor() { void this.kb.init(); }
}

@Component({
  selector: 'kb-tabs',
  imports: [RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (kb.user(); as u) {
      <p class="kb-who kb-whoami"><a routerLink="/profile" title="Your profile: change password, add users (admins)">{{ u.displayName }}</a> · {{ u.role }} <button type="button" class="linklike" (click)="logout()">Sign out</button></p>
    }
  `,
})
export class KbTabs {
  protected readonly kb = inject(KbService);
  protected async logout() { await this.kb.logout(); }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Small Markdown renderer for answers written by a model: escapes HTML first, then headings, lists, tables, code, bold. */
export function md(src: string): string {
  const lines = esc(src).split('\n');
  const out: string[] = [];
  let i = 0;
  const inline = (s: string) => s.replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\[(\d+)\]/g, '<sup class="kb-ref">[$1]</sup>');
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const buf: string[] = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre class="kb-code">${buf.join('\n')}</pre>`); continue; }
    const h = /^(#{1,4})\s+(.*)$/.exec(l);
    if (h) { out.push(`<p class="kb-h">${inline(h[2])}</p>`); i++; continue; }
    if (/^\|.*\|$/.test(l.trim())) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { if (!/^\|\s*:?-{2,}/.test(lines[i].trim())) rows.push(lines[i].trim().slice(1, -1).split('|').map((c) => inline(c.trim()))); i++; }
      out.push(`<div class="table-scroll"><table><thead><tr>${rows[0].map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s+/.test(l)) {
      const ordered = /^\s*\d+\./.test(l);
      const items: string[] = [];
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) items.push(`<li>${inline(lines[i++].replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`);
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
      continue;
    }
    if (l.trim()) out.push(`<p>${inline(l)}</p>`);
    i++;
  }
  return out.join('');
}

export const STATUS_TEXT: Record<KStatus, string> = {
  confirmed: 'Confirmed', documented: 'Documented in a source', provisional: 'Provisional', conflicting: 'Conflicting sources', partial: 'Partly documented', 'not-documented': 'Not documented', conversation: '',
};

@Component({
  selector: 'kb-answer',
  imports: [RouterLink, NgTemplateOutlet, KbGuideView, KbActions],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @let a = answer();
    <article class="kb-answer">
      <header class="kb-answer-head">
        @if (a.status !== 'conversation') {
          <span class="kb-status" [attr.data-s]="a.status">{{ statusText(a.status) }}</span>
          @if (a.title) { <h3 class="kb-answer-title">{{ a.title }}</h3> }
          @if (a.status !== 'confirmed' && a.statusNote) { <p class="muted small">{{ a.statusNote }}</p> }
        }
      </header>
      @for (s of main(); track $index) { <ng-container *ngTemplateOutlet="sec; context: { $implicit: s }" /> }
      @if (a.cards?.length) {
        @if (a.cards!.length > 1) {
          <div class="kb-row gd-tabs" role="tablist" aria-label="Guides">@for (c of a.cards!; track c.id; let k = $index) {
            <button type="button" role="tab" class="chip-btn" [class.on]="k === card()" [attr.aria-selected]="k === card()" (click)="card.set(k)">{{ shortTitle(c.title) }}</button>
          }</div>
        }
        <kb-guide [id]="a.cards![card()].id" [note]="a.cards![card()].note" />
      }
      <kb-actions [actions]="a.actions ?? []" />
      @if (a.missing.length) {
        <section class="kb-sec" data-kind="missing"><p class="kb-sec-title">Not documented</p><ul>@for (m of a.missing; track $index) { <li>{{ m }}</li> }</ul></section>
      }
      @if (a.action; as act) {
        <section class="kb-sec kb-action" data-kind="action">
          @if (act.type === 'open-workflow') {
            <a class="btn primary" [routerLink]="['/workflow-designer', act.draftId]">Open “{{ act.title }}” in the Workflow Designer</a>
          } @else {
            <p class="kb-bad small">{{ act.error }}</p>
            <button type="button" class="btn primary" (click)="retryWorkflow.emit(act.draftId)">Retry the workflow</button>
            <span class="muted small">Your request is kept: “{{ act.request }}”.</span>
          }
        </section>
      }
      @if (a.sources.length) {
        <p class="kb-srcline small">Source:
          @for (s of a.sources.slice(0, 2); track s.n) {
            <span class="kb-src-status" [attr.data-ok]="s.confirmed">{{ s.status }}</span>
            @if (s.entryId) { <a [routerLink]="['/rulebook']" [queryParams]="{ id: s.entryId }">{{ s.title }}</a> }
            @else if (s.docId) { <a [routerLink]="['/library']" [queryParams]="{ doc: s.docId }">{{ s.title }}</a> }
            @else { {{ s.title }} }
          }
          @if (a.sources.length > 2) { <span class="muted"> +{{ a.sources.length - 2 }} more</span> }
        </p>
      }
      @if (more().length || a.sources.length > 1) {
        <details class="kb-more"><summary>More detail</summary>
          @for (s of more(); track $index) { <ng-container *ngTemplateOutlet="sec; context: { $implicit: s }" /> }
          <section class="kb-sec kb-sources"><p class="kb-sec-title">All sources</p>
            <ol>@for (s of a.sources; track s.n) {
              <li>
                <span class="kb-src-status" [attr.data-ok]="s.confirmed">{{ s.status }}</span>
                @if (s.entryId) { <a [routerLink]="['/rulebook']" [queryParams]="{ id: s.entryId }">{{ s.title }}</a> }
                @else if (s.docId) { <a [routerLink]="['/library']" [queryParams]="{ doc: s.docId }">{{ s.title }}</a> }
                @else { {{ s.title }} }
                <span class="muted small"> — {{ s.label }}</span>
                @if (s.origin) { <span class="muted small"> · {{ s.origin }}</span> }
              </li>
            }</ol>
          </section>
          @if (correctionNote(); as c) { <p class="muted small">Spelling read as: {{ c }}</p> }
        </details>
      }
      <footer class="kb-answer-foot">
        @for (f of a.followUps.slice(0, 3); track f) { <button type="button" class="chip-btn" (click)="ask.emit(f)">{{ f }}</button> }
        <span class="kb-spacer"></span>
        <button type="button" class="linklike small" (click)="copy(a.markdown)">{{ copied() ? 'Copied' : 'Copy' }}</button>
        <button type="button" class="linklike small" (click)="exportMd()">Export</button>
        @if (regenerate()) { <button type="button" class="linklike small" (click)="again.emit()">Regenerate</button> }
      </footer>
    </article>
    <ng-template #sec let-s>
      <section class="kb-sec" [attr.data-kind]="s.kind">
        @if (s.kind !== 'answer') { <p class="kb-sec-title">{{ s.title }}</p> }
        @if (s.kind === 'code') { <pre class="kb-code">{{ s.text }}</pre> }
        @else if (s.text && a.generatedBy !== 'knowledge-base' && s.kind === 'answer') { <div class="kb-md" [innerHTML]="html(s.text)"></div> }
        @else if (s.text) { <p [class.kb-lead]="s.kind === 'answer'">{{ s.text }}@for (n of s.refs ?? []; track n) {<sup class="kb-ref">[{{ n }}]</sup>}</p> }
        @if (s.items?.length) {
          @if (s.kind === 'steps') { <ol>@for (x of s.items!; track $index) { <li>{{ x }}</li> }</ol> }
          @else { <ul>@for (x of s.items!; track $index) { <li>{{ x }}</li> }</ul> }
        }
        @if (s.table; as t) {
          <div class="table-scroll"><table><thead><tr>@for (c of t.columns; track $index) { <th scope="col">{{ c }}</th> }</tr></thead>
            <tbody>@for (r of t.rows; track $index) { <tr>@for (c of r; track $index) { <td>{{ c }}</td> }</tr> }</tbody></table></div>
        }
        @if (s.calc; as c) {
          <div class="kb-calc">
            <p class="small muted">Rule {{ c.ruleId }} v{{ c.version }} · {{ c.formula }}</p>
            @if (c.inputs.length) { <p class="small">Inputs: @for (i of c.inputs; track i.label) { <span class="chip">{{ i.label }} = {{ i.value }}{{ i.defaulted ? ' (default)' : '' }}</span> }</p> }
            <ol class="kb-steps">@for (st of c.steps; track $index) { <li><code>{{ st }}</code></li> }</ol>
            @if (c.result !== null) { <p class="kb-result">{{ c.output }} = <strong>{{ c.result }}</strong></p> }
            @for (w of c.warnings; track $index) { <p class="kb-warn small">{{ w }}</p> }
            @for (e of c.errors; track $index) { <p class="kb-bad small">{{ e }}</p> }
            <a class="small" routerLink="/calc-lab" [queryParams]="{ rule: c.ruleId }">Open in the Calculation Lab →</a>
          </div>
        }
        @if (s.mermaid) {
          @if (s.json?.nodes?.length) { <ol class="kb-flow">@for (n of s.json!.nodes!; track n.id) { <li>{{ n.label }}</li> }</ol> }
          <details class="kb-mermaid"><summary>Mermaid source</summary><pre class="kb-code">{{ s.mermaid }}</pre><button type="button" class="btn small" (click)="copy(s.mermaid!)">Copy Mermaid</button></details>
        }
      </section>
    </ng-template>
  `,
})
export class KbAnswerView {
  readonly answer = input.required<KbAnswer>();
  readonly regenerate = input(false);
  readonly ask = output<string>();
  readonly again = output<void>();
  readonly retryWorkflow = output<string>();
  protected readonly copied = signal(false);
  protected readonly card = signal(0);
  protected shortTitle(t: string) { return t.replace(/^Trims Scan · /, '').replace(/^How do I /, ''); }
  /** What answers the question is shown at once; explanations, rules and related text sit under "More detail". */
  protected readonly main = computed(() => this.answer().sections.filter((s) => !s.extra));
  protected readonly more = computed(() => this.answer().sections.filter((s) => s.extra));
  protected readonly correctionNote = computed(() => Object.entries(this.answer().corrections ?? {}).map(([a, b]) => `${a} → ${b}`).join(', '));
  protected statusText(s: KStatus) { return STATUS_TEXT[s] ?? s; }
  protected html(s: string) { return md(s); }
  protected async copy(text: string) {
    try { await navigator.clipboard.writeText(text); this.copied.set(true); setTimeout(() => this.copied.set(false), 1500); } catch { /* clipboard blocked */ }
  }
  protected exportMd() {
    const a = this.answer();
    const blob = new Blob([`# ${a.question}\n\n${a.markdown}\n`], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${a.title.replace(/[^\w-]+/g, '-').slice(0, 60) || 'answer'}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}

export type { KbSection };
