import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { KbService } from '../core/kb.service';
import type { KbSection } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { KbGate, KbTabs } from './shared';

@Component({
  selector: 'app-ba-copilot',
  imports: [KbGate, KbTabs, FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="kb-h1">Business analyst copilot</h1>
    <kb-gate next="/ba-copilot">
      <kb-tabs />
      <section class="kb-panel kb-pad">
        <p class="small muted">Paste a requirement, an observation, a defect or meeting notes. The copilot separates current from expected behaviour, finds what the text touches in the knowledge base, lists ambiguities and missing information, and drafts a user story, acceptance criteria and test scenarios. Everything it drafts is a proposal for you to confirm.</p>
        <textarea rows="5" class="kb-wide" [(ngModel)]="text" name="t" placeholder="When Product Group is changed in an existing line, the previously selected Product Subcategory is cleared."></textarea>
        <div class="kb-row"><button class="btn primary" type="button" (click)="run()" [disabled]="!text.trim()">Analyse</button>
          @if (sections().length) { <button class="btn" type="button" (click)="copy()">{{ copied() ? 'Copied' : 'Copy as Markdown' }}</button> }</div>
      </section>
      @for (s of sections(); track $index) {
        <section class="kb-panel kb-pad kb-sec" [attr.data-kind]="s.kind">
          <p class="kb-sec-title">{{ s.title }}</p>
          @if (s.text) { <p>{{ s.text }}</p> }
          @if (s.items?.length) { @if (s.kind === 'steps') { <ol>@for (x of s.items!; track $index) { <li>{{ x }}</li> }</ol> } @else { <ul>@for (x of s.items!; track $index) { <li>{{ x }}</li> }</ul> } }
          @if (s.table; as t) { <div class="table-scroll"><table><thead><tr>@for (c of t.columns; track $index) { <th>{{ c }}</th> }</tr></thead><tbody>@for (r of t.rows; track $index) { <tr>@for (c of r; track $index) { <td>{{ c }}</td> }</tr> }</tbody></table></div> }
        </section>
      }
    </kb-gate>
  `,
})
export default class BaCopilotPage {
  private readonly kb = inject(KbService);
  protected text = '';
  protected readonly sections = signal<KbSection[]>([]);
  protected readonly copied = signal(false);
  constructor() {
    inject(SeoService).set({ title: 'Business analyst copilot', description: 'Requirement analysis, user stories, acceptance criteria and test scenarios grounded in the WFX knowledge base.', path: '/ba-copilot', noindex: true, crumbs: [{ label: 'BA copilot', path: '/ba-copilot' }] });
  }
  protected async run() { this.sections.set((await this.kb.post<{ sections: KbSection[] }>('/ba/analyse', { text: this.text })).sections); }
  protected async copy() {
    const md = this.sections().map((s) => [`## ${s.title}`, s.text ?? '', ...(s.items ?? []).map((x) => `- ${x}`), ...(s.table ? [`| ${s.table.columns.join(' | ')} |`, `| ${s.table.columns.map(() => '---').join(' | ')} |`, ...s.table.rows.map((r) => `| ${r.join(' | ')} |`)] : [])].filter(Boolean).join('\n')).join('\n\n');
    try { await navigator.clipboard.writeText(md); this.copied.set(true); setTimeout(() => this.copied.set(false), 1500); } catch { /* blocked */ }
  }
}
