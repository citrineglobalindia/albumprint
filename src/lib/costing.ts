import { ORDERS, type Costing, type CostLine, type Order } from "./data";
import { currentActor, logAudit } from "./audit";
import { notify, patchOrder } from "./store";
import { backendOn } from "./supabase";
import { DESIGN_CHARGE, GRADING_PER_IMAGE, GST_RATE, albumName } from "./pricing";
import { INVOICES, createInvoice, type Draft } from "./finance";
import { no, ok, type Out } from "./production";

// Album costing: reception records only the sheet count; the admin splits each album into priced lines taken from the product catalog,
// the costing finalizes into the order total, and invoices are generated from it (one for all albums, or one per album).
const ord = (id: string) => ORDERS.find((o) => o.id === id);
export const isAdmin = () => currentActor().role === "admin";
const money = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export function emptyCosting(o: Order): Costing {
  const designed = o.workflow === "Design + Printing";
  return { lines: [], designCharge: designed ? DESIGN_CHARGE : 0, gradingImages: 0, gradingRate: designed ? GRADING_PER_IMAGE : 0, discountPct: 0, gstPct: Math.round(GST_RATE * 10000) / 100 };
}
export const costingOf = (o: Order): Costing => o.costing ?? emptyCosting(o);

export function costTotals(c: Costing) {
  const albumSub = new Map<number, number>();
  c.lines.forEach((l) => albumSub.set(l.albumPos, (albumSub.get(l.albumPos) ?? 0) + l.qty * l.sell));
  const lines = [...albumSub.values()].reduce((a, b) => a + b, 0);
  const design = c.designCharge, grading = c.gradingImages * c.gradingRate;
  const sub = lines + design + grading, discount = Math.round((sub * c.discountPct) / 100), taxable = sub - discount, tax = Math.round((taxable * c.gstPct) / 100);
  return { lines, design, grading, sub, discount, taxable, tax, total: taxable + tax, albumSub };
}
/** Sheets of this album already assigned to lines (cover, inside paper…). */
export const allocated = (c: Costing, albumPos: number) => c.lines.filter((l) => l.albumPos === albumPos && l.countsSheets).reduce((a, l) => a + l.qty, 0);
/** Cover, inside paper and similar categories count toward the album's sheets; boxes, bags, USB etc. do not. */
export const countsSheetsFor = (name: string) => /^(PAPER|COVER|MINI BOOK|MINI BOOK COVER|CUT PAD|PAD)\b/i.test(name.trim());
export const newLineId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `L${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`);

type Backend = { save: (o: Order, c: Costing) => Promise<string | null>; finalize: (o: Order) => Promise<{ total: number } | { error: string }>; reopen: (o: Order) => Promise<string | null> };
let backend: Backend | null = null;
export const registerCostingBackend = (b: Backend) => { backend = b; };

function validate(c: Costing): string | null {
  for (const l of c.lines) {
    if (!l.name.trim()) return "Every line needs an item name";
    if (!(l.qty > 0)) return `“${l.name}”: quantity must be above 0`;
    if (!(l.sell >= 0)) return `“${l.name}”: enter a selling price`;
    if (l.cost !== undefined && !(l.cost >= 0)) return `“${l.name}”: the purchase price must be 0 or more`;
  }
  if (![c.designCharge, c.gradingImages, c.gradingRate].every((n) => Number.isFinite(n) && n >= 0)) return "Design and grading charges must be 0 or more";
  if (!(c.discountPct >= 0 && c.discountPct <= 100) || !(c.gstPct >= 0 && c.gstPct <= 100)) return "Discount and GST must be between 0 and 100%";
  return null;
}

export async function saveCosting(orderId: string, c: Costing): Promise<Out> {
  if (!isAdmin()) return no("Only an admin can cost an order");
  const o = ord(orderId); if (!o) return no("Order not found");
  if (o.closed) return no(`${o.id} is closed and read-only`);
  if (o.costing?.finalized) return no("The costing is finalized: reopen it to change it");
  const bad = validate(c); if (bad) return no(bad);
  const next: Costing = { ...c, finalized: false };
  if (backendOn) {
    if (!backend) return no("Not connected to the database");
    const e = await backend.save(o, next); if (e) return no(e);
  }
  patchOrder(o.id, { costing: next });
  logAudit({ entity: "order", entityId: o.id, action: "costing_saved", detail: `${next.lines.length} lines · ${money(costTotals(next).total)}` });
  return ok("Costing saved");
}

export async function finalizeCosting(orderId: string): Promise<Out> {
  if (!isAdmin()) return no("Only an admin can finalize the costing");
  const o = ord(orderId); if (!o?.costing) return no("Save the costing first");
  if (!o.costing.lines.length) return no("Add at least one line before finalizing");
  let total = costTotals(o.costing).total;
  if (backendOn) {
    if (!backend) return no("Not connected to the database");
    const r = await backend.finalize(o); if ("error" in r) return no(r.error); total = r.total;
  }
  patchOrder(o.id, { costing: { ...o.costing, finalized: true }, total });
  logAudit({ entity: "order", entityId: o.id, action: "costing_finalized", detail: `Order total ${money(total)}` });
  return ok(`Costing finalized: order total ${money(total)}`);
}

export async function reopenCosting(orderId: string): Promise<Out> {
  if (!isAdmin()) return no("Only an admin can reopen the costing");
  const o = ord(orderId); if (!o?.costing?.finalized) return no("The costing is not finalized");
  if (INVOICES.some((i) => i.orderId === o.id && i.kind === "invoice")) return no("Invoices exist for this order: void them before reopening the costing");
  if (backendOn) { if (!backend) return no("Not connected to the database"); const e = await backend.reopen(o); if (e) return no(e); }
  patchOrder(o.id, { costing: { ...o.costing, finalized: false } });
  logAudit({ entity: "order", entityId: o.id, action: "costing_reopened" });
  return ok("Costing reopened");
}

/** Draft invoice(s) from the finalized costing: one for all albums, or one per album (design and grading go on the first). */
export async function generateInvoices(orderId: string, mode: "all" | "each", terms = 15): Promise<Out> {
  const o = ord(orderId); if (!o?.costing?.finalized) return no("Finalize the costing before generating invoices");
  if (INVOICES.some((i) => i.orderId === o.id && i.kind === "invoice")) return no("Invoices already exist for this order");
  const c = o.costing, albums = o.albums ?? [];
  const nameOf = (pos: number) => albumName(albums[pos - 1] ?? { title: "" }, pos - 1, o.couple ?? "", o.event);
  const lineDesc = (l: CostLine) => `${l.name}${l.dimension ? ` [${l.dimension}]` : ""}${l.remarks ? ` (${l.remarks})` : ""}`;
  const extras = (): Draft["lines"] => [
    ...(c.designCharge > 0 ? [{ desc: "Album design charge", qty: 1, price: c.designCharge }] : []),
    ...(c.gradingImages > 0 && c.gradingRate > 0 ? [{ desc: "Colour grading (per image)", qty: c.gradingImages, price: c.gradingRate }] : []),
  ];
  const positions = [...new Set(c.lines.map((l) => l.albumPos))].sort((a, b) => a - b);
  const mk = (lines: Draft["lines"], notes: string): Draft => ({ orderId: o.id, terms, discPct: c.discountPct, gstPct: c.gstPct, igst: false, lines, notes });
  const drafts: Draft[] = mode === "all"
    ? [mk([...positions.flatMap((p) => c.lines.filter((l) => l.albumPos === p).map((l) => ({ desc: `${positions.length > 1 ? `${nameOf(p)} · ` : ""}${lineDesc(l)}`, qty: l.qty, price: l.sell }))), ...extras()], "All albums")]
    : positions.map((p, i) => mk([...c.lines.filter((l) => l.albumPos === p).map((l) => ({ desc: lineDesc(l), qty: l.qty, price: l.sell })), ...(i === 0 ? extras() : [])], `Album: ${nameOf(p)}`));
  if (!drafts.length) return no("There are no lines to invoice");
  let made = 0;
  for (const d of drafts) { const r = await createInvoice(d); if (!r.ok) return no(made ? `${made} invoice(s) created, then: ${r.msg}` : r.msg); made++; }
  notify();
  return ok(made === 1 ? "Invoice created as a draft" : `${made} invoices created as drafts (one per album)`);
}
