// One-off: states the "indents come in Inactive" rule crisply (owner's words, 2026-11-18): no User Group / Purchase Officer on the BOM →
// indents created from it are Inactive by default; the user must mark them Active by hand before doing anything on them.
import { indexLibrary } from '../src/index/indexer.ts';
import { getEntry } from '../src/knowledge/repo.ts';
import { makeEntry } from '../src/knowledge/txt.ts';
import type { EntryType } from '../src/knowledge/txt.ts';
import { saveDraft, transition } from '../src/rules/rules.ts';
indexLibrary();
const WHO = 'owner-explanation', WHY = 'Owner restated the rule in chat on 2026-11-18: crisp wording, with the cause first';
const cur = getEntry('RULE-SETUP-BOM-INDENT-OWNER')!;
const f = {
  ...cur.fields,
  'RULE NAME': 'Indents are Inactive when the BOM has no User Group and Purchase Officer',
  'BUSINESS PURPOSE': 'Every indent needs an owner (User Group, Purchase Officer); the BOM supplies it, and without it the indent is held Inactive until a user takes it over.',
  'FORMULA / LOGIC': 'If the User Group and Purchase Officer are not set (left blank) on the BOM, the indents created from it come in Inactive status by default. The user must mark them Active manually (User Indent list or Indent list) before MRP or any other action can be done on them.',
};
const r = saveDraft(makeEntry(cur.type as EntryType, cur.id, f, cur.order), WHO, 'admin', WHY);
transition(cur.id, r.version, 'Active', WHO, 'admin', WHY);
const t = getEntry('TERM-USER-GROUP-AND-PURCHASE-OFFICER')!;
const tr = saveDraft(makeEntry(t.type as EntryType, t.id, { ...t.fields, TERM: 'User Group and Purchase Officer (on BOM) – why indents are Inactive', DEFINITION: f['FORMULA / LOGIC'] }, t.order), WHO, 'admin', WHY);
transition(t.id, tr.version, 'Active', WHO, 'admin', WHY);
console.log('rule v' + r.version + ', term v' + tr.version);
