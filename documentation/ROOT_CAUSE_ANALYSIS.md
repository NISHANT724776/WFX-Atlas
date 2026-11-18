# Root-cause analysis: why the workflows and answers fell short

Written 2026-11-16 after inspecting the actual repository, the knowledge folder and the owner's Downloads folder, and after
reproducing the failures with the request "Generate a complete workflow for Kit/Pack." Every cause below was found in code or
data and has a fix or a stated remaining limit. Nothing here is a guess about the AI model: there is no AI provider key
configured, so no language model wrote any answer or workflow. Everything the application showed came from the code below.

## Summary

| # | Symptom you saw | Root cause (where) | Fixed? |
| --- | --- | --- | --- |
| 1 | "Not documented" for Kit/Pack, and generic-looking answers | The Kit/Pack documents were never in the library. `knowledge/metadata/discovered_sources.json` listed 205 WFX documents in Downloads as "NOT imported"; only 34 had been curated. Some Kit/Pack specs were stored (DOC-0010, DOC-0012) but see cause 2 | **Yes for Kit/Pack** (14 files imported: DOC-0034 to DOC-0044 and new versions of DOC-0012). **No for the other ~190 discovered documents**: importing them is your choice (see "Not done") |
| 2 | Even stored documents never became a workflow | `workflows/generate.ts` could only build a graph from curated library entries (`workflow`, `procedure`, `transaction`). It never read a document's own sections, so a process described only in a specification had no source | **Yes**: `workflows/docflow.ts` reads the process sections of documents |
| 3 | Every workflow was a straight chain of identical boxes | The generators produced chains by construction: `graphFromEntry` linked steps in listed order, `graphFromText` only understood "If … then … else" typed by a user. Nothing read conditions, options or branches from documents. Edges had no kind and no condition | **Yes**: decisions, optional gateways, conditional branches and statuses are extracted from the text, each with its source |
| 4 | Complex decisions missing | The structured model had no place for them: nodes had no description or source section, edges no id/kind/condition, the workflow no assumptions or missing-information list | **Yes**: schema extended (see below) and validated |
| 5 | The chat showed text instead of a diagram; navigation to the Workflow page did not happen | The assistant answered workflow questions with a Mermaid code block and a step list (`answer.ts`, intent "workflow"). The v1 floating chat used a separate offline engine that never reached the knowledge server | **Yes** (done earlier in this project and now route-based): the chat stores a draft and opens `/workflow-designer/<id>` |
| 6 | One kind of picture | One renderer (`workflow-designer.ts` SVG) with flowchart and, since the previous step, swimlane; fixed 180×56 boxes; the SVG shrank to the page width (`img, svg { max-width: 100% }`), so wide diagrams were drawn small and off-centre | **Yes**: layout engine `diagram-layout.ts`, eleven pictures, `max-width: none` for the canvas |
| 7 | Hard-to-read big diagrams | Long sequences were laid out in one very wide strip (about 3,300 px for 16 steps) | **Yes**: vertical swimlanes, top-down trees and dependency graphs for long chains, timeline in rows, a grouped mind map |
| 8 | Controls that did nothing useful | No pan, no fit, no search, no minimap, no export other than JSON/SVG, designer reachable only by query string (lost on refresh of a new draft) | **Yes**: all added and exercised in the browser |
| 9 | Answers that looked right but came from one document | `answerQuestion` returned the best passage and never said that other documents also answer the question. Example: "How many production orders are generated for a KIT?" answered from the older DOC-0034 "KIT MRP" ("PO of 1000 Qty is generated for KIT/Pack"), while DOC-0010 and DOC-0035 say production orders are created per Style and no PO at KIT/Pack level | **Partly**: other documents are now listed beside the answer with a warning that they were not compared. The DOC-0034 vs DOC-0010/0035 difference is a **real open conflict in your documents** that only you can resolve |
| 10 | Definitions inside glossary tables were not found | Table rows were indexed with the title "Table 1 row 5"; the term was only in the row text. "What is the ratio type in Kit/Pack?" returned a partial answer from another document | **Yes**: rows of glossary-style tables (`Term` / `What it means`) are titled by the term |
| 11 | Pages look inconsistent | Two generations of pages (v1 static pages in `pages/`, platform pages in `platform/`) with two navigation systems | **Partly**: one top-bar navigation, merged Workflows/Data Model entries, a shared switch; the v1 pages keep their own page style |

## What the investigation showed in detail

### Chatbot, prompts, retrieval

- No system prompt is involved: the knowledge server composes answers deterministically from retrieved passages
  (`assistant/answer.ts`). An AI provider only rewrites them if a key is configured *and* an admin has recorded
  authorisation; none is. So "generic ERP explanations" cannot come from this code path. They came from the older v1 floating
  chat (an offline rule engine) answering where the grounded assistant was not used. The floating chat now sends signed-in
  users to the grounded assistant.
- Retrieval is lexical (SQLite FTS5 with synonyms, learned abbreviations, phrase units and re-ranking) plus a "does a source
  actually answer this" gate. It is not semantic: it does not understand paraphrases it has no words for. Semantic
  (embedding) search needs an AI key and is not built.
- Evaluation on the real index after the fixes: retrieval 27/27, status accuracy 48/48, hallucinations 0/14
  (`KNOWLEDGE_EVALUATION.md`; six Kit/Pack questions added, one of them a deliberate "not documented" probe); unchanged after the library grew to 180 documents, because four retrieval regressions found by this evaluation were fixed (see IMPLEMENTATION_LOG.md).

### Knowledge ingestion

- 180 documents are now indexed (33 before: 14 Kit/Pack files, then 190 more imported as `proposed`). 16,416 document passages and 647 entries. Inventory: `KNOWLEDGE_INVENTORY.md`.
- Read but weak: `Kit Enhancements.pdf` (DOC-0036) is a scanned or image PDF: one passage, no text. `bom_kit_pack_cost_rollup_flow.png`
  (DOC-0044) and every image are stored with metadata only: **no OCR, no reading of diagrams inside images**.
  `Kit OC_20260707105103.xlsx` (DOC-0042) produced no passages (an empty template).
- Not read at all: the other ~190 discovered documents, and everything outside the Downloads and D:\Sprints folders.

### Workflow generation

- Before: entries → chain. After: documents (and entries) → structured graph → measured → picture chosen → layout.
- Kit/Pack, built from DOC-0012 "Kit Pack Enhancement version2": 9 documented steps; an optional-step gateway ("Make size
  versions?"); a "Ratio type?" decision whose Size Ratio / Color Ratio / Mixed ratio branches and outcomes are the document's
  own sentences; field rules of each screen as inputs; validations and user messages attached to the step they are about;
  the Open → Approved status lifecycle; a conflict note that DOC-0035 describes a different process
  (similarity 5 %); lanes named after the screens/tabs the steps work on.
- "Generate a Kit/Pack MRP planning workflow" is built from DOC-0035: a "Pack or KIT?" decision with its two outcomes
  (single PO / multiple POs).

### Frontend and routing

- A saved workflow now has its own route, `/workflow-designer/:id`, loaded from the server, so a refresh or a bookmark works
  (tested in the browser). `?id=` still opens stored library workflows.
- A bug found on the way: the router's scroll handler assumed every event had `urlAfterRedirects`; fixed.
- A testing lesson: a scripted `element.click()` does not drive the Angular router in the browser pane; real clicks and typing do.
  Earlier "navigation failures" seen in the browser were partly this and partly a page not yet loaded.

## What was changed (files)

Backend: `workflows/docflow.ts` (new), `workflows/select.ts` (new), `workflows/designer.ts`, `workflows/generate.ts`,
`workflows/drafts.ts`, `assistant/workflow-chat.ts`, `assistant/answer.ts`, `ingest/pipeline.ts`, `api.ts`.
Frontend: `platform/diagram-layout.ts` (new), `platform/workflow-designer.ts` (rewritten), `platform/tabs.ts`, `platform/shared.ts`,
`app.routes.ts`, `app.routes.server.ts`, `platform.scss`. Knowledge: 14 Kit/Pack documents imported.
Tests: `tests/workflows/diagrams.test.ts` (new, 13), chat-workflow and api tests extended; total 94.

## Structured workflow model

`designer.ts` (and TXT `WORKFLOW` entries): workflow id, name, description, module, submodule, related transactions, diagram
type (`FORMAT`), source references, version, approval status, preconditions, postconditions, exceptions, dependencies,
assumptions, missing information, related documents. Node: id, type (start, end, activity, decision, parallel, exception,
state), title, description, transaction, role, lane, section, inputs, outputs, rules, validations, sources (document, version,
section), basis (documented / proposed / inferred). Edge: id, from, to, kind (sequence, condition, optional, parallel,
dependency, data, transition), label, condition. `validate()` checks structure; the API checks every field it accepts.

## Not done, and why (honest list)

1. **Discovered documents:** all 204 were imported afterwards as `proposed` (not approved), giving 180 documents; two `.xls` files were rejected
   (not legacy Excel). Their content is labelled provisional; the owner still has to review them, and the Kit/Pack conflict (DOC-0034 vs DOC-0010/0035) is unresolved.
2. **No OCR / no image understanding**: scanned PDFs and diagrams in images are not read (needs a vision model or OCR).
3. **No semantic search**: needs an AI provider key and your organisation's approval to send passages to it.
4. **Conflicts between documents are shown side by side, not decided.** Automatic detection of contradictory sentences is
   not implemented; only entry-to-entry formula conflicts and document-to-document process differences (step similarity) are.
5. **Decision extraction is pattern-based** (if / when / where chains, "A for X; B for Y", options with stated consequences,
   "optional", "at the same time"). A rule written in a way these patterns miss is attached as an exception, not drawn.
6. **Diagram types not built**: Sankey (no quantities flow in the documents read), ER diagrams from documents inside the
   workflow page (the Data Modelling studio does captured models and drafts), cross-functional BPMN XML export (the BPMN-style
   picture is drawn, not exported as BPMN XML), PDF is produced through the browser's print dialog.
7. **The status lifecycle** is kept in the draft only; saving to the library stores the main workflow.
8. **UI polish**: the designer, assistant, library and data pages follow one design system; the older v1 pages
   (Theory, Formulas, Data) keep their own look. A full redesign of all pages, an accessibility audit and mobile end-to-end
   tests are not done.
9. **Real-instance data**: your running instance is the copy in `D:\WFX Knowledge hub`; the changes here are in the `C:` copy
   and were synchronised to `D:` only as code and imported documents (see IMPLEMENTATION_LOG.md).
