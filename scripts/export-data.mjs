// Bundles scripts/export-data.ts (and the site data it imports) with esbuild, then runs it.
// Writes public/data/** for the site and data/** at the project root for people who want the files.
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'wfx-export-'));
const out = join(dir, 'export.mjs');
await build({ entryPoints: [join(root, 'scripts', 'export-data.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
execFileSync(process.execPath, [out, join(root, 'public')], { stdio: 'inherit' });
rmSync(join(root, 'data'), { recursive: true, force: true });
cpSync(join(root, 'public', 'data'), join(root, 'data'), { recursive: true });
// Optional extra copy: set WFX_DATA_DIR to a folder on your machine (for example the ASN sub folder) and every build writes the CSV files there too.
if (process.env.WFX_DATA_DIR) {
  cpSync(join(root, 'public', 'data'), process.env.WFX_DATA_DIR, { recursive: true });
  console.log(`CSV files also copied to ${process.env.WFX_DATA_DIR}`);
}
rmSync(dir, { recursive: true, force: true });
