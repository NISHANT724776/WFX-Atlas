// Runs the knowledge-platform test suites with Node's built-in test runner (each file in its own process).
//   node tests/run.mjs [folder or file filter]
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const filter = process.argv[2] ?? '';
const files = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else if (e.name.endsWith('.test.ts') && f.includes(filter)) files.push(f); } };
walk(root);
if (!files.length) { console.log('No test files matched.'); process.exit(1); }
const r = spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', '--test', '--test-reporter=spec', ...files], { stdio: 'inherit', env: { ...process.env, WFX_QUIET: '1' } });
process.exit(r.status ?? 1);
