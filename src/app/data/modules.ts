// The six areas of WFX the hub is organised by. Pages show one module at a time, picked from an icon.
// No imports: plain data, safe to use from any page.

export interface AppModule {
  id: string;
  name: string;
  icon: string;
  blurb: string;
  /** Data-model document ids, in the order data flows through them. */
  docs: string[];
  /** Theory / formula transaction slugs. */
  txns: string[];
  /** Workflow step ids that make up this module's own workflow (empty = none). */
  steps: string[];
  /** Area of the Data page that holds this module's records and guides. */
  dataArea: string;
}

export const MODULES: AppModule[] = [
  { id: 'rules', name: 'Setup rules', icon: 'cog', blurb: 'Article coding, UOM, dependency types, BOM types',
    docs: ['article-coding', 'uom-types', 'dependency-types', 'bom-types'], txns: [], steps: [], dataArea: 'masters' },
  { id: 'style', name: 'Style & BOM', icon: 'shirt', blurb: 'Techpacks, BOM, routing and cost',
    docs: ['rm-techpack', 'apparel', 'bom-materials', 'routing-processes', 'routing-operations', 'material-linkage', 'bom-cost', 'bom-58'],
    txns: ['masters', 'rm-techpack', 'apparel-style', 'bom-materials', 'bom-routing', 'bom-costing'],
    steps: ['masters', 'rm', 'style', 'bom', 'routing', 'operations', 'linkage', 'costing', 'approve'], dataArea: 'product-development' },
  { id: 'booking', name: 'Booking & sourcing', icon: 'cart', blurb: 'Block booking, indents, purchase, receipt',
    docs: ['bbb', 'adhoc-indent', 'rmpo-1229', 'grn', 'rmpo-1230'], txns: ['buyer-block-booking', 'adhoc-indent', 'rmpo', 'grn'],
    steps: ['bbb-create', 'bbb-details', 'bbb-article', 'bbb-bom', 'bbb-populate', 'bbb-materials', 'bbb-save', 'gen-indent', 'adhoc', 'po', 'asn', 'grn'], dataArea: 'sourcing' },
  { id: 'sales', name: 'Sales Order', icon: 'order', blurb: 'Orders, deliveries, approval, price, packing',
    docs: ['oc', 'so-structure', 'so-actions', 'so-approval', 'so-pricing', 'so-types', 'so-packing', 'so-other'], txns: ['buyer-po'], steps: ['style', 'oc', 'link', 'mrp'], dataArea: 'order' },
  { id: 'planning', name: 'Planning', icon: 'gear', blurb: 'MRP and sales order indents',
    docs: ['mrp', 'so-indent'], txns: ['mrp', 'production-indents'], steps: ['mrp', 'mfg-indent', 'so-indent', 'adjust', 'so-updated'], dataArea: 'planning' },
  { id: 'production', name: 'Production', icon: 'factory', blurb: 'Production order, FPO and process orders',
    docs: ['fpo'], txns: ['production-order', 'fpo'], steps: ['rmpo-gap', 'prod-order', 'fpo', 'fppo'], dataArea: 'production' },
  { id: 'inventory', name: 'Inventory, QC & WMS', icon: 'box', blurb: 'GRN, quality check, GDI and GDN, WMS mobile app',
    docs: [], txns: [], steps: [], dataArea: 'inventory' },
  { id: 'tna', name: 'TNA', icon: 'check', blurb: 'Time and Action calendar: roles, tasks, templates',
    docs: [], txns: [], steps: [], dataArea: 'tna' },
];

export const moduleById = (id: string | undefined) => MODULES.find((m) => m.id === id);
export const moduleOfDoc = (docId: string) => MODULES.find((m) => m.docs.includes(docId));
export const moduleOfTxn = (slug: string) => MODULES.find((m) => m.txns.includes(slug));

/** Icon of each data-model document (names from the shared Icon component). */
export const DOC_ICON: Record<string, string> = {
  'rm-techpack': 'roll', apparel: 'shirt', 'bom-materials': 'bom', 'routing-processes': 'route', 'routing-operations': 'cog', 'material-linkage': 'link',
  'bom-cost': 'calc', 'bom-58': 'bom', bbb: 'clipboard', 'adhoc-indent': 'doc', 'rmpo-1229': 'cart', grn: 'box', 'rmpo-1230': 'cart',
  oc: 'order', 'so-structure': 'list', 'so-actions': 'play', 'so-approval': 'check', 'so-pricing': 'calc', 'so-types': 'route', 'so-packing': 'cube', 'so-other': 'table',
  mrp: 'gear', 'so-indent': 'doc', fpo: 'factory',
  'article-coding': 'list', 'uom-types': 'scale', 'dependency-types': 'swatch', 'bom-types': 'bom',
};
