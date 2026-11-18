// Vercel function: GET /api/ai-status  →  { enabled, providers[], default }  (never reveals keys)
import { status } from '../server/ai-core.js';

interface Res { status(code: number): Res; setHeader(name: string, value: string): Res; json(body: unknown): void; }

export default function handler(_req: unknown, res: Res): void {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json(status(process.env));
}
