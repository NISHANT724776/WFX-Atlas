// Provider-neutral core of the optional AI mode. No SDKs, no framework: plain fetch + JSON, so the same
// file runs behind a Vercel function today and an AWS Lambda or Azure Function later (see AI-MODE.md).
// API keys are read from environment variables only and never leave the server.

export type Provider = 'gemini' | 'claude' | 'mock';
export type Env = Record<string, string | undefined>;

export interface ContextItem { title: string; text: string; }
export interface HistoryItem { role: 'user' | 'assistant'; text: string; }
export interface AiRequest { question: string; context: ContextItem[]; history: HistoryItem[]; provider?: Provider; }
/** Where the answer came from: the hub's own data, general knowledge (not in the hub), or both. */
export type Coverage = 'hub' | 'general' | 'mixed';
export interface AiResponse { answer: string; provider: Provider; model: string; sources: string[]; coverage: Coverage; }
export interface AiStatus { enabled: boolean; providers: Provider[]; default: Provider | null; }

export class AiError extends Error {
  status: number;
  constructor(message: string, status = 500) { super(message); this.status = status; }
}

const LIMITS = { question: 600, contextItems: 8, contextText: 1500, history: 6, historyText: 800 };

const MODELS = (env: Env) => ({
  gemini: env['AI_GEMINI_MODEL'] || 'gemini-2.5-flash',
  claude: env['AI_CLAUDE_MODEL'] || 'claude-opus-5-5',
  mock: 'mock',
});

export const SYSTEM_PROMPT = [
  'You are the assistant of the WFX Knowledge Hub, a guide to the WFX garment ERP (BOM, MRP, indents, purchase, GRN, production, Sales Order).',
  'The CONTEXT given with the question is the hub\'s own data: definitions, formulas, rules, guides and worked examples. Use it first, and where it answers the question, follow it exactly.',
  'Where the context does not answer the question (fully or in part), still answer it correctly from your own knowledge of the WFX ERP, apparel manufacturing, sourcing, inventory and ERP practice. Never refuse just because the context is missing.',
  'Never present your own knowledge as if it came from the hub. If the hub and your own knowledge differ, follow the hub and mention the difference.',
  'Do not invent exact WFX screen names, menu paths, settings or numbers you are not sure of; say "check this in WFX" instead.',
  'Keep formulas exactly as written in the context. Where the context marks something as "to confirm" or assumed, say it is still to be confirmed.',
  'The FIRST line of your reply must be exactly one of: "SOURCE: HUB" (everything came from the context), "SOURCE: GENERAL" (nothing useful was in the context), or "SOURCE: MIXED" (partly from the context, partly your own knowledge). For MIXED, end with one line starting "Not in the hub:" that says which part came from your own knowledge.',
  'Refer to articles by name: Adi TShirt (NIS-59) and Flannel Shirt Adi (NIS-58), never by the bare code.',
  'Be clear and direct: a one or two sentence answer first, then the reasons, formula or steps if useful. Plain text only, no markdown tables.',
].join('\n');

/** Providers that can be used: those with a key, plus the offline mock when AI_MOCK=1. */
export function availableProviders(env: Env): Provider[] {
  const out: Provider[] = [];
  if (env['GEMINI_API_KEY']) out.push('gemini');
  if (env['ANTHROPIC_API_KEY']) out.push('claude');
  if (env['AI_MOCK'] === '1') out.push('mock');
  return out;
}

export function status(env: Env): AiStatus {
  const providers = env['AI_ENABLED'] === '0' ? [] : availableProviders(env);
  const wanted = env['AI_PROVIDER'] as Provider | undefined;
  const def = wanted && providers.includes(wanted) ? wanted : providers[0] ?? null;
  return { enabled: providers.length > 0, providers, default: def };
}

const clip = (s: unknown, n: number) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

/** Validates and trims the browser's request. Throws AiError 400 on bad input. */
export function parseRequest(body: unknown): AiRequest {
  if (!body || typeof body !== 'object') throw new AiError('Send a JSON body.', 400);
  const b = body as Record<string, unknown>;
  const question = clip(b['question'], LIMITS.question);
  if (!question) throw new AiError('A question is required.', 400);
  const ctx = Array.isArray(b['context']) ? b['context'] : [];
  const context = ctx.slice(0, LIMITS.contextItems).map((c) => {
    const o = (c ?? {}) as Record<string, unknown>;
    return { title: clip(o['title'], 120), text: clip(o['text'], LIMITS.contextText) };
  }).filter((c) => c.title && c.text);
  const hist = Array.isArray(b['history']) ? b['history'] : [];
  const history = hist.slice(-LIMITS.history).map((h) => {
    const o = (h ?? {}) as Record<string, unknown>;
    return { role: o['role'] === 'assistant' ? 'assistant' as const : 'user' as const, text: clip(o['text'], LIMITS.historyText) };
  }).filter((h) => h.text);
  const p = b['provider'];
  const provider = p === 'gemini' || p === 'claude' || p === 'mock' ? p : undefined;
  return { question, context, history, provider };
}

export function buildUserPrompt(req: AiRequest): string {
  const ctx = req.context.length
    ? req.context.map((c, i) => `[${i + 1}] ${c.title}\n${c.text}`).join('\n\n')
    : '(no matching entries were found in the hub)';
  return `CONTEXT\n${ctx}\n\nQUESTION\n${req.question}`;
}

/** Chooses the provider: the request's choice when its key exists, else the configured default. */
export function pickProvider(req: AiRequest, env: Env): Provider {
  const st = status(env);
  if (!st.enabled) throw new AiError('AI mode is not configured on this server.', 503);
  if (req.provider && st.providers.includes(req.provider)) return req.provider;
  return st.default!;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown, fetchImpl: typeof fetch): Promise<any> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 25000);
  try {
    const res = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: ctl.signal });
    const text = await res.text();
    let json: any = null;
    try { json = JSON.parse(text); } catch { /* keep null */ }
    if (!res.ok) {
      const msg = json?.error?.message || json?.message || `HTTP ${res.status}`;
      throw new AiError(`The AI provider refused the request (${msg}).`, res.status === 429 ? 429 : 502);
    }
    return json;
  } catch (e) {
    if (e instanceof AiError) throw e;
    throw new AiError((e as Error).name === 'AbortError' ? 'The AI provider took too long to answer.' : 'Could not reach the AI provider.', 504);
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(req: AiRequest, env: Env, model: string, fetchImpl: typeof fetch): Promise<string> {
  const contents = [
    ...req.history.map((h) => ({ role: h.role === 'assistant' ? 'model' : 'user', parts: [{ text: h.text }] })),
    { role: 'user', parts: [{ text: buildUserPrompt(req) }] },
  ];
  const json = await postJson(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    { 'x-goog-api-key': env['GEMINI_API_KEY']! },
    { systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] }, contents, generationConfig: { temperature: 0.2, maxOutputTokens: 1000 } },
    fetchImpl,
  );
  const parts = json?.candidates?.[0]?.content?.parts;
  const text = Array.isArray(parts) ? parts.map((p: any) => p?.text ?? '').join('').trim() : '';
  if (!text) throw new AiError('The AI provider returned no answer.', 502);
  return text;
}

async function callClaude(req: AiRequest, env: Env, model: string, fetchImpl: typeof fetch): Promise<string> {
  const messages = [
    ...req.history.map((h) => ({ role: h.role, content: h.text })),
    { role: 'user', content: buildUserPrompt(req) },
  ];
  const json = await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': env['ANTHROPIC_API_KEY']!, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: 1000, system: SYSTEM_PROMPT, messages },
    fetchImpl,
  );
  const blocks = json?.content;
  const text = Array.isArray(blocks) ? blocks.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim() : '';
  if (!text) throw new AiError('The AI provider returned no answer.', 502);
  return text;
}

/**
 * Generic completion used by the knowledge server (its own grounded prompt and numbered sources). The caller decides
 * what is sent; this function only talks to the provider. Returns the text and the model used.
 */
export async function completeText(input: { system: string; messages: HistoryItem[]; provider?: Provider; maxTokens?: number }, env: Env, fetchImpl: typeof fetch = fetch): Promise<{ text: string; provider: Provider; model: string }> {
  const st = status(env);
  if (!st.enabled) throw new AiError('AI mode is not configured on this server.', 503);
  const provider = input.provider && st.providers.includes(input.provider) ? input.provider : st.default!;
  const model = MODELS(env)[provider];
  const max = input.maxTokens ?? 1200;
  if (provider === 'mock') return { text: `Mock completion. ${input.messages[input.messages.length - 1]?.text.slice(0, 200) ?? ''}`, provider, model };
  if (provider === 'gemini') {
    const json = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { 'x-goog-api-key': env['GEMINI_API_KEY']! },
      { systemInstruction: { parts: [{ text: input.system }] }, contents: input.messages.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.text }] })), generationConfig: { temperature: 0.1, maxOutputTokens: max } },
      fetchImpl,
    );
    const parts = json?.candidates?.[0]?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((p: any) => p?.text ?? '').join('').trim() : '';
    if (!text) throw new AiError('The AI provider returned no answer.', 502);
    return { text, provider, model };
  }
  const json = await postJson(
    'https://api.anthropic.com/v1/messages',
    { 'x-api-key': env['ANTHROPIC_API_KEY']!, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: max, system: input.system, messages: input.messages.map((m) => ({ role: m.role, content: m.text })) },
    fetchImpl,
  );
  const blocks = json?.content;
  const text = Array.isArray(blocks) ? blocks.filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('').trim() : '';
  if (!text) throw new AiError('The AI provider returned no answer.', 502);
  return { text, provider, model };
}

/** Entry point shared by every host adapter. */
export async function answerWithAi(req: AiRequest, env: Env, fetchImpl: typeof fetch = fetch): Promise<AiResponse> {
  const provider = pickProvider(req, env);
  const model = MODELS(env)[provider];
  let answer: string;
  if (provider === 'gemini') answer = await callGemini(req, env, model, fetchImpl);
  else if (provider === 'claude') answer = await callClaude(req, env, model, fetchImpl);
  else answer = `SOURCE: ${req.context.length ? 'HUB' : 'GENERAL'}\nMock answer (no AI provider called). Question: "${req.question}". Context entries: ${req.context.map((c) => c.title).join('; ') || 'none'}.`;
  const { text, coverage } = readCoverage(answer, req.context.length > 0);
  return { answer: text, provider, model, sources: coverage === 'general' ? [] : req.context.map((c) => c.title), coverage };
}

/** Reads and removes the "SOURCE: …" line the model is told to start with. Without it: hub when context was sent, else general. */
export function readCoverage(raw: string, hadContext: boolean): { text: string; coverage: Coverage } {
  const m = /^\s*\**\s*SOURCE:\s*(HUB|GENERAL|MIXED)\b\**\s*\n?/i.exec(raw);
  if (!m) return { text: raw.trim(), coverage: hadContext ? 'hub' : 'general' };
  return { text: raw.slice(m[0].length).trim(), coverage: m[1].toLowerCase() as Coverage };
}

// ── best-effort rate limit (per server instance; use a shared store or the host's gateway for a hard limit) ──
const hits = new Map<string, number[]>();
export function allowRequest(key: string, env: Env, now = Date.now()): boolean {
  const max = Number(env['AI_RATE_LIMIT_PER_HOUR'] || 30);
  const recent = (hits.get(key) ?? []).filter((t) => now - t < 3600_000);
  if (recent.length >= max) { hits.set(key, recent); return false; }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) for (const k of hits.keys()) { hits.delete(k); if (hits.size < 2500) break; }
  return true;
}
