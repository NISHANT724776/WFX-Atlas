---
name: wfx-knowledge-hub
description: Angular knowledge site of WFX ERP transactions built from the NIS-58 Excel; user will add more transactions recorded in the WFX demo app
metadata:
  node_type: memory
  type: project
  originSessionId: ad389d3c-439f-4c98-a215-c6a8d6d11dcd
  modified: 2026-11-11T07:28:10.472Z
---

The user is documenting WFX ERP transactions as a website (Angular 21, static prerender) at `wfx-knowledge-hub/` in this folder. Source of truth so far: `C:\Users\nishant.s\Downloads\WFX_Data_Model_Flow_NIS-58_v4.xlsx` (15 sheets: Masters → Apparel Style → BOM Materials/Routing/Costing → RM Techpack → BBB → Adhoc Indent → RMPO → GRN → Buyer PO → MRP → Production Indents → Production Order → FPO). Built 2026-11-11.

The WFX demo web app they make transactions in is the offline build in `WFX-Product-Demo/` (served by `server/serve-demo.py`, mock data in `site/mock-api`).

**Why:** they will perform transactions step by step in the WFX app and want each one validated, recorded into the hub (definitions, formulas, cases, workflows), and later queried.

Since 2026-11-11 (v3) /workflows is a builder: user picks From/To step; views = Blueprint + Storyboard with a scenario simulator (Adhoc Indent status none/PO/ASN/GRN → On Order / In-House adjustment, SKU level) — user chose options 1+3+4 from a reference image. They do NOT want the reference image's colours; keep the paper/ink + orange palette. The user insists BBB Adhoc Indent (manual, against booking) and sales-order indents (MRP: Manufacture L1, Production L2) are different flows — never merge them. They want low-effort, interactive, non-"vibe-coded" UI; editorial paper/ink style with an ink-splash theme toggle came from a video they shared.

**How to apply:** add new transactions via catalog.ts → records.ts → transactions.ts → calculations.ts → journey.ts STEPS + theory-extras.ts summary (see the hub README). Mark formulas `assumed` with an open question unless a WFX screen value proves them. Confirmed 2026-11-11 from NIS-59 live screenshots: Cons incl Wastage = Cons × W% + Cons; Process Rate = Cost Of × Production Time (user said +, screen shows ×, asked to confirm); Profit uses selling after discount, Markup uses selling before discount. Defaults confirmed: no UOM conversion → factor 1; Cost Of = default rate per unit time, Efficiency % default does not change rate. Still open: Process Rate × vs +, Loss % method, shrinkage (user will send), exchange rate. Live WFX capture via injected recorder failed (site CSP + page reloads); user now sends screenshots instead. SITE.url in catalog.ts is still the guessed `wfx-knowledge-hub.vercel.app` until the user gives a domain.

Naming (user, 2026-11-11): refer to styles as articles by name + code – "Adi TShirt (NIS-59)", "Flannel Shirt Adi (NIS-58)" – never as bare "NIS-58/59" data sets. Both articles use colour card Nis_colors and size range ERPSIZE. Data model page must show only filled/relevant fields (no full WFX page replica); BOM colour/size cells open the master → article → BOM line dependency.

## Data files, SQL and Ask (added 2026-11-12)
- `npm run build` runs `scripts/export-data.mjs` first: all hub data → CSV in `public/data/<module>/<table>.csv` + `manifest.json` (copy in `data/`). 32 tables; source of truth is still the TS files in `src/app/data/`.
- Browser loads CSVs into SQLite via sql.js (`core/sql.service.ts`); `/data` page = table tree + SQL editor.
- `/ask` uses rule-based `data/answer.ts` (no AI). Works fully static after deploy. True free-form AI answers would need a server function + API key — offered to user as optional, not built.

## Consumption chain (confirmed 2026-11-12) – supersedes earlier shrinkage/loss assumptions
- Loss Factor = 1/(1−Loss%); Cons incl Loss = Cons×factor; Cons incl Wastage = incl Loss + incl Loss×Wastage%; Total (Final) Consumption = incl Wastage ÷ (1−Shrinkage%). Example Cons 2, 5/5/5 → 2.326870.
- Each step optional: only wastage → Cons×(1+W); only loss → Cons/(1−L); only shrinkage → Cons/(1−S).
- User says "total cons" for this final figure; "Total Cons Qty" is the entered column. Code: `src/app/data/cons.ts` (consChain). MRP rules: any level can take a negative, only parent-level negative + MRP re-run changes child indent (verified).

## Workflow "Pick your steps" + chat assistant + AI mode (2026-11-12)
- Workflows page: `?steps=a,b,c` hand-picked chain (journey.ts REQUIRES/QUICK_STARTS/hasBooking).
- Chat widget `shared/chat-widget.ts` (rule-based AnswerEngine first). Optional AI: `server/ai-core.ts` (Gemini + Claude via fetch, provider-neutral), `api/ask.ts` + `api/ai-status.ts` (Vercel adapters), setup in `AI-MODE.md`, `.env.example`, `npm run test:ai`. User wants both providers switchable; Vercel now, maybe WFX domain on AWS/Azure later. Not yet tested against real providers (no keys) or deployed; user supplies keys as host env vars (never in chat or repo).

## Assistant everywhere (2026-11-12)
Shared `core/chat.service.ts` (commands → rule answer → optional AI), `shared/chat-thread.ts`, floating `chat-widget.ts` (panel is @defer-ed to keep the initial bundle under 400 kB), full page `/assistant`. Commands in `data/assistant-intents.ts`: "make a workflow from X to Y / with A, B, C / end to end without block booking" and "show the data model / theory of X". Big answers (>6 table rows or >5 points) get "Open full view".

## Declutter redesign (2026-11-12)
Principle (user): show less up front, reveal on demand via module/level icons. `data/modules.ts` = 6 modules (Setup rules, Style & BOM, Booking & sourcing, Sales Order, Planning, Production) with docs, txns, workflow steps. Home = hero + module picker (reveals Workflow/Data model/Formulas/Theory links). Data Model = module icons (animated flow) → document nodes (Play the flow) → detail tabs Overview/Data/Calculations/Data flow/WFX screen. Formulas and Theory pages: module picker, `?module=` preselects. Initial bundle warning budget raised to 420 kB.

## Workflows dropdown + friendly Data page (2026-11-12)
- Workflows: no more rigid From/To; one multi-select checkbox dropdown (grouped by phase, phase checkbox, quick starts, Select all/Reset), chain chips with ×; `?steps=` is the state, ready-made presets just pre-tick a range.
- Data page: never shows CSV files/folders/downloads. Area icons → topic cards → plain table (humanized headers, search, show more, empty columns hidden); SQL only inside a collapsed "technical users" box. CSVs still written by the build to `data/` and `public/data/`; user said CSVs should live in an "ASN sub folder" on their system (exact path not given): `WFX_DATA_DIR` env var makes the build copy them there too.

## Project location changed (2026-11-12)
All code now lives in `C:\Users\nishant.s\Downloads\WFX-Product-Demo-ERP\ASN` (user asked for an "ASN sub folder"). The old `wfx-knowledge-hub` folder was deleted at the user's request after verifying ASN builds. Any earlier path in these notes that says `wfx-knowledge-hub\...` now means `ASN\...`. Preview config `.claude/launch.json` serves `ASN/dist/wfx-knowledge-hub/browser` on port 4300.

## Workflows: one selector + scenarios (2026-11-12)
Single "Steps" dropdown: Phase → group → sub-step checkboxes (STEP_GROUPS in journey.ts, tri-state, collapsible). Start→End and Pick-your-steps are merged; `?steps=` is the only state. Scenario chips (SCENARIOS in journey.ts + the 4 ready-made presets) tick steps and set the simulator status (`?scenario=`); simulator only shows when the chain has booking steps. Blueprint/Storyboard render whatever is ticked.

## User manuals stored module-wise (2026-11-12)
Nine files from Downloads (New BOM NK1, AI Tech pack Configuration Classic, 337356 OC Closer Setup, Stock write off, Sourcing manual, Inventory and QC process flow PDF, Sample Order Manual, TNA Workflow, WMS Workflow) were read and written as ~75 guide sections in `ASN/src/app/data/manuals.ts`, exported to one CSV per module: `manual_style_bom`, `manual_sales_order`, `manual_sourcing`, `manual_inventory_qc_wms` (new `inventory` folder), `manual_tna` (new `tna` folder). Chatbot: `AnswerEngine.manualMatch` scores sections (title/topic words weigh most) → `kind: 'guide'` answers with steps; `MANUAL_KEYWORDS` forces manual answers for TNA/WMS/QC/sample/etc. Screenshots inside the Word files were not captured (text only). New modules `inventory` and `tna` exist in modules.ts with no data-model documents.

## Assistant robustness (2026-11-12)
User wants the assistant ready for complex, messy questions (typos, long stories, two things at once), not only simple ones. Guide retrieval in `answer.ts` is now IDF-weighted with title boost, word-pair bonus, spelling correction against the guides' own vocabulary (Damerau distance, close matches only), synonym groups (GROUPS), filler-word list (MSTOP), a coverage check (`cov`) so off-topic questions get an honest "no match" with closest topics, "Also relevant" extra sections for compound questions (answered in the order asked), and arbitration so a one-word column/term (e.g. "Supplier") cannot beat a guide that covers the whole question. Regression suite: `npm run build && npm run test:ask` (scripts/ask-cases.json hand-written cases must be 100%, every guide asked 3 other ways must be ≥ 90%). Pitfall: never write regex backslashes inside inline python heredocs (they became backspace characters); use a script file with raw strings.


## Answer beyond the hub, and say so (2026-11-13)
User asked: answer every question correctly, using general knowledge too, and clearly say when the knowledge is not in the hub. AI prompt (`server/ai-core.ts`) now uses hub context first, answers beyond it, and starts with `SOURCE: HUB|GENERAL|MIXED` (parsed by `readCoverage`, returned as `coverage`); chat shows an amber "Not in the hub's knowledge" note. AI is on by default when configured. Rule-only mode says "not present in the hub's knowledge yet"; closest-guess guides carry `gap`. Added "Roll functionality" overview guide (the why is inferred, manuals have none) and a qualifier-clash check so "lead time" no longer matches "Production Time". Open: user's AI keys and deploy; the official reason for roll handling.
