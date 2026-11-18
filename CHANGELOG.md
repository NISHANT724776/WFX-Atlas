# Changelog

## 2.0.0 – 2026-11-16 · WFX ERP knowledge platform

Built on the v1 Knowledge Hub; every v1 page keeps working (also without the server).

### Added
- **Knowledge library (Layer A/B/C):** `knowledge/` with original sources, readable TXT entries (rules, calculations,
  terms, procedures, transactions, fields, dependencies, cases, workflows, data models), extracted documents, append-only
  history and metadata (`knowledge_catalog.json`, `source_registry.json`, `change_history.json`, `discovered_sources.json`).
- **Migration of all v1 knowledge** into 27 TXT files (647 entries), with sources and statuses; a test proves nothing was lost.
- **Ingestion pipeline** for TXT, CSV, XLSX, PDF, DOCX, JSON, Markdown, HTML, Mermaid, images, and best-effort DOC/XLS:
  structure, candidates, duplicates, versions with diffs, re-processing. 34 curated documents imported (Sprint specs,
  manuals, NIS-58 workbook, product specs).
- **Knowledge server** (`npm run kb:server`): Node only, SQLite with full-text search, accounts and roles, audit trail,
  rate limits, security headers, export and backup.
- **Grounded assistant:** retrieval with phrase units, spelling fixes, synonyms, documented abbreviations and re-ranking;
  a gate that refuses to answer from sources that do not cover the question; knowledge status on every answer;
  numbered citations; conversations with follow-ups; seven modes (ask, explain transaction, workflow, data model, analyse
  rule, calculate, BA copilot); optional AI provider that only rewrites from the cited sources (off until authorised).
- **Rule engine:** plain-language rule → structured draft with missing information and conflicts with stored rules;
  lifecycle Draft → Under Review → Approved → Active → Superseded (and Rejected); versions; impact analysis.
- **Calculation engine:** restricted expressions, steps, warnings, generated test cases; 44 runnable rules.
- **Platform pages:** dashboard, knowledge assistant, library, rulebook (with "Teach a rule"), transaction explorer,
  calculation lab, BA copilot, admin, sign-in.
- **Tests:** 60 platform tests in 6 suites, evaluation report, testing report, security review.

### Changed
- `server/ai-core.ts`: `completeText()` for the knowledge server; `AiError` written without a parameter property.
- The `/assistant` page uses the grounded assistant when the server is reachable and the user is signed in.
- Initial bundle warning budget 420 kB → 440 kB (platform stylesheet).

### Added after the first release (same day)
- **Workflow designer** (`/workflow-designer`): open, build from text or Mermaid, drag/zoom/edit, checks, test paths,
  versioned save with approval, version comparison, Mermaid/JSON export.
- **Data modelling studio** (`/data-modelling`): captured WFX document models with documented links, conceptual
  drafts from a requirement, logical view (keys, junction tables), normalisation checks, data dictionary, Mermaid ER,
  DDL draft (labelled not WFX schema), versioned save with approval.

- **Chat to workflow:** asking the assistant (or the floating chat) to create, show, change or compare a workflow opens the Workflow
  Designer on a generated, documented, versioned draft linked to the conversation; edits can be typed in plain language; drafts are saved to
  the library as Draft and move Draft → Under Review → Approved → Archived.

- **Document-grounded workflows and diagram intelligence:** workflows are read from specifications and manuals (steps, decisions,
  options, validations, field rules, statuses), kept in a structured schema, and drawn as the picture that fits their structure
  (flowchart, swimlane, BPMN-style, decision tree, hierarchy, mind map, timeline, status lifecycle, dependency graph, data flow,
  illustrated guide). Canvas: pan, fit, mini-map, search, full screen, SVG/PNG/PDF export. Route `/workflow-designer/:id`.
- **Kit/Pack knowledge:** 14 Kit/Pack documents imported; other documents that answer the same question are listed beside an answer;
  glossary rows are findable by term. Evaluation: 48/48 status, 27/27 retrieval, 0/14 hallucinations. See ROOT_CAUSE_ANALYSIS.md.

- **All discovered WFX documents imported** (204 files: 135 new documents, 54 new versions, 14 duplicates, 2 rejected) as `proposed`; library 180 documents.
  Retrieval hardened for the larger library (entry and document pools, reviewed rules first, no yes/no answers from proposed documents).

- **Create your own account from the sign-in page:** viewer accounts, with an admin setting (Admin → Users and roles): switched off, allowed with
  admin approval (the default), or open. Pending requests are approved or rejected in Admin; `npm run kb:user` recovers a locked-out
  account from the terminal (the password is typed hidden, never taken from the command line).

- **Profile page** (`/profile`, every user): your details, change password; for admins an **Add a new user** form and the admin directory.
  **Admin directory:** `knowledge/admin/users.txt` (names, roles, status; never passwords) is rewritten whenever accounts change and is
  searchable by administrators only ("Who has the approver role?").

- **Buyer Block Booking is optional in workflows:** wherever BBB steps appear (end-to-end, Sales Order, generated flows) they are an optional branch behind
  "Booked against a Buyer Block Booking?" (yes → booking steps, no → straight on), as the documented "Order without booking" scenario shows. Workflows about
  booking itself are unchanged.
- **Workflow designer:** the flowchart arranges itself in layers with fewer crossings (boxes you drag stay where you put them; Arrange goes back);
  stored workflows open in the recommended picture (the end-to-end flow is a swimlane by module); selecting a step highlights its connections and fades long ones.

- **Crisp answers:** the assistant answers in one or two sentences, with one source line; explanation, rules and all sources are under "More detail". Cause/default statements ("If … not filled, indents are Inactive") now answer "why" questions; "set / filled / blank" are treated as the same idea.
- **Indents Inactive rule restated** (no User Group and Purchase Officer on the BOM → indents Inactive by default → activate by hand before MRP).
- **Apparel techpack, BOM and routing knowledge** added from the owner's explanation (DOC-0181/0182).
- **Calmer pages:** assistant (options folded, no headline) and Workflow Designer (picture first, Details and Edit menus).

- **Chatbot as product expert and navigator:** visual step-by-step guides with real screenshots and tap markers (Trims Scan prototype: 6 flows, 49 screens), "open the … screen" goes straight to the registered page (role checked), clarification for one-word subjects, guides from documented procedures, conversation search/rename, Stop. Screen Registry and guides live in `knowledge/registry/`. See documentation/CHATBOT.md.

- **Claude runs the chat** when a key and the organisation's approval exist: natural greetings and general questions, WFX answers only from the knowledge tools with citations, and actions from the chat (open screens, guides, workflows, calculations, rule drafts, requirement analysis, review queue).

### Changed after the first release
- **One navigation:** the separate "Assistant" and "Knowledge" top-bar entries and the second tab row are replaced by a single
  top-bar **Knowledge** menu (Assistant first, then Dashboard, Library, Rulebook, Transactions, Calculation Lab, Workflow Designer,
  Data Modelling, BA Copilot, Admin for admins). Initial bundle warning budget 440 kB → 450 kB.
- **Clubbed pages:** Workflows + Workflow designer and Data Model + Data modelling each have one top-bar entry and a switch between the two views.
  The Data Modelling and Workflow Designer items left the Knowledge menu.

### Fixed during the work
- Mermaid reserved node IDs (`style`, `end`) in generated diagrams; server CSP for Angular's stylesheet loader and WASM;
  transition responses mistaken for downloads.
