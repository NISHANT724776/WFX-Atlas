// Sales Order end to end over a sandbox database: buyer-wise screen configuration, order → deliveries → articles →
// colour/size quantities, packing rules, pricing and desync, delivery and order actions, approvals, list views,
// permissions and the activity timeline. Each test names the spec rule it checks.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandbox } from '../helpers.ts';

sandbox('copy');
const { syncSalesMasters } = await import('../../backend/src/sales/masters.ts');
const { createUser } = await import('../../backend/src/auth.ts');
const { run, get } = await import('../../backend/src/db.ts');
const C = await import('../../backend/src/sales/config.ts');
const S = await import('../../backend/src/sales/orders.ts');
syncSalesMasters();
const admin = createUser('so-admin', 'SO Admin', 'admin', 'Passw0rd-long-1');
const editor = createUser('so-editor', 'Sana Editor', 'editor', 'Passw0rd-long-2');
const other = createUser('so-other', 'Omar Other', 'editor', 'Passw0rd-long-3');
const appr1 = createUser('so-appr1', 'Asha Approver', 'approver', 'Passw0rd-long-4');
const appr2 = createUser('so-appr2', 'Bala Final', 'approver', 'Passw0rd-long-5');
const viewer = createUser('so-viewer', 'Vik Viewer', 'viewer', 'Passw0rd-long-6');
const throwsMsg = (fn: () => unknown, re: RegExp) => assert.throws(fn, (e: Error) => re.test(e.message), re.source);

test('masters load from knowledge/sales_order with their sources; the SLC is seeded from the spec field table', () => {
  assert.ok(get("SELECT 1 FROM so_buyers WHERE code = 'GAP-KIDS'"));
  assert.ok(get("SELECT 1 FROM so_boms WHERE id = 'NIS-59#1DP' AND status = 'Approved'"));
  const slc = C.getSlc('New');
  assert.ok(slc.length > 100);
  assert.equal(slc.find((s) => s.field === 'buyer_delivery_date')?.visible, 1, 'Always field visible');
  assert.equal(slc.find((s) => s.field === 'speed_code')?.visible, 0, 'Optional field hidden until shown');
});

test('buyer-wise view: permitted → the buyer’s view; not permitted or no view → Default (Sprint-01 LEVIS / GAP / RED TAPE)', () => {
  const slc = C.getSlc('New');
  // the SLC shows Speed Code (mandatory on New); the PK view shows it and adds nothing else optional
  C.saveSlc('New', slc.map((s) => (s.field === 'speed_code' ? { ...s, visible: 1, mandatory: 1 } : s)), 'so-admin');
  const pk = C.saveView({ name: 'PK View', listType: 'New', buyers: ['LEVIS'], fields: [{ field: 'speed_code', visible: true, mandatory: true, position: 1 }] }, 'so-admin');
  C.setViewUsers(pk.id, [editor.id]);
  C.saveView({ name: 'SK View', listType: 'New', buyers: ['GAP'], fields: [] }, 'so-admin');
  throwsMsg(() => C.saveView({ name: 'Twice', listType: 'New', buyers: ['LEVIS'], fields: [] }, 'so-admin'), /one New view only/);
  assert.equal(C.resolveLayout('New', editor.id, 'LEVIS').view?.name, 'PK View');
  assert.equal(C.resolveLayout('New', other.id, 'LEVIS').view, null, 'not permitted → Default');
  assert.equal(C.resolveLayout('New', editor.id, 'GAP').view, null, 'view exists but no permission → Default');
  assert.equal(C.resolveLayout('New', editor.id, 'RED-TAPE').view, null, 'no view → Default');
  const lv = C.resolveLayout('New', editor.id, 'LEVIS').fields;
  assert.ok(lv[0].key === 'speed_code' && lv[0].mandatory, 'view order and mandatory applied');
  assert.ok(lv.some((f) => f.key === 'buyer_delivery_date'), 'Always fields stay');
});

test('Additional Fields: types, single/multi dropdown, validation (Sprint-3)', () => {
  const f = C.addAdditionalField({ label: 'Retail Channel', fieldType: 'Dropdown', multi: true, options: ['Online', 'Store'] });
  assert.equal(f.type, 'dropdown');
  throwsMsg(() => C.addAdditionalField({ label: 'Bad', fieldType: 'Dropdown', options: [] }), /at least one option/);
  throwsMsg(() => C.addAdditionalField({ label: 'Retail Channel', fieldType: 'Text Box' }), /already exists/);
  const n = C.addAdditionalField({ label: 'Carton Count', fieldType: 'Text Box', validation: 'Numeric' });
  const lf = { ...C.resolveLayout('New', admin.id).fields[0], ...n, mandatory: false, options: [], multi: false } as never;
  assert.match(C.validateValue(lf, 'abc') ?? '', /must be a number/);
  assert.equal(C.validateValue(lf, '12'), null);
});

let orderId = 0;
let d1 = 0;
let line = 0;
test('Add New Order: Category + Buyer create a draft Main OC; a viewer cannot create', () => {
  throwsMsg(() => S.createOrder(viewer, { category: 'Apparel', buyer: 'GAP-KIDS' }), /tool permission/);
  throwsMsg(() => S.createOrder(editor, { category: 'Apparel', buyer: 'NOPE' }), /Choose a Buyer/);
  const r = S.createOrder(editor, { category: 'Apparel', buyer: 'GAP-KIDS' });
  orderId = r.id;
  const o = S.getOrder(editor, orderId);
  assert.equal(o.order.status, 'Draft');
  assert.equal(o.order.header['buyer'], 'GAP-KIDS');
  assert.equal(o.history[0]['action'], 'Sales Order created');
  S.updateHeader(editor, orderId, { order_season: 'AW26', speed_code: 'S1' });
});

test('delivery: OC Delivery Date from ex-factory days; duplicate refused (Sprint-2/3)', () => {
  d1 = S.addDelivery(editor, orderId, { buyer_order_ref: 'PO-1', buyer_delivery_date: '2026-12-20', shipment_mode: 'Sea', destination: 'India' });
  const d = S.getOrder(editor, orderId).deliveries[0];
  assert.equal(d.delivery_no, '001');
  assert.equal(d.oc_delivery_date, '2026-12-13', '7 days before the buyer date (ex-factory master)');
  throwsMsg(() => S.addDelivery(editor, orderId, { buyer_order_ref: 'PO-1', buyer_delivery_date: '2026-12-20', shipment_mode: 'Sea' }), /Duplicate delivery/);
});

test('article: price from the confirmed cost sheet, latest accepted BOM and its routing linked', () => {
  line = S.addArticle(editor, d1, 'NIS-59');
  const l = S.getOrder(editor, orderId).deliveries[0].lines[0];
  assert.equal(l.base_price, 4000);
  assert.match(l.price_source, /Cost sheet/);
  assert.equal(l.bom_id, 'NIS-59#1DP');
  assert.match(String(l.routing), /Routing #1/);
  throwsMsg(() => S.addArticle(editor, d1, 'NIS-59'), /already in this delivery/);
});

test('packing types: Solid/Solid one colour+size; Assorted one colour; PCS = PP × ratio; Add Qty frozen (Sprint-3)', () => {
  const b = S.getOrder(editor, orderId).deliveries[0].lines[0].breakups[0];
  throwsMsg(() => S.saveBreakup(editor, b.id, { packingType: 'Solid Color / Solid Size', cells: [{ colour: '372', size: '34S', qty: 10 }, { colour: '475', size: '34S', qty: 10 }] }), /one colour and one size/);
  throwsMsg(() => S.saveBreakup(editor, b.id, { packingType: 'Solid Color / Assorted Size', cells: [{ colour: '372', size: '34S', ratio: 1, pp: 5 }, { colour: '475', size: '38M', ratio: 1, pp: 5 }] }), /Only one color can be entered/);
  S.saveBreakup(editor, b.id, { packingType: 'Multiple Prepack', cells: [{ colour: '372', size: '34S', ratio: 1, pp: 50 }, { colour: '372', size: '38M', ratio: 2, pp: 50 }, { colour: '3909', size: '34S', ratio: 1, pp: 20 }] });
  let l = S.getOrder(editor, orderId).deliveries[0].lines[0];
  assert.equal(l.totals.qty, 50 + 100 + 20);
  S.addBreakup(editor, line);
  l = S.getOrder(editor, orderId).deliveries[0].lines[0];
  assert.equal(l.breakups[1].packing_type, 'Multiple Prepack', 'Add Qty grid takes the article’s packing type');
  throwsMsg(() => S.deleteBreakup(editor, l.breakups[0].id), /first quantity breakup/);
  S.deleteBreakup(editor, l.breakups[1].id);
});

test('upcharge / discount at the Price Per level; value = qty × (base ± upcharge)', () => {
  const b = S.getOrder(editor, orderId).deliveries[0].lines[0].breakups[0];
  throwsMsg(() => S.saveBreakup(editor, b.id, { cells: [{ colour: '372', size: '34S', ratio: 1, pp: 50, upcharge: 10 }, { colour: '372', size: '38M', ratio: 2, pp: 50, upcharge: 0 }] }), /Price Per is Article/);
  throwsMsg(() => S.saveBreakup(editor, b.id, { cells: [{ colour: '372', size: '34S', ratio: 1, pp: 50, upcharge: -5000 }] }), /discount cannot be more/);
  S.saveBreakup(editor, b.id, { cells: [{ colour: '372', size: '34S', ratio: 1, pp: 50, upcharge: -100 }, { colour: '372', size: '38M', ratio: 2, pp: 50, upcharge: -100 }] });
  const l = S.getOrder(editor, orderId).deliveries[0].lines[0];
  assert.equal(l.totals.qty, 150);
  assert.equal(l.totals.value, 150 * 3900);
});

test('copy delivery keeps the style, not the number, dates or quantities; split by % moves Existing × % ÷ 100', () => {
  const d2 = S.copyDelivery(editor, d1);
  const o = S.getOrder(editor, orderId);
  const copy = o.deliveries.find((d) => d.id === d2)!;
  assert.equal(copy.delivery_no, '002');
  assert.equal(copy.lines[0].article, 'NIS-59');
  assert.equal(copy.totals.qty, 0);
  assert.equal(copy.buyer_delivery_date, null);
  const d3 = S.splitDelivery(editor, d1, 'percentage', 40);
  const after = S.getOrder(editor, orderId);
  assert.equal(after.deliveries.find((d) => d.id === d3)!.totals.qty, 60, '40 % of 150');
  assert.equal(after.deliveries.find((d) => d.id === d1)!.totals.qty, 90);
  throwsMsg(() => S.splitDelivery(editor, d1, 'quantity', 90), /below the delivery quantity/);
  S.deleteDeliveries(editor, [d2]);
});

test('delivery cancel / close need remarks; only a closed delivery reopens (Sprint-2)', () => {
  const o = S.getOrder(editor, orderId);
  const d3 = o.deliveries.find((d) => d.delivery_no === '003')!.id;
  throwsMsg(() => S.cancelDeliveries(editor, [d3], ''), /Remarks are mandatory/);
  throwsMsg(() => S.reopenDeliveries(editor, [d3], 'x'), /Only a closed delivery/);
  S.closeDeliveries(editor, [d3], 'buyer moved it');
  S.reopenDeliveries(editor, [d3], 'back on');
  S.cancelDeliveries(editor, [d3], 'buyer cancelled');
  assert.equal(S.getOrder(editor, orderId).deliveries.find((d) => d.id === d3)!.status, 'Cancelled');
});

test('confirm: mandatory fields first; approval value 0 / -1 / > limit; single-level approval confirms (Sprint-2)', () => {
  assert.equal(S.approvalRequired(0, 1e9), false);
  assert.equal(S.approvalRequired(-1, 1), true);
  assert.equal(S.approvalRequired(1000, 1000), false);
  assert.equal(S.approvalRequired(1000, 1000.01), true);
  S.setApprovers([{ userId: appr1.id, limit: 1000, isFinal: false }, { userId: appr2.id, limit: -1, isFinal: true }]);
  throwsMsg(() => S.confirmOrder(editor, orderId, null), /Choose the approver/);
  const r = S.confirmOrder(editor, orderId, appr1.id);
  assert.equal(r.status, 'Pending Approval');
  assert.equal(S.pendingApprovals(appr1).length, 1);
  throwsMsg(() => S.approveOrder(appr2, orderId, 'ok'), /not waiting for your approval/);
  S.approveOrder(appr1, orderId, 'fine');
  const o = S.getOrder(editor, orderId);
  assert.equal(o.order.status, 'Confirmed');
  assert.equal(o.deliveries.find((d) => d.delivery_no === '001')!.status, 'Open');
});

test('multi-level: a non-final approver names the next; reject needs remarks', () => {
  S.setSettings({ multi_level_approval: '1' });
  const o2 = S.createOrder(editor, { category: 'Apparel', buyer: 'GAP-KIDS' }).id;
  S.updateHeader(editor, o2, { order_season: 'AW26', speed_code: 'S1' });
  const d = S.addDelivery(editor, o2, { buyer_order_ref: 'PO-9', buyer_delivery_date: '2027-01-10', shipment_mode: 'Air', destination: 'India' });
  const l = S.addArticle(editor, d, 'NIS-58');
  const b = S.getOrder(editor, o2).deliveries[0].lines[0].breakups[0];
  S.saveBreakup(editor, b.id, { cells: [{ colour: '372', size: '34S', qty: 100 }] });
  assert.ok(l);
  const mandatory = S.confirmOrder(editor, o2, appr1.id);
  assert.ok(mandatory.problems === undefined || mandatory.problems.length === 0, JSON.stringify(mandatory.problems));
  // 100 × 33.3333 = 3,333.33 > 1,000 → approval
  assert.equal(S.getOrder(editor, o2).order.status, 'Pending Approval');
  throwsMsg(() => S.approveOrder(appr1, o2, 'ok'), /next approver/);
  S.approveOrder(appr1, o2, 'ok', appr2.id);
  throwsMsg(() => S.rejectOrder(appr2, o2, ''), /mandatory to reject/);
  S.rejectOrder(appr2, o2, 'price too low');
  assert.equal(S.getOrder(editor, o2).order.status, 'Rejected');
  S.setSettings({ multi_level_approval: '0' });
});

test('revise: reason and authorised-by mandatory; Confirmed * blocks deleting a draft delivery (Sprint-3)', () => {
  throwsMsg(() => S.reviseOrder(editor, orderId, '', ''), /mandatory/);
  S.reviseOrder(editor, orderId, 'buyer added colour', 'Head of Sales');
  assert.equal(S.getOrder(editor, orderId).order.displayStatus, 'Confirmed *');
  const nd = S.addDelivery(editor, orderId, { buyer_order_ref: 'PO-2', buyer_delivery_date: '2027-02-01', shipment_mode: 'Sea' });
  throwsMsg(() => S.deleteDeliveries(editor, [nd]), /Confirmed \*/);
});

test('desync: a changed cost sheet price marks the line; sync takes the new price and logs it', () => {
  run("UPDATE so_cost_sheets SET selling_price = 4200 WHERE article = 'NIS-59'");
  let l = S.getOrder(editor, orderId).deliveries[0].lines[0];
  assert.equal(l.desynced, true);
  assert.equal(S.syncPrices(editor, orderId).synced >= 1, true);
  l = S.getOrder(editor, orderId).deliveries[0].lines[0];
  assert.equal(l.base_price, 4200);
  assert.ok(S.getOrder(editor, orderId).history.some((h) => h['action'] === 'Price synced'));
});

test('order cancel and close rules (Sprint-3)', () => {
  const o3 = S.createOrder(editor, { category: 'Apparel', buyer: 'GAP-KIDS' }).id;
  S.addDelivery(editor, o3, { buyer_order_ref: 'X', buyer_delivery_date: '2027-03-01', shipment_mode: 'Sea' });
  throwsMsg(() => S.cancelOrder(admin, o3, ''), /Remarks are mandatory/);
  S.cancelOrder(admin, o3, 'not needed');
  const o = S.getOrder(admin, o3);
  assert.equal(o.order.status, 'Cancelled');
  assert.ok(o.deliveries.every((d) => d.status === 'Cancelled'), 'all delivery OCs cancelled');
  throwsMsg(() => S.closeOrder(admin, o3, 'x'), /cannot close a Cancelled or Closed Order/);
});

test('list: Main OC wise and Style wise over the same orders, search, filters, paging', () => {
  const main = S.listOrders(editor, { mode: 'main', size: 5 });
  assert.equal(main.total, 3);
  const style = S.listOrders(editor, { mode: 'style' });
  assert.ok(style.rows.some((r) => r.article === 'NIS-59') && style.rows.some((r) => r.article === 'NIS-58'));
  assert.equal(S.listOrders(editor, { q: 'NIS-58' }).total, 1);
  assert.equal(S.listOrders(editor, { status: 'Cancelled' }).total, 1);
  assert.equal(S.listOrders(editor, { status: 'Confirmed *' }).total, 1);
  assert.equal(S.listOrders(editor, { buyer: 'LEVIS' }).total, 0);
  assert.equal(S.listOrders(editor, { size: 5, page: 2 }).rows.length, 0);
  // a List view limited to the user's own orders
  const lv = C.saveView({ name: 'Mine', listType: 'List', fields: [], listScope: 'created' }, 'so-admin');
  C.setViewUsers(lv.id, [other.id]);
  assert.equal(S.listOrders(other, {}).total, 0);
});

test('every action is in the activity timeline with user, time and remarks', () => {
  const h = S.getOrder(editor, orderId).history;
  for (const a of ['Sales Order created', 'Delivery added', 'Article added', 'Quantities saved', 'Delivery copied', 'Delivery split', 'Delivery deleted', 'Delivery closed', 'Delivery reopened', 'Delivery cancelled', 'Sent for approval', 'Revision started', 'Price synced'])
    assert.ok(h.some((x) => x['action'] === a), `history has "${a}"`);
  assert.ok(h.some((x) => String(x['action']).startsWith('Approved') && x['remarks'] === 'fine'));
  assert.ok(h.every((x) => x['user'] && x['at']));
});
