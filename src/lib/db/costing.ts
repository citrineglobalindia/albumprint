import type { Costing, Order } from "../data";
import { registerCostingBackend, newLineId } from "../costing";
import { sb } from "./core";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const msg = (e: { message: string } | null) => (e ? e.message : null);
const orderUid = (o: Order) => o.uid ?? "";

registerCostingBackend({
  async save(o: Order, c: Costing) {
    const oid = orderUid(o); if (!oid) return "This order has not been saved yet";
    const { data: albums, error: ae } = await sb().from("order_albums").select("id,position").eq("order_id", oid);
    if (ae) return ae.message;
    const albumId = new Map((albums ?? []).map((a: Row) => [a.position as number, a.id as string]));
    for (const l of c.lines) if (!albumId.has(l.albumPos)) return `Album ${l.albumPos} was not found`;

    let e = msg((await sb().from("order_costing").upsert({ order_id: oid, design_charge: c.designCharge, grading_images: c.gradingImages, grading_rate: c.gradingRate, discount_pct: c.discountPct, gst_pct: c.gstPct }, { onConflict: "order_id" })).error);
    if (e) return e;
    // lines removed in the editor
    const { data: existing, error: le } = await sb().from("album_lines").select("id").eq("order_id", oid);
    if (le) return le.message;
    const keep = new Set(c.lines.map((l) => l.id));
    const gone = (existing ?? []).map((r: Row) => r.id as string).filter((id) => !keep.has(id));
    if (gone.length) { e = msg((await sb().from("album_lines").delete().in("id", gone)).error); if (e) return e; }
    if (!c.lines.length) return null;
    // positions are 1.. within each album (lines are only ever appended or removed, so they never collide)
    const seq = new Map<number, number>();
    const rows = c.lines.map((l) => {
      const p = (seq.get(l.albumPos) ?? 0) + 1; seq.set(l.albumPos, p);
      return { id: l.id, order_id: oid, album_id: albumId.get(l.albumPos)!, position: p, item_id: l.itemId ?? null, name: l.name, unit: l.unit, qty: l.qty, counts_sheets: l.countsSheets, remarks: l.remarks || null, dimension: l.dimension || null, sell_price: l.sell };
    }).sort((a, b) => a.position - b.position);
    e = msg((await sb().from("album_lines").upsert(rows, { onConflict: "id" })).error); if (e) return e;
    e = msg((await sb().from("album_line_costs").upsert(c.lines.map((l) => ({ line_id: l.id, cost_price: l.cost ?? 0 })), { onConflict: "line_id" })).error);
    return e;
  },
  async finalize(o: Order) {
    const { data, error } = await sb().rpc("finalize_costing", { p_order: orderUid(o) });
    if (error) return { error: error.message };
    return { total: Number((data as Row).total) };
  },
  async reopen(o: Order) { return msg((await sb().rpc("reopen_costing", { p_order: orderUid(o) })).error); },
});
export { newLineId };
