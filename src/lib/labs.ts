import { persistArray } from "./persist";
import { hasModule } from "./access";
import { ORDERS, type Order } from "./data";
import { notify } from "./store";
import { backendOn } from "./supabase";
import { currentActor, logAudit } from "./audit";
import { pricingOf } from "./orders2";
import type { PricedLine } from "./orderPricing";

// Printing labs (outside labs that print albums for us): the lab list, which lab prints each album and its progress there
// (sent to lab → received back), and the purchase amount the lab charges — for profit = selling price − purchase.
// Database: labs, album_labs, album_purchases (migration 0055). Purchase amounts and profit: admin and accounts only.
export interface Lab { id: string; name: string; contact?: string; phone?: string; notes?: string; active: boolean }
export type LabStatus = "not_sent" | "sent" | "received";
export interface AlbumLab { orderId: string; position: number; labId?: string; status: LabStatus; sentAt?: string; sentBy?: string; receivedAt?: string; receivedBy?: string; note?: string }
export interface Purchase { orderId: string; position: number; amount: number; billNo?: string; billDate?: string; billFile?: string; billFileName?: string }
/** A payment we made to a lab (migration 0074): a lab's payable = its purchase bills − these. */
export interface LabPayment { id: string; labId: string; amount: number; date: string; mode: string; ref?: string; note?: string; by?: string }
export const LAB_PAYMENTS: LabPayment[] = persistArray<LabPayment>("lab_payments", []);

export const LABS: Lab[] = persistArray<Lab>("labs", []);
export const ALBUM_LABS: AlbumLab[] = persistArray<AlbumLab>("album_labs", []);
export const PURCHASES: Purchase[] = persistArray<Purchase>("album_purchases", []);
/** What a lab charges us for a catalog item, in the item's own unit (migration 0065). */
export interface LabRate { labId: string; itemId: string; rate: number }
export const LAB_RATES: LabRate[] = persistArray<LabRate>("lab_item_rates", []);
export const labRate = (labId: string | undefined, itemId: string | null | undefined) => (labId && itemId ? LAB_RATES.find((r) => r.labId === labId && r.itemId === itemId)?.rate : undefined);
/** The standard purchase cost list (any lab): kept with the lab rates under this id; database table item_purchase_costs (migration 0072). */
export const STD_COST = "standard";
/** What an item costs us at a lab: the lab's own rate, else the item's standard purchase cost. */
export const costRate = (labId: string | undefined, itemId: string | null | undefined) => labRate(labId, itemId) ?? labRate(STD_COST, itemId);
export const LAB_STATUS_LABEL: Record<LabStatus, string> = { not_sent: "Not sent", sent: "At lab", received: "Received" };

export const canSeeCost = () => { const r = currentActor().role; return r === "admin" || r === "accounts"; };
export const canManageLabs = () => currentActor().role === "admin";
export const canMoveLabWork = () => ["admin", "reception", "printing"].includes(currentActor().role) || hasModule("printing");
export const labName = (id?: string) => (id === STD_COST ? "Standard cost" : LABS.find((l) => l.id === id)?.name ?? "");
export const albumLab = (orderId: string, position: number) => ALBUM_LABS.find((a) => a.orderId === orderId && a.position === position);
export const purchaseOf = (orderId: string, position: number) => PURCHASES.find((p) => p.orderId === orderId && p.position === position)?.amount;
export const purchaseRec = (orderId: string, position: number) => PURCHASES.find((p) => p.orderId === orderId && p.position === position);
export const albumsOf = (o: Order) => (o.albums?.length ? o.albums.map((a, i) => ({ position: i + 1, title: a.title || `Album ${i + 1}` })) : [{ position: 1, title: "Album 1" }]);

/** The purchase cost of an album's lines at a lab's rates: each catalog item line × the quantity billed to the customer
 *  (sheets or pieces × copies; once for a per-album item). Design lines are our own work and cost nothing at the lab.
 *  `missing` = item lines the lab has no rate for. */
export function labCostOf(lines: PricedLine[], copies: number, labId: string | undefined): { amount: number; items: number; missing: string[] } {
  let amount = 0, items = 0; const missing: string[] = [];
  for (const l of lines) {
    if (l.kind !== "item" || !l.itemId) continue;
    items++;
    const r = costRate(labId, l.itemId);
    if (r === undefined) { missing.push(l.name); continue; }
    const units = l.scope === "copy" ? l.qty * copies : l.method === "per_sheet" ? l.qty : 1;
    amount += Math.round(r * units * 100) / 100;
  }
  return { amount: Math.round(amount * 100) / 100, items, missing };
}
/** An album's purchase cost worked out from its lab's item rates and the standard purchase costs (finalized orders only),
 *  or undefined when it can't be. Works before a lab is chosen (standard costs only). */
export function estimatedPurchase(o: Order, position: number) {
  const lab = albumLab(o.id, position)?.labId;
  const a = pricingOf(o.id)?.snapshot?.albums?.[position - 1]; if (!a) return undefined;
  const c = labCostOf(a.lines, a.copies, lab);
  return c.items > c.missing.length ? c : undefined;                                      // at least one item has a rate at this lab
}
/** An album's purchase: the amount typed on the order, else the estimate from the lab's item rates. */
export function albumPurchase(o: Order, position: number): { amount: number; source: "entered" | "lab rates"; missing?: string[] } | undefined {
  const typed = purchaseOf(o.id, position); if (typed !== undefined) return { amount: typed, source: "entered" };
  const e = estimatedPurchase(o, position); return e ? { amount: e.amount, source: "lab rates", missing: e.missing } : undefined;
}

/** Profit of an order: selling total − the albums' purchases (typed on the order, else worked out from the lab's item rates).
 *  `complete` = every album has a purchase; `estimated` = some of it comes from lab rates. */
export function profitOf(o: Order) {
  const albums = albumsOf(o);
  const amounts = albums.map((a) => albumPurchase(o, a.position));
  const purchase = Math.round(amounts.reduce<number>((s, x) => s + (x?.amount ?? 0), 0) * 100) / 100;
  const profit = Math.round((o.total - purchase) * 100) / 100;
  return { selling: o.total, purchase, profit, margin: o.total > 0 ? (profit / o.total) * 100 : 0, complete: amounts.every((x) => x !== undefined), entered: amounts.some((x) => x !== undefined),
    estimated: amounts.some((x) => x?.source === "lab rates"), missingRates: amounts.some((x) => !!x?.missing?.length) };
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const uidOf = (code: string) => ORDERS.find((o) => o.id === code)?.uid;
const codeOf = (uid: string) => ORDERS.find((o) => o.uid === uid)?.id;
async function db() { return (await import("./db/core")).sb(); }

/** Database: load labs, album lab progress and (for admin/accounts) purchase amounts. */
export async function hydrateLabs() {
  if (!backendOn) return;
  const c = await db();
  const none = Promise.resolve({ data: [] as Row[], error: null });
  const [l, a, p, lr, std, lp] = await Promise.all([c.from("labs").select("*").order("name"), c.from("album_labs").select("*"), canSeeCost() ? c.from("album_purchases").select("*") : none, canSeeCost() ? c.from("lab_item_rates").select("lab_id,item_id,rate") : none, canSeeCost() ? c.from("item_purchase_costs").select("item_id,rate") : none, canSeeCost() ? c.from("lab_payments").select("*").order("paid_on", { ascending: false }) : none]);
  if (l.error || a.error) throw new Error((l.error ?? a.error)!.message);
  const { staffName } = await import("./db/production");
  LABS.splice(0, LABS.length, ...((l.data ?? []) as Row[]).map((r) => ({ id: r.id, name: r.name, contact: r.contact ?? undefined, phone: r.phone ?? undefined, notes: r.notes ?? undefined, active: r.active })));
  ALBUM_LABS.splice(0, ALBUM_LABS.length, ...((a.data ?? []) as Row[]).flatMap((r) => { const id = codeOf(r.order_id); return id ? [{ orderId: id, position: r.position, labId: r.lab_id ?? undefined, status: r.status as LabStatus, sentAt: r.sent_at ?? undefined, sentBy: staffName(r.sent_by) ?? undefined, receivedAt: r.received_at ?? undefined, receivedBy: staffName(r.received_by) ?? undefined, note: r.note ?? undefined }] : []; }));
  if (!lr.error) LAB_RATES.splice(0, LAB_RATES.length, ...((lr.data ?? []) as Row[]).map((r) => ({ labId: r.lab_id, itemId: r.item_id, rate: Number(r.rate) })),
    ...(std.error ? LAB_RATES.filter((x) => x.labId === STD_COST) : ((std.data ?? []) as Row[]).map((r) => ({ labId: STD_COST, itemId: r.item_id, rate: Number(r.rate) }))));
  PURCHASES.splice(0, PURCHASES.length, ...((p.data ?? []) as Row[]).flatMap((r) => { const id = codeOf(r.order_id); return id ? [{ orderId: id, position: r.position, amount: Number(r.amount), billNo: r.bill_no ?? undefined, billDate: r.bill_date ?? undefined, billFile: r.bill_file ?? undefined, billFileName: r.bill_file_name ?? undefined }] : []; }));
  if (!lp.error) { const { staffName: sn } = await import("./db/production"); LAB_PAYMENTS.splice(0, LAB_PAYMENTS.length, ...((lp.data ?? []) as Row[]).map((r) => ({ id: r.id, labId: r.lab_id, amount: Number(r.amount), date: r.paid_on, mode: String(r.mode), ref: r.reference ?? undefined, note: r.note ?? undefined, by: sn(r.created_by) ?? undefined }))); }
  notify();
}

type Res = { ok: boolean; msg: string };
export async function saveLab(l: Omit<Lab, "id"> & { id?: string }): Promise<Res> {
  if (!canManageLabs()) return { ok: false, msg: "Only an admin manages labs" };
  const name = l.name.trim(); if (!name) return { ok: false, msg: "Enter the lab name" };
  if (LABS.some((x) => x.name.toLowerCase() === name.toLowerCase() && x.id !== l.id)) return { ok: false, msg: `${name} is already in the list` };
  const row = { name, contact: l.contact?.trim() || null, phone: l.phone?.trim() || null, notes: l.notes?.trim() || null, active: l.active };
  if (backendOn) {
    const c = await db();
    const r = l.id ? await c.from("labs").update(row).eq("id", l.id).select().single() : await c.from("labs").insert(row).select().single();
    if (r.error) return { ok: false, msg: r.error.message };
    const saved = r.data as Row; const rec: Lab = { id: saved.id, name: saved.name, contact: saved.contact ?? undefined, phone: saved.phone ?? undefined, notes: saved.notes ?? undefined, active: saved.active };
    const i = LABS.findIndex((x) => x.id === rec.id); if (i >= 0) LABS[i] = rec; else LABS.push(rec);
  } else {
    const rec: Lab = { id: l.id ?? `LAB${Date.now().toString(36)}`, name, contact: row.contact ?? undefined, phone: row.phone ?? undefined, notes: row.notes ?? undefined, active: l.active };
    const i = LABS.findIndex((x) => x.id === rec.id); if (i >= 0) LABS[i] = rec; else LABS.push(rec);
    logAudit({ entity: "lab", entityId: rec.id, action: l.id ? "update" : "create", detail: name });
  }
  LABS.sort((a, b) => a.name.localeCompare(b.name)); notify();
  return { ok: true, msg: `${name} saved` };
}

async function upsertAlbumLab(next: AlbumLab): Promise<Res> {
  if (backendOn) {
    const order_id = uidOf(next.orderId); if (!order_id) return { ok: false, msg: "Order not found" };
    const r = await (await db()).from("album_labs").upsert({ order_id, position: next.position, lab_id: next.labId ?? null, status: next.status, note: next.note ?? null }, { onConflict: "order_id,position" }).select().single();
    if (r.error) return { ok: false, msg: r.error.message };
    const d = r.data as Row; next.sentAt = d.sent_at ?? undefined; next.receivedAt = d.received_at ?? undefined;
  }
  const i = ALBUM_LABS.findIndex((a) => a.orderId === next.orderId && a.position === next.position);
  if (i >= 0) ALBUM_LABS[i] = next; else ALBUM_LABS.push(next);
  notify(); return { ok: true, msg: "Saved" };
}
export async function setAlbumLab(orderId: string, position: number, labId: string | undefined): Promise<Res> {
  if (!canMoveLabWork()) return { ok: false, msg: "Your role can't assign labs" };
  const cur = albumLab(orderId, position) ?? { orderId, position, status: "not_sent" as LabStatus };
  const r = await upsertAlbumLab({ ...cur, labId });
  if (r.ok && !backendOn) logAudit({ entity: "order", entityId: orderId, action: "lab_assign", detail: `Album ${position}: ${labName(labId) || "no lab"}` });
  return r.ok ? { ok: true, msg: labId ? `Album ${position} will be printed by ${labName(labId)}` : `Album ${position}: lab cleared` } : r;
}
export async function setLabStatus(orderId: string, position: number, status: LabStatus): Promise<Res> {
  if (!canMoveLabWork()) return { ok: false, msg: "Your role can't update lab work" };
  const cur = albumLab(orderId, position);
  if (!cur?.labId && status !== "not_sent") return { ok: false, msg: "Choose the lab first" };
  const now = new Date().toISOString(), me = currentActor().name;
  const next: AlbumLab = { ...(cur ?? { orderId, position }), status, ...(status === "sent" ? { sentAt: now, sentBy: me, receivedAt: undefined, receivedBy: undefined } : status === "received" ? { sentAt: cur?.sentAt ?? now, sentBy: cur?.sentBy ?? me, receivedAt: now, receivedBy: me } : { sentAt: undefined, sentBy: undefined, receivedAt: undefined, receivedBy: undefined }) } as AlbumLab;
  const r = await upsertAlbumLab(next);
  if (r.ok && !backendOn) logAudit({ entity: "order", entityId: orderId, action: "lab_" + status, detail: `Album ${position} · ${labName(next.labId)}` });
  return r.ok ? { ok: true, msg: status === "sent" ? `Album ${position} sent to ${labName(next.labId)}` : status === "received" ? `Album ${position} received from ${labName(next.labId)}` : `Album ${position}: back to not sent` } : r;
}
/** Save an album's purchase: the amount the lab / supplier billed, with their bill number and date (null amount clears it). */
export async function setPurchase(orderId: string, position: number, amount: number | null, bill?: { billNo?: string; billDate?: string }): Promise<Res> {
  if (!canSeeCost()) return { ok: false, msg: "Only admin and accounts enter purchase amounts" };
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return { ok: false, msg: "Enter a purchase amount of 0 or more" };
  const cur = purchaseRec(orderId, position);
  const billNo = (bill?.billNo ?? cur?.billNo ?? "").trim() || undefined, billDate = (bill?.billDate ?? cur?.billDate ?? "") || undefined;
  if (amount === null && bill && (billNo || billDate)) return { ok: false, msg: "Enter the purchase amount for this bill" };
  if (backendOn) {
    const order_id = uidOf(orderId); if (!order_id) return { ok: false, msg: "Order not found" };
    const c = await db();
    const r = amount === null ? await c.from("album_purchases").delete().eq("order_id", order_id).eq("position", position) : await c.from("album_purchases").upsert({ order_id, position, amount, bill_no: billNo ?? null, bill_date: billDate ?? null }, { onConflict: "order_id,position" });
    if (r.error) return { ok: false, msg: r.error.message };
  } else logAudit({ entity: "order", entityId: orderId, action: "purchase_amount", detail: `Album ${position}: ${amount ?? "cleared"}${billNo ? ` · bill ${billNo}` : ""}` });
  const i = PURCHASES.findIndex((p) => p.orderId === orderId && p.position === position);
  if (amount === null) { if (i >= 0) PURCHASES.splice(i, 1); } else if (i >= 0) Object.assign(PURCHASES[i]!, { amount, billNo, billDate }); else PURCHASES.push({ orderId, position, amount, billNo, billDate });
  notify(); return { ok: true, msg: amount === null ? "Purchase cleared" : `Purchase saved${billNo ? ` · bill ${billNo}` : ""}` };
}

/** After an order is finalized: save the lab and purchase amount chosen for each album in the order builder. */
export async function applyAlbumLabs(code: string, albums: { labId?: string; purchase?: number }[]): Promise<string | null> {
  if (!albums.some((a) => a.labId || a.purchase !== undefined)) return null;
  if (backendOn && !ORDERS.some((o) => o.id === code && o.uid)) { const { rehydrate } = await import("./db/core"); await rehydrate(["customers and orders"]); }
  for (const [i, a] of albums.entries()) {
    if (a.labId) { const r = await setAlbumLab(code, i + 1, a.labId); if (!r.ok) return r.msg; }
    if (a.purchase !== undefined && canSeeCost()) { const r = await setPurchase(code, i + 1, a.purchase); if (!r.ok) return r.msg; }
  }
  return null;
}

/** Admin / accounts: save a lab's purchase rates (null clears a rate). */
export async function saveLabRates(labId: string, rows: { itemId: string; rate: number | null }[]): Promise<string | null> {
  if (!canSeeCost()) return "Only admin and accounts enter purchase rates";
  if (labId !== STD_COST && !LABS.some((l) => l.id === labId)) return "Choose a lab";
  for (const r of rows) if (r.rate !== null && (!Number.isFinite(r.rate) || r.rate < 0)) return "Enter purchase rates of 0 or more";
  const up = rows.filter((r) => r.rate !== null), del = rows.filter((r) => r.rate === null).map((r) => r.itemId);
  if (backendOn) {
    const c = await db();
    const std = labId === STD_COST;
    for (let i = 0; i < up.length; i += 500) {
      const chunk = up.slice(i, i + 500);
      const { error } = std ? await c.from("item_purchase_costs").upsert(chunk.map((r) => ({ item_id: r.itemId, rate: r.rate })), { onConflict: "item_id" })
        : await c.from("lab_item_rates").upsert(chunk.map((r) => ({ lab_id: labId, item_id: r.itemId, rate: r.rate })), { onConflict: "lab_id,item_id" });
      if (error) return error.message;
    }
    for (let i = 0; i < del.length; i += 200) {
      const { error } = std ? await c.from("item_purchase_costs").delete().in("item_id", del.slice(i, i + 200))
        : await c.from("lab_item_rates").delete().eq("lab_id", labId).in("item_id", del.slice(i, i + 200));
      if (error) return error.message;
    }
  } else logAudit({ entity: "lab", entityId: labId, action: "purchase_rates", detail: `${labName(labId)}: ${up.length} rate(s) set, ${del.length} cleared` });
  for (const r of rows) {
    const i = LAB_RATES.findIndex((x) => x.labId === labId && x.itemId === r.itemId);
    if (r.rate === null) { if (i >= 0) LAB_RATES.splice(i, 1); } else if (i >= 0) LAB_RATES[i]!.rate = r.rate; else LAB_RATES.push({ labId, itemId: r.itemId, rate: r.rate });
  }
  notify(); return null;
}

/* ───────── purchase bill files (private bucket purchase-bills, admin / accounts) ───────── */
export const BILL_BUCKET = "purchase-bills";
const BILL_EXT = /\.(pdf|jpe?g|png|webp)$/i;
/** Bill files picked in this browser (demo mode keeps no bytes; also used for an instant preview). */
export const LOCAL_BILLS = new Map<string, string>();
const billKey = (orderId: string, position: number) => `${orderId}#${position}`;

/** Attach the supplier's bill (PDF or photo) to an album's purchase. The purchase amount must be saved first. */
export async function uploadPurchaseBill(orderId: string, position: number, file: File): Promise<Res> {
  if (!canSeeCost()) return { ok: false, msg: "Only admin and accounts keep purchase bills" };
  const cur = purchaseRec(orderId, position); if (!cur) return { ok: false, msg: "Save the purchase amount first, then attach its bill" };
  if (!BILL_EXT.test(file.name)) return { ok: false, msg: "Attach the bill as a PDF or a photo (JPG / PNG)" };
  if (file.size > 25 * 1024 ** 2) return { ok: false, msg: "The bill file is larger than 25 MB" };
  let path = `local:${file.name}`;
  if (backendOn) {
    const order_id = uidOf(orderId); if (!order_id) return { ok: false, msg: "Order not found" };
    const c = await db();
    path = `${orderId}/a${position}-${Date.now()}-${file.name.normalize("NFKD").replace(/[^A-Za-z0-9._()-]+/g, "_")}`;
    const up = await c.storage.from(BILL_BUCKET).upload(path, file, { upsert: false, contentType: file.type || "application/octet-stream" });
    if (up.error) return { ok: false, msg: up.error.message };
    const r = await c.from("album_purchases").update({ bill_file: path, bill_file_name: file.name }).eq("order_id", order_id).eq("position", position);
    if (r.error) return { ok: false, msg: r.error.message };
    if (cur.billFile && !cur.billFile.startsWith("local:")) void c.storage.from(BILL_BUCKET).remove([cur.billFile]);   // the old bill file is replaced
  } else logAudit({ entity: "order", entityId: orderId, action: "purchase_bill_file", detail: `Album ${position}: ${file.name}` });
  try { LOCAL_BILLS.set(billKey(orderId, position), URL.createObjectURL(file)); } catch { /* ignore */ }
  cur.billFile = path; cur.billFileName = file.name; notify();
  return { ok: true, msg: `Bill attached: ${file.name}` };
}
/** Open an album's purchase bill in a new tab. */
export async function openPurchaseBill(orderId: string, position: number): Promise<Res> {
  const cur = purchaseRec(orderId, position); if (!cur?.billFile) return { ok: false, msg: "No bill attached" };
  const local = LOCAL_BILLS.get(billKey(orderId, position));
  let url = local;
  if (!url && backendOn && !cur.billFile.startsWith("local:")) {
    const { data, error } = await (await db()).storage.from(BILL_BUCKET).createSignedUrl(cur.billFile, 300);
    if (error || !data) return { ok: false, msg: error?.message ?? "Could not open the bill" };
    url = data.signedUrl;
  }
  if (!url) return { ok: false, msg: "Demo: the bill file is kept only in the browser it was attached in" };
  window.open(url, "_blank", "noopener"); return { ok: true, msg: `Opened ${cur.billFileName ?? "the bill"}` };
}

/* ───────── lab-wise purchases, payments and payable ───────── */
export const NO_LAB = "";
/** Every purchase entered on an album, with the lab that album is printed at. */
export function purchaseHistory(labId?: string) {
  return PURCHASES.map((p) => {
    const o = ORDERS.find((x) => x.id === p.orderId), lab = albumLab(p.orderId, p.position)?.labId ?? NO_LAB;
    const title = o ? albumsOf(o).find((a) => a.position === p.position)?.title ?? `Album ${p.position}` : `Album ${p.position}`;
    return { ...p, labId: lab, customer: o?.customer ?? "", title, date: p.billDate ?? o?.pendingAt ?? "" };
  }).filter((p) => labId === undefined || p.labId === labId).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
/** A lab's totals: what its bills add up to, what we paid, and what we still owe it. */
export function labPayable(labId: string) {
  const purchases = purchaseHistory(labId).reduce((s, p) => s + p.amount, 0), paid = LAB_PAYMENTS.filter((p) => p.labId === labId).reduce((s, p) => s + p.amount, 0);
  return { purchases: Math.round(purchases * 100) / 100, paid: Math.round(paid * 100) / 100, payable: Math.round((purchases - paid) * 100) / 100 };
}
/** Record a payment made to a lab (admin / accounts). */
export async function addLabPayment(d: { labId: string; amount: number; date: string; mode: string; ref?: string; note?: string }): Promise<Res> {
  if (!canSeeCost()) return { ok: false, msg: "Only admin and accounts record lab payments" };
  if (!LABS.some((l) => l.id === d.labId)) return { ok: false, msg: "Choose the lab" };
  if (!(d.amount > 0) || !Number.isFinite(d.amount)) return { ok: false, msg: "Enter the amount paid" };
  let id = `LP${Date.now().toString(36)}`;
  if (backendOn) {
    const mode = ({ UPI: "upi", Cash: "cash", "Bank Transfer": "bank_transfer", Cheque: "cheque" } as Record<string, string>)[d.mode] ?? "bank_transfer";
    const { data, error } = await (await db()).from("lab_payments").insert({ lab_id: d.labId, amount: d.amount, paid_on: d.date, mode, reference: d.ref?.trim() || null, note: d.note?.trim() || null }).select("id").single();
    if (error || !data) return { ok: false, msg: error?.message ?? "Could not save the payment" };
    id = String(data.id);
  } else logAudit({ entity: "lab", entityId: d.labId, action: "lab_payment", detail: `${labName(d.labId)}: ₹${d.amount} ${d.mode}` });
  LAB_PAYMENTS.unshift({ id, labId: d.labId, amount: d.amount, date: d.date, mode: d.mode, ref: d.ref?.trim() || undefined, note: d.note?.trim() || undefined, by: currentActor().name });
  notify(); return { ok: true, msg: `Payment of ₹${d.amount.toLocaleString("en-IN")} to ${labName(d.labId)} saved · still payable ₹${labPayable(d.labId).payable.toLocaleString("en-IN")}` };
}
/** Remove a payment entered by mistake (admin). */
export async function deleteLabPayment(id: string): Promise<Res> {
  if (currentActor().role !== "admin") return { ok: false, msg: "Only an admin removes a lab payment" };
  const i = LAB_PAYMENTS.findIndex((p) => p.id === id); if (i < 0) return { ok: false, msg: "Not found" };
  if (backendOn) { const { error } = await (await db()).from("lab_payments").delete().eq("id", id); if (error) return { ok: false, msg: error.message }; }
  const [p] = LAB_PAYMENTS.splice(i, 1); notify(); return { ok: true, msg: `Payment of ₹${p!.amount.toLocaleString("en-IN")} removed` };
}
