// Sales Order transactions: Main OC → Delivery OC → Article line → quantity breakups (first grid, Add Qty grids,
// Additional Qty) → Colour/Size cells. Rules come from the Sales Order specs (Sprint-01/02/3 V2) as stored in the
// knowledge base; where a spec is ambiguous the choice is listed in documentation/SALES_ORDER.md (open points).
// Every change is written to so_history with who, when, before/after and remarks.
import { all, get, run, tx } from '../db.ts';
import { nowIso } from '../util.ts';
import type { User } from '../auth.ts';
import { resolveLayout, validateValue } from './config.ts';
import type { LayoutField } from './config.ts';

export const bad = (msg: string, status = 400): never => { throw Object.assign(new Error(msg), { status }); };
const J = <T>(s: unknown, d: T): T => { try { return s ? (JSON.parse(String(s)) as T) : d; } catch { return d; } };
const today = () => new Date().toISOString().slice(0, 10);

// ── permissions ─────────────────────────────────────────────────────
export function toolsOf(u: User): string[] { return all<{ tool: string }>('SELECT tool FROM so_tool_permissions WHERE role = ?', u.role).map((r) => r.tool); }
export function need(u: User, tool: string): void { if (!toolsOf(u).includes(tool)) bad(`You do not have the "${tool}" tool permission for Sales Order.`, 403); }

// ── history ─────────────────────────────────────────────────────────
function log(orderId: number, action: string, user: string, o: { delivery?: number | null; ref?: string; before?: unknown; after?: unknown; remarks?: string } = {}): void {
  run('INSERT INTO so_history (order_id, delivery_id, action, ref, before, after, remarks, user, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', orderId, o.delivery ?? null, action, o.ref ?? '',
    o.before === undefined ? null : JSON.stringify(o.before), o.after === undefined ? null : JSON.stringify(o.after), o.remarks ?? '', user, nowIso());
}
export const historyOf = (orderId: number) => all<Record<string, unknown>>('SELECT * FROM so_history WHERE order_id = ? ORDER BY id DESC', orderId)
  .map((h) => ({ ...h, before: J<Record<string, unknown> | null>(h['before'], null), after: J<Record<string, unknown> | null>(h['after'], null) })) as (Record<string, unknown> & { before: Record<string, unknown> | null; after: Record<string, unknown> | null })[];

// ── rows ────────────────────────────────────────────────────────────
interface OrderRow { id: number; so_no: string; category: string; buyer: string; view_id: number | null; status: string; revised: number; header: string; instructions: string; currency: string; approver_id: number | null; approval_level: number; created_by: string; created_by_id: number | null; created_at: string; updated_at: string }
interface DeliveryRow { id: number; order_id: number; delivery_no: string; status: string; buyer_order_ref: string; buyer_delivery_date: string | null; oc_delivery_date: string | null; shipment_mode: string; destination: string; fields: string; remarks: string; split_from: number | null }
interface LineRow { id: number; delivery_id: number; article: string; bom_id: string | null; bom_selected: number; price_source: string; price_per: string; base_price: number; fields: string; extra_production_pct: number; seq: number }
interface BreakupRow { id: number; article_line: number; seq: number; packing_type: string; additional: number; packing_code: string; prepack_code: string; cartons: number | null; inseam: string }
interface QtyRow { breakup_id: number; colour: string; size: string; qty: number; ratio: number | null; pp: number | null; upcharge: number; inseam: string }

const orderRow = (id: number) => get<OrderRow>('SELECT * FROM so_orders WHERE id = ?', id) ?? bad('Sales Order not found.', 404);
const deliveryRow = (id: number) => get<DeliveryRow>('SELECT * FROM so_deliveries WHERE id = ?', id) ?? bad('Delivery not found.', 404);
const lineRow = (id: number) => get<LineRow>('SELECT * FROM so_delivery_articles WHERE id = ?', id) ?? bad('Article line not found.', 404);
const breakupRow = (id: number) => get<BreakupRow>('SELECT * FROM so_breakups WHERE id = ?', id) ?? bad('Quantity breakup not found.', 404);
export const displayStatus = (o: Pick<OrderRow, 'status' | 'revised'>) => (o.revised && o.status === 'Draft' ? 'Confirmed *' : o.status);

/** An order can be edited while Draft or Rejected (a confirmed order is revised first). */
function editableOrder(o: OrderRow): void {
  if (!['Draft', 'Rejected'].includes(o.status)) bad(o.status === 'Confirmed' ? 'The order is confirmed: use Revise to change it.' : `A ${o.status} order cannot be changed.`);
}
function editableDelivery(d: DeliveryRow): void {
  editableOrder(orderRow(d.order_id));
  if (['Cancelled', 'Closed'].includes(d.status)) bad(`Delivery ${d.delivery_no} is ${d.status} and cannot be changed${d.status === 'Closed' ? ' (reopen it first)' : ''}.`);
}
const touch = (orderId: number, user: string) => run('UPDATE so_orders SET updated_at = ?, updated_by = ? WHERE id = ?', nowIso(), user, orderId);

// ── pricing ─────────────────────────────────────────────────────────
/** Price source on a new line (Sprint-2/3): the user's BOM if chosen; else the confirmed cost sheet for the destination
 *  (when OC price validation is on); else the latest accepted, approved BOM; else the tech pack base price. */
export function pickPrice(article: string, destination: string, bomId?: string | null): { price: number; source: string; bom: string | null } {
  const a = get<{ base_price: number | null }>('SELECT base_price FROM so_articles WHERE code = ?', article) ?? bad('Unknown article.');
  const latest = get<{ id: string; selling_price: number | null; bom_no: string }>("SELECT id, selling_price, bom_no FROM so_boms WHERE article = ? AND status = 'Approved' AND accepted = 1 ORDER BY accepted_on DESC, version DESC LIMIT 1", article);
  if (bomId) {
    const b = get<{ id: string; selling_price: number | null; bom_no: string }>("SELECT id, selling_price, bom_no FROM so_boms WHERE id = ? AND article = ? AND status = 'Approved'", bomId, article) ?? bad('Choose an approved BOM of this article.');
    if (b.selling_price !== null) return { price: b.selling_price, source: `BOM ${b.bom_no} (selected)`, bom: b.id };
  }
  const validation = get<{ value: string }>("SELECT value FROM so_settings WHERE key = 'oc_price_validation'")?.value === '1';
  const cs = validation ? get<{ selling_price: number; destination: string }>("SELECT selling_price, destination FROM so_cost_sheets WHERE article = ? AND status = 'Confirmed' AND destination IN (?, '') ORDER BY destination = '' LIMIT 1", article, destination) : undefined;
  if (cs) return { price: cs.selling_price, source: `Cost sheet${cs.destination ? ` (${cs.destination})` : ''}`, bom: latest?.id ?? null };
  if (latest?.selling_price !== null && latest?.selling_price !== undefined) return { price: latest.selling_price, source: `Latest accepted BOM ${latest.bom_no}`, bom: latest.id };
  return { price: a.base_price ?? 0, source: a.base_price === null ? 'No price found: enter it in the tech pack or cost sheet' : 'Tech pack base price', bom: null };
}

/** The price the cost sheet would give now; a line whose base price differs is Desynced (Sprint-2). */
function currentSourcePrice(line: LineRow, destination: string): number | null {
  const cs = get<{ selling_price: number }>("SELECT selling_price FROM so_cost_sheets WHERE article = ? AND status = 'Confirmed' AND destination IN (?, '') ORDER BY destination = '' LIMIT 1", line.article, destination);
  if (line.bom_selected && line.bom_id) return get<{ selling_price: number | null }>('SELECT selling_price FROM so_boms WHERE id = ?', line.bom_id)?.selling_price ?? null;
  return cs?.selling_price ?? null;
}
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;

// ── order ───────────────────────────────────────────────────────────
export function createOrder(u: User, input: { category: string; buyer: string }): { id: number; soNo: string } {
  need(u, 'create');
  const cat = get<{ code: string }>('SELECT code FROM so_categories WHERE code = ?', input.category) ?? bad('Choose a Category.');
  const b = get<{ code: string; category: string; currency: string; departments: string }>('SELECT code, category, currency, departments FROM so_buyers WHERE code = ?', input.buyer) ?? bad('Choose a Buyer.');
  if (b.category !== cat.code) bad('This buyer does not belong to the selected category.');
  const layout = resolveLayout('New', u.id, b.code);
  const n = Number(get<{ n: number }>('SELECT COALESCE(MAX(id), 0) + 1 AS n FROM so_orders')?.n ?? 1);
  const soNo = `${b.code}/SO/${String(n).padStart(5, '0')}`;
  const now = nowIso();
  const header = { sales_order_no: soNo, category: cat.code, buyer: b.code, currency: b.currency, buyer_division_dept: (J<string[]>(b.departments, []))[0] ?? '' };
  const id = tx(() => {
    const id = run('INSERT INTO so_orders (so_no, category, buyer, view_id, status, header, currency, created_by, created_by_id, created_at, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      soNo, cat.code, b.code, layout.view?.id ?? null, 'Draft', JSON.stringify(header), b.currency, u.username, u.id, now, u.username, now).lastId;
    log(id, 'Sales Order created', u.username, { ref: soNo, after: { category: cat.code, buyer: b.code, view: layout.view?.name ?? 'Default (SLC)' } });
    return id;
  });
  return { id, soNo };
}

function layoutOf(o: OrderRow, userId: number): ReturnType<typeof resolveLayout> {
  return resolveLayout('New', userId, o.buyer);
}

export function updateHeader(u: User, id: number, values: Record<string, unknown>, instructions?: Record<string, string>): void {
  need(u, 'edit');
  const o = orderRow(id);
  editableOrder(o);
  const fields = new Map(layoutOf(o, u.id).fields.filter((f) => ['Header', 'Additional', 'Article'].includes(f.level) && f.section !== 'Delivery Level Information').map((f) => [f.key, f]));
  const before = J<Record<string, unknown>>(o.header, {});
  const next = { ...before };
  const changed: Record<string, [unknown, unknown]> = {};
  for (const [k, v] of Object.entries(values)) {
    const f = fields.get(k);
    if (!f) continue;                                   // not on this buyer's screen: ignored
    if (['sales_order_no', 'category', 'buyer'].includes(k)) continue;
    if (!f.editable) continue;
    const err = validateValue({ ...f, mandatory: false }, v);
    if (err) bad(err);
    if (JSON.stringify(before[k] ?? '') !== JSON.stringify(v ?? '')) changed[k] = [before[k] ?? null, v];
    next[k] = v;
  }
  const ins = instructions ? { ...J<Record<string, string>>(o.instructions, {}), ...instructions } : J<Record<string, string>>(o.instructions, {});
  tx(() => {
    run('UPDATE so_orders SET header = ?, instructions = ?, currency = ? WHERE id = ?', JSON.stringify(next), JSON.stringify(ins), String(next['currency'] ?? o.currency), id);
    touch(id, u.username);
    if (Object.keys(changed).length) log(id, 'Order information changed', u.username, { ref: o.so_no, before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[0]])), after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[1]])) });
    if (instructions) log(id, 'Instructions saved', u.username, { ref: o.so_no });
  });
}

// ── deliveries ──────────────────────────────────────────────────────
const nextDeliveryNo = (orderId: number) => String(Number(get<{ n: number }>("SELECT COALESCE(MAX(CAST(delivery_no AS INTEGER)), 0) + 1 AS n FROM so_deliveries WHERE order_id = ?", orderId)?.n ?? 1)).padStart(3, '0');

/** OC Delivery Date = Buyer Delivery Date − ex-factory days (master by shipment mode, buyer, department); no master → same date. */
export function exFactory(buyer: string, department: string, mode: string, buyerDate: string | null): { date: string | null; days: number } {
  if (!buyerDate) return { date: null, days: 0 };
  const m = get<{ days: number }>("SELECT days FROM so_ex_factory WHERE shipment_mode = ? AND buyer = ? AND department IN (?, '') ORDER BY department = '' LIMIT 1", mode, buyer, department);
  const days = m?.days ?? 0;
  const d = new Date(`${buyerDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return { date: d.toISOString().slice(0, 10), days };
}

/** A delivery is refused when Buyer Order Ref, Buyer Delivery Date, OC Delivery Date and Mode of Shipment all equal another one (Sprint-2). */
function duplicateCheck(orderId: number, d: { id?: number; buyer_order_ref: string; buyer_delivery_date: string | null; oc_delivery_date: string | null; shipment_mode: string }): void {
  if (!d.buyer_order_ref && !d.buyer_delivery_date) return;
  const dup = get<{ delivery_no: string }>(`SELECT delivery_no FROM so_deliveries WHERE order_id = ? AND id <> ? AND status <> 'Cancelled' AND buyer_order_ref = ?
    AND COALESCE(buyer_delivery_date, '') = ? AND COALESCE(oc_delivery_date, '') = ? AND shipment_mode = ?`, orderId, d.id ?? 0, d.buyer_order_ref, d.buyer_delivery_date ?? '', d.oc_delivery_date ?? '', d.shipment_mode);
  if (dup) bad(`Duplicate delivery: Delivery ${dup.delivery_no} already has the same Buyer Order Ref, Buyer Delivery Date, OC Delivery Date and Mode of Shipment.`);
}

export interface DeliveryInput { buyer_order_ref?: string; buyer_delivery_date?: string | null; oc_delivery_date?: string | null; shipment_mode?: string; destination?: string; fields?: Record<string, unknown> }
function deliveryValues(o: OrderRow, u: User, input: DeliveryInput, prev?: DeliveryRow) {
  const header = J<Record<string, unknown>>(o.header, {});
  const layout = new Map(layoutOf(o, u.id).fields.filter((f) => f.section === 'Delivery Level Information' && f.level === 'Delivery').map((f) => [f.key, f]));
  const extra = { ...J<Record<string, unknown>>(prev?.fields, {}) };
  for (const [k, v] of Object.entries(input.fields ?? {})) {
    const f = layout.get(k);
    if (!f || !f.editable) continue;
    const err = validateValue({ ...f, mandatory: false }, v);
    if (err) bad(err);
    extra[k] = v;
  }
  for (const k of ['buyer_delivery_date', 'oc_delivery_date'] as const) { const v = input[k]; if (v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) bad('Dates must be YYYY-MM-DD.'); }
  const buyerDate = input.buyer_delivery_date !== undefined ? input.buyer_delivery_date || null : prev?.buyer_delivery_date ?? null;
  const mode = input.shipment_mode ?? prev?.shipment_mode ?? '';
  const auto = exFactory(o.buyer, String(header['buyer_division_dept'] ?? ''), mode, buyerDate);
  // OC Delivery Date fills from the ex-factory master when left blank
  const ocDate = input.oc_delivery_date !== undefined ? input.oc_delivery_date || auto.date : prev?.oc_delivery_date ?? auto.date;
  return { buyer_order_ref: (input.buyer_order_ref ?? prev?.buyer_order_ref ?? '').trim(), buyer_delivery_date: buyerDate, oc_delivery_date: ocDate, shipment_mode: mode,
    destination: input.destination ?? prev?.destination ?? '', fields: extra };
}

export function addDelivery(u: User, orderId: number, input: DeliveryInput = {}): number {
  need(u, 'add-delivery');
  const o = orderRow(orderId);
  editableOrder(o);
  const v = deliveryValues(o, u, input);
  duplicateCheck(orderId, v);
  const now = nowIso();
  return tx(() => {
    const no = nextDeliveryNo(orderId);
    const id = run('INSERT INTO so_deliveries (order_id, delivery_no, status, buyer_order_ref, buyer_delivery_date, oc_delivery_date, shipment_mode, destination, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      orderId, no, 'Draft', v.buyer_order_ref, v.buyer_delivery_date, v.oc_delivery_date, v.shipment_mode, v.destination, JSON.stringify(v.fields), now, now).lastId;
    log(orderId, 'Delivery added', u.username, { delivery: id, ref: `Delivery ${no}`, after: v });
    touch(orderId, u.username);
    return id;
  });
}

export function updateDelivery(u: User, id: number, input: DeliveryInput): void {
  need(u, 'edit');
  const d = deliveryRow(id);
  editableDelivery(d);
  const o = orderRow(d.order_id);
  const v = deliveryValues(o, u, input, d);
  duplicateCheck(d.order_id, { ...v, id });
  const before = { buyer_order_ref: d.buyer_order_ref, buyer_delivery_date: d.buyer_delivery_date, oc_delivery_date: d.oc_delivery_date, shipment_mode: d.shipment_mode, destination: d.destination };
  tx(() => {
    run('UPDATE so_deliveries SET buyer_order_ref = ?, buyer_delivery_date = ?, oc_delivery_date = ?, shipment_mode = ?, destination = ?, fields = ?, updated_at = ? WHERE id = ?',
      v.buyer_order_ref, v.buyer_delivery_date, v.oc_delivery_date, v.shipment_mode, v.destination, JSON.stringify(v.fields), nowIso(), id);
    const after = { buyer_order_ref: v.buyer_order_ref, buyer_delivery_date: v.buyer_delivery_date, oc_delivery_date: v.oc_delivery_date, shipment_mode: v.shipment_mode, destination: v.destination };
    if (JSON.stringify(before) !== JSON.stringify(after)) log(d.order_id, 'Delivery changed', u.username, { delivery: id, ref: `Delivery ${d.delivery_no}`, before, after });
    touch(d.order_id, u.username);
  });
}

/** Copy: a new delivery of the same order with the styles already filled; number, dates, reference and quantities are entered again (Sprint-2). */
export function copyDelivery(u: User, id: number): number {
  need(u, 'copy-delivery');
  const src = deliveryRow(id);
  const o = orderRow(src.order_id);
  editableOrder(o);
  return tx(() => {
    const no = nextDeliveryNo(o.id);
    const now = nowIso();
    const nid = run('INSERT INTO so_deliveries (order_id, delivery_no, status, shipment_mode, destination, fields, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      o.id, no, 'Draft', src.shipment_mode, src.destination, src.fields, now, now).lastId;
    for (const l of all<LineRow>('SELECT * FROM so_delivery_articles WHERE delivery_id = ? ORDER BY seq', id)) {
      const lid = run('INSERT INTO so_delivery_articles (delivery_id, article, bom_id, bom_selected, price_source, price_per, base_price, fields, extra_production_pct, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
        nid, l.article, l.bom_id, l.bom_selected, l.price_source, l.price_per, l.base_price, l.fields, l.extra_production_pct, l.seq).lastId;
      const first = get<BreakupRow>('SELECT * FROM so_breakups WHERE article_line = ? ORDER BY seq LIMIT 1', l.id);
      run('INSERT INTO so_breakups (article_line, seq, packing_type) VALUES (?, 1, ?)', lid, first?.packing_type ?? 'Solid Color / Solid Size');
    }
    log(o.id, 'Delivery copied', u.username, { delivery: nid, ref: `Delivery ${no}`, after: { copiedFrom: src.delivery_no } });
    touch(o.id, u.username);
    return nid;
  });
}

export function deleteDeliveries(u: User, ids: number[]): void {
  need(u, 'delete-delivery');
  if (!ids.length) bad('Select the deliveries to delete.');
  const rows = ids.map(deliveryRow);
  const o = orderRow(rows[0].order_id);
  if (rows.some((d) => d.order_id !== o.id)) bad('Select deliveries of one order.');
  editableOrder(o);
  for (const d of rows) {
    // Confirmed * (revised after confirmation) with a draft delivery: Delete is disabled (Sprint-3)
    if (o.revised && d.status === 'Draft') bad(`Delete is not available: the order is Confirmed * and Delivery ${d.delivery_no} is kept in draft.`);
    if (['Cancelled', 'Closed'].includes(d.status)) bad(`Delivery ${d.delivery_no} is ${d.status}.`);
  }
  tx(() => {
    for (const d of rows) run('DELETE FROM so_deliveries WHERE id = ?', d.id);
    log(o.id, 'Delivery deleted', u.username, { ref: rows.map((d) => `Delivery ${d.delivery_no}`).join(', '), before: rows.map((d) => d.delivery_no) });
    touch(o.id, u.username);
  });
}

function setDeliveryStatus(u: User, ids: number[], tool: string, to: 'Cancelled' | 'Closed' | 'Open', remarks: string): void {
  need(u, tool);
  if (!remarks.trim()) bad('Remarks are mandatory.');
  if (!ids.length) bad('Select one or more deliveries.');
  const rows = ids.map(deliveryRow);
  const o = orderRow(rows[0].order_id);
  if (rows.some((d) => d.order_id !== o.id)) bad('Select deliveries of one order.');
  if (['Cancelled', 'Closed'].includes(o.status)) bad(`The order is ${o.status}.`);
  for (const d of rows) {
    if (to === 'Open' && d.status !== 'Closed') bad(`Only a closed delivery can be reopened; Delivery ${d.delivery_no} is ${d.status}.`);
    if (to !== 'Open' && ['Cancelled', 'Closed'].includes(d.status)) bad(`Delivery ${d.delivery_no} is already ${d.status}.`);
  }
  tx(() => {
    for (const d of rows) {
      run('UPDATE so_deliveries SET status = ?, remarks = ?, updated_at = ? WHERE id = ?', to, remarks.trim(), nowIso(), d.id);
      log(o.id, to === 'Open' ? 'Delivery reopened' : `Delivery ${to.toLowerCase()}`, u.username, { delivery: d.id, ref: `Delivery ${d.delivery_no}`, before: { status: d.status }, after: { status: to }, remarks });
    }
    touch(o.id, u.username);
  });
}
export const cancelDeliveries = (u: User, ids: number[], remarks: string) => setDeliveryStatus(u, ids, 'cancel-delivery', 'Cancelled', remarks);
export const closeDeliveries = (u: User, ids: number[], remarks: string) => setDeliveryStatus(u, ids, 'close-delivery', 'Closed', remarks);
export const reopenDeliveries = (u: User, ids: number[], remarks: string) => setDeliveryStatus(u, ids, 'reopen-delivery', 'Open', remarks);

/** Split a delivery into a new one: by percentage (each colour/size line moves Existing × % ÷ 100, rounded to the UOM
 *  precision) or by quantity (the entered quantity is spread over the lines in proportion to their quantity). */
export function splitDelivery(u: User, id: number, mode: 'percentage' | 'quantity', value: number): number {
  need(u, 'split-delivery');
  const d = deliveryRow(id);
  editableDelivery(d);
  if (!(value > 0)) bad('Split value is mandatory and must be above zero.');
  const lines = all<QtyRow & { article: string; line_id: number; breakup_seq: number; packing_type: string; additional: number; uom_decimals: number }>(`SELECT q.*, l.article, l.id AS line_id, b.seq AS breakup_seq, b.packing_type, b.additional, a.uom_decimals
    FROM so_qty q JOIN so_breakups b ON b.id = q.breakup_id JOIN so_delivery_articles l ON l.id = b.article_line JOIN so_articles a ON a.code = l.article WHERE l.delivery_id = ? AND q.qty > 0`, id);
  const total = lines.reduce((s, l) => s + l.qty, 0);
  if (!total) bad('The delivery has no quantity to split.');
  if (mode === 'percentage' && value >= 100) bad('Split percentage must be below 100.');
  if (mode === 'quantity' && value >= total) bad(`Split quantity must be below the delivery quantity (${total}).`);
  let moved = lines.map((l) => (mode === 'percentage' ? round((l.qty * value) / 100, l.uom_decimals) : round((value * l.qty) / total, l.uom_decimals)));
  if (mode === 'quantity') {
    // largest remainder so the moved quantities add up to exactly what was entered
    const diff = round(value - moved.reduce((s, x) => s + x, 0), 6);
    if (diff !== 0) { const i = lines.reduce((bi, l, k) => (l.qty > lines[bi].qty ? k : bi), 0); moved[i] = round(moved[i] + diff, lines[i].uom_decimals); }
  }
  moved = moved.map((m, i) => Math.min(m, lines[i].qty));
  return tx(() => {
    const o = orderRow(d.order_id);
    const no = nextDeliveryNo(o.id);
    const now = nowIso();
    const nid = run('INSERT INTO so_deliveries (order_id, delivery_no, status, buyer_order_ref, buyer_delivery_date, oc_delivery_date, shipment_mode, destination, fields, split_from, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      o.id, no, 'Draft', `${d.buyer_order_ref}${d.buyer_order_ref ? '-S' : ''}`, d.buyer_delivery_date, d.oc_delivery_date, d.shipment_mode, d.destination, d.fields, id, now, now).lastId;
    const lineMap = new Map<number, number>(), breakMap = new Map<number, number>();
    lines.forEach((l, i) => {
      if (!moved[i]) return;
      if (!lineMap.has(l.line_id)) {
        const src = lineRow(l.line_id);
        lineMap.set(l.line_id, run('INSERT INTO so_delivery_articles (delivery_id, article, bom_id, bom_selected, price_source, price_per, base_price, fields, extra_production_pct, seq) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          nid, src.article, src.bom_id, src.bom_selected, src.price_source, src.price_per, src.base_price, src.fields, src.extra_production_pct, src.seq).lastId);
      }
      if (!breakMap.has(l.breakup_id)) {
        const b = breakupRow(l.breakup_id);
        breakMap.set(l.breakup_id, run('INSERT INTO so_breakups (article_line, seq, packing_type, additional, packing_code, prepack_code, inseam) VALUES (?, ?, ?, ?, ?, ?, ?)', lineMap.get(l.line_id)!, b.seq, b.packing_type, b.additional, b.packing_code, b.prepack_code, b.inseam).lastId);
      }
      run('INSERT INTO so_qty (breakup_id, colour, size, qty, ratio, pp, upcharge, inseam) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?)', breakMap.get(l.breakup_id)!, l.colour, l.size, moved[i], l.upcharge, l.inseam);
      // prepack ratios cannot be split proportionally: the remaining cells keep pieces only
      run('UPDATE so_qty SET qty = ?, ratio = NULL, pp = NULL WHERE breakup_id = ? AND colour = ? AND size = ?', round(l.qty - moved[i], l.uom_decimals), l.breakup_id, l.colour, l.size);
    });
    const movedTotal = moved.reduce((s, x) => s + x, 0);
    log(o.id, 'Delivery split', u.username, { delivery: id, ref: `Delivery ${d.delivery_no} → ${no}`, before: { quantity: total }, after: { mode, value, moved: movedTotal, remaining: round(total - movedTotal, 6), newDelivery: no } });
    touch(o.id, u.username);
    return nid;
  });
}

// ── articles and quantities ─────────────────────────────────────────
export function addArticle(u: User, deliveryId: number, article: string): number {
  need(u, 'edit');
  const d = deliveryRow(deliveryId);
  editableDelivery(d);
  const o = orderRow(d.order_id);
  const a = get<{ code: string; buyer: string | null; category: string; is_kit: number; price_per: string }>('SELECT code, buyer, category, is_kit, price_per FROM so_articles WHERE code = ?', article) ?? bad('Choose an article.');
  if (a.category !== o.category || (a.buyer && a.buyer !== o.buyer)) bad('This article is not available for the order’s buyer and category.');
  if (get('SELECT 1 FROM so_delivery_articles WHERE delivery_id = ? AND article = ?', deliveryId, article)) bad('The article is already in this delivery; use Add Qty for another breakup.');
  // a delivery cannot mix kit and non-kit articles: the first article fixes the type (Sprint-3)
  const other = get<{ is_kit: number }>('SELECT a.is_kit FROM so_delivery_articles l JOIN so_articles a ON a.code = l.article WHERE l.delivery_id = ? LIMIT 1', deliveryId);
  if (other && other.is_kit !== a.is_kit) bad(`A delivery cannot mix kit and non-kit articles; this delivery holds ${other.is_kit ? 'kit' : 'non-kit'} articles.`);
  const p = pickPrice(article, d.destination);
  return tx(() => {
    const seq = Number(get<{ n: number }>('SELECT COALESCE(MAX(seq), 0) + 1 AS n FROM so_delivery_articles WHERE delivery_id = ?', deliveryId)?.n ?? 1);
    const id = run('INSERT INTO so_delivery_articles (delivery_id, article, bom_id, bom_selected, price_source, price_per, base_price, seq) VALUES (?, ?, ?, 0, ?, ?, ?, ?)',
      deliveryId, article, p.bom, p.source, a.price_per, p.price, seq).lastId;
    run("INSERT INTO so_breakups (article_line, seq, packing_type) VALUES (?, 1, 'Solid Color / Solid Size')", id);
    log(o.id, 'Article added', u.username, { delivery: deliveryId, ref: `Delivery ${d.delivery_no} · ${article}`, after: { price: p.price, priceSource: p.source, bom: p.bom } });
    touch(o.id, u.username);
    return id;
  });
}

export function updateArticle(u: User, lineId: number, input: { bomId?: string | null; extraProductionPct?: number; fields?: Record<string, unknown> }): void {
  need(u, 'edit');
  const l = lineRow(lineId);
  const d = deliveryRow(l.delivery_id);
  editableDelivery(d);
  const changes: Record<string, [unknown, unknown]> = {};
  let price = l.base_price, source = l.price_source, bom = l.bom_id, selected = l.bom_selected;
  if (input.bomId !== undefined && input.bomId !== (l.bom_selected ? l.bom_id : null)) {
    const p = input.bomId ? pickPrice(l.article, d.destination, input.bomId) : pickPrice(l.article, d.destination);
    changes['price'] = [l.base_price, p.price];
    changes['bom'] = [l.bom_id, p.bom];
    price = p.price; source = p.source; bom = p.bom; selected = input.bomId ? 1 : 0;
  }
  let extra = l.extra_production_pct;
  if (input.extraProductionPct !== undefined) {
    if (!(input.extraProductionPct >= 0 && input.extraProductionPct <= 100)) bad('Extra Production % must be between 0 and 100.');
    if (input.extraProductionPct !== l.extra_production_pct) changes['extraProductionPct'] = [l.extra_production_pct, input.extraProductionPct];
    extra = input.extraProductionPct;
  }
  const f = { ...J<Record<string, unknown>>(l.fields, {}), ...(input.fields ?? {}) };
  tx(() => {
    run('UPDATE so_delivery_articles SET bom_id = ?, bom_selected = ?, price_source = ?, base_price = ?, extra_production_pct = ?, fields = ? WHERE id = ?', bom, selected, source, price, extra, JSON.stringify(f), lineId);
    if (Object.keys(changes).length) log(d.order_id, 'Article changed', u.username, { delivery: d.id, ref: `Delivery ${d.delivery_no} · ${l.article}`, before: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[0]])), after: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v[1]])) });
    touch(d.order_id, u.username);
  });
}

export function removeArticle(u: User, lineId: number): void {
  need(u, 'edit');
  const l = lineRow(lineId);
  const d = deliveryRow(l.delivery_id);
  editableDelivery(d);
  tx(() => { run('DELETE FROM so_delivery_articles WHERE id = ?', lineId); log(d.order_id, 'Article deleted', u.username, { delivery: d.id, ref: `Delivery ${d.delivery_no} · ${l.article}` }); touch(d.order_id, u.username); });
}

export const PACKING = ['Solid Color / Solid Size', 'Solid Color / Assorted Size', 'Multiple Prepack'] as const;

/** Add Qty: another quantity grid under the same article; its packing type is frozen to the article's (Sprint-3).
 *  additional = the "Add Additional Qty" grid (extra quantity shown apart from the order quantity). */
export function addBreakup(u: User, lineId: number, additional = false): number {
  need(u, 'edit');
  const l = lineRow(lineId);
  const d = deliveryRow(l.delivery_id);
  editableDelivery(d);
  const first = get<BreakupRow>('SELECT * FROM so_breakups WHERE article_line = ? ORDER BY seq LIMIT 1', lineId)!;
  if (additional && get('SELECT 1 FROM so_breakups WHERE article_line = ? AND additional = 1', lineId)) bad('This article already has an Additional Qty grid.');
  return tx(() => {
    const seq = Number(get<{ n: number }>('SELECT MAX(seq) + 1 AS n FROM so_breakups WHERE article_line = ?', lineId)?.n ?? 2);
    const id = run('INSERT INTO so_breakups (article_line, seq, packing_type, additional) VALUES (?, ?, ?, ?)', lineId, seq, first.packing_type, additional ? 1 : 0).lastId;
    log(d.order_id, additional ? 'Additional Qty added' : 'Add Qty breakup added', u.username, { delivery: d.id, ref: `Delivery ${d.delivery_no} · ${l.article} · grid ${seq}` });
    return id;
  });
}

export function deleteBreakup(u: User, id: number): void {
  need(u, 'edit');
  const b = breakupRow(id);
  const l = lineRow(b.article_line);
  const d = deliveryRow(l.delivery_id);
  editableDelivery(d);
  if (b.seq === 1) bad('The first quantity breakup belongs to the article; delete the article instead.');
  tx(() => { run('DELETE FROM so_breakups WHERE id = ?', id); log(d.order_id, 'Qty breakup deleted', u.username, { delivery: d.id, ref: `Delivery ${d.delivery_no} · ${l.article} · grid ${b.seq}` }); });
}

export interface BreakupInput { packingType?: string; packingCode?: string; prepackCode?: string; cartons?: number | null; inseam?: string; cells: { colour: string; size: string; qty?: number; ratio?: number; pp?: number; upcharge?: number; inseam?: string }[] }

/** Saves one quantity grid with the packing-type rules:
 *  Solid Color / Solid Size — one colour and one size;  Solid Color / Assorted Size — one colour, PP × size ratios;
 *  Multiple Prepack — any colours, PP × ratios.  Upcharge (+) / discount (−) is kept at the Price Per level. */
export function saveBreakup(u: User, id: number, input: BreakupInput): void {
  need(u, 'edit');
  const b = breakupRow(id);
  const l = lineRow(b.article_line);
  const d = deliveryRow(l.delivery_id);
  editableDelivery(d);
  const a = get<{ colours: string; sizes: string; inseams: string; uom_decimals: number }>('SELECT colours, sizes, inseams, uom_decimals FROM so_articles WHERE code = ?', l.article)!;
  const colours = new Set(J<{ code: string }[]>(a.colours, []).map((c) => c.code));
  const sizes = new Set(J<{ code: string }[]>(a.sizes, []).map((s) => s.code));
  const inseams = J<string[]>(a.inseams, []);
  const first = get<BreakupRow>('SELECT * FROM so_breakups WHERE article_line = ? ORDER BY seq LIMIT 1', l.id)!;
  // the packing type is chosen on the first grid; Add Qty grids are frozen to it
  const packing = b.seq === 1 ? input.packingType ?? b.packing_type : first.packing_type;
  if (!PACKING.includes(packing as (typeof PACKING)[number])) bad('Choose a packing type.');
  const cells = input.cells.filter((c) => (c.qty ?? 0) > 0 || (c.ratio ?? 0) > 0 || (c.upcharge ?? 0) !== 0);
  for (const c of cells) {
    if (!colours.has(c.colour)) bad(`Colour ${c.colour} is not in the article’s colour card.`);
    if (!sizes.has(c.size)) bad(`Size ${c.size} is not in the article’s size range.`);
    if ((c.qty ?? 0) < 0 || (c.ratio ?? 0) < 0 || (c.pp ?? 0) < 0) bad('Quantities cannot be negative.');
    if (c.inseam && !inseams.includes(c.inseam)) bad(`Inseam ${c.inseam} is not in the size master for this article.`);
  }
  const used = cells.filter((c) => (c.qty ?? 0) > 0 || (c.ratio ?? 0) > 0);
  const usedColours = [...new Set(used.map((c) => c.colour))];
  if (packing === 'Solid Color / Solid Size' && (usedColours.length > 1 || new Set(used.map((c) => c.size)).size > 1)) bad('Solid Color / Solid Size takes one colour and one size.');
  if (packing === 'Solid Color / Assorted Size' && usedColours.length > 1) bad('Only one color can be entered for this packing type.');
  const prepack = packing !== 'Solid Color / Solid Size';
  // upcharge level follows Price Per: one value per article / colour / size / combination
  const level = l.price_per;
  const upOf = (c: BreakupInput['cells'][number]) => c.upcharge ?? 0;
  const groups = new Map<string, number>();
  for (const c of cells) {
    const k = level === 'Article' ? '*' : level === 'Color' ? c.colour : level === 'Size' ? c.size : `${c.colour}|${c.size}`;
    if (groups.has(k) && groups.get(k) !== upOf(c)) bad(`Price Per is ${level}: the upcharge/discount must be the same for every ${level === 'Article' ? 'cell' : level.toLowerCase()} entry.`);
    groups.set(k, upOf(c));
    if (l.base_price + upOf(c) < 0) bad('The discount cannot be more than the base selling price.');
  }
  const ppOf = (colour: string) => used.find((c) => c.colour === colour && (c.pp ?? 0) > 0)?.pp ?? 0;
  if (prepack) for (const col of usedColours) if (!(ppOf(col) > 0)) bad(`Enter the PP (number of prepacks) for colour ${col}.`);
  const before = all<QtyRow>('SELECT * FROM so_qty WHERE breakup_id = ?', id);
  tx(() => {
    run('UPDATE so_breakups SET packing_type = ?, packing_code = ?, prepack_code = ?, cartons = ?, inseam = ? WHERE id = ?', packing, input.packingCode ?? b.packing_code, input.prepackCode ?? b.prepack_code,
      input.cartons ?? b.cartons, input.inseam ?? b.inseam, id);
    if (b.seq === 1 && packing !== b.packing_type) run('UPDATE so_breakups SET packing_type = ? WHERE article_line = ?', packing, l.id);
    run('DELETE FROM so_qty WHERE breakup_id = ?', id);
    for (const c of cells) {
      const ratio = prepack ? c.ratio ?? 0 : null;
      const pp = prepack ? ppOf(c.colour) : null;
      // PCS = PP × ratio for prepack types (Sprint-3); otherwise the quantity entered
      const qty = prepack ? round((pp ?? 0) * (ratio ?? 0), a.uom_decimals) : round(c.qty ?? 0, a.uom_decimals);
      run('INSERT INTO so_qty (breakup_id, colour, size, qty, ratio, pp, upcharge, inseam) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, c.colour, c.size, qty, ratio, pp, upOf(c), c.inseam ?? '');
    }
    const sum = (rows: { qty: number }[]) => rows.reduce((s, r) => s + r.qty, 0);
    const after = all<QtyRow>('SELECT * FROM so_qty WHERE breakup_id = ?', id);
    log(d.order_id, 'Quantities saved', u.username, { delivery: d.id, ref: `Delivery ${d.delivery_no} · ${l.article} · grid ${b.seq}${b.additional ? ' (additional)' : ''}`, before: { packing: b.packing_type, quantity: sum(before) }, after: { packing, quantity: sum(after) } });
    touch(d.order_id, u.username);
  });
}

// ── read models ─────────────────────────────────────────────────────
interface Totals { qty: number; additional: number; value: number; planned: number }
function lineTotals(lineId: number, basePrice: number, extraPct: number): Totals {
  const rows = all<{ qty: number; upcharge: number; additional: number }>('SELECT q.qty, q.upcharge, b.additional FROM so_qty q JOIN so_breakups b ON b.id = q.breakup_id WHERE b.article_line = ?', lineId);
  const qty = rows.filter((r) => !r.additional).reduce((s, r) => s + r.qty, 0);
  const additional = rows.filter((r) => r.additional).reduce((s, r) => s + r.qty, 0);
  const value = rows.filter((r) => !r.additional).reduce((s, r) => s + r.qty * (basePrice + r.upcharge), 0);
  return { qty, additional, value: round(value, 2), planned: Math.round(qty * (1 + extraPct / 100)) };
}

export function getOrder(u: User, id: number) {
  const o = orderRow(id);
  const layout = layoutOf(o, u.id);
  const buyer = get<Record<string, unknown>>('SELECT * FROM so_buyers WHERE code = ?', o.buyer)!;
  const deliveries = all<DeliveryRow>('SELECT * FROM so_deliveries WHERE order_id = ? ORDER BY delivery_no', id).map((d) => {
    const lines = all<LineRow>('SELECT * FROM so_delivery_articles WHERE delivery_id = ? ORDER BY seq', d.id).map((l) => {
      const a = get<Record<string, unknown>>('SELECT * FROM so_articles WHERE code = ?', l.article)!;
      const boms = all<Record<string, unknown>>("SELECT id, bom_no, version, status, accepted, accepted_on, selling_price, routing FROM so_boms WHERE article = ? ORDER BY accepted_on DESC", l.article);
      const breakups = all<BreakupRow>('SELECT * FROM so_breakups WHERE article_line = ? ORDER BY seq', l.id).map((b) => ({ ...b, cells: all<QtyRow>('SELECT * FROM so_qty WHERE breakup_id = ? ORDER BY colour, size', b.id) }));
      const src = currentSourcePrice(l, d.destination);
      const desynced = get<{ value: string }>("SELECT value FROM so_settings WHERE key = 'oc_price_validation'")?.value === '1' && src !== null && Math.abs(src - l.base_price) > 1e-6;
      const bom = boms.find((b) => b['id'] === l.bom_id);
      return { ...l, fields: J(l.fields, {}), name: a['name'], isKit: !!a['is_kit'], kitName: a['kit_name'], kitId: a['kit_id'], uom: a['uom'], buyerStyleRef: a['buyer_style_ref'],
        colours: J(a['colours'], []), sizes: J(a['sizes'], []), inseams: J(a['inseams'], []), boms, routing: bom?.['routing'] ?? null, breakups,
        totals: lineTotals(l.id, l.base_price, l.extra_production_pct), desynced, sourcePrice: src };
    });
    const totals = lines.reduce((t, l) => ({ qty: t.qty + l.totals.qty, additional: t.additional + l.totals.additional, value: round(t.value + l.totals.value, 2), planned: t.planned + l.totals.planned }), { qty: 0, additional: 0, value: 0, planned: 0 });
    return { ...d, fields: J(d.fields, {}), lines, totals };
  });
  const live = deliveries.filter((d) => d.status !== 'Cancelled');
  const totals = { qty: live.reduce((s, d) => s + d.totals.qty, 0), value: round(live.reduce((s, d) => s + d.totals.value, 0), 2), deliveries: deliveries.length };
  const approvals = all<Record<string, unknown>>('SELECT * FROM so_approvals WHERE order_id = ? ORDER BY level, id', id);
  return {
    order: { ...o, header: J<Record<string, unknown>>(o.header, {}), instructions: J<Record<string, string>>(o.instructions, {}), displayStatus: displayStatus(o) },
    buyer: { ...buyer, departments: J(buyer['departments'], []), seasons: J(buyer['seasons'], []) },
    layout, deliveries, totals, approvals, history: historyOf(id), tools: toolsOf(u),
    articles: all<{ code: string; name: string; is_kit: number }>('SELECT code, name, is_kit FROM so_articles WHERE category = ? AND (buyer IS NULL OR buyer = ?) ORDER BY code', o.category, o.buyer),
    approvers: all<{ id: number; username: string; display_name: string; approval_limit: number; is_final: number }>("SELECT u.id, u.username, u.display_name, a.approval_limit, a.is_final FROM so_approvers a JOIN users u ON u.id = a.user_id WHERE u.disabled = 0 AND u.role IN ('approver', 'admin') ORDER BY u.display_name"),
  };
}

// ── confirm, approval ───────────────────────────────────────────────
function mandatoryProblems(u: User, o: OrderRow): string[] {
  const p: string[] = [];
  const layout = layoutOf(o, u.id).fields;
  const header = J<Record<string, unknown>>(o.header, {});
  for (const f of layout.filter((x) => x.mandatory && x.level !== 'Delivery' && x.level !== 'Delivery+SKU' && x.section !== 'Delivery Level Information')) {
    if (['sales_order_no', 'category', 'buyer'].includes(f.key)) continue;
    const e = validateValue(f, header[f.key]);
    if (e) p.push(e);
  }
  const ds = all<DeliveryRow>("SELECT * FROM so_deliveries WHERE order_id = ? AND status NOT IN ('Cancelled', 'Closed')", o.id);
  if (!ds.length) p.push('Add at least one delivery.');
  const dFields: LayoutField[] = layout.filter((f) => f.level === 'Delivery' && f.mandatory);
  for (const d of ds) {
    const vals: Record<string, unknown> = { ...J<Record<string, unknown>>(d.fields, {}), delivery_buyer_order_ref: d.buyer_order_ref, buyer_delivery_date: d.buyer_delivery_date, oc_delivery_date: d.oc_delivery_date, mode_of_shipment: d.shipment_mode, country_of_final_destination: d.destination };
    for (const f of dFields) { const e = validateValue(f, vals[f.key]); if (e) p.push(`Delivery ${d.delivery_no}: ${e}`); }
    const lines = all<LineRow>('SELECT * FROM so_delivery_articles WHERE delivery_id = ?', d.id);
    if (!lines.length) p.push(`Delivery ${d.delivery_no}: add an article.`);
    for (const l of lines) {
      const t = lineTotals(l.id, l.base_price, l.extra_production_pct);
      if (!t.qty) p.push(`Delivery ${d.delivery_no} · ${l.article}: enter the order quantity.`);
      if (!(l.base_price > 0)) p.push(`Delivery ${d.delivery_no} · ${l.article}: no selling price.`);
    }
  }
  return p;
}

/** Approval value per approver (Sprint-2): 0 → never goes for approval, −1 → always, > 0 → when the order value exceeds it. */
export function approvalRequired(limit: number, value: number): boolean { return limit === -1 ? true : limit === 0 ? false : value > limit; }

export function confirmOrder(u: User, id: number, approverId?: number | null): { status: string; problems?: string[] } {
  need(u, 'confirm');
  const o = orderRow(id);
  editableOrder(o);
  const problems = mandatoryProblems(u, o);
  if (problems.length) return { status: o.status, problems };
  const value = getOrder(u, id).totals.value;
  const approvers = all<{ user_id: number; approval_limit: number }>("SELECT a.user_id, a.approval_limit FROM so_approvers a JOIN users u ON u.id = a.user_id WHERE u.disabled = 0");
  let status = 'Confirmed';
  let chosen: { user_id: number; approval_limit: number } | undefined;
  if (approvers.length) {
    // the creator names one approver; the approver's approval value decides whether the order goes for approval
    chosen = approvers.find((a) => a.user_id === approverId) ?? bad('Choose the approver.');
    if (approvalRequired(chosen.approval_limit, value)) status = 'Pending Approval';
  }
  tx(() => {
    run('UPDATE so_orders SET status = ?, approver_id = ?, approval_level = ?, revised = CASE WHEN ? = \'Confirmed\' THEN 0 ELSE revised END, updated_at = ?, updated_by = ? WHERE id = ?',
      status, chosen?.user_id ?? null, status === 'Pending Approval' ? 1 : 0, status, nowIso(), u.username, id);
    if (status === 'Confirmed') run("UPDATE so_deliveries SET status = 'Open' WHERE order_id = ? AND status = 'Draft'", id);
    if (status === 'Pending Approval') {
      const name = get<{ display_name: string }>('SELECT display_name FROM users WHERE id = ?', chosen!.user_id)!.display_name;
      run("INSERT INTO so_approvals (order_id, level, approver_id, approver, status, created_at) VALUES (?, 1, ?, ?, 'Pending', ?)", id, chosen!.user_id, name, nowIso());
    }
    log(id, status === 'Confirmed' ? 'Sales Order confirmed' : 'Sent for approval', u.username, { ref: o.so_no, before: { status: displayStatus(o) }, after: { status, orderValue: value, approvalLimit: chosen?.approval_limit ?? null } });
  });
  return { status };
}

export function pendingApprovals(u: User) {
  return all<Record<string, unknown>>(`SELECT p.id AS approval_id, p.level, p.created_at AS sent_at, o.id, o.so_no, o.buyer, o.status, o.created_by FROM so_approvals p JOIN so_orders o ON o.id = p.order_id
    WHERE p.approver_id = ? AND p.status = 'Pending' ORDER BY p.created_at`, u.id).map((r) => ({ ...r, value: getOrder(u, Number(r['id'])).totals.value }));
}
export function approvalLog(u: User) {
  return all<Record<string, unknown>>(`SELECT p.*, o.so_no, o.buyer FROM so_approvals p JOIN so_orders o ON o.id = p.order_id WHERE p.approver_id = ? AND p.status <> 'Pending' ORDER BY p.acted_at DESC LIMIT 100`, u.id);
}

/** Approve: with multi-level approval on and the approver not final, the approver names the next one; otherwise the order is confirmed. */
export function approveOrder(u: User, id: number, remarks: string, nextApproverId?: number | null): { status: string } {
  need(u, 'approve');
  const o = orderRow(id);
  const p = get<{ id: number; level: number }>("SELECT id, level FROM so_approvals WHERE order_id = ? AND approver_id = ? AND status = 'Pending'", id, u.id) ?? bad('This order is not waiting for your approval.', 403);
  const multi = get<{ value: string }>("SELECT value FROM so_settings WHERE key = 'multi_level_approval'")?.value === '1';
  const me = get<{ is_final: number }>('SELECT is_final FROM so_approvers WHERE user_id = ?', u.id);
  const goesOn = multi && !me?.is_final;
  let next: { id: number; display_name: string } | undefined;
  if (goesOn) {
    if (!nextApproverId) bad('Choose the next approver (multi-level approval).');
    if (nextApproverId === u.id) bad('Choose another approver.');
    next = get<{ id: number; display_name: string }>('SELECT u.id, u.display_name FROM so_approvers a JOIN users u ON u.id = a.user_id WHERE u.id = ? AND u.disabled = 0', nextApproverId) ?? bad('The next approver is not set up as an approver.');
  }
  const now = nowIso();
  tx(() => {
    run("UPDATE so_approvals SET status = 'Approved', remarks = ?, acted_at = ? WHERE id = ?", remarks.trim(), now, p.id);
    if (next) {
      run("INSERT INTO so_approvals (order_id, level, approver_id, approver, status, created_at) VALUES (?, ?, ?, ?, 'Pending', ?)", id, p.level + 1, next.id, next.display_name, now);
      run('UPDATE so_orders SET approver_id = ?, approval_level = ?, updated_at = ? WHERE id = ?', next.id, p.level + 1, now, id);
      log(id, `Approved (level ${p.level}), sent to ${next.display_name}`, u.username, { ref: o.so_no, remarks });
    } else {
      run("UPDATE so_orders SET status = 'Confirmed', revised = 0, updated_at = ?, updated_by = ? WHERE id = ?", now, u.username, id);
      run("UPDATE so_deliveries SET status = 'Open' WHERE order_id = ? AND status = 'Draft'", id);
      log(id, `Approved (level ${p.level}) – Sales Order confirmed`, u.username, { ref: o.so_no, before: { status: 'Pending Approval' }, after: { status: 'Confirmed' }, remarks });
    }
  });
  return { status: next ? 'Pending Approval' : 'Confirmed' };
}

export function rejectOrder(u: User, id: number, remarks: string): void {
  need(u, 'approve');
  if (!remarks.trim()) bad('Remarks are mandatory to reject.');
  const o = orderRow(id);
  const p = get<{ id: number; level: number }>("SELECT id, level FROM so_approvals WHERE order_id = ? AND approver_id = ? AND status = 'Pending'", id, u.id) ?? bad('This order is not waiting for your approval.', 403);
  tx(() => {
    run("UPDATE so_approvals SET status = 'Rejected', remarks = ?, acted_at = ? WHERE id = ?", remarks.trim(), nowIso(), p.id);
    run("UPDATE so_orders SET status = 'Rejected', updated_at = ?, updated_by = ? WHERE id = ?", nowIso(), u.username, id);
    log(id, `Rejected (level ${p.level})`, u.username, { ref: o.so_no, before: { status: 'Pending Approval' }, after: { status: 'Rejected' }, remarks });
  });
}

/** Revise a confirmed order: Reason for revision and Revision Authorized By are mandatory; the order shows Confirmed * until confirmed again. */
export function reviseOrder(u: User, id: number, reason: string, authorizedBy: string): void {
  need(u, 'revise');
  const o = orderRow(id);
  if (o.status !== 'Confirmed') bad('Only a confirmed order can be revised.');
  if (!reason.trim() || !authorizedBy.trim()) bad('Reason for revision and Revision Authorized By are mandatory.');
  tx(() => {
    run("UPDATE so_orders SET status = 'Draft', revised = 1, updated_at = ?, updated_by = ? WHERE id = ?", nowIso(), u.username, id);
    log(id, 'Revision started', u.username, { ref: o.so_no, before: { status: 'Confirmed' }, after: { status: 'Confirmed *' }, remarks: `${reason.trim()} (authorized by ${authorizedBy.trim()})` });
  });
}

export function cancelOrder(u: User, id: number, remarks: string): void {
  need(u, 'cancel-order');
  if (!remarks.trim()) bad('Remarks are mandatory.');
  const o = orderRow(id);
  if (['Cancelled', 'Closed'].includes(o.status)) bad(`The order is already ${o.status}.`);
  tx(() => {
    const ds = all<{ id: number; delivery_no: string }>("SELECT id, delivery_no FROM so_deliveries WHERE order_id = ? AND status <> 'Cancelled'", id);
    run("UPDATE so_deliveries SET status = 'Cancelled', remarks = ?, updated_at = ? WHERE order_id = ? AND status <> 'Cancelled'", remarks.trim(), nowIso(), id);
    run("UPDATE so_orders SET status = 'Cancelled', updated_at = ?, updated_by = ? WHERE id = ?", nowIso(), u.username, id);
    run("UPDATE so_approvals SET status = 'Withdrawn', acted_at = ? WHERE order_id = ? AND status = 'Pending'", nowIso(), id);
    log(id, 'Sales Order cancelled', u.username, { ref: o.so_no, before: { status: displayStatus(o) }, after: { status: 'Cancelled', deliveriesCancelled: ds.map((d) => d.delivery_no) }, remarks });
  });
}

export function closeOrder(u: User, id: number, remarks: string): void {
  need(u, 'close-order');
  if (!remarks.trim()) bad('Remarks are mandatory.');
  const o = orderRow(id);
  if (['Cancelled', 'Closed'].includes(o.status)) bad('You cannot close a Cancelled or Closed Order.');
  tx(() => {
    run("UPDATE so_orders SET status = 'Closed', updated_at = ?, updated_by = ? WHERE id = ?", nowIso(), u.username, id);
    log(id, 'Sales Order closed', u.username, { ref: o.so_no, before: { status: displayStatus(o) }, after: { status: 'Closed' }, remarks });
  });
}

/** Sync: the desynced lines take the cost sheet / selected BOM price again (Sprint-2 Desync Price OC). Works on any status but Cancelled/Closed. */
export function syncPrices(u: User, id: number): { synced: number } {
  need(u, 'sync-price');
  const o = orderRow(id);
  if (['Cancelled', 'Closed'].includes(o.status)) bad(`A ${o.status} order cannot be synced.`);
  let synced = 0;
  tx(() => {
    for (const d of all<DeliveryRow>('SELECT * FROM so_deliveries WHERE order_id = ?', id)) for (const l of all<LineRow>('SELECT * FROM so_delivery_articles WHERE delivery_id = ?', d.id)) {
      const src = currentSourcePrice(l, d.destination);
      if (src === null || Math.abs(src - l.base_price) < 1e-6) continue;
      run('UPDATE so_delivery_articles SET base_price = ? WHERE id = ?', src, l.id);
      log(id, 'Price synced', u.username, { delivery: d.id, ref: `Delivery ${d.delivery_no} · ${l.article}`, before: { price: l.base_price }, after: { price: src } });
      synced++;
    }
  });
  return { synced };
}

// ── list ────────────────────────────────────────────────────────────
export interface ListQuery { mode?: 'main' | 'style'; q?: string; status?: string; buyer?: string; page?: number; size?: number; sort?: 'asc' | 'desc' }
export function listOrders(u: User, q: ListQuery) {
  const size = Math.min(Math.max(q.size ?? 20, 5), 100);
  const page = Math.max(q.page ?? 1, 1);
  const where: string[] = ['1 = 1'];
  const params: unknown[] = [];
  // List view scope (View Configurator): only the user's orders, or theirs plus their permitted buyers'
  const lv = resolveLayout('List', u.id);
  const scope = lv.view ? get<{ list_scope: string }>('SELECT list_scope FROM so_views WHERE id = ?', lv.view.id)?.list_scope ?? 'all' : 'all';
  if (scope === 'created') { where.push('o.created_by_id = ?'); params.push(u.id); }
  if (scope === 'created-and-buyer') {
    const buyers = all<{ buyers: string }>("SELECT v.buyers FROM so_views v JOIN so_view_permissions p ON p.view_id = v.id WHERE v.list_type = 'New' AND p.user_id = ?", u.id).flatMap((r) => J<string[]>(r.buyers, []));
    where.push(`(o.created_by_id = ? OR o.buyer IN (${buyers.map(() => '?').join(',') || "''"}))`); params.push(u.id, ...buyers);
  }
  if (q.status) {
    if (q.status === 'Confirmed *') where.push("o.status = 'Draft' AND o.revised = 1");
    else { where.push('o.status = ?'); params.push(q.status); if (q.status === 'Draft') where.push('o.revised = 0'); }
  }
  if (q.buyer) { where.push('o.buyer = ?'); params.push(q.buyer); }
  const term = (q.q ?? '').trim();
  if (term) {
    where.push(`(o.so_no LIKE ? OR EXISTS (SELECT 1 FROM so_deliveries d JOIN so_delivery_articles l ON l.delivery_id = d.id JOIN so_articles a ON a.code = l.article
      WHERE d.order_id = o.id AND (l.article LIKE ? OR a.name LIKE ? OR d.buyer_order_ref LIKE ?)))`);
    params.push(`%${term}%`, `%${term}%`, `%${term}%`, `%${term}%`);
  }
  const qtySql = `(SELECT COALESCE(SUM(q.qty), 0) FROM so_qty q JOIN so_breakups b ON b.id = q.breakup_id AND b.additional = 0 JOIN so_delivery_articles l ON l.id = b.article_line JOIN so_deliveries d ON d.id = l.delivery_id AND d.status <> 'Cancelled' WHERE d.order_id = o.id %ART%)`;
  const valSql = `(SELECT COALESCE(SUM(q.qty * (l.base_price + q.upcharge)), 0) FROM so_qty q JOIN so_breakups b ON b.id = q.breakup_id AND b.additional = 0 JOIN so_delivery_articles l ON l.id = b.article_line JOIN so_deliveries d ON d.id = l.delivery_id AND d.status <> 'Cancelled' WHERE d.order_id = o.id %ART%)`;
  const order = q.sort === 'asc' ? 'ASC' : 'DESC';
  if (q.mode === 'style') {
    const base = `FROM so_orders o JOIN (SELECT DISTINCT d.order_id, l.article FROM so_deliveries d JOIN so_delivery_articles l ON l.delivery_id = d.id) x ON x.order_id = o.id JOIN so_articles a ON a.code = x.article WHERE ${where.join(' AND ')}`;
    const total = Number(get<{ n: number }>(`SELECT COUNT(*) AS n ${base}`, ...params)?.n ?? 0);
    const rows = all<Record<string, unknown>>(`SELECT o.id, o.so_no, o.status, o.revised, o.buyer, o.header, o.created_at, o.created_by, x.article, a.name AS article_name,
      ${qtySql.replace('%ART%', 'AND l.article = x.article')} AS qty, ${valSql.replace('%ART%', 'AND l.article = x.article')} AS value,
      (SELECT COUNT(DISTINCT d.id) FROM so_deliveries d JOIN so_delivery_articles l ON l.delivery_id = d.id WHERE d.order_id = o.id AND l.article = x.article) AS deliveries,
      (SELECT MIN(d.buyer_delivery_date) FROM so_deliveries d JOIN so_delivery_articles l ON l.delivery_id = d.id WHERE d.order_id = o.id AND l.article = x.article AND d.status <> 'Cancelled') AS buyer_delivery_date,
      (SELECT MIN(d.oc_delivery_date) FROM so_deliveries d JOIN so_delivery_articles l ON l.delivery_id = d.id WHERE d.order_id = o.id AND l.article = x.article AND d.status <> 'Cancelled') AS oc_delivery_date
      ${base} ORDER BY o.created_at ${order}, x.article LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size);
    return { mode: 'style', total, page, size, rows: rows.map(listRow) };
  }
  const total = Number(get<{ n: number }>(`SELECT COUNT(*) AS n FROM so_orders o WHERE ${where.join(' AND ')}`, ...params)?.n ?? 0);
  const rows = all<Record<string, unknown>>(`SELECT o.id, o.so_no, o.status, o.revised, o.buyer, o.header, o.created_at, o.created_by,
    (SELECT GROUP_CONCAT(DISTINCT l.article) FROM so_deliveries d JOIN so_delivery_articles l ON l.delivery_id = d.id WHERE d.order_id = o.id) AS article,
    ${qtySql.replace('%ART%', '')} AS qty, ${valSql.replace('%ART%', '')} AS value,
    (SELECT COUNT(*) FROM so_deliveries d WHERE d.order_id = o.id) AS deliveries,
    (SELECT MIN(d.buyer_delivery_date) FROM so_deliveries d WHERE d.order_id = o.id AND d.status <> 'Cancelled') AS buyer_delivery_date,
    (SELECT MIN(d.oc_delivery_date) FROM so_deliveries d WHERE d.order_id = o.id AND d.status <> 'Cancelled') AS oc_delivery_date
    FROM so_orders o WHERE ${where.join(' AND ')} ORDER BY o.created_at ${order}, o.id ${order} LIMIT ? OFFSET ?`, ...params, size, (page - 1) * size);
  return { mode: 'main', total, page, size, rows: rows.map(listRow) };
}
function listRow(r: Record<string, unknown>) {
  const h = J<Record<string, unknown>>(r['header'], {});
  return { id: r['id'], soNo: r['so_no'], status: displayStatus({ status: String(r['status']), revised: Number(r['revised']) }), buyer: r['buyer'], buyerName: get<{ name: string }>('SELECT name FROM so_buyers WHERE code = ?', r['buyer'])?.name ?? r['buyer'],
    article: r['article'] ?? '', articleName: r['article_name'] ?? '', season: h['order_season'] ?? '', buyerOrderDate: h['buyer_order_date'] ?? '', qty: Number(r['qty'] ?? 0), value: round(Number(r['value'] ?? 0), 2),
    deliveries: Number(r['deliveries'] ?? 0), buyerDeliveryDate: r['buyer_delivery_date'] ?? '', ocDeliveryDate: r['oc_delivery_date'] ?? '', createdAt: r['created_at'], createdBy: r['created_by'],
    // ASN and GDN quantities come from shipping documents, which Atlas does not hold yet
    asnQty: 0, gdnQty: 0 };
}

export function listMasters() {
  return {
    categories: all<{ code: string; name: string }>('SELECT code, name FROM so_categories ORDER BY name'),
    buyers: all<Record<string, unknown>>('SELECT code, name, category, departments, seasons, currency, source FROM so_buyers ORDER BY name').map((b) => ({ ...b, departments: J(b['departments'], []), seasons: J(b['seasons'], []) })),
    lookups: Object.fromEntries(Object.entries(all<{ list: string; value: string }>('SELECT list, value FROM so_lookups').reduce((m, r) => { (m[r.list] ??= []).push(r.value); return m; }, {} as Record<string, string[]>))),
    statuses: ['Draft', 'Confirmed *', 'Pending Approval', 'Confirmed', 'Rejected', 'Cancelled', 'Closed'],
    today: today(),
  };
}

// ── lookups for the routes ──────────────────────────────────────────
export const getDeliveryOrder = (deliveryId: number) => deliveryRow(deliveryId).order_id;
export const getLineOrder = (lineId: number) => deliveryRow(lineRow(lineId).delivery_id).order_id;
export const getBreakupOrder = (breakupId: number) => getLineOrder(breakupRow(breakupId).article_line);

// ── setup: approvers, tool permissions, settings ────────────────────
export const approverRows = () => all<Record<string, unknown>>('SELECT a.user_id, a.approval_limit, a.is_final, u.username, u.display_name, u.role FROM so_approvers a JOIN users u ON u.id = a.user_id ORDER BY u.display_name');
export function setApprovers(rows: { userId: number; limit: number; isFinal: boolean }[]): void {
  tx(() => {
    run('DELETE FROM so_approvers');
    for (const r of rows) {
      const u = get<{ role: string }>('SELECT role FROM users WHERE id = ? AND disabled = 0', r.userId) ?? bad('Unknown user.');
      if (!['approver', 'admin'].includes(u.role)) bad('Only users with the approver or admin role can be approvers.');
      if (!Number.isFinite(r.limit) || (r.limit < 0 && r.limit !== -1)) bad('Approval value is 0 (never), -1 (always) or a value above 0.');
      run('INSERT INTO so_approvers (user_id, approval_limit, is_final) VALUES (?, ?, ?)', r.userId, r.limit, r.isFinal ? 1 : 0);
    }
  });
}
export const toolRows = () => all<{ role: string; tool: string }>('SELECT role, tool FROM so_tool_permissions ORDER BY role, tool').reduce((m, r) => { (m[r.role] ??= []).push(r.tool); return m; }, {} as Record<string, string[]>);
export function setTools(tools: Record<string, string[]>): void {
  tx(() => {
    run('DELETE FROM so_tool_permissions');
    for (const [role, list] of Object.entries(tools)) for (const t of new Set(list)) run('INSERT INTO so_tool_permissions (role, tool) VALUES (?, ?)', role, t);
    // an administrator always keeps every tool so the setup can never lock everyone out
    for (const t of ['create', 'edit', 'confirm', 'approve']) run('INSERT OR IGNORE INTO so_tool_permissions (role, tool) VALUES (?, ?)', 'admin', t);
  });
}
export const settingRows = () => Object.fromEntries(all<{ key: string; value: string }>("SELECT key, value FROM so_settings WHERE key IN ('oc_price_validation', 'multi_level_approval')").map((r) => [r.key, r.value]));
export function setSettings(s: Record<string, string>): void {
  for (const k of ['oc_price_validation', 'multi_level_approval']) if (s[k] !== undefined) run('INSERT INTO so_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', k, s[k] === '1' ? '1' : '0');
}
