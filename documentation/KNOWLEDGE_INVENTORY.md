# Knowledge inventory

Every source of WFX knowledge found on 2026-11-16, how it is organised, and what happens to it. The generated section at
the end is rewritten by `npm run kb:inventory` from the live registry, so its numbers are always current.

## 1. Knowledge already inside the repository (v1 Knowledge Hub)

Organisation in v1: hand-transcribed TypeScript modules in `src/app/data/`, exported by the build into CSV tables.

| Source file | What it holds | Count | Came from |
| --- | --- | --- | --- |
| `salesorder.ts` | Sales Order (re-write) rules + scenario tables | 57 rules, 9 tables | Sprint 1–3 specs, Sales Order Gaps, order-type note, Desync Price note |
| `manuals.ts` | How-to guide sections in 5 areas | 85 sections | 9 user manuals (Style/BOM, AI tech pack, OC closure, stock write-off, sourcing, inventory/QC PDF, sample order, TNA, WMS) + 1 inferred "roll" overview |
| `calculations.ts` | Formulas with `verified`/`assumed` status and open questions | 54 | NIS-58 workbook, NIS-59 screenshots, owner's explanations |
| `cons.ts` | Consumption chain (loss factor, wastage, shrinkage) | 1 chain | Owner's explanation, 2026-11-12 |
| `concepts.ts` | Dependency types, UOM types, BOM concepts, article coding, MRP rules, article code rules/sections | 22 concepts, 5 code rules, 19 code sections | Owner's explanations |
| `glossary.ts` | Terms | 136 | Derived from the above |
| `transactions.ts` | 15 transactions: theory, keys, upstream/downstream, field groups, checks, captured tables, cases | 15 | NIS-58 workbook, live captures |
| `docs.ts` | Data-model documents: screens, grids, columns (type, formula, source column) | 4 chapters | Live captures (NIS-59), workbook (NIS-58), specs |
| `journey.ts` | End-to-end workflow: phases, steps, prerequisites, step groups, scenarios | 6 phases, 30+ steps, 6 scenarios | Workbook + owner |
| `modules.ts` | 8 modules and what belongs to each | 8 | Hub organisation |
| `records.ts` | Captured transaction values for Adi TShirt (NIS-59) and Flannel Shirt Adi (NIS-58) | 20+ tables | WFX screens, workbook |
| `theory-extras.ts`, `catalog.ts` | One-line summaries, transaction index, flow index, colours, sizes | — | Hub |

Exports: 57 CSV tables in `data/<module>/` (copy in `public/data/`) and `data/order/sales_order_knowledge.txt`.
Screenshots: 22 WFX screen captures in `public/screens/` (WebP).

## 2. Knowledge outside the repository

| Location | What | Count | Decision |
| --- | --- | --- | --- |
| `D:\Sprints\` | WFX sprint and enhancement specifications (Sales Order sprints 1–3, Sales Order Gaps, order types, Desync Price, ASN, Auto MRP Split, GDN/GRN automation, Buyer Block Booking, Discount & commission, Job Order, Kit MRP, Kit/Pack costing and enhancement, Program) | 23 Word files (+3 Office lock/temp files, skipped) | **Imported** as source documents |
| `Downloads\WFX_Data_Model_Flow_NIS-58_v4.xlsx` | The 15-sheet workbook the hub was first built from | 1 | **Imported** |
| `Downloads\` – the 9 user manuals already used | New BOM NK1, AI Tech pack Configuration Classic, OC Closer Setup, Stock write off, Sourcing manual, Inventory and QC process flow (PDF), Sample Order Manual, TNA Workflow, WMS Workflow | 9 | **Imported** |
| `WFX-Product-Demo\site\specs\` | WFX product specifications as HTML: Admin, BU Role Setup, FA, Sales (+37 images) | 4 documents | **Imported** |
| `WFX-Product-Demo\site\mock-api\` | Demo mock data (104 JSON files: ASNs, GRNs, indents, RMPOs, sales orders, kit packs, MRP…) | 104 | Listed as reference data (demo values, not WFX behaviour); not imported yet |
| `Downloads\` – other documents | 406 readable document/image files, 319 distinct contents; 217 distinct files have WFX-like names (change requests with ticket numbers, BRDs, SRSs); the folder also holds personal files | ~217 WFX-like | **Not imported.** Listed by name in `knowledge/metadata/discovered_sources.json` for the owner to choose; import with `npm run kb:import -- <file or folder>` |

## 3. How the platform organises it

- v1 TypeScript knowledge → migrated entry by entry into `knowledge/**/*.txt` (Layer B), with the source of each entry.
  A test compares the counts with the v1 arrays so nothing is lost.
- External documents → copied unchanged into `knowledge/original_sources/` (Layer A), extracted into
  `knowledge/extracted/`, indexed (Layer C). Possible rules found in them become review candidates, never rules on their own.
- The v1 files are not deleted or edited; the static site keeps using them.

<!-- GENERATED:START -->
## Generated: current state (2026-11-16 10:45 UTC)

### TXT library (Layer B)

| Entry type | Entries | By status |
| --- | --- | --- |
| case | 21 | Active 21 |
| dependency | 37 | Active 37 |
| field | 136 | Active 136 |
| model | 28 | Active 28 |
| module | 8 | Active 8 |
| procedure | 85 | Active 84, Under Review 1 |
| rule | 150 | Active 144, Under Review 6 |
| term | 155 | Active 154, Under Review 1 |
| transaction | 15 | Active 15 |
| workflow | 12 | Active 12 |

27 TXT files; format problems: 0.

| File | Entries |
| --- | --- |
| knowledge/business_rules/general_rules.txt | 24 |
| knowledge/business_rules/planning_rules.txt | 3 |
| knowledge/business_rules/sales_rules.txt | 68 |
| knowledge/calculations/planning_calculations.txt | 8 |
| knowledge/calculations/production_calculations.txt | 5 |
| knowledge/calculations/sales_calculations.txt | 10 |
| knowledge/calculations/sourcing_calculations.txt | 10 |
| knowledge/calculations/style_bom_calculations.txt | 22 |
| knowledge/data_models/admin_documents.txt | 4 |
| knowledge/data_models/order_documents.txt | 10 |
| knowledge/data_models/sales_documents.txt | 7 |
| knowledge/data_models/setup_documents.txt | 7 |
| knowledge/glossary/erp_terms.txt | 129 |
| knowledge/glossary/garment_manufacturing_terms.txt | 26 |
| knowledge/modules/inventory.txt | 15 |
| knowledge/modules/planning.txt | 1 |
| knowledge/modules/production.txt | 1 |
| knowledge/modules/sales.txt | 21 |
| knowledge/modules/setup.txt | 1 |
| knowledge/modules/sourcing.txt | 26 |
| knowledge/modules/style_bom.txt | 18 |
| knowledge/modules/tna.txt | 10 |
| knowledge/transactions/field_definitions.txt | 136 |
| knowledge/transactions/transaction_cases.txt | 21 |
| knowledge/transactions/transaction_definitions.txt | 15 |
| knowledge/transactions/transaction_dependencies.txt | 37 |
| knowledge/workflows/workflows.txt | 12 |

### Source documents (Layer A)

| ID | Title | Type | Knowledge status | Module (detected or set) | Versions | Extraction |
| --- | --- | --- | --- | --- | --- | --- |
| DOC-0001 | ASN Screen Changes Spec Corrected | specification | source-documented | unclassified | 1 | indexed |
| DOC-0002 | Sales ASN FG allocation TAB in Without GDN 1 | other | source-documented | Sales Order | 1 | indexed |
| DOC-0003 | Auto MRP Split | other | source-documented | Planning | 1 | indexed |
| DOC-0004 | Automation is required for GDN and GRN | other | source-documented | Booking & sourcing | 1 | indexed |
| DOC-0005 | BBB New Enhancement (Proj-Reservation-Confirmed) | specification | source-documented | Booking & sourcing | 1 | indexed |
| DOC-0006 | BBB To Confiremd Order On Order adjustement Dev | other | source-documented | Booking & sourcing | 1 | indexed |
| DOC-0007 | Discount and commision FInal Specs 391988 | specification | proposed | Sales Order | 8 | indexed |
| DOC-0008 | Auto FPOJob Order Creation Setup | specification | source-documented | Production | 1 | indexed |
| DOC-0009 | FPPO Job Order Sprint 2 (Single & Multi Level Approval) | specification | source-documented | Production | 1 | indexed |
| DOC-0010 | KIT Pack MRP Enhancement | specification | source-documented | Production | 1 | indexed |
| DOC-0011 | Kit pack Costing - NEW BOM addon Final | other | source-documented | Style & BOM | 1 | indexed |
| DOC-0012 | Kit Pack Enhancement version2 | specification | source-documented | Style & BOM | 3 | indexed |
| DOC-0013 | Back, purchase, MTS Orders | other | source-documented | Sales Order | 1 | indexed |
| DOC-0014 | Program | other | source-documented | unclassified | 1 | indexed |
| DOC-0015 | Desync Price OC List | other | source-documented | Sales Order | 1 | indexed |
| DOC-0016 | Sales Order Gaps | specification | proposed | Sales Order | 2 | indexed |
| DOC-0017 | Sales Order Sprint - 3 V1 | specification | proposed | Sales Order | 3 | indexed |
| DOC-0018 | Sprint-01 (OC Creation & List,Buyer wise Order screen - Configuration,OC Creation - Structure, Manufacturing Order, CM for KS Fashion) | specification | proposed | Sales Order | 2 | indexed |
| DOC-0019 | Sprint-02 | specification | source-documented | Sales Order | 1 | indexed |
| DOC-0020 | WFX Data Model Flow NIS-58 v4 | data | source-documented | Style & BOM | 1 | indexed |
| DOC-0021 | New BOM NK1 | manual | source-documented | Style & BOM | 1 | indexed |
| DOC-0022 | AI Tech pack Configuration Classic | manual | source-documented | Style & BOM | 1 | indexed |
| DOC-0023 | 337356 - OC Closer Setup New Angular Page | manual | source-documented | Sales Order | 1 | indexed |
| DOC-0024 | Sourcing Module User Manual Enhanced | manual | source-documented | Booking & sourcing | 1 | indexed |
| DOC-0025 | Inventory and QC process flow Kisah | manual | source-documented | Inventory, QC & WMS | 1 | indexed |
| DOC-0026 | Stock write off Auto OC closure stock transfer configuration | manual | source-documented | Sales Order | 1 | indexed |
| DOC-0027 | Sample Order Manual final1 V11 | manual | source-documented | Style & BOM | 1 | indexed |
| DOC-0028 | TNA Workflow | manual | source-documented | unclassified | 1 | indexed |
| DOC-0029 | WMS Workflow 1 | manual | source-documented | Inventory, QC & WMS | 1 | indexed |
| DOC-0030 | wfx-erp-product-admin-spec | specification | source-documented | unclassified | 1 | indexed |
| DOC-0031 | wfx-erp-product-bu-role-setup-spec | specification | source-documented | unclassified | 1 | indexed |
| DOC-0032 | wfx-erp-product-fa-spec | specification | source-documented | Booking & sourcing | 1 | indexed |
| DOC-0033 | wfx-erp-product-sales-spec | specification | source-documented | Sales Order | 1 | indexed |
| DOC-0034 | KIT MRP | specification | source-documented | Planning | 1 | indexed |
| DOC-0035 | KIT Pack MRP Enhancement Spec | specification | source-documented | Production | 1 | indexed |
| DOC-0036 | Kit Enhancements | specification | source-documented | unclassified | 1 | partial |
| DOC-0037 | Kit Enhancements | specification | source-documented | Style & BOM | 1 | indexed |
| DOC-0038 | Kit Enhancements Simplified | specification | source-documented | Style & BOM | 1 | indexed |
| DOC-0039 | Kit Pack Costing WFX | specification | source-documented | Style & BOM | 1 | indexed |
| DOC-0040 | Kit pack Costing | specification | source-documented | Style & BOM | 1 | indexed |
| DOC-0041 | Multi Style KIT COSTING | specification | source-documented | Style & BOM | 1 | indexed |
| DOC-0042 | Kit OC 20260707105103 | specification | source-documented | Sales Order | 1 | indexed |
| DOC-0043 | 405992 - Restriction of selecting packing kit while creation sales order through program | specification | source-documented | Sales Order | 1 | indexed |
| DOC-0044 | bom kit pack cost rollup flow | specification | source-documented | Style & BOM | 1 | stored_only |
| DOC-0045 | wfxqa.worldfashionexchange.com WFXBase4.0 WFXTNAConfig.aspx Action=New&GUID=e32f7e55-0d84-4ea9-985a-916f0ebd6a6a 1LXy6u | image | proposed | unclassified | 2 | stored_only |
| DOC-0046 | 17. “ASN without GDN” must be restricted in the absence of an approved cost sheet. | change_request | proposed | Sales Order | 1 | indexed |
| DOC-0047 | 18. Need Designer name field in WFXSOPackage import file format. Company - indochine international | change_request | proposed | unclassified | 1 | indexed |
| DOC-0048 | 21.  Buyer Blocking | other | proposed | unclassified | 1 | indexed |
| DOC-0049 | 255855 | change_request | proposed | Sales Order | 1 | indexed |
| DOC-0050 | 256707-Site Category selected on the on the site is not working as per selection | change_request | proposed | unclassified | 2 | partial |
| DOC-0051 | 261472- Return To Supplier Different OC Allocated MAterial1 | change_request | proposed | Sales Order | 1 | indexed |
| DOC-0052 | 279362 - Advance Incentive - AIPL 11092025 | change_request | proposed | unclassified | 1 | indexed |
| DOC-0053 | 279362 - Export Incentive Management | change_request | proposed | unclassified | 1 | indexed |
| DOC-0054 | 279362 - Export Incentive Management 260226 | change_request | proposed | Sales Order | 3 | indexed |
| DOC-0055 | 279362-Advance Incentive Handling | change_request | proposed | Sales Order | 3 | indexed |
| DOC-0056 | 293106  - E-way & E-INvoice generation in case of Different site GSTIN transfer, Automation is required for GDN and GRN | change_request | proposed | Booking & sourcing | 1 | indexed |
| DOC-0057 | 293106  -Updated | change_request | proposed | Sales Order | 1 | indexed |
| DOC-0058 | 293106  -Updated On Behalf of Hari Sir | change_request | proposed | Sales Order | 2 | indexed |
| DOC-0059 | 298306 - Tracker Point 66-RMPO Excess Procurement Approval (Martex) | change_request | proposed | Booking & sourcing | 3 | indexed |
| DOC-0060 | 332558 Procurement against Buyer Block Booking 06-10-2025 | change_request | proposed | Booking & sourcing | 1 | indexed |
| DOC-0061 | 334178 -In Pre shipment export invoice screen, make default values in 'Consignor Address' and 'Location name' based on Execution Company & factory selection. | change_request | proposed | unclassified | 1 | partial |
| DOC-0062 | 349251 Need Line wise MRP Approval same as Existing MRL Approval FunctionalityV02 | change_request | proposed | Planning | 1 | indexed |
| DOC-0063 | 349905 | change_request | proposed | unclassified | 1 | indexed |
| DOC-0064 | 351028 - excess not showing in the PO screen | change_request | proposed | Booking & sourcing | 2 | indexed |
| DOC-0065 | 355229-Required provision to update the GRN in Movement Units in Storage UOM V2 | change_request | proposed | Booking & sourcing | 1 | indexed |
| DOC-0066 | 356333 | change_request | proposed | Sales Order | 1 | indexed |
| DOC-0067 | 361027. | change_request | proposed | Style & BOM | 1 | indexed |
| DOC-0068 | 365986 - Multiple Supplier Payment Request Voucher | change_request | proposed | unclassified | 1 | indexed |
| DOC-0069 | 367532 - Option to freeze the PD Consumption on User update | change_request | proposed | Style & BOM | 2 | indexed |
| DOC-0070 | 368518 In the Approval Center, display a customized form that is linked to the related transaction (Disbursement Form & Request Form) | change_request | proposed | unclassified | 1 | indexed |
| DOC-0071 | 368596 - Automatic Disbursement request (Invoicing) from the system after ASN | change_request | proposed | Booking & sourcing | 1 | indexed |
| DOC-0072 | 368638 - Nego date and Bank fields needed to update negotiation information against multiple invoice | change_request | proposed | unclassified | 1 | indexed |
| DOC-0073 | 372826 Material Code Request for BOM IntegrationV01 | change_request | proposed | Style & BOM | 1 | indexed |
| DOC-0074 | 379687-OC Quantity Reduction After RMPO Creation(Inquiry Order Qty reduction upto zero on split only) | change_request | proposed | unclassified | 2 | indexed |
| DOC-0075 | 388821 - 3DCS Roll selection Issue | change_request | proposed | Sales Order | 1 | indexed |
| DOC-0076 | 389725 | change_request | proposed | Style & BOM | 2 | indexed |
| DOC-0077 | 389725 BOM Changes | other | proposed | Style & BOM | 1 | indexed |
| DOC-0078 | 391947 - Import Logistics 060626 | change_request | proposed | Booking & sourcing | 1 | indexed |
| DOC-0079 | 391947 - Import Logistics 220226 | change_request | proposed | Booking & sourcing | 1 | indexed |
| DOC-0080 | 392088 - OCR Functionality | change_request | proposed | Sales Order | 2 | indexed |
| DOC-0081 | 392551 MSL Functionality and Auto Indent Generation | change_request | proposed | Booking & sourcing | 1 | indexed |
| DOC-0082 | 399624 Color Confirmation - Block Booking v1 | change_request | proposed | Sales Order | 1 | indexed |
| DOC-0083 | 402748- Revised | change_request | proposed | Style & BOM | 5 | indexed |
| DOC-0084 | 405186 - PD Queries | change_request | proposed | Planning | 2 | indexed |
| DOC-0085 | 405186 - Revised | change_request | proposed | Planning | 2 | indexed |
| DOC-0086 | 405186-Auto MRP v1 | change_request | proposed | Sales Order | 5 | indexed |
| DOC-0087 | 405186-Auto MRP v2 15-Sep | change_request | proposed | Sales Order | 1 | indexed |
| DOC-0088 | 405585 Sales Order (OC) Enhancement | change_request | proposed | Sales Order | 1 | indexed |
| DOC-0089 | 409855 Billable Qty Provision if FPPO for Part Schifly Handling | change_request | proposed | unclassified | 2 | indexed |
| DOC-0090 | 409855 Billable Qty Provision if FPPO for Part Schifly Handling r2 | change_request | proposed | Booking & sourcing | 1 | indexed |
| DOC-0091 | 409953 - Org Structure - Detailed Review | change_request | proposed | unclassified | 1 | indexed |
| DOC-0092 | 411748 - Cost consumption and FG Calculation screen | change_request | proposed | unclassified | 1 | indexed |
| DOC-0093 | 412396-Request for Restrict Dispatch Functionality for NEW BOM | change_request | proposed | Style & BOM | 1 | indexed |
| DOC-0094 | 412681 - Auto Selection of Material Colors Sizes to Garment Color Sizes, if the colors  Sizes of material matches with Garment | change_request | proposed | unclassified | 1 | indexed |
| DOC-0095 | 412883 - TP Mapping configuration setup is required on the UI Updated | change_request | proposed | unclassified | 1 | indexed |
| DOC-0096 | 413145 | change_request | proposed | Style & BOM | 7 | indexed |
| DOC-0097 | 414392 | change_request | proposed | unclassified | 1 | indexed |
| DOC-0098 | 414922,Option to add part and placement details in the variants | change_request | proposed | Style & BOM | 1 | indexed |
| DOC-0099 | 424698-Multiple Fabric Width & Price List handling | change_request | proposed | Style & BOM | 2 | indexed |
| DOC-0100 | 431936 -Tracker Point 67-PSN-Make default values in 'Location Name' based on factory selection-Ref ID-67-379437 | change_request | proposed | unclassified | 1 | partial |
| DOC-0101 | 437763 Need to Handle Buyer Blocking Booking based Indent Creation later Indent will be Tagged to Supplier Block booking for Greige Booking. Need to Track Projection end to end. | change_request | proposed | Booking & sourcing | 1 | indexed |
| DOC-0102 | 437763 PD Queries | change_request | proposed | Booking & sourcing | 4 | indexed |
| DOC-0103 | 437763 PD Queries (AutoRecovered) | change_request | proposed | Booking & sourcing | 1 | indexed |
| DOC-0104 | 441574 - Airway Bill Update and DBK Posting | change_request | proposed | unclassified | 1 | indexed |
| DOC-0105 | 442564 | change_request | proposed | Style & BOM | 1 | indexed |
| DOC-0106 | 449020 | change_request | proposed | unclassified | 1 | indexed |
| DOC-0107 | 450654 Required FG Site Allocation section in Sales ASN when ASN Type is without GDN. | change_request | proposed | unclassified | 1 | indexed |
| DOC-0108 | Afflatus GDN | other | proposed | unclassified | 1 | indexed |
| DOC-0109 | Approval MRP Final | other | proposed | Planning | 1 | indexed |
| DOC-0110 | Article Master new1 | data | proposed | unclassified | 1 | indexed |
| DOC-0111 | BRD 419750 If color size wise price is mentioned in price list, average price should be taken in BOM | other | proposed | Style & BOM | 1 | indexed |
| DOC-0112 | BRD AI Techpack Revision BOM Version Management | other | proposed | Style & BOM | 1 | indexed |
| DOC-0113 | BRD Auto MRP Shahi Exports | other | proposed | Planning | 2 | indexed |
| DOC-0114 | Buyer block booking | other | proposed | Booking & sourcing | 1 | indexed |
| DOC-0115 | CFAI Make To Stock 9 May 2026 2 | other | proposed | Production | 1 | indexed |
| DOC-0116 | Cons. Formulas 2 | data | proposed | unclassified | 1 | indexed |
| DOC-0117 | Copy of INV# BE1471-719282-1 -IGST | data | proposed | unclassified | 1 | indexed |
| DOC-0118 | CRS Stock Transfer Specification | specification | proposed | unclassified | 1 | indexed |
| DOC-0119 | Delivery OC print | other | proposed | Sales Order | 1 | partial |
| DOC-0120 | Discount ad comission Percentage Handling Helpdesk ID- 391988 | specification | proposed | Sales Order | 2 | indexed |
| DOC-0121 | Discount ad comission Percentage Handling Helpdesk ID- 391988-New | specification | proposed | Sales Order | 1 | indexed |
| DOC-0122 | Effeciency should be auto allocated based slab , BuyerFactory level slab will be defined in teh masters and the same effieciency will be pulled for routing | other | proposed | Style & BOM | 2 | indexed |
| DOC-0123 | FA New FPPO Split Division Wise Structure (with 3 GSTN) of FA Home and Apparel Pvt LimitedV1 1 V5 1 1 | other | proposed | Production | 1 | indexed |
| DOC-0124 | Formatted Consumption Sheet | data | proposed | Style & BOM | 1 | indexed |
| DOC-0125 | Generate UPC GTIN-419765 | other | proposed | Style & BOM | 1 | indexed |
| DOC-0126 | GRN Enhancements | specification | proposed | Booking & sourcing | 1 | indexed |
| DOC-0127 | GRNShadeLot 20260221214705 | data | proposed | unclassified | 1 | indexed |
| DOC-0128 | In-House stock adjustment (Equivalent Article) for different Article Product Group [THANH] | other | proposed | unclassified | 1 | indexed |
| DOC-0129 | Issue ID  382251 - Equivalent Article adjustment column detail Issue in FPO-FPPO | change_request | proposed | Production | 1 | indexed |
| DOC-0130 | Issue ID  414282 - Job order enhancement | change_request | proposed | Booking & sourcing | 2 | indexed |
| DOC-0131 | Issue ID 382412 | change_request | proposed | Production | 1 | indexed |
| DOC-0132 | Issue ID 382412 revised | change_request | proposed | Production | 1 | indexed |
| DOC-0133 | Manufacturing Base Module 349251 Release Notes | other | proposed | unclassified | 1 | indexed |
| DOC-0134 | Manufacturing Base Module 352391 Release Notes | other | proposed | Booking & sourcing | 1 | indexed |
| DOC-0135 | Manufacturing base module 372826 - Release Note | other | proposed | Style & BOM | 1 | indexed |
| DOC-0136 | Manufacturing Base Module 414433 Release Notes | other | proposed | unclassified | 1 | indexed |
| DOC-0137 | MRP-284648V01 | other | proposed | Planning | 1 | indexed |
| DOC-0138 | MRP Dashboard Template | data | proposed | Planning | 1 | indexed |
| DOC-0139 | MRP Dashboard Updated | data | proposed | Planning | 1 | indexed |
| DOC-0140 | mutli status approve without second approval | image | proposed | unclassified | 1 | stored_only |
| DOC-0141 | New Approval Center | other | proposed | Sales Order | 1 | indexed |
| DOC-0142 | OC approval | image | proposed | Sales Order | 1 | stored_only |
| DOC-0143 | PRice Mismatch case on GRN | other | proposed | Booking & sourcing | 1 | indexed |
| DOC-0144 | Production Costs | other | proposed | Production | 2 | indexed |
| DOC-0145 | Production Costs (PD Queries) | other | proposed | Production | 1 | indexed |
| DOC-0146 | Ref FA New FPPO Split Division Wise Structure (with 3 GSTN)V01 | other | proposed | Booking & sourcing | 1 | indexed |
| DOC-0147 | rptStockMovement b823a790-15f9-49f4-8f75-d1c5479e0eb8 | data | proposed | Production | 1 | indexed |
| DOC-0148 | rptStockOverviewNew 15d897c1-4e06-4588-9e8d-52ce7426fd48 | data | proposed | unclassified | 1 | indexed |
| DOC-0149 | Sales order Flex fileds | data | proposed | Sales Order | 1 | indexed |
| DOC-0150 | Sales Order gaps | specification | proposed | Sales Order | 1 | indexed |
| DOC-0151 | Sales Order IMPL Gaps PD remarks | specification | proposed | unclassified | 1 | indexed |
| DOC-0152 | Sales Order Missing fields formatted | data | proposed | Sales Order | 1 | indexed |
| DOC-0153 | Sales Order Size Group | other | proposed | Sales Order | 1 | indexed |
| DOC-0154 | Sales Order View Page | image | proposed | Sales Order | 1 | stored_only |
| DOC-0155 | sales asn fg allocation workflow final | image | proposed | unclassified | 1 | stored_only |
| DOC-0156 | Sales ASN Product Spec v1.1 | specification | proposed | Sales Order | 1 | indexed |
| DOC-0157 | Screenshot 2026-02-05 164243 | image | proposed | unclassified | 1 | stored_only |
| DOC-0158 | Screenshot 2026-07-27 170015 | image | proposed | unclassified | 1 | stored_only |
| DOC-0159 | Screenshot 2026-11-13 155035 | image | proposed | unclassified | 1 | stored_only |
| DOC-0160 | SEPL-BRD WFX Standalone Material Creation Request v1 0 | other | proposed | unclassified | 1 | indexed |
| DOC-0161 | Shipment Planning, Export Logistics & Government Incentive Handling | specification | proposed | unclassified | 5 | indexed |
| DOC-0162 | ShipmentDetails 20260429125713 | data | proposed | unclassified | 1 | indexed |
| DOC-0163 | ShipmentDetails 20260930095033 | data | proposed | unclassified | 1 | indexed |
| DOC-0164 | Specs- 354532 | specification | proposed | unclassified | 1 | indexed |
| DOC-0165 | techpack destination page | image | proposed | Style & BOM | 1 | stored_only |
| DOC-0166 | Unique BSR based on Division-Buyer-Season | other | proposed | unclassified | 1 | indexed |
| DOC-0167 | WFX ERP Customer Specification & Approval | specification | proposed | unclassified | 1 | indexed |
| DOC-0168 | WFX fields RMPO Tactive | data | proposed | Booking & sourcing | 1 | indexed |
| DOC-0169 | WFX scanned joining docs compressed | other | proposed | unclassified | 1 | partial |
| DOC-0170 | WFX-ERP 1 | other | proposed | Style & BOM | 1 | indexed |
| DOC-0171 | WFX ARCHITECTURE BLUEPRINT | other | proposed | unclassified | 1 | indexed |
| DOC-0172 | WFX BOM Techpack Change AF | data | proposed | Style & BOM | 1 | indexed |
| DOC-0173 | WFX Functional Specification Template | specification | proposed | Sales Order | 1 | indexed |
| DOC-0174 | WFX Menu Shahi VS HTML - Technology | data | proposed | unclassified | 1 | indexed |
| DOC-0175 | WFX Menu Shahi VS HTML V10 - Proposed Menu | data | proposed | Style & BOM | 1 | indexed |
| DOC-0176 | WFX Menu Shahi VS HTML V10 - Proposed Menu- With Path | data | proposed | Style & BOM | 1 | indexed |
| DOC-0177 | WFX Menu Comparison Excel vs HTML AVP | data | proposed | unclassified | 1 | indexed |
| DOC-0178 | WFX Menu Shahi VS HTML V10 - Proposed Menu- With Path NEW | data | proposed | unclassified | 1 | indexed |
| DOC-0179 | WFX Training Module Tracker | data | proposed | Booking & sourcing | 1 | indexed |
| DOC-0180 | WFX V10 Menu Spec | specification | proposed | Style & BOM | 1 | indexed |

Repository sources of the migrated entries: SRC-V1-MODULES, SRC-V1-MANUALS, SRC-V1-SALESORDER, SRC-V1-CONCEPTS, SRC-V1-CALCULATIONS, SRC-V1-CONS, SRC-V1-GLOSSARY, SRC-V1-TRANSACTIONS, SRC-V1-DOCS, SRC-V1-JOURNEY, SRC-V1-THEORY-EXTRAS, SRC-V1-CATALOG, SRC-V1-RECORDS.

Discovered but not imported (Downloads): 205 distinct documents (277 files, 157 names) – see knowledge/metadata/discovered_sources.json.
<!-- GENERATED:END -->
