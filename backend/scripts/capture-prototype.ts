// Captures the Trims Scan prototype (https://trims-prototype-mobile.vercel.app/) as visual guides: for every flow and every
// step it jumps the prototype to that step, saves the phone screen as an image and records where the prototype itself
// shows its "Tap here" hint. Output (Layer B, readable): knowledge/registry/guides/trims-<flow>.txt and
// knowledge/registry/assets/trims/<flow>-<n>.webp. Run again whenever the prototype changes:
//   npm run kb:capture-prototype            (uses Chrome or Edge in headless mode, no extra packages)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { settings } from '../src/config.ts';

const URL_ = 'https://trims-prototype-mobile.vercel.app/';
const BROWSERS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
];
const exe = process.env['CHROME_PATH'] || BROWSERS.find((p) => fs.existsSync(p));
if (!exe) throw new Error('Chrome or Edge not found; set CHROME_PATH.');
const PORT = 9333;
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wfx-capture-'));
const proc = spawn(exe, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let target: { webSocketDebuggerUrl: string } | undefined;
for (let i = 0; i < 40 && !target; i++) {
  await sleep(250);
  try { target = ((await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === 'page'); } catch { /* not up yet */ }
}
if (!target) { proc.kill(); throw new Error('The browser did not start.'); }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map<number, (v: unknown) => void>();
ws.addEventListener('message', (ev) => { const m = JSON.parse(String(ev.data)); if (m.id && pending.has(m.id)) { pending.get(m.id)!(m.error ? Promise.reject(new Error(m.error.message)) : m.result); pending.delete(m.id); } });
const send = (method: string, params: Record<string, unknown> = {}) => new Promise<any>((res) => { const id = ++seq; pending.set(id, res); ws.send(JSON.stringify({ id, method, params })); });
const evaluate = async <T>(expr: string): Promise<T> => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text); return r.result.value as T; };

await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 900, deviceScaleFactor: 2, mobile: true });
await send('Page.enable');
await send('Page.navigate', { url: URL_ });
await sleep(2500);

interface Step { n: number; title: string; text: string; hints: { x: number; y: number; w: number; h: number; label: string }[]; image: string }
interface Flow { id: string; label: string; intro: string; gains: string[]; steps: Step[] }
const flows = await evaluate<{ v: string; label: string }[]>(`[...document.querySelectorAll('[data-act=flow]')].map(b => ({ v: b.dataset.v, label: b.textContent.trim() }))`);
const intro = await evaluate<string>(`(document.querySelector('h1')?.nextElementSibling?.innerText || '').trim()`);
const root = settings().knowledge;
const assetDir = path.join(root, 'registry', 'assets', 'trims');
const guideDir = path.join(root, 'registry', 'guides');
fs.mkdirSync(assetDir, { recursive: true }); fs.mkdirSync(guideDir, { recursive: true });

const SKIP = /^(jump|flow|restart|close-sheet|close-sheet-bg|sheet-back|home|noop|edit-type|edit-site|p-edit-type|p-edit-site|o-edit-type|o-edit-site|g-edit-site|another|g-another|o-another|d-another|rm-pmn|g-rm-pmn|o-rm-pm|d-rm|l-clear|pv-close|tile)$/;
const stepNow = () => evaluate<number>(`Number((document.querySelector('#now b')?.innerText.match(/Step (\\d+)/) || [])[1] || 0)`);
/** The visible control that takes the prototype from step n to a later step, tried in order of how well its words match the guide. */
async function advanceControl(n: number, flow: string): Promise<Step['hints']> {
  const words = await evaluate<string>(`[...document.querySelectorAll('#steps li')].slice(${n - 1}).map(l => l.innerText).join(' ').toLowerCase()`);
  const cands = await evaluate<{ i: number; act: string; text: string; r: Step['hints'][0] }[]>(`(() => {
    const scr = document.querySelector('#phone .screen').getBoundingClientRect();
    return [...document.querySelectorAll('#phone [data-act]')].map((e, i) => ({ e, i })).filter(({ e }) => {
      const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false;
      const t = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 12)); return !!t && (e.contains(t) || t.contains(e));
    }).map(({ e, i }) => { const r = e.getBoundingClientRect(); return { i, act: e.dataset.act, text: (e.innerText || e.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 60),
      r: { x: +((r.x - scr.x) / scr.width * 100).toFixed(1), y: +((r.y - scr.y) / scr.height * 100).toFixed(1), w: +(r.width / scr.width * 100).toFixed(1), h: +(r.height / scr.height * 100).toFixed(1), label: '' } }; });
  })()`);
  const score = (c: { act: string; text: string }) => c.text.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && words.includes(w)).length + (/(next|continue|submit|confirm|save|scan|done|create|print|add|update)/i.test(c.act + ' ' + c.text) ? 2 : 0);
  const ordered = cands.filter((c) => !SKIP.test(c.act)).sort((a, b) => score(b) - score(a)).slice(0, 12);
  for (const c of ordered) {
    await evaluate(`document.querySelector('#steps [data-act=jump][data-n="${n}"]').click()`); await sleep(250);
    await evaluate(`document.querySelectorAll('#phone [data-act]')[${c.i}]?.click()`); await sleep(350);
    if ((await stepNow()) > n) return [{ ...c.r, label: c.text || c.act }];
  }
  return [];
}

const out: Flow[] = [];
for (const f of flows) {
  await evaluate(`document.querySelector('[data-act=flow][data-v="${f.v}"]').click()`);
  await sleep(600);
  const count = await evaluate<number>(`document.querySelectorAll('#steps [data-act=jump]').length`);
  const gains = await evaluate<string[]>(`[...document.querySelectorAll('#gainsList li')].map(l => l.innerText.trim())`);
  const flow: Flow = { id: f.v, label: f.label, intro, gains, steps: [] };
  for (let n = 1; n <= count; n++) {
    await evaluate(`document.querySelector('#steps [data-act=jump][data-n="${n}"]').click()`);
    await sleep(700);
    const info = await evaluate<{ title: string; text: string; clip: { x: number; y: number; width: number; height: number }; hints: Step['hints'] }>(`(() => {
      const li = document.querySelectorAll('#steps li')[${n - 1}];
      const scr = document.querySelector('#phone .screen'); const s = scr.getBoundingClientRect();
      const topmost = (e) => { const r = e.getBoundingClientRect(); if (!r.width || !r.height) return false; const t = document.elementFromPoint(r.x + r.width / 2, r.y + Math.min(r.height / 2, 12)); return !!t && (e.contains(t) || t.contains(e)); };
      const seen = new Set();
      const hints = [...document.querySelectorAll('#phone .hot, #phone .tap-hint')].map((e) => e.classList.contains('tap-hint') ? (e.closest('[data-act]') || e) : e)
        .filter((e) => { if (seen.has(e)) return false; seen.add(e); return topmost(e); })
        .map((e) => { const r = e.getBoundingClientRect(); return { x: +((r.x - s.x) / s.width * 100).toFixed(1), y: +((r.y - s.y) / s.height * 100).toFixed(1), w: +(r.width / s.width * 100).toFixed(1), h: +(r.height / s.height * 100).toFixed(1), label: (e.innerText || '').replace(/Tap here/i, '').replace(/\\s+/g, ' ').trim().slice(0, 60) }; });
      return { title: li.querySelector('b').innerText.trim(), text: li.querySelector('.d').innerText.trim(), clip: { x: s.x + scrollX, y: s.y + scrollY, width: s.width, height: s.height }, hints };
    })()`);
    // the screen exactly as the step opens (taken before any control is tried)
    await sleep(500);
    const shot = await send('Page.captureScreenshot', { format: 'webp', quality: 82, captureBeyondViewport: true, clip: { ...info.clip, scale: 1 } });
    const image = `trims/${f.v}-${n}.webp`;
    fs.writeFileSync(path.join(root, 'registry', 'assets', image), Buffer.from(shot.data, 'base64'));
    // no "Tap here" from the prototype: find the control that moves the prototype to the next step by trying them
    if (!info.hints.length && n < count) info.hints = await advanceControl(n, f.v);
    flow.steps.push({ n, title: info.title, text: info.text, hints: info.hints, image });
  }
  out.push(flow);
  console.log(`${f.label}: ${flow.steps.length} steps`);
}
ws.close(); proc.kill();
try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* the browser may still hold the profile */ }

// one readable guide file per flow
const today = new Date().toISOString().slice(0, 10);
const ind = (s: string) => s.replace(/\n/g, '\n  ');
for (const f of out) {
  const [what, doc] = f.label.split('·').map((x) => x.trim());
  const lines = [
    `# Visual guide captured from the Trims Scan prototype on ${today} by backend/scripts/capture-prototype.ts.`,
    '# Screenshots are the prototype screens exactly as shown; markers are where the prototype shows its own "Tap here" hint.',
    `GUIDE ID: GUIDE-TRIMS-${f.id.toUpperCase()}`,
    `TITLE: Trims Scan · ${doc} – ${what}`,
    'MODULE: Inventory › Trims (Quick Docs mobile app)',
    'KIND: prototype',
    `PROTOTYPE URL: ${URL_}`,
    `KEYWORDS: trims, scan, QR, Quick Docs, mobile, ${doc}, ${what}${f.id === 'out' ? ', outward, outward note, returns, transfers' : ''}${f.id === 'dispatch' ? ', pick list, picking' : ''}${f.id === 'loc' ? ', location, move stock, bin' : ''}${f.id === 'print' ? ', print, label, print doc' : ''}${f.id === 'gdn' ? ', GDN, goods delivery note, dispatch' : ''}${f.id === 'grn' ? ', GRN, goods received, receive, receiving, inward, ASN' : ''}`,
    `SUMMARY: ${ind(f.intro)}`,
    `WHAT CHANGES: ${ind(f.gains.map((g) => `• ${g}`).join('\n'))}`,
    'DATA NOTE: The prototype uses sample data only. It demonstrates the intended Quick Docs flow; it is not a live WFX transaction.',
    'SOURCE: Trims Scan Prototype (clickable prototype), ' + URL_,
    `STATUS: Active`,
    `CAPTURED: ${today}`,
  ];
  for (const s of f.steps) {
    lines.push(`STEP ${s.n} TITLE: ${s.title}`, `STEP ${s.n} TEXT: ${ind(s.text)}`, `STEP ${s.n} IMAGE: ${s.image}`);
    if (s.hints.length) lines.push(`STEP ${s.n} MARKERS: ${s.hints.map((h) => `${h.x},${h.y},${h.w},${h.h}|${(h.label || 'Tap here').replace(/[|;]/g, '·')}`).join(' ; ')}`);
  }
  fs.writeFileSync(path.join(guideDir, `trims-${f.id}.txt`), lines.join('\n') + '\n', 'utf8');
}
console.log(`guides written to ${guideDir}`);
