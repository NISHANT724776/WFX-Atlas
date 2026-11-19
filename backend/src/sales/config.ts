// Screen configuration for Sales Order (Sprint-01 §1–2, Sprint-3 "Additional Fields"):
//  • SLC (company level): per field and list type (New / List) — visible, mandatory, editable, position. "Always"
//    fields cannot be hidden. Mandatory and Editable apply to the New screen only (Sprint-3 correction).
//  • Views (View Configurator): personal/department layouts inside the SLC. A "New" view is mapped to one or more
//    buyers (a buyer may be in one New view only); users are permitted per view; a List view is one per user.
//  • Resolution on Add New Order: the buyer's view if the user is permitted, otherwise the Default (the SLC).
//  • Additional Fields (renamed from Flex Fields): Alphanumeric, Dropdown (single/multi), Date, Numeric Box, Text Box,
//    with validation None / Alphanumeric / Numeric.
import { all, get, run, tx } from '../db.ts';
import { nowIso } from '../util.ts';

export type ListType = 'New' | 'List';
export interface FieldRow { key: string; label: string; level: string; section: string; visibility: string; type: string; lookup: string | null; multi: number; options: string; validation: string; system: number; seq: number; source: string }
export interface SlcRow { field: string; visible: number; mandatory: number; editable: number; position: number }
export interface ViewField { field: string; visible: boolean; mandatory?: boolean; editable?: boolean; position: number }
export interface View { id: number; name: string; listType: ListType; buyers: string[]; fields: ViewField[]; listScope: string; users: number[] }
export interface LayoutField { key: string; label: string; level: string; section: string; type: string; lookup: string | null; multi: boolean; options: string[]; validation: string; mandatory: boolean; editable: boolean; position: number; always: boolean }

const bad = (msg: string): never => { throw Object.assign(new Error(msg), { status: 400 }); };
export const fields = () => all<FieldRow>('SELECT * FROM so_fields ORDER BY seq');
const fieldMap = () => new Map(fields().map((f) => [f.key, f]));

export function getSlc(lt: ListType): (SlcRow & FieldRow)[] {
  return all<SlcRow & FieldRow>('SELECT s.*, f.* FROM so_slc s JOIN so_fields f ON f.key = s.field WHERE s.list_type = ? ORDER BY s.position', lt);
}

export function saveSlc(lt: ListType, rows: SlcRow[], user: string): void {
  const fm = fieldMap();
  tx(() => {
    rows.forEach((r, i) => {
      const f = fm.get(r.field) ?? bad(`Unknown field ${r.field}.`);
      const visible = f.visibility === 'Always' ? 1 : r.visible ? 1 : 0;
      // mandatory/editable are New-screen properties; a hidden field cannot be mandatory
      const mandatory = lt === 'New' && visible && r.mandatory ? 1 : 0;
      const editable = lt === 'New' ? (r.editable ? 1 : 0) : 1;
      run(`INSERT INTO so_slc (list_type, field, visible, mandatory, editable, position) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(list_type, field) DO UPDATE SET visible = excluded.visible, mandatory = excluded.mandatory, editable = excluded.editable, position = excluded.position`,
        lt, r.field, visible, mandatory, editable, i + 1);
    });
    run("INSERT INTO so_settings (key, value) VALUES ('slc_updated', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", `${user} ${nowIso()}`);
  });
}

const ADD_TYPES: Record<string, string> = { Alphanumeric: 'alphanumeric', Dropdown: 'dropdown', Date: 'date', 'Numeric Box': 'numeric', 'Text Box': 'text' };
export function addAdditionalField(input: { label: string; fieldType: string; multi?: boolean; options?: string[]; validation?: string }): FieldRow {
  const label = input.label.trim();
  if (label.length < 2) bad('Enter the field name.');
  const type = ADD_TYPES[input.fieldType] ?? bad('Choose a field type: Alphanumeric, Dropdown, Date, Numeric Box or Text Box.');
  const validation = ['None', 'Alphanumeric', 'Numeric'].includes(input.validation ?? 'None') ? input.validation ?? 'None' : bad('Validation type must be None, Alphanumeric or Numeric.');
  const options = (input.options ?? []).map((o) => o.trim()).filter(Boolean);
  if (type === 'dropdown' && !options.length) bad('A dropdown needs at least one option.');
  const key = `af_${label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
  if (get('SELECT 1 FROM so_fields WHERE key = ? OR lower(label) = lower(?)', key, label)) bad('A field with this name already exists.');
  const seq = Number(get<{ n: number }>('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM so_fields')?.n ?? 1);
  tx(() => {
    run(`INSERT INTO so_fields (key, label, level, section, visibility, type, multi, options, validation, system, seq, source) VALUES (?, ?, 'Additional', 'Additional Fields', 'Optional', ?, ?, ?, ?, 0, ?, 'Added in the SLC (Additional Fields)')`,
      key, label, type, input.multi ? 1 : 0, JSON.stringify(options), validation, seq);
    for (const lt of ['New', 'List']) run('INSERT INTO so_slc (list_type, field, visible, mandatory, editable, position) VALUES (?, ?, 0, 0, 1, ?)', lt, key, seq);
  });
  return get<FieldRow>('SELECT * FROM so_fields WHERE key = ?', key)!;
}

export function deleteAdditionalField(key: string): void {
  const f = get<FieldRow>('SELECT * FROM so_fields WHERE key = ?', key) ?? bad('Unknown field.');
  if (f.system) bad('System fields cannot be deleted; hide them instead.');
  tx(() => { run('DELETE FROM so_slc WHERE field = ?', key); run('DELETE FROM so_fields WHERE key = ?', key); });
}

const toView = (r: Record<string, unknown>): View => ({
  id: Number(r['id']), name: String(r['name']), listType: r['list_type'] as ListType, buyers: JSON.parse(String(r['buyers'])) as string[],
  fields: JSON.parse(String(r['fields'])) as ViewField[], listScope: String(r['list_scope']),
  users: all<{ user_id: number }>('SELECT user_id FROM so_view_permissions WHERE view_id = ?', r['id']).map((x) => x.user_id),
});
export const listViews = () => all<Record<string, unknown>>('SELECT * FROM so_views ORDER BY list_type, name').map(toView);
export const getView = (id: number) => { const r = get<Record<string, unknown>>('SELECT * FROM so_views WHERE id = ?', id); return r ? toView(r) : null; };

export function saveView(input: { id?: number; name: string; listType: ListType; buyers?: string[]; fields: ViewField[]; listScope?: string }, user: string): View {
  const name = input.name.trim() || bad('Enter the view name.');
  const lt = input.listType === 'List' ? 'List' : input.listType === 'New' ? 'New' : bad('List type must be New or List.');
  const buyers = lt === 'New' ? [...new Set(input.buyers ?? [])] : [];
  if (lt === 'New' && !buyers.length) bad('A Sales Order New view needs at least one buyer.');
  for (const b of buyers) {
    if (!get('SELECT 1 FROM so_buyers WHERE code = ?', b)) bad(`Unknown buyer ${b}.`);
    const other = all<{ id: number; name: string; buyers: string }>("SELECT id, name, buyers FROM so_views WHERE list_type = 'New' AND id <> ?", input.id ?? 0)
      .find((v) => (JSON.parse(v.buyers) as string[]).includes(b));
    if (other) bad(`Buyer ${b} already has the view "${other.name}"; a buyer can have one New view only.`);
  }
  // a view works inside the SLC: only fields the SLC shows can be shown, and SLC-mandatory stays mandatory
  const slc = new Map(getSlc(lt).map((s) => [s.field, s]));
  const vf = input.fields.filter((f) => slc.has(f.field)).map((f, i) => ({ field: f.field, visible: !!f.visible && !!slc.get(f.field)!.visible, mandatory: lt === 'New' ? !!f.mandatory : undefined, editable: lt === 'New' ? f.editable !== false : undefined, position: i + 1 }));
  const scope = lt === 'List' && ['all', 'created', 'created-and-buyer'].includes(input.listScope ?? '') ? input.listScope! : 'all';
  const now = nowIso();
  let id = input.id ?? 0;
  if (id) {
    if (!get('SELECT 1 FROM so_views WHERE id = ?', id)) bad('Unknown view.');
    run('UPDATE so_views SET name = ?, list_type = ?, buyers = ?, fields = ?, list_scope = ?, updated_at = ? WHERE id = ?', name, lt, JSON.stringify(buyers), JSON.stringify(vf), scope, now, id);
  } else {
    id = run('INSERT INTO so_views (name, list_type, buyers, fields, list_scope, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', name, lt, JSON.stringify(buyers), JSON.stringify(vf), scope, user, now, now).lastId;
  }
  return getView(id)!;
}

export function deleteView(id: number): void { run('DELETE FROM so_views WHERE id = ?', id); }

/** Who may use a view. Sales Order New: several views per user (checkboxes). Sales Order List: one view per user (radio). */
export function setViewUsers(id: number, users: number[]): View {
  const v = getView(id) ?? bad('Unknown view.');
  tx(() => {
    run('DELETE FROM so_view_permissions WHERE view_id = ?', id);
    for (const u of [...new Set(users)]) {
      if (v.listType === 'List') run("DELETE FROM so_view_permissions WHERE user_id = ? AND view_id IN (SELECT id FROM so_views WHERE list_type = 'List')", u);
      run('INSERT INTO so_view_permissions (view_id, user_id) VALUES (?, ?)', id, u);
    }
  });
  return getView(id)!;
}

/** The layout a user gets: for New, the selected buyer's view when the user is permitted, else the Default (SLC). */
export function resolveLayout(lt: ListType, userId: number, buyer?: string): { view: { id: number; name: string } | null; reason: string; fields: LayoutField[] } {
  const slc = getSlc(lt);
  const permitted = (v: View) => v.users.includes(userId);
  let view: View | null = null;
  let reason = 'Default view (SLC): no view applies.';
  if (lt === 'New' && buyer) {
    const v = listViews().find((x) => x.listType === 'New' && x.buyers.includes(buyer)) ?? null;
    if (v && permitted(v)) { view = v; reason = `View "${v.name}" is mapped to this buyer and you are permitted.`; }
    else if (v) reason = `View "${v.name}" is mapped to this buyer, but you are not permitted: Default view (SLC).`;
    else reason = 'No view is mapped to this buyer: Default view (SLC).';
  }
  if (lt === 'List') {
    const v = listViews().find((x) => x.listType === 'List' && permitted(x)) ?? null;
    if (v) { view = v; reason = `List view "${v.name}".`; }
  }
  const over = new Map((view?.fields ?? []).map((f) => [f.field, f]));
  const out: LayoutField[] = [];
  for (const s of slc) {
    const always = s.visibility === 'Always';
    const o = over.get(s.field);
    const visible = always || (!!s.visible && (view ? !!o?.visible : true));
    if (!visible) continue;
    out.push({
      key: s.key, label: s.label, level: s.level, section: s.section, type: s.type, lookup: s.lookup, multi: !!s.multi, options: JSON.parse(s.options) as string[], validation: s.validation,
      mandatory: lt === 'New' && (!!s.mandatory || !!o?.mandatory), editable: lt === 'New' ? (o?.editable ?? !!s.editable) : true, position: o?.position ?? 1000 + s.position, always,
    });
  }
  out.sort((a, b) => a.position - b.position);
  return { view: view ? { id: view.id, name: view.name } : null, reason, fields: out };
}

/** Field value check against its type and validation (used when a header or delivery is saved). */
export function validateValue(f: LayoutField, v: unknown): string | null {
  const s = Array.isArray(v) ? v.join(',') : v === null || v === undefined ? '' : String(v).trim();
  if (!s) return f.mandatory ? `${f.label} is mandatory.` : null;
  if (f.type === 'numeric' || f.validation === 'Numeric') { if (!/^-?\d+(\.\d+)?$/.test(s)) return `${f.label} must be a number.`; }
  if (f.type === 'alphanumeric' || f.validation === 'Alphanumeric') { if (!/^[A-Za-z0-9 ,]+$/.test(s)) return `${f.label} accepts letters and numbers only.`; }
  if (f.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${f.label} must be a date (YYYY-MM-DD).`;
  if (f.type === 'dropdown') { const vals = Array.isArray(v) ? (v as string[]) : [s]; if (!f.multi && vals.length > 1) return `${f.label} takes one value.`; if (vals.some((x) => !f.options.includes(x))) return `${f.label}: choose from the list.`; }
  return null;
}
