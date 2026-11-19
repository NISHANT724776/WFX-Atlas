# Knowledge evaluation

Generated 2026-11-19 04:42 UTC by `npm run kb:evaluate` over `tests/retrieval/eval-set.json` (60 questions). The same set runs as an automated test (`npm run test:kb`).
Expected sources were checked by reading the entries; "not-documented" questions are questions the stored knowledge does not answer.

| Measure | Result |
| --- | --- |
| Retrieval accuracy (expected first source) | 39/39 (100 %) |
| Knowledge-status accuracy | 60/60 (100 %) |
| Hallucination rate (confident answer to an undocumented question) | 0/14 |
| Missing-information detection (undocumented questions that name what is missing) | 13/14 |
| Citation validity (every [n] points to a listed source) | 60/60 |

Version correctness, conflict detection, follow-ups and the calculation engine are covered by `tests/retrieval/retrieval.test.ts` and `tests/calculations/engine.test.ts` (see TESTING_REPORT.md).

| # | Question | Category | Status | First source | OK |
| --- | --- | --- | --- | --- | --- |
| 1 | how is open quantity calculated in RMPO | calculation | confirmed | CALC-RMPO-OPEN | ✔ |
| 2 | how is accepted qty calculated in GRN | calculation | confirmed | CALC-GRN-ACCEPTED | ✔ |
| 3 | how is total consumption calculated | calculation | confirmed | CALC-CONSUMPTION-CHAIN | ✔ |
| 4 | how is loss factor calculated | calculation | confirmed | CALC-BOM-LOSS-FACTOR | ✔ |
| 5 | how is balance to indent calculated in buyer block booking | calculation | confirmed | CALC-BBB-BALANCE | ✔ |
| 6 | how is fabric qty reqd calculated for FPO | calculation | confirmed | CALC-FPO-FABRIC | ✔ |
| 7 | how is the final selling price calculated with upcharge | calculation | confirmed | CALC-SO-UPCHARGE | ✔ |
| 8 | how is markup calculated | calculation | confirmed | CALC-COST-MARKUP-PCT | ✔ |
| 9 | how does WFX calculate fabric requirement for a style | calculation | confirmed | CALC-MRP-L2-REQ | ✔ |
| 10 | what is GRN | definition | confirmed | TERM-GRN | ✔ |
| 11 | what is a techpack | definition | confirmed | TERM-TECHPACK | ✔ |
| 12 | what does MRP adjustment mean | definition | confirmed | TERM-MRP-ADJUSTMENT | ✔ |
| 13 | what is a standard BOM | definition | confirmed | TERM-STANDARD-BOM | ✔ |
| 14 | what is colour dependency | definition | confirmed | TERM-COLOUR-DEPENDENCY-2 | ✔ |
| 15 | how do I create one RMPO for multiple indents together | procedure | confirmed | PROC-SOURCING-RMPO-FOR-MULTIPLE-INDENTS | ✔ |
| 16 | I have 5 fabric indents for the same supplier, can I raise just one purchase order for all of them? | procedure | partial | PROC-SOURCING-RMPO-FOR-MULTIPLE-INDENTS | ✔ |
| 17 | how does the supplier portal work for an RMPO | procedure | confirmed | PROC-SOURCING-SUPPLIER-PORTAL | ✔ |
| 18 | how does TNA get attached to an order automatically | procedure | confirmed | PROC-TNA-AUTO-TNA-ATTACHMENT | ✔ |
| 19 | how do I change the location of stock with the mobile app | procedure | confirmed | PROC-INVENTORY-WMS-LOCATION-CHANGE | ✔ |
| 20 | how do I log in to the WFX mobile application | procedure | confirmed | PROC-INVENTORY-WMS-MOBILE-LOGIN | ✔ |
| 21 | what happens to rejected stock | procedure | confirmed | PROC-INVENTORY-REJECTED-STOCK-AND-DEBIT-NOTE | ✔ |
| 22 | how do I approve a sales order | rule | confirmed | RULE-SO-APPROVAL-LIMIT | ✔ |
| 23 | what is price per in sales order | rule | confirmed | TERM-PRICE-PER | ✔ |
| 24 | how does split delivery work in sales order | rule | confirmed | TERM-SPLIT-DELIVERY | ✔ |
| 25 | explain the kit pack process | document | documented | DOC-0010 | ✔ |
| 26 | what is auto mrp split | document | documented | DOC-0003 | ✔ |
| 27 | how roll functionality works in wfx and why we are using it ? | provisional | provisional | PROC-INVENTORY-ROLL-FUNCTIONALITY-FABRIC-ROLL-TRACKING-ROLL-WISE-STOCK-ROLL | ✔ |
| 28 | what is the GST rate for garments in India | not-documented | not-documented | TXN-BOM-ROUTING | ✔ |
| 29 | how do I configure SAP MM | not-documented | not-documented | PROC-SALES-OC-CLOSURE-CONFIGURE-HOW-TO | ✔ |
| 30 | who is the CEO of WFX | not-documented | not-documented | – | ✔ |
| 31 | what is the weather today | not-documented | partial | DOC-0017 | ✔ |
| 32 | what is the maximum shrinkage allowed | not-documented | not-documented | TERM-SHRINKAGE | ✔ |
| 33 | what is lead time in garment sourcing | not-documented | partial | TERM-BBB-BUYER-BLOCK-BOOKING | ✔ |
| 34 | what is FOB price | not-documented | partial | TERM-TRANSFER-PRICE-MAPPING | ✔ |
| 35 | how to cancel a purchase order | not-documented | partial | TERM-CANCEL-DELIVERY | ✔ |
| 36 | can one RMPO have multiple suppliers | not-documented | partial | PROC-SOURCING-RMPO-FOR-MULTIPLE-INDENTS | ✔ |
| 37 | how is open qty calculated in GRN | not-documented | partial | CALC-RMPO-OPEN | ✔ |
| 38 | can I create a PO without indent | not-documented | documented | DOC-0006 | ✔ |
| 39 | how to split a PO delivery | not-documented | partial | TERM-SPLIT-DELIVERY | ✔ |
| 40 | why do we need MRP if we already have BOM | not-documented | partial | DOC-0010 | ✔ |
| 41 | what is the difference between GDI and GDN | compare | documented | PROC-INVENTORY-WMS-DISPATCH | ✔ |
| 42 | what is the difference between indent and RMPO | compare | documented | TERM-MANUFACTURE-INDENT | ✔ |
| 43 | can packs built on different styles be clubbed | kitpack | documented | DOC-0035 | ✔ |
| 44 | how many production orders are generated for a KIT | kitpack | documented | DOC-0034 | ✔ |
| 45 | what happens when a kit is approved | kitpack | documented | DOC-0037 | ✔ |
| 46 | how is a child kit created from a master kit | kitpack | documented | DOC-0038 | ✔ |
| 47 | what is the ratio type in kit pack | kitpack | documented | DOC-0012 | ✔ |
| 48 | what is the freight insurance premium formula for a kit pack | not-documented | not-documented | DOC-0038 | ✔ |
| 49 | why do indents come in inactive status | rule | confirmed | RULE-SETUP-BOM-INDENT-OWNER | ✔ |
| 50 | what happens if user group and purchase officer are not set on BOM | rule | confirmed | RULE-SETUP-BOM-INDENT-OWNER | ✔ |
| 51 | how do I activate an inactive indent | rule | confirmed | RULE-SETUP-BOM-INDENT-OWNER | ✔ |
| 52 | what does price per color wise mean | rule | confirmed | TERM-PRICE-PER-COLOR | ✔ |
| 53 | which materials go to sewing in routing | rule | confirmed | RULE-BOM-ROUTING-NORMAL-MATERIAL-FLOW | ✔ |
| 54 | how does division get filled in the techpack | rule | confirmed | RULE-APPAREL-BUYER-DIVISION-AUTO | ✔ |
| 55 | If my consumption is 1 Meter and my loss is 10%, Shrinkage is 5%, Wastage is 2% then tell me the total consumption | calculation | confirmed | CALC-CONSUMPTION-CHAIN | ✔ |
| 56 | if i have my consumption of 1 Meter and loss is 10%, WASTAGE IS 2% THEN TELL ME THE TOTAL CONSUMPTION | calculation | confirmed | CALC-CONSUMPTION-CHAIN | ✔ |
| 57 | i have my indent marked as inactive, why is it so. | rule | confirmed | RULE-SETUP-BOM-INDENT-OWNER | ✔ |
| 58 | when is indent marked as inactive | rule | confirmed | RULE-SETUP-BOM-INDENT-OWNER | ✔ |
| 59 | when i dont select purchase officer and user group then what happens | rule | confirmed | RULE-SETUP-BOM-INDENT-OWNER | ✔ |
| 60 | loss % | definition | confirmed | TERM-LOSS | ✔ |

## Known limits

- Retrieval is lexical (full-text search with synonyms, abbreviations learned from the documents, phrase units and re-ranking). It does not understand paraphrases it has no words for; such questions are answered "partly documented" or "not documented" rather than guessed. Semantic search needs an embedding model, which is not configured.
- A question whose words all appear in an unrelated passage can still be matched; the gate (all key terms close together, subject in the title, negation next to its object, same transaction) blocks the cases found so far. New mismatches should be added to the evaluation set.
- "Why" questions are answered only when a source states a reason; most WFX sources describe how, not why.
