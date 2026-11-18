// Generates favicon.svg, favicon.ico, apple-touch-icon.png, PWA icons and the 1200×630 social share image
// into public/. Run with: npm run assets
import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TXN_INDEX } from '../src/app/data/catalog.ts';

const out = new URL('../public/', import.meta.url);
const BRAND = '#1b1916';
const ACCENT = '#e0532b';
const PAPER = '#f3efe7';

const icon = (size, radius = 7) => `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32">
<rect width="32" height="32" rx="${radius}" fill="${BRAND}"/>
<path d="M7 10l3.2 12L13 14l3 8 3-8 2.8 8L25 10" fill="none" stroke="${PAPER}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="25" cy="10" r="2.2" fill="${ACCENT}"/>
</svg>`;

await writeFile(new URL('favicon.svg', out), icon(32));
await sharp(Buffer.from(icon(180, 0))).png().toFile(fileURLToPath(new URL('apple-touch-icon.png', out)));
await sharp(Buffer.from(icon(192))).png().toFile(fileURLToPath(new URL('icon-192.png', out)));
await sharp(Buffer.from(icon(512))).png().toFile(fileURLToPath(new URL('icon-512.png', out)));

// favicon.ico with embedded 16, 32 and 48 px PNGs
const sizes = [16, 32, 48];
const pngs = await Promise.all(sizes.map((s) => sharp(Buffer.from(icon(s))).png().toBuffer()));
const header = Buffer.alloc(6 + 16 * sizes.length);
header.writeUInt16LE(0, 0);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(sizes.length, 4);
let offset = header.length;
sizes.forEach((s, i) => {
  const e = 6 + i * 16;
  header.writeUInt8(s, e);
  header.writeUInt8(s, e + 1);
  header.writeUInt8(0, e + 2);
  header.writeUInt8(0, e + 3);
  header.writeUInt16LE(1, e + 4);
  header.writeUInt16LE(32, e + 6);
  header.writeUInt32LE(pngs[i].length, e + 8);
  header.writeUInt32LE(offset, e + 12);
  offset += pngs[i].length;
});
await writeFile(new URL('favicon.ico', out), Buffer.concat([header, ...pngs]));

// Social share image
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const steps = TXN_INDEX.map((t) => t.short);
const chips = steps.map((s, i) => {
  const col = i % 5, row = Math.floor(i / 5);
  const x = 80 + col * 212, y = 360 + row * 66;
  return `<g transform="translate(${x},${y})"><rect width="196" height="48" rx="12" fill="#ffffff" fill-opacity="0.12" stroke="#ffffff" stroke-opacity="0.35"/>
  <text x="14" y="30" font-size="18" fill="#ffffff" font-family="Segoe UI, Arial, sans-serif"><tspan font-weight="700">${i + 1}</tspan>  ${esc(s)}</text></g>`;
}).join('\n');
const og = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<rect width="1200" height="630" fill="${PAPER}"/>
<circle cx="1080" cy="80" r="190" fill="${ACCENT}" opacity="0.10"/>
<text x="80" y="110" font-size="30" fill="${BRAND}" font-family="Georgia, serif">WFX <tspan fill="${ACCENT}" font-style="italic">Knowledge Hub</tspan></text>
<text x="80" y="230" font-size="72" fill="${BRAND}" font-family="Georgia, serif">Every WFX transaction,</text>
<text x="80" y="315" font-size="72" fill="${ACCENT}" font-style="italic" font-family="Georgia, serif">explained <tspan fill="${BRAND}" font-style="normal">and connected.</tspan></text>
<g font-family="Segoe UI, Arial, sans-serif" font-size="22" fill="${BRAND}">
  <text x="80" y="430" font-weight="700">01  Style setup</text><text x="80" y="462" fill="#6d665b">Masters → Style → BOM → Costing</text>
  <text x="440" y="430" font-weight="700">02  Buyer Block Booking</text><text x="440" y="462" fill="#6d665b">BBB → Adhoc Indent → RMPO → GRN</text>
  <text x="820" y="430" font-weight="700">03  Sales Order</text><text x="820" y="462" fill="#6d665b">OC → MRP → Indents → FPO</text>
</g>
<line x1="80" y1="390" x2="1120" y2="390" stroke="${BRAND}" stroke-width="2"/>
<text x="80" y="560" font-size="20" fill="#6d665b" font-family="Segoe UI, Arial, sans-serif">Interactive workflows · precise theory · real NIS-58 numbers</text>
</svg>`;
await sharp(Buffer.from(og)).png().toFile(fileURLToPath(new URL('og-image.png', out)));

await writeFile(new URL('site.webmanifest', out), JSON.stringify({
  name: 'WFX Knowledge Hub',
  short_name: 'WFX Hub',
  start_url: '/',
  display: 'standalone',
  background_color: PAPER,
  theme_color: BRAND,
  icons: [
    { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
}, null, 2));

console.log('brand assets written to public/');

// Ink-splash mask for the theme transition: an irregular blot with splatter, centred in a 1000×1000 box.
{
  let seed = 58;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const pts = [];
  const N = 180;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 330 + 34 * Math.sin(a * 3 + 1) + 22 * Math.sin(a * 7 + 2) + 14 * Math.sin(a * 13) + (rnd() - 0.5) * 26 + (rnd() > 0.93 ? rnd() * 70 : 0);
    pts.push([500 + Math.cos(a) * r, 500 + Math.sin(a) * r]);
  }
  const body = 'M' + pts.map((p) => p.map((v) => v.toFixed(1)).join(',')).join(' L') + ' Z';
  const drops = [];
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2;
    const d = 360 + rnd() * 130;
    const s = 4 + rnd() * (d < 400 ? 34 : 16);
    drops.push(`<ellipse cx="${(500 + Math.cos(a) * d).toFixed(1)}" cy="${(500 + Math.sin(a) * d).toFixed(1)}" rx="${s.toFixed(1)}" ry="${(s * (0.6 + rnd() * 0.6)).toFixed(1)}" transform="rotate(${(a * 57.3).toFixed(0)} ${(500 + Math.cos(a) * d).toFixed(1)} ${(500 + Math.sin(a) * d).toFixed(1)})"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><g fill="#000"><path d="${body}"/>${drops.join('')}</g></svg>`;
  await writeFile(new URL('ink-mask.svg', out), svg);
}
console.log('ink mask written');
