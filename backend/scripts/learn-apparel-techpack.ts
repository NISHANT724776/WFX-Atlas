// One-off knowledge entry from the owner's explanation of 2026-11-18 (DOC-0181) and screenshot (DOC-0182): creating an apparel techpack,
// its BOM and its routing. Existing entries get a new version (the old one moves to history as Superseded); new ones are created.
// Everything goes through the normal rule lifecycle (draft → Active) so the change history records who, when and why.
// Run: node --disable-warning=ExperimentalWarning backend/scripts/learn-apparel-techpack.ts
import { indexLibrary } from '../src/index/indexer.ts';
import { getEntry } from '../src/knowledge/repo.ts';
import { makeEntry } from '../src/knowledge/txt.ts';
import type { EntryType } from '../src/knowledge/txt.ts';
import { saveDraft, transition } from '../src/rules/rules.ts';

indexLibrary();
const SRC = "WFX functional owner's explanation in chat on 2026-11-18 (DOC-0181) and the Apparel techpack screen of Adi TShirt (NIS-59) (DOC-0182)";
const WHO = 'owner-explanation', WHY = "Owner's explanation of creating an apparel techpack, BOM and routing (DOC-0181)";
const APPAREL = 'Apparel Style (Techpack) (apparel-style)', BOMM = 'BOM – Materials & Dependency (bom-materials)', ROUT = 'BOM – Routing (bom-routing)', BUYERPO = 'Purchase Order from Buyer (OC) (buyer-po)', MASTERS = 'Masters – Colour, Size, UOM (masters)';
let created = 0, updated = 0;

function save(type: EntryType, id: string, fields: Record<string, string>, order?: string[]) {
  const e = makeEntry(type, id, { ...fields, SOURCE: fields['SOURCE'] ?? SRC, VERSION: '1', STATUS: 'Draft' }, order);
  const r = saveDraft(e, WHO, 'admin', WHY);
  transition(id, r.version, 'Active', WHO, 'admin', WHY);
  created++;
}
/** A new version of an existing entry: its own fields kept, `change` applied, the owner's explanation added to its source. */
function revise(id: string, change: (f: Record<string, string>) => void) {
  const cur = getEntry(id);
  if (!cur) throw new Error(`${id} not found`);
  const f = { ...cur.fields }; change(f);
  f['SOURCE'] = `${cur.fields['SOURCE'] ?? ''}${cur.fields['SOURCE'] ? ' · ' : ''}${SRC}`;
  const e = makeEntry(cur.type as EntryType, id, f, cur.order);
  const r = saveDraft(e, WHO, 'admin', WHY);
  transition(id, r.version, 'Active', WHO, 'admin', WHY);
  updated++;
}
const append = (f: Record<string, string>, key: string, text: string) => { f[key] = `${f[key] ?? ''}${f[key] ? ' ' : ''}${text}`; };
const field = (id: string, name: string, txn: string, group: string, type: string, def: string, extra: Record<string, string> = {}) =>
  save('field', id, { 'FIELD NAME': name, TRANSACTION: txn, 'FIELD GROUP': group, 'FIELD TYPE': type, DEFINITION: def, ...extra });
const term = (id: string, name: string, def: string, txn: string, extra: Record<string, string> = {}) => save('term', id, { TERM: name, DEFINITION: def, TRANSACTION: txn, MODULE: 'Style & BOM', ...extra });
const rule = (id: string, name: string, txn: string, category: string, purpose: string, logic: string, extra: Record<string, string> = {}) =>
  save('rule', id, { 'RULE NAME': name, MODULE: 'Style & BOM', TRANSACTION: txn, 'RULE CATEGORY': category, 'BUSINESS PURPOSE': purpose, 'FORMULA / LOGIC': logic, ...extra });

// ── existing entries: new versions ────────────────────────────────────────────────────────────────────────────
revise('RULE-SO-PRICE-PER', (f) => {
  append(f, 'FORMULA / LOGIC', 'What each type does to the delivery-level grid of the Sales Order / Purchase Order from Buyer: Article – the grid is formed article-wise. Color – the grid is formed colour-wise; upcharges and discounts are handled vertically. Size – the same as Color, but upcharges, discounts and fields are handled horizontally. Color/Size – the grid works like Article, but colour-wise.');
  f['OPEN QUESTION'] = `${f['OPEN QUESTION'] ? `${f['OPEN QUESTION']} ` : ''}The owner described Color/Size as "grid works same as article, but it is colour wise". How the sizes are laid out in that grid is not stated; confirm.`;
});
revise('FLD-APPAREL-STYLE-PRICE-PER', (f) => append(f, 'DEFINITION', 'One of four: Article, Color, Size or Color/Size (RULE-SO-PRICE-PER). It decides how the delivery-level grid of the Sales Order / Purchase Order from Buyer is formed and where upcharges and discounts are handled.'));
revise('FLD-APPAREL-STYLE-ARTICLE-CODE', (f) => append(f, 'DEFINITION', 'Generated automatically by the system through System Coding (the code and the name can each be automatic or manual: RULE-SETUP-ARTICLE-CODE-MODES). Read-only on the screen (visual observation: greyed). Adi TShirt (NIS-59): NIS-59.'));
revise('FLD-APPAREL-STYLE-ARTICLE-NAME', (f) => append(f, 'DEFINITION', 'Typed manually in this set-up (RULE-SETUP-ARTICLE-CODE-MODES allows automatic or manual). Adi TShirt (NIS-59): "Adi TShirt".'));
revise('FLD-APPAREL-STYLE-BUYER-BUYER-DEPARTMENT', (f) => append(f, 'DEFINITION', 'The buyer is selected first; the Buyer Department list then shows only the departments of that buyer and the user picks one (RULE-APPAREL-BUYER-DEPARTMENT-FILTER). Division fills in by itself from the buyer (RULE-APPAREL-BUYER-DIVISION-AUTO).'));

// ── new fields of the techpack ────────────────────────────────────────────────────────────────────────────────
field('FLD-APPAREL-STYLE-MATERIAL-TYPE', 'Material Type', APPAREL, 'Detail', 'Selected from a list', 'The material type created for the category (here Apparel), chosen from the dropdown at the top of the techpack. The information shown below it on the screen depends on it (RULE-APPAREL-MATERIAL-TYPE-DRIVES-FIELDS).', { 'SCREEN OBSERVATION': 'Visual observation, not confirmed behaviour: the dropdown showed "Knitted_FAB_N" on the Adi TShirt (NIS-59) screen.' });
field('FLD-APPAREL-STYLE-DIVISION', 'Division', APPAREL, 'Detail', 'Filled by the system', 'Filled in automatically when the buyer is selected (RULE-APPAREL-BUYER-DIVISION-AUTO); it is not chosen separately.', { 'SCREEN OBSERVATION': 'Visual observation: "Gurgaon-24175COM-ADI" was shown for buyer GAP Kids.' });
field('FLD-APPAREL-STYLE-PRODUCT-GROUP', 'Product Group', APPAREL, 'Detail', 'Selected from a list', 'The product group of the style, selected by the user after the buyer details. It is paired with the Sub-Category.', { 'SCREEN OBSERVATION': 'Visual observation: "KNITTED!" was shown on the Adi TShirt (NIS-59) screen.' });
field('FLD-APPAREL-STYLE-SUB-CATEGORY', 'Sub-Category', APPAREL, 'Detail', 'Selected from a list', 'The sub-category of the style, selected by the user together with the Product Group.', { 'SCREEN OBSERVATION': 'Visual observation: "Knitted_FAB_N" was shown, with a red mark that suggests it is mandatory (not confirmed).' });
field('FLD-APPAREL-STYLE-SIZE-RANGE', 'Size/Width Range', APPAREL, 'Detail', 'Selected from the master', 'The size range for the style, selected from the size ranges made in the masters (as the colour card is selected from the colour cards made in the masters).', { 'SCREEN OBSERVATION': 'Visual observation: "ERPSIZE" was shown on the screen.' });
field('FLD-BOM-ROUTING-INPUT-ITEM', 'Input item', ROUT, 'Processes', 'Entered by the user', 'The item that goes into a process (for example fabric into cutting). Defined for each process of the routing.');
field('FLD-BOM-ROUTING-OUTPUT-ITEM', 'Output item', ROUT, 'Processes', 'Entered by the user', 'The item that comes out of a process (for example the cut parts from cutting). Defined for each process of the routing.');

// ── new terms ─────────────────────────────────────────────────────────────────────────────────────────────────
term('TERM-MATERIAL-TYPE-TECHPACK', 'Material Type (techpack)', 'A classification created in setup for a category of articles (here Apparel). It is chosen first on the techpack from a dropdown, and the information shown below it depends on it. It is also one section of the article code (TERM-CODE-SECTION-MATERIAL-TYPE).', APPAREL);
term('TERM-PRICE-PER-ARTICLE', 'Price Per – Article', 'Price Per set to Article: the Sales Order / Purchase Order from Buyer forms its delivery-level grid article-wise.', APPAREL);
term('TERM-PRICE-PER-COLOR', 'Price Per – Color', 'Price Per set to Color: the delivery-level grid of the Sales Order / Purchase Order from Buyer is formed colour-wise, and upcharges and discounts are handled vertically.', APPAREL);
term('TERM-PRICE-PER-SIZE', 'Price Per – Size', 'Price Per set to Size: like Color, but upcharges, discounts and fields are handled horizontally.', APPAREL);
term('TERM-PRICE-PER-COLOR-SIZE', 'Price Per – Color/Size', 'Price Per set to Color/Size: the delivery-level grid works like Article, but colour-wise.', APPAREL, { 'OPEN QUESTION': 'The layout of sizes in this grid is not stated by the owner; confirm.' });
term('TERM-COST-SHEET-TEMPLATE', 'Cost sheet template', 'A template in which the cost categories (fabric, trims, yarn, miscellaneous and so on) are defined. The sections of a BOM are derived from it (RULE-BOM-SECTIONS-FROM-COST-SHEET-TEMPLATE). The master cost sheet of a BOM is nominated by RULE-SETUP-BOM-MASTER-COST.', BOMM, { 'OPEN QUESTION': 'The screen or menu where cost sheet templates are defined was not stated.' });
term('TERM-ROUTING-PROCESS', 'Process (routing)', 'A step of production defined in the BOM routing, for example cutting, stitching, sewing or packing. Each process has an input item, an output item, an After Process that sets the order, and a Process Rate. Each routing process later becomes an FPPO (CASE-BOM-ROUTING-1).', ROUT);

// ── new rules ─────────────────────────────────────────────────────────────────────────────────────────────────
rule('RULE-APPAREL-MATERIAL-TYPE-DRIVES-FIELDS', 'Material Type decides the techpack information', APPAREL, 'Business Rule', 'The techpack of an apparel article starts from its material type.', 'The user selects the Material Type (created for the Apparel category) from the dropdown of the techpack; the information that appears below it depends on that choice.', { 'OPEN QUESTION': 'Which fields appear or change for each material type was not described; only that the information below depends on it.', 'SCREEN / LOCATION': 'Techpack header' });
rule('RULE-APPAREL-BUYER-DEPARTMENT-FILTER', 'Buyer Department is filtered by the buyer', APPAREL, 'Business Rule', 'A department is only chosen from the departments of the buyer.', 'The user selects the Buyer first. The Buyer Department list is then filtered to the departments of that buyer, and the user selects one of them.', { 'SCREEN / LOCATION': 'Techpack header', 'INPUT FIELDS': 'Buyer\nBuyer Department', OUTPUT: 'Buyer Department' });
rule('RULE-APPAREL-BUYER-DIVISION-AUTO', 'Division is filled from the buyer', APPAREL, 'Business Rule', 'Division is never typed or chosen separately on the techpack.', 'When the Buyer is selected the system fills in the Division by itself.', { 'SCREEN / LOCATION': 'Techpack header', 'INPUT FIELDS': 'Buyer', OUTPUT: 'Division' });
rule('RULE-BOM-SECTIONS-FROM-COST-SHEET-TEMPLATE', 'BOM sections come from the cost sheet template', BOMM, 'Business Rule', 'The BOM is organised in the sections of the cost sheet template.', 'The sections of a BOM are derived from the cost sheet template. In the template the categories are defined, such as fabric, trims, yarn and miscellaneous. For each material line the Purchase UOM and the Cons UOM are defined; the colours and sizes that are needed are added and mapped according to the dependency selected.', { 'RELATED RULES': 'RULE-SETUP-BOM-MASTER-COST, RULE-SETUP-UOM-PURCHASE', 'SCREEN / LOCATION': 'BOM' });
rule('RULE-BOM-ROUTING-PROCESS-SETUP', 'Routing: how a process is defined', ROUT, 'Business Rule', 'The routing lists the processes that produce the garment, in order and costed.', 'On the Routing page of the BOM the user defines the processes that produce the apparel (for example cutting, stitching, sewing, packing). For each process the user defines the input item and the output item, the After Process (the process that comes before it: the process with none is the first), and a Process Rate.', { 'RELATED RULES': 'CALC-ROUTING-AFTER-VALID, CALC-ROUTING-PROCESS-RATE', 'SCREEN / LOCATION': 'BOM › Routing', 'OPEN QUESTION': 'The owner listed both "stitching" and "sewing". The Adi TShirt (NIS-59) routing shows VCutting, Sewing and VPacking; confirm whether stitching and sewing are the same process.' });
rule('RULE-BOM-ROUTING-NORMAL-MATERIAL-FLOW', 'Routing: a normal material flow', ROUT, 'Business Rule', 'The routing maps raw materials to the processes that use them.', 'In a normal flow: the fabric goes through cutting; then the fabric, thread and the other items go to sewing; and the final garment with the polybag goes to packing. The owner gave this as the example that runs a normal flow without hindrance.', { 'RELATED RULES': 'CALC-ROUTING-LINKAGE', 'SCREEN / LOCATION': 'BOM › Routing (material linkage)', 'EXAMPLE': 'Cutting: fabric · Sewing: fabric, thread, other items · Packing: final garment with polybag.' });

// ── dependencies ──────────────────────────────────────────────────────────────────────────────────────────────
save('dependency', 'DEP-APPAREL-STYLE-BUYER-PO-PRICE-PER', { RELATIONSHIP: `${APPAREL.replace(/ \(apparel-style\)$/, '')} → ${BUYERPO.replace(/ \(buyer-po\)$/, '')}`, 'FROM TRANSACTION': APPAREL, 'TO TRANSACTION': BUYERPO, DESCRIPTION: 'Price Per of the techpack (Article, Color, Size or Color/Size) decides how the delivery-level grid of the Sales Order / Purchase Order from Buyer is formed.', BASIS: "Owner's explanation (DOC-0181); see also RULE-SO-PRICE-PER" });
save('dependency', 'DEP-MASTERS-APPAREL-STYLE-SIZE-RANGE', { RELATIONSHIP: `${MASTERS.replace(/ \(masters\)$/, '')} → ${APPAREL.replace(/ \(apparel-style\)$/, '')}`, 'FROM TRANSACTION': MASTERS, 'TO TRANSACTION': APPAREL, DESCRIPTION: 'The size range and the colour card of a techpack are selected from those made in the masters.', BASIS: "Owner's explanation (DOC-0181)" });

// ── the procedure ─────────────────────────────────────────────────────────────────────────────────────────────
save('procedure', 'PROC-STYLE-BOM-CREATE-APPAREL-TECHPACK-BOM-ROUTING', {
  TITLE: 'How do I create an apparel techpack with its BOM and routing?',
  TOPIC: 'Apparel techpack, BOM and routing',
  MODULE: 'Style & BOM',
  'SOURCE DOCUMENT': "Owner's explanation (DOC-0181) and the Apparel techpack screen of Adi TShirt (NIS-59) (DOC-0182)",
  CONTENT: 'The owner creates an apparel techpack, then its BOM, then its routing. This is the normal flow, to run without hindrance.',
  STEPS: [
    '1. Create the Material Type for the Apparel category in setup (done once), then select it from the dropdown of the techpack: the information below it depends on it.',
    '2. The Article Code is generated automatically by the system through System Coding. Type the Article Name (manual in this set-up).',
    '3. Select the Buyer. The Buyer Department list is filtered to that buyer: select the department. The Division fills in by itself.',
    '4. Select the Product Group and the Sub-Category.',
    '5. The Purchase UOM is PCS.',
    '6. Select the Colour Card and the Size Range that were made in the masters.',
    '7. Choose Price Per: Article, Color, Size or Color/Size. It decides how the delivery-level grid of the Sales Order / Purchase Order from Buyer is formed.',
    '8. In the BOM the sections come from the cost sheet template (categories such as fabric, trims, yarn, miscellaneous). Define the Purchase UOM and the Cons UOM of each material, add the colours and sizes needed and map them according to the dependency selected.',
    '9. On the Routing page of the BOM define the processes (for example cutting, stitching, sewing, packing). For each process define the input item and the output item, the After Process (the first process has none) and the Process Rate.',
    '10. Map the raw materials to the processes: the fabric goes through cutting, then the fabric, thread and other items go to sewing, and the final garment with the polybag goes to packing.',
  ].join('\n'),
  'WHERE IN WFX': 'Product Development › Apparel Techpack, then BOM › Materials and BOM › Routing',
  NOTES: 'Open points: which fields change with each Material Type; where cost sheet templates are defined; whether "stitching" and "sewing" are one process; the size layout of the Color/Size grid. The Process Rate formula is still under review (CALC-ROUTING-PROCESS-RATE). The screen also shows (visual observation, not confirmed behaviour): tabs Techpack, Approvals, Variant, Log, History, BOM, Operation Bulletin and Supplier Costing; buttons Supplier Material Reference, Movement UOM, Buyer Sample Approval, Import BOM, Print QR Code, Save, More and Inventory Setup; and the fields Theme, Fabric/Material, Our Contact, Bypass Material Check On Production GRN, Fabric Article, Minimum and Maximum Qty, Minimum Order Quantity, Buying Price, Season, Buyer Style Ref., Supplier and Supplier Ref., whose behaviour was not described.',
});

console.log(`done: ${created} entries created, ${updated} new versions of existing entries`);
