// After the static build: publish the prerendered 404 page as /404.html (served by static hosts for
// unknown URLs) and fail the build if any page is missing its title, description, canonical or single H1.
import { copyFile, readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist/wfx-knowledge-hub/browser/', import.meta.url));
await copyFile(join(dist, '404', 'index.html'), join(dist, '404.html'));

async function* pages(dir) {
  for (const name of await readdir(dir)) {
    const p = join(dir, name);
    if ((await stat(p)).isDirectory()) yield* pages(p);
    else if (name.endsWith('.html') && name !== 'index.csr.html') yield p;
  }
}

const problems = [];
const titles = new Map();
let count = 0;
for await (const file of pages(dist)) {
  count++;
  const html = await readFile(file, 'utf8');
  const rel = file.slice(dist.length);
  const title = html.match(/<title>([^<]*)<\/title>/)?.[1] ?? '';
  const h1 = (html.match(/<h1[\s>]/g) ?? []).length;
  const noindex = /name="robots" content="noindex/.test(html);
  if (!title) problems.push(`${rel}: missing <title>`);
  if (!/name="description" content="[^"]+"/.test(html)) problems.push(`${rel}: missing meta description`);
  if (h1 !== 1) problems.push(`${rel}: ${h1} <h1> elements`);
  if (!noindex && !/rel="canonical"/.test(html)) problems.push(`${rel}: missing canonical`);
  if (!/application\/ld\+json/.test(html)) problems.push(`${rel}: missing structured data`);
  if (/<img(?![^>]*\balt=)[^>]*>/.test(html)) problems.push(`${rel}: <img> without alt`);
  if (/\bvite\b|\breact\b/i.test(title)) problems.push(`${rel}: framework name in title`);
  if (!noindex) {
    if (titles.has(title)) problems.push(`${rel}: duplicate title with ${titles.get(title)}`);
    titles.set(title, rel);
  }
}

if (problems.length) {
  console.error('SEO check failed:\n  ' + problems.join('\n  '));
  process.exit(1);
}
console.log(`postbuild: 404.html written, ${count} pages passed SEO checks`);
