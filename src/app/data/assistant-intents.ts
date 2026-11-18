// Commands the assistant carries out itself, with or without AI: "make a workflow from techpack to production order",
// "show the data model of MRP", "open the theory of GRN". Everything else goes to the answer engine.
import type { Answer } from './answer';
import { REQUIRES, STEPS, pathBetween, stepById } from './journey';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9→ ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Longest phrases first; each match is blanked so a shorter phrase does not match inside it. */
const STEP_WORDS: [RegExp, string[]][] = [
  [/adhoc indents?|indent requirement/, ['gen-indent', 'adhoc']],
  [/manufactur\w* indents?/, ['mfg-indent']],
  [/link\w* (the )?(buyer )?block booking/, ['link']],
  [/(sales order|so|production) indents?|indents?/, ['so-indent']],
  [/block booking|bbb|booking/, ['bbb-create', 'bbb-save']],
  [/sales orders?|buyer po|order confirmation|buyer orders?|\boc\b/, ['oc']],
  [/\bmrp\b|material requirement/, ['mrp']],
  [/factory production orders?|\bfpo\b/, ['fpo']],
  [/fppo|process orders?/, ['fppo']],
  [/production orders?|prod orders?/, ['prod-order']],
  [/(raw )?material techpacks?|fabric techpacks?|trims? techpacks?/, ['rm']],
  [/(apparel |style |article )?techpacks?/, ['style']],
  [/approve (the )?bom|bom approval/, ['approve']],
  [/cost sheet|costing|bom cost/, ['costing']],
  [/routing|operations/, ['routing']],
  [/\bbom\b|bill of materials/, ['bom']],
  [/\bgrn\b|goods receipt/, ['grn']],
  [/\basn\b/, ['asn']],
  [/purchase orders?|\brmpo\b|\bpos?\b/, ['po']],
  [/adjust\w*/, ['adjust']],
  [/masters?/, ['masters']],
];

interface Mention { id: string; at: number; }

function mentions(text: string): Mention[] {
  let t = ` ${norm(text)} `;
  const out: Mention[] = [];
  for (const [re, ids] of STEP_WORDS) {
    const g = new RegExp(re.source, 'g');
    let m: RegExpExecArray | null;
    while ((m = g.exec(t))) {
      ids.forEach((id) => out.push({ id, at: m!.index }));
      t = t.slice(0, m.index) + ' '.repeat(m[0].length) + t.slice(m.index + m[0].length);
      g.lastIndex = m.index + m[0].length;
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

const uniq = <T>(a: T[]) => [...new Set(a)];

/** A workflow built from the words of the question, or null when it is not a workflow request. */
export function workflowAnswer(question: string): Answer | null {
  const n = norm(question);
  const asks = /\b(workflow|work flow|flow|process|sequence|chain|steps?)\b/.test(n) && /\b(make|build|create|show|give|draw|plan|design|need|want|prepare|map|run)\b/.test(n);
  const fromTo = /\bfrom (.+?) to (.+)/.exec(n);
  if (!asks && !(fromTo && /\b(workflow|flow|process|steps?)\b/.test(n))) return null;

  const split = /\b(without|skip|skipping|excluding|except|leave out|no)\b/.exec(n);
  const main = split ? n.slice(0, split.index) : n;
  const dropped = new Set(split ? mentions(n.slice(split.index)).map((m) => m.id) : []);
  // leaving out block booking also leaves out everything that only exists because of it
  if (dropped.has('bbb-create')) for (const s of STEPS) if (s.phase === 'B' || s.phase === 'C' || ['link', 'adjust', 'so-updated'].includes(s.id)) dropped.add(s.id);
  const everything = /\b(end to end|complete|full|whole|entire)\b/.test(main);

  let ids: string[];
  let query: Record<string, string>;
  if (fromTo && !everything) {
    const a = mentions(fromTo[1]), b = mentions(fromTo[2].split(/\b(without|skip|skipping|excluding|except|no)\b/)[0]);
    if (!a.length || !b.length) return null;
    ids = pathBetween(a[0].id, b[b.length - 1].id).map((s) => s.id).filter((id) => !dropped.has(id));
    query = dropped.size ? { steps: ids.join(',') } : { from: pathBetween(a[0].id, b[b.length - 1].id)[0].id, to: pathBetween(a[0].id, b[b.length - 1].id).at(-1)!.id };
  } else {
    const found = uniq(mentions(main).map((m) => m.id));
    ids = everything ? STEPS.map((s) => s.id).filter((id) => !dropped.has(id)) : found.filter((id) => !dropped.has(id));
    if (ids.length < 2) return null;
    if (/\bpo\b/.test(n) === false && ids.includes('po') === false) { /* nothing to adjust */ }
    // a purchase order next to a sales order indent and no booking is the "PO for the gap"
    if (ids.includes('po') && !ids.includes('adhoc') && (ids.includes('so-indent') || ids.includes('oc'))) ids = ids.map((id) => (id === 'po' ? 'rmpo-gap' : id));
    query = { steps: ids.join(',') };
  }
  const ordered = STEPS.filter((s) => ids.includes(s.id));
  if (!ordered.length) return null;

  const chain = ordered.map((s, i) => ({ title: s.title, gap: i > 0 ? STEPS.indexOf(s) - STEPS.indexOf(ordered[i - 1]) - 1 : 0 }));
  const have = new Set(ordered.map((s) => s.id));
  const hints = ordered.flatMap((s) => {
    const miss = (REQUIRES[s.id] ?? []).filter((r) => !have.has(r));
    return miss.length ? [`“${s.title}” normally follows “${miss.map((m) => stepById(m)?.title).join('” and “')}”, which is not in this workflow.`] : [];
  });
  const skipped = chain.reduce((a, c) => a + c.gap, 0);
  const first = ordered[0].title, last = ordered[ordered.length - 1].title;
  return {
    kind: 'workflow',
    title: `Workflow: ${first} → ${last}`,
    text: `I built a workflow of ${ordered.length} step${ordered.length === 1 ? '' : 's'}${skipped ? `, leaving out ${skipped} step${skipped === 1 ? '' : 's'} in between` : ''}. Open it to read it as a blueprint or play it as a storyboard, and add or remove steps there.`,
    chain,
    points: [...ordered.slice(0, 12).map((s, i) => `${i + 1}. ${s.title} (${s.actor === 'user' ? 'user' : 'system'})`), ...(ordered.length > 12 ? [`… and ${ordered.length - 12} more steps`] : []), ...hints],
    links: [{ label: 'Open this workflow', path: ['/workflows'], query }],
    related: ['How is Cons incl Wastage calculated?', 'What is MRP adjustment?', 'Make a workflow from techpack to production order'],
    sql: [],
  };
}

// ── "show / open" navigation ─────────────────────────────────────────────
const TOPICS: { re: RegExp; name: string; doc?: string; theory?: string }[] = [
  { re: /article code|system coding/, name: 'Article coding', doc: 'article-coding', theory: 'rm-techpack' },
  { re: /uom/, name: 'UOM types', doc: 'uom-types', theory: 'rm-techpack' },
  { re: /dependenc/, name: 'Colour & size dependency', doc: 'dependency-types', theory: 'bom-materials' },
  { re: /routing/, name: 'BOM · Routing', doc: 'routing-processes', theory: 'bom-routing' },
  { re: /cost sheet|costing/, name: 'BOM · Cost', doc: 'bom-cost', theory: 'bom-costing' },
  { re: /\bbom\b/, name: 'BOM · Materials', doc: 'bom-materials', theory: 'bom-materials' },
  { re: /block booking|\bbbb?\b/, name: 'Buyer Block Booking', doc: 'bbb', theory: 'buyer-block-booking' },
  { re: /adhoc/, name: 'Adhoc Indent', doc: 'adhoc-indent', theory: 'adhoc-indent' },
  { re: /\bgrn\b/, name: 'GRN', doc: 'grn', theory: 'grn' },
  { re: /rmpo|purchase order/, name: 'RMPO', doc: 'rmpo-1229', theory: 'rmpo' },
  { re: /\bmrp\b/, name: 'MRP', doc: 'mrp', theory: 'mrp' },
  { re: /(sales|production) order indent|\bindents?\b/, name: 'Sales Order Indent', doc: 'so-indent', theory: 'production-indents' },
  { re: /\bfpo\b|factory production/, name: 'FPO', doc: 'fpo', theory: 'fpo' },
  { re: /delivery|split|shuffle|cancel|close|reopen/, name: 'Sales Order · Delivery & order actions', doc: 'so-actions', theory: 'buyer-po' },
  { re: /approval/, name: 'Sales Order · Approval', doc: 'so-approval', theory: 'buyer-po' },
  { re: /desync|upcharge|sub total/, name: 'Sales Order · Price, desync & sub total', doc: 'so-pricing', theory: 'buyer-po' },
  { re: /packing|prepack/, name: 'Sales Order · Packing & pieces', doc: 'so-packing', theory: 'buyer-po' },
  { re: /sales order|\boc\b|buyer po/, name: 'Sales Order', doc: 'so-structure', theory: 'buyer-po' },
  { re: /techpack|apparel/, name: 'Apparel techpack', doc: 'apparel', theory: 'apparel-style' },
];

export function navigationAnswer(question: string): Answer | null {
  const n = norm(question);
  if (!/\b(show|open|take me|go to|see|display|where can i)\b/.test(n)) return null;
  const wantsModel = /data ?model|tables?|screens?|columns?/.test(n);
  const wantsTheory = /theory|explanation|read about/.test(n);
  const wantsFormula = /formulas?|calculations?/.test(n);
  const wantsData = /\bsql\b|csv|data files?/.test(n);
  if (!wantsModel && !wantsTheory && !wantsFormula && !wantsData) return null;
  const topic = TOPICS.find((t) => t.re.test(n));
  const links: Answer['links'] = [];
  if (wantsModel && topic?.doc) links.push({ label: `Data model: ${topic.name}`, path: ['/data-model'], query: { doc: topic.doc } });
  if (wantsTheory && topic?.theory) links.push({ label: `Theory: ${topic.name}`, path: ['/theory', topic.theory] });
  if (wantsFormula) links.push({ label: 'Formula library', path: ['/calculations'] });
  if (wantsData) links.push({ label: 'Data and SQL', path: ['/data'] });
  if (!links.length && topic) {
    if (topic.doc) links.push({ label: `Data model: ${topic.name}`, path: ['/data-model'], query: { doc: topic.doc } });
    if (topic.theory) links.push({ label: `Theory: ${topic.name}`, path: ['/theory', topic.theory] });
  }
  if (!links.length) return null;
  return {
    kind: 'definition', title: topic ? `Open: ${topic.name}` : 'Open the page', text: 'Here are the pages you asked for.',
    links, related: topic ? [`What is ${topic.name}?`] : [], sql: [],
  };
}

export function intentAnswer(question: string): Answer | null {
  return workflowAnswer(question) ?? navigationAnswer(question);
}
