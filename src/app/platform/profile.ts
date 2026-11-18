import { DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';
import { KbGate, KbTabs } from './shared';

interface Profile { user: { id: number; username: string; displayName: string; role: string }; createdAt: string | null; lastLoginAt: string | null }

@Component({
  selector: 'app-profile',
  imports: [KbGate, KbTabs, FormsModule, RouterLink, DatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <h1 class="kb-h1">Profile</h1>
    <kb-gate next="/profile">
      <kb-tabs />
      @if (me(); as p) {
        <div class="kb-grid2">
          <section class="kb-panel kb-pad">
            <h2>My profile</h2>
            <dl class="wd-meta">
              <div><dt>Name</dt><dd>{{ p.user.displayName }}</dd></div>
              <div><dt>User name</dt><dd>{{ p.user.username }}</dd></div>
              <div><dt>Role</dt><dd><span class="kb-badge" [attr.data-s]="p.user.role === 'viewer' ? 'proposed' : 'Active'">{{ p.user.role }}</span></dd></div>
              <div><dt>Account created</dt><dd>{{ p.createdAt ? (p.createdAt | date: 'd MMM y') : '–' }}</dd></div>
              <div><dt>Last sign-in</dt><dd>{{ p.lastLoginAt ? (p.lastLoginAt | date: 'd MMM y, HH:mm') : '–' }}</dd></div>
            </dl>
            <p class="small muted">viewer: read and ask · editor: upload, draft knowledge · approver: approve and activate · admin: everything.</p>
            <h2>Change my password</h2>
            <form class="kb-form" (ngSubmit)="changePassword()">
              <label>Current password <input name="cur" type="password" [(ngModel)]="pw.current" required autocomplete="current-password" /></label>
              <label>New password <input name="new" type="password" [(ngModel)]="pw.next" required autocomplete="new-password" /></label>
              <label>Repeat the new password <input name="new2" type="password" [(ngModel)]="pw.again" required autocomplete="new-password" /></label>
              <p class="muted small">At least 10 characters, mixing letters with digits or symbols.</p>
              <button class="btn small primary" type="submit" [disabled]="busy()">Change password</button>
              @if (pwMsg()) { <p class="small" [class.kb-bad]="pwBad()" role="status">{{ pwMsg() }}</p> }
            </form>
          </section>

          @if (kb.can('admin')) {
            <section class="kb-panel kb-pad">
              <h2>Add a new user</h2>
              <p class="small muted">The user can sign in at once with the first password you set. Give it to them privately; they can change it on this page. The account list is kept in the readable file <code>knowledge/admin/users.txt</code> (names, roles and status only, never passwords).</p>
              <form class="kb-form" (ngSubmit)="addUser()">
                <label>Name <input name="dn" [(ngModel)]="nu.displayName" required /></label>
                <label>User name <input name="un" [(ngModel)]="nu.username" required minlength="3" maxlength="40" autocomplete="off" /></label>
                <label>Role <select name="ro" [(ngModel)]="nu.role">@for (r of roles; track r) { <option [value]="r">{{ r }}</option> }</select></label>
                <label>First password <input name="pw" type="password" [(ngModel)]="nu.password" required autocomplete="new-password" /></label>
                <button class="btn small primary" type="submit" [disabled]="busy()">Add user</button>
                @if (addMsg()) { <p class="small" [class.kb-bad]="addBad()" role="status">{{ addMsg() }}</p> }
              </form>
              <p class="small"><a routerLink="/admin">Admin: all users, approvals, sign-up setting →</a></p>
              <details class="small" (toggle)="loadDirectory()"><summary>The admin directory file ({{ file() || 'knowledge/admin/users.txt' }})</summary>
                <pre class="kb-code">{{ directory() }}</pre>
                <p class="muted">Administrators can also ask the assistant about it, for example “Who has the approver role?”. Nobody else can retrieve it.</p>
              </details>
            </section>
          }
        </div>
      }
    </kb-gate>
  `,
})
export default class ProfilePage {
  protected readonly kb = inject(KbService);
  protected readonly roles = ['viewer', 'editor', 'approver', 'admin'];
  protected readonly me = signal<Profile | null>(null);
  protected readonly busy = signal(false);
  protected readonly pwMsg = signal(''); protected readonly pwBad = signal(false);
  protected readonly addMsg = signal(''); protected readonly addBad = signal(false);
  protected readonly directory = signal('');
  protected readonly file = signal('');
  protected pw = { current: '', next: '', again: '' };
  protected nu = { displayName: '', username: '', role: 'viewer', password: '' };
  private loaded = false;

  constructor() {
    inject(SeoService).set({ title: 'Profile', description: 'Your account and, for administrators, adding users.', path: '/profile', noindex: true, crumbs: [{ label: 'Profile', path: '/profile' }] });
    effect(() => { if (this.kb.user() && !this.loaded) { this.loaded = true; void this.kb.get<Profile>('/profile').then((p) => this.me.set(p)); } });
  }
  protected async changePassword() {
    this.pwMsg.set('');
    if (this.pw.next !== this.pw.again) { this.pwBad.set(true); this.pwMsg.set('The two new passwords are different.'); return; }
    this.busy.set(true);
    try {
      await this.kb.post('/auth/password', { current: this.pw.current, password: this.pw.next });
      this.pw = { current: '', next: '', again: '' }; this.pwBad.set(false); this.pwMsg.set('Password changed. Other devices were signed out.');
    } catch (e) { this.pwBad.set(true); this.pwMsg.set((e as Error).message); }
    finally { this.busy.set(false); }
  }
  protected async addUser() {
    this.addMsg.set(''); this.busy.set(true);
    try {
      await this.kb.post('/users', { ...this.nu, username: this.nu.username.trim(), displayName: this.nu.displayName.trim() });
      this.addBad.set(false); this.addMsg.set(`Added ${this.nu.username.trim()} as ${this.nu.role}. They can sign in now with the first password.`);
      this.nu = { displayName: '', username: '', role: 'viewer', password: '' };
      await this.loadDirectory(true);
    } catch (e) { this.addBad.set(true); this.addMsg.set((e as Error).message); }
    finally { this.busy.set(false); }
  }
  protected async loadDirectory(force = false) {
    if (!this.kb.can('admin') || (!force && this.directory())) return;
    const d = await this.kb.get<{ file: string; text: string }>('/admin/directory');
    this.directory.set(d.text); this.file.set(d.file);
  }
}
