# Architecture

## 1. Principles

1. **The owner is the source of WFX knowledge.** The platform organises, connects and retrieves it; it never invents WFX
   behaviour. Anything not documented is reported as not documented; inferences are labelled.
2. **Three layers, always traceable** (specification Part 3):
   - **Layer A – original sources** (`knowledge/original_sources/`): byte-identical copies, one folder per document and version.
   - **Layer B – normalised knowledge** (`knowledge/**/*.txt`): readable UTF-8 TXT files with stable IDs. **Business rules,
     calculations, terms, transactions, procedures, workflows and data models live here; these files are the source of truth.**
   - **Layer C – application index** (`database/wfx_knowledge.db`): SQLite with full-text search, versions, statuses,
     relationships, conversations, users and the audit trail. It can be rebuilt at any time from Layers A and B.
3. **No new runtime dependencies.** Node.js 22 already provides SQLite (`node:sqlite`, with FTS5), zlib, crypto and HTTP.
   The server runs TypeScript directly (Node type stripping). Fewer moving parts, nothing to compile, nothing to patch.
4. **The AI provider is optional and replaceable.** Retrieval, rules and calculations never depend on a language model.
   With no provider configured the assistant still answers from the knowledge base, extractively, with citations.
5. **Deterministic business maths.** Calculations run in a restricted expression engine over versioned rules; a language
   model never does the arithmetic.

## 2. Folder map

| Folder | Role |
| --- | --- |
| `knowledge/` | Layers A and B (see section 4). Human-readable, exportable, version-recorded. |
| `backend/src/` | Knowledge server: HTTP API, auth, ingestion, TXT library, search, assistant, rules, calculations, workflow designer (`workflows/`), data modelling studio (`datamodel/`). |
| `backend/scripts/` | Command-line tools: v1 migration, folder import, re-index, export, backup. |
| `database/migrations/` | SQL schema, applied in order and recorded in `schema_migrations`. The `.db` file is runtime data. |
| `tests/` | `ingestion/`, `retrieval/`, `calculations/`, `knowledge/`, `workflows/`, `datamodel/`, `api/` — Node's built-in test runner. |
| `documentation/` | Audit, inventory, architecture, roadmap, implementation log, testing and security reports. |
| `src/` | **Frontend** (Angular 21). Kept at the repository root: moving it into `frontend/` would change every build path, the Vercel settings and the preview configuration for no functional gain. |
| `server/ai-core.ts`, `api/` | Provider-neutral AI calls (Gemini, Claude) shared by the knowledge server and the Vercel functions. |
| `scripts/`, `data/`, `public/` | Existing static-site build (CSV export, SEO files, post-build checks). Unchanged. |

## 3. Runtime view

```
Browser (Angular)
  ├─ static pages (workflows, data model, theory, formulas, glossary, data)  ← unchanged, work offline / on Vercel
  └─ platform pages (dashboard, assistant, library, rulebook, explorer, calc lab, workflow designer,
                    data modelling, BA copilot, admin)
         │  fetch /api/v2/*  (cookie session, X-Requested-With header)
         ▼
Knowledge server  (node backend/src/server.ts, default 127.0.0.1:8787)
  ├─ auth + roles + rate limits + audit
  ├─ ingestion pipeline ── Layer A files, extracted TXT, candidates
  ├─ TXT library ───────── Layer B files, history, change_history.json
  ├─ index (SQLite FTS5) ─ chunks, entries, versions, relations
  ├─ assistant ─────────── retrieval → answer composer → optional LLM (server/ai-core.ts)
  ├─ rules + calc engine ─ lifecycle, versions, impact, deterministic maths, test cases
  ├─ workflow designer ─── graphs from stored flows/procedures/text/Mermaid, checks, test paths (WORKFLOW entries)
  ├─ chat → workflow ───── intent, generation from the knowledge, step details, plain-language edits, persisted drafts (workflow_drafts)
  ├─ data modelling ────── captured models, drafts from requirements, logical view, checks, ER, DDL draft (MODEL entries)
  └─ static file server for the built Angular site (one process serves everything)
```

The static site keeps working on Vercel without the server; platform pages then show "knowledge server not connected"
and the floating assistant falls back to the v1 rule engine.

## 4. Knowledge layout and TXT format

```
knowledge/
  original_sources/DOC-0001/v1/<original file name>     Layer A (never modified)
  extracted/DOC-0001_v1.txt                             readable extraction of each document version
  business_rules/*.txt   calculations/*.txt   glossary/*.txt
  modules/*.txt          transactions/*.txt   workflows/*.txt (+ .mmd, .json)   data_models/*.txt
  review/pending.txt                                    drafts and new versions waiting for approval
  history/<ENTRY-ID>.txt                                every superseded version, append-only
  metadata/knowledge_catalog.json  source_registry.json  change_history.json  discovered_sources.json
```

Each TXT file holds entries separated by a line of `=` characters. An entry starts with its ID line; every other line is
`KEY: value`. Values that span lines continue on lines indented by two spaces. Lines starting with `#` are comments.

```
================================================================================
RULE ID: CALC-BOM-CONSUMPTION-CHAIN
RULE NAME: Total consumption (loss, wastage, shrinkage)
MODULE: Style & BOM
TRANSACTION: BOM – Materials & Dependency
RULE CATEGORY: Calculation
FORMULA / LOGIC:
  Loss Factor = 1 ÷ (1 − Loss %)
  ...
CALC INPUTS:
  cons_qty | Cons Qty | number | required
  loss_pct | Loss % | percent | default 0
EXPRESSION:
  loss_factor = 1 / (1 - loss_pct / 100)
  ...
CALC OUTPUT: total_consumption
SOURCE: Product owner, chat 2026-11-12
VERSION: 1
STATUS: Active
```

| ID key | Entry type | Files |
| --- | --- | --- |
| `RULE ID` | business rule, validation or calculation | `business_rules/`, `calculations/` |
| `TERM ID` | glossary term | `glossary/` |
| `MODULE ID` | module | `modules/` |
| `PROCEDURE ID` | procedure / how-to (user manuals) | `modules/` |
| `TRANSACTION ID` | transaction documentation | `transactions/transaction_definitions.txt` |
| `FIELD ID` | field definition | `transactions/field_definitions.txt` |
| `DEPENDENCY ID` | transaction dependency | `transactions/transaction_dependencies.txt` |
| `CASE ID` | observation / mismatch / rule noted during capture | `transactions/transaction_cases.txt` |
| `WORKFLOW ID` | workflow | `workflows/` |
| `MODEL ID` | data model (captured screen-level or proposed) | `data_models/` |

Common keys on every entry: `SOURCE`, `VERSION`, `STATUS`, `CREATED DATE`, `LAST UPDATED`; optional `INFERENCE` (marks
content that is inferred, not stated by a source) and `OPEN QUESTION`.

### Status lifecycle

`Draft → Under Review → Approved → Active → Superseded`, plus `Rejected` for drafts that are turned down.

| Status | Treated as | Who can set it |
| --- | --- | --- |
| Draft | provisional | editor, approver, admin |
| Under Review | provisional | editor, approver, admin |
| Approved | confirmed (not yet in effect) | approver, admin |
| Active | confirmed, current | approver, admin |
| Superseded | history only (never retrieved as current logic) | automatic when a newer version becomes Active |
| Rejected | history only | approver, admin |

A change to an Active entry creates version *n+1* as a Draft in `review/pending.txt`; version *n* stays Active until the
new one is activated, then moves to `history/` as Superseded. Nothing is overwritten silently; every transition is written to
`metadata/change_history.json` and the database.

**Migrated v1 knowledge:** content transcribed from documents the owner supplied (Sprint specifications, user manuals, the
NIS-58 workbook, screenshots) and formulas marked `verified` in v1 are migrated as **Active**, with the source recorded.
Formulas marked `assumed` in v1, and content that was inferred, are migrated as **Under Review** with their open question.
The owner can change any status in the Rulebook.

## 5. Ingestion pipeline

1. Validate (extension allow-list, size limit, magic bytes) and hash (SHA-256).
2. Duplicate check by hash; same base name with new content → **new version** of the existing document.
3. Store the original untouched in Layer A.
4. Extract a structured model per type: DOCX (headings, paragraphs, lists, tables), XLSX (sheets, rows, typed columns),
   CSV (headers, types, units, identifiers, rows), PDF (text with page numbers), HTML and Markdown (headings, tables,
   lists, Mermaid blocks), JSON (tables or key paths), Mermaid (nodes, edges, decisions, labels, direction, start/end),
   TXT (rule-format entries or text), images (format and dimensions; text inside images needs a vision model).
   Legacy DOC and XLS get best-effort text recovery and are marked partial.
5. Classify: subject, module, transactions, definitions, formulas, validations, workflow steps, entities and tables.
6. Chunk by section with the heading path; tables become table chunks plus row chunks.
7. Index (FTS5), write `extracted/DOC-xxxx_vN.txt`, record candidates (possible rules) for review, compare with the previous
   version (sections added, removed, changed; formulas and validations added or removed).

Documents keep a knowledge status: `source-documented` (owner-supplied manuals and specifications), `proposed` (change
requests), `reference` (demo data) or `unreviewed` (uploads not yet reviewed). Candidates never become rules without review.

## 6. Retrieval and answering

1. Detect the question type (definition, how-to, calculation, comparison, workflow, validation, dependency, why,
   what-if, data lookup) and the mode chosen in the UI.
2. Find known terms and phrases; fix spelling against the index vocabulary; expand synonyms and abbreviations.
3. FTS5 BM25 search over current chunks (titles weigh most), then re-rank by coverage of the question's terms, title
   coverage, entry type fitting the question type, and knowledge status.
4. Confidence check: every distinctive term of the question must be found in the selected sources. Terms the knowledge
   base never mentions are reported as missing.
5. Compose the answer from the sources: Answer, Explanation, Steps, Business Rules, Calculation (run by the engine),
   Dependencies, Sources, Knowledge Status. With an AI provider configured, the model writes the answer **only from the
   numbered sources**, must cite them, and its citations are checked; it falls back to the extractive answer on any failure.
6. Follow-ups reuse the conversation's topic (stored per conversation): "why is this required", "next step",
   "show the same process as a workflow", "what happens if the quantity is zero".
7. When nothing supports the answer: "The currently stored WFX documentation does not contain sufficient information to
   confirm this." plus exactly what is missing; the question is logged as a knowledge gap.

Documents and their text are treated as untrusted data: they are never executed, and the model is told to ignore any
instruction inside them.

## 7. Security model

Local accounts with roles (`admin`, `approver`, `editor`, `viewer`); scrypt password hashes; HttpOnly SameSite=Strict
session cookies stored hashed; a required `X-Requested-With` header and origin check on every state-changing request;
login and chat rate limits; upload type and size limits; path-traversal-safe file serving; security headers; audit log
of every change; the server binds to 127.0.0.1 unless configured otherwise. First start prints a one-time setup token in the
server console; the owner creates the first admin account with it. AI keys stay in environment variables.

## 8. Deployment

- **Now:** the knowledge server runs on the owner's machine (`npm run kb:server`); the static site can stay on Vercel.
- **Later (WFX domain on AWS or Azure):** the server is a single Node.js process with a data folder (`knowledge/` and
  `database/`). Any VM, Azure App Service or AWS ECS/App Runner with a persistent volume fits; put HTTPS in front and set
  `WFX_HOST=0.0.0.0`. Vercel serverless functions alone cannot host it (no persistent disk).
