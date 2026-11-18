// Screen & workflow registry and visual guides. Kept apart from the business knowledge (Layer B entries) on purpose:
//   knowledge/registry/screens.txt   – Screen Registry: screens, platform pages and verified outside links (the ONLY navigable targets)
//   knowledge/registry/guides/*.txt  – visual guides: steps with real screenshots and click markers
//   knowledge/registry/assets/       – the screenshots of those guides
// Workflows stay in the knowledge library (WORKFLOW entries); procedures (PROCEDURE entries with STEPS) become guides on
// request. The files are the source of truth; reg_screens / reg_guides index them and are rebuilt by syncRegistry().
import fs from 'node:fs';
import path from 'node:path';
import { atLeast } from '../auth.ts';
import type { Role, User } from '../auth.ts';
import { settings } from '../config.ts';
import { all, get, run, tx } from '../db.ts';
import { getEntry } from '../knowledge/repo.ts';
import { normalize, stem, STOP } from '../search/lexicon.ts';

export interface RegEntry { id: string; fields: Record<string, string> }
export interface Marker { x: number; y: number; w: number; h: number; label: string }
export interface GuideStep { n: number; title: string; text: string; image: string | null; markers: Marker[]; result: string; where: string }
export interface Guide {
  id: string; title: string; kind: 'prototype' | 'procedure' | 'erp'; module: string; summary: string; changes: string[]; dataNote: string;
  prototypeUrl: string | null; screenId: string | null; workflowId: string | null; source: string; status: string; captured: string; steps: GuideStep[]; missing: string[];
}
export interface Screen {
  id: string; name: string; module: string; menuPath: string; purpose: string; route: string; query: Record<string, string>; url: string; wfxUrl: string;
  theoryRoute: string; workflowIds: string[]; workflowPages: string[]; screenshots: string[]; requiredRole: Role; keywords: string; relatedGuides: string[]; source: string;
}
export interface NavAction { id: string; label: string; kind: 'route' | 'external'; route?: string; query?: Record<string, string>; url?: string; allowed: boolean; reason?: string; note?: string }

const ID_LINE = /^(SCREEN ID|GUIDE ID):\s*(.+)$/;
const KEY = /^([A-Z][A-Z0-9 /&()'.,+-]*?)\s*:(?:[ \t](.*))?$/;

/** Same readable format as the knowledge files: "KEY: value", continuation lines indented by two spaces, "=====" between entries, "#" comments. */
export function parseRegistryText(text: string): RegEntry[] {
  const out: RegEntry[] = [];
  let cur: RegEntry | null = null; let key = '';
  for (const raw of text.replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n')) {
    if (/^#/.test(raw) || /^={5,}\s*$/.test(raw)) { key = ''; continue; }
    if (/^ {2}/.test(raw) && cur && key) { cur.fields[key] += (cur.fields[key] ? '\n' : '') + raw.slice(2); continue; }
    const idm = ID_LINE.exec(raw);
    if (idm) { cur = { id: idm[2].trim(), fields: { [idm[1]]: idm[2].trim() } }; out.push(cur); key = idm[1]; continue; }
    const m = KEY.exec(raw);
    if (m && cur) { key = m[1]; cur.fields[key] = (m[2] ?? '').trim(); }
  }
  return out;
}

export function serializeRegistry(entries: RegEntry[], header: string[] = []): string {
  const ind = (v: string) => v.replace(/\n/g, '\n  ');
  return [...header.map((h) => `# ${h}`), ...entries.map((e) => ['='.repeat(80), ...Object.entries(e.fields).map(([k, v]) => `${k}: ${ind(v)}`)].join('\n')), ''].join('\n');
}

const regDir = () => path.join(settings().knowledge, 'registry');
const list = (v: string | undefined) => (v ?? '').split(/,\s*/).map((x) => x.trim()).filter(Boolean);
const ROLE_OK = new Set(['viewer', 'editor', 'approver', 'admin']);

function toScreen(e: RegEntry): Screen {
  const f = e.fields;
  const query = Object.fromEntries(list(f['ROUTE QUERY']?.replace(/&/g, ',')).map((p) => p.split('=') as [string, string]).filter((p) => p.length === 2));
  return {
    id: e.id, name: f['SCREEN NAME'] ?? e.id, module: f['MODULE'] ?? '', menuPath: f['WFX MENU PATH'] ?? '', purpose: f['PURPOSE'] ?? '', route: f['APP ROUTE'] ?? '', query,
    url: f['EXTERNAL URL'] ?? '', wfxUrl: f['WFX URL'] ?? '', theoryRoute: f['THEORY ROUTE'] ?? '', workflowIds: list(f['RELATED WORKFLOWS']), workflowPages: list(f['WORKFLOW PAGES']),
    screenshots: list(f['SCREENSHOTS']), requiredRole: (ROLE_OK.has(f['REQUIRED ROLE'] ?? '') ? f['REQUIRED ROLE'] : 'viewer') as Role, keywords: f['KEYWORDS'] ?? '',
    relatedGuides: list(f['RELATED GUIDES']), source: f['SOURCE'] ?? '',
  };
}

function parseMarkers(v: string | undefined): Marker[] {
  return (v ?? '').split(/\s*;\s*/).filter(Boolean).map((m) => {
    const [box, label] = m.split('|');
    const [x, y, w, h] = box.split(',').map(Number);
    return { x, y, w, h, label: (label ?? '').trim() };
  }).filter((m) => [m.x, m.y, m.w, m.h].every(Number.isFinite));
}

function toGuide(e: RegEntry, file: string): Guide {
  const f = e.fields;
  const nums = [...new Set(Object.keys(f).map((k) => /^STEP (\d+) /.exec(k)?.[1]).filter(Boolean).map(Number))].sort((a, b) => a - b);
  const steps: GuideStep[] = nums.map((n) => ({
    n, title: f[`STEP ${n} TITLE`] ?? `Step ${n}`, text: f[`STEP ${n} TEXT`] ?? '', image: f[`STEP ${n} IMAGE`] ? `/api/v2/chat/assets/${f[`STEP ${n} IMAGE`]}` : null,
    markers: parseMarkers(f[`STEP ${n} MARKERS`]), result: f[`STEP ${n} RESULT`] ?? '', where: f[`STEP ${n} WHERE`] ?? '',
  }));
  // the expected result of a prototype step is the screen the next step starts from
  steps.forEach((s, i) => { if (!s.result && steps[i + 1]) s.result = `Next screen: ${steps[i + 1].title}.`; });
  return {
    id: e.id, title: f['TITLE'] ?? e.id, kind: (f['KIND'] === 'prototype' ? 'prototype' : 'erp'), module: f['MODULE'] ?? '', summary: f['SUMMARY'] ?? '',
    changes: (f['WHAT CHANGES'] ?? '').split('\n').map((x) => x.replace(/^•\s*/, '').trim()).filter(Boolean), dataNote: f['DATA NOTE'] ?? '',
    prototypeUrl: f['PROTOTYPE URL'] || null, screenId: f['RELATED SCREEN'] || null, workflowId: f['RELATED WORKFLOW'] || null, source: f['SOURCE'] ?? file,
    status: f['STATUS'] ?? 'Draft', captured: f['CAPTURED'] ?? '', steps, missing: [],
  };
}

/** Rebuilds the registry index from the files. Returns counts and the problems found (unknown routes are refused here). */
export function syncRegistry(appRoutes: string[] = APP_ROUTES): { screens: number; guides: number; problems: string[] } {
  const problems: string[] = [];
  const dir = regDir();
  const screens = fs.existsSync(path.join(dir, 'screens.txt')) ? parseRegistryText(fs.readFileSync(path.join(dir, 'screens.txt'), 'utf8')).map(toScreen) : [];
  const guides: Guide[] = [];
  const gdir = path.join(dir, 'guides');
  if (fs.existsSync(gdir)) for (const f of fs.readdirSync(gdir).filter((x) => x.endsWith('.txt')).sort()) {
    for (const e of parseRegistryText(fs.readFileSync(path.join(gdir, f), 'utf8'))) guides.push(toGuide(e, `registry/guides/${f}`));
  }
  for (const s of screens) {
    if (s.route && !routeKnown(s.route, appRoutes)) problems.push(`${s.id}: APP ROUTE "${s.route}" is not a page of this platform; it will not be linked.`);
    if (s.url && !/^https:\/\//.test(s.url)) problems.push(`${s.id}: EXTERNAL URL must start with https://.`);
  }
  tx(() => {
    run('DELETE FROM reg_screens'); run('DELETE FROM reg_guides');
    for (const s of screens) run('INSERT OR REPLACE INTO reg_screens (id, name, module, route, query, url, required_role, keywords, fields) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      s.id, s.name, s.module, s.route && routeKnown(s.route, appRoutes) ? s.route : '', JSON.stringify(s.query), s.url, s.requiredRole, s.keywords, JSON.stringify(s));
    for (const g of guides) run('INSERT OR REPLACE INTO reg_guides (id, title, kind, module, keywords, screen_id, workflow_id, file, data) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      g.id, g.title, g.kind, g.module, guideKeywords(g), g.screenId, g.workflowId, g.source, JSON.stringify(g));
  });
  return { screens: screens.length, guides: guides.length, problems };
}

function guideKeywords(g: Guide): string { return `${g.title} ${g.module} ${g.summary.slice(0, 200)} ${g.steps.map((s) => s.title).join(' ')}`; }

/** Pages of this platform (Angular routes); a registry route must start with one of them. */
export const APP_ROUTES = ['/', '/workflows', '/data-model', '/data', '/theory', '/calculations', '/glossary', '/assistant', '/dashboard', '/library', '/rulebook', '/transactions',
  '/calc-lab', '/ba-copilot', '/workflow-designer', '/data-modelling', '/profile', '/admin', '/color-cards'];
const routeKnown = (r: string, routes: string[]) => routes.some((x) => r === x || (x !== '/' && r.startsWith(`${x}/`)));

export function listScreens(): Screen[] { return all<{ fields: string }>('SELECT fields FROM reg_screens ORDER BY module, name').map((r) => JSON.parse(r.fields) as Screen); }
export function getScreen(id: string): Screen | null { const r = get<{ fields: string }>('SELECT fields FROM reg_screens WHERE id = ?', id); return r ? JSON.parse(r.fields) as Screen : null; }
export function listGuides(): { id: string; title: string; kind: string; module: string; steps: number }[] {
  return all<{ id: string; title: string; kind: string; module: string; data: string }>('SELECT id, title, kind, module, data FROM reg_guides ORDER BY title').map((r) => ({ id: r.id, title: r.title, kind: r.kind, module: r.module, steps: (JSON.parse(r.data) as Guide).steps.length }));
}

/** A stored guide, or a guide built from a documented PROCEDURE (GUIDE-PROC-<procedure id>): its steps, the WFX menu path and any real screenshot of that screen. */
export function getGuide(id: string): Guide | null {
  const r = get<{ data: string }>('SELECT data FROM reg_guides WHERE id = ?', id);
  if (r) return JSON.parse(r.data) as Guide;
  const m = /^GUIDE-PROC-(.+)$/.exec(id);
  return m ? procedureGuide(m[1]) : null;
}

function procedureGuide(procId: string): Guide | null {
  const e = getEntry(procId);
  if (!e || e.type !== 'procedure') return null;
  const f = e.fields;
  const lines = (f['STEPS'] ?? '').split('\n').map((l) => l.replace(/^\s*\d+[.)]\s*/, '').trim()).filter(Boolean);
  if (!lines.length) return null;
  const where = f['WHERE IN WFX'] ?? '';
  const screen = where ? screenForPath(where) : null;
  const shots = screen?.screenshots ?? [];
  const steps: GuideStep[] = lines.map((t, i) => ({ n: i + 1, title: t.length > 70 ? `${t.slice(0, 67).replace(/\s+\S*$/, '')}…` : t, text: t, image: null, markers: [], result: '', where: i === 0 ? where : '' }));
  // a real screenshot of the screen is shown on the step that works on it; never a picture of another screen
  if (shots[0]) steps[Math.min(1, steps.length - 1)].image = shots[0];
  const missing: string[] = [];
  if (!shots.length) missing.push(`No screenshot of "${where || f['TITLE']}" has been captured yet, so the steps are shown as text.`);
  missing.push('Click positions on WFX screens are not recorded yet: the steps name the field or button instead of pointing at it.');
  return {
    id: `GUIDE-PROC-${procId}`, title: f['TITLE'] ?? procId, kind: 'procedure', module: f['MODULE'] ?? '', summary: f['CONTENT'] ?? '', changes: [], dataNote: '',
    prototypeUrl: null, screenId: screen?.id ?? null, workflowId: null, source: `${procId} v${e.version} (${e.status}) · ${f['SOURCE DOCUMENT'] ?? f['SOURCE'] ?? ''}`, status: e.status, captured: '', steps, missing,
  };
}

/** The registered screen whose WFX menu path best matches a written path ("Sourcing > My Purchase Order > …"). */
export function screenForPath(where: string): Screen | null {
  const w = new Set(words(where));
  let best: Screen | null = null; let score = 0;
  for (const s of listScreens()) {
    if (!s.menuPath) continue;
    const sw = words(s.menuPath);
    const hit = sw.filter((x) => w.has(x)).length / Math.max(sw.length, 1);
    if (hit > score) { score = hit; best = s; }
  }
  return score >= 0.6 ? best : null;
}

const words = (t: string) => normalize(t).split(' ').filter((x) => x.length > 1 && !STOP.has(x)).map(stem);

/** Registered destinations and guides that match a question. Scores are word overlap with names and keywords; nothing is guessed. */
export function findForQuestion(q: string): { screens: { s: Screen; score: number }[]; guides: { id: string; title: string; kind: string; score: number }[] } {
  const qw = new Set(words(q));
  if (!qw.size) return { screens: [], guides: [] };
  const score = (name: string, kw: string) => {
    const nw = words(name); const kws = new Set(words(kw));
    const nameHit = nw.filter((x) => qw.has(x)).length / Math.max(nw.length, 1);
    const kwHit = [...qw].filter((x) => kws.has(x)).length / qw.size;
    return nameHit * 0.7 + kwHit * 0.5;
  };
  const screens = listScreens().map((s) => ({ s, score: score(s.name, `${s.keywords} ${s.module}`) })).filter((x) => x.score >= 0.45).sort((a, b) => b.score - a.score).slice(0, 4);
  const guides = all<{ id: string; title: string; kind: string; keywords: string }>('SELECT id, title, kind, keywords FROM reg_guides')
    .map((g) => ({ id: g.id, title: g.title, kind: g.kind, score: score(g.title, g.keywords) })).filter((x) => x.score >= 0.3).sort((a, b) => b.score - a.score).slice(0, 6);
  return { screens, guides };
}

/** Resolves a registered destination for this user. Unregistered ids and unknown routes never resolve. */
export function resolveNavigation(id: string, user: User | null): NavAction | null {
  const s = getScreen(id);
  if (s) {
    const allowed = !!user && atLeast(user, s.requiredRole);
    const reason = !user ? 'Sign in first.' : allowed ? undefined : `This page needs the ${s.requiredRole} role; your role is ${user.role}.`;
    if (s.url) return { id, label: `Open ${s.name}`, kind: 'external', url: s.url, allowed, reason, note: s.module.includes('Trims') ? 'Clickable prototype with sample data, not a live WFX transaction.' : undefined };
    const route = get<{ route: string }>('SELECT route FROM reg_screens WHERE id = ?', id)?.route ?? '';
    if (!route) return null;
    return { id, label: `Open ${s.name}`, kind: 'route', route, query: s.query, allowed, reason, note: s.menuPath ? `In WFX: ${s.menuPath}` : undefined };
  }
  const wf = /^WF-[A-Z0-9-]+$/.test(id) ? getEntry(id) : null;
  if (wf && wf.type === 'workflow') return { id, label: `View workflow: ${wf.title}`, kind: 'route', route: '/workflow-designer', query: { id }, allowed: !!user, reason: user ? undefined : 'Sign in first.' };
  const g = /^GUIDE-/.test(id) ? getGuide(id) : null;
  if (g) return { id, label: `Step-by-step guide: ${g.title}`, kind: 'route', route: '/assistant', query: { guide: id }, allowed: !!user, reason: user ? undefined : 'Sign in first.' };
  return null;
}

/** Absolute path of a guide asset, refusing anything outside knowledge/registry/assets. */
export function assetFile(rel: string): string | null {
  const base = path.join(regDir(), 'assets');
  const full = path.resolve(base, rel);
  if (!full.startsWith(base + path.sep) || !/\.(webp|png|jpe?g)$/i.test(full) || !fs.existsSync(full)) return null;
  return full;
}
