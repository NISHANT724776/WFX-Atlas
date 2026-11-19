# Knowledge enrichment and question mapping

Goal: a user asks in their own words, and the assistant finds the stored WFX knowledge that answers it. Started with one module (Sales Order), measured, then to be extended module by module.

## What was built

| Piece | Where | What it does |
| --- | --- | --- |
| Knowledge units | `backend/src/enrich/units.ts` | Cuts the TXT entries of a module into answerable units. Entries that say the same thing (a rule, its "(action)" twin, the glossary term of the same name) become one unit; a transaction becomes overview / process / dependency units; a rule with its own validations gets a validations unit. The answer is the entries' own text, labelled, and is checked word for word against the source on every run. |
| Question variations | `backend/src/enrich/questions.ts` | For each unit: one canonical question plus variations in nine types (direct, conversational, informal, problem, process, technical, terminology, short, contextual). Each is grounded in the unit's text: a "why can't I …" question only when the source states a restriction (and with the verb it restricts), "are remarks mandatory …" only when it says so, "where is …" only when it names a screen, a terminology variant only through a documented alias. Sales Order: 95 units, 784 questions (8 per unit on average, 4–17 depending on the unit). |
| Terminology dictionary | `backend/src/enrich/terminology.ts`, table `kn_terms` | Module, submodule, screen and transaction names; glossary terms; abbreviations the documents spell out; aliases written as "Name (ABBR)" — kept only when the abbreviation is made of the name's initials (BSR, MRL, GDN, RMPO, TNA …); reviewer-confirmed aliases in `knowledge/enrichment/terminology.txt` (Main OC, Delivery OC); everyday English phrasings in `knowledge/enrichment/language.txt` ("get rid of" → delete, "greyed out" → disabled). Every row names its source. |
| Vectors | `backend/src/enrich/vectors.ts` | Offline embedder (`local-concept-hash-v1`): terms → concepts through the dictionary, word stems, character trigrams (spelling mistakes), rarity weighting, 1024-dimension hashed vectors, cosine similarity. |
| Matcher | `backend/src/enrich/match.ts` | Question → closest units: best stored variation 70 %, the unit's own text 30 %; also read together with the previous answer's topic for follow-ups. |
| Hybrid retrieval | `backend/src/search/search.ts` | The mapping score is added to the existing full-text (BM25), keyword-coverage, title and kind ranking, and entries found only by the mapping join the candidates. The original text is still indexed and searched as before. |
| Clarification | `backend/src/assistant/answer.ts` | When a question maps equally well onto two modules and names neither, the assistant asks which one instead of picking. |
| Pipeline | `backend/src/enrich/pipeline.ts`, `npm run kb:enrich` | Read entries → units → questions → duplicate check → source check → store → vectors → self-check. Unit ids are stable (`<primary entry>#<aspect>`); re-running creates no duplicates; a unit whose source text changed is rebuilt and, if it had been approved, goes back to review. `npm run kb:reindex` runs it for the modules in `knowledge/enrichment/config.json`. The TXT library is only read. |
| Review | `/question-mapping` page, `backend/src/enrich/review.ts`, `/api/v2/enrichment/*` | Per module: units, canonical questions, variations, keywords, terms, questions that map back to their own unit, questions not reviewed, misrouted questions, units with insufficient source. Editors approve, reject, edit and add questions; approvers approve units; anyone signed in can try a question. Decisions are stored in `knowledge/enrichment/review.json`, so a rebuild keeps them. |

## Measured (Sales Order)

The test set `tests/retrieval/so-paraphrase-set.json` has 70 questions in users' own words (informal, problem, short, misspelt, terminology, follow-ups), written from reading the entries **before** the enrichment existed. Thresholds were tuned on the odd-numbered half only; the even-numbered half was not used for tuning. "Correct" = the assistant answered (not "not documented") and its first source is one of the expected entries.

| | Keyword search only | With question mapping |
| --- | --- | --- |
| All 70 — correct first | 40 (57 %) | 44 (63 %) |
| All 70 — correct in the first three | 47 (67 %) | 49 (70 %) |
| All 70 — answered from a wrong item | 17 | 12 |
| Tuning half (35) — correct first | 22 (63 %) | 25 (71 %) |
| Untouched half (35) — correct first | 18 (51 %) | 19 (54 %) |
| Original evaluation set (39 sources, 60 statuses, 14 undocumented questions) | 39/39 · 60/60 · 0 hallucinations | 39/39 · 60/60 · 0 hallucinations |

Details per question: `documentation/PARAPHRASE_EVALUATION.md` (`npm run kb:eval-paraphrase -- --write`; `--dev` / `--test` for the halves). The same floors run in `npm run test:kb` (`tests/retrieval/enrichment.test.ts`).

## Honest limits

- **No neural embedding model is configured**, so "semantic" matching here understands vocabulary, documented aliases and everyday phrasings — not meaning. "See who changed the order" does not reach "History and activity timeline" because they share no words. A real embedding model (e.g. through an approved provider) can replace `vectors.ts` behind the same store; `kn_meta.embedder` records which one built the vectors. Until then the untouched-half gain is small (51 % → 54 %).
- The biggest gain is fewer **wrong** answers (17 → 12): when the mapping and the keywords disagree, the mapped unit usually wins correctly.
- The answer step still refuses when the question's key words do not appear in the source ("surcharge" vs "upcharge" finds the right source but answers "not documented"). Loosening that gate was measured and gave no gain on the tuning half; it was left as it is to keep 0 hallucinations.
- Questions are generated from templates grounded in the source text, not written by an AI; some read mechanically ("Can you explain sample order fields?"). They are proposals until a reviewer approves them. With the AI provider approved, a Claude pass could propose more natural variations into the same review queue — not built.
- Only Sales Order is enriched. Until other modules are, a question about another module can be pulled slightly towards a Sales Order unit; the original evaluation set (all modules) shows no regression.
- Self-check: 769 of 784 stored questions map back to their own unit; the 15 that do not are listed as "misrouted" on the review page.

## Extending to the next module

1. Add the module name to `knowledge/enrichment/config.json`.
2. `npm run kb:enrich` (or "Enrich" on the review page).
3. Write a paraphrase set for it (users' wording, before looking at the generated questions) and measure with `kb:eval-paraphrase`.
4. Review: reject odd questions, add the ones users really ask, confirm aliases in `terminology.txt`.
