// Local accounts, roles, sessions, first-run setup and the audit trail.
// Passwords: scrypt with a per-user salt. Sessions: random tokens, stored only as SHA-256 hashes, HttpOnly cookies.
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { settings } from './config.ts';
import { all, get, run } from './db.ts';
import { log, nowIso, randomToken, sha256 } from './util.ts';
import { syncAdminDirectory } from './admin/directory.ts';

/** Rewrites knowledge/admin/users.txt and its admin-only search passages; a failure here never blocks an account change. */
function directoryChanged(): void { try { syncAdminDirectory(); } catch (e) { log('error', 'admin directory not updated', { error: (e as Error).message }); } }

export type Role = 'admin' | 'approver' | 'editor' | 'viewer';
export const ROLES: Role[] = ['admin', 'approver', 'editor', 'viewer'];
export interface User { id: number; username: string; displayName: string; role: Role }

const RANK: Record<Role, number> = { viewer: 0, editor: 1, approver: 2, admin: 3 };
export const atLeast = (u: User | null, r: Role) => !!u && RANK[u.role] >= RANK[r];

export function passwordProblem(pw: string): string | null {
  if (typeof pw !== 'string' || pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'Use at most 200 characters.';
  if (/^(.)\1+$/.test(pw)) return 'Do not repeat one character.';
  if (!/[a-zA-Z]/.test(pw) || !/[^a-zA-Z]/.test(pw)) return 'Mix letters with digits or symbols.';
  return null;
}

function hashPassword(pw: string, salt = randomBytes(16).toString('base64')): { salt: string; hash: string } {
  return { salt, hash: scryptSync(pw, salt, 64, { N: 16384, r: 8, p: 1 }).toString('base64') };
}
function checkPassword(pw: string, salt: string, hash: string): boolean {
  const a = Buffer.from(hashPassword(pw, salt).hash, 'base64');
  const b = Buffer.from(hash, 'base64');
  return a.length === b.length && timingSafeEqual(a, b);
}

const USERNAME = /^[a-zA-Z0-9._-]{3,40}$/;
export function createUser(username: string, displayName: string, role: Role, password: string): User {
  if (!USERNAME.test(username)) throw new Error('User names use 3–40 letters, digits, dot, dash or underscore.');
  if (!ROLES.includes(role)) throw new Error('Unknown role.');
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  if (get('SELECT 1 FROM users WHERE username = ?', username)) throw new Error('That user name is taken.');
  const { salt, hash } = hashPassword(password);
  const id = run('INSERT INTO users (username, display_name, role, pass_salt, pass_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)', username, displayName.slice(0, 80) || username, role, salt, hash, nowIso()).lastId;
  directoryChanged();
  return { id, username, displayName: displayName || username, role };
}

export function setPassword(userId: number, password: string): void {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const { salt, hash } = hashPassword(password);
  run('UPDATE users SET pass_salt = ?, pass_hash = ? WHERE id = ?', salt, hash, userId);
  run('DELETE FROM sessions WHERE user_id = ?', userId);
}

const toUser = (r: Record<string, unknown>): User => ({ id: Number(r['id']), username: String(r['username']), displayName: String(r['display_name']), role: r['role'] as Role });

export function login(username: string, password: string, ip: string, ua: string): { token: string; user: User } | null {
  const r = get<Record<string, unknown>>('SELECT * FROM users WHERE username = ? AND disabled = 0', String(username ?? ''));
  // always spend the same time, whether or not the user exists
  if (!r) { hashPassword(String(password ?? ''), 'timing-equaliser'); return null; }
  if (!checkPassword(String(password ?? ''), String(r['pass_salt']), String(r['pass_hash']))) return null;
  const token = randomToken(32);
  const expires = new Date(Date.now() + settings().sessionHours * 3600_000).toISOString();
  run('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)', sha256(token), r['id'], nowIso(), expires, ip, ua.slice(0, 200));
  run('UPDATE users SET last_login_at = ? WHERE id = ?', nowIso(), r['id']);
  run('DELETE FROM sessions WHERE expires_at < ?', nowIso());
  return { token, user: toUser(r) };
}

export function sessionUser(token: string | undefined): User | null {
  if (!token || token.length > 200) return null;
  const r = get<Record<string, unknown>>('SELECT u.*, s.expires_at FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND u.disabled = 0', sha256(token));
  if (!r) return null;
  if (String(r['expires_at']) < nowIso()) { run('DELETE FROM sessions WHERE token_hash = ?', sha256(token)); return null; }
  // sliding expiry
  run('UPDATE sessions SET expires_at = ? WHERE token_hash = ?', new Date(Date.now() + settings().sessionHours * 3600_000).toISOString(), sha256(token));
  return toUser(r);
}

export function logout(token: string | undefined): void {
  if (token) run('DELETE FROM sessions WHERE token_hash = ?', sha256(token));
}

export const setupRequired = () => !get('SELECT 1 FROM users LIMIT 1');

/** First start: a one-time token printed in the server console lets the owner create the first admin account. */
export function issueSetupToken(): string | null {
  if (!setupRequired()) return null;
  const token = randomToken(18);
  run('DELETE FROM setup_tokens WHERE used_at IS NULL');
  run('INSERT INTO setup_tokens (token_hash, created_at) VALUES (?, ?)', sha256(token), nowIso());
  return token;
}

export function completeSetup(token: string, username: string, displayName: string, password: string): User {
  if (!setupRequired()) throw new Error('Setup is already complete.');
  const row = get('SELECT 1 FROM setup_tokens WHERE token_hash = ? AND used_at IS NULL', sha256(String(token ?? '')));
  if (!row) throw new Error('The setup token is not valid. Use the token printed in the knowledge server console.');
  const user = createUser(username, displayName, 'admin', password);
  run('UPDATE setup_tokens SET used_at = ? WHERE token_hash = ?', nowIso(), sha256(token));
  audit(user, 'setup-admin-created', 'user', String(user.id), '', '');
  return user;
}

export function listUsers(): (User & { disabled: boolean; pending: boolean; createdAt: string; lastLoginAt: string | null })[] {
  return all<Record<string, unknown>>('SELECT * FROM users ORDER BY pending DESC, username').map((r) => ({ ...toUser(r), disabled: Number(r['disabled']) === 1, pending: Number(r['pending']) === 1, createdAt: String(r['created_at']), lastLoginAt: (r['last_login_at'] as string) ?? null }));
}

export function updateUser(id: number, patch: { role?: Role; disabled?: boolean; displayName?: string }): void {
  if (patch.role && !ROLES.includes(patch.role)) throw new Error('Unknown role.');
  const admins = Number(get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND disabled = 0 AND id <> ?", id)?.n ?? 0);
  const target = get<Record<string, unknown>>('SELECT * FROM users WHERE id = ?', id);
  if (!target) throw new Error('User not found.');
  if (target['role'] === 'admin' && !admins && (patch.disabled || (patch.role && patch.role !== 'admin'))) throw new Error('The last admin cannot be disabled or demoted.');
  if (patch.role) run('UPDATE users SET role = ? WHERE id = ?', patch.role, id);
  if (patch.disabled !== undefined) { run('UPDATE users SET disabled = ? WHERE id = ?', patch.disabled ? 1 : 0, id); if (patch.disabled) run('DELETE FROM sessions WHERE user_id = ?', id); }
  if (patch.displayName) run('UPDATE users SET display_name = ? WHERE id = ?', patch.displayName.slice(0, 80), id);
  directoryChanged();
}

export function audit(user: User | null, action: string, targetType: string, targetId: string, detail: string, ip: string): void {
  try {
    run('INSERT INTO audit_log (at, user_id, username, action, target_type, target_id, detail, ip) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', nowIso(), user?.id ?? null, user?.username ?? null, action, targetType, targetId, detail.slice(0, 2000), ip);
  } catch (e) {
    log('error', 'audit write failed', { error: (e as Error).message });
  }
}

/** Fixed-window rate limiter (per process). */
const buckets = new Map<string, { n: number; reset: number }>();
export function allow(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const b = buckets.get(key);
  if (!b || b.reset < now) { buckets.set(key, { n: 1, reset: now + windowMs }); return true; }
  if (b.n >= max) return false;
  b.n++;
  if (buckets.size > 20000) for (const [k, v] of buckets) if (v.reset < now) buckets.delete(k);
  return true;
}

// ── self-registration ──────────────────────────────────────────────────────────────────────────────────────────
/** Who may create an account from the sign-in page: nobody ("off"), anybody but an admin must approve ("approval", the default), or anybody ("open"). A self-registered account is always a viewer. */
export type SignupMode = 'off' | 'approval' | 'open';
export const SIGNUP_MODES: SignupMode[] = ['off', 'approval', 'open'];
export function signupMode(): SignupMode {
  const v = get<{ value: string }>("SELECT value FROM settings WHERE key = 'signup.mode'")?.value;
  return (SIGNUP_MODES as string[]).includes(v ?? '') ? (v as SignupMode) : 'approval';
}
export function setSignupMode(mode: SignupMode, by: string): void {
  if (!SIGNUP_MODES.includes(mode)) throw new Error('Unknown sign-up mode.');
  run("INSERT INTO settings (key, value, updated_at, updated_by) VALUES ('signup.mode', ?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at, updated_by = excluded.updated_by", mode, nowIso(), by);
}
const MAX_PENDING = 50;
/** Registers a viewer. In "approval" mode the account waits (it cannot sign in yet); in "open" mode it is active at once. */
export function signup(username: string, displayName: string, password: string): { status: 'pending' | 'active'; user: User } {
  const mode = signupMode();
  if (mode === 'off') throw Object.assign(new Error('Creating an account from this page is switched off. Ask an administrator to add you.'), { status: 403 });
  if (setupRequired()) throw Object.assign(new Error('The platform has no administrator yet; finish the first-run setup first.'), { status: 409 });
  if (mode === 'approval' && Number(get<{ n: number }>('SELECT COUNT(*) AS n FROM users WHERE pending = 1')?.n ?? 0) >= MAX_PENDING) throw Object.assign(new Error('Too many requests are waiting for approval. Ask an administrator.'), { status: 429 });
  const u = createUser(username, displayName, 'viewer', password);
  if (mode === 'approval') { run('UPDATE users SET disabled = 1, pending = 1 WHERE id = ?', u.id); directoryChanged(); return { status: 'pending', user: u }; }
  return { status: 'active', user: u };
}
/** True when the user name and password are right but the account has not been approved yet (so the page can say so instead of "wrong password"). */
export function isPending(username: string, password: string): boolean {
  const r = get<Record<string, unknown>>('SELECT * FROM users WHERE username = ? AND pending = 1', String(username ?? ''));
  return !!r && checkPassword(String(password ?? ''), String(r['pass_salt']), String(r['pass_hash']));
}
export function approveUser(id: number, role: Role): void {
  if (!ROLES.includes(role)) throw new Error('Unknown role.');
  if (!get('SELECT 1 FROM users WHERE id = ? AND pending = 1', id)) throw new Error('That account is not waiting for approval.');
  run('UPDATE users SET pending = 0, disabled = 0, role = ? WHERE id = ?', role, id);
  directoryChanged();
}
/** Turns a request down by removing it (only a pending request can be rejected this way). */
export function rejectUser(id: number): void {
  if (!get('SELECT 1 FROM users WHERE id = ? AND pending = 1', id)) throw new Error('That account is not waiting for approval.');
  run('DELETE FROM users WHERE id = ? AND pending = 1', id);
  directoryChanged();
}
