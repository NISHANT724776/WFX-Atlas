// Offline checks of server/ai-core.ts with a fake fetch (no keys, no network). Run: npm run test:ai
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const root = fileURLToPath(new URL('..', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'wfx-ai-'));
const out = join(dir, 'core.mjs');
await build({ entryPoints: [join(root, 'server', 'ai-core.ts')], bundle: true, platform: 'node', format: 'esm', outfile: out, logLevel: 'warning' });
const core = await import(pathToFileURL(out).href);

const calls = [];
const fake = (reply) => async (url, init) => { calls.push({ url, init, body: JSON.parse(init.body) }); return { ok: true, status: 200, text: async () => JSON.stringify(reply) }; };
const req = core.parseRequest({ question: '  How is total cons calculated? ', context: [{ title: 'Final Consumption', text: 'Cons × 1/(1−Loss %) …' }, { title: '', text: 'dropped' }], history: [{ role: 'user', text: 'hi' }], provider: 'claude' });

// parsing
assert.equal(req.question, 'How is total cons calculated?');
assert.equal(req.context.length, 1);
assert.throws(() => core.parseRequest({}), /question/i);
assert.throws(() => core.parseRequest(null), /JSON/);

// status / provider choice
assert.deepEqual(core.status({}), { enabled: false, providers: [], default: null });
const both = { GEMINI_API_KEY: 'g', ANTHROPIC_API_KEY: 'a', AI_PROVIDER: 'claude' };
assert.deepEqual(core.status(both), { enabled: true, providers: ['gemini', 'claude'], default: 'claude' });
assert.equal(core.status({ ...both, AI_ENABLED: '0' }).enabled, false);
assert.equal(core.pickProvider({ ...req, provider: 'gemini' }, both), 'gemini');
assert.equal(core.pickProvider({ ...req, provider: undefined }, both), 'claude');
assert.equal(core.pickProvider({ ...req, provider: 'claude' }, { GEMINI_API_KEY: 'g' }), 'gemini'); // requested key missing → default
await assert.rejects(() => core.answerWithAi(req, {}, fake({})), /not configured/);

// Gemini request and reply
let r = await core.answerWithAi({ ...req, provider: 'gemini' }, both, fake({ candidates: [{ content: { parts: [{ text: 'Gemini says 2.3269' }] } }] }));
assert.equal(r.answer, 'Gemini says 2.3269');
assert.equal(r.provider, 'gemini');
assert.match(calls.at(-1).url, /generativelanguage\.googleapis\.com\/v1beta\/models\/gemini-2\.5-flash:generateContent/);
assert.equal(calls.at(-1).init.headers['x-goog-api-key'], 'g');
assert.match(calls.at(-1).body.contents.at(-1).parts[0].text, /CONTEXT[\s\S]*Final Consumption[\s\S]*QUESTION/);
assert.equal(calls.at(-1).body.contents[0].role, 'user');

// Claude request and reply
r = await core.answerWithAi({ ...req, provider: 'claude' }, both, fake({ content: [{ type: 'text', text: 'Claude says 2.3269' }] }));
assert.equal(r.answer, 'Claude says 2.3269');
assert.equal(calls.at(-1).url, 'https://api.anthropic.com/v1/messages');
assert.equal(calls.at(-1).init.headers['x-api-key'], 'a');
assert.equal(calls.at(-1).body.model, 'claude-sonnet-5-5');
assert.ok(calls.at(-1).body.system.includes('Use it first'));
assert.equal(calls.at(-1).body.messages.at(-1).role, 'user');

// provider failures become clean errors
const bad = async () => ({ ok: false, status: 429, text: async () => JSON.stringify({ error: { message: 'quota' } }) });
await assert.rejects(() => core.answerWithAi({ ...req, provider: 'claude' }, both, bad), (e) => e.status === 429 && /quota/.test(e.message));
await assert.rejects(() => core.answerWithAi({ ...req, provider: 'gemini' }, both, fake({ candidates: [] })), /no answer/);

// mock provider and rate limit
r = await core.answerWithAi({ ...req, provider: 'mock' }, { AI_MOCK: '1' }, fake({}));
assert.match(r.answer, /Mock answer/);
const lim = { AI_RATE_LIMIT_PER_HOUR: '2' };
assert.ok(core.allowRequest('ip1', lim, 1000) && core.allowRequest('ip1', lim, 2000));
assert.equal(core.allowRequest('ip1', lim, 3000), false);
assert.ok(core.allowRequest('ip1', lim, 1000 + 3600_001 + 2000));

rmSync(dir, { recursive: true, force: true });
console.log('AI core: all checks passed');

// where the answer came from (hub / general / mixed)
assert.deepEqual(core.readCoverage('SOURCE: GENERAL\nRolls are tracked one by one.', true), { text: 'Rolls are tracked one by one.', coverage: 'general' });
assert.deepEqual(core.readCoverage('**SOURCE: MIXED**\nA\nNot in the hub: B', true), { text: 'A\nNot in the hub: B', coverage: 'mixed' });
assert.equal(core.readCoverage('No marker', true).coverage, 'hub');
assert.equal(core.readCoverage('No marker', false).coverage, 'general');
r = await core.answerWithAi({ ...req, context: [], provider: 'mock' }, { AI_MOCK: '1' }, fake({}));
assert.equal(r.coverage, 'general');
assert.deepEqual(r.sources, []);
assert.match(core.SYSTEM_PROMPT, /own knowledge/);
console.log('coverage checks passed');
