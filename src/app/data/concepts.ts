// Setup concepts explained by the WFX functional owner (article coding, dependency types, UOM types, BOM types).
// No imports: also bundled by scripts/export-data.ts into the CSV files.

export interface Concept { id: string; group: string; name: string; options?: string; definition: string; where: string; example?: string; }

export const DEPENDENCY_TYPES: Concept[] = [
  { id: 'colour-base', group: 'Colour dependency', name: 'Base Colour', options: 'Base Colour',
    definition: 'The colours of the apparel are used directly for the material: the material is needed in the same colours as the garment.',
    where: 'BOM Materials › Dependency › Colour', example: 'Garment in 372, 3909 and 475 → the material is also used in 372, 3909 and 475.' },
  { id: 'colour-table', group: 'Colour dependency', name: 'Table', options: 'Table',
    definition: 'The user maps each apparel colour to a material colour. It tells the system "buy the fabric in this colour to achieve the apparel in that colour". The apparel colour master and the fabric (or any raw material) colour master can differ, so this map bridges them.',
    where: 'BOM Materials › Dependency › Colour (popup)', example: 'Fabric N-8: apparel colour 372 → fabric colour 372, 3909 → 3909, 475 → 475.' },
  { id: 'colour-none', group: 'Colour dependency', name: 'None', options: 'None',
    definition: 'The material has no colour. It is the same for every apparel colour (for example a polybag).', where: 'BOM Materials › Dependency › Colour' },
  { id: 'size-base', group: 'Size dependency', name: 'Base Size', options: 'Base Size',
    definition: 'The apparel sizes are used directly for the material: the material comes in the same sizes as the garment.', where: 'BOM Materials › Dependency › Size' },
  { id: 'size-table', group: 'Size dependency', name: 'Table', options: 'Table',
    definition: 'The user maps each apparel size to a material size (or leaves it unused), when the material is not sized like the garment.',
    where: 'BOM Materials › Dependency › Size (popup)', example: 'Fabric N-8: 34S → 34S, 38M → 38M, 42L1 → 42L1; the larger sizes are not mapped.' },
  { id: 'size-none', group: 'Size dependency', name: 'None', options: 'None',
    definition: 'The material has no size. It is the same for every apparel size.', where: 'BOM Materials › Dependency › Size' },
];

export const UOM_TYPES: Concept[] = [
  { id: 'uom-storage', group: 'UOM', name: 'Storage UOM', definition: 'The unit in which the material is kept and counted in stock (warehouse, GRN, issue). Stock balances are held in this unit.', where: 'Raw material techpack', example: 'Fabric stored in KG_Nis.' },
  { id: 'uom-consumption', group: 'UOM', name: 'Consumption UOM', definition: 'The unit in which the BOM states how much of the material one garment uses (Cons Qty, Final Consumption).', where: 'BOM Materials', example: 'Fabric consumed in meter per garment.' },
  { id: 'uom-purchase', group: 'UOM', name: 'Purchase UOM', definition: 'The unit in which the material is bought from the supplier (RMPO, price). When it differs from the Consumption UOM a conversion factor turns the purchase price into the Cons UOM Price.', where: 'Raw material techpack, RMPO', example: 'Fabric bought in KG_Nis, consumed in meter: Cons UOM Price = Purchase Price × Conversion Factor.' },
];

export const BOM_CONCEPTS: Concept[] = [
  { id: 'bom-section', group: 'BOM', name: 'BOM · Materials section', definition: 'Captures the raw materials needed to make one apparel, how much of each (consumption), at what cost, and the price at which the apparel is to be sold.', where: 'BOM › Materials' },
  { id: 'bom-version', group: 'BOM', name: 'BOM version', definition: 'A BOM is maintained version-wise. Each version carries its own cost sheet with a currency and a date and time, so older versions and their costs stay available.', where: 'BOM header' },
  { id: 'bom-standard', group: 'BOM type', name: 'Standard BOM', definition: 'The BOM marked as standard, either by selecting the star or by choosing the Standard BOM option while creating it. It is treated as the master BOM and creates the Budget: every other BOM of the apparel is compared against it as the budget.', where: 'BOM header' },
  { id: 'bom-production', group: 'BOM type', name: 'Production BOM', definition: 'The BOM used to produce an order. Its costs are compared with the Standard BOM, which acts as its budget.', where: 'BOM header' },
  { id: 'bom-create', group: 'BOM', name: 'Creating a BOM', definition: 'A BOM can be made by copying from a template or by copying from an item (an existing BOM).', where: 'BOM header' },
  { id: 'bom-master-cost', group: 'BOM', name: 'Master cost sheet', definition: 'A setting that nominates the master cost sheet of the BOM.', where: 'BOM › Costing' },
  { id: 'bom-indent-owner', group: 'BOM', name: 'User Group and Purchase Officer', definition: 'The BOM carries a User Group and a Purchase Officer. If they are not filled, the indent generated after MRP comes in Inactive status. It must be activated from the User Indent list or the Indent list before MRP and the other adjustments can be done on it.', where: 'BOM Materials' },
];

export const ARTICLE_CODE_SECTIONS: { name: string; meaning: string }[] = [
  { name: 'Sample Ref.', meaning: 'Reference of the sample the article is created from' },
  { name: 'Buyer', meaning: 'Buyer of the article' },
  { name: 'Company Name', meaning: 'Name of the company' },
  { name: 'Supplier ID', meaning: 'Identifier of the supplier' },
  { name: 'Supplier', meaning: 'Supplier name' },
  { name: 'Year of Creation', meaning: 'Calendar year in which the article is created' },
  { name: 'Text', meaning: 'Fixed text typed in the Value column' },
  { name: 'Separator', meaning: 'A separator character (for example / or -) typed in the Value column' },
  { name: 'Spacor', meaning: 'Spacer between parts of the code' },
  { name: 'Counter', meaning: 'Running number; Counter Length sets leading zeros and Group Counter restarts it per group' },
  { name: 'Construction', meaning: 'Fabric construction' },
  { name: 'Fabric Content', meaning: 'Fibre content of the fabric' },
  { name: 'Count', meaning: 'Yarn count' },
  { name: 'Material Type', meaning: 'Material type of the article' },
  { name: 'RM text', meaning: 'Raw material text' },
  { name: 'Product Group', meaning: 'Product group of the article' },
  { name: 'Sub-Category', meaning: 'Sub-category of the article' },
  { name: 'Division Prefix', meaning: 'Prefix of the division' },
  { name: 'Financial Year', meaning: 'Financial year in which the article is created' },
];

/** Example rules from the Article Code Definition screen (category Textiles/Fabric, logic Automatic). */
export const ARTICLE_CODE_RULES: { rule: string; materialType: string; productGroup: string; subCategory: string; parts: { section: string; value: string; sort: number }[] }[] = [
  { rule: '1', materialType: 'FABRIC,NIKITAMATERIALTYPE', productGroup: 'ALL Other', subCategory: 'ALL Other', parts: [{ section: 'Company Name', value: '', sort: 10 }, { section: 'Separator', value: '/', sort: 20 }, { section: 'Counter', value: '01', sort: 30 }] },
  { rule: '2', materialType: 'cottonlinen', productGroup: 'leninfab', subCategory: 'linefabric', parts: [{ section: 'Text', value: 'sys', sort: 10 }, { section: 'Separator', value: '-', sort: 20 }, { section: 'Counter', value: '01', sort: 30 }] },
  { rule: '3', materialType: 'Woven,NIKITA_FABRIC', productGroup: 'ALL Other', subCategory: 'ALL Other', parts: [{ section: 'Text', value: 'Code', sort: 10 }, { section: 'Separator', value: '/', sort: 20 }, { section: 'Counter', value: '01', sort: 30 }] },
  { rule: '4', materialType: 'cottonfabricpremsir', productGroup: 'cottonfabrickk', subCategory: 'organiccotton', parts: [{ section: 'Text', value: 'asda', sort: 10 }, { section: 'Separator', value: '-', sort: 20 }, { section: 'Counter', value: '01', sort: 30 }] },
  { rule: '5', materialType: 'VCotton', productGroup: 'VFabric', subCategory: 'V Woven Fabric, V Knitted Fabric', parts: [{ section: 'Material Type', value: '', sort: 10 }, { section: 'Separator', value: '/', sort: 20 }, { section: 'Product Group', value: '', sort: 30 }, { section: 'Separator', value: '/', sort: 40 }, { section: 'Sub-Category', value: '', sort: 50 }, { section: 'Separator', value: '/', sort: 60 }, { section: 'Counter', value: '100', sort: 70 }] },
];

export const ARTICLE_CODING: Concept[] = [
  { id: 'article-code-modes', group: 'Article coding', name: 'Article Code and Article Name generation', definition: 'The article code and article name of a techpack are generated in one of two ways: Automatically or Manually. Manually, the user types the code or name. Automatically, the system builds it from the rules set up in Admin › System Coding.', where: 'Techpack header' },
  { id: 'article-code-setup', group: 'Article coding', name: 'System Coding setup', definition: 'Go to Admin › System Coding and search for Article Code or Article Name. Each has its own definition and both vary by category (for example Textiles/Fabric).', where: 'Admin › System Coding' },
  { id: 'article-code-rule', group: 'Article coding', name: 'Article Code Definition', definition: 'A definition has a Category and a Logic (Manual or Automatic). For automatic logic each rule picks a Material Type, Product Group and Sub Category (or "ALL Other"), then lists code sections in Sort order (10, 20, 30…). The code is the sections joined in that order.', where: 'Admin › System Coding › Article Code', example: 'Rule 5: Material Type / Product Group / Sub-Category / Counter, for example VCotton/VFabric/V Woven Fabric/100.' },
];

export const MRP_CONCEPTS: Concept[] = [
  { id: 'mrp-explosion', group: 'MRP', name: 'MRP explosion', definition: 'Running MRP for Level 1 (the garment) for the full quantity also generates the indents for the child level (the raw materials of the BOM) in the same run: child quantity = Level 1 quantity × BOM Final Consumption. If the parent changes later, re-running MRP carries the change into the child indent.', where: 'Planning › MRP', example: 'Level 1 of 500 garments, full quantity: the fabric indent is generated as 500 × Final Consumption.' },
  { id: 'mrp-adjustment', group: 'MRP', name: 'MRP adjustment', definition: 'Every MRP level (parent and child) can take a negative quantity (for example -500). The level where you enter it is the level that changes. To reduce or cancel a child indent, the negative has to be entered at its parent level: that lowers the parent quantity MRP acts on, so once MRP is re-run the child indent is reduced by the same share (any change in the parent followed by a re-run of MRP impacts the child indent), and taking off the whole parent quantity (-500 of 500) cancels it.', where: 'Planning › MRP', example: 'Level 1 = 500. Negative -200 at Level 1: net 300, child = 300 × Final Consumption. Negative -500 at Level 1: net 0, child indent cancelled.' },
  { id: 'mrp-adjustment-child', group: 'MRP', name: 'Negative at the child level', definition: 'A negative quantity entered at a child level changes only that child level. It does not reach the parent and does not cancel the child indent by itself: cancelling a child indent needs the negative at the parent level.', where: 'Planning › MRP', example: 'Fabric (Level 2) 750 with -200 entered at Level 2: fabric 550, garment Level 1 stays 500.' },
];

/** MRP adjustment scenarios, computed from the rule above (Level 1 = 500, Final Consumption 1.5 as on Flannel Shirt Adi (NIS-58)). */
export const MRP_ADJUST_SCENARIOS = [
  { enteredAt: 'No adjustment', adj: 0 },
  { enteredAt: 'Level 1 (parent)', adj: -200 },
  { enteredAt: 'Level 1 (parent)', adj: -500 },
  { enteredAt: 'Level 2 (child)', adj: -200 },
].map(({ enteredAt, adj }) => {
  const level1 = 500, finalCons = 1.5, parentLevel = enteredAt !== 'Level 2 (child)';
  const net = parentLevel ? level1 + adj : level1;
  const child = net * finalCons + (parentLevel ? 0 : adj);
  const result = adj === 0 ? 'Child indent generated in full'
    : !parentLevel ? 'Only the child quantity changes; parent unchanged'
    : net === 0 ? 'Child indent cancelled' : 'Child indent reduced';
  return { enteredAt, adjustment: adj, level1, net, finalCons, child, result };
});
