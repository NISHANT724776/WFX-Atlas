# Sales Order module (WFX Atlas)

Built from the owner's specifications: `D:\Sprints\Sales Order Sprint\Sprint-01 …docx`, `Sprint-02.docx`, `Sales Order Sprint - 3 V2.docx` and `D:\Sprints\Order type handelling in Sales Order\Back, purchase, MTS Orders.docx` (text and the 283 embedded screenshots were read). Data is stored in the Atlas SQLite database; nothing is shown from hard-coded sample orders.

## Where it is

| | |
| --- | --- |
| Screens | **Sales** in the top bar → `/sales-order` (list), `/sales-order/:id` (order), `/sales-order-setup` (admin) |
| API | `/api/v2/so/*` in `backend/src/api.ts` |
| Logic | `backend/src/sales/masters.ts` (masters, SLC seed), `config.ts` (SLC, views, Additional Fields, buyer-wise resolution), `orders.ts` (orders, deliveries, articles, quantities, pricing, approvals, history, list) |
| Tables | `database/migrations/007_sales_order.sql` |
| Masters | `knowledge/sales_order/masters.json` (every record names its source), `knowledge/sales_order/fields.json` (the Sprint-01 field table, 114 fields) |
| Tests | `tests/sales/sales-order.test.ts` (17 tests) |

## Data model

`so_orders` (Main OC) → `so_deliveries` (Delivery OC) → `so_delivery_articles` (article line: BOM, price source, Price Per, base price, Extra Production %) → `so_breakups` (first grid, each Add Qty grid, the Additional Qty grid: packing type, codes, cartons, inseam) → `so_qty` (colour × size: pieces, PP, ratio, upcharge). Approvals in `so_approvals`, every action in `so_history` (who, when, before, after, remarks). Masters: `so_categories`, `so_buyers`, `so_articles`, `so_boms` (with routing), `so_cost_sheets`, `so_ex_factory`, `so_lookups`. Screen configuration: `so_fields`, `so_slc`, `so_views`, `so_view_permissions`; `so_approvers`, `so_tool_permissions`, `so_settings`.

## Requirement coverage

| Area | Requirement | Source | Status |
| --- | --- | --- | --- |
| List | Main OC Wise (default) / Style Wise over the same orders | Sprint-01 §3 | Built |
| List | Search (order no, article, buyer order ref), Status and Buyer filters, sort by created on, refresh, server paging and page size, row selection, row ⋮ (open, sync, cancel, close), header ⋮ (export) | Sprint-01 §3, Sprint-3 Export | Built |
| List | Columns: order, article, status, buyer, season, order qty, ASN qty, GDN qty, value, deliveries, buyer order / delivery / OC delivery dates, created | Sprint-01 §3 | Built; ASN / GDN show 0 (no shipping documents in Atlas) |
| List | Progress %, FPO details, kit ref, delivery expand in the row | Sprint-01 §3 | Not built |
| Add New Order | Popup with Category and Buyer (buyer filtered by category) → OK → order screen | Sprint-01 §4.1 | Built |
| Configuration | SLC (company level) for Sales Order New / List: visible, mandatory and editable (New only), order; "Always" fields cannot be hidden | Sprint-01 §1, Sprint-3 correction | Built |
| Configuration | Views: New views mapped to buyers (one New view per buyer), permitted users; List views one per user with scope "my orders" / "my orders + permitted buyers" | Sprint-01 §2 | Built |
| Configuration | Buyer-wise resolution: buyer's view if the user is permitted, otherwise Default (SLC) — the GAP / LEVIS / RED TAPE cases | Sprint-01 §2 | Built and tested |
| Configuration | Additional Fields (renamed Flex Fields): Alphanumeric, Dropdown single/multi, Date, Numeric Box, Text Box; validation None / Alphanumeric / Numeric | Sprint-3 | Built |
| Configuration | Drag-and-drop field placement, left/right pin | Sprint-01, Sprint-3 | Up/down buttons instead of drag; no pins (Sprint-3 says none on New) |
| Order | Order Information / Other Details / Additional Fields from the resolved layout; Instructions tab; History tab | Sprint-01 §4 | Built |
| Order | Documents section | Sprint-01 §4.9 | Not built |
| Deliveries | Left panel, Add (+), select, multi-select | Sprint-01 §4.6, Sprint-02 | Built |
| Deliveries | Copy (style kept; number, dates, reference and quantities re-entered) | Sprint-02 | Built |
| Deliveries | Delete (single/multiple, confirmation; blocked on Confirmed * with a draft delivery) | Sprint-02, Sprint-3 | Built |
| Deliveries | Split by percentage (Existing × % ÷ 100, UOM rounding) or quantity (proportional, exact total) into a new delivery | Sprint-02 | Built |
| Deliveries | Cancel, Close (remarks mandatory), Reopen (closed only) | Sprint-02 | Built |
| Deliveries | Duplicate check (Buyer Order Ref + Buyer Delivery Date + OC Delivery Date + Mode of Shipment) | Sprint-3 | Built |
| Deliveries | OC Delivery Date = Buyer Delivery Date − ex-factory days (master by shipment mode, buyer, department) | Sprint-3 | Built |
| Articles | Multiple articles per delivery from the buyer's articles; expand/collapse; grid / table view; kit articles grid only; no kit and non-kit mix | Sprint-3 | Built (Expand All not built) |
| Articles | BOM: latest accepted approved BOM by default, or the BOM the user picks; routing of that BOM shown | Sprint-2/3 | Built |
| Quantities | Packing types: Solid/Solid (one colour, one size), Solid Colour / Assorted Size (one colour, PP × ratios), Multiple Prepack (PP × ratios) | Sprint-3 | Built (see open point 1) |
| Quantities | Add Qty grids (packing type frozen), Additional Qty grid (shown apart, not in order value), Extra Production % → planned qty, Inseam from the size master | Sprint-3 | Built; inseam is chosen per grid (Sprint-3 uses Add Qty for inseam sizes) |
| Pricing | Price Per from the tech pack (never typed); upcharge/discount at that level; final price read-only and never below 0 | Sprint-3 | Built for Article / Color / Size in the screen; Color/Size per cell is in the API only |
| Pricing | Price pickup: cost sheet (destination-wise, when OC price validation is on) → latest accepted BOM → tech pack base | Sprint-2/3 | Built (see open point 3) |
| Pricing | Desync indicator, Sync price (order and list), logged | Sprint-2 | Built |
| Approval | Approval value per approver: 0 never, −1 always, > 0 above the value; creator names the approver; Approval Centre on the list; approve / reject with remarks | Sprint-2 | Built |
| Approval | Multi-level: a non-final approver names the next; final approver confirms | Sprint-2 | Built |
| Status | Draft, Pending Approval, Confirmed, Rejected, Cancelled, Closed; Revise (reason and authorised-by mandatory) → Confirmed * | Sprint-01/3 | Built |
| Order actions | Cancel order (cancels every Delivery OC), Close order (not when Cancelled/Closed) with remarks | Sprint-3 | Built |
| Permissions | Tool permission per role for every action, checked on the server; admin setup | Sprint-3 | Built (per role, not per user group) |
| History | Every action with user, time, before → after and remarks | Sprint-02/3 | Built |
| Not built | Split / Shuffle DOC to another order, Update TNA / Delete Track, OC Notes, Proforma / Print / BI Print, Run MRP, ASN/GDN detail, Sales Invoice, Buyer Order Dispatch, Material Re-allocation, EDI Buyer PO, Transfer Price (forward/backward), CM purchase price → GMPO, Back Order / Purchase / MTS downstream documents, Buyer Block Booking link | Sprint-02/3, Order types | Not built: they create or read documents (MRP, GMPO, ASN, invoices, TNA) that Atlas does not hold yet |

## Masters used

Captured WFX data from the knowledge base: articles **NIS-58 Flannel Shirt Adi** and **NIS-59 Adi TShirt**, buyer **GAP Kids · Kids-Tops-Knits**, colour card **Nis_colors**, size range **ERPSIZE**, **BOM #1 DP** (Approved) with **Routing #1**, cost-sheet selling prices 33.3333 and 4,000. Buyers **LEVIS, GAP, RED TAPE**, the ex-factory master (Sea, 7 days), the inseam values and the lookup lists are **spec examples** and are labelled so in `masters.json`. Replace them with the company masters by editing that file and running `npm run kb:reindex`.

## Open points (spec unclear — decided as below, please confirm)

1. **PCS = PP × TBA (Multiple Prepack)**: "TBA" is not defined, and the screenshots disagree (one shows Total Qty 1,202 for PP 2 and 1,200 pcs). Built as: pieces of a cell = PP of its colour × the size ratio; the same rule for Solid Colour / Assorted Size.
2. **Mandatory fields**: the spec's "Always" means always visible. Only Order Season and Buyer Delivery Date are seeded mandatory; the admin sets the rest in the SLC. Mandatory fields are checked at Confirm (a draft may be saved incomplete).
3. **Price source order** when a confirmed cost sheet and an accepted BOM both exist: built as cost sheet first (when "OC price validation" is on), then latest accepted BOM, then the tech pack base price; a BOM the user picks always wins.
4. **Add Qty for Solid Color / Solid Size**: the knowledge base says Add Qty is enabled for Assorted and Multiple Prepack only; Sprint-3 V2 text enables it for all three. Built for all three.
5. **Copy Delivery**: Sprint-02 keeps the style and blanks number, dates and quantities; the brief asked to keep "applicable information". Built per Sprint-02.
6. **Tool permissions** are per role (viewer / editor / approver / admin) because Atlas has no user groups; the spec assigns them to user groups.
7. **Approval when no approver is set up**: the order is confirmed directly.
