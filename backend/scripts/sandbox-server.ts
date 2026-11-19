// A throw-away instance for trying the platform without touching the real knowledge folder or database:
// copies knowledge/ (without the original files) and uses a new database in the system temp folder, with a test admin.
//   node --disable-warning=ExperimentalWarning backend/scripts/sandbox-server.ts   (port 8788)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT } from '../src/config.ts';

const dir = path.join(os.tmpdir(), 'wfx-sandbox');
fs.rmSync(dir, { recursive: true, force: true });
const copy = (src: string, dst: string) => {
  fs.mkdirSync(dst, { recursive: true });
  for (const d of fs.readdirSync(src, { withFileTypes: true })) {
    if (d.name === 'original_sources') continue;
    const s = path.join(src, d.name), t = path.join(dst, d.name);
    if (d.isDirectory()) copy(s, t); else fs.copyFileSync(s, t);
  }
};
copy(path.join(ROOT, 'knowledge'), path.join(dir, 'knowledge'));
process.env['WFX_KNOWLEDGE_DIR'] = path.join(dir, 'knowledge');
process.env['WFX_DB_FILE'] = path.join(dir, 'sandbox.db');
process.env['WFX_PORT'] ??= '8788';

const { indexLibrary } = await import('../src/index/indexer.ts');
const { reindexDocuments } = await import('../src/ingest/pipeline.ts');
const { createUser } = await import('../src/auth.ts');
const { createServer } = await import('../src/server.ts');
indexLibrary();
await reindexDocuments();
(await import('../src/registry/registry.ts')).syncRegistry();
(await import('../src/enrich/review.ts')).refresh();
(await import('../src/sales/masters.ts')).syncSalesMasters();
const password = `Sandbox-${randomBytes(6).toString('hex')}`;
createUser('sandbox-admin', 'Sandbox Admin', 'admin', password);
fs.writeFileSync(path.join(dir, 'TEST-CREDENTIALS.txt'), `Sandbox only (temporary copy, not the real knowledge base)\nuser: sandbox-admin\npassword: ${password}\n`);
const port = Number(process.env['WFX_PORT']);
createServer().listen(port, '127.0.0.1', () => console.log(`Sandbox knowledge server on http://127.0.0.1:${port}/ (data in ${dir}; test login in ${path.join(dir, 'TEST-CREDENTIALS.txt')})`));
