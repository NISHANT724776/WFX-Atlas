// Vercel function: POST /api/ask  { question, context[], history[], provider? }  →  { answer, provider, model, sources }
// Thin adapter only; all logic is in server/ai-core.ts so it can move to AWS Lambda or Azure Functions unchanged.
import { AiError, allowRequest, answerWithAi, parseRequest } from '../server/ai-core.js';

interface Req { method?: string; body?: unknown; headers: Record<string, string | string[] | undefined>; socket?: { remoteAddress?: string }; }
interface Res { status(code: number): Res; setHeader(name: string, value: string): Res; json(body: unknown): void; }

const firstIp = (req: Req) => {
  const fwd = req.headers['x-forwarded-for'];
  const v = Array.isArray(fwd) ? fwd[0] : fwd;
  return (v?.split(',')[0] ?? req.socket?.remoteAddress ?? 'unknown').trim();
};

export default async function handler(req: Req, res: Res): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); res.status(405).json({ error: 'Use POST.' }); return; }
  try {
    if (!allowRequest(firstIp(req), process.env)) throw new AiError('Too many AI questions. Please try again later.', 429);
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const out = await answerWithAi(parseRequest(body), process.env);
    res.status(200).json(out);
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError('Something went wrong.', 500);
    res.status(err.status).json({ error: err.message });
  }
}
