# Implementation log

Newest entries at the bottom. Each entry: what changed, how it was tested, what is still open.

## 2026-11-16 · Phase 1 – audit and discovery

- Read the whole repository, the sibling `WFX-Product-Demo` build and the knowledge documents reachable on this machine.
- Saved the specification as `PROJECT_MASTER_PROMPT.md` (verbatim, with the supplied folder structure).
- Wrote `PROJECT_AUDIT.md`, `EXISTING_FEATURES.md`, `ARCHITECTURE.md`, `IMPLEMENTATION_ROADMAP.md`, this log, and a first
  `KNOWLEDGE_INVENTORY.md`.
- Runtime check: Node 22.23.1 runs TypeScript directly and ships SQLite with FTS5 and JSON functions, so the knowledge
  server needs no new packages.
- Decision: Downloads contains personal files next to WFX documents, so it is **not** bulk-imported. Curated sources are
  imported (Sprint specifications, the manuals and workbook already used, the demo product specifications); the rest are
  listed for the owner's decision.
- State carried over: the v1 assistant's strict-answer tuning was in progress (112/122 regression questions passing).

## 2026-11-16 · Phase 2 – knowledge foundation

- `database/migrations/` (schema with FTS5), `backend/src/db.ts`, `config.ts`, `util.ts`.
- TXT format (`backend/src/knowledge/txt.ts`): parser that reports problems instead of throwing, exact round trip,
  validation. Library (`library.ts`): atomic writes, append-only history, `change_history.json`.
- Migration (`backend/scripts/migrate-v1.mjs` + `v1-dump.ts`, bundled like the existing CSV export): 647 entries in 27
  files; 43 of the 54 v1 formulas got a restricted EXPRESSION transcribed from their formula text (44 runnable rules with the consumption chain); statuses follow the documented
  policy (assumed → Under Review, the Process Rate "+ vs ×" conflict and the roll inference recorded).
- Index (`backend/src/index/indexer.ts`): chunks, entries, relations stated by entries, vocabulary, abbreviations spelled
  out in the knowledge, catalogue.
- Ingestion (`backend/src/ingest/`): ZIP, DOCX, XLSX, PDF (object streams and ToUnicode maps), HTML, Markdown, Mermaid,
  CSV, JSON, TXT (rule format), images (metadata), DOC/XLS (best effort); analysis (module, transactions, candidates,
  section chunks); pipeline (hash, duplicates, versions with diffs, registry, extracted TXT).
- Imported 34 curated documents (`npm run kb:import -- --curated`): all extractions complete; Sprint 3 V1/V2 recognised as
  one document with two versions. Module detection was too noisy with description words → changed to module and
  transaction names only.
- Tested: library 6/6, ingestion 8/8, workflows 5/5.

## 2026-11-16 · Phase 3 – grounded assistant

- Search (`backend/src/search/`), answers (`backend/src/assistant/answer.ts`), conversations, optional AI (`llm.ts`, off
  until an admin records the organisation's approval).
- Iterated on the 40 everyday questions that failed in v1: first version answered half of them confidently and wrongly;
  added the "does a source answer it" gate (all key terms present and close together, subject in the title, negation next
  to its object, quantifier pairs, transaction context, unknown subject → not documented). Result on the 42-question set:
  retrieval 27/27, status 42/42, hallucinations 0/13.
- Tested: retrieval 7/7 (including the RMPO correction flow and conflict detection).

## 2026-11-16 · Phases 4–5 – documentation pages, rules and calculations

- Rules (`backend/src/rules/rules.ts`): plain-language understanding, related/conflicting rules, drafts, lifecycle with
  role checks, supersede to history, impact analysis. Calculation engine (`backend/src/calc/engine.ts`) with generated
  test cases; 19 formulas reproduce the captured WFX values.
- BA copilot analysis (`backend/src/ba/analyse.ts`), transaction documentation pages, dashboard data (`backend/src/api.ts`).
- Server (`backend/src/server.ts`), accounts and roles (`auth.ts`). API tests 10/10; one crash found and fixed.

## 2026-11-16 · Frontend and checks

- Platform pages in `src/app/platform/` (dashboard, assistant, library, rulebook, transactions, calc lab, BA copilot,
  admin, sign-in), `core/kb.service.ts`, `src/platform.scss`; `/assistant` switches to the grounded assistant when signed in.
- Browser checks on a sandbox instance (`backend/scripts/sandbox-server.ts`), never on the real database: three CSP/MIME
  problems found and fixed. The real instance was left at its first-start state for the owner to create the admin account.
- Decisions: Angular app kept at the repository root (see ARCHITECTURE.md); Downloads not bulk-imported (personal files
  present) – 205 WFX-like documents listed in `discovered_sources.json` for the owner.

## 2026-11-16 · Phase 6 – workflow designer

- `backend/src/workflows/designer.ts`: graphs from stored workflows (prerequisite links documented; listed order
  otherwise) and procedures, from written steps (decisions, roles) or Mermaid; layered layout; validation; test paths;
  version diff; saved as WORKFLOW entries with NODES/EDGES lines, so drafts, approval and history reuse the rule lifecycle.
- API: `/api/v2/workflows` (list, open, generate, check, layout, save, compare). Page: `/workflow-designer` (SVG canvas,
  drag, zoom, editing, checks, test paths, compare, Mermaid/JSON export).
- Tested: designer 6/6, API 11/11 (67 platform tests in total); browser check on the sandbox (one fix: label text was
  selected while dragging).

## 2026-11-16 · Phase 7 – data modelling studio

- `backend/src/datamodel/studio.ts`: captured models from the MODEL entries (header and grids as entities; `from: doc.col`
  becomes a documented link to `DM-<DOC>`; that a grid holds its document's lines is marked inferred) and a map of all
  captured documents; `draftFromText` (entity/attribute lines, "has many", "belongs to one", "has one", many-to-many,
  unknown sentences returned unguessed); `toLogical` (surrogate keys, foreign keys, junction tables, all inferred);
  `checkModel` (normalisation and structure); Mermaid `erDiagram`; data dictionary; DDL draft whose first line says it is
  not the WFX database schema (captured models get no foreign keys, because the key columns are not documented);
  drafts saved as MODEL entries (ENTITIES / RELATIONSHIPS / REQUIREMENT lines) through the rule lifecycle.
- Safety: a draft cannot take the ID of a captured model; the assistant's data-model answers use only captured,
  Approved/Active models, so proposals are never cited as confirmed WFX knowledge.
- API: `/api/v2/models` (list, open with `?view=logical`, draft, check, save, DDL download). Page: `/data-modelling`
  (ER canvas, editing, checks, dictionary, DDL, Mermaid) and a "Data Modelling" tab.
- Tested: studio 6/6, API 12/12 (74 platform tests); evaluation unchanged (27/27, 42/42, 0/13); build 49 routes;
  browser check on the sandbox (one fix: relationship labels hidden behind boxes).

## 2026-11-16 · Chat-to-workflow (Phase 6 extension) and navigation merge

- **Navigation:** the top bar has one **Knowledge** menu (Assistant first); "Workflows" and "Workflow designer" are one top-bar entry with a
  two-view switch, as are "Data Model" and "Data modelling" (`shared/section-switch.ts`).
- **Intent** (`workflows/generate.ts`, `workflowKind`): create / modify / compare / explain / none. Questions that only mention a workflow
  ("How does the MRP workflow work?") stay text answers; edits only count when the conversation already has a draft.
- **Generation:** steps written in the request, a stretch of the end-to-end flow ("from techpack to production order"), a stored workflow or
  procedure that is about the subject, or a transaction's documented dependency links; otherwise a clarification (never an empty graph).
  `enrich` attaches inputs, outputs, rules, dependencies, validations (documented VALIDATIONS lines plus Control/Approval rules),
  screenshots, sources, lane and section to each step; "the closest documented process" is stated when the match is partial.
- **Drafts** (`workflows/drafts.ts`, migration `003_workflow_drafts.sql`): persisted, versioned, private to their owner, linked to the
  conversation; a failed generation keeps the request and error for retry; saving to the library creates a Draft entry (`WF-GEN-…`)
  whose NODE DETAILS / REFERENCES / MODULE / FORMAT round-trip through TXT. New status **Archived** (not current, not confirmed).
- **Chat integration** (`assistant/workflow-chat.ts`): `postMessage` hands workflow requests to the draft path; the answer carries an
  `open-workflow` (or `workflow-failed`) action; the assistant page navigates to `/workflow-designer?draft=…`, the floating chat sends
  signed-in users to the grounded assistant, so every entry point behaves the same. Messages typed in the designer's own box are recorded
  in the originating conversation.
- **Designer:** loads a draft, swimlane / flowchart / sections, overview / detailed, collapsible sections, overlays (validations, rules,
  inputs/outputs, dependencies), step details panel with screenshots and sources, chat box, autosave, versions with open / compare / undo,
  regenerate, save to library, send for review / archive, SVG / JSON / Mermaid export, back-to-chat link, load errors with retry.
- Fixed on the way: the router scroll handler assumed every event had `urlAfterRedirects`; the SVG was scaled down by `max-width: 100%`.
- Tested: 81 platform tests (new chat-workflow suite and an HTTP journey test), evaluation unchanged, build 49 routes, browser journey on the sandbox.

## 2026-11-16 · Correction round: documents → structured workflow → the right picture (see ROOT_CAUSE_ANALYSIS.md)

Files changed
- New: `backend/src/workflows/docflow.ts`, `backend/src/workflows/select.ts`, `src/app/platform/diagram-layout.ts`,
  `tests/workflows/diagrams.test.ts`, `documentation/ROOT_CAUSE_ANALYSIS.md`.
- Changed: `workflows/designer.ts` (schema), `workflows/generate.ts`, `workflows/drafts.ts`, `assistant/workflow-chat.ts`,
  `assistant/answer.ts` (other documents beside an answer), `ingest/pipeline.ts` (glossary rows titled by their term),
  `api.ts` (accepts the new fields), `platform/workflow-designer.ts` (rewritten), `platform/tabs.ts`, `platform/shared.ts`,
  `kb-assistant.ts`, `app.routes.ts`, `app.routes.server.ts`, `platform.scss`, `tests/retrieval/eval-set.json`.

Functionality
- **Knowledge:** 14 Kit/Pack files from Downloads imported (DOC-0034 to DOC-0044, new versions of DOC-0012), as
  `source-documented` specifications. 44 documents, 3,118 passages. Inventory refreshed.
- **Document-grounded workflows (`docflow.ts`):** finds the best documents for a subject, reads the process section, builds the
  main path; optional steps become gateways; if/when/where chains, "A for X; B for Y" contrasts and "A or B" options with stated
  consequences become decisions with labelled branches; validations, business rules and user messages attach to the step they
  are about; field tables of a screen become that step's inputs; statuses become a second (state) graph; screens/tabs become
  lanes; another document that describes the process differently is reported as missing/conflicting information.
- **Structured schema:** workflow (submodule, assumptions, missing information, dependencies, related documents, diagram type);
  node (description, sources with document/version/section); edge (id, kind, condition). Saved in TXT and checked by the API.
- **Diagram selection (`select.ts`):** measures steps, decisions, roles/lanes, parallel paths, transactions, states, depth, tree shape,
  time cues, data links; recommends one of eleven pictures with the reason and lists the others that fit; a stated wish in the
  request ("as a decision tree") wins and is said so.
- **Layouts (`diagram-layout.ts`):** flowchart, swimlane (horizontal, or vertical columns for long sequences), BPMN-style
  (events, gateways, tasks), decision tree, hierarchy, mind map (branches = lanes), timeline (rows of eight), status lifecycle,
  dependency graph, data flow (data stores between steps), illustrated guide (cards). Collapsed sections become one box in every picture.
- **Canvas:** pan by dragging the background, zoom, fit to screen (readable-size rule), mini-map, search with highlight and dimming,
  full screen, section collapse, overlays (validations, rules, inputs/outputs, dependencies), export SVG / PNG / PDF (print) / JSON.
- **Route:** `/workflow-designer/:id` (loaded from the server; survives refresh); the chat navigates to it.
- **Retrieval:** other documents answering the same question are listed beside the answer (not merged); glossary-style table rows
  are findable by their term.

API / database
- API: the workflow draft endpoints accept/return `diagram type`, `assumptions`, `missing`, `dependencies`, `relatedDocuments`,
  node `description`, edge `id/kind/condition`; draft documents carry `lifecycle` and `selection`.
- Database: no new migration (the `workflow_drafts` table from the previous step holds the new document shape as JSON).

Tests executed: `npm run test:kb` 94/94; `npm run kb:typecheck` clean; `npm run kb:evaluate` retrieval 27/27, status 48/48,
hallucinations 0/14; `npm run build` 49 routes prerendered, 50 pages pass SEO checks; browser journey on the sandbox (below, in TESTING_REPORT.md).

Synchronised to `D:\WFX Knowledge hub\ASN`: code, documents and imported Kit/Pack knowledge (the database there was not
touched; its server was restarted with `kb:reindex`, 44 documents, admin account unchanged).

Remaining limitations: see "Not done, and why" in ROOT_CAUSE_ANALYSIS.md.

## 2026-11-16 · All discovered WFX documents imported (as `proposed`)

- 204 files from Downloads imported with `npm run kb:import … --status=proposed`: **135 new documents, 54 new versions of stored documents,
  14 duplicates skipped, 2 rejected** (`ArticleApparelMaster.xls`, `Bug Defect for 391843.xls`: not real legacy Excel files). Library now
  **180 documents, 237 versions, 16,416 passages**. Originals are copied unchanged into `knowledge/original_sources/`.
- They are `proposed` (change requests and drafts), not approved specifications: answers from them are labelled provisional, and
  nothing from them counts as confirmed knowledge until a rule is approved.
- Quality check after the import found real regressions, fixed in `assistant/answer.ts` and `search/search.ts`:
  (1) 16,000 document passages crowded reviewed entries out of the 16 retrieval candidates → entries and documents are now searched as
  two pools and merged; (2) a calculation question was answered by prose from a proposed document instead of the reviewed calculation
  rule → the reviewed rule comes first when it fits; (3) a yes/no question ("can one RMPO have multiple suppliers") was answered from a
  proposed requirements document that only raised the question → yes/no questions are not answered from proposed documents;
  (4) a confirmed entry that answers as well as an unreviewed document now ranks first.
- `docflow.ts` compares up to eight candidate documents (was four) so a conflicting process description is still reported.
- Evaluation with 180 documents: retrieval 27/27, status 48/48, hallucinations 0/14. Tests 94/94.
- Not read: scanned PDFs and images (no OCR), the 2 rejected files.

## 2026-11-17 · Create your own account from the frontend

- **Why:** the owner could not sign in (the existing admin was `Still_Unknown`, created at first start) and asked for a way to create an
  account from the web page.
- **Design:** sign-up never grants more than *viewer*. An admin chooses the policy (Admin → Users and roles): `off`, `approval` (default:
  the account is created disabled and pending, and cannot sign in until an admin approves it and picks its role) or `open` (active at once,
  signed in). Stored in `settings` (`signup.mode`); migration `004_signup.sql` adds `users.pending`.
- **Files:** `backend/src/auth.ts` (signupMode, signup, isPending, approveUser, rejectUser), `backend/src/api.ts` (`POST /auth/signup`,
  `GET/PUT /settings/signup`, `POST /users/:id/approve|reject`, health and `/auth/me` report the mode), `backend/scripts/set-user.ts`
  (+ `npm run kb:user`: terminal recovery that asks for the password hidden), `src/app/platform/login.ts`, `admin.ts`, `core/kb.service.ts`.
- **Safeguards:** 5 requests per hour per computer; at most 50 pending requests; the public sign-up refuses while the first-run setup is
  unfinished; every sign-up, approval, rejection and mode change is in the audit trail; passwords follow the existing policy.
- **Tests:** 95/95 (new API test); browser check on the sandbox (form → "Request sent" → Admin shows the request → Approve → the account signs in as a viewer).
- **Limits:** no email verification (there is no mail service), so approval by an admin is the control; open mode should only be used on a private network.

## 2026-11-17 · Profile page and the admin directory (TXT + search)

- **Profile** (`src/app/platform/profile.ts`, route `/profile`, Knowledge menu and the name at the top): own details, change password; admins get an
  **Add a new user** form (same API as Admin) and a view of the directory file. API: `GET /profile`, `GET /admin/directory` (admin).
- **Admin directory** (`backend/src/admin/directory.ts`): `knowledge/admin/users.txt` is rewritten on every account change (add, sign-up, approve,
  reject, role/disable) and at server start; the same blocks are indexed as passages of kind `admin_user`. Search excludes that kind unless
  `includeAdmin` is set, which only `answerQuestion` does for an administrator, so a viewer, editor or approver can never retrieve it.
  The file holds names, roles, status and creation date only: no password, hash, token or last-sign-in time.
- **Vector database:** not built. The index is SQLite full-text search with synonyms and ranking (lexical). A vector database needs an embedding
  model (an AI provider key and the organisation's approval to send text to it); nothing here pretends to be semantic search.
- **Limits:** a user name added since the last re-index is not yet in the spelling vocabulary, so ask by role ("who has the approver role") or run Admin → Re-index.
- Tests 96/96.

## 2026-11-17 · Workflow designer: Buyer Block Booking optional, readable big flowcharts

- **Report:** "the workflow designer is not working correctly" and "BBB will not always be in the workflow". Reproduced on the stored end-to-end flow:
  BBB was a fixed step in seven stored workflows (and every flow generated from them), although the documented scenarios "Order without booking" and
  "Style setup only" skip it; and the 35-step flowchart was a tangle (long lines behind boxes, crossings), because the layout only spread boxes by depth.
- **BBB** (`generate.ts`, `makeBookingOptional`, run by `enrich`): every run of BBB steps becomes an optional branch behind a decision "Booked against a
  Buyer Block Booking?" (yes → the steps, no → what follows); a run that leads nowhere else is marked as an optional side branch. The gateway is
  `inferred` and says why (WF-SCENARIO-DIRECT). Workflows about booking (name contains block booking / booked / booking, or more than 55 % BBB steps) are left alone; idempotent.
- **Layout** (`diagram-layout.ts`): layered flowchart with root compression and six crossing-reduction sweeps; used until the user drags a box (then every
  box is pinned where it is, saved as `pinned` in NODE DETAILS); **Arrange** returns to the automatic layout without a server call.
- **Stored workflows** open in the recommended picture (`GET /workflows/:id` returns `selection`); selecting a step highlights its connections and fades the rest and the long ones.
- Tests 98/98; browser check on the sandbox (end-to-end flow as swimlane by module, BBB gateway, drag moves one box only).
- Known limit: edges still route straight between boxes (no dummy nodes), so in a very dense flowchart a line can pass behind a box; the swimlane, BPMN and tree pictures avoid most of this.

## 2026-11-18 · Apparel techpack/BOM/routing knowledge; crisp answers; calmer UI

- **Apparel techpack, BOM and routing (owner text DOC-0181, screenshot DOC-0182):** 23 new entries and 5 new versions (Price Per rule and fields, Material Type, buyer department filter, division auto-fill,
  four Price Per terms, cost sheet template, routing process, normal material flow, one creation procedure, two dependencies). Open questions are recorded inside the entries
  (fields that change per Material Type, where cost sheet templates are defined, stitching vs sewing, Color/Size grid layout, Process Rate formula). The earlier Process Rate conflict is unchanged.
- **Indents Inactive (owner, 2026-11-18):** the rule "User Group and Purchase Officer" (RULE-SETUP-BOM-INDENT-OWNER) and its term were restated crisply (v4 / v3): no User Group and Purchase Officer on
  the BOM → indents are Inactive by default → mark them Active by hand (User Indent list or Indent list) before MRP or any other action. The assistant now answers "why do indents come in inactive status",
  "what happens if … are not set on BOM" and "how do I activate" in one or two sentences.
- **Why the answers were vague:** (1) a "why" question only accepted sentences containing because/so that/purpose; a cause written as "If … not filled, … Inactive" was rejected → conditions and defaults now count;
  (2) "set" did not match "filled"/"blank" → new synonym group, also used by the negation check; "come/comes" no longer counts as an unknown word; (3) the answer was the whole passage → `focusAnswer` picks the one or two sentences
  that share most words with the question (≤ 380 chars); explanation, rules, dependencies and related text are marked `extra`.
- **UI:** the assistant shows the answer, one source line and "More detail" (explanation, rules, all sources, origin); mode and detail moved under "Options"; conversation list hidden until there is one; the page headline is gone
  for signed-in users. The Workflow Designer opens with the picture in the first screen: details (ID, version, recommendation, sources) fold into "Details", editing tools into an "Edit" menu, the chat is one line.
- Evaluation: 54 questions (33 retrieval, 54 status, 0/14 hallucinations). Tests 98/98 (library migration test now allows entries added after v1).
- Not done: the other platform pages (dashboard, library, rulebook, admin, data modelling) keep their layout; only the assistant and the designer were decluttered.

## 2026-11-18 · Dashboard, rulebook, library decluttered
- Dashboard: six key tiles (documents, approved rules, rules in review, to review, unanswered questions, workflows); "Waiting for review" and "Knowledge gaps" first; recent updates, topics and conversations folded under "Recent activity".
- Rulebook: intro paragraph and Search button removed (Enter searches). Library: "Add documents" folded (drop files still works); table reduced to Title (with ID), Module, Status, version, full width until a document is opened.
- All platform pages use one compact page title (`.kb-h1`). Checked in the browser on the sandbox; tests 98/98.

## 2026-11-18 · Chatbot: product expert, process trainer and navigator

- **Request:** an intelligent ERP assistant with knowledge retrieval, screenshot-based guides with click markers, the Trims Scan prototype, direct navigation through a registry, intent classification, persistence and a better chat UI (pasted master prompt + owner's three recommendations).
- **Reused, not duplicated:** the existing server, SQLite database, conversations, retrieval, AI layer (Gemini/Claude, keys in env, admin authorisation) and Angular pages. Details: documentation/CHATBOT.md.
- **New stores, kept separate and linked by IDs:** Screen Registry `knowledge/registry/screens.txt` (41 entries: 24 captured WFX screens with menu paths and screenshots, 8 transaction pages, 4 guided workflows, 6 platform pages… plus the verified prototype link), visual guides `knowledge/registry/guides/*.txt` with images in `knowledge/registry/assets/`. Index tables `reg_screens`, `reg_guides` (migration 005), rebuilt by `syncRegistry()`.
- **Trims Scan prototype:** `npm run kb:capture-prototype` drives the prototype in headless Chrome/Edge and captured 49 real screens over six flows; 28 steps carry the exact tap target (the prototype's own hint, or the control that really advances it). Two capture bugs found and fixed during review: screenshots taken while a pop-up was still opening, and labels containing "|".
- **Navigator** (`assistant/navigator.ts`): open-a-screen (auto-navigates, role checked, unregistered screens refused), prototype walkthroughs (one flow or all six in order), clarification for one- or two-word subjects, guides from documented procedures (`GUIDE-PROC-…`), registered actions on ordinary answers, "how do I …" without a stored procedure answered as partly documented instead of with an unrelated procedure.
- **Retrieval fixes found while testing:** a how-to procedure must name the subject in its title (stopped "create a Sales Order" → sample-order procedure); "where can I configure …" is a how-to, and a scenario that only contains "setup" no longer answers it; "configured/defined/maintained" removed from the set/filled synonym group (too broad).
- **API:** `/api/v2/chat/*` (conversations incl. rename and search, search, screens, guides, workflows, navigation, assets).
- **UI:** guide viewer (markers, progress, Previous/Next, step dots, enlarged view with keyboard), action buttons, conversation search and rename, typing indicator with Stop, `/assistant?guide=…`.
- **Tests:** new `tests/api/chatbot.test.ts` (7 tests: registry, intents, permission-checked navigation, guides and images incl. path traversal, search, scenarios B/D/E/F/G and how-to/clarify, rename/search/privacy). Total 105/105. Evaluation 33/33 · 54/54 · 0/14. Browser: trims GRN guide, enlarged view, "Open the GRN screen" opens the GRN page, "Sales Order" clarification, Sales Order workflow opens in the designer.
- **Not done / dependencies:** live WFX URLs (no verified ones; `WFX URL` empty), screenshots and click positions for most WFX procedures, a Sales Order creation procedure, AI mode for general questions (no provider key on this server), token usage, semantic search.

## 2026-11-18 · Claude answers every chat message (owner: "assistant is third grade … use Claude, do not hardcode")

- **Problem:** greetings got "not documented"; intent was decided by hand-written rules; Claude was only an optional rewriter (and its request still sent `temperature`, which current Claude models reject).
- **Change:** `assistant/claude-chat.ts` (official `@anthropic-ai/sdk` 1.10, Tool Runner, `claude-opus-5-5`, effort medium, server-side fallbacks). Claude decides what a message is and uses 10 tools over the platform (search, screens/guides, show guide, links with role check, workflow designer, calculation, rule draft + save as Draft, requirement analysis, review queue). Cited sources only; new answer status `conversation`. `conversations.postMessage` uses it when `claudeActive()` (credential + recorded approval), falls back to the knowledge engine on errors; token usage stored. `server.ts` reads `.env` (key stays on the server, `.env` in .gitignore). v1 `server/ai-core.ts`: no temperature, default model claude-opus-5-5.
- **Offline fallback:** a message with no searchable word gets a hello (no phrase list).
- **Tests:** `tests/api/claude-chat.test.ts` (7) drives the real tools through a scripted stand-in for the API: greeting → conversation, request parameters (model, fallbacks, no temperature), cited-only sources, not documented, registered-only links with role check, guides, workflow designer, calculation, rule draft saved only by an editor, review queue, offline greeting. Total 112/112 (twice in a row; one earlier run had a single failure I could not reproduce). Build OK.
- **Not verified:** a real Claude call — no key on this machine. Needs `ANTHROPIC_API_KEY` in `.env` and the approval in Admin › AI.

## 2026-11-18 · Interpreting the questions users actually asked (no Claude key yet)

Read the questions in the live server's conversations and re-asked each one. Fixed in the knowledge engine (the fallback when Claude is off):
- **Calculation written as a sentence** ("consumption of 1 Meter, loss 10%, wastage 2% … tell me the total consumption"): two or more numbers plus "total / tell me / what is / how much" is a calculation; inputs are read with the lexicon's synonyms ("consumption" fills Cons Qty); a unit after a number ("1 meter", "500 pcs") is part of the number. Result 1.192982 (with 5 % shrinkage), confirmed, from CALC-CONSUMPTION-CHAIN.
- **"when I don't select purchase officer and user group…"**: dont/didnt/doesnt are negations; select/choose join the set/filled group → the Inactive-indent rule.
- **"loss %"**: a lone % reads as "percentage", which is not a search word and never joins a phrase; titles like "Loss %" are the term "loss".
- The two "indent inactive" questions already worked after the rule rewrite.
- Six of these questions are now in the evaluation set: retrieval 39/39, status 60/60, hallucinations 0/14. Tests 112/112. Index rebuilt (normalisation changed).
- Still partial (honest): "how to cancel indent from mrp" (no stored procedure for cancelling); "Generate workflow for costing to FPPO" asks which workflow. With Claude on, these are interpreted by Claude through the same tools.

## 2026-11-18 — Taste-skill pass (branch taste-pass)
Applied the rules of github.com/leonxlnx/taste-skill to the existing design system. No routing, data or simulator logic changed.
- Fonts: Geist (headings at 500 with -0.035em tracking, -0.045em on the hero; UI; body 16/26) and Geist Mono for quantities. Fraunces, Inter and Plex Mono removed. Labels are sentence case at 13px; nothing is smaller; tracked capitals removed everywhere.
- Icons: one Lucide (ISC) set, generated into src/app/shared/icon-data.ts by backend/scripts/build-icons.mjs.
- Colour: the accent fills only the primary button; links and focus use it too. Heading second phrases step back in grey instead of orange italic.
- Buttons: 44px, 8px radius, 24px padding, 16px label; 1px lift on hover, 1px press with scale .985.
- Motion: in 150ms, out 120ms, press 90ms. Linked cards lift 2px with a darker border and a soft shadow (pointer devices only). Text-link underlines draw left to right. The page title rises once on load, then lead and actions fade up 12px, 60ms apart. Scroll reveals and load-time card staggers removed (Reveal directive deleted). Reduced motion: nothing moves, everything is visible.
- Radius tokens 8/12/20.

## 2026-11-19 — WFX brand (branch wfx-brand)
Look taken from the WFX v10 design system (D:\wfx-workspaceV10\v10\frontend, read only; nothing there was changed).
- Logo: the WFX cloud + "WFX" logo from wfx-ui `wfx-brand-logo` (fixed brand gradient #43CECD → #1F6DB7), shown as "WFX | Atlas" in header and footer (`src/app/shared/brand-logo.ts`). Favicon is the WFX cloud (favicon.svg; the .ico/.png icons are still the old mark).
- Font: DM Sans, the WFX product font (files copied from wfx-ui styles/fonts). Geist Mono stays for numbers.
- Colours: the WFX palette from wfx-design-tokens — primary #0099C4 (hover #0087AD) on primary buttons, neutral greys, dark theme on #111827. Accent TEXT uses WFX primary 800 #007596, because #0099C4 is only 3.2:1 on white. Radii follow WFX: 6 / 8 / 12.
- The v10 skills (wfx-mock-screen, wfx-build-live-screen, …) build screens inside the v10 Nx app and do not apply to this separate site.
- Same day, at the owner's request: colours restored to the original palette (warm paper, orange accent). Kept from the WFX brand: logo, favicon, DM Sans, radii 6/8/12.
