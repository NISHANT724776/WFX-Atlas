# Paraphrase evaluation (Sales Order)

Generated 2026-11-19 04:42 UTC by `npm run kb:eval-paraphrase -- --write` over `tests/retrieval/so-paraphrase-set.json` (70 questions in users' own words, written before the enrichment was built).

| Measure | Result |
| --- | --- |
| Correct knowledge item first | 44/70 (63 %) |
| Correct knowledge item in the first three sources | 49/70 (70 %) |
| Answered (not "not documented") | 61/70 |
| Answered from a wrong item (none of the expected in the first three) | 12/70 |

| Category | Correct first |
| --- | --- |
| informal | 3/10 |
| problem | 5/11 |
| conversational | 4/6 |
| process | 6/10 |
| technical | 5/7 |
| short | 7/7 |
| terminology | 6/10 |
| direct | 1/2 |
| misspelled | 3/3 |
| follow-up-start | 2/2 |
| follow-up | 2/2 |

| # | Question | Category | First source | Status | OK |
| --- | --- | --- | --- | --- | --- |
| 1 | How do I get rid of a delivery I added by mistake? | informal | DOC-0019 | not-documented | ✖ |
| 2 | why cant i remove a delivery article | problem | RULE-SO-DELIVERY-DELETE | partial | ✔ |
| 3 | Delete button is greyed out on my revised order, why? | problem | RULE-SO-CONFIRMED-STAR | not-documented | ✖ |
| 4 | can a closed delivery be opened again | conversational | TERM-REOPEN-DELIVERY | confirmed | ✔ |
| 5 | system says delivery is not closed when I try to reopen | problem | TERM-REOPEN-DELIVERY | partial | ✔ |
| 6 | how to cancel the whole OC with all its deliveries | process | RULE-SO-ACTION-CANCEL-DELIVERY | confirmed | top 3 |
| 7 | unable to close an order that was cancelled | problem | RULE-SO-ACTION-CANCEL-ORDER | partial | ✖ |
| 8 | is remarks compulsory when cancelling a delivery | technical | TERM-CANCEL-DELIVERY | partial | ✔ |
| 9 | move some quantity from one delivery to another delivery | informal | CALC-SO-SPLIT-QTY | partial | ✖ |
| 10 | which deliveries can I shuffle quantity into | technical | TERM-SPLIT-SHUFFLE-DOC | confirmed | ✖ |
| 11 | split 40 percent of a delivery | short | TERM-SPLIT-DELIVERY | confirmed | ✔ |
| 12 | why was my new delivery rejected as duplicate | problem | RULE-SO-DUPLICATE-DELIVERY | partial | ✔ |
| 13 | what makes two deliveries the same | conversational | TERM-MAKE-TO-STOCK | not-documented | ✖ |
| 14 | change buyer delivery date without revising the OC | process | TERM-DELIVERY-UPDATE | confirmed | ✔ |
| 15 | how is the OC delivery date worked out from buyer date | technical | CALC-SO-EX-FACTORY | partial | ✔ |
| 16 | ex factory days master where | short | CALC-SO-EX-FACTORY | confirmed | ✔ |
| 17 | order price does not match the cost sheet price | problem | TERM-AUTO-PRICE-PICKUP-FROM-COST-SHEET | partial | ✖ |
| 18 | cost sheet price got revised, how do I bring the new price into the order | process | RULE-SO-UPDATE-OC-PRICE | partial | ✔ |
| 19 | where does the selling price on a new order come from | conversational | CALC-SO-UPCHARGE | confirmed | ✖ |
| 20 | which BOM price does the order take when there are many approved BOMs | technical | TERM-BOM-SELECTION-ON-THE-ORDER | partial | ✔ |
| 21 | add a surcharge on the selling price | terminology | CALC-SO-UPCHARGE | not-documented | ✖ |
| 22 | give a discount on the article price | informal | RULE-SO-PRICE-PER | confirmed | top 3 |
| 23 | can i type price per on the order | technical | TERM-PRICE-PER | confirmed | ✔ |
| 24 | price per colour or per size where is it decided | terminology | TERM-PRICE-PER | confirmed | ✔ |
| 25 | when does a sales order need approval | conversational | TERM-APPROVAL-VALUE | confirmed | ✔ |
| 26 | approval limit -1 meaning | short | TERM-APPROVAL-VALUE | confirmed | ✔ |
| 27 | where does the approver see orders waiting for him | informal | DOC-0009 | documented | ✖ |
| 28 | approver is on leave and the order is stuck | problem | TERM-MULTIPLE-APPROVAL-PARALLEL | not-documented | ✖ |
| 29 | set up approval in several levels for OC | process | DOC-0019 | documented | top 3 |
| 30 | can one delivery have kit and normal articles together | technical | TERM-KIT-ARTICLE | not-documented | ✖ |
| 31 | prepack ratio pieces calculation | short | CALC-SO-PACK-PCS | provisional | ✔ |
| 32 | what packing options are there for an article | direct | TERM-PACKING-TYPE | confirmed | ✔ |
| 33 | add one more quantity grid under the same article | informal | TERM-ADD-QTY-BREAKUP | partial | ✔ |
| 34 | add qty button is disabled | problem | TERM-ADD-QTY-BREAKUP | not-documented | ✖ |
| 35 | copy an old order to make a new one quickly | informal | PROC-SALES-SAMPLE-BOM | not-documented | ✖ |
| 36 | buyer default template | short | TERM-QUICK-FILLS-COPY-ORDER | confirmed | ✔ |
| 37 | what are the parts of the new sales order screen | direct | DOC-0098 | provisional | ✖ |
| 38 | how is a sales order organised into deliveries and articles | conversational | TERM-SALES-ORDER-STRUCTURE | partial | ✔ |
| 39 | what is a delivery OC | terminology | TERM-SPLIT-DELIVERY | partial | ✖ |
| 40 | see who changed the order and when | informal | DOC-0001 | documented | ✖ |
| 41 | compare versions of a revised order | process | RULE-SO-ACTION-REVISE | confirmed | top 3 |
| 42 | what do I have to fill when revising an order | technical | TERM-REASON-FOR-REVISION-AND-REVISION-AUTHORIZED-BY | confirmed | ✔ |
| 43 | download the order list to excel | informal | DOC-0177 | provisional | ✖ |
| 44 | attach a TNA template to a delivery | process | TERM-TNA-ON-THE-ORDER | provisional | ✔ |
| 45 | TNA confirmed, cannot edit it now | problem | TERM-TNA-ON-THE-ORDER | partial | ✔ |
| 46 | run mrp directly from the OC | process | TERM-PURCHASE-ORDER-TYPE | confirmed | top 3 |
| 47 | see material status of the style in the order | informal | TERM-BOM-INFORMATION-AND-MATERIAL-REQUIREMENT-STATUS | confirmed | ✔ |
| 48 | electronic purchase order from buyer import | terminology | TERM-EDI-BUYER-PO | partial | ✔ |
| 49 | EDI orders on hold tab | short | TERM-EDI-BUYER-PO-TABS | confirmed | ✔ |
| 50 | add custom fields to the order | terminology | PROC-SALES-SAMPLE-ORDER-DETAILS | partial | ✖ |
| 51 | petite regular tall sizes | terminology | TERM-INSEAM | confirmed | ✔ |
| 52 | extra quantity on top of order for production | terminology | TERM-EXTRA-PRODUCTION-AND-ADDITIONAL-QUANTITY | confirmed | ✔ |
| 53 | order made by a subcontract supplier | terminology | WF-READY-BLOCK-BOOKING | partial | ✖ |
| 54 | make to stock order no sales asn | short | RULE-SO-TYPE-MTS | confirmed | ✔ |
| 55 | intercompany order execution company to order company price | terminology | TERM-BACKWARD-TRANSFER-PRICE | partial | ✔ |
| 56 | where is the buyer style ref taken from | terminology | TERM-BUYER-STYLE-REFERENCE-BSR | partial | ✔ |
| 57 | what happens to leftover stock when an OC is closed | conversational | PROC-SALES-OC-CLOSURE-PURPOSE | confirmed | ✔ |
| 58 | oc closure setup cant add second row same company | problem | PROC-SALES-OC-CLOSURE-CONFIGURE-HOW-TO | not-documented | ✖ |
| 59 | write off site not showing in the dropdown | problem | PROC-SALES-WRITE-OFF-SITE | partial | ✔ |
| 60 | buyer sent the sample back how to take it in | informal | PROC-SALES-BUYER-RETURNED-SAMPLE | partial | ✔ |
| 61 | send sample through a forwarder | process | PROC-SALES-SAMPLE-DISPATCH | partial | ✔ |
| 62 | one invoice for many courier dispatches | process | PROC-SALES-COURIER-INVOICE | confirmed | ✔ |
| 63 | deleet delivry | misspelled | TERM-DELETE-DELIVERY | confirmed | ✔ |
| 64 | proforma invoise print | misspelled | TERM-PROFORMA-INVOICE-AND-PRINT | confirmed | ✔ |
| 65 | desynk price | misspelled | TERM-DESYNC-PRICE | confirmed | ✔ |
| 66 | Split delivery | follow-up-start | TERM-SPLIT-DELIVERY | confirmed | ✔ |
| 67 | and what are the rules for the target delivery? | follow-up | TERM-SPLIT-SHUFFLE-TARGET-ELIGIBILITY | partial | ✔ |
| 68 | Cancel Sales Order | follow-up-start | TERM-CANCEL-SALES-ORDER | confirmed | ✔ |
| 69 | is the remark mandatory there? | follow-up | RULE-SO-ORDER-CANCEL | confirmed | ✔ |
| 70 | how do I give my sales order a TNA template and then change it later | process | RULE-SO-TNA | partial | ✔ |
