# Project audit

Audit date: 2026-11-16. Scope: the `ASN` repository (all code of the WFX Knowledge Hub), the sibling `WFX-Product-Demo`
folder, and the knowledge documents reachable on this machine. Method: reading the code and data, running the existing
build and test commands, and checking the runtime (Node.js 22.23.1, npm 11.17).

## 1. What exists

| Area | Finding |
| --- | --- |
| Frontend | Angular 21.2: standalone components, signals, OnPush, zoneless change detection, static prerender of 40 pages (`outputMode: static`), SEO service and post-build page checks, light/dark theme. Source in `src/` at the repository root. |
| Backend | **None that persists anything.** Two Vercel serverless functions (`api/ask.ts`, `api/ai-status.ts`) are thin adapters over `server/ai-core.ts` (calls Gemini or Claude over `fetch`, in-memory rate limit). |
| Database | **None on a server.** The browser loads 57 CSV tables into SQLite (sql.js, WASM) at runtime, read-only (`src/app/core/sql.service.ts`). |
| APIs | `POST /api/ask`, `GET /api/ai-status` (only when deployed to Vercel with keys). |
| Authentication | **None.** The site is public and read-only. |
| Chatbot | Rule-based `AnswerEngine` (`src/app/data/answer.ts`, about 750 lines): keyword/IDF matching over fields, formulas, terms, transactions and guide sections, plus workflow commands (`assistant-intents.ts`). Optional AI fallback through `/api/ask`. |
| AI integration | Gemini and Claude, switchable, keys only as server environment variables. Never exercised against a real provider (no keys yet). |
| Prompts | `SYSTEM_PROMPT` in `server/ai-core.ts`: hub context first, may answer beyond it, reply starts with `SOURCE: HUB / GENERAL / MIXED`. |
| Document processing | **None at runtime.** Every document the owner supplied was read during development and transcribed by hand into TypeScript data files. |
| File upload | **None.** |
| Knowledge storage | TypeScript modules in `src/app/data/` (about 4,700 lines) → exported by `scripts/export-data.ts` into 57 CSV tables (`data/<module>/`, copy in `public/data/`) and one TXT file (`data/order/sales_order_knowledge.txt`). |
| Search | Two separate implementations: `search.ts` (token search for the search box) and the ranking inside `answer.ts`. No index on a server, no embeddings. |
| Workflows and diagrams | `journey.ts` (phases, 30+ steps, prerequisites, step groups, scenarios) drawn as Blueprint and Storyboard; data-model pages draw document flows; a booking-adjustment simulator (`sim.ts`); a cost-sheet engine (`costsheet.ts`); the consumption chain (`cons.ts`). |
| Tests | `npm run test:ai` (AI core with a fake fetch, passes), `npm run test:ask` (assistant regression, 122 questions). No unit tests for components; no API tests (there is no API to test). |
| Deployment | Configured for Vercel static hosting (`vercel.json`); not deployed; `SITE.url` in `catalog.ts` is still a guessed domain. Local preview serves `dist/` on port 4300. |

## 2. Problems found (ranked by impact)

1. **Knowledge lives in code.** Adding or correcting a rule needs a developer to edit TypeScript and rebuild. There is no
   rule lifecycle, no version history, no approval, no change record, and source references exist only as code comments.
2. **No persistence and no ingestion.** The owner cannot upload documents; the 9 manuals and the Sprint specifications
   were transcribed by hand and the screenshots inside them were not captured.
3. **The assistant does not understand questions.** It matches keywords. An audit on 2026-11-13 of 40 everyday questions
   gave about 12 right, 7 partly right and 21 wrong answers. A strict "answer only when sure" layer was being tuned when
   this audit started: 112 of 122 regression questions pass; 10 fail, several of them still confident wrong answers.
4. **No provenance or status per answer.** Answers do not say which document, version or rule they come from, or whether
   the content is confirmed, assumed or proposed (the data has `verified` / `assumed` flags, but answers don't surface them).
5. **No security model.** Fine for a public read-only site; not acceptable once confidential documents and editable
   rules are stored.
6. **Static hosting limits.** Vercel static hosting plus serverless functions cannot keep uploaded files or a database
   between requests. A knowledge platform that learns needs a server with persistent storage.
7. **Duplicate search logic** (`search.ts` vs `answer.ts`) and two spellings of the same synonyms.

## 3. Open business questions already recorded (not fabricated, still open)

- Process Rate: the owner said "+", the WFX screen shows "×" (Cost Of × Production Time). Marked assumed until confirmed.
- Loss % method, exchange-rate handling in costing, and the meaning of `PCS = PP × Size / PP × TBA` (Sales Order packing).
- The official reason for roll-wise stock handling (the hub's "why" text for rolls is an inference).
- Auto TNA attachment rule details.

## 4. Existing bugs and incomplete features

| Item | State |
| --- | --- |
| `npm run test:ask` | 10 of 122 fail (strict answering still being tuned). |
| AI mode | Built, unit-tested with a fake provider, never tested with real Gemini/Claude, not deployed. |
| Inventory and TNA modules | Guides only; no data-model documents. |
| Word-manual screenshots | Not captured. |
| `SITE.url` | Placeholder domain. |
| Initial bundle | Warning budget raised to 420 kB to fit. |

## 5. Decisions taken from this audit

- **Keep** the Angular site, its pages, the CSV export and the static deployment; they work and the owner relies on them.
- **Add** a Node.js knowledge server (`backend/`) with a persistent SQLite database (Node's built-in `node:sqlite`, which
  includes FTS5 full-text search) — no new runtime dependencies, no native modules to compile.
- **Make TXT the source of truth for business knowledge** (`knowledge/`), indexed by the database (Layer A originals,
  Layer B TXT, Layer C index), exactly as the specification requires.
- **Migrate, don't retype**: the v1 TypeScript knowledge is converted to TXT by a script, item by item, with counts
  checked by a test so nothing is lost.
- **Replace the assistant's answering path** with retrieval over the indexed knowledge (justified by finding 3), and keep
  the v1 rule engine as the offline fallback for the static site.
- The Angular app stays at the repository root instead of moving into `frontend/`: moving it would change every build
  path, the Vercel settings and the preview configuration with no functional gain. `ARCHITECTURE.md` maps the folders.
