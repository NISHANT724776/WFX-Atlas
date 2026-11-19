// The knowledge server: one Node.js process, no framework. Serves /api/v2/* and the built Angular site.
//   node --disable-warning=ExperimentalWarning backend/src/server.ts
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { settings } from './config.ts';
import { db } from './db.ts';
import { routes } from './api.ts';
import type { Ctx } from './api.ts';
import { syncAdminDirectory } from './admin/directory.ts';
import { syncRegistry } from './registry/registry.ts';
import { syncSalesMasters } from './sales/masters.ts';
import { issueSetupToken, sessionUser, setupRequired } from './auth.ts';
import { indexLibrary } from './index/indexer.ts';
import { readRegistry, reindexDocuments } from './ingest/pipeline.ts';
import { inside, log } from './util.ts';
import { get } from './db.ts';

const S = settings();
const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.csv': 'text/csv; charset=utf-8', '.webmanifest': 'application/manifest+json', '.wasm': 'application/wasm',
};

function securityHeaders(res: http.ServerResponse, csp: string): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', csp);
}
const API_CSP = "default-src 'none'; frame-ancestors 'none'";

/** CSP for an HTML page: scripts only from this origin, plus the exact inline scripts of this page (by hash). */
function pageCsp(html: string): string {
  const hash = (s: string) => `'sha256-${createHash('sha256').update(s).digest('base64')}'`;
  const hashes = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => hash(m[1]));
  // Angular loads its stylesheet with onload="this.media='all'": allow exactly the handlers present in this page
  const handlers = [...new Set([...html.matchAll(/\son[a-z]+="([^"]*)"/gi)].map((m) => m[1].replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&')))].map(hash);
  return ["default-src 'self'", `script-src 'self' 'wasm-unsafe-eval' ${hashes.join(' ')}${handlers.length ? ` 'unsafe-hashes' ${handlers.join(' ')}` : ''}`.trim(), "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'"].join('; ');
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse, urlPath: string): void {
  let rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  let file: string;
  try { file = inside(S.dist, rel || 'index.html'); } catch { res.writeHead(400).end(); return; }
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
  if (!fs.existsSync(file)) {
    // client-side routes: the Angular shell renders them
    const shell = ['index.csr.html', 'index.html'].map((f) => path.join(S.dist, f)).find((f) => fs.existsSync(f));
    if (!path.extname(rel) && shell) file = shell;
    else {
      const nf = path.join(S.dist, '404.html');
      securityHeaders(res, API_CSP);
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(fs.existsSync(nf) ? fs.readFileSync(nf) : 'Not found');
      return;
    }
  }
  const ext = path.extname(file).toLowerCase();
  const body = fs.readFileSync(file);
  const isHtml = ext === '.html';
  securityHeaders(res, isHtml ? pageCsp(body.toString('utf8')) : API_CSP);
  res.setHeader('Content-Type', TYPES[ext] ?? 'application/octet-stream');
  res.setHeader('Cache-Control', isHtml ? 'no-cache' : /-[A-Z0-9]{8}\.(js|css)$/.test(file) ? 'public, max-age=31536000, immutable' : 'public, max-age=3600');
  res.writeHead(200).end(req.method === 'HEAD' ? undefined : body);
}

function cookie(req: http.IncomingMessage, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

async function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > limit) throw Object.assign(new Error(`The request is larger than ${Math.round(limit / 1048576)} MB.`), { status: 413 });
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

export function createServer(): http.Server {
  return http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ip = (req.socket.remoteAddress ?? '').replace(/^::ffff:/, '');
    try {
      if (!url.pathname.startsWith('/api/v2/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
        serveStatic(req, res, url.pathname);
        return;
      }
      securityHeaders(res, API_CSP);
      res.setHeader('Cache-Control', 'no-store');
      const method = req.method ?? 'GET';
      // cross-site request protection for anything that changes data
      if (method !== 'GET' && method !== 'HEAD') {
        if (req.headers['x-requested-with'] !== 'wfx') { send(res, 403, { error: 'Missing X-Requested-With header.' }); return; }
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) { send(res, 403, { error: 'Cross-origin request refused.' }); return; }
      }
      const route = routes.find((r) => r.method === method && r.re.test(url.pathname));
      if (!route) { send(res, 404, { error: 'Unknown API route.' }); return; }
      const params = route.re.exec(url.pathname)!.groups ?? {};
      const token = cookie(req, 'wfx_session');
      const user = sessionUser(token);
      if (route.auth !== 'public' && !user) { send(res, 401, { error: 'Sign in first.' }); return; }
      if (route.auth !== 'public' && route.auth !== 'user' && user && !route.auth.includes(user.role)) { send(res, 403, { error: 'Your role does not allow this.' }); return; }
      const raw = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(req, route.upload ? S.maxUploadBytes : 2 * 1024 * 1024);
      let body: Record<string, unknown> = {};
      if (!route.upload && raw.length) {
        try { body = JSON.parse(raw.toString('utf8')) as Record<string, unknown>; } catch { send(res, 400, { error: 'Send a JSON body.' }); return; }
        if (!body || typeof body !== 'object' || Array.isArray(body)) { send(res, 400, { error: 'Send a JSON object.' }); return; }
      }
      const ctx: Ctx = { req, res, url, params, user, token, ip, body, raw, ua: String(req.headers['user-agent'] ?? '') };
      const out = await route.handler(ctx);
      if (res.headersSent || res.writableEnded) return;
      // file downloads are marked explicitly: { download: Buffer, name, type }
      if (out && typeof out === 'object' && 'download' in out && Buffer.isBuffer((out as { download: unknown }).download)) {
        const f = out as { download: Buffer; name: string; type: string; inline?: boolean };
        res.setHeader('Content-Type', f.type);
        res.setHeader('Content-Disposition', `${f.inline ? 'inline' : 'attachment'}; filename="${f.name.replace(/[^\w.\- ()]/g, '_')}"`);
        res.writeHead(200).end(f.download);
        return;
      }
      send(res, 200, out ?? { ok: true });
    } catch (e) {
      const err = e as Error & { status?: number };
      const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
      if (status >= 500) log('error', 'request failed', { path: url.pathname, error: err.message, stack: err.stack?.split('\n').slice(0, 4).join(' | ') });
      if (!res.headersSent) send(res, status, { error: status >= 500 ? 'Something went wrong on the server. The error was logged.' : err.message });
    } finally {
      if (url.pathname.startsWith('/api/')) log('info', 'request', { method: req.method, path: url.pathname, status: res.statusCode, ms: Date.now() - started });
    }
  });
}

function send(res: http.ServerResponse, status: number, data: unknown): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.writeHead(status).end(JSON.stringify(data));
}

// ── start ───────────────────────────────────────────────────────────────
const isMain = !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const envFile = path.resolve(import.meta.dirname, '..', '..', '.env');
  if (fs.existsSync(envFile)) { process.loadEnvFile(envFile); log('info', 'settings read from .env', { keys: Object.keys(process.env).filter((k) => /^(ANTHROPIC|AI_|GEMINI|WFX_)/.test(k)).map((k) => k) }); }
  db();
  if (!get('SELECT 1 FROM entries LIMIT 1')) {
    const r = indexLibrary();
    log('info', 'index built from the knowledge folder', { entries: r.entries, chunks: r.chunks });
  }
  // the readable list of users (knowledge/admin/users.txt) and its admin-only passages follow the accounts table
  try { const r = syncRegistry(); if (r.problems.length) log('warn', 'registry problems', { problems: r.problems }); } catch (e) { log('error', 'registry not indexed', { error: (e as Error).message }); }
  try { syncSalesMasters(); } catch (e) { log('error', 'sales order masters not loaded', { error: (e as Error).message }); }
  try { syncAdminDirectory(); } catch (e) { log('error', 'admin directory not written', { error: (e as Error).message }); }
  if (!get('SELECT 1 FROM documents LIMIT 1') && readRegistry().documents.length) {
    const d = await reindexDocuments();
    log('info', 'documents indexed from the registry', d);
  }
  const server = createServer();
  server.listen(S.port, S.host, () => {
    console.log(`\nWFX knowledge server: http://${S.host === '0.0.0.0' ? 'localhost' : S.host}:${S.port}/`);
    if (!fs.existsSync(S.dist)) console.log('  The site is not built yet: run "npm run build" for the pages (the API works without it).');
    if (setupRequired()) {
      const t = issueSetupToken();
      console.log(`\n  FIRST START: open http://localhost:${S.port}/login and create the admin account with this one-time setup token:\n\n      ${t}\n\n  (The token is shown only here, in this console.)\n`);
    }
  });
  const stop = () => { server.close(); process.exit(0); };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}
