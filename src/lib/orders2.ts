import { persistArray } from "./persist";
import { backendOn } from "./supabase";
import { notify } from "./store";
import { currentActor, logAudit } from "./audit";
import { CUSTOMERS, ORDERS, type Customer, type Order } from "./data";
import { INVOICES, type Invoice, type Line } from "./finance";
import { loadSettings } from "./localState";
import { DISCOUNT_APPROVAL_PCT, blankAlbum, type AlbumSpec } from "./pricing";
import { CATEGORIES, ITEMS, RATES, newId, pricingSettings, registerItemUsage } from "./catalog2";
import { priceOrder, type DraftAlbum, type OrderDraft, type PricedOrder } from "./orderPricing";
import { mobileError, TODAY } from "./format";
import { notifyOrderCreated } from "./events";
import { registerInvoicePending } from "./pendingInvoice";
import { customerByMobile } from "./customerGroups";
import { progressOf } from "./jobProgress";

// Order builder data: drafts, finalizing (order + albums + priced lines + invoice in one step), the pricing snapshot, and the authorized reopen.
// Database mode: the server re-prices and writes everything in one transaction (finalize_order_v2); a repeated request returns the same order.
export interface Business { name?: string; legal?: string; address?: string; phone?: string; email?: string; website?: string; gstin?: string; pan?: string; state?: string }
export interface InvoiceSnapshot extends PricedOrder {
  business: Business; customer: { id?: string; code?: string; name: string; phone?: string; email?: string; address?: string };
  event: OrderDraft["event"]; showBusinessName?: boolean; orderCode?: string; orderDate?: string; dueDate?: string; invoiceNumber?: string; invoiceDate?: string; revision?: number;
}
export interface FinalizeResult { orderId: string; code: string; invoiceId?: string; invoiceNumber: string; total: number; revision: number; invoicePending?: boolean }
export interface StoredDraft { id: string; title: string; payload: OrderDraft; updatedAt: string; result?: FinalizeResult; mine?: boolean }
export interface PricingRecord {
  orderId: string;                      // order code
  revision: number; status: "finalized" | "reopened" | "invoice_pending"; payload: OrderDraft; snapshot: InvoiceSnapshot; invoiceNo?: string; invoiceUid?: string;
  finalizedAt: string; reopenReason?: string;
}
export const DRAFTS: StoredDraft[] = persistArray<StoredDraft>("order_drafts", []);
export const PRICING: PricingRecord[] = persistArray<PricingRecord>("order_pricing", []);
export const pricingOf = (orderCode: string) => PRICING.find((p) => p.orderId === orderCode);
/** A Design + Printing order created before its invoice (the invoice is prepared once the design is done). */
export const isInvoicePending = (orderCode: string) => pricingOf(orderCode)?.status === "invoice_pending";
registerInvoicePending(isInvoicePending);
/** This draft creates the order now and leaves the invoice for later: Design + Printing only, on by default, never when editing an order. */
export const invoiceLaterOn = (d: OrderDraft) => d.orderType === "design_printing" && !d.reopenOrder && d.invoiceLater !== false;
registerItemUsage(() => new Set(PRICING.flatMap((p) => [...p.snapshot.albums.flatMap((a) => a.lines.map((l) => l.itemId)), ...p.snapshot.orderLines.map((l) => l.itemId)])));

// ───────── drafts ─────────
const todayIso = () => { const d = TODAY; return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const addDays = (iso: string, n: number) => { const d = new Date(`${iso}T00:00:00`); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
export const orderToday = todayIso;
/** A new album starts with no sheet count, so nothing is priced until the user enters it. */
export const newAlbum = (n: number, copyOf?: DraftAlbum): DraftAlbum => copyOf
  ? { ...copyOf, id: newId(), name: `${copyOf.name} (copy)`, items: copyOf.items.map((i) => ({ ...i })) }
  : { id: newId(), name: n === 1 ? "" : `Album ${n}`, sheets: "" as unknown as number, copies: 1, size: "", paper: "", finish: "", orientation: "Landscape", notes: "", items: [] };
export const blankDraft = (): OrderDraft => ({
  orderType: "", customerId: "", newCustomer: null, event: { type: "", name: "", date: "", delivery: "", notes: "", workGroup: "", priority: "Normal" },
  albums: [newAlbum(1)], orderCharges: [], discount: { type: "none", value: "" }, applyTax: true,
});
/** One album per ticked event: an event without an album of its name gets one (a blank album is used first). Nothing is removed.
 *  Returns the new album list and the events that got an album, or null when nothing changes. */
export function albumsForEvents(d: OrderDraft): { albums: DraftAlbum[]; added: string[] } | null {
  const events = d.event.name.split(",").map((x) => x.trim()).filter(Boolean);
  if (!events.length) return null;
  const albums = d.albums.map((a) => ({ ...a }));
  const blank = (a: DraftAlbum) => !a.name.trim() && !String(a.sheets ?? "").trim() && !a.items.length;
  const added: string[] = [];
  for (const ev of events) {
    if (albums.some((a) => a.name.trim().toLowerCase() === ev.toLowerCase())) continue;
    const free = albums.find(blank);
    if (free) free.name = ev; else albums.push({ ...newAlbum(albums.length + 1), name: ev });
    added.push(ev);
  }
  return added.length ? { albums, added } : null;
}
/** The day the order was taken: the picked order date, or today. */
export const orderDateOf = (d: OrderDraft) => (d.event.orderDate && /^\d{4}-\d{2}-\d{2}$/.test(d.event.orderDate) ? d.event.orderDate : todayIso());
export function customerName(d: OrderDraft): string {
  if (d.newCustomer) return d.newCustomer.name.trim();
  const c = CUSTOMERS.find((x) => (x.uid ?? x.id) === d.customerId);
  return c?.studio ?? "";
}
export const draftTitle = (d: OrderDraft) => [customerName(d) || "New order", d.event.name || d.event.type].filter(Boolean).join(" · ");
export const price = (d: OrderDraft) => priceOrder(d, { items: ITEMS, rates: RATES, categories: CATEGORIES }, pricingSettings());

/** What is still missing before the order can be finalized (the server checks the same). */
export function draftProblems(d: OrderDraft): { step: number; message: string }[] {
  const out: { step: number; message: string }[] = [];
  if (!d.orderType) out.push({ step: 0, message: "Choose the order type" });
  if (!d.customerId && !d.newCustomer) out.push({ step: 1, message: "Choose a customer or add a new one" });
  if (d.newCustomer) {
    if (d.newCustomer.name.trim().length < 2) out.push({ step: 1, message: "Enter the customer name" });
    const m = mobileError(d.newCustomer.phone); if (m) out.push({ step: 1, message: m });
    if (d.newCustomer.email.trim() && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(d.newCustomer.email.trim())) out.push({ step: 1, message: "Enter a valid email address (or leave it empty)" });
  }
  const od = orderDateOf(d);                                              // the day the order was taken: today unless picked (may be earlier)
  if (d.event.orderDate && !/^\d{4}-\d{2}-\d{2}$/.test(d.event.orderDate)) out.push({ step: 2, message: "The order date is not valid" });
  else if (od > todayIso()) out.push({ step: 2, message: "The order date cannot be in the future" });
  if (d.event.date && !/^\d{4}-\d{2}-\d{2}$/.test(d.event.date)) out.push({ step: 2, message: "The event date is not valid" });
  if (d.event.photosGiven?.trim() && !/^\d+$/.test(d.event.photosGiven.trim())) out.push({ step: 2, message: "Photos given must be a whole number (or leave it empty)" });
  d.albums.forEach((a, i) => { if (a.eventDate && !/^\d{4}-\d{2}-\d{2}$/.test(a.eventDate)) out.push({ step: 3, message: `Album ${i + 1}: the event date is not valid` }); });
  if (d.event.delivery && d.event.delivery < od) out.push({ step: 2, message: "The delivery date cannot be before the order date" });
  if (invoiceLaterOn(d)) {                                                // no prices yet: only what is entered must be valid
    d.albums.forEach((a, i) => {
      const s = String(a.sheets ?? "").trim();
      if (s && !/^\d+$/.test(s)) out.push({ step: 3, message: `Album ${i + 1}: sheets must be a whole number (or leave it empty until the design is done)` });
      const c = String(a.copies ?? "").trim();
      if (c && !/^[1-9]\d*$/.test(c)) out.push({ step: 3, message: `Album ${i + 1}: copies must be 1 or more (or leave it empty)` });
    });
    return out;
  }
  const p = price(d);
  for (const e of p.errors) out.push({ step: e.path === "discount" ? 4 : e.path === "orderType" ? 0 : 3, message: e.message });
  return out;
}

type Backend = {
  listDrafts: () => Promise<StoredDraft[] | string>;
  saveDraft: (id: string | undefined, payload: OrderDraft, title: string) => Promise<{ id: string } | { error: string }>;
  deleteDraft: (id: string) => Promise<string | null>;
  finalize: (id: string) => Promise<FinalizeResult | { error: string }>;
  finalizeLater: (id: string) => Promise<FinalizeResult | { error: string }>;
  prepareInvoice: (orderUid: string) => Promise<{ draftId: string } | { error: string }>;
  reopen: (orderUid: string, reason: string) => Promise<{ draftId: string } | { error: string }>;
  cancelReopen: (orderUid: string) => Promise<string | null>;
  serverPrice: (payload: OrderDraft) => Promise<PricedOrder | { error: string }>;
  business: () => Promise<Business>;
  refresh: () => Promise<void>;
};
let backend: Backend | null = null;
export const registerOrders2Backend = (b: Backend) => { backend = b; };
const NOT_CONNECTED = "Not connected to the database";

export async function listDrafts(): Promise<string | null> {
  if (!backendOn) return null;
  if (!backend) return NOT_CONNECTED;
  const r = await backend.listDrafts(); if (typeof r === "string") return r;
  DRAFTS.splice(0, DRAFTS.length, ...r); notify(); return null;
}
export const openDrafts = () => DRAFTS.filter((d) => !d.result).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export async function saveDraft(id: string | undefined, payload: OrderDraft): Promise<{ id: string } | { error: string }> {
  const title = draftTitle(payload);
  if (backendOn) {
    if (!backend) return { error: NOT_CONNECTED };
    const r = await backend.saveDraft(id, payload, title); if ("error" in r) return r;
    upsertLocal({ id: r.id, title, payload, updatedAt: new Date().toISOString(), mine: true }); return r;
  }
  const existing = id ? DRAFTS.find((x) => x.id === id) : undefined;
  if (existing?.result) return { error: "This draft is already finalized" };
  const rec: StoredDraft = { id: id ?? newId(), title, payload: JSON.parse(JSON.stringify(payload)) as OrderDraft, updatedAt: new Date().toISOString(), mine: true };
  upsertLocal(rec); return { id: rec.id };
}
function upsertLocal(rec: StoredDraft) { const i = DRAFTS.findIndex((x) => x.id === rec.id); if (i >= 0) DRAFTS[i] = { ...DRAFTS[i], ...rec }; else DRAFTS.unshift(rec); notify(); }
export async function deleteDraft(id: string): Promise<string | null> {
  const d = DRAFTS.find((x) => x.id === id); if (d?.result) return "A finalized draft is part of the order record";
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.deleteDraft(id); if (e) return e; }
  const i = DRAFTS.findIndex((x) => x.id === id); if (i >= 0) DRAFTS.splice(i, 1); notify(); return null;
}

export async function serverPrice(payload: OrderDraft): Promise<PricedOrder | { error: string } | null> {
  if (!backendOn) return null;
  if (!backend) return { error: NOT_CONNECTED };
  return backend.serverPrice(payload);
}

let bizCache: Business | null = null;
export async function businessProfile(): Promise<Business> {
  if (backendOn) { if (!bizCache && backend) bizCache = await backend.business(); return bizCache ?? {}; }
  return localBusiness();
}
function localBusiness(): Business {
  const s = loadSettings();
  const str = (k: string) => (typeof s[k] === "string" && (s[k] as string).trim() ? (s[k] as string).trim() : undefined);
  return { name: str("name") ?? "AlbumPro Studio", legal: str("legal"), address: str("caddr") ?? str("address"), phone: str("phone"), email: str("email"), website: str("website"), gstin: str("gstin"), pan: str("pan"), state: str("state") };
}
/** The invoice as it would look now (preview: no invoice number yet). */
/** Who may choose, per order, whether the invoice shows the company name: admins and the roles the admin allows (Tax & defaults). */
export const canChooseBusinessName = (role: string | null | undefined) => role === "admin" || (!!role && (pricingSettings().brandRoles ?? []).includes(role));
/** Whether this order's invoice shows the company name: the order's choice if the user may make it, else the default. The server decides the same at finalize. */
export const businessNameShown = (payload: OrderDraft, role: string | null | undefined) =>
  canChooseBusinessName(role) && typeof payload.showBusinessName === "boolean" ? payload.showBusinessName : pricingSettings().showBusinessName !== false;
const brand = (b: Business, shown: boolean): Business => (shown ? b : { ...b, name: undefined });
export async function previewSnapshot(payload: OrderDraft, priced?: PricedOrder): Promise<InvoiceSnapshot> {
  const c = CUSTOMERS.find((x) => (x.uid ?? x.id) === payload.customerId);
  const customer = payload.newCustomer ? { name: payload.newCustomer.name.trim(), phone: payload.newCustomer.phone, email: payload.newCustomer.email || undefined, address: payload.newCustomer.address || undefined }
    : { id: c?.uid, code: c?.id, name: c?.studio ?? "", phone: c?.mobile, email: c?.email || undefined, address: [c?.address, c?.city, c?.state].filter(Boolean).join(", ") || undefined };
  const shown = businessNameShown(payload, currentActor().role);
  return { ...(priced ?? price(payload)), business: brand(await businessProfile(), shown), showBusinessName: shown, customer, event: payload.event, orderDate: orderDateOf(payload), dueDate: payload.event.delivery || addDays(orderDateOf(payload), pricingSettings().defaultDeliveryDays) };
}

/** Everything charged below catalog prices (line discounts, lowered prices, the order discount) as a % of the order at catalog prices — the approval limit applies to this. */
export const discountPct = (p: PricedOrder) => (p.listSubtotal > 0 ? (p.reduction * 100) / p.listSubtotal : 0);
const lineNote = (l: PricedOrder["orderLines"][number], mult: number) => [l.rule, l.discount ? `less ${l.discountType === "percent" ? `${l.discountValue}% ` : ""}discount ₹${(Math.round(l.discount * mult * 100) / 100).toLocaleString("en-IN")}` : null].filter(Boolean).join(" · ") || undefined;
/** Invoice lines in the same form the database writes them (gross; line discounts go into the invoice discount). */
export function invoiceLines(p: PricedOrder): Line[] {
  const out: Line[] = [];
  for (const a of p.albums) for (const l of a.lines) {
    // an album line charged per sheet (a design rate typed on the order: rate × sheets, once per album) bills its sheet count
    const albumSheets = l.scope === "album" && l.method === "per_sheet" && l.qty > 1 && Math.round((l.rate ?? 0) * l.qty * 100) === Math.round(l.amount * 100);
    const what = l.scope === "copy" ? ` — ${l.method === "per_sheet" ? `${l.qty} sheets` : `${l.qty} ${l.unit}`}${a.copies > 1 ? ` × ${a.copies} copies` : ""}` : l.scope === "album" ? (albumSheets ? ` — ${l.qty} sheets (per album)` : " — per album") : "";
    out.push({ desc: l.name + what, qty: l.scope === "copy" ? l.qty * a.copies : albumSheets ? l.qty : 1, price: l.rate ?? 0, section: a.name, scope: l.scope, note: lineNote(l, l.scope === "copy" ? a.copies : 1) });
  }
  for (const l of p.orderLines) out.push({ desc: `${l.name} — one-time order charge`, qty: 1, price: l.rate ?? 0, section: "Order charges", scope: "order", note: l.rule ?? undefined });
  return out;
}

const toSpec = (a: PricedOrder["albums"][number], d: DraftAlbum): AlbumSpec => {
  const pick = (k: string) => a.lines.find((l) => l.optionKind === k)?.name;
  return { ...blankAlbum(), title: a.name, albumType: "Album", size: a.size ?? "—", orientation: d.orientation || "Landscape", sheets: a.sheets, copies: a.copies, paper: a.paper ?? "—", gsm: "", cover: pick("cover") ?? "—", lamination: a.finish ?? "", binding: pick("binding") ?? "—", box: pick("box") ?? "None", finishes: [], nameText: "", eventDate: d.eventDate || undefined };
};

/** Finalize: save the draft, then create the order, its albums, priced lines and the numbered invoice. Repeating the call returns the same result. */
export async function finalizeDraft(id: string | undefined, payloadIn: OrderDraft): Promise<{ result: FinalizeResult; draftId: string } | { error: string }> {
  // a "new" customer whose mobile is already on file is that customer (no duplicate records)
  const known = payloadIn.newCustomer ? customerByMobile(payloadIn.newCustomer.phone) : undefined;
  const payload: OrderDraft = known ? { ...payloadIn, customerId: known.uid ?? known.id, newCustomer: null } : payloadIn;
  const problems = draftProblems(payload);
  if (problems.length) return { error: problems[0]!.message };
  const existing = id ? DRAFTS.find((x) => x.id === id) : undefined;
  if (existing?.result) return { result: existing.result, draftId: existing.id };          // a double click or a retry: same order, same invoice
  const saved = await saveDraft(id, payload); if ("error" in saved) return saved;
  if (backendOn) {
    if (!backend) return { error: NOT_CONNECTED };
    const r = await (invoiceLaterOn(payload) ? backend.finalizeLater(saved.id) : backend.finalize(saved.id)); if ("error" in r) return r;
    const rec = DRAFTS.find((x) => x.id === saved.id); if (rec) rec.result = r;
    await backend.refresh(); notify();
    return { result: r, draftId: saved.id };
  }
  return invoiceLaterOn(payload) ? createLaterLocal(saved.id, payload) : finalizeLocal(saved.id, payload);
}

/** Demo mode: the order without prices; its invoice is prepared later (create_order_invoice_later in the database). */
function createLaterLocal(draftId: string, payload: OrderDraft): { result: FinalizeResult; draftId: string } | { error: string } {
  const today = orderDateOf(payload), due = payload.event.delivery || addDays(today, pricingSettings().defaultDeliveryDays);
  let cust = CUSTOMERS.find((c) => (c.uid ?? c.id) === payload.customerId);
  if (!cust) {
    const n = payload.newCustomer; if (!n) return { error: "Choose a customer" };
    cust = { id: `IDC${String(1249 + CUSTOMERS.length).padStart(6, "0")}`, name: n.name.trim(), studio: n.name.trim(), mobile: n.phone, email: n.email.trim(), address: n.address.trim() || undefined, city: "", state: "", type: "New", status: "Active", activeOrders: 0, lifetime: 0, lastOrder: today, since: today, dues: 0, tags: [] } as Customer;
    CUSTOMERS.unshift(cust);
  }
  const specs: AlbumSpec[] = payload.albums.map((a, i) => ({ ...blankAlbum(), title: a.name.trim() || `Album ${i + 1}`, albumType: "Album", size: a.size || "—", orientation: a.orientation || "Landscape", sheets: Number(a.sheets) || 0, copies: Number(a.copies) || 1, paper: a.paper || "—", gsm: "", cover: "—", lamination: a.finish || "", binding: "—", box: "None", finishes: [], nameText: "", eventDate: a.eventDate || undefined }));
  const n = Math.max(0, ...ORDERS.map((o) => Number(o.id.replace("IDP", "")) || 0)) + 1;
  const order = { id: `IDP${String(n).padStart(5, "0")}`, customer: cust.studio, mobile: cust.mobile, event: payload.event.name.trim() || payload.event.type || "—", workflow: "Design + Printing", size: specs[0]!.size, pages: specs[0]!.sheets,
    stage: "new_order", priority: (payload.event.priority || "Normal") as Order["priority"], workGroup: payload.event.workGroup || undefined, pendingAt: today, assignee: "Priya", due, pay: "Unpaid", total: 0, paid: 0, progress: 0, couple: payload.event.couple?.trim() || undefined, albums: specs } as Order;
  ORDERS.unshift(order);
  const snapshot = { albums: [], orderLines: [], total: 0, business: {}, customer: { code: cust.id, name: cust.studio, phone: cust.mobile }, event: payload.event, orderCode: order.id, orderDate: today, dueDate: due } as unknown as InvoiceSnapshot;
  PRICING.unshift({ orderId: order.id, revision: 1, status: "invoice_pending", payload: { ...payload, invoiceLater: undefined }, snapshot, finalizedAt: new Date().toISOString() });
  const result: FinalizeResult = { orderId: order.id, code: order.id, invoiceNumber: "", total: 0, revision: 0, invoicePending: true };
  const d = DRAFTS.find((x) => x.id === draftId); if (d) d.result = result;
  notifyOrderCreated(order);
  logAudit({ entity: "order", entityId: order.id, action: "create", detail: `Design + Printing · ${specs.length} album(s) · invoice to be prepared after the design` });
  notify();
  return { result, draftId };
}

/** Reception or admin: open the builder to price an invoice-later order and issue its invoice. Sheets come from the designer's count when not entered. */
export async function prepareInvoice(o: Order): Promise<{ draftId: string } | { error: string }> {
  const role = currentActor().role;
  if (role !== "admin" && role !== "reception") return { error: "Only reception or an admin prepares invoices" };
  const pr = pricingOf(o.id); if (!pr || pr.status !== "invoice_pending") return { error: "This order has no invoice to prepare" };
  if (backendOn) {
    if (!backend || !o.uid) return { error: NOT_CONNECTED };
    const r = await backend.prepareInvoice(o.uid); if ("error" in r) return r;
    await listDrafts(); return r;
  }
  const open = DRAFTS.find((x) => !x.result && x.payload.reopenOrder === o.id); if (open) return { draftId: open.id };
  const payload = { ...JSON.parse(JSON.stringify(pr.payload)) as OrderDraft, reopenOrder: o.id, invoiceLater: undefined };
  payload.albums.forEach((a, i) => {                                   // each album's own "Sheets designed"; one album falls back to the order's count
    if (Number(a.sheets) > 0) return;
    const n = progressOf(o.id, "design", i + 1)?.count || (payload.albums.length === 1 ? sheetsDesigned(o.id) : undefined);
    if (n) a.sheets = n;
  });
  const id = newId();
  DRAFTS.unshift({ id, title: `Invoice for ${o.id}`, payload, updatedAt: new Date().toISOString(), mine: true });
  notify(); return { draftId: id };
}
/** The designer's "Sheets designed" count for an order, if reported. */
export const sheetsDesigned = (orderCode: string) => progressOf(orderCode, "design")?.count;

function finalizeLocal(draftId: string, payload: OrderDraft): { result: FinalizeResult; draftId: string } | { error: string } {
  const p = price(payload);
  if (!p.canFinalize) return { error: p.errors[0]?.message ?? "A price is not configured" };
  const pct = discountPct(p);
  if (pct > DISCOUNT_APPROVAL_PCT && currentActor().role !== "admin") return { error: `A discount above ${DISCOUNT_APPROVAL_PCT}% needs an admin to finalize` };
  const designed = payload.orderType === "design_printing";
  const today = orderDateOf(payload), due = payload.event.delivery || addDays(today, pricingSettings().defaultDeliveryDays);
  let cust = CUSTOMERS.find((c) => (c.uid ?? c.id) === payload.customerId);
  if (!cust) {
    const n = payload.newCustomer; if (!n) return { error: "Choose a customer" };
    cust = { id: `IDC${String(1249 + CUSTOMERS.length).padStart(6, "0")}`, name: n.name.trim(), studio: n.name.trim(), mobile: n.phone, email: n.email.trim(), address: n.address.trim() || undefined, city: "", state: "", type: "New", status: "Active", activeOrders: 0, lifetime: 0, lastOrder: today, since: today, dues: 0, tags: [] } as Customer;
    CUSTOMERS.unshift(cust);
  }
  const reopen = payload.reopenOrder ? ORDERS.find((o) => o.id === payload.reopenOrder) : undefined;
  const prev = reopen ? pricingOf(reopen.id) : undefined;
  if (payload.reopenOrder && (!reopen || (prev?.status !== "reopened" && prev?.status !== "invoice_pending"))) return { error: "This order is not open for editing" };
  const firstInvoice = prev?.status === "invoice_pending";             // the invoice of an invoice-later order: its first revision
  const revision = prev && !firstInvoice ? prev.revision + 1 : 1;
  const specs = p.albums.map((a, i) => toSpec(a, payload.albums[i]!));
  let order: Order;
  if (reopen) {
    Object.assign(reopen, { priority: (payload.event.priority || "Normal") as Order["priority"], workGroup: payload.event.workGroup || undefined, customer: cust.studio, mobile: cust.mobile, event: payload.event.name.trim() || payload.event.type || "—", workflow: designed ? "Design + Printing" : "Printing", size: specs[0]!.size, pages: specs[0]!.sheets, due, total: p.total, albums: specs, couple: payload.event.couple?.trim() || undefined });
    order = reopen;
  } else {
    const n = Math.max(0, ...ORDERS.map((o) => Number(o.id.replace("IDP", "")) || 0)) + 1;
    order = { id: `IDP${String(n).padStart(5, "0")}`, customer: cust.studio, mobile: cust.mobile, event: payload.event.name.trim() || payload.event.type || "—", workflow: designed ? "Design + Printing" : "Printing", size: specs[0]!.size, pages: specs[0]!.sheets,
      stage: "new_order", priority: (payload.event.priority || "Normal") as Order["priority"], workGroup: payload.event.workGroup || undefined, pendingAt: today, assignee: "Priya", due, pay: "Unpaid", total: p.total, paid: 0, progress: 0, couple: payload.event.couple?.trim() || undefined, albums: specs } as Order;
    ORDERS.unshift(order);
  }
  if (prev?.invoiceNo) { const old = INVOICES.find((i) => i.no === prev.invoiceNo); if (old) old.status = "Void"; }
  const year = new Date().getFullYear();
  const seq = Math.max(0, ...INVOICES.filter((i) => i.kind === "invoice").map((i) => Number(new RegExp(`^INV-${year}-(\\d+)$`).exec(i.no)?.[1] ?? 0))) + 1;
  const invoiceNo = `INV-${year}-${String(seq).padStart(4, "0")}`;
  const snapshot: InvoiceSnapshot = {
    ...p, business: {}, customer: { code: cust.id, name: cust.studio, phone: cust.mobile, email: cust.email || undefined, address: cust.address }, event: payload.event,
    orderCode: order.id, orderDate: orderDateOf(payload), dueDate: due, invoiceNumber: invoiceNo, invoiceDate: today, revision,
  };
  snapshot.showBusinessName = businessNameShown(payload, currentActor().role);
  snapshot.business = brand(localBusiness(), snapshot.showBusinessName);
  const inv: Invoice = {
    no: invoiceNo, kind: "invoice", orderId: order.id, customer: cust.studio, date: today, due, lines: invoiceLines(p), gstPct: 0, igst: false, discountPct: 0, status: "Sent", approval: pct > DISCOUNT_APPROVAL_PCT ? "approved" : "none",
    approvedBy: pct > DISCOUNT_APPROVAL_PCT ? currentActor().name : undefined, sentAt: new Date().toISOString(), notes: payload.event.notes || undefined,
    v2: { subtotal: Math.round((p.subtotal + p.lineDiscounts) * 100) / 100, discountType: p.discountType, discountValue: p.discountValue, discountAmount: Math.round((p.discountAmount + p.lineDiscounts) * 100) / 100, taxLabel: p.taxEnabled ? p.taxLabel : null, taxRate: p.taxRate, taxAmount: p.tax, revision, snapshot },
  };
  INVOICES.unshift(inv);
  const rec: PricingRecord = { orderId: order.id, revision, status: "finalized", payload: { ...payload, reopenOrder: undefined }, snapshot, invoiceNo, finalizedAt: new Date().toISOString() };
  if (prev) Object.assign(prev, rec, { reopenReason: undefined }); else PRICING.unshift(rec);
  const result: FinalizeResult = { orderId: order.id, code: order.id, invoiceNumber: invoiceNo, total: p.total, revision };
  const d = DRAFTS.find((x) => x.id === draftId); if (d) d.result = result;
  if (!reopen) notifyOrderCreated(order);
  logAudit({ entity: "order", entityId: order.id, action: firstInvoice ? "invoice_issue" : reopen ? "pricing_refinalize" : "create", detail: `${designed ? "Design + Printing" : "Printing Only"} · ${p.albums.length} album(s) · total ₹${p.total} · ${invoiceNo}` });
  notify();
  return { result, draftId };
}

/** Admin only, with a reason: the invoice is voided (kept), and the order's selections come back as a draft to edit and finalize again. */
export async function reopenOrder(o: Order, reason: string): Promise<{ draftId: string } | { error: string }> {
  if (currentActor().role !== "admin") return { error: "Only an administrator can reopen a finalized order" };
  if (reason.trim().length < 3) return { error: "Give a reason for reopening the order" };
  const pr = pricingOf(o.id); if (!pr) return { error: "This order has no finalized pricing" };
  if (pr.status !== "finalized") return { error: "This order is already open for editing" };
  if (backendOn) {
    if (!backend || !o.uid) return { error: NOT_CONNECTED };
    const r = await backend.reopen(o.uid, reason.trim()); if ("error" in r) return r;
    await listDrafts(); await backend.refresh(); return r;
  }
  pr.status = "reopened"; pr.reopenReason = reason.trim();
  const inv = INVOICES.find((i) => i.no === pr.invoiceNo); if (inv) inv.status = "Void";
  const id = newId();
  DRAFTS.unshift({ id, title: `Editing ${o.id}`, payload: { ...JSON.parse(JSON.stringify(pr.payload)) as OrderDraft, reopenOrder: o.id }, updatedAt: new Date().toISOString(), mine: true });
  logAudit({ entity: "order", entityId: o.id, action: "pricing_reopen", reason: reason.trim(), detail: `Invoice ${pr.invoiceNo} voided` });
  notify(); return { draftId: id };
}
export async function cancelReopen(o: Order): Promise<string | null> {
  if (currentActor().role !== "admin") return "Only an administrator can do this";
  const pr = pricingOf(o.id); if (!pr || pr.status !== "reopened") return "This order is not open for editing";
  if (backendOn) { if (!backend || !o.uid) return NOT_CONNECTED; const e = await backend.cancelReopen(o.uid); if (e) return e; await listDrafts(); await backend.refresh(); return null; }
  pr.status = "finalized"; pr.reopenReason = undefined;
  const inv = INVOICES.find((i) => i.no === pr.invoiceNo); if (inv) inv.status = "Sent";
  for (let i = DRAFTS.length - 1; i >= 0; i--) if (!DRAFTS[i]!.result && DRAFTS[i]!.payload.reopenOrder === o.id) DRAFTS.splice(i, 1);
  logAudit({ entity: "order", entityId: o.id, action: "pricing_reopen_cancel" });
  notify(); return null;
}
export const paymentsOf = (o: Order) => o.paid;

/** Most moving items: the catalog items used on the most finalized orders (album and order lines), for quick picks while billing. */
export function topItems(limit = 8, accept: (itemId: string) => boolean = () => true): { itemId: string; orders: number }[] {
  const count = new Map<string, number>();
  for (const p of PRICING) {
    const ids = new Set([...p.snapshot.albums.flatMap((a) => a.lines.filter((l) => l.kind === "item").map((l) => l.itemId)), ...p.snapshot.orderLines.map((l) => l.itemId)]);
    ids.forEach((id) => { if (id) count.set(id, (count.get(id) ?? 0) + 1); });
  }
  return [...count.entries()].filter(([id]) => ITEMS.some((i) => i.id === id && i.active !== false) && accept(id)).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([itemId, orders]) => ({ itemId, orders }));
}
