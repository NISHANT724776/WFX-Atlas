# AI mode (optional)

The hub's assistant works without any AI: it answers from the data files with SQL. AI mode adds **Gemini** and/or **Claude** for questions the rules cannot answer. The AI is given the hub's own entries that match the question and uses them first. When the hub does not cover the question it still answers from its own knowledge, and every AI answer is labelled: from the hub, hub + general knowledge, or general knowledge (with a note that it is not in the hub's knowledge). AI answers automatically when it is set up; a user can switch it off.

## How it works

```
Browser (chat widget)
  1. asks the rule-based engine (always first, free, offline)
  2. if AI is on and the rules find nothing (or the user taps "Ask AI"):
     sends { question, matching hub entries, last few messages } to /api/ask
Server function (holds the API keys)
  3. calls Gemini or Claude with a fixed instruction: use the context first, answer beyond it from general knowledge, and start with SOURCE: HUB / GENERAL / MIXED
  4. returns { answer, provider, model, sources }
```

- Keys exist only as server environment variables. The browser never sees them.
- `GET /api/ai-status` tells the widget which providers are configured. With no function deployed, or no key, the AI switch simply does not appear.
- The widget shows an **AI on/off** switch and, when both keys exist, a **provider selector** (Gemini / Claude). The choice is remembered in the browser.

## Files

| File | Purpose |
|---|---|
| `server/ai-core.ts` | All logic: validation, prompt, Gemini and Claude calls (plain `fetch`), rate limit. No SDK, no framework. |
| `api/ask.ts`, `api/ai-status.ts` | Thin **Vercel** adapters. |
| `src/app/core/ai.service.ts` | Browser client. |
| `src/app/shared/chat-widget.ts` | The assistant. |
| `scripts/test-ai.mjs` | `npm run test:ai` checks the core offline with a fake provider. |

## Set up on Vercel

1. Get a key: Gemini (Google AI Studio, has a free tier) and/or Claude (Anthropic Console, paid).
2. Vercel project > Settings > Environment Variables: add `GEMINI_API_KEY` and/or `ANTHROPIC_API_KEY`; optionally `AI_PROVIDER`, `AI_GEMINI_MODEL`, `AI_CLAUDE_MODEL`, `AI_RATE_LIMIT_PER_HOUR` (see `.env.example`).
3. Redeploy. Open the site, click the chat icon: an **AI off/on** switch appears.
4. To try the widget without a key or any cost, set `AI_MOCK=1`; the function then answers with a fixed test message and the provider shows as "Test mode".

Model names change over time. If a provider reports an unknown model, set `AI_GEMINI_MODEL` or `AI_CLAUDE_MODEL`.

## Moving to the WFX domain on AWS or Azure later

`server/ai-core.ts` does not depend on Vercel. Only the adapter changes:

- **AWS**: a Lambda behind API Gateway (or Lambda function URL). The handler reads `event.body`, calls `parseRequest` then `answerWithAi(req, process.env)`, returns JSON. Keep keys in Secrets Manager or Lambda environment variables. Route `/api/ask` and `/api/ai-status` from the same domain.
- **Azure**: an Azure Function (HTTP trigger) with the same three calls; keys in Application Settings or Key Vault.
- Serve the Angular files and `/api/*` from the same domain so no CORS is needed.

Before opening it to the public on a company domain: put `/api/ask` behind the company login (or the gateway's authorizer), and replace the in-memory rate limit with the gateway's throttling. The built-in limit is per server instance only.

## Cost and privacy

- Each AI question sends the question, up to 8 short hub entries and up to 6 earlier messages. It does not send the whole database.
- Rule-based answers never leave the browser.
- Gemini's free tier has limits and, on free tiers, providers may use inputs to improve products: check the current terms before sending anything confidential. Use the paid tier or Claude if that matters.
