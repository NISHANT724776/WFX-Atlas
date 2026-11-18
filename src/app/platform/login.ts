import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { KbService } from '../core/kb.service';
import { SeoService } from '../core/seo.service';

@Component({
  selector: 'app-login',
  imports: [FormsModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="kb-narrow">
      <h1>{{ kb.setupRequired() ? 'Set up the knowledge platform' : up() ? 'Create an account' : 'Sign in' }}</h1>
      @if (kb.state() === 'offline') {
        <p class="kb-panel kb-pad">The knowledge server is not running. Start it with <code>npm run kb:server</code> and reload this page.</p>
      } @else if (kb.user(); as u) {
        <p class="kb-panel kb-pad">Signed in as <strong>{{ u.displayName }}</strong> ({{ u.role }}). <button type="button" class="btn small" (click)="go()">Continue</button></p>
      } @else if (up() && !kb.setupRequired()) {
        @if (sent()) {
          <p class="kb-panel kb-pad" role="status"><strong>Request sent.</strong> An administrator has to approve your account before you can sign in. Your user name is <strong>{{ username }}</strong>; use the password you just chose. <button type="button" class="btn small" (click)="show(false)">Back to sign in</button></p>
        } @else {
          <form class="kb-form kb-panel kb-pad" (ngSubmit)="register()">
            <p class="small">{{ kb.signupMode() === 'open' ? 'You will be signed in at once, as a viewer (read and ask).' : 'New accounts are viewers (read and ask). An administrator approves your request before you can sign in.' }}</p>
            <label>Your name <input name="sdn" [(ngModel)]="displayName" required autocomplete="name" /></label>
            <label>User name <input name="sun" [(ngModel)]="username" required minlength="3" maxlength="40" autocomplete="username" /></label>
            <p class="muted small">3–40 letters, digits, dot, dash or underscore.</p>
            <label>Password <input name="spw" type="password" [(ngModel)]="password" required autocomplete="new-password" /></label>
            <label>Repeat password <input name="spw2" type="password" [(ngModel)]="password2" required autocomplete="new-password" /></label>
            <p class="muted small">At least 10 characters, mixing letters with digits or symbols.</p>
            @if (error()) { <p class="kb-bad" role="alert">{{ error() }}</p> }
            <button class="btn primary" type="submit" [disabled]="busy()">Create account</button>
            <button class="linklike" type="button" (click)="show(false)">I already have an account</button>
          </form>
        }
      } @else {
        <form class="kb-form kb-panel kb-pad" (ngSubmit)="submit()">
          @if (kb.setupRequired()) {
            <p class="small">First start: create the admin account. Paste the one-time setup token that the server printed in its console window.</p>
            <label>Setup token <input name="token" [(ngModel)]="token" required autocomplete="off" /></label>
            <label>Your name <input name="displayName" [(ngModel)]="displayName" required /></label>
          }
          <label>User name <input name="username" [(ngModel)]="username" required autocomplete="username" /></label>
          <label>Password <input name="password" type="password" [(ngModel)]="password" required [attr.autocomplete]="kb.setupRequired() ? 'new-password' : 'current-password'" /></label>
          @if (kb.setupRequired()) {
            <label>Repeat password <input name="password2" type="password" [(ngModel)]="password2" required autocomplete="new-password" /></label>
            <p class="muted small">At least 10 characters, mixing letters with digits or symbols.</p>
          }
          @if (error()) { <p class="kb-bad" role="alert">{{ error() }}</p> }
          <button class="btn primary" type="submit" [disabled]="busy()">{{ kb.setupRequired() ? 'Create admin and sign in' : 'Sign in' }}</button>
          @if (!kb.setupRequired() && kb.signupMode() !== 'off') { <button class="linklike" type="button" (click)="show(true)">Create an account</button> }
        </form>
      }
    </section>
  `,
})
export default class LoginPage {
  protected readonly kb = inject(KbService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected token = ''; protected displayName = ''; protected username = ''; protected password = ''; protected password2 = '';
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly up = signal(false);
  protected readonly sent = signal(false);

  constructor() {
    inject(SeoService).set({ title: 'Sign in', description: 'Sign in to the WFX knowledge platform.', path: '/login', noindex: true, crumbs: [{ label: 'Sign in', path: '/login' }] });
    void this.kb.init();
  }
  protected show(up: boolean) { this.up.set(up); this.sent.set(false); this.error.set(''); this.password = this.password2 = ''; }
  protected async register() {
    this.error.set('');
    if (this.password !== this.password2) { this.error.set('The two passwords are different.'); return; }
    this.busy.set(true);
    try {
      const status = await this.kb.signup(this.username.trim(), this.displayName.trim(), this.password);
      this.password = this.password2 = '';
      if (status === 'active') this.go(); else this.sent.set(true);
    } catch (e) { this.error.set((e as Error).message); }
    finally { this.busy.set(false); }
  }
  protected go() { void this.router.navigateByUrl(this.route.snapshot.queryParamMap.get('next') || '/dashboard'); }
  protected async submit() {
    this.error.set('');
    if (this.kb.setupRequired() && this.password !== this.password2) { this.error.set('The two passwords are different.'); return; }
    this.busy.set(true);
    try {
      if (this.kb.setupRequired()) await this.kb.setup(this.token.trim(), this.username.trim(), this.displayName.trim(), this.password);
      else await this.kb.login(this.username.trim(), this.password);
      this.password = this.password2 = '';
      this.go();
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.busy.set(false);
    }
  }
}
