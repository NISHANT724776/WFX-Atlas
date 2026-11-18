// Paths and settings of the knowledge server. Read from the environment on every call, so tests can point the server at
// a temporary knowledge folder and database before they use it.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export interface Settings {
  root: string;
  knowledge: string;
  dbFile: string;
  migrations: string;
  dist: string;
  host: string;
  port: number;
  maxUploadBytes: number;
  sessionHours: number;
  /** true when served over HTTPS (Secure cookies). */
  secureCookies: boolean;
  env: Record<string, string | undefined>;
}

export function settings(): Settings {
  const e = process.env;
  return {
    root: ROOT,
    knowledge: e['WFX_KNOWLEDGE_DIR'] ? path.resolve(e['WFX_KNOWLEDGE_DIR']) : path.join(ROOT, 'knowledge'),
    dbFile: e['WFX_DB_FILE'] ? path.resolve(e['WFX_DB_FILE']) : path.join(ROOT, 'database', 'wfx_knowledge.db'),
    migrations: path.join(ROOT, 'database', 'migrations'),
    dist: e['WFX_DIST_DIR'] ? path.resolve(e['WFX_DIST_DIR']) : path.join(ROOT, 'dist', 'wfx-knowledge-hub', 'browser'),
    host: e['WFX_HOST'] || '127.0.0.1',
    port: Number(e['WFX_PORT'] || 8787),
    maxUploadBytes: Number(e['WFX_MAX_UPLOAD_MB'] || 25) * 1024 * 1024,
    sessionHours: Number(e['WFX_SESSION_HOURS'] || 12),
    secureCookies: e['WFX_SECURE_COOKIES'] === '1',
    env: e,
  };
}

/** Knowledge sub-folders (Layer A and B). */
export const KDIRS = {
  originals: 'original_sources',
  extracted: 'extracted',
  rules: 'business_rules',
  calcs: 'calculations',
  glossary: 'glossary',
  modules: 'modules',
  transactions: 'transactions',
  workflows: 'workflows',
  models: 'data_models',
  review: 'review',
  history: 'history',
  metadata: 'metadata',
} as const;

/** Folders that hold Layer B entry files. */
export const ENTRY_DIRS = [KDIRS.rules, KDIRS.calcs, KDIRS.glossary, KDIRS.modules, KDIRS.transactions, KDIRS.workflows, KDIRS.models, KDIRS.review];
