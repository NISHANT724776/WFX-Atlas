// Checks how well the assistant answers messy, real-world questions. Run: npm run build && npm run test:ask
// Hand-written questions must all be right; every guide asked in three other ways must be at least 90 % right.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '');
const dir = mkdtempSync(join(tmpdir(), 'wfx-ask-'));
const out = join(dir, 'harness.mjs');
await build({ entryPoints: [join(root, 'scripts', 'ask-harness.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning', external: ['sql.js'], banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" } });
// sql.js is resolved from the project's node_modules
const file = join(root, 'scripts', '.ask-harness.mjs');
await (await import('node:fs/promises')).copyFile(out, file);
let code = 0;
try {
  execFileSync(process.execPath, [file, root], { stdio: 'inherit', env: process.env });
} catch (e) {
  code = e.status ?? 1;
} finally {
  rmSync(file, { force: true });
  rmSync(dir, { recursive: true, force: true });
}
process.exit(code);
