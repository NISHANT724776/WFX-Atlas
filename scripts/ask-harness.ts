// Runs the assistant's answer engine over real-world style questions and reports what it gets wrong.
// Bundled and run by scripts/test-ask.mjs (npm run test:ask). Needs a built data folder (public/data).
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { AnswerEngine } from '../src/app/data/answer';
import { intentAnswer } from '../src/app/data/assistant-intents';
import { MANUALS } from '../src/app/data/manuals';

interface Case { q: string; title?: string; kind?: string; all?: string[]; any?: string[] }

const root = process.argv[2];
const man = JSON.parse(readFileSync(`${root}/public/data/manifest.json`, 'utf8'));
const SQL = await initSqlJs();
const db = new SQL.Database();
function parse(t: string) {
  const o: string[][] = []; let r: string[] = [], c = '', q = false; t = t.replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else if (ch === '"') q = true; else if (ch === ',') { r.push(c); c = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; r.push(c); c = ''; if (r.length > 1 || r[0] !== '') o.push(r); r = []; }
    else c += ch;
  }
  if (c !== '' || r.length) { r.push(c); o.push(r); }
  return o;
}
for (const t of man.tables) {
  const [h, ...rows] = parse(readFileSync(`${root}/public/data/${t.file}`, 'utf8'));
  db.run(`CREATE TABLE "${t.table}" (${h.map((x: string, j: number) => `"${x}" ${t.columns[j].type}`).join(',')})`);
  for (const r of rows) db.run(`INSERT INTO "${t.table}" VALUES (${h.map(() => '?').join(',')})`, r.map((v, j) => (t.columns[j].type === 'REAL' && v !== '' ? Number(v) : v === '' ? null : v)));
}
const svc: any = { manifest: async () => man, query: async (sql: string) => { const res = db.exec(sql); const l = res[res.length - 1]; return { columns: l?.columns ?? [], rows: l?.values ?? [], ms: 0 }; } };
const engine = new AnswerEngine(svc);
const ask = async (q: string) => intentAnswer(q) ?? (await engine.ask(q));

// AUDIT=file.txt: print the answer to every question in the file (one per line), to read them by eye
if (process.env.AUDIT) {
  for (const q of readFileSync(process.env.AUDIT, 'utf8').split('\n').map((x) => x.trim()).filter(Boolean)) {
    const a = await ask(q);
    console.log(`Q: ${q}`);
    console.log(`   [${a.kind}] ${a.title}${a.gap ? ' (gap)' : ''} :: ${a.text.slice(0, 150)}`);
  }
  process.exit(0);
}
// COVERQ="question": which words the strict check needs, and whether the raw answer has them
if (process.env.COVERQ) {
  const q = process.env.COVERQ;
  await engine.ask("x");
  const raw = process.env.FINAL ? await engine.ask(q) : await (engine as any).askRaw(q);
  console.log(`[${raw.kind}] ${raw.title}
${await engine.coverDebug(q, raw)}`);
  process.exit(0);
}
if (process.env.DEBUGQ) { await engine.ask('x'); console.log(JSON.stringify(engine.debug(process.env.DEBUGQ), null, 1)); process.exit(0); }

// ── hand-written, messy, real-world questions ────────────────────────
const cases: Case[] = JSON.parse(readFileSync(`${root}/scripts/ask-cases.json`, 'utf8'));
let bad = 0;
const fails: string[] = [];
const suggested: string[] = [];
for (const c of cases) {
  const a = await ask(c.q);
  const title = a.title.toLowerCase();
  let ok = true;
  if (c.title) ok = ok && title.includes(c.title.toLowerCase());
  if (c.kind) ok = ok && a.kind === c.kind;
  // any: one of these title parts is right; "none" means an honest "not in the hub" is right
  if (c.any) ok = ok && c.any.some((x) => (x === 'none' ? a.kind === 'none' : title.includes(x.toLowerCase())));
  if (c.all) { const titles = [a.title, ...(a.more ?? []).map((m) => m.title)].map((t) => t.toLowerCase()); ok = ok && c.all.every((x) => titles.some((t) => t.includes(x.toLowerCase()))); }
  // strict mode: an honest "not sure" that offers the right topic among its first 3 suggestions is acceptable
  const offered = a.kind === 'none' && !!c.title && a.related.slice(0, 3).some((r) => r.toLowerCase().includes(c.title!.toLowerCase()));
  if (!ok && offered) { suggested.push(c.q); continue; }
  if (!ok) {
    bad++;
    const d = engine.debug(c.q);
    const top = `${d.words.join(' ')} → ${d.ranked.join(' | ')}`;
    fails.push(`  ✗ "${c.q}"
      expected ${c.title ?? c.kind ?? c.all?.join(' + ') ?? c.any?.join(' | ')}
      got      [${a.kind}] ${a.title}${process.env.RANKS ? `
      ranks    ${top}` : ''}`);
  }
}
console.log(`Hand-written questions: ${cases.length - bad}/${cases.length} correct (${cases.length - bad - suggested.length} answered exactly, ${suggested.length} honestly unsure but offered the right topic)`);
fails.forEach((f) => console.log(f));

// ── every guide section, asked in three other ways ───────────────────
const swap = (w: string) => (w.length > 5 ? w.slice(0, 2) + w[3] + w[2] + w.slice(4) : w);
const variants = (title: string) => {
  const plain = title.toLowerCase().replace(/[?"”“]/g, '');
  const long = plain.split(' ').filter((w) => w.length > 5).sort((a, b) => b.length - a.length).slice(0, 2);
  const typo = long.reduce((s, w) => s.replace(w, swap(w)), plain);
  return [plain.replace(/^how do i /, 'how to ').replace(/^what is /, ''), typo, `hi, i am new to wfx and i was told to do this, please help: ${plain}. thanks a lot`];
};
let total = 0, miss = 0;
const gen: string[] = [];
for (const m of MANUALS) {
  for (const q of variants(m.title)) {
    total++;
    const a = await ask(q);
    if (a.title !== m.title) { miss++; gen.push(`  ✗ "${q}"\n      expected ${m.title}\n      got      [${a.kind}] ${a.title}`); }
  }
}
const pct = Math.round(((total - miss) / total) * 100);
console.log(`\nEvery guide asked three other ways (casual, typo, chatty): ${total - miss}/${total} correct (${pct}%)`);
gen.slice(0, Number(process.env.SHOW ?? 12)).forEach((f) => console.log(f));
if (gen.length > Number(process.env.SHOW ?? 12)) console.log(`  … ${gen.length - Number(process.env.SHOW ?? 12)} more (set SHOW=100 to list)`);
process.exit(bad === 0 && pct >= 90 ? 0 : 1);
