import { Injectable, PLATFORM_ID, computed, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

// ── shapes returned by the knowledge server (/api/v2) ────────────────────
export type KStatus = 'confirmed' | 'documented' | 'provisional' | 'conflicting' | 'partial' | 'not-documented' | 'conversation';
export interface KbUser { id: number; username: string; displayName: string; role: 'admin' | 'approver' | 'editor' | 'viewer' }
export interface KbCalc { ruleId: string; version: number; formula: string; inputs: { label: string; value: number; defaulted: boolean }[]; steps: string[]; output: string; result: number | null; warnings: string[]; errors: string[]; source: string }
export interface KbSection { extra?: boolean; kind: string; title: string; text?: string; items?: string[]; table?: { columns: string[]; rows: string[][] }; mermaid?: string; json?: { nodes?: { id: string; label: string }[]; edges?: { from: string; to: string }[] }; refs?: number[]; calc?: KbCalc }
export interface KbSource { n: number; ref: string; title: string; kind: string; status: string; label: string; entryId: string | null; entryVersion: number | null; docId: string | null; docVersion: number | null; locator: string | null; origin: string; confirmed: boolean }
export interface KbAnswer {
  question: string; resolvedQuestion: string; intent: string; mode: string; title: string; status: KStatus; statusNote: string;
  sections: KbSection[]; sources: KbSource[]; missing: string[]; followUps: string[]; generatedBy: string; markdown: string; corrections: Record<string, string>;
  proposal?: { draftText: string; suggestedFile: string; correctionOf: string | null; id: string };
  /** What the page does after showing this answer: open the workflow designer on a generated draft, or offer a retry. */
  action?: KbAction;
  /** Visual guides (real screenshots, steps, markers), loaded by id. */
  cards?: { type: 'guide'; id: string; title: string; kind: string; steps: number; cover: string | null; note?: string }[];
  /** Registered destinations only, permission already checked by the server. */
  actions?: KbNavAction[];
  /** A destination to open at once (the user asked to open a screen). */
  navigate?: string;
}
export interface KbNavAction { id: string; label: string; kind: 'route' | 'external'; route?: string; query?: Record<string, string>; url?: string; allowed: boolean; reason?: string; note?: string; primary?: boolean }
export interface KbGuideStep { n: number; title: string; text: string; image: string | null; markers: { x: number; y: number; w: number; h: number; label: string }[]; result: string; where: string }
export interface KbGuide { id: string; title: string; kind: 'prototype' | 'procedure' | 'erp'; module: string; summary: string; changes: string[]; dataNote: string; prototypeUrl: string | null; screenId: string | null; source: string; status: string; captured: string; steps: KbGuideStep[]; missing: string[] }
export type KbAction =
  | { type: 'open-workflow'; draftId: string; title: string; path: string; conversationId: string | null }
  | { type: 'workflow-failed'; draftId: string; error: string; request: string };
export interface KbMessage { id: number; role: 'user' | 'assistant'; content: string; answer: KbAnswer | null; createdAt: string }
export interface KbEntry { id: string; type: string; version: number; status: string; title: string; module: string | null; submodule: string | null; txn: string | null; category: string | null; file: string; isCurrent: boolean; updatedAt: string | null; order: string[]; fields: Record<string, string> }

export class KbError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

/**
 * Client of the knowledge server. On static hosting (no server) `available` stays false and the platform pages
 * explain how to start it; the v1 pages keep working without it.
 */
@Injectable({ providedIn: 'root' })
export class KbService {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  readonly state = signal<'unknown' | 'offline' | 'online'>('unknown');
  readonly user = signal<KbUser | null>(null);
  readonly setupRequired = signal(false);
  /** Who may create an account from the sign-in page: nobody, anybody after an admin approves, or anybody. */
  readonly signupMode = signal<'off' | 'approval' | 'open'>('off');
  readonly ai = signal<{ configured: boolean; active: boolean; providers: string[] }>({ configured: false, active: false, providers: [] });
  readonly available = computed(() => this.state() === 'online');
  private started: Promise<void> | null = null;

  /** Checks once whether the server is reachable and who is signed in. */
  init(): Promise<void> {
    if (!this.browser) return Promise.resolve();
    this.started ??= (async () => {
      try {
        const h = await this.get<{ ok: boolean; setupRequired: boolean; signup?: 'off' | 'approval' | 'open'; ai: { configured: boolean; active: boolean; providers: string[] } }>('/health');
        this.setupRequired.set(h.setupRequired);
        this.signupMode.set(h.signup ?? 'off');
        this.ai.set(h.ai);
        this.state.set('online');
        const me = await this.get<{ user: KbUser | null }>('/auth/me');
        this.user.set(me.user);
      } catch {
        this.state.set('offline');
      }
    })();
    return this.started;
  }

  can(role: KbUser['role']): boolean {
    const rank = { viewer: 0, editor: 1, approver: 2, admin: 3 };
    const u = this.user();
    return !!u && rank[u.role] >= rank[role];
  }

  async request<T>(method: string, path: string, body?: unknown, extra: { raw?: Blob; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
    const headers: Record<string, string> = { ...extra.headers };
    if (method !== 'GET') headers['X-Requested-With'] = 'wfx';
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`/api/v2${path}`, { method, credentials: 'same-origin', headers, body: extra.raw ?? (body !== undefined ? JSON.stringify(body) : undefined), signal: extra.signal });
    const type = res.headers.get('content-type') ?? '';
    if (!type.includes('json')) {
      if (!res.ok) throw new KbError(`The knowledge server answered ${res.status}.`, res.status);
      return (await res.blob()) as unknown as T;
    }
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401) this.user.set(null);
      throw new KbError(data?.error ?? `The knowledge server answered ${res.status}.`, res.status);
    }
    return data as T;
  }
  get<T>(path: string): Promise<T> { return this.request<T>('GET', path); }
  post<T>(path: string, body: unknown = {}, signal?: AbortSignal): Promise<T> { return this.request<T>('POST', path, body, { signal }); }
  patch<T>(path: string, body: unknown = {}): Promise<T> { return this.request<T>('PATCH', path, body); }

  async login(username: string, password: string): Promise<void> {
    const r = await this.post<{ user: KbUser }>('/auth/login', { username, password });
    this.user.set(r.user);
  }
  async setup(token: string, username: string, displayName: string, password: string): Promise<void> {
    await this.post('/auth/setup', { token, username, displayName, password });
    this.setupRequired.set(false);
    await this.login(username, password);
  }
  /** Creates a viewer account. Returns "pending" when an administrator has to approve it first, "active" when the user is signed in now. */
  async signup(username: string, displayName: string, password: string): Promise<'pending' | 'active'> {
    const r = await this.post<{ status: 'pending' | 'active'; user: KbUser | null }>('/auth/signup', { username, displayName, password });
    if (r.status === 'active' && r.user) this.user.set(r.user);
    return r.status;
  }
  async logout(): Promise<void> {
    await this.post('/auth/logout');
    this.user.set(null);
  }

  /** Uploads one file (raw body; the server never trusts the browser's type). */
  upload(file: File, opts: { knowledgeStatus: string; docType?: string; module?: string; versionOf?: string }) {
    const q = new URLSearchParams({ knowledgeStatus: opts.knowledgeStatus, ...(opts.docType ? { docType: opts.docType } : {}), ...(opts.module ? { module: opts.module } : {}), ...(opts.versionOf ? { versionOf: opts.versionOf } : {}) });
    return this.request<{ status: string; documentId?: string; version?: number; message: string }>('POST', `/documents?${q}`, undefined, { raw: file, headers: { 'X-File-Name': encodeURIComponent(file.name) } });
  }

  /** Saves a server response (Blob) as a file in the browser. */
  async download(path: string, name: string): Promise<void> {
    const blob = await this.request<Blob>('GET', path);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
}
