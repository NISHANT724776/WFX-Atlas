# Knowledge base vs WFX QA data — check of 2026-11-18

Source: the WFX QA connector (read-only; company code 22000). Buyer orders 39,438 · order BOM lines 62,353 · styles 14,384 · materials 3,844.
QA holds test entries (UOM "saurabh", product group "sa"), so counts are evidence, not rules. Nothing in `knowledge/` was changed by this check.

## Confirmed by QA data

| Hub rule | Evidence |
|---|---|
| BOM line Value = consumption × price, per garment (`style_bom_calculations.txt`, Line Value) | Every sampled order BOM line matches exactly, e.g. 21.02 MTRS × 150.6343 = 3,166.33; 0.35 MTRS × 40 = 14.00; 2.9 × 26.425 = 76.63. Quantities are per-garment sized (0.35 m, 1 pc). Over all 26,055 lines with a quantity, Σ value is within 1.2 % of Σ qty × rate (likely currency or rounding on a few lines; not traced). |
| Sales order can be Confirmed, Closed, Cancelled (`sales_rules.txt`) | All three exist: 29,341 Confirmed, 7,786 Closed, 2,133 Cancelled. |

## In QA but not in the hub (gaps — need the owner's explanation before anything is written)

| Item | QA evidence | Open question |
|---|---|---|
| Buyer order status **Waiting** | 214 orders; 84 BOM lines | When does an order wait, and what releases it (approval?) |
| Buyer order status **Rejected** | 157 orders; 159 BOM lines | Who rejects, and can it be reopened? |
| Buyer order status **Part Ship** / **Shipped** | 100 / 47 orders; shipped qty 731,881 of 1,751,799 on Part Ship, 182,752 of 184,164 on Shipped | Set automatically from shipments? The hub only describes Part Ship/Shipped for deliveries and RMPOs. |
| BOM line status **Received** | 3 lines | Possibly test data; confirm. |
| Order BOM lines with value but no quantity or rate | 26,845 of 36,298 zero-quantity lines carry a value; only 71 have a rate | Are these lump-sum lines (services, processing) or a gap in the QA view? |

## Patterns worth confirming (observations, not rules)

- No Confirmed order has any shipped quantity (0 of 29,341). Every order with a shipment is Part Ship, Shipped, Closed (5,671 of 7,786) or, rarely, Cancelled (9) / Rejected (3). This suggests the status leaves Confirmed on the first shipment.
- 2,115 Closed orders have no shipment — closed manually, consistent with the hub's "Close Order" rule.
- Product groups (FABRIC, SEWING TRIMS, PACKING TRIMS, LINING, PROCESSING …) are per-company setup, so the hub's BOM sections (Fabric, Service, Yarn, Misc, Trim) are the NIS-58 configuration, not a fixed list.
- UOMs are free per company (129 values, e.g. MTRS and MTR side by side, BOX-10, 200MTRS).

## Not testable with this connector

Indents (incl. the Inactive-by-default rule), RMPO, GRN, ASN, loss/wastage/shrinkage chain inputs, Buyer Block Booking. The connector exposes only orders, order BOM lines, styles and materials.
