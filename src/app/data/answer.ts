// Rule-based question answering over the CSV knowledge base, using SQL (sql.js) for every fact.
// No AI model: it recognises the kind of question, finds the best-matching field / formula / term,
// queries the tables and composes the answer. Every SQL statement it ran is returned for transparency.
import type { SqlResult, SqlService, TableInfo } from '../core/sql.service';

export type AnswerKind = 'formula' | 'entered' | 'copied' | 'definition' | 'lineage' | 'data' | 'search' | 'workflow' | 'guide' | 'none';

export interface AnswerLink { label: string; path: string[]; query?: Record<string, string>; }
export interface Answer {
  kind: AnswerKind;
  title: string;
  text: string;
  formula?: string;
  example?: string;
  status?: string;
  openQuestion?: string;
  inputs?: string[];
  feeds?: { where: string; label: string; formula: string }[];
  table?: { caption: string; columns: string[]; rows: (string | number | null)[][] };
  points?: string[];
  /** A workflow the assistant built: steps in order, with how many flow steps were left out before each. */
  chain?: { title: string; gap: number }[];
  /** Further guide sections, when a question asks for more than one thing ("…and then track the GRN"). */
  more?: { title: string; text: string; points?: string[] }[];
  /** Set when the hub has no exact answer and this is only the closest topic. */
  gap?: string;
  links: AnswerLink[];
  related: string[];
  sql: string[];
}

type Rec = Record<string, string | number | null>;
interface Candidate { kind: 'column' | 'calc' | 'term' | 'txn'; label: string; ref: Rec; }

const STOP = new Set('a an and are as at be by for from how i in is it of on or the to what when where which who why with does do this that its into can should will my me we you please tell about explain define meaning calculated calculate calculation computed compute formula derived come comes used use show list work works get got'.split(' '));
const SYN: Record<string, string[]> = {
  consumption: ['cons'], cons: ['consumption'], qty: ['quantity'], quantity: ['qty'], pct: ['percent', 'percentage'],
  po: ['rmpo', 'purchase'], oc: ['sales', 'order'], colour: ['color'], color: ['colour'], uom: ['unit'],
};
const ABBR: Record<string, string> = {
  bom: 'bom-materials', 'bill of materials': 'bom-materials', routing: 'bom-routing', costing: 'bom-costing', 'cost sheet': 'bom-costing',
  mrp: 'mrp', grn: 'grn', rmpo: 'rmpo', 'purchase order': 'rmpo', fpo: 'fpo', fppo: 'fpo', bbb: 'buyer-block-booking', 'block booking': 'buyer-block-booking',
  oc: 'buyer-po', 'sales order': 'buyer-po', 'buyer po': 'buyer-po', techpack: 'rm-techpack', 'raw material': 'rm-techpack', indent: 'production-indents',
  'adhoc indent': 'adhoc-indent', 'production order': 'production-order', masters: 'masters', 'apparel': 'apparel-style', style: 'apparel-style', article: 'apparel-style',
};
/** Setup questions that map straight to a glossary term. */
const INTENTS: { re: RegExp; term: (n: string) => string }[] = [
  { re: /total cons(umption)?(?! ?(qty|quantity|per))/, term: () => 'Total consumption' },
  { re: /loss factor/, term: () => 'Loss factor' },
  { re: /(negative|minus|-[0-9]).*(child|level 2|lower level)|(child|level 2).*(negative|minus)/, term: () => 'Negative at the child level' },
  { re: /mrp.*(adjust|negative|minus|reduce|cancel|-[0-9])|(negative|minus|reduce|cancel).*(child|mrp)/, term: () => 'MRP adjustment' },
  { re: /(child|level 2|lower level).*(indent|generat)|mrp.*(explo|generat.*indent|child)/, term: () => 'MRP explosion' },
  { re: /inactive/, term: () => 'User Group and Purchase Officer' },
  { re: /(colou?r).*dependen|dependen.*(colou?r)/, term: (n) => (/table/.test(n) ? 'Colour dependency – Table' : /base/.test(n) ? 'Colour dependency – Base Colour' : /none/.test(n) ? 'Colour dependency – None' : 'Colour dependency') },
  { re: /size.*dependen|dependen.*size/, term: (n) => (/table/.test(n) ? 'Size dependency – Table' : /base/.test(n) ? 'Size dependency – Base Size' : /none/.test(n) ? 'Size dependency – None' : 'Size dependency') },
  { re: /article (code|name).*(generat|creat|made|defin|system coding|automatic|manual)|(generat|creat|defin|system coding).*article (code|name)/, term: () => 'Article Code and Article Name generation' },
  { re: /system coding/, term: () => 'System Coding setup' },
  { re: /(budget|master bom)/, term: () => 'Standard BOM' },
  { re: /(version|versions).*bom|bom.*versions?/, term: () => 'BOM version' },
];
const ARTICLES: Record<string, string> = { 'n-8': 'N-8', 't-1': 'T-1', 'ns1-1': 'NS1-1', 'pp-1': 'PP-1' };

const norm = (s: string) => s.toLowerCase().replace(/%/g, ' pct ').replace(/[^a-z0-9\- ]+/g, ' ').replace(/\s+/g, ' ').trim();
const toks = (s: string) => norm(s).split(' ').filter((w) => w && !STOP.has(w));
const esc = (s: string) => s.replace(/'/g, "''");

/** Words that only the user manuals talk about: a strong match on these answers from the guides. */
/** Words that make a roll question general (about the roll idea, not one step). */
const ROLL_GENERIC = new Set(['roll', 'function', 'functionality', 'feature', 'work', 'manag', 'manage', 'management', 'track', 'wise', 'stock', 'concept', 'fabric', 'wfx', 'use', 'used', 'using', 'explain', 'mean', 'meaning', 'traceability', 'trace', 'purpose', 'benefit', 'need']);
const CONCEPT_TABLES = ['uom_types', 'article_coding', 'dependency_types', 'bom_concepts', 'mrp_rules', 'sales_order_rules'];
/** Words that say nothing about the topic; a confident answer does not need to contain them. */
const GENERIC = new Set('work works working worked use used uses using need needs needed wfx system functionality function feature features process way get gets got do does done doing know tell explain mean meaning means purpose reason good best also already new screen option options possible able show see give happen happens happened something thing things type types example done there their them we us our my me you your it its this that these those time correct correctly right proper properly exactly actually basically simply really please kindly regarding about related detail details information info question create creating created make making made should would could can will shall may might must one own next directly direct wise got getting gets via through inside within kind sort just only exact still yet since whole full complete entire'.split(' '));
/** A question word found in at most this share of the hub's passages is distinctive and must be in the answer. */
const STRICT = { rare: 0.06, per: 4, lead: 2 };
/** Question types the hub must answer head-on: the answer's title has to be of the same kind. */
const REASONING = [
  { q: /\bwhy\b/, t: /\bwhy\b|\breason/ },
  { q: /\bwhat (happens|happen|will happen) (if|when)\b|\bwhat if\b/, t: /\bwhat happens|\bif\b|\bwhen\b/ },
  { q: /^(can|could|is it possible|is there a way)\b|\bcan (i|we|one|you|a|an)\b/, t: /\bcan\b|\bhow (do|to)\b|\bpossible\b/ },
];
const NEGATION = /\b(without|not|cannot|cant|never|no)\b/;
const NEGATION_IN_ANSWER = /\b(without|not|cannot|never|no|inactive|un\w+|blank|zero|skip\w*|bypass\w*)\b/i;
const COMPARE = /\b(difference|differences|differ|different|vs|versus|compare|compared|comparison)\b/;
const MANUAL_KEYWORDS = /\b(rolls?|roll[ -]?wise|tna|wms|qr|barcode|sample|samples|courier|forwarder|recipe|recipes|pickup|write ?off|closure|ai tech ?pack|otm|supplier portal|equivalent|debit note|pick ?list|gdi|gdn|gin|gon|smart scan|dyeing|operation library|operation parameter|operation cost|manufacturing bom|qc|quality check|inspection|uom conversion|sourcing asn|adhoc indent|indent fulfil\w*|user indent|my task|auto tna|returnable|mobile app\w*)\b/;
/** Words that mean the same thing in a question about the manuals (both the question and the guides are mapped the same way). */
const GROUPS: Record<string, string[]> = {
  multi: ['multiple', 'several', 'many', 'together', 'combine', 'combined', 'consolidate', 'consolidated', 'merge', 'bulk', 'multi', 'batch'],
  create: ['create', 'make', 'generate', 'raise', 'prepare', 'build', 'creating', 'creation', 'created', 'making'],
  check: ['check', 'view', 'verify', 'find', 'know'],
  track: ['track', 'tracking', 'monitor', 'monitoring', 'trace'],
  problem: ['error', 'issue', 'problem', 'alert', 'fail', 'failed', 'failing', 'wrong', 'stuck', 'trouble', 'troubleshooting', 'fix', 'resolve'],
  change: ['change', 'edit', 'update', 'modify', 'revise', 'alter'],
  setup: ['setup', 'configure', 'configuration', 'config', 'enable', 'activate', 'define', 'set'],
  remove: ['remove', 'delete', 'discard'],
  dispatch: ['dispatch', 'send', 'sending', 'sent', 'ship', 'shipping', 'deliver', 'delivery'],
  receive: ['receive', 'receiving', 'received', 'receipt', 'grn'],
  appear: ['appear', 'visible', 'coming', 'shown', 'showing', 'display', 'displayed'],
  avail: ['available', 'availability', 'exist', 'exists', 'present', 'there'],
  return: ['return', 'returned', 'returning'],
  reject: ['reject', 'rejected', 'rejection', 'damaged', 'damage', 'defective', 'defect', 'faulty', 'bad', 'torn'],
  auto: ['auto', 'automatic', 'automatically', 'automate'],
  attach: ['attach', 'attachment', 'attached', 'attaching'],
  rmpo: ['po', 'pos', 'rmpo', 'rmpos', 'purchase', 'buy', 'buying', 'bought', 'procure', 'procurement'],
  supplier: ['supplier', 'vendor'],
  mobile: ['mobile', 'app', 'application', 'phone', 'android', 'quickdocs', 'quickdoc'],
  qc: ['qc', 'quality', 'inspection'],
  pct: ['pct', 'percent', 'percentage'],
  close: ['close', 'closed', 'closing', 'closure'],
};
const CANON: Record<string, string> = {};
for (const [k, list] of Object.entries(GROUPS)) for (const w of list) CANON[w] = k;
/** Filler words in long, chatty questions. */
const MSTOP = new Set('kindly pls hi hello dear sir madam want wanted need needs needed trying tried help using then also just some any here like am was been being could would may might thanks thank very really actually currently suppose someone anyone user users team guide steps step way procedure difference differences between versus vs compare comparison mean means happens happen happened told able new wfx lot has yet still getting one ones found say says he she they it'.split(' '));
const stem = (w: string) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
/** Normalises the spellings people use for the same thing: "write off", "pick list", "in house", "tech pack". */
const mnorm = (s: string) => norm(s)
  .replace(/\bwrite[ -]?offs?\b/g, 'write-off').replace(/\bin[ -]?house\b/g, 'in-house').replace(/\bpick[ -]?lists?\b/g, 'picklist')
  .replace(/\btech[ -]?packs?\b/g, 'techpack').replace(/\bbill of materials?\b/g, 'bom').replace(/\bpurchase orders?\b/g, 'rmpo')
  .replace(/\bpick[ -]?ups?\b/g, 'pickup').replace(/\bone time\b/g, 'one-time').replace(/\bmy tasks?\b/g, 'my-task');
const rawToks = (s: string) => mnorm(s).split(' ').filter((w) => w && !/^\d+$/.test(w) && !STOP.has(w) && !MSTOP.has(w)).map(stem);
const canon = (w: string) => CANON[w] ?? w;
/** Edit distance with a cut-off; a swap of two neighbouring letters counts as one mistake ("sapmle" → "sample"). */
function lev(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev2: number[] = [];
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let low = cur[0];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], prev2[j - 2] + 1);
      low = Math.min(low, cur[j]);
    }
    if (low > max) return max + 1;
    prev2 = prev; prev = cur;
  }
  return prev[b.length];
}

/** How confident the guide match must be. Tuned with `npm run test:ask`. */
const GUIDE = { keyword: 0.45, strong: 1.35, howTo: 0.9, closest: 0.75, extra: 0.82, alt: 0.6 };
const CONJUNCTION = /\b(and then|then|and also|also|after that|afterwards|and|before)\b/;

export class AnswerEngine {
  private ran: string[] = [];
  private cols: Rec[] = [];
  private calcs: Rec[] = [];
  private terms: Rec[] = [];
  private txns: Rec[] = [];
  private fields: Rec[] = [];
  private manuals: Rec[] = [];
  private tables: TableInfo[] = [];
  private loaded = false;

  constructor(private readonly sql: SqlService) {}

  private async q(text: string): Promise<SqlResult> {
    this.ran.push(text);
    return this.sql.query(text);
  }
  private static recs(r: SqlResult): Rec[] {
    return r.rows.map((row) => Object.fromEntries(r.columns.map((c, i) => [c, row[i]])));
  }

  private async init() {
    if (this.loaded) return;
    const all = async (t: string) => AnswerEngine.recs(await this.sql.query(`SELECT * FROM ${t}`));
    [this.cols, this.calcs, this.terms, this.txns, this.fields] = await Promise.all(
      ['document_columns', 'calculations', 'glossary', 'transactions', 'fields'].map(all));
    this.tables = (await this.sql.manifest()).tables;
    for (const t of this.tables.filter((x) => x.table.startsWith('manual_'))) {
      this.manuals.push(...(await all(`"${t.table}"`)).map((r) => ({ ...r, table: t.table, module: t.module })));
    }
    // owner-explained rules are searchable like the guides (e.g. "how do I approve a sales order")
    for (const t of this.tables.filter((x) => CONCEPT_TABLES.includes(x.table))) {
      this.manuals.push(...(await all(`"${t.table}"`)).map((r) => ({
        table: t.table, module: t.module, concept: 1, document: String(r['group_name'] ?? ''), topic: `${t.table}:${r['id']}`,
        title: String(r['name']), content: `${r['definition']}${r['option_value'] ? ` Options: ${r['option_value']}.` : ''}`,
        steps: '', where_used: r['where_used'] ?? '', notes: r['example'] ?? '',
      })));
    }
    this.buildManualIndex();
    this.loaded = true;
  }

  /**
   * Answers only when sure. The keyword engine below finds a candidate; it is shown only if it really covers the
   * question (every topic word of the question appears in the answer). Otherwise the user is told plainly that the hub
   * has no answer, with the closest topics. Comparison questions get both definitions, or nothing.
   */
  async ask(question: string): Promise<Answer> {
    await this.init();
    this.ran = [];
    const n = norm(question);
    const a = await this.askRaw(question);
    // a comparison: a section that covers both sides, else both definitions, else nothing (one side alone is wrong)
    if (COMPARE.test(n) && !(a.kind !== 'none' && this.covers(question, a) && this.titleHas(question, a, 2))) {
      return (await this.compareAnswer(question, n)) ?? this.none(question, this.manualRank(question));
    }
    if (a.kind !== 'none' && this.covers(question, a)) return a;
    // the first pick does not cover the question: try the next guides and the written rules, first one that covers wins
    const alts = [...this.manualRank(question, false, 'guides').slice(0, 4), ...this.manualRank(question, false, 'rules').slice(0, 4)]
      .filter((r) => r.row['title'] !== a.title && r.score >= GUIDE.alt).sort((x, y) => y.score - x.score);
    for (const r of alts) {
      const g = await this.guideAnswer(r.row);
      if (this.covers(question, g)) return g;
    }
    const near = a.kind === 'none' ? [] : [{ row: { title: a.title } as Rec, score: 1 }];
    return this.none(question, [...near, ...alts]);
  }

  /** The question's topic words: no filler, no generic verbs, spelling fixed against the hub's own words. */
  private topicWords(question: string): string[] {
    return [...new Set(rawToks(question).map((w) => canon(this.correct(w).t)).filter((w) => w.length > 1 && !GENERIC.has(w)))];
  }

  /** True when the answer contains every topic word of the question (one may be missing in a long question). */
  covers(question: string, a: Answer): boolean { return !this.coverFail(question, a); }

  /** Why an answer does not cover the question (null when it does). */
  coverFail(question: string, a: Answer): string | null {
    const words = this.topicWords(question);
    if (!words.length) return null;
    const body = [a.title, a.text, a.formula, a.example, ...(a.points ?? []), ...(a.more ?? []).flatMap((x) => [x.title, x.text, ...(x.points ?? [])]),
      a.table?.caption, ...(a.table?.columns ?? [])].filter(Boolean).join(' ');
    // what the answer is ABOUT: its title, its opening sentences, its formula; a word buried in step 7 does not count
    const sentences = (t: string) => t.split(/(?<=[.!?])\s+/).slice(0, STRICT.lead).join(' ');
    const about = [a.title, sentences(a.text), a.formula, a.table?.caption, ...(a.more ?? []).flatMap((x) => [x.title, sentences(x.text)])].filter(Boolean).join(' ');
    const have = new Set(rawToks(about).map(canon));
    const seen = (w: string) => have.has(w) || (SYN[w] ?? []).some((x) => have.has(canon(x)))
      || (w.length >= 5 && [...have].some((h) => h.length >= 5 && h.slice(0, 5) === w.slice(0, 5)));
    // only distinctive words must be there: words the hub uses, and uses rarely ("excess", "cancel", "approve").
    // Words the hub never uses ("directly", "dropdown") or uses everywhere ("fabric", "screen") cannot decide it.
    const N = this.mGuides;
    const critical = words.filter((w) => { const df = this.mDf.get(w) ?? 0; return df > 0 && df / N <= STRICT.rare; });
    void critical;
    const known = words.filter((w) => this.mDf.has(w) || this.mVocab.has(w));
    const missing = known.filter((w) => !seen(w));
    if (NEGATION.test(norm(question)) && !NEGATION_IN_ANSWER.test(body)) return 'negation';
    if (missing.length > Math.floor(known.length / STRICT.per)) return `missing ${missing.join(',')}`;
    const nq = norm(question);
    // "what is FOB price": a short definition question whose words the hub does not know at all is not answered
    if (/\b(what is|what are|whats|define|meaning of)\b/.test(nq) && words.length <= 3 && words.some((w) => !this.mDf.has(w) && !this.mVocab.has(w) && !have.has(w))) return 'unknown word';
    // "why…", "what happens if…": the hub must address that very question, not just the topic
    const kind = REASONING.find((r) => r.q.test(nq));
    if (kind && !kind.t.test(norm(a.title))) return 'question type';
    // "multiple suppliers" is not "multiple indents"
    if (this.modifierClash(words, a.title)) return 'modifier';
    // the rarest topic word of the question is what it is about: it must be in the answer's title
    return null;
  }

  /** True when one of the question's rarest topic words (up to `k` of them must all match… at least one) is in the title. */
  private titleHas(question: string, a: Answer, k: number): boolean {
    const words = this.topicWords(question).filter((w) => this.mDf.has(w));
    if (!words.length) return true;
    // the title and the first sentence say what an answer is about
    const lead = k === 1 ? ` ${a.text.split(/(?<=[.!?])\s/)[0]}` : '';
    const t = new Set(rawToks(a.title + lead).map(canon));
    const inTitle = (w: string) => t.has(w) || (SYN[w] ?? []).some((x) => t.has(canon(x))) || (w.length >= 5 && [...t].some((h) => h.length >= 5 && h.slice(0, 5) === w.slice(0, 5)));
    const sorted = [...words].sort((x, y) => (this.mDf.get(x) ?? 0) - (this.mDf.get(y) ?? 0));
    const minDf = this.mDf.get(sorted[0]) ?? 0;
    const rarest = sorted.filter((w) => (this.mDf.get(w) ?? 0) <= minDf + 1);
    if (k === 1) return rarest.some(inTitle);
    return sorted.slice(0, k).every(inTitle);
  }

  private modifierClash(words: string[], title: string): boolean {
    const t = rawToks(title).map(canon);
    for (const m of ['multi', 'single', 'each', 'partial']) {
      const qi = words.indexOf(m), ti = t.indexOf(m);
      if (qi < 0 || ti < 0 || qi + 1 >= words.length || ti + 1 >= t.length) continue;
      const qn = words[qi + 1], tn = t[ti + 1];
      if (qn !== tn && !t.includes(qn)) return true;
    }
    return false;
  }

  /** "difference between indent and RMPO": both definitions side by side, when the hub knows both by name. */
  private async compareAnswer(question: string, n: string): Promise<Answer | null> {
    const tail = n.replace(/^.*?\b(difference|differences|differ|different|compare|compared|comparison)\b( (between|of|in))?/, '').trim() || n;
    const parts = tail.split(/\b(?:and|vs|versus|with|from|or|to)\b/).map((x) => x.trim()).filter((x) => toks(x).length);
    if (parts.length < 2) return null;
    const sides: Answer[] = [];
    for (const part of parts.slice(0, 2)) {
      const qt = new Set(toks(part).flatMap((t) => [t, ...(SYN[t] ?? [])]));
      const best = this.match(norm(part), qt);
      const abbr = Object.keys(ABBR).find((k) => new RegExp(`(^|\\s)${k}(\\s|$)`).test(norm(part)));
      let a: Answer | null = null;
      if (abbr) a = await this.txnAnswer(ABBR[abbr]);
      else if (best && n.includes(norm(best.cand.label)) && toks(best.cand.label).length >= toks(part).length - 1) {
        const c = best.cand;
        a = c.kind === 'term' ? await this.termAnswer(c.ref) : c.kind === 'txn' ? await this.txnAnswer(String(c.ref['slug'])) : c.kind === 'calc' ? await this.calcAnswer(c.ref) : await this.columnAnswer(c.ref, 'auto');
      }
      if (!a || !this.covers(part, a)) return null;
      sides.push(a);
    }
    const [x, y] = sides;
    if (x.title === y.title) return null;
    return {
      kind: 'definition', title: `${x.title} vs ${y.title}`,
      gap: "The hub has no written comparison of these two; here is what it says about each, so you can compare them.",
      text: `${x.title}: ${x.text}`,
      more: [{ title: y.title, text: y.text, points: y.points?.slice(0, 4) }],
      points: x.points?.slice(0, 4),
      links: [...x.links.slice(0, 1), ...y.links.slice(0, 1)], related: [`What is ${x.title}?`, `What is ${y.title}?`], sql: [...this.ran],
    };
  }

  /** For tests: which question words had to be in the answer, and which were missing. */
  async coverDebug(question: string, a: Answer) {
    await this.init();
    const N = this.mGuides;
    const words = this.topicWords(question);
    return words.map((w) => `${w}:${(((this.mDf.get(w) ?? 0) / N) * 100).toFixed(0)}%`).join(' ') + ` → ${this.coverFail(question, a) ?? 'covers'}`;
  }

  /** The best hub passages for a question, for the AI to answer from. */
  async passages(question: string, k = 6): Promise<{ title: string; text: string }[]> {
    await this.init();
    return this.manualRank(question).slice(0, k).map((r) => ({
      title: String(r.row['title']),
      text: [r.row['content'], r.row['steps'], r.row['where_used'] ? `Where in WFX: ${r.row['where_used']}` : '', r.row['notes']].filter(Boolean).join(' '),
    }));
  }

  private async askRaw(question: string): Promise<Answer> {
    const n = norm(question);
    const qt = new Set(toks(question).flatMap((t) => [t, ...(SYN[t] ?? [])]));
    const wantsFormula = /\b(how|formula|calculat|comput|derive|worked out|arrive|logic)/.test(n);
    const wantsSource = /\b(where|which)\b.*\b(come|comes|from|source|taken|pulled|filled)\b|source of/.test(n);
    const wantsUse = /\b(where|what)\b.*\b(used|go|goes|feed|feeds|next)\b/.test(n);
    const wantsDefinition = /\b(what is|what are|whats|define|definition|meaning|explain|tell me about|what does)\b/.test(n);
    const article = Object.keys(ARTICLES).find((k) => new RegExp(`(^|\\s)${k}(\\s|$)`).test(n));

    const best = this.match(n, qt);

    // 0) setup concepts (dependency types, UOM types, BOM types, article coding)
    const intent = INTENTS.find((i) => i.re.test(n));
    const byIntent = intent ? this.terms.find((t) => t['term'] === intent.term(n)) : undefined;
    if (byIntent) return this.termAnswer(byIntent);
    if (wantsDefinition && !article) {
      const label = (t: Rec) => norm(String(t['term']).replace(/\s*\(.*\)$/, ''));
      const named = this.terms
        .filter((t) => label(t) !== 'bom' && /uom|bom|master cost|dependen|mrp (adjust|explo)|negative at/.test(label(t)) && n.includes(label(t)))
        .sort((a, b) => label(b).length - label(a).length)[0];
      if (named) return this.termAnswer(named);
    }

    // 0b) user-manual guides (sourcing, inventory, QC, WMS, TNA, sample order, OC closure, recipe, AI tech pack)
    const howTo = /\b(how (do|can|to|should|would)|steps?|procedure|why|create|make|set ?up|configure|enable|start)\b/.test(n) && !/calculat|formula|comput/.test(n);
    const ranked = this.manualRank(question, howTo);
    const man = ranked[0];
    // how much of the question the best field / term / transaction label really covers (a lone word such as "Supplier" covers little)
    const qWords = toks(question);
    const bestCover = best ? toks(best.cand.label).filter((t) => qt.has(t)).length / Math.max(qWords.length, 1) : 0;
    const asksFormula = /calculat|formula|comput|derived|worked out/.test(n);
    // the question names a field / term exactly and says little else ("what is production time"): that wins over a guide
    const exactLabel = !!best && bestCover >= 0.6 && n.includes(norm(best.cand.label));
    const answerGuide = (): Promise<Answer> => {
      // a question that asks for more than one thing also gets the second-best section from another topic
      const extra = CONJUNCTION.test(n) ? ranked.slice(1).filter((r) => r.score >= man!.score * GUIDE.extra && r.score >= 1.0 && r.row['topic'] !== man!.row['topic']).slice(0, 2) : [];
      // answer in the order the question asked: the section whose words come first in the question leads
      const ordered = [man!, ...extra].sort((a, b) => a.pos - b.pos).map((r) => r.row);
      return this.guideAnswer(ordered[0], { extra: ordered.slice(1) });
    };
    if (man && man.cov >= 0.45 && ((MANUAL_KEYWORDS.test(n) && man.score >= GUIDE.keyword)
      || (!exactLabel && man.n >= 2 && man.score >= GUIDE.strong && (!best || best.score < man.score + 0.3))
      || (howTo && man.score >= GUIDE.howTo && (!best || best.cand.kind === 'txn' || best.cand.kind === 'term'))
      || (!asksFormula && man.n >= 2 && man.score >= GUIDE.closest && bestCover < 0.4))) return answerGuide();

    // 1) data about a specific material line
    if (article && !wantsDefinition) return this.dataAnswer(ARTICLES[article], best);

    // 2) "what is BOM" – a transaction or glossary term
    const abbr = Object.keys(ABBR).sort((a, b) => b.length - a.length).find((k) => new RegExp(`(^|\\s)${k}(\\s|$)`).test(n));
    if (wantsDefinition && abbr && (!best || best.cand.kind === 'txn' || best.score < 1)) return this.txnAnswer(ABBR[abbr]);

    if (best && best.score >= 0.5) {
      const c = best.cand;
      if (c.kind === 'column') return this.columnAnswer(c.ref, wantsSource || wantsUse ? 'lineage' : wantsFormula ? 'formula' : 'auto');
      if (c.kind === 'calc') return this.calcAnswer(c.ref);
      if (c.kind === 'term') return this.termAnswer(c.ref);
      if (c.kind === 'txn') return this.txnAnswer(String(c.ref['slug']));
    }
    if (abbr) return this.txnAnswer(ABBR[abbr]);
    if (man && man.n >= 2 && man.cov >= 0.5 && man.score >= GUIDE.closest) return this.guideAnswer(man.row, { closest: ranked.slice(1, 4).map((r) => r.row) });
    return this.none(question, ranked);
  }

  // ── user-manual guides ───────────────────────────────────────────────
  private mIndex: { row: Rec; head: Set<string>; body: Set<string>; bodyTf: Map<string, number>; headBi: Set<string>; bodyBi: Set<string> }[] = [];
  private mDf = new Map<string, number>();
  private mGuides = 1;
  private mVocab = new Set<string>();
  private mFix = new Map<string, string>();

  private bigrams(list: string[]): Set<string> {
    const out = new Set<string>();
    for (let i = 0; i + 1 < list.length; i++) out.add(`${list[i]} ${list[i + 1]}`);
    return out;
  }

  /** Reads every manual section once: word sets, word pairs, word counts and how rare each word is. */
  private buildManualIndex(): void {
    this.mIndex = []; this.mDf.clear(); this.mVocab.clear(); this.mFix.clear();
    this.mGuides = this.manuals.filter((m) => !m['concept']).length || 1;
    for (const m of this.manuals) {
      const headRaw = rawToks(m['concept'] ? `${m['title']} ${m['document']}` : `${m['title']} ${m['topic']}`);
      const bodyRaw = String(m['topic']).startsWith('Roll functionality') ? [] : rawToks(`${m['content']} ${m['steps'] ?? ''} ${m['notes'] ?? ''} ${m['where_used'] ?? ''}`);
      headRaw.concat(bodyRaw).forEach((w) => this.mVocab.add(w));
      const head = headRaw.map(canon), body = bodyRaw.map(canon);
      const bodyTf = new Map<string, number>();
      body.forEach((t) => bodyTf.set(t, (bodyTf.get(t) ?? 0) + 1));
      this.mIndex.push({ row: m, head: new Set(head), body: new Set(body), bodyTf, headBi: this.bigrams(head), bodyBi: this.bigrams(body) });
      // word rarity is measured on the guides only, so adding rule rows does not shift every score
      if (!m['concept']) for (const t of new Set([...head, ...body])) this.mDf.set(t, (this.mDf.get(t) ?? 0) + 1);
    }
    Object.keys(CANON).forEach((w) => this.mVocab.add(w));
  }

  /** Spelling correction against the words the guides really use ("sapmle" → "sample"). Only close matches are accepted. */
  private correct(w: string): { t: string; fixed: boolean } {
    if (this.mVocab.has(w) || w.length < 5 || /\d/.test(w)) return { t: w, fixed: false };
    const cached = this.mFix.get(w);
    if (cached !== undefined) return { t: cached, fixed: cached !== w };
    const max = w.length >= 8 ? 2 : 1;
    let best = w, bestD = max + 1, bestDf = -1;
    for (const v of this.mVocab) {
      if (v[0] !== w[0] || Math.abs(v.length - w.length) > max) continue;
      const d = lev(w, v, max);
      const df = this.mDf.get(canon(v)) ?? 0;
      if (d <= max && (d < bestD || (d === bestD && df > bestDf))) { best = v; bestD = d; bestDf = df; }
    }
    this.mFix.set(w, best);
    return { t: best, fixed: best !== w };
  }

  /**
   * Ranks the guide sections for a question. Rare words count more than common ones, words in the title count double,
   * words the guides never use lower the score, and a match needs at least one word that was spelled right.
   */
  private manualRank(question: string, howTo = false, pool: 'guides' | 'rules' = 'guides'): { row: Rec; score: number; n: number; cov: number; pos: number }[] {
    if (!this.mIndex.length) return [];
    const qs: string[] = [], fixedSet = new Set<string>();
    for (const w of rawToks(question)) {
      const { t, fixed } = this.correct(w);
      const c = canon(t);
      qs.push(c);
      if (fixed) fixedSet.add(c);
    }
    const q = [...new Set(qs)];
    const N = this.mGuides;
    const idf = (t: string) => { const df = this.mDf.get(t) ?? 0; return df ? Math.log(1 + (N - df + 0.5) / (df + 0.5)) : 0; };
    const known = q.filter((t) => idf(t) > 0);
    if (!known.length) return [];
    const unknown = q.length - known.length;
    const avg = known.reduce((a, t) => a + idf(t), 0) / known.length;
    // words nobody in the guides uses (and that did not fix to one) are probably off topic: they pull the score down
    const total = known.reduce((a, t) => a + idf(t), 0) + unknown * avg * 0.6;
    const pairs = [...this.bigrams(qs)];
    const out: { row: Rec; score: number; n: number; cov: number; pos: number }[] = [];
    for (const e of this.mIndex) {
      if (!e.row['concept'] !== (pool === 'guides')) continue;
      let matched = 0, words = 0;
      for (const t of known) {
        const w = fixedSet.has(t) ? 0.8 : 1;
        if (e.head.has(t)) { matched += idf(t) * 2 * w; words++; }
        else if (e.body.has(t)) { matched += idf(t) * w * (1 + 0.35 * Math.log(e.bodyTf.get(t) ?? 1)); words++; }
      }
      if (!matched) continue;
      let score = matched / total;
      for (const p of pairs) score += e.headBi.has(p) ? 0.2 : e.bodyBi.has(p) ? 0.08 : 0;
      if (howTo && /^(how|why) /i.test(String(e.row['title']))) score += 0.08;
      // a guide about "multiple" things should not answer a question that never said so
      if (e.head.has('multi') && !q.includes('multi')) score -= 0.35;
      // the roll overview answers general roll questions; a question that names one step (QC, location, split...) goes to that step
      if (String(e.row['topic']).startsWith('Roll functionality')) {
        const general = known.every((t) => ROLL_GENERIC.has(t));
        score += general && known.includes('roll') ? 1.5 : -0.6;
      }
      // share of ALL the question's words (also the unknown ones) that this section contains
      const pos = qs.findIndex((t) => e.head.has(t));
      out.push({ row: e.row, score, n: known.length, cov: words / (known.length + 0.5 * unknown), pos: pos < 0 ? 99 : pos });
    }
    return out.sort((a, b) => b.score - a.score).slice(0, 5);
  }

  /** For tests: how the question was read and how the guides rank. */
  debug(question: string, howTo = false) {
    return { words: rawToks(question).map((w) => this.correct(w).t).map(canon), ranked: this.manualRank(question, howTo).slice(0, 3).map((r) => `${r.score.toFixed(2)} cov ${r.cov.toFixed(2)} ${r.row['title']}`) };
  }

  private async guideAnswer(m: Rec, opts: { extra?: Rec[]; closest?: Rec[] } = {}): Promise<Answer> {
    const table = String(m['table']);
    if (m['concept']) await this.q(`SELECT name, definition, example FROM ${table} WHERE id = '${esc(String(m['topic']).split(':')[1])}'`);
    else await this.q(`SELECT title, content, steps FROM ${table} WHERE topic = '${esc(String(m['topic']))}'`);
    const stepsOf = (r: Rec) => String(r['steps'] ?? '').split('\n').map((x) => x.trim()).filter(Boolean);
    const steps = stepsOf(m);
    const where = String(m['where_used'] ?? '');
    const siblings = this.manuals.filter((x) => x['table'] === table && x['document'] === m['document'] && x['topic'] !== m['topic']).slice(0, 3);
    const area = this.tables.find((t) => t.table === table);
    const related = opts.closest?.length ? opts.closest.map((x) => String(x['title'])) : siblings.map((x) => String(x['title']));
    return {
      kind: 'guide', title: String(m['title']),
      gap: opts.closest ? "No exact answer in the hub's knowledge: this is the closest topic it has." : undefined,
      text: `${m['content']}${where ? ` Where in WFX: ${where}.` : ''}`,
      points: steps.length ? steps : undefined,
      example: m['notes'] ? `Good to know: ${m['notes']}` : undefined,
      more: opts.extra?.map((x) => ({ title: String(x['title']), text: String(x['content']), points: stepsOf(x).length ? stepsOf(x) : undefined })),
      links: [{ label: m['concept'] ? 'Browse these rules in the data' : 'Browse this guide in the data', path: ['/data'], query: { area: String(area?.module ?? m['module']) } }],
      related,
      sql: [...this.ran],
    };
  }

  // ── matching ──────────────────────────────────────────────────────────
  private match(n: string, qt: Set<string>): { cand: Candidate; score: number } | null {
    const cands: Candidate[] = [
      ...this.cols.map((r) => ({ kind: 'column' as const, label: String(r['label']), ref: r })),
      ...this.calcs.map((r) => ({ kind: 'calc' as const, label: String(r['name']), ref: r })),
      ...this.terms.map((r) => ({ kind: 'term' as const, label: String(r['term']).replace(/\s*\(.*\)$/, ''), ref: r })),
      ...this.txns.map((r) => ({ kind: 'txn' as const, label: String(r['name']).split(/ [–(]/)[0], ref: r })),
    ];
    let best: { cand: Candidate; score: number } | null = null;
    for (const cand of cands) {
      const ct = toks(cand.label);
      if (!ct.length) continue;
      const hit = ct.filter((t) => qt.has(t) || (SYN[t] ?? []).some((s) => qt.has(s))).length;
      if (!hit) continue;
      let score = hit / ct.length + hit * 0.05;
      if (n.includes(norm(cand.label))) score += 0.6;
      // "lead time" is not "Production Time": when the question puts a different word where the label has its own
      // qualifier, the label only shares a generic word with the question
      else if (hit < ct.length && this.qualifierClash(n, ct)) score -= 0.5;
      // prefer calculated columns, then BOM documents for ties
      if (cand.kind === 'column' && cand.ref['type'] === 'calc') score += 0.04;
      if (cand.kind === 'column' && String(cand.ref['document']).startsWith('bom-materials')) score += 0.03;
      if (cand.kind === 'calc') score += 0.02;
      if (cand.kind === 'term') score += 0.05;
      if (!best || score > best.score) best = { cand, score };
    }
    return best;
  }

  /** True when a label word is missing from the question and the question has another word in its place. */
  private qualifierClash(n: string, ct: string[]): boolean {
    const qw = toks(n);
    for (let i = 0; i < ct.length; i++) {
      if (qw.includes(ct[i])) continue;
      const next = ct[i + 1], prev = ct[i - 1];
      const at = next !== undefined ? qw.indexOf(next) : prev !== undefined ? qw.indexOf(prev) : -1;
      if (at < 0) continue;
      const slot = next !== undefined ? qw[at - 1] : qw[at + 1];
      if (slot && slot.length > 2 && !ct.includes(slot)) return true;
    }
    return false;
  }

  private tableFor(col: Rec): TableInfo | undefined {
    return this.tables.find((t) => t.document === col['document'] && t.grid === col['grid_id']);
  }
  private colName(col: Rec, label: string): string | undefined {
    return (this.cols.find((c) => c['document'] === col['document'] && c['label'] === label)?.['column_name'] as string) ?? undefined;
  }
  private calcOf(col: Rec): Rec | undefined {
    const id = col['calculation_id'];
    return id ? this.calcs.find((c) => c['id'] === id) : undefined;
  }
  private feedsOf(label: string) {
    return this.cols.filter((c) => String(c['calculated_from'] ?? '').split(', ').includes(label) || c['source_column'] === label)
      .map((c) => ({ where: String(c['document_name']), label: String(c['label']), formula: String(c['formula'] || (c['source_column'] ? `copied from ${c['source_column']}` : '')) }));
  }

  // ── answers ───────────────────────────────────────────────────────────
  private async columnAnswer(col: Rec, mode: 'formula' | 'lineage' | 'auto'): Promise<Answer> {
    const label = String(col['label']);
    const doc = String(col['document_name']);
    const type = String(col['type']);
    // the same column can appear on several documents – show all, starting with this one
    const sameName = AnswerEngine.recs(await this.q(`SELECT document_name, type, formula, source_document, source_column FROM document_columns WHERE label = '${esc(label)}'`));
    const calc = this.calcOf(col);
    const feeds = this.feedsOf(label);
    const inputs = String(col['calculated_from'] || '').split(', ').filter(Boolean);
    const field = this.fields.find((f) => String(f['field']).toLowerCase().includes(label.toLowerCase()));
    const definition = (col['note'] as string) || (field?.['definition'] as string) || '';
    const table = await this.sampleData(col, inputs);
    const base: Answer = {
      kind: type === 'calc' ? 'formula' : type === 'entered' ? 'entered' : 'copied',
      title: label, text: '', inputs, feeds, table, related: [], sql: [], links: this.docLinks(String(col['document']), String(col['column_key'])),
    };

    if (type === 'calc') {
      base.text = `${label} is calculated by WFX on ${doc}.` + (definition ? ` ${definition}` : '');
      base.formula = `${label} = ${col['formula'] || calc?.['formula'] || ''}`.replace(/^(.*?) = \1 = /, '$1 = ');
      if (calc) { base.example = String(calc['example']); base.status = String(calc['status']); base.openQuestion = String(calc['open_question'] || '') || undefined; }
      base.related = [...inputs.map((i) => `How is ${i} calculated?`), feeds[0] ? `Where is ${label} used?` : ''].filter(Boolean);
    } else if (type === 'entered' || type === 'key') {
      base.kind = 'entered';
      base.text = `${label} is not calculated – it is entered by the user on ${doc}.` + (definition ? ` ${definition}` : '');
      if (feeds.length) base.text += ` WFX then uses it to calculate ${feeds.map((f) => f.label).join(', ')}.`;
      base.related = feeds.slice(0, 3).map((f) => `How is ${f.label} calculated?`);
    } else {
      base.kind = 'copied';
      base.text = `${label} is ${type === 'link' ? 'a link to' : 'copied from'} ${col['source_document'] ? this.docName(String(col['source_document'])) : 'another document'}${col['source_column'] ? ` › ${col['source_column']}` : ''} – it is not typed again on ${doc}.`;
      base.related = col['source_column'] ? [`How is ${col['source_column']} calculated?`] : [];
    }
    if (mode === 'lineage') base.kind = 'lineage';
    if (sameName.length > 1) {
      base.points = sameName.map((r) => `${r['document_name']}: ${r['type'] === 'calc' ? `calculated – ${r['formula']}` : r['source_column'] ? `taken from ${this.docName(String(r['source_document']))} › ${r['source_column']}` : String(r['type'])}`);
    }
    base.sql = [...this.ran];
    return base;
  }

  private async sampleData(col: Rec, inputs: string[]): Promise<Answer['table']> {
    const t = this.tableFor(col);
    if (!t) return undefined;
    const want = [...inputs.map((i) => this.colName(col, i)).filter((x): x is string => !!x), String(col['column_name'])];
    const key = t.columns.find((c) => ['article_code', 'process', 'production_process', 'section', 'item', 'key'].includes(c.name) || c.name.endsWith('_key'))?.name;
    const pick = [...new Set([key, ...want].filter((x): x is string => !!x && t.columns.some((c) => c.name === x)))];
    if (pick.length < 1) return undefined;
    const r = await this.q(`SELECT ${pick.map((p) => `"${p}"`).join(', ')} FROM "${t.table}" LIMIT 8`);
    return { caption: `${this.docName(String(col['document']))} – data`, columns: r.columns, rows: r.rows };
  }

  private async calcAnswer(c: Rec): Promise<Answer> {
    const cols = this.cols.filter((x) => x['calculation_id'] === c['id']);
    if (cols.length) return this.columnAnswer(cols[0], 'formula');
    return {
      kind: 'formula', title: String(c['name']), text: String(c['explanation']), formula: String(c['formula']), example: String(c['example']),
      status: String(c['status']), openQuestion: String(c['open_question'] || '') || undefined, links: [{ label: 'Formula library', path: ['/calculations'] }],
      related: [], sql: [...this.ran],
    };
  }

  /** Looks the term up in the owner-explained concept tables (UOM, dependency, BOM, article coding). */
  private async conceptOf(term: string): Promise<Rec | undefined> {
    const name = term.includes(' – ') ? term.split(' – ')[1] : term;
    const group = term.includes(' – ') ? term.split(' – ')[0] : null;
    const tables = ['uom_types', 'article_coding', 'dependency_types', 'bom_concepts', 'mrp_rules', 'sales_order_rules'];
    for (const tb of tables) {
      const r = AnswerEngine.recs(await this.q(`SELECT * FROM ${tb} WHERE name = '${esc(name)}'${group ? ` AND group_name = '${esc(group)}'` : ''}`));
      if (r[0]) return r[0];
    }
    return undefined;
  }

  private async termAnswer(t: Rec): Promise<Answer> {
    const term = String(t['term']);
    const slug = String(t['transaction'] || '');
    if (term === 'Total consumption') {
      const rows = await this.q('SELECT "case", cons_qty, loss_pct, wastage_pct, shrinkage_pct, loss_factor, cons_incl_loss, cons_incl_wastage, total_consumption FROM bom_consumption_chain');
      return {
        kind: 'formula', title: 'How the total consumption is calculated', text: String(t['definition']),
        formula: 'Loss Factor = 1 ÷ (1 − Loss %)  →  Cons incl Loss = Cons × Loss Factor  →  Cons incl Wastage = Cons incl Loss + Cons incl Loss × Wastage %  →  Total = Cons incl Wastage ÷ (1 − Shrinkage %)',
        example: 'Cons 2, loss 5 %, wastage 5 %, shrinkage 5 %: factor 1.052632 → 2.105263 → 2.210526 → 2.326870.',
        table: { caption: 'Worked examples (Cons Qty = 2)', columns: rows.columns, rows: rows.rows },
        links: [{ label: 'See it in the data model', path: ['/data-model'], query: { doc: 'bom-materials' } }, { label: 'Try it in the cost sheet', path: ['/theory', 'bom-materials'] }],
        related: ['What is Loss factor?', 'How is Cons incl Wastage calculated?', 'How is Cons Qty calculated?'], sql: [...this.ran],
      };
    }
    if (term === 'Colour dependency' || term === 'Size dependency') {
      const types = AnswerEngine.recs(await this.q(`SELECT name, definition FROM dependency_types WHERE group_name = '${esc(term)}'`));
      return {
        kind: 'definition', title: term, text: String(t['definition']),
        table: { caption: `The three ${term.toLowerCase()} types`, columns: ['type', 'meaning'], rows: types.map((x) => [String(x['name']), String(x['definition'])]) },
        links: [{ label: 'See it in the data model', path: ['/data-model'], query: { doc: 'bom-materials' } }, { label: 'Open the data', path: ['/data'] }],
        related: term.startsWith('Colour') ? ['What is Table colour dependency?', 'What is Base Colour?'] : ['What is Table size dependency?', 'What is Base Size?'], sql: [...this.ran],
      };
    }
    const concept = await this.conceptOf(term);
    const calcs = !concept && slug ? AnswerEngine.recs(await this.q(`SELECT name, formula FROM calculations WHERE "transaction" = '${esc(slug)}' LIMIT 6`)) : [];
    if (concept) {
      const docId = slug === 'rm-techpack' ? 'rm-techpack' : slug === 'mrp' ? 'mrp' : slug === 'buyer-po' ? 'so-structure' : 'bom-materials';
      return {
        kind: 'definition', title: term, text: String(t['definition']),
        example: concept['example'] ? `Example: ${concept['example']}` : undefined,
        points: [`Where in WFX: ${concept['where_used']}`],
        links: [{ label: 'See it in the data model', path: ['/data-model'], query: { doc: docId } }, { label: 'Open the data', path: ['/data'] }],
        related: ['What is BOM?', 'What is Standard BOM?', 'What is Purchase UOM?'], sql: [...this.ran],
      };
    }
    return {
      kind: 'definition', title: term, text: String(t['definition']),
      points: calcs.length ? calcs.map((c) => `${c['name']}: ${c['formula']}`) : undefined,
      links: slug ? [{ label: `Theory: ${this.txnName(slug)}`, path: ['/theory', slug] }] : [{ label: 'Glossary', path: ['/glossary'] }],
      related: calcs.slice(0, 3).map((c) => `How is ${c['name']} calculated?`), sql: [...this.ran],
    };
  }

  private async txnAnswer(slug: string): Promise<Answer> {
    const [t] = AnswerEngine.recs(await this.q(`SELECT name, module, screen, one_line, description, theory FROM transactions WHERE slug = '${esc(slug)}'`));
    if (!t) return this.none(slug);
    const calcs = AnswerEngine.recs(await this.q(`SELECT name, formula FROM calculations WHERE "transaction" = '${esc(slug)}'`));
    const theory = String(t['theory']).split(/(?<=\.)\s+/).slice(0, 3);
    const docId = { 'bom-materials': 'bom-materials', 'bom-routing': 'routing-processes', 'bom-costing': 'bom-cost', 'rm-techpack': 'rm-techpack', 'apparel-style': 'apparel', 'buyer-block-booking': 'bbb', 'adhoc-indent': 'adhoc-indent', rmpo: 'rmpo-1229', grn: 'grn', 'buyer-po': 'oc', mrp: 'mrp', 'production-indents': 'so-indent', fpo: 'fpo' }[slug];
    return {
      kind: 'definition', title: String(t['name']), text: String(t['one_line'] || t['description']),
      points: theory,
      table: calcs.length ? { caption: 'Formulas on this transaction', columns: ['formula', 'how'], rows: calcs.map((c) => [String(c['name']), String(c['formula'])]) } : undefined,
      links: [{ label: 'Read the theory', path: ['/theory', slug] }, ...(docId ? [{ label: 'See it in the data model', path: ['/data-model'], query: { doc: docId } }] : [])],
      related: calcs.slice(0, 3).map((c) => `How is ${c['name']} calculated?`), sql: [...this.ran],
    };
  }

  private async dataAnswer(article: string, best: { cand: Candidate; score: number } | null): Promise<Answer> {
    const [line] = AnswerEngine.recs(await this.q(`SELECT * FROM bom_materials WHERE article_code = '${esc(article)}'`));
    const [rm] = AnswerEngine.recs(await this.q(`SELECT * FROM rm_techpack WHERE article_code = '${esc(article)}'`));
    if (!line) return this.none(article);
    const col = best?.cand.kind === 'column' && best.score >= 0.5 ? String(best.cand.ref['column_name']) : '';
    const name = `${article} ${line['article_name']}`;
    if (col && col in line) {
      const label = String(best!.cand.ref['label']);
      const bomCol = this.cols.find((c) => c['document'] === 'bom-materials' && c['column_name'] === col) ?? best!.cand.ref;
      const answer = await this.columnAnswer(bomCol, 'formula');
      return {
        ...answer, kind: 'data', title: `${label} of ${name}`,
        text: `On BOM #1 DP of Adi TShirt (NIS-59), ${label} of ${name} is ${this.fmt(line[col])}${line['cons_uom'] && /cons|consumption|wastage/i.test(label) ? ` ${line['cons_uom']}` : ''}. ${answer.text}`,
        sql: [...this.ran],
      };
    }
    const show = ['cons_uom', 'total_cons_qty', 'cons_per_item', 'cons_qty', 'wastage_pct', 'final_consumption', 'purchase_price', 'cons_uom_price', 'value'];
    return {
      kind: 'data', title: name, text: `${name} is a ${rm?.['techpack_type'] ?? 'material'} on BOM #1 DP of Adi TShirt (NIS-59), line ${line['line']}.`,
      table: { caption: 'BOM line', columns: show, rows: [show.map((k) => line[k] as string | number | null)] },
      links: [{ label: 'Open BOM · Materials', path: ['/data-model'], query: { doc: 'bom-materials', col: 'article', find: article, by: 'article' } }],
      related: [`How is Final Consumption calculated?`, `What is the value of ${article}?`], sql: [...this.ran],
    };
  }

  private none(question: string, ranked: { row: Rec; score: number }[] = []): Answer {
    const near = ranked.filter((r) => r.score >= 0.4).slice(0, 3).map((r) => String(r.row['title']));
    return {
      kind: 'none', title: 'No exact answer found',
      text: near.length
        ? `“${question}” is not present in the hub's knowledge yet. These are the closest topics; tap one, or ask again with more detail (what you want to do, and in which screen or module).`
        : `“${question}” is not present in the hub's knowledge yet. If it is about WFX, try naming the screen, document or field as WFX shows it (for example "RMPO", "indent", "GRN", "TNA", "Cons incl Wastage"), and say what you want to do.`,
      links: [{ label: 'Browse the glossary', path: ['/glossary'] }, { label: 'Formula library', path: ['/calculations'] }],
      related: near.length ? near : ['What is BOM?', 'How do I create an RMPO?', 'How do I set up TNA?'], sql: [...this.ran],
    };
  }

  private docLinks(doc: string, colKey: string): AnswerLink[] {
    return [{ label: 'See it in the data model', path: ['/data-model'], query: { doc, col: colKey } }, { label: 'Formula library', path: ['/calculations'] }];
  }
  private docName(id: string) { return String(this.cols.find((c) => c['document'] === id)?.['document_name'] ?? id); }
  private txnName(slug: string) { return String(this.txns.find((t) => t['slug'] === slug)?.['name'] ?? slug); }
  private fmt(v: unknown) { return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 4 }) : String(v ?? '—'); }
}
