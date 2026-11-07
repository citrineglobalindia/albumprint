import { persistArray } from "./persist";
import { ORDERS, type Order } from "./data";
import { notify } from "./store";
import { backendOn } from "./supabase";
import { currentActor, logAudit } from "./audit";

// Printing labs (outside labs that print albums for us): the lab list, which lab prints each album and its progress there
// (sent to lab → received back), and the purchase amount the lab charges — for profit = selling price − purchase.
// Database: labs, album_labs, album_purchases (migration 0055). Purchase amounts and profit: admin and accounts only.
export interface Lab { id: string; name: string; contact?: string; phone?: string; notes?: string; active: boolean }
export type LabStatus = "not_sent" | "sent" | "received";
export interface AlbumLab { orderId: string; position: number; labId?: string; status: LabStatus; sentAt?: string; sentBy?: string; receivedAt?: string; receivedBy?: string; note?: string }
export interface Purchase { orderId: string; position: number; amount: number }

export const LABS: Lab[] = persistArray<Lab>("labs", []);
export const ALBUM_LABS: AlbumLab[] = persistArray<AlbumLab>("album_labs", []);
export const PURCHASES: Purchase[] = persistArray<Purchase>("album_purchases", []);
export const LAB_STATUS_LABEL: Record<LabStatus, string> = { not_sent: "Not sent", sent: "At lab", received: "Received" };

export const canSeeCost = () => { const r = currentActor().role; return r === "admin" || r === "accounts"; };
export const canManageLabs = () => currentActor().role === "admin";
export const canMoveLabWork = () => ["admin", "reception", "printing"].includes(currentActor().role);
export const labName = (id?: string) => LABS.find((l) => l.id === id)?.name ?? "";
export const albumLab = (orderId: string, position: number) => ALBUM_LABS.find((a) => a.orderId === orderId && a.position === position);
export const purchaseOf = (orderId: string, position: number) => PURCHASES.find((p) => p.orderId === orderId && p.position === position)?.amount;
export const albumsOf = (o: Order) => (o.albums?.length ? o.albums.map((a, i) => ({ position: i + 1, title: a.title || `Album ${i + 1}` })) : [{ position: 1, title: "Album 1" }]);

/** Profit of an order: selling total − the purchase amounts entered so far. `complete` = every album has a purchase amount. */
export function profitOf(o: Order) {
  const albums = albumsOf(o);
  const amounts = albums.map((a) => purchaseOf(o.id, a.position));
  const purchase = amounts.reduce<number>((s, x) => s + (x ?? 0), 0);
  const profit = o.total - purchase;
  return { selling: o.total, purchase, profit, margin: o.total > 0 ? (profit / o.total) * 100 : 0, complete: amounts.every((x) => x !== undefined), entered: amounts.some((x) => x !== undefined) };
}

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const uidOf = (code: string) => ORDERS.find((o) => o.id === code)?.uid;
const codeOf = (uid: string) => ORDERS.find((o) => o.uid === uid)?.id;
async function db() { return (await import("./db/core")).sb(); }

/** Database: load labs, album lab progress and (for admin/accounts) purchase amounts. */
export async function hydrateLabs() {
  if (!backendOn) return;
  const c = await db();
  const [l, a, p] = await Promise.all([c.from("labs").select("*").order("name"), c.from("album_labs").select("*"), canSeeCost() ? c.from("album_purchases").select("*") : Promise.resolve({ data: [] as Row[], error: null })]);
  if (l.error || a.error) throw new Error((l.error ?? a.error)!.message);
  const { staffName } = await import("./db/production");
  LABS.splice(0, LABS.length, ...((l.data ?? []) as Row[]).map((r) => ({ id: r.id, name: r.name, contact: r.contact ?? undefined, phone: r.phone ?? undefined, notes: r.notes ?? undefined, active: r.active })));
  ALBUM_LABS.splice(0, ALBUM_LABS.length, ...((a.data ?? []) as Row[]).flatMap((r) => { const id = codeOf(r.order_id); return id ? [{ orderId: id, position: r.position, labId: r.lab_id ?? undefined, status: r.status as LabStatus, sentAt: r.sent_at ?? undefined, sentBy: staffName(r.sent_by) ?? undefined, receivedAt: r.received_at ?? undefined, receivedBy: staffName(r.received_by) ?? undefined, note: r.note ?? undefined }] : []; }));
  PURCHASES.splice(0, PURCHASES.length, ...((p.data ?? []) as Row[]).flatMap((r) => { const id = codeOf(r.order_id); return id ? [{ orderId: id, position: r.position, amount: Number(r.amount) }] : []; }));
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
export async function setPurchase(orderId: string, position: number, amount: number | null): Promise<Res> {
  if (!canSeeCost()) return { ok: false, msg: "Only admin and accounts enter purchase amounts" };
  if (amount !== null && (!Number.isFinite(amount) || amount < 0)) return { ok: false, msg: "Enter a purchase amount of 0 or more" };
  if (backendOn) {
    const order_id = uidOf(orderId); if (!order_id) return { ok: false, msg: "Order not found" };
    const c = await db();
    const r = amount === null ? await c.from("album_purchases").delete().eq("order_id", order_id).eq("position", position) : await c.from("album_purchases").upsert({ order_id, position, amount }, { onConflict: "order_id,position" });
    if (r.error) return { ok: false, msg: r.error.message };
  } else logAudit({ entity: "order", entityId: orderId, action: "purchase_amount", detail: `Album ${position}: ${amount ?? "cleared"}` });
  const i = PURCHASES.findIndex((p) => p.orderId === orderId && p.position === position);
  if (amount === null) { if (i >= 0) PURCHASES.splice(i, 1); } else if (i >= 0) PURCHASES[i]!.amount = amount; else PURCHASES.push({ orderId, position, amount });
  notify(); return { ok: true, msg: "Purchase amount saved" };
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
