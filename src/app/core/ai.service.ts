import { Injectable, PLATFORM_ID, inject } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';

export type AiProvider = 'gemini' | 'claude' | 'mock';
export interface AiStatus { enabled: boolean; providers: AiProvider[]; default: AiProvider | null; }
export interface AiContext { title: string; text: string; }
export type AiCoverage = 'hub' | 'general' | 'mixed';
export interface AiReply { answer: string; provider: AiProvider; model: string; sources: string[]; coverage?: AiCoverage; }

/**
 * Talks to the optional AI function (/api/ask). The function holds the API keys; this service only sends the
 * question and the hub's own matching entries, so the AI answers from the hub's data. When the function is not
 * deployed (local preview, static hosting) status() resolves to "disabled" and the assistant stays rule-based.
 */
@Injectable({ providedIn: 'root' })
export class AiService {
  private readonly browser = isPlatformBrowser(inject(PLATFORM_ID));
  private statusPromise: Promise<AiStatus> | null = null;

  status(): Promise<AiStatus> {
    if (!this.browser) return Promise.resolve({ enabled: false, providers: [], default: null });
    this.statusPromise ??= fetch('/api/ai-status', { cache: 'no-store' })
      .then((r) => (r.ok && (r.headers.get('content-type') ?? '').includes('json') ? (r.json() as Promise<AiStatus>) : Promise.reject(new Error('off'))))
      .catch(() => ({ enabled: false, providers: [], default: null }) as AiStatus);
    return this.statusPromise;
  }

  async ask(question: string, context: AiContext[], history: { role: 'user' | 'assistant'; text: string }[], provider?: AiProvider): Promise<AiReply> {
    const res = await fetch('/api/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question, context, history, provider }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json?.error || `The AI service returned ${res.status}.`);
    return json as AiReply;
  }
}
