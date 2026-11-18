import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { KbGate, KbTabs } from './shared';

interface U { id: number; username: string; displayName: string; role: string; disabled: boolean; pending: boolean; lastLoginAt: string | null }
interface Ai { configured: boolean; providers: string[]; active: boolean; authorisation: { authorised: boolean; provider: string | null; by: string; at: string; acknowledgement: string; allowGeneral: boolean } | null }

@Component({
  selector: 'app-admin',
  imports: [KbGate, KbTabs, FormsModule, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="kb-h1">Admin and settings</h1>
    <kb-gate role="admin" next="/admin">
      <kb-tabs />
      <div class="kb-grid2">
        <section class="kb-panel kb-pad">
          <h2>Users and roles</h2>
          <p class="small muted">viewer: read and ask · editor: upload, draft knowledge · approver: approve and activate · admin: everything.</p>
          <form class="kb-row" (ngSubmit)="saveSignup()">
            <label>Creating an account from the sign-in page
              <select name="sm" [(ngModel)]="signupMode"><option value="off">Switched off: only an admin adds users</option><option value="approval">Allowed, an admin approves each request (viewer)</option><option value="open">Open: anybody who can reach this server gets a viewer account at once</option></select></label>
            <button class="btn small" type="submit">Save</button>
          </form>
          @if (signupMode === 'open') { <p class="small kb-warn">Open sign-up lets anybody who can open this site read the WFX knowledge. Use it only on a private network.</p> }
          <div class="table-scroll"><table><thead><tr><th>User</th><th>Role</th><th>Last sign-in</th><th></th></tr></thead><tbody>
            @for (u of users(); track u.id) {
              <tr [class.muted]="u.disabled && !u.pending"><td>{{ u.displayName }} <span class="muted small">{{ u.username }}</span>@if (u.pending) { <span class="kb-badge" data-s="proposed">waiting for approval</span> }</td>
                @if (u.pending) {
                  <td><select [ngModel]="approveRole()[u.id] ?? 'viewer'" (ngModelChange)="setApproveRole(u.id, $event)" [name]="'a' + u.id" aria-label="Role to give">@for (r of roles; track r) { <option [value]="r">{{ r }}</option> }</select></td>
                  <td class="small">requested an account</td>
                  <td><button class="btn small primary" type="button" (click)="approve(u.id)">Approve</button> <button class="btn small" type="button" (click)="reject(u.id)">Reject</button></td>
                } @else {
                  <td><select [ngModel]="u.role" (ngModelChange)="patch(u.id, { role: $event })" [name]="'r' + u.id">@for (r of roles; track r) { <option [value]="r">{{ r }}</option> }</select></td>
                  <td class="small">{{ u.lastLoginAt ? (u.lastLoginAt | date: 'd MMM, HH:mm') : '—' }}</td>
                  <td><button class="btn small" type="button" (click)="patch(u.id, { disabled: !u.disabled })">{{ u.disabled ? 'Enable' : 'Disable' }}</button></td>
                }</tr>
            }</tbody></table></div>
          <form class="kb-row" (ngSubmit)="create()">
            <input name="un" [(ngModel)]="nu.username" placeholder="user name" required />
            <input name="dn" [(ngModel)]="nu.displayName" placeholder="display name" />
            <select name="ro" [(ngModel)]="nu.role">@for (r of roles; track r) { <option [value]="r">{{ r }}</option> }</select>
            <input name="pw" type="password" [(ngModel)]="nu.password" placeholder="first password" autocomplete="new-password" required />
            <button class="btn small" type="submit">Add user</button>
          </form>
          @if (msg()) { <p class="small" [class.kb-bad]="bad()">{{ msg() }}</p> }
        </section>
        <section class="kb-panel kb-pad">
          <h2>AI provider</h2>
          @if (ai(); as a) {
            <p>Key configured on the server: <strong>{{ a.configured ? a.providers.join(', ') : 'none' }}</strong> · Active: <strong>{{ a.active ? 'yes' : 'no' }}</strong></p>
            <p class="small">WFX documents can be confidential. The AI provider is only used after an admin records here that the organisation allows sending knowledge to it. Even then, only the few passages that answer one question are sent, never the library, and the answer must cite them.</p>
            <form class="kb-form" (ngSubmit)="saveAi()">
              <label><input type="checkbox" name="au" [(ngModel)]="aiForm.authorised" /> The organisation allows sending WFX knowledge passages to the AI provider</label>
              <label>Provider <select name="pv" [(ngModel)]="aiForm.provider"><option value="">Server default</option>@for (p of a.providers; track p) { <option [value]="p">{{ p }}</option> }</select></label>
              <label>Who approved it, and when (recorded in the audit trail) <textarea name="ack" rows="2" [(ngModel)]="aiForm.acknowledgement"></textarea></label>
              <label><input type="checkbox" name="ge" [(ngModel)]="aiForm.allowGeneral" /> When the knowledge base has nothing, allow brief general industry context, clearly labelled as not WFX documentation</label>
              <button class="btn small" type="submit">Save</button>
            </form>
            @if (a.authorisation; as au) { <p class="small muted">Last change: {{ au.authorised ? 'authorised' : 'not authorised' }} by {{ au.by }} on {{ au.at | date: 'd MMM y, HH:mm' }}.</p> }
          }
          <h2>Knowledge base</h2>
          <div class="kb-row">
            <button class="btn small" type="button" (click)="reindex()">Re-index from the knowledge folder</button>
            <button class="btn small" type="button" (click)="kb.download('/admin/export', 'wfx-knowledge.zip')">Export library (TXT + metadata)</button>
            <button class="btn small" type="button" (click)="kb.download('/admin/export?originals=1', 'wfx-knowledge-full.zip')">Export with original files</button>
            <button class="btn small" type="button" (click)="backup()">Back up now</button>
          </div>
          @if (opMsg()) { <p class="small">{{ opMsg() }}</p> }
        </section>
      </div>
      <section class="kb-panel kb-pad">
        <h2>Audit trail</h2>
        <div class="table-scroll"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Target</th><th>Detail</th></tr></thead><tbody>
          @for (a of audit(); track a.id) { <tr><td class="small">{{ a.at | date: 'd MMM, HH:mm:ss' }}</td><td>{{ a.username || '—' }}</td><td>{{ a.action }}</td><td>{{ a.target_type }} {{ a.target_id }}</td><td class="small">{{ a.detail }}</td></tr> }
        </tbody></table></div>
      </section>
    </kb-gate>
  `,
})
export default class AdminPage {
  protected readonly kb = inject(KbService);
  protected readonly roles = ['viewer', 'editor', 'approver', 'admin'];
  protected readonly users = signal<U[]>([]);
  protected readonly ai = signal<Ai | null>(null);
  protected readonly audit = signal<{ id: number; at: string; username: string; action: string; target_type: string; target_id: string; detail: string }[]>([]);
  protected readonly msg = signal(''); protected readonly bad = signal(false); protected readonly opMsg = signal('');
  protected nu = { username: '', displayName: '', role: 'viewer', password: '' };
  protected signupMode = 'approval';
  protected readonly approveRole = signal<Record<number, string | undefined>>({});
  protected aiForm = { authorised: false, provider: '', acknowledgement: '', allowGeneral: true };
  private loaded = false;
  constructor() {
    inject(SeoService).set({ title: 'Admin and settings', description: 'Users, AI authorisation, re-indexing, export, backup and audit trail.', path: '/admin', noindex: true, crumbs: [{ label: 'Admin', path: '/admin' }] });
    effect(() => { if (this.kb.can('admin') && !this.loaded) { this.loaded = true; void this.load(); } });
  }
  private async load() {
    this.users.set((await this.kb.get<{ users: U[] }>('/users')).users);
    this.signupMode = (await this.kb.get<{ mode: string }>('/settings/signup')).mode;
    const ai = await this.kb.get<Ai>('/settings/ai');
    this.ai.set(ai);
    if (ai.authorisation) this.aiForm = { authorised: ai.authorisation.authorised, provider: ai.authorisation.provider ?? '', acknowledgement: ai.authorisation.acknowledgement, allowGeneral: ai.authorisation.allowGeneral };
    this.audit.set((await this.kb.get<{ audit: never[] }>('/audit')).audit);
  }
  protected async patch(id: number, body: Record<string, unknown>) {
    try { await this.kb.request('PATCH', `/users/${id}`, body); this.bad.set(false); this.msg.set('Saved.'); } catch (e) { this.bad.set(true); this.msg.set((e as Error).message); }
    await this.load();
  }
  protected setApproveRole(id: number, role: string) { this.approveRole.update((m) => ({ ...m, [id]: role })); }
  protected async approve(id: number) {
    try { await this.kb.post(`/users/${id}/approve`, { role: this.approveRole()[id] ?? 'viewer' }); this.bad.set(false); this.msg.set('Approved: they can sign in now.'); } catch (e) { this.bad.set(true); this.msg.set((e as Error).message); }
    await this.load();
  }
  protected async reject(id: number) {
    if (!confirm('Reject this request? The account request is deleted.')) return;
    try { await this.kb.post(`/users/${id}/reject`, {}); this.bad.set(false); this.msg.set('Request rejected.'); } catch (e) { this.bad.set(true); this.msg.set((e as Error).message); }
    await this.load();
  }
  protected async saveSignup() {
    try { await this.kb.request('PUT', '/settings/signup', { mode: this.signupMode }); this.bad.set(false); this.msg.set('Saved. The sign-in page now follows this setting.'); } catch (e) { this.bad.set(true); this.msg.set((e as Error).message); }
  }
  protected async create() {
    try { await this.kb.post('/users', this.nu); this.nu = { username: '', displayName: '', role: 'viewer', password: '' }; this.bad.set(false); this.msg.set('User added. Give them the first password privately; they can change it after signing in.'); }
    catch (e) { this.bad.set(true); this.msg.set((e as Error).message); }
    await this.load();
  }
  protected async saveAi() {
    try { this.ai.set(await this.kb.request<Ai>('PUT', '/settings/ai', this.aiForm)); this.opMsg.set('AI settings saved.'); } catch (e) { this.opMsg.set((e as Error).message); }
  }
  protected async reindex() {
    this.opMsg.set('Re-indexing…');
    const r = await this.kb.post<{ entries: number; chunks: number; documents: { documents: number; chunks: number }; problems: unknown[]; invalid: unknown[] }>('/admin/reindex');
    this.opMsg.set(`Indexed ${r.entries} entries (${r.chunks} chunks) and ${r.documents.documents} documents (${r.documents.chunks} chunks). Format problems: ${r.problems.length}, invalid entries: ${r.invalid.length}.`);
  }
  protected async backup() {
    const r = await this.kb.post<{ database: string; knowledge: string }>('/admin/backup');
    this.opMsg.set(`Backup written: ${r.database} and ${r.knowledge}.`);
  }
}
