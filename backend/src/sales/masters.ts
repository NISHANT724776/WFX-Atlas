// Sales Order masters: loaded from knowledge/sales_order/masters.json and fields.json into their tables (idempotent;
// run at server start and on reindex). The SLC is seeded once from the field catalogue's default visibility; after
// that it belongs to the administrator and a reload never overwrites it.
import fs from 'node:fs';
import path from 'node:path';
import { settings } from '../config.ts';
import { all, get, run, tx } from '../db.ts';

const dir = () => path.join(settings().knowledge, 'sales_order');
const readJson = <T>(name: string, fallback: T): T => { const f = path.join(dir(), name); return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as T) : fallback; };

interface MastersFile {
  categories: { code: string; name: string; source: string }[];
  buyers: { code: string; name: string; category: string; departments: string[]; currency: string; seasons: string[]; source: string }[];
  colours: { code: string; name: string }[];
  sizes: { code: string; name: string }[];
  articles: { code: string; name: string; buyer: string; category: string; inseams: string[]; pricePer: string; basePrice: number | null; uom: string; uomDecimals: number; isKit: boolean; kitName?: string; kitId?: string; buyerStyleRef?: string; source: string }[];
  boms: { id: string; article: string; bomNo: string; version: number; status: string; accepted: boolean; acceptedOn?: string; sellingPrice: number | null; routing: string; source: string }[];
  costSheets: { article: string; destination: string; status: string; sellingPrice: number; revisedOn?: string; source: string }[];
  exFactory: { shipmentMode: string; buyer: string; department: string; days: number; source: string }[];
  lookups: Record<string, string[]>;
  lookupSource: string;
}
export interface FieldDef { key: string; label: string; level: string; section: string; visibility: string; type: string; seq: number; source: string; lookup?: string; multi?: boolean; options?: string[]; validation?: string }

/** Tool names a role may use on the list and order screens (Sprint-3 Tool Permission). Defaults; an admin can change them. */
export const TOOLS = ['create', 'edit', 'confirm', 'revise', 'add-delivery', 'copy-delivery', 'delete-delivery', 'split-delivery', 'cancel-delivery', 'close-delivery', 'reopen-delivery',
  'cancel-order', 'close-order', 'sync-price', 'export', 'approve'] as const;
/** "Always" in the spec means always visible, not mandatory; the seed makes only these mandatory and the admin decides the rest in the SLC. */
const SEED_MANDATORY = ['order_season', 'buyer_delivery_date'];
const DEFAULT_TOOLS: Record<string, readonly string[]> = {
  editor: ['create', 'edit', 'confirm', 'revise', 'add-delivery', 'copy-delivery', 'delete-delivery', 'split-delivery', 'cancel-delivery', 'close-delivery', 'reopen-delivery', 'sync-price', 'export'],
  approver: [...TOOLS], admin: [...TOOLS], viewer: ['export'],
};

export function syncSalesMasters(): { buyers: number; articles: number; fields: number } {
  const m = readJson<MastersFile | null>('masters.json', null);
  const fields = readJson<FieldDef[]>('fields.json', []);
  if (!m) return { buyers: 0, articles: 0, fields: 0 };
  tx(() => {
    for (const c of m.categories) run('INSERT INTO so_categories (code, name, source) VALUES (?, ?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name, source = excluded.source', c.code, c.name, c.source);
    for (const b of m.buyers) run(`INSERT INTO so_buyers (code, name, category, departments, currency, seasons, source) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(code) DO UPDATE SET name = excluded.name, category = excluded.category, departments = excluded.departments, currency = excluded.currency, seasons = excluded.seasons, source = excluded.source`,
      b.code, b.name, b.category, JSON.stringify(b.departments), b.currency, JSON.stringify(b.seasons), b.source);
    for (const a of m.articles) run(`INSERT INTO so_articles (code, name, buyer, category, colours, sizes, inseams, price_per, base_price, uom, uom_decimals, is_kit, kit_name, kit_id, buyer_style_ref, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET name = excluded.name, buyer = excluded.buyer, category = excluded.category, colours = excluded.colours,
      sizes = excluded.sizes, inseams = excluded.inseams, price_per = excluded.price_per, base_price = excluded.base_price, uom = excluded.uom, uom_decimals = excluded.uom_decimals,
      is_kit = excluded.is_kit, kit_name = excluded.kit_name, kit_id = excluded.kit_id, buyer_style_ref = excluded.buyer_style_ref, source = excluded.source`,
      a.code, a.name, a.buyer, a.category, JSON.stringify(m.colours), JSON.stringify(m.sizes), JSON.stringify(a.inseams), a.pricePer, a.basePrice, a.uom, a.uomDecimals, a.isKit ? 1 : 0,
      a.kitName ?? null, a.kitId ?? null, a.buyerStyleRef ?? null, a.source);
    for (const b of m.boms) run(`INSERT INTO so_boms (id, article, bom_no, version, status, accepted, accepted_on, selling_price, routing, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET status = excluded.status, accepted = excluded.accepted, accepted_on = excluded.accepted_on, selling_price = excluded.selling_price, routing = excluded.routing, source = excluded.source`,
      b.id, b.article, b.bomNo, b.version, b.status, b.accepted ? 1 : 0, b.acceptedOn ?? null, b.sellingPrice, b.routing, b.source);
    for (const c of m.costSheets) run(`INSERT INTO so_cost_sheets (article, destination, status, selling_price, revised_on, source) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(article, destination) DO UPDATE SET status = excluded.status, selling_price = excluded.selling_price, revised_on = excluded.revised_on, source = excluded.source`,
      c.article, c.destination, c.status, c.sellingPrice, c.revisedOn ?? null, c.source);
    run('DELETE FROM so_ex_factory');
    for (const x of m.exFactory) run('INSERT INTO so_ex_factory (shipment_mode, buyer, department, days, source) VALUES (?, ?, ?, ?, ?)', x.shipmentMode, x.buyer, x.department, x.days, x.source);
    run('DELETE FROM so_lookups');
    for (const [list, values] of Object.entries(m.lookups)) for (const v of values) run('INSERT OR IGNORE INTO so_lookups (list, value, source) VALUES (?, ?, ?)', list, v, m.lookupSource);
    // field catalogue: system fields from the spec table; Additional Fields added by an admin stay
    for (const f of fields) {
      const visibility = f.key === 'delivery_buyer_order_ref' ? 'Always' : f.visibility; // listed twice in the spec table, once as Always
      run(`INSERT INTO so_fields (key, label, level, section, visibility, type, lookup, system, seq, source) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(key) DO UPDATE SET label = excluded.label, level = excluded.level, section = excluded.section, visibility = excluded.visibility, type = excluded.type, lookup = excluded.lookup, seq = excluded.seq, source = excluded.source`,
        f.key, f.label, f.level, f.section, visibility, f.type, f.lookup ?? null, f.seq, f.source);
    }
    // SLC: seeded once per list type from the catalogue ("Always" fields visible; Optional hidden until an admin shows them)
    for (const lt of ['New', 'List']) {
      if (get('SELECT 1 FROM so_slc WHERE list_type = ? LIMIT 1', lt)) continue;
      for (const f of all<{ key: string; visibility: string; level: string; seq: number }>('SELECT key, visibility, level, seq FROM so_fields ORDER BY seq')) {
        if (lt === 'List' && !['Header', 'Delivery', 'Article'].includes(f.level)) continue;
        run('INSERT INTO so_slc (list_type, field, visible, mandatory, editable, position) VALUES (?, ?, ?, ?, 1, ?)', lt, f.key, f.visibility === 'Always' ? 1 : 0, lt === 'New' && SEED_MANDATORY.includes(f.key) ? 1 : 0, f.seq);
      }
    }
    if (!get('SELECT 1 FROM so_tool_permissions LIMIT 1')) for (const [role, tools] of Object.entries(DEFAULT_TOOLS)) for (const t of tools) run('INSERT INTO so_tool_permissions (role, tool) VALUES (?, ?)', role, t);
    if (!get("SELECT 1 FROM so_settings WHERE key = 'oc_price_validation'")) run("INSERT INTO so_settings (key, value) VALUES ('oc_price_validation', '1')");
    if (!get("SELECT 1 FROM so_settings WHERE key = 'multi_level_approval'")) run("INSERT INTO so_settings (key, value) VALUES ('multi_level_approval', '0')");
  });
  return { buyers: m.buyers.length, articles: m.articles.length, fields: fields.length };
}
