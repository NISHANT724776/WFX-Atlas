# WFX chatbot: product expert, process trainer and navigator

Added 2026-11-18. The assistant (`/assistant`, signed in) now answers WFX questions from the knowledge base, shows **visual step-by-step guides with real screenshots**, and **opens registered screens and workflows directly**. It reuses the existing server, database, conversations, retrieval, AI layer and Angular pages; nothing was duplicated.

## How a message is answered

```
question ──► navigator (backend/src/assistant/navigator.ts)
   "open / go to / take me to … screen"  → Screen Registry → answer + action, page opens at once (role checked)
   trims / QR / Quick Docs / pick list … → Trims Scan prototype guides (+ prototype link, "sample data")
   one or two words ("Sales Order")      → clarification: what is / workflow / how to create / open
          │ otherwise
          ▼
   workflow request ("show me the … workflow") → generated workflow draft → opens in the Workflow Designer
          │ otherwise
          ▼
   knowledge answer (retrieval over the TXT library + documents, unchanged rules: no invention, statuses, sources)
   + AI rewrite when AI mode is on and authorised (backend/src/assistant/llm.ts, cites sources or is discarded)
   + enrichAnswer: registered screens, the stored workflow, a guide built from a documented procedure,
                   a matching prototype guide; "how do I …" without a stored procedure says so instead of inventing steps
   + generalNote: a question outside WFX says that AI mode answers general questions (when it is off)
```

The answer is structured JSON (`KnowledgeAnswer`): `sections` (text), `cards` (guides), `actions` (navigation), `navigate` (open now), `action` (open a generated workflow). The page never builds a link from text: every button is an action the server resolved from the registry.

## Four separate stores, connected by IDs

| Store | Where | Edited by | Holds |
| --- | --- | --- | --- |
| Knowledge base | `knowledge/business_rules, glossary, modules, transactions, workflows …` | Rulebook, owner | rules, terms, procedures (with STEPS and WHERE IN WFX), workflows (`WF-…`) |
| Screen Registry | `knowledge/registry/screens.txt` | text editor; `npm run kb:registry` adds missing ones | `SCREEN ID`, name, module, WFX MENU PATH, APP ROUTE + ROUTE QUERY (a page of this platform), EXTERNAL URL (verified https link), WFX URL (live WFX screen, empty until verified), screenshots, related workflows/guides, REQUIRED ROLE |
| Visual guides | `knowledge/registry/guides/*.txt` + `knowledge/registry/assets/` | `npm run kb:capture-prototype` (prototype), text editor | `GUIDE ID`, title, kind, summary, `STEP n TITLE / TEXT / IMAGE / MARKERS / RESULT / WHERE` |
| Workflow registry | the WORKFLOW entries of the knowledge base | Workflow Designer, Rulebook | steps, decisions, lanes; opened with `/workflow-designer?id=WF-…` |

Guides from procedures are not stored: `GUIDE-PROC-<procedure id>` is built on request from the procedure's STEPS and the screenshot of the screen whose WFX MENU PATH matches its WHERE IN WFX. Updating a procedure updates its guide.

The database indexes the registry (`reg_screens`, `reg_guides`, migration `005_registry.sql`); `syncRegistry()` rebuilds them at server start and in `npm run kb:reindex`. A route that is not a page of this platform is refused at sync time and never linked.

### Marker format

`STEP 3 MARKERS: 7,54.6,86,6|Vikascity` — left, top, width, height in percent of the screenshot, then the label. Several markers are separated by ` ; `.

## Trims Scan prototype

`backend/scripts/capture-prototype.ts` drives https://trims-prototype-mobile.vercel.app/ in headless Chrome or Edge (no extra packages), jumps to every step of the six flows (GRN, Pick List, GDN, Location, Print Doc, Outward Note: 49 steps), saves the phone screen as WebP, and records the tap target: the prototype's own "Tap here" hint, or else the control that actually moves the prototype to the next step (found by trying the visible controls). 28 of the 43 non-final steps have a marker; steps where the next step needs a typed value or a camera hold have none. Run it again whenever the prototype changes. Every prototype answer says it is sample data, not a live WFX transaction.

## Claude mode (2026-11-18, owner's request: "use Claude, do not hardcode")

When a Claude credential is on the server **and** an admin has recorded the organisation's approval (Admin › AI provider, provider Claude or server default), **every chat message goes to Claude** (`backend/src/assistant/claude-chat.ts`, official `@anthropic-ai/sdk`, model `claude-opus-5-5` unless `AI_CLAUDE_MODEL` says otherwise, server-side refusal fallbacks on). Claude itself decides whether a message is a greeting, a general question or a WFX question; the hand-written routing below is only the fallback when Claude is off or fails.

Claude works through tools that run on this server (Claude Tool Runner):

| Tool | What it does |
| --- | --- |
| `search_wfx_knowledge` | the knowledge engine's answer with numbered sources and knowledge status; WFX facts may only come from here |
| `find_screen_or_guide` | registered screens (with WFX menu paths) and visual guides |
| `show_guide` | adds a screenshot walkthrough under the answer (stored guides or `GUIDE-PROC-…`) |
| `offer_link` | adds a button to a registered destination; `open_now` opens it at once; role checked; anything unregistered is refused |
| `open_workflow_designer` | generates / changes a workflow draft and opens the designer |
| `run_calculation` | runs a stored calculation rule with the user's numbers |
| `draft_business_rule`, `save_rule_draft` | reads a rule in plain words, compares it with stored rules, saves it as a Draft (editor role) |
| `analyse_requirement` | stories, acceptance criteria, tests, affected transactions |
| `list_review_queue` | drafts and entries under review |

Only the sources Claude cites are kept and renumbered; status = conversation (no search), confirmed (an approved source cited), provisional (only unapproved sources cited) or not documented (searched, nothing cited). Token usage per answer is stored in `messages.token_usage`. On any API error the knowledge engine answers instead and the error is logged.

**Switch it on** (the key never goes into the repository or the pages):
1. Create `D:\WFX Knowledge hub\ASN\.env` with one line `ANTHROPIC_API_KEY=…` (your key from the Anthropic Console).
2. Restart the server (`start-on-network.ps1` or `npm run kb:server`); the log says "settings read from .env".
3. Admin › AI provider: tick the approval, provider Claude, write who approved it, Save.

Without it, the chat answers from the knowledge engine; a message with nothing searchable ("hi", "thanks") gets a short hello instead of "not documented".

## API (all under `/api/v2`, signed-in users; same session cookie and CSRF header as the rest)

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/chat/conversations` | create a conversation |
| GET | `/chat/conversations?q=` | list, or search titles and messages |
| GET | `/chat/conversations/:id` | the conversation with every message and structured answer |
| POST | `/chat/conversations/:id/messages` | `{ content, mode?, depth? }` → `{ question, answer }` |
| PATCH | `/chat/conversations/:id` | rename `{ title }` |
| DELETE | `/chat/conversations/:id` | delete |
| POST | `/chat/search` | `{ q }` → knowledge passages, registered screens, guides |
| GET | `/chat/screens`, `/chat/screens/:id` | Screen Registry |
| GET | `/chat/guides`, `/chat/guides/:id` | visual guides (stored or `GUIDE-PROC-…`) |
| GET | `/chat/workflows/:id` | stored workflow: steps, related screens, navigation |
| GET | `/chat/navigation/:id` | resolve a destination: route + query or verified URL, `allowed` for this user, `reason` when not |
| GET | `/chat/assets/:dir/:file` | guide screenshots (no path can leave `knowledge/registry/assets`) |

The older `/conversations…` routes keep working (the page now uses `/chat/…`).

## Front end

- `src/app/platform/guide.ts`: `kb-guide` (screenshot with numbered markers, instruction, expected result, Previous/Next, progress bar, step dots, enlarged view with arrow keys and Esc, prototype link, honest notes) and `kb-actions` (registered destinations; disabled with the reason when the role is missing; outside links open in a new tab).
- `shared.ts` (`kb-answer`): guides and actions under the answer; several guides become tabs.
- `kb-assistant.ts`: conversation search and rename, typing indicator with **Stop** (cancels the request), auto-open for "open … screen", `/assistant?guide=GUIDE-…` shows a guide on its own.

## AI provider

Unchanged and provider-independent (`server/ai-core.ts`: Gemini and Claude over plain `fetch`). Keys only in server environment variables (`GEMINI_API_KEY`, `ANTHROPIC_API_KEY`, see `.env.example`); an admin must also record the organisation's approval under Admin › AI. Until then the chatbot answers from the knowledge base only, and general questions ("Explain APIs") get a note that AI mode is off. Migration 005 adds `messages.status` and `messages.token_usage`; token usage stays empty for now because the AI layer does not report it yet.

## Run, update, deploy

```
npm run build              # pages
npm run kb:reindex         # knowledge + documents + registry index
npm run kb:server          # http://127.0.0.1:8787/   (start-on-network.ps1 for the office Wi-Fi)
npm run kb:registry        # add new screens from the v1 data to knowledge/registry/screens.txt (keeps edits)
npm run kb:capture-prototype   # re-capture the Trims Scan prototype guides
```

To add a screen: add an entry to `screens.txt` (APP ROUTE must be a page of this platform, EXTERNAL URL must be https), then `npm run kb:reindex` or restart. To add the live WFX link of a screen, fill its `WFX URL` after checking it.

## Known limits (stated, not hidden)

- **No live WFX application in this project.** "Open the Sales Order screen" opens this platform's documented Sales Order screen (fields, rules, screenshots) and shows the WFX menu path (Order › Purchase Order from Buyer › Quantity BreakUp). The live WFX URLs are not verified, so `WFX URL` is empty everywhere; fill it to add an "Open in WFX" link.
- **Screenshots exist only where they were captured**: the 49 prototype screens and 21 WFX screens of the style/BOM/routing/costing chapter. Most procedure guides are text steps with "No screenshot of this step yet". Click positions on WFX screens are not recorded (only on the prototype).
- **No step-by-step procedure for creating a Sales Order is stored**; the chatbot says so and offers the Sales Order screen and workflow.
- **Claude needs a key**: until `ANTHROPIC_API_KEY` is in `.env` and the approval is recorded, the chat uses the knowledge engine only.
- **Retrieval is lexical** (no embedding model); wording far from the stored words can still be answered "partly documented".
