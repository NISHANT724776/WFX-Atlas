# WFX ERP Knowledge & Intelligence Platform (ASN folder)

This folder holds all the code and knowledge of the WFX knowledge platform: the public **Knowledge Hub** site (workflows,
data model, theory, formulas, glossary) and the **knowledge server** that stores your documents and business rules,
answers questions only from them, and keeps every change versioned.

The product specification is [PROJECT_MASTER_PROMPT.md](PROJECT_MASTER_PROMPT.md). Design, status and test results are in
[documentation/](documentation/): [ARCHITECTURE](documentation/ARCHITECTURE.md), [ROADMAP](documentation/IMPLEMENTATION_ROADMAP.md),
[IMPLEMENTATION LOG](documentation/IMPLEMENTATION_LOG.md), [INVENTORY](documentation/KNOWLEDGE_INVENTORY.md),
[ROOT CAUSES](documentation/ROOT_CAUSE_ANALYSIS.md), [TESTING](documentation/TESTING_REPORT.md), [EVALUATION](documentation/KNOWLEDGE_EVALUATION.md), [SECURITY](documentation/SECURITY_REVIEW.md).

## Start the platform

```bash
npm install          # first time only
npm run build        # builds the site (and its CSV data, SEO checks)
npm run kb:server    # knowledge server + site on http://127.0.0.1:8787/
```

On the **first start** the server prints a one-time setup token in its console. Open `http://127.0.0.1:8787/login`,
paste the token and create your admin account. Then add colleagues in **Admin** with a role: viewer (read and ask),
editor (upload, draft), approver (approve and activate rules), admin.

Anyone who can reach the server can ask for an account from the sign-in page (**Create an account**). It is always a *viewer*; by default an
admin approves each request in **Admin → Users and roles**, where the setting can also be switched off or opened. If nobody can sign in,
run `npm run kb:user -- --username <name> --role admin` in a terminal (it asks for the password, hidden); `npm run kb:user -- --list` shows the users.

**Profile** (Knowledge menu or your name at the top): change your password; admins also add users there. The account list is kept in the readable file
`knowledge/admin/users.txt` (no passwords) and only administrators can ask the assistant about it.

To try things without touching the real knowledge base, `node --disable-warning=ExperimentalWarning backend/scripts/sandbox-server.ts`
starts a throw-away copy on port 8788 (its test login is written to a file in the system temp folder).

## How knowledge gets in

| You have | Do this |
| --- | --- |
| A document (Word, Excel, PDF, CSV, TXT, Markdown, HTML, Mermaid, JSON, image) | **Library → Add documents**, or `npm run kb:import -- "<file or folder>" --status=source-documented` (approved specs, manuals) / `--status=proposed` (change requests) |
| A rule in your own words ("In RMPO, Open Qty = Order Qty minus Received Qty") | **Rulebook → Teach a rule** (or the assistant's *Analyse business rule* mode). Review what was understood, the missing details and any stored rule it conflicts with; save as a draft or, as approver, activate it |
| A correction of an existing rule | Save it as the next version of that rule; the old version moves to history as Superseded when the new one is activated |
| A process to see | Ask the assistant (or the floating chat): "Create a workflow for Sales Order processing", "Show me the complete MRP workflow", "Make a workflow from techpack to production order", "Generate a complete workflow for Kit/Pack". The workflow is read from the stored documents and entries, the picture that fits its structure is chosen (you can switch to another view of the same workflow), and you are taken to the **Workflow Designer** at `/workflow-designer/<id>` with the generated draft; type changes ("Add the BOM creation step after …", "Show the validations at every stage", "Show this as a swimlane diagram"), then save it to the library. Questions about a workflow stay in the chat |
| A process to document | **Workflow Designer**: open a stored workflow or procedure, or write the steps ("If …, …, else …" makes a decision) or paste Mermaid; arrange, check, save as a draft and approve it in the Rulebook |
| A data design to think through | **Data Modelling**: open a captured WFX document (or the map of all of them), or write the requirement ("Supplier: code (key), name", "An order has many lines"); switch to the logical view, read the checks, download the DDL draft (never WFX schema), save as a draft |
| Many entries to edit at once | Edit the TXT files in `knowledge/` directly, then **Admin → Re-index** (or `npm run kb:reindex`) |

Only **Approved / Active** entries count as confirmed WFX knowledge. Every answer says whether it is Confirmed, Documented
(in a source document), Provisional, Conflicting, Partly documented or Not documented, and lists its sources.

## Commands

```bash
npm start            # site development server (proxies /api/v2 to a running knowledge server)
npm run kb:server    # the knowledge server
npm run kb:import -- <path> [--status=…] [--type=…] [--module="…"]   # import files or folders
npm run kb:reindex   # rebuild the index from knowledge/
npm run kb:ask -- "question" [--detailed]                          # ask from the command line
npm run kb:inventory # refresh the generated part of KNOWLEDGE_INVENTORY.md
npm run kb:evaluate  # run the evaluation set, write KNOWLEDGE_EVALUATION.md
npm run kb:migrate -- --check                                       # v1 → TXT migration counts (never overwrites edits)
npm run kb:typecheck # strict TypeScript check of the backend
npm run test:kb      # 96 platform tests (sandboxed)
npm run test:ai      # AI provider adapter (offline)
npm run test:ask     # v1 offline assistant regression
```

## Folder map

| Folder | What is in it |
| --- | --- |
| `knowledge/` | **The knowledge (source of truth).** `original_sources/` (files as uploaded, never changed), `business_rules/`, `calculations/`, `glossary/`, `modules/`, `transactions/`, `workflows/`, `data_models/` (readable TXT entries), `review/pending.txt` (drafts), `history/` (superseded versions), `extracted/` (what was read from each document), `metadata/` (catalogue, source registry, change history, discovered sources) |
| `backend/` | Knowledge server: API, accounts, ingestion, TXT library, search, assistant, rules, calculation engine, BA copilot; `scripts/` for import, migration, re-index, evaluation |
| `database/` | Schema migrations; `wfx_knowledge.db` is the rebuildable index plus users, conversations and audit trail; `backups/` |
| `tests/` | `calculations/`, `knowledge/`, `ingestion/`, `retrieval/`, `workflows/`, `datamodel/`, `api/` |
| `src/` | The Angular site (frontend). Platform pages are in `src/app/platform/`; v1 pages in `src/app/pages/` |
| `server/ai-core.ts`, `api/` | Optional AI provider calls (Gemini, Claude), used by the knowledge server and the Vercel functions |
| `scripts/`, `data/`, `public/` | v1 site build: CSV export, SEO files, post-build checks |

## AI provider (optional)

Without a provider the assistant answers from the knowledge base alone. To let Gemini or Claude write answers, set the key
as an environment variable on the server (`GEMINI_API_KEY` or `ANTHROPIC_API_KEY`, see [AI-MODE.md](AI-MODE.md)) **and**
record in **Admin → AI provider** who approved sending WFX knowledge to it. Only the few passages behind one answer are
sent, never the library, and the answer must cite them.

## The public site

`npm run build` produces a static site in `dist/wfx-knowledge-hub/browser` that still works on Vercel without the server
(platform pages then explain how to start the server). Before going live, set `SITE.url` in `src/app/data/catalog.ts`.


## Chatbot (navigator and visual guides)

See [documentation/CHATBOT.md](documentation/CHATBOT.md): Screen Registry, visual guides, Trims Scan prototype capture, `/api/v2/chat` API, known limits.
