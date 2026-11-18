// Writes sitemap.xml, robots.txt and llms.txt into public/ from the route catalogue.
// Runs automatically before every build (npm "prebuild").
import { writeFile } from 'node:fs/promises';
import { COLOR_CARDS, COLORS, FLOW_INDEX, SITE, STATIC_PAGES, TXN_INDEX } from '../src/app/data/catalog.ts';

const out = new URL('../public/', import.meta.url);
const today = new Date().toISOString().slice(0, 10);
const abs = (p) => SITE.url + (p === '/' ? '/' : p);

const urls = [
  ...STATIC_PAGES.map((p) => ({ loc: abs(p.path), priority: p.path === '/' ? '1.0' : '0.8' })),
  ...FLOW_INDEX.map((f) => ({ loc: abs(`/workflows/${f.slug}`), priority: '0.9' })),
  ...TXN_INDEX.map((t) => ({ loc: abs(`/theory/${t.slug}`), priority: '0.9' })),
  ...COLOR_CARDS.map((c) => ({ loc: abs(`/color-cards/${c.slug}`), priority: '0.7' })),
  ...COLORS.map((c) => ({ loc: abs(`/color-cards/${c.card}/${c.slug}`), priority: '0.6' })),
];

const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u.loc}</loc><lastmod>${today}</lastmod><priority>${u.priority}</priority></url>`).join('\n')}
</urlset>
`;

const robots = `User-agent: *
Allow: /
Disallow: /404

Sitemap: ${SITE.url}/sitemap.xml
`;

const llms = `# ${SITE.name}

> Knowledge base of WFX ERP transactions: definitions, keys, field sources, calculation formulas with worked examples, verification checks against the WFX screens, and cases. All examples are traced on apparel style NIS-58 (Flannel Shirt Adi, buyer GAP Kids) and fabric N-8.

There are three workflows: style setup, buyer block booking (BBB Adhoc Indent, raised manually) and sales order (MRP raises the Manufacture and Production Indents). They meet at the stock: fabric bought on the block booking is adjusted in-house by the sales-order Production Indent.
Formulas marked "To confirm" could not be proved by the sample data and carry an open question.

## Workflows

${FLOW_INDEX.map((f) => `- [${f.name}](${abs(`/workflows/${f.slug}`)}): ${f.description}`).join('\n')}

## Transactions (theory)

${TXN_INDEX.map((t) => `- [${t.name}](${abs(`/theory/${t.slug}`)}): ${t.description}`).join('\n')}

## Reference

${STATIC_PAGES.filter((p) => p.path !== '/').map((p) => `- [${p.title}](${abs(p.path)}): ${p.description}`).join('\n')}

## Colour tracking

${COLORS.map((c) => `- [${c.name} (${c.code})](${abs(`/color-cards/${c.card}/${c.slug}`)})`).join('\n')}
`;

await writeFile(new URL('sitemap.xml', out), sitemap);
await writeFile(new URL('robots.txt', out), robots);
await writeFile(new URL('llms.txt', out), llms);
console.log(`seo files written: ${urls.length} sitemap URLs`);
