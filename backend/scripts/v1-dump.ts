// Reads the v1 Knowledge Hub data exactly as the site uses it and returns plain JSON. Bundled by migrate-v1.mjs with
// esbuild (the site's data files use extension-less imports). Dynamic step texts are evaluated with the default
// simulator scenario, which is what the v1 pages show by default.
import { MODULES } from '../../src/app/data/modules';
import { MANUALS, MANUAL_TABLES } from '../../src/app/data/manuals';
import { SO_ACTIONS, SO_CONCEPTS } from '../../src/app/data/salesorder';
import { ARTICLE_CODE_RULES, ARTICLE_CODE_SECTIONS, ARTICLE_CODING, BOM_CONCEPTS, DEPENDENCY_TYPES, MRP_CONCEPTS, UOM_TYPES } from '../../src/app/data/concepts';
import { CALCULATIONS } from '../../src/app/data/calculations';
import { GLOSSARY } from '../../src/app/data/glossary';
import { TRANSACTIONS } from '../../src/app/data/transactions';
import { CHAPTERS, DOCS } from '../../src/app/data/docs';
import { PHASES, REQUIRES, SCENARIOS, STEPS, STEP_GROUPS, pathBetween, val } from '../../src/app/data/journey';
import { DEFAULT_SIM, simulate } from '../../src/app/data/sim';
import { INDENT_COMPARISON, THEORY_SUMMARY } from '../../src/app/data/theory-extras';
import { FLOW_INDEX, TXN_INDEX } from '../../src/app/data/catalog';

export function dump() {
  const r = simulate(DEFAULT_SIM);
  const text = (v: unknown) => (typeof v === 'function' ? String((v as (x: unknown) => unknown)(r)) : String(v ?? ''));
  const steps = STEPS.map((s) => ({
    id: s.id, phase: s.phase, actor: s.actor, title: s.title, theory: s.theory, doc: s.doc,
    short: text(s.short), points: s.points.map(text),
    facts: (s.facts ?? []).map((f) => ({ label: f.label, value: text(f.value) })),
    formula: s.formula ?? null, keyPoint: s.keyPoint ?? '', needs: s.needs ?? '', scenario: !!s.scenario,
  }));
  const docs = DOCS.map((d) => ({
    id: d.id, chapter: d.chapter, name: d.name, screen: d.screen, summary: d.summary, theory: d.theory ?? '',
    header: d.header.map((h) => ({ label: h.label, type: h.type, from: h.from ?? null })),
    grids: d.grids.map((g) => ({
      id: g.id, title: g.title, group: g.group ?? '', rows: g.rows.length,
      cols: g.cols.map((c) => ({ key: c.key, label: c.label, type: c.type, formula: c.formula ?? '', calc: c.calc ?? '', from: c.from ?? null, uses: c.uses ?? [], note: c.note ?? '' })),
    })),
    shots: (d.shots ?? []).map((s) => s.src),
  }));
  const flows = FLOW_INDEX.map((f) => ({ ...f, steps: pathBetween(f.from, f.to).map((s) => s.id) }));
  return {
    modules: MODULES, manuals: MANUALS, manualTables: MANUAL_TABLES, soConcepts: SO_CONCEPTS, soActions: SO_ACTIONS,
    concepts: { DEPENDENCY_TYPES, UOM_TYPES, BOM_CONCEPTS, ARTICLE_CODING, MRP_CONCEPTS },
    articleCodeRules: ARTICLE_CODE_RULES, articleCodeSections: ARTICLE_CODE_SECTIONS,
    calculations: CALCULATIONS, glossary: GLOSSARY,
    transactions: TRANSACTIONS.map((t) => ({ ...t, tables: t.tables.map((x) => ({ title: x.title, columns: x.columns, rows: x.rows.length, note: x.note ?? '' })) })),
    chapters: CHAPTERS, docs, phases: PHASES, steps, requires: REQUIRES, stepGroups: STEP_GROUPS, scenarios: SCENARIOS,
    theorySummary: THEORY_SUMMARY, indentComparison: INDENT_COMPARISON, txnIndex: TXN_INDEX, flows,
  };
}
