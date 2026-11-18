# Existing features (before the platform work)

State on 2026-11-16, before any Phase 2 change. "Works" means used and checked in the browser or by a test.

| # | Feature | Where | State |
| --- | --- | --- | --- |
| 1 | Home with module picker (8 modules) | `pages/home.ts`, `data/modules.ts` | Works |
| 2 | Workflow builder: steps dropdown (phase → group → sub-step), scenarios, Blueprint and Storyboard views, booking-adjustment simulator | `pages/workflow-builder.ts`, `shared/blueprint.ts`, `shared/storyboard.ts`, `shared/sim-panel.ts`, `data/journey.ts`, `data/sim.ts` | Works |
| 3 | Data model: module → documents flow with "Play", detail tabs (Overview, Data, Calculations, Data flow, WFX screen) | `pages/data-model.ts`, `data/docs.ts` | Works |
| 4 | Theory pages per transaction (15 transactions) | `pages/theory.ts`, `pages/theory-list.ts`, `data/transactions.ts` | Works |
| 5 | Formula library (54 formulas, `verified` / `assumed`, open questions) | `pages/calculations.ts`, `data/calculations.ts` | Works |
| 6 | Consumption chain and cost sheet engines | `data/cons.ts`, `data/costsheet.ts`, `shared/cost-sheet.ts` | Works |
| 7 | Glossary (136 terms) | `pages/glossary.ts`, `data/glossary.ts` | Works |
| 8 | Data lookup: friendly tables over 57 CSV tables, SQL for technical users | `pages/data-explorer.ts`, `core/sql.service.ts` | Works |
| 9 | Colour cards and colour tracing | `pages/color-*.ts`, `data/color-trace.ts` | Works |
| 10 | Rule-based assistant (floating widget + full page), workflow commands, "Open full view" | `core/chat.service.ts`, `shared/chat-*.ts`, `pages/assistant.ts`, `data/answer.ts`, `data/assistant-intents.ts` | Works, quality problems (see audit) |
| 11 | Optional AI mode (Gemini/Claude), labelled answers | `server/ai-core.ts`, `api/*.ts`, `core/ai.service.ts` | Built, untested with real keys |
| 12 | User-manual guides (85 sections, 5 areas) | `data/manuals.ts` | Works |
| 13 | Sales Order (re-write) knowledge: 57 rules + scenario tables | `data/salesorder.ts` | Works |
| 14 | CSV export of all knowledge (57 tables + 1 TXT), optional copy to `WFX_DATA_DIR` | `scripts/export-data.ts` | Works |
| 15 | SEO: sitemap, robots, llms.txt, structured data, post-build checks | `scripts/seo-files.mjs`, `scripts/postbuild.mjs` | Works |
| 16 | Light/dark theme | `core/theme.service.ts` | Works |
| 17 | Assistant regression suite | `scripts/test-ask.mjs`, `scripts/ask-cases.json` | 112/122 passing |
| 18 | AI core unit tests | `scripts/test-ai.mjs` | Passing |

Not present before this work: authentication, uploads, document ingestion, persistent database, rule lifecycle and
versions, knowledge editing without code, conversation history, citations, dashboard, calculation lab, transaction
documentation centre, BA copilot, data-modelling studio beyond the captured screens.
