// Words, synonyms and question understanding shared by indexing and search. Synonyms here are language only
// (how people phrase things); WFX abbreviations are learned from the knowledge itself, never hard-coded meanings.

export const STOP = new Set(('a an and are as at be by for from how i in is it of on or the to what when where which who whom why with does do did ' +
  'this that these those its into can could should would will shall my me we you your our us please tell about explain define meaning ' +
  'there their them they he she his her him was were been being has have had am not no yes if then than so such any some each every ' +
  'also just only very really much many more most other another same own both all dont didnt doesnt go goes going gone went come comes coming came get gets getting got').split(' '));

/** Chatty filler that says nothing about the topic. */
export const FILLER = new Set(('percentage percent pct hi hello hey dear sir madam kindly pls thanks thank thankyou want wanted wants need needs needed trying tried help ' +
  'actually basically currently suppose someone anyone new wfx system erp module screen page option options way know understand ' +
  'work works working worked use used uses using get gets got getting give show shows showing see look tell say says said ' +
  'happen happens happened doing done thing things something stuff detail details info information question regarding related ' +
  'functionality feature features exactly properly correct correctly right okay ok please').split(' '));

/** Words that say what KIND of answer is wanted, not what it is about (the question type is detected separately). */
export const INTENT_WORDS = new Set(('calculated calculate calculation calculations calculating formula formulas computed compute derive derived ' +
  'difference differences different differ between compare compared comparison versus vs explain explained define definition meaning means mean ' +
  'step steps procedure why happen happens happening works working work purpose reason describe description example examples list ' +
  'affect affects affected effect effects impact impacts complete entire whole full use uses').split(' '));

/** Phrases written in several ways → one spelling. */
export function normalize(s: string): string {
  return s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/(\d)\s*(?:meters?|metres?|mtrs?|kgs?|grams?|gms?|pcs|pieces?|yards?|yds?|units?|nos)\b/gi, '$1').replace(/(\d)\s*%/g, '$1 pct ').replace(/%/g, ' percentage ').replace(/[’']/g, '').replace(/[^a-z0-9\-/ ]+/g, ' ').replace(/[/]/g, ' ')
    .replace(/\bwrite[ -]?offs?\b/g, 'writeoff').replace(/\bin[ -]?house\b/g, 'inhouse').replace(/\bpick[ -]?lists?\b/g, 'picklist')
    .replace(/\btech[ -]?packs?\b/g, 'techpack').replace(/\bbill of materials?\b/g, 'bom').replace(/\bpick[ -]?ups?\b/g, 'pickup')
    .replace(/\bkit[ -]?packs?\b/g, 'kitpack').replace(/\bre[ -]?order\b/g, 'reorder').replace(/\bset[ -]?up\b/g, 'setup')
    .replace(/\be[ -]?mail\b/g, 'email').replace(/\b(un|non)-(?=[a-z])/g, '$1').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Light suffix stripping so "received / receive", "rejection / rejected" meet. Same function for text and questions. */
const SUFFIXES = ['ations', 'ation', 'itions', 'ition', 'ions', 'ion', 'ments', 'ment', 'ings', 'ing', 'ies', 'ied', 'ed', 'es', 'al', 's', 'e'];
export function stem(w: string): string {
  if (w.length <= 3 || /\d/.test(w)) return w;
  for (const s of SUFFIXES) {
    if (w.endsWith(s) && w.length - s.length >= 3) return s === 'ies' || s === 'ied' ? `${w.slice(0, -s.length)}y` : w.slice(0, -s.length);
  }
  return w;
}

export const words = (s: string) => normalize(s).split(' ').filter(Boolean);

/** Language synonyms: any word of a group matches the others. Deliberately small: words that are different fields in WFX
 *  (balance vs open qty, price vs rate vs cost, style vs article) are NOT grouped. */
export const GROUPS: string[][] = [
  ['qty', 'quantity', 'quantities', 'qnty'],
  ['cons', 'consumption'],
  ['set', 'filled', 'fill', 'entered', 'given', 'provided', 'assigned', 'specified', 'put', 'mapped', 'select', 'selected', 'choose', 'chosen', 'blank', 'empty'],
  ['colour', 'color', 'colours', 'colors'],
  ['multiple', 'several', 'many', 'together', 'combine', 'combined', 'consolidate', 'merge', 'bulk', 'batch'],
  ['create', 'make', 'generate', 'raise', 'prepare', 'build', 'add'],
  ['change', 'edit', 'update', 'modify', 'revise', 'amend'],
  ['setup', 'configure', 'configuration', 'config', 'enable', 'activate', 'settings', 'setting'],
  ['remove', 'delete', 'discard'],
  ['attach', 'attached', 'attachment', 'attaching'],
  ['auto', 'automatic', 'automatically', 'automated'],
  ['cancel', 'cancellation', 'cancelled', 'canceled', 'void'],
  ['dispatch', 'ship', 'shipping', 'shipped', 'shipment'],
  ['receive', 'received', 'receipt', 'receiving'],
  ['reject', 'rejected', 'rejection', 'damaged', 'defective', 'faulty'],
  ['approve', 'approval', 'approved', 'approver', 'authorise', 'authorize'],
  ['supplier', 'vendor'],
  ['buyer', 'customer', 'client'],
  ['mobile', 'app', 'application', 'phone', 'android', 'quickdocs'],
  ['qc', 'quality', 'inspection'],
  ['pct', 'percent', 'percentage'],
  ['close', 'closed', 'closing', 'closure'],
  ['error', 'problem', 'fail', 'failed', 'wrong', 'stuck'],
  ['outstanding', 'pending', 'open', 'remaining'],
  ['stock', 'inventory'],
  ['purchase', 'procure', 'procurement', 'buy', 'buying'],
  ['po', 'rmpo'],
  ['oc', 'sales order', 'order confirmation'],
];
const GROUP_OF = new Map<string, number>();
GROUPS.forEach((g, i) => g.forEach((w) => GROUP_OF.set(w, i)));
export function synonyms(word: string): string[] {
  const i = GROUP_OF.get(word);
  return i === undefined ? [] : GROUPS[i].filter((w) => w !== word);
}

export type Intent = 'compare' | 'calculation' | 'workflow' | 'validation' | 'dependency' | 'why' | 'whatif' | 'howto' | 'definition' | 'data' | 'general';

export function detectIntent(q: string): Intent {
  const n = ` ${normalize(q)} `;
  if (/ (difference|differences|differ|different|vs|versus|compare|compared|comparison) /.test(n)) return 'compare';
  if (/=/.test(q) || / (calculat\w*|formula|comput\w*|how much|derive\w*|worked out|arrive at) /.test(n)) return 'calculation';
  // "where can I configure the workflow" asks for a setting, not for the workflow's steps
  if (/ (configure|configuration|config|setting|settings) /.test(n) && / (where|how) /.test(n)) return 'howto';
  // "consumption is 1 meter, loss is 10 %, wastage 2 % … tell me the total consumption": numbers to work with are a calculation
  if ((n.match(/\b\d+(\.\d+)?\b/g) ?? []).length >= 2 && / (total|tell me|what is|what will|whats|find|give me|result|how much|work out) /.test(n)) return 'calculation';
  if (/ (workflow|flow|lifecycle|life cycle|end to end|sequence of|journey|process flow) /.test(n)) return 'workflow';
  if (/ (validation|validations|validate|mandatory|not allowed|restrict\w*|allowed|prevent\w*|block\w*) /.test(n)) return 'validation';
  if (/ (depend\w*|upstream|downstream|impact\w*|affect\w*|relationship|related to|linked|connected) /.test(n)) return 'dependency';
  if (/ what (happens|happen|will happen) | what if | if .* (zero|0|negative|blank|empty) /.test(n)) return 'whatif';
  if (/(^| )why /.test(n)) return 'why';
  if (/ (value of|show me the data|rows of|captured value) /.test(n)) return 'data';
  if (/ (how (do|can|to|should|would)|steps?|procedure|create|make|setup|configure|enable) /.test(n)) return 'howto';
  if (/^ (what is|what are|whats|what does|define|meaning of|explain) /.test(n) || / mean /.test(n)) return 'definition';
  return 'general';
}

/** Entry/chunk kinds that answer each question type best (first = best). */
export const KIND_FIT: Record<Intent, string[]> = {
  compare: ['definition', 'transaction', 'rule', 'case', 'procedure', 'section'],
  calculation: ['calculation', 'rule', 'field', 'section', 'table'],
  workflow: ['workflow', 'procedure', 'transaction', 'section', 'diagram'],
  validation: ['validation', 'rule', 'procedure', 'section', 'case'],
  dependency: ['dependency', 'transaction', 'workflow', 'field', 'rule', 'section'],
  why: ['rule', 'procedure', 'case', 'transaction', 'section'],
  whatif: ['rule', 'procedure', 'case', 'calculation', 'section'],
  howto: ['procedure', 'workflow', 'section', 'rule', 'transaction'],
  definition: ['definition', 'transaction', 'module', 'rule', 'field', 'procedure', 'section'],
  data: ['data_row', 'table', 'data_model', 'field'],
  general: ['definition', 'procedure', 'rule', 'transaction', 'calculation', 'section', 'workflow', 'field'],
};

/** Damerau–Levenshtein distance with a cut-off. */
export function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      low = Math.min(low, cur[j]);
    }
    if (low > max) return max + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[b.length];
}
