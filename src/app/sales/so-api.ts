// Client for the Sales Order API (/api/v2/so/*). Shapes mirror backend/src/sales/*.ts.
import { Injectable, inject } from '@angular/core';
import { KbService } from '../core/kb.service';

export interface SoMasters { categories: { code: string; name: string }[]; buyers: { code: string; name: string; category: string; departments: string[]; seasons: string[]; currency: string; source: string }[]; lookups: Record<string, string[]>; statuses: string[]; today: string }
export interface SoListRow { id: number; soNo: string; status: string; buyer: string; buyerName: string; article: string; articleName: string; season: string; buyerOrderDate: string; qty: number; value: number; deliveries: number; buyerDeliveryDate: string; ocDeliveryDate: string; createdAt: string; createdBy: string; asnQty: number; gdnQty: number }
export interface LayoutField { key: string; label: string; level: string; section: string; type: string; lookup: string | null; multi: boolean; options: string[]; validation: string; mandatory: boolean; editable: boolean; position: number; always: boolean }
export interface QtyCell { breakup_id: number; colour: string; size: string; qty: number; ratio: number | null; pp: number | null; upcharge: number; inseam: string }
export interface Breakup { id: number; seq: number; packing_type: string; additional: number; packing_code: string; prepack_code: string; cartons: number | null; inseam: string; cells: QtyCell[] }
export interface Bom { id: string; bom_no: string; version: number; status: string; accepted: number; accepted_on: string; selling_price: number | null; routing: string }
export interface Line { id: number; article: string; name: string; isKit: boolean; kitName: string | null; kitId: string | null; uom: string; buyerStyleRef: string | null; bom_id: string | null; bom_selected: number; price_source: string; price_per: string; base_price: number;
  extra_production_pct: number; fields: Record<string, unknown>; colours: { code: string; name: string }[]; sizes: { code: string; name: string }[]; inseams: string[]; boms: Bom[]; routing: string | null; breakups: Breakup[];
  totals: { qty: number; additional: number; value: number; planned: number }; desynced: boolean; sourcePrice: number | null }
export interface Delivery { id: number; delivery_no: string; status: string; buyer_order_ref: string; buyer_delivery_date: string | null; oc_delivery_date: string | null; shipment_mode: string; destination: string; fields: Record<string, unknown>; remarks: string; split_from: number | null; lines: Line[]; totals: { qty: number; additional: number; value: number; planned: number } }
export interface HistoryRow { id: number; delivery_id: number | null; action: string; ref: string; before: Record<string, unknown> | null; after: Record<string, unknown> | null; remarks: string; user: string; at: string }
export interface OrderDetail {
  order: { id: number; so_no: string; category: string; buyer: string; status: string; displayStatus: string; revised: number; header: Record<string, unknown>; instructions: Record<string, string>; currency: string; approver_id: number | null; approval_level: number; created_by: string; created_at: string; updated_at: string };
  buyer: { code: string; name: string; departments: string[]; seasons: string[]; currency: string };
  layout: { view: { id: number; name: string } | null; reason: string; fields: LayoutField[] };
  deliveries: Delivery[]; totals: { qty: number; value: number; deliveries: number };
  approvals: { id: number; level: number; approver_id: number; approver: string; status: string; remarks: string; acted_at: string | null; created_at: string }[];
  history: HistoryRow[]; tools: string[]; articles: { code: string; name: string; is_kit: number }[];
  approvers: { id: number; username: string; display_name: string; approval_limit: number; is_final: number }[];
}

@Injectable({ providedIn: 'root' })
export class SoApi {
  private readonly kb = inject(KbService);
  masters() { return this.kb.get<SoMasters>('/so/masters'); }
  tools() { return this.kb.get<{ tools: string[] }>('/so/tools').then((r) => r.tools); }
  list(p: { mode: string; q: string; status: string; buyer: string; page: number; size: number; sort: string }) {
    return this.kb.get<{ total: number; page: number; size: number; rows: SoListRow[] }>(`/so/orders?${new URLSearchParams(Object.entries(p).map(([k, v]) => [k, String(v)]))}`);
  }
  approvals() { return this.kb.get<{ pending: { approval_id: number; id: number; so_no: string; buyer: string; level: number; value: number; sent_at: string }[]; done: unknown[] }>('/so/approvals'); }
  create(category: string, buyer: string) { return this.kb.post<{ id: number; soNo: string }>('/so/orders', { category, buyer }); }
  order(id: number) { return this.kb.get<OrderDetail>(`/so/orders/${id}`); }
  saveHeader(id: number, values: Record<string, unknown>, instructions?: Record<string, string>) { return this.kb.patch<OrderDetail>(`/so/orders/${id}`, { values, instructions }); }
  orderAction(id: number, body: Record<string, unknown>) { return this.kb.post<{ order: OrderDetail; status?: string; problems?: string[]; synced?: number; deliveryId?: number }>(`/so/orders/${id}/action`, body); }
  deliveryAction(body: Record<string, unknown>) { return this.kb.post<{ order: OrderDetail; deliveryId?: number; lineId?: number }>('/so/deliveries/action', body); }
  lineAction(id: number, body: Record<string, unknown>) { return this.kb.post<{ order: OrderDetail }>(`/so/lines/${id}`, body); }
  saveBreakup(id: number, body: Record<string, unknown>) { return this.kb.post<{ order: OrderDetail }>(`/so/breakups/${id}`, body); }
}
