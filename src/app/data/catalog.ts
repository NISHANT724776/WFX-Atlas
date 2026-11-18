// Route-level catalogue. This file has no imports so the build script
// (scripts/seo-files.mjs) can read it directly to write sitemap.xml and llms.txt.

/**
 * Public site identity. `url` must be the final production origin (no trailing slash):
 * canonical tags, Open Graph URLs, sitemap.xml, robots.txt and llms.txt are all built from it.
 */
export const SITE = {
  name: 'WFX Knowledge Hub',
  url: 'https://wfx-knowledge-hub.vercel.app',
  locale: 'en_IN',
  ogImage: '/og-image.png',
  ogImageAlt: "WFX Knowledge Hub – every WFX transaction explained and connected across style setup, buyer block booking and sales order workflows",
};

export interface TxnIndexEntry {
  slug: string;
  short: string;
  step: number;
  name: string;
  module: string;
  description: string;
}

export const MODULES = [
  'Masters',
  'Product Development',
  'Pre-booking & Sourcing',
  'Order',
  'Planning',
  'Production',
] as const;

export const TXN_INDEX: TxnIndexEntry[] = [
  { slug: 'masters', short: 'Masters', step: 1, name: 'Masters – Colour, Size, UOM', module: 'Masters',
    description: 'Colour card, size range, UOM master and material-wise UOM conversion that every WFX transaction reads from.' },
  { slug: 'apparel-style', short: 'Apparel Style', step: 2, name: 'Apparel Style (Techpack)', module: 'Product Development',
    description: 'Style Flannel Shirt Adi (NIS-58) header, base colour list and base size list that drive BOM dependencies and order breakups.' },
  { slug: 'bom-materials', short: 'BOM Materials', step: 3, name: 'BOM – Materials & Dependency', module: 'Product Development',
    description: 'BOM material lines with consumption, wastage, loss and shrinkage maths, price conversion and colour/size dependency.' },
  { slug: 'bom-routing', short: 'BOM Routing', step: 4, name: 'BOM – Routing', module: 'Product Development',
    description: 'Production processes, operations and material linkage of BOM #1 DP, which later become FPPO process orders.' },
  { slug: 'bom-costing', short: 'BOM Costing', step: 5, name: 'BOM – Costing', module: 'Product Development',
    description: 'Material cost, production cost, total cost, profit, profit % and markup % for BOM #1 DP.' },
  { slug: 'rm-techpack', short: 'RM Techpack', step: 6, name: 'Raw Material Techpack', module: 'Product Development',
    description: 'Fabric article N-8 master: UOMs, colour card, dependency, buying price and cross-document checks.' },
  { slug: 'buyer-block-booking', short: 'Block Booking', step: 7, name: 'Buyer Block Booking (BBB)', module: 'Pre-booking & Sourcing',
    description: 'Projection booking PPJ179 that reserves fabric by colour and size before a confirmed buyer order exists.' },
  { slug: 'adhoc-indent', short: 'BBB Adhoc Indent', step: 8, name: 'BBB Adhoc Indent', module: 'Pre-booking & Sourcing',
    description: 'Manual indent PPM-000735-001 of type Buyer Block Booking: buys the booked fabric before any sales order exists.' },
  { slug: 'rmpo', short: 'RMPO', step: 9, name: 'RMPO – Raw Material Purchase Order', module: 'Pre-booking & Sourcing',
    description: 'Purchase orders 1229 (against the adhoc indent) and 1230 (against the MRP production indent) with value and open qty maths.' },
  { slug: 'grn', short: 'GRN', step: 10, name: 'GRN – Goods Receipt Note', module: 'Pre-booking & Sourcing',
    description: 'Receipt of RMPO 1229 into the cut store: balance, received, rejected, accepted qty and stock keys.' },
  { slug: 'buyer-po', short: 'Buyer PO (OC)', step: 11, name: 'Purchase Order from Buyer (OC)', module: 'Order',
    description: 'Order confirmation GAPS.NEWOC -249 with delivery OC, colour × size quantity breakup and selling value.' },
  { slug: 'mrp', short: 'MRP', step: 12, name: 'MRP – Material Requirement Planning', module: 'Planning',
    description: 'MRP run for the OC: Level 1 garment production demand and Level 2 fabric purchase demand from BOM explosion.' },
  { slug: 'production-indents', short: 'Sales Order Indents', step: 13, name: 'Sales Order Indents (MRP)', module: 'Planning',
    description: 'Indents MRP raises for the sales order: Manufacture Indent (Level 1, garment) and Production Indent (Level 2, fabric) with in-house adjustment from BBB stock.' },
  { slug: 'production-order', short: 'Production Order', step: 14, name: 'Production Order', module: 'Production',
    description: 'Production order PPS12SO/11325 and colour-wise style quantities allocated to the factory production order.' },
  { slug: 'fpo', short: 'FPO & FPPO', step: 15, name: 'FPO & FPPO', module: 'Production',
    description: 'Factory production order PPS12FP0158, fabric requirement, stock material allocation and process orders per colour and size.' },
];

export interface ColorEntry {
  code: string;
  name: string;
  slug: string;
  hex: string;
  card: string;
}

/** Colour Master for colour card Nis_colors. Hex values are display swatches only (not stored in WFX). */
export const COLOR_CARDS = [
  { slug: 'nis-colors', name: 'Nis_colors', description: 'Colour card used by Flannel Shirt Adi (NIS-58) and fabric N-8. Holds 8 colour codes.' },
];

export const COLORS: ColorEntry[] = [
  { code: '372', name: 'BALSAM TREE', slug: 'balsam-tree-372', hex: '#4f6f52', card: 'nis-colors' },
  { code: '3909', name: 'Cosmic sky purple', slug: 'cosmic-sky-purple-3909', hex: '#7b6cc4', card: 'nis-colors' },
  { code: '475', name: 'Happy Pink', slug: 'happy-pink-475', hex: '#e58fb1', card: 'nis-colors' },
  { code: '968', name: 'New Off White', slug: 'new-off-white-968', hex: '#efe9dc', card: 'nis-colors' },
  { code: '762', name: 'Primitive', slug: 'primitive-762', hex: '#9a7b5b', card: 'nis-colors' },
  { code: '291', name: 'True Black', slug: 'true-black-291', hex: '#1f1f1f', card: 'nis-colors' },
  { code: '201', name: 'Light Green', slug: 'light-green-201', hex: '#a8d5a2', card: 'nis-colors' },
  { code: 'TBA', name: 'TBA', slug: 'tba', hex: '#c9c9c9', card: 'nis-colors' },
];

export const SIZES = [
  { code: '34S', name: 'Small S', display: 'Small S (34S)' },
  { code: '38M', name: 'Medium M', display: 'Medium M (38M)' },
  { code: '42L1', name: 'Large L1', display: 'Large L1 (42L1)' },
  { code: '46XL', name: 'Extra Large XL', display: 'Extra Large XL (46XL)' },
  { code: '50XXL', name: 'Double XL XXL', display: 'Double XL XXL (50XXL)' },
  { code: '22/10', name: 'hgdhj', display: 'hgdhj (22/10)' },
  { code: 'TBA', name: 'TBA', display: 'TBA (TBA)' },
];

export interface FlowIndexEntry {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  /** First and last journey step (ids in journey.ts). */
  from: string;
  to: string;
}

/** Ready-made workflows. Any other start/end can be picked on the workflow page. */
export const FLOW_INDEX: FlowIndexEntry[] = [
  { slug: 'block-booking', name: 'Buyer Block Booking', tagline: 'Book fabric early, adjust it to the sales order',
    from: 'bbb-create', to: 'so-updated',
    description: 'Buyer Block Booking with BOM → material requirement → system Adhoc Indent → PO / ASN / GRN → link to sales order → automatic On Order or In-House adjustment.' },
  { slug: 'sales-order', name: 'Sales Order to factory', tagline: 'From buyer order to the factory floor',
    from: 'oc', to: 'fppo',
    description: 'Sales order → MRP → Manufacture and Sales Order Indents → adjustment from booking stock → PO for the gap → Production Order → FPO and process orders.' },
  { slug: 'style-setup', name: 'Style setup', tagline: 'Define the garment once',
    from: 'masters', to: 'approve',
    description: 'Masters, fabric and trim techpacks, apparel techpack, BOM materials, routing operations, material linkage, costing and approval – captured live for Adi TShirt (NIS-59).' },
  { slug: 'end-to-end', name: 'End to end', tagline: 'Every step, masters to process orders',
    from: 'masters', to: 'fppo',
    description: 'The complete Flannel Shirt Adi (NIS-58) journey across style setup, buyer block booking, sales order, adjustment and production.' },
];

export const STATIC_PAGES = [
  { path: '/', title: 'WFX ERP Transaction Knowledge Hub', description: 'Interactive workflows and short, precise theory of WFX ERP transactions, traced on articles Adi TShirt and Flannel Shirt Adi from BOM to factory production order.' },
  { path: '/workflows', title: 'Workflow Builder', description: 'Pick any start and end point in WFX and get the workflow as a blueprint, a live scenario simulator and a step-by-step storyboard.' },
  { path: '/data-model', title: 'WFX Data Model', description: 'The WFX data model as real screens: 17 documents from techpack and BOM to MRP, purchase, GRN and FPO, with their actual rows, how each column is filled and where it flows next.' },
  { path: '/data', title: 'WFX Data Lookup', description: 'Look up the WFX records behind every transaction in simple tables: pick an area and a topic, search the records and see them in plain words.' },
  { path: '/theory', title: 'WFX Theory', description: 'Short, precise explanations of every WFX transaction with key numbers, formulas, fields and cases from the Flannel Shirt Adi (NIS-58) trial.' },
  { path: '/color-cards', title: 'Colour Tracking', description: 'Follow any colour of colour card Nis_colors through booking, purchase, buyer order, MRP and factory production.' },
  { path: '/calculations', title: 'Formula Library', description: 'Every WFX formula from BOM consumption to FPO fabric requirement, with worked examples from Adi TShirt (NIS-59) and Flannel Shirt Adi (NIS-58) and verification status.' },
  { path: '/glossary', title: 'WFX Glossary', description: 'Plain-language definitions of WFX ERP terms such as Cons UOM, CSV, MRP %, in-house adjustment and FPPO.' },
  { path: '/assistant', title: 'WFX Assistant', description: 'One place to ask about WFX: build a workflow from the steps you choose, understand a data model, a formula or a theory page, and open large answers in full view.' },
  { path: '/ask', title: 'Ask the Knowledge Base', description: 'Search WFX transaction knowledge and get the nearest matching definition, calculation or case.' },
];
