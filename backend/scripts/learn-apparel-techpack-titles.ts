// Follow-up of learn-apparel-techpack.ts: titles that contain the words people use ("color wise", "sewing").
import { indexLibrary } from '../src/index/indexer.ts';
import { getEntry } from '../src/knowledge/repo.ts';
import { makeEntry } from '../src/knowledge/txt.ts';
import type { EntryType } from '../src/knowledge/txt.ts';
import { saveDraft, transition } from '../src/rules/rules.ts';
indexLibrary();
const WHO = 'owner-explanation', WHY = 'Titles use the words the owner and users use (DOC-0181)';
const retitle = (id: string, key: string, title: string) => {
  const cur = getEntry(id)!;
  const f = { ...cur.fields, [key]: title };
  const r = saveDraft(makeEntry(cur.type as EntryType, id, f, cur.order), WHO, 'admin', WHY);
  transition(id, r.version, 'Active', WHO, 'admin', WHY);
};
retitle('TERM-PRICE-PER-ARTICLE', 'TERM', 'Price Per – Article (article wise)');
retitle('TERM-PRICE-PER-COLOR', 'TERM', 'Price Per – Color (color wise)');
retitle('TERM-PRICE-PER-SIZE', 'TERM', 'Price Per – Size (size wise)');
retitle('TERM-PRICE-PER-COLOR-SIZE', 'TERM', 'Price Per – Color/Size (color/size wise)');
retitle('RULE-BOM-ROUTING-NORMAL-MATERIAL-FLOW', 'RULE NAME', 'Routing: a normal material flow – which materials go to cutting, sewing and packing');
console.log('titles updated');
