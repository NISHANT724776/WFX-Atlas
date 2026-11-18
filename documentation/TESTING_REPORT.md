# Testing report

Run on 2026-11-16 (Windows 11, Node 22.23.1). Commands and results are exactly as recorded; nothing is claimed that was
not run.

## Automated suites

| Command | What it covers | Result |
| --- | --- | --- |
| `npm run test:kb` | 98 tests in 9 suites (below), Node's test runner, every file in its own process on a temporary copy of the knowledge folder and a temporary database | **98 / 98 pass** |
| `npm run kb:typecheck` | Strict TypeScript check of the whole backend, scripts and tests | **0 errors** |
| `npm run build` | Angular production build, prerender, SEO post-build checks | **49 routes prerendered, 50 pages pass** (initial bundle 446 kB: over the 420 kB warning, which was raised to 440 kB; error limit 500 kB) |
| `npm run test:ai` | AI core with a fake provider: parsing, provider choice, coverage marker, rate limit | **pass** |
| `npm run test:ask` | v1 rule engine (now only the offline fallback of the static site) | 112 / 122 hand-written (10 known failures, unchanged), 255 / 255 generated |
| `npm run kb:evaluate` | Retrieval evaluation (see KNOWLEDGE_EVALUATION.md) | retrieval 27 / 27, status 48 / 48, hallucinations 0 / 14 (six Kit/Pack questions added) |

### The 98 platform tests

| Suite | Tests | Highlights |
| --- | --- | --- |
| `tests/calculations` | 24 | Grammar and precedence; code-injection attempts rejected at parse time (`process.exit()`, `require('fs')`, `constructor`, `**`); missing/invalid inputs, defaults, warnings, division by zero; generated test cases; **19 migrated formulas reproduce the values captured from WFX** (GRN, BBB, RMPO 1229/1230, indents, MRP L1/L2, FPO, OC, BOM, routing, consumption chain) |
| `tests/knowledge` | 6 | TXT round trip; problems reported, not thrown; validation; the library parses with 0 problems; **every v1 item is present** (counts compared with the v1 arrays); status policy (assumed → Under Review, the Process Rate "+ vs ×" conflict recorded, the roll inference labelled) |
| `tests/ingestion` | 8 | DOCX (headings, lists, tables, candidates), duplicate detection, new version with diff, XLSX/CSV/JSON column types, units, identifiers, Markdown + Mermaid, HTML (scripts dropped), rule-format TXT, rejection of disguised/empty/unsupported files, the real Inventory/QC PDF, re-index |
| `tests/workflows` | 11 | Designer: stored flows and procedures as graphs (documented vs inferred), text and Mermaid input with decisions, validation (missing start/end, unreachable, dead ends, one-branch decisions, loops), test paths, save as versions and compare. Earlier: Mermaid flowchart, decisions, labels, parallel edges, subgraphs, start/end; loop and orphan detection; state, sequence, ER; generation round trip; the migrated end-to-end flow has valid references, no cycles, every step reachable |
| `tests/retrieval` | 7 | 42-question evaluation set; hallucination rate 0; citation validity; engine-worked calculations; follow-ups (next step, as a workflow, why); **teaching the RMPO rule end to end** (proposal, conflict with CALC-RMPO-OPEN, draft v2 not used, editor cannot activate, approver activates, v1 superseded and kept as history, answer recalculates to 60); conflict detection |
| `tests/workflows/diagrams` | 15 | Buyer Block Booking optional: a gateway with yes/no branches in the end-to-end, ready-made end-to-end and Sales Order workflows, a complete path without any booking step and one with it, no structural errors, running twice changes nothing, booking workflows and "booked" scenarios untouched, generated flows too; the flowchart arranges itself (no overlaps, Start on top, most connections short), hand-placed (pinned) boxes are kept and the flag survives a save. Earlier (13): Eight process shapes and the diagram chosen for each (sequential → flowchart; several decisions → decision tree; several roles → swimlane; roles + parallel → BPMN-style; statuses → lifecycle; levels → hierarchy; missing information → clarification and bare steps stay bare; conflicting documents → reported, not merged); a stated wish wins with its reason; **Kit/Pack built from the real documents** (steps, optional gateway, "Ratio type?" with Size/Color Ratio branches, field-rule inputs, validations naming DOC-0012, Open → Approved lifecycle, screens as lanes, every step names its source, survives a save to the library and back); the chat journey for "Generate a complete workflow for Kit/Pack." (draft stored, open action, an explanation stays in the chat, an edit changes the same draft); layouts for ten pictures (finite positions, no overlapping boxes, edges, lanes as columns for long sequences, tree order, BPMN glyph shapes, timeline rows, mind map size, dependency chain top-down, collapsed sections, search marks, overlay badges) |
| `tests/workflows/chat-workflow` | 6 | Intent (create / modify / compare / explain / none, with and without an open draft); generation from the documented process (steps carry rules, inputs, outputs, dependencies, controls; only documented steps; written steps marked proposed; not documented or vague requests return a clarification, never an empty workflow); plain-language edits (add after a step, unknown anchor, overlays, swimlane, overview, rename, remove; an unclear command changes nothing); drafts (versions, undo, private to the owner, failed generation kept and retried, details round-trip through TXT, viewer cannot save, Draft → Under Review → Approved → Archived); chat (open-workflow action, conversation link, status provisional, questions do not navigate, compare) |
| `tests/datamodel` | 6 | All 28 captured models open; GRN lines take their values from RMPO 1229 (documented), grid ownership inferred; captured DDL has no foreign keys and is labelled not WFX schema; drafts from a requirement (1:N, N:1, M:N, unknown sentences reported); "has many" + "belongs to one" stays 1:N; logical view (surrogate keys, foreign keys, junction table, all inferred); checks (missing key, dangling reference, repeating group); saved draft round-trips, cannot overwrite a captured model, and is never given as a confirmed data-model answer |
| `tests/api` | 15 | Admin directory: users written to `knowledge/admin/users.txt` with no password, hash or token; it follows disable and role changes; only admins read it over the API; everybody reads their own profile; the passages exist in the index but search hides them unless an administrator asks, and a viewer's question never returns them. Earlier: Self-registration: default needs approval; a request is always a viewer (a role in the body is ignored); no session and a clear "waiting" message before approval, a wrong password does not reveal the pending state; weak password refused; only an admin approves or rejects, twice is refused; mode off closes it, open signs the viewer in at once and that viewer cannot change knowledge; five requests an hour per computer (the sixth gets 429). Earlier: | Chat → workflow over HTTP (request, draft, designer view, privacy, edits by chat, manual edit with versions, save role-checked, saved draft status, stored workflow details, designer-initiated request, clarification, errors). Data modelling endpoints (a client cannot mark a model as captured; role check on save; DDL download). Workflow designer endpoints (role check on save). Earlier: Setup token once only; wrong password refused; HttpOnly + SameSite=Strict cookie; cross-site refusals (missing header, foreign origin); role limits (viewer, editor, approver, admin); rule lifecycle over HTTP; uploads, duplicates, extracted text, byte-identical original download, reprocess; conversations (follow-up, rule mode, BA mode, regenerate, export, privacy between users); dashboard, transaction pages, calc tests, export and audit trail; path traversal attempts; security headers |

## Browser checks (built site served by the knowledge server, sandbox data)

Done in the in-app browser on a sandbox instance (temporary knowledge copy, test account), never on the real database.

| Check | Result |
| --- | --- |
| Sign-in page, redirect to the dashboard | works |
| Dashboard tiles and lists from real data | works (33 documents, 8 modules, 15 transactions, 144 active rules…) |
| Assistant `?q=` opens a conversation; answer with status, sections, engine steps, sources, follow-ups, copy/export/regenerate | works |
| Rulebook "Teach a rule" with the RMPO sentence: conflict question and "Make it a correction of CALC-RMPO-OPEN" | works |
| Library: document with versions and "Changes against v1" | works |
| v1 pages (Data lookup with SQLite/WASM, Workflows) under the server's security policy | work after the fixes below |
| Workflow designer: open a procedure, drag a step (connections follow), selection | works; dragging also selected label text → fixed with `user-select: none` |
| **Kit/Pack journey (2026-11-16, sandbox, 1500×900):** "Generate a complete workflow for Kit/Pack." typed in the assistant → draft stored → page navigated to `/workflow-designer/WFD-…` → BPMN-style picture with screens as lanes, gateways, branch labels; direct load of that URL and reload show the same workflow; all eleven pictures switched in turn (node/edge counts and canvas sizes recorded); mind map after the grouping fix; search "ratio" (1 match, 15 dimmed); "back to the chat" link; clicking the answer's "Open in the Workflow Designer" link | works; found and fixed: 16 sequential steps drawn left to right were ~3,300 px wide (now vertical lanes), the mind map was 4,156×3,218 (now grouped by lane, ~1,500×1,250), dependency graph and decision tree were very wide for long chains (now top-down), the timeline was one 2,800 px strip (now rows of eight) |
| Chat → designer: "Create a workflow for Sales Order processing." typed in the assistant opens the designer on the stored draft; the same from the floating chat on another page; edits typed in the designer (add a step, swimlane); step details (inputs, outputs, 10 rules, dependencies, 9 controls, sources); collapse all / expand all; validations overlay; save to the library (Draft); back to the chat shows every exchange and an "Open in the Workflow Designer" button; an unknown draft shows a clear error with Try again | works; two things found and fixed: the SVG shrank to the page width and was centred (lanes far below), and a draft saved to the library took a name that looked like the stored workflow (now `WF-GEN-…`) |
| Data modelling studio: captured GRN model (links to RMPO 1229, checks, dictionary); draft from a requirement with an unclear sentence; logical view with junction table; arrange; save as Draft and reopen | works; relationship labels were hidden behind entity boxes → labels are now drawn on top, wider column gap |

**Found in the browser and fixed:** (1) the security policy blocked Angular's stylesheet `onload` handler, so platform
styles did not apply → the server now allows exactly the handlers present in each page by hash (`'unsafe-hashes'`);
(2) WebAssembly (SQLite on v1 pages) was blocked → `'wasm-unsafe-eval'`; (3) `.wasm` was served with the wrong MIME type.

**Found by the automated tests and fixed:** a transition response was mistaken for a file download (server crash on
`POST /entries/:id/transition`); Mermaid node IDs `style`/`end` are reserved words (the end-to-end diagram had two lost
edges); phrase units with small words ("balance to indent") counted as unknown; false "conflict" between a chain rule and
a single-step rule that define the same output identically.

## Not tested (honest gaps)

- Real Gemini or Claude calls: no key is configured. The integration is unit-tested with a fake provider only.
- Angular component unit tests and automated browser end-to-end tests do not exist; the UI was checked by hand as listed.
- Legacy `.doc` / `.xls` extraction is best-effort (no real files of those types were imported); images are stored with
  metadata only (no OCR).
- Load and concurrency testing (single-process server, SQLite in WAL mode).
- Backups were produced by the API test (`/admin/backup` and export); a restore was not rehearsed.


## 2026-11-18 update

- Evaluation: 33/33 retrieval, 54/54 status, 0/14 hallucinations (6 new questions: indent Inactive ×3, Price Per colour wise, routing sewing, division auto-fill).
- `npm run test:kb`: 98/98 (library migration test: v1 items must all be kept; later additions are allowed).
- Browser check on the sandbox: assistant answer shows one sentence + source + More detail; designer opens with the diagram in the first screen; Edit menu opens; no new console errors.


## 2026-11-18 chatbot update

- `npm run test:kb`: 105/105 (new `tests/api/chatbot.test.ts`, 7 tests).
- Evaluation unchanged: 33/33 retrieval, 54/54 status, 0/14 hallucinations.
- Browser (sandbox): Trims GRN walkthrough with markers, enlarged view and arrow keys, GDN guide, "Open the GRN screen" → /data-model?doc=grn, "Sales Order" clarification, Sales Order workflow → designer swimlane. Contact sheet of all 49 captured steps reviewed for image/marker match.
- Phone width (375 px): guide stacks under the conversation list, no horizontal scroll.
- Not checked in the browser: Stop during a slow answer (answers return in under a second here, so there is nothing to stop).
