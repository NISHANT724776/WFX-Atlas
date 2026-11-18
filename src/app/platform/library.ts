import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { DatePipe, DecimalPipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { KbGate, KbTabs } from './shared';

interface DocRow { id: string; title: string; ext: string; doc_type: string; knowledge_status: string; module: string | null; current_version: number; version_status: string; status_note: string; size: number; uploaded_at: string; updated_at: string }
interface Version { version: number; sha256: string; size: number; original_name: string; status: string; status_note: string; uploaded_at: string; uploaded_by: string; origin_path: string | null; diff: Record<string, string[] | number> | null; stats: Record<string, unknown> }
interface DocDetail { document: { id: string; title: string; ext: string; doc_type: string; knowledge_status: string; module: string | null; origin: string; current_version: number; versions: Version[] }; candidates: { id: number; doc_version: number; kind: string; text: string; locator: string; status: string; entry_id: string | null }[]; chunks: number }

@Component({
  selector: 'app-library',
  imports: [KbGate, KbTabs, FormsModule, DatePipe, DecimalPipe, RouterLink],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="kb-h1">Library</h1>
    <kb-gate next="/library">
      <kb-tabs />
      @if (kb.can('editor')) {
        <details class="kb-panel kb-pad kb-upload" (dragover)="$event.preventDefault()" (drop)="drop($event)">
          <summary><strong>Add documents</strong> <span class="muted small">(or drop files here)</span></summary>
          <p class="small muted">TXT, CSV, XLSX, XLS, PDF, DOCX, DOC, JSON, Markdown, HTML, Mermaid, PNG, JPG, WebP · up to 25 MB each. Originals are stored unchanged; a changed copy of an existing document becomes its next version.</p>
          <div class="kb-row">
            <label>Knowledge status
              <select [(ngModel)]="status" name="status">
                <option value="source-documented">Source document (manual, approved specification)</option>
                <option value="proposed">Proposed (change request, draft specification)</option>
                <option value="reference">Reference (demo data, examples)</option>
                <option value="unreviewed">Not reviewed yet</option>
              </select>
            </label>
            <label>Type <select [(ngModel)]="docType" name="docType"><option value="">Detect</option>@for (t of types(); track t) { <option [value]="t">{{ t }}</option> }</select></label>
            <label>Module <input [(ngModel)]="module" name="module" placeholder="Detect" list="kb-modules" /></label>
            <datalist id="kb-modules">@for (m of modules(); track m) { <option [value]="m"></option> }</datalist>
            <label class="btn primary kb-file">Choose files<input type="file" multiple (change)="pick($event)" hidden /></label>
          </div>
          @for (u of uploads(); track $index) { <p class="small" [class.kb-bad]="u.bad">{{ u.name }}: {{ u.msg }}</p> }
        </details>
      }
      <div class="kb-filter">
        <input type="search" placeholder="Search title or ID" [ngModel]="q()" (ngModelChange)="q.set($event)" name="q" />
        <select [ngModel]="fModule()" (ngModelChange)="fModule.set($event)" name="fm"><option value="">All modules</option>@for (m of modules(); track m) { <option [value]="m">{{ m }}</option> }</select>
        <select [ngModel]="fType()" (ngModelChange)="fType.set($event)" name="ft"><option value="">All types</option>@for (t of types(); track t) { <option [value]="t">{{ t }}</option> }</select>
        <span class="muted small">{{ shown().length }} of {{ docs().length }} documents</span>
      </div>
      <div class="kb-split">
        <div class="table-scroll kb-doclist"><table>
          <thead><tr><th>Title</th><th>Module</th><th>Status</th><th>v</th></tr></thead>
          <tbody>@for (d of shown(); track d.id) {
            <tr [class.sel]="d.id === selId()" (click)="select(d.id)" tabindex="0" (keydown.enter)="select(d.id)">
              <td>{{ d.title }} <span class="muted small">{{ d.id }}</span></td><td>{{ d.module || '—' }}</td>
              <td><span class="kb-badge" [attr.data-s]="d.knowledge_status">{{ d.knowledge_status }}</span></td><td>{{ d.current_version }}</td>
            </tr>
          }</tbody></table></div>
        @if (detail(); as x) {
          <aside class="kb-panel kb-pad kb-detail">
            <h2>{{ x.document.title }}</h2>
            <p class="small muted">{{ x.document.id }} · .{{ x.document.ext }} · {{ x.chunks }} searchable chunks · origin: {{ x.document.origin }}</p>
            @if (kb.can('editor')) {
              <form class="kb-row" (ngSubmit)="saveMeta(x.document.id)">
                <label>Title <input [(ngModel)]="edit.title" name="t" /></label>
                <label>Module <input [(ngModel)]="edit.module" name="m" list="kb-modules" /></label>
                <label>Status <select [(ngModel)]="edit.knowledgeStatus" name="s"><option>source-documented</option><option>proposed</option><option>reference</option><option>unreviewed</option></select></label>
                <button class="btn small" type="submit">Save</button>
                <button class="btn small" type="button" (click)="reprocess(x.document.id)">Reprocess</button>
              </form>
            }
            <h3>Versions</h3>
            <ul class="kb-list">@for (v of versionsDesc(); track v.version) {
              <li>
                <strong>v{{ v.version }}</strong> {{ v.original_name }} · {{ v.size / 1024 | number: '1.0-0' }} KB · {{ v.uploaded_at | date: 'd MMM y' }} · {{ v.status }}
                @if (v.status_note) { <span class="muted small"> — {{ v.status_note }}</span> }
                <span class="kb-actions"><button type="button" class="linklike" (click)="openExtracted(x.document.id, v.version)">Extracted text</button> · <button type="button" class="linklike" (click)="kb.download('/documents/' + x.document.id + '/versions/' + v.version + '/original', v.original_name)">Original</button></span>
                @if (v.diff; as df) {
                  <details class="small"><summary>Changes against v{{ df['previous'] }}</summary>
                    @for (k of diffKeys; track k) { @if (list(df[k]).length) { <p><strong>{{ k.replace('_', ' ') }}:</strong> {{ list(df[k]).join('; ') }}</p> } }
                  </details>
                }
              </li>
            }</ul>
            <h3>Candidates for review <span class="muted small">({{ x.candidates.length }})</span></h3>
            <p class="small muted">Possible definitions, formulas, validations and steps found in the text. None of them is knowledge until reviewed.</p>
            <div class="kb-row">@for (k of candidateKinds(); track k) { <button type="button" class="chip-btn" [class.on]="cKind() === k" (click)="cKind.set(k)">{{ k }} ({{ countKind(k) }})</button> }</div>
            <ul class="kb-list">@for (c of candidatesShown(); track c.id) {
              <li [class.muted]="c.status !== 'new'">
                <span class="small muted">{{ c.locator }} · v{{ c.doc_version }}</span><br />{{ c.text }}
                @if (kb.can('editor') && c.status === 'new') {
                  <span class="kb-actions"><a class="linklike" [routerLink]="['/rulebook']" [queryParams]="{ teach: c.text }">Turn into a rule</a> · <button type="button" class="linklike" (click)="dismiss(c.id)">Dismiss</button></span>
                } @else { <span class="small"> ({{ c.status }}{{ c.entry_id ? ' → ' + c.entry_id : '' }})</span> }
              </li>
            }</ul>
          </aside>
        }
      </div>
    </kb-gate>
  `,
})
export default class LibraryPage {
  protected readonly kb = inject(KbService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  protected readonly docs = signal<DocRow[]>([]);
  protected readonly types = signal<string[]>([]);
  protected readonly modules = signal<string[]>([]);
  protected readonly q = signal('');
  protected readonly fModule = signal('');
  protected readonly fType = signal('');
  protected readonly selId = signal<string | null>(null);
  protected readonly detail = signal<DocDetail | null>(null);
  protected readonly uploads = signal<{ name: string; msg: string; bad: boolean }[]>([]);
  protected readonly cKind = signal('formula');
  protected status = 'source-documented'; protected docType = ''; protected module = '';
  protected edit = { title: '', module: '', knowledgeStatus: '' };
  protected readonly diffKeys = ['sections_added', 'sections_removed', 'sections_changed', 'formulas_added', 'formulas_removed', 'validations_added', 'validations_removed'];
  protected readonly shown = computed(() => {
    const q = this.q().toLowerCase();
    return this.docs().filter((d) => (!q || d.title.toLowerCase().includes(q) || d.id.toLowerCase().includes(q)) && (!this.fModule() || d.module === this.fModule()) && (!this.fType() || d.doc_type === this.fType()));
  });
  protected readonly versionsDesc = computed(() => [...(this.detail()?.document.versions ?? [])].reverse());
  protected readonly candidateKinds = computed(() => [...new Set((this.detail()?.candidates ?? []).map((c) => c.kind))]);
  protected readonly candidatesShown = computed(() => (this.detail()?.candidates ?? []).filter((c) => c.kind === this.cKind()).slice(0, 200));

  constructor() {
    inject(SeoService).set({ title: 'Knowledge library', description: 'Upload, browse and review the documents of the WFX knowledge base.', path: '/library', noindex: true, crumbs: [{ label: 'Library', path: '/library' }] });
    effect(() => { if (this.kb.user() && !this.docs().length) void this.load(); });
    this.route.queryParamMap.subscribe((p) => { const d = p.get('doc'); if (d && d !== this.selId()) void this.select(d, false); });
  }
  protected list(v: unknown): string[] { return Array.isArray(v) ? v : []; }
  protected countKind(k: string) { return (this.detail()?.candidates ?? []).filter((c) => c.kind === k).length; }
  private async load() {
    const r = await this.kb.get<{ documents: DocRow[]; docTypes: string[]; modules: string[] }>('/documents');
    this.docs.set(r.documents); this.types.set(r.docTypes); this.modules.set(r.modules);
  }
  protected async select(id: string, nav = true) {
    this.selId.set(id);
    if (nav) void this.router.navigate([], { queryParams: { doc: id }, replaceUrl: true });
    const d = await this.kb.get<DocDetail>(`/documents/${id}`);
    this.detail.set(d);
    this.edit = { title: d.document.title, module: d.document.module ?? '', knowledgeStatus: d.document.knowledge_status };
    const kinds = [...new Set(d.candidates.map((c) => c.kind))];
    if (!kinds.includes(this.cKind())) this.cKind.set(kinds[0] ?? 'formula');
  }
  protected pick(e: Event) { const f = (e.target as HTMLInputElement).files; if (f) void this.send([...f]); }
  protected drop(e: DragEvent) { e.preventDefault(); if (e.dataTransfer?.files.length) void this.send([...e.dataTransfer.files]); }
  private async send(files: File[]) {
    for (const f of files) {
      this.uploads.update((u) => [...u, { name: f.name, msg: 'uploading…', bad: false }]);
      const i = this.uploads().length - 1;
      try {
        const r = await this.kb.upload(f, { knowledgeStatus: this.status, docType: this.docType || undefined, module: this.module || undefined });
        this.uploads.update((u) => u.map((x, k) => (k === i ? { ...x, msg: r.message } : x)));
      } catch (err) {
        this.uploads.update((u) => u.map((x, k) => (k === i ? { ...x, msg: (err as Error).message, bad: true } : x)));
      }
    }
    await this.load();
  }
  protected async saveMeta(id: string) {
    await this.kb.request('PATCH', `/documents/${id}`, this.edit);
    await this.load(); await this.select(id, false);
  }
  protected async reprocess(id: string) { await this.kb.post(`/documents/${id}/reprocess`); await this.select(id, false); }
  protected async dismiss(cid: number) { await this.kb.post(`/candidates/${cid}/dismiss`); if (this.selId()) await this.select(this.selId()!, false); }
  protected async openExtracted(id: string, v: number) {
    const blob = await this.kb.request<Blob>('GET', `/documents/${id}/versions/${v}/extracted`);
    const url = URL.createObjectURL(new Blob([blob], { type: 'text/plain;charset=utf-8' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }
}
