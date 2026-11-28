import { ORDERS } from "./data";
import { persistArray } from "./persist";
import { notify } from "./store";
import { backendOn } from "./supabase";
import { currentActor, logAudit } from "./audit";
import { ME } from "./attendance";
import { people } from "./albumFlow";
import { canUpdate, photosGiven, saveProgress } from "./jobProgress";

// Colour grading split between graders (migration 0073): the admin divides an order's photos (100 = 40 + 60), can add extra
// photos later and move a grader's pending photos to another or a new grader. Each grader adds to their own done count;
// the order's "photos graded" is the shares' total, so the order moves on by itself once every photo is graded.
export interface Share { orderId: string; graderId: string; grader: string; assigned: number; done: number }
export const SHARES: Share[] = persistArray<Share>("grading_shares", []);

export const sharesOf = (orderId: string) => SHARES.filter((s) => s.orderId === orderId).sort((a, b) => a.grader.localeCompare(b.grader));
export const pendingOf = (s: Share) => Math.max(0, s.assigned - s.done);
export const splitTotals = (orderId: string) => {
  const sh = sharesOf(orderId), given = photosGiven(orderId) ?? 0;
  const assigned = sh.reduce((a, s) => a + s.assigned, 0), done = sh.reduce((a, s) => a + s.done, 0);
  return { given, assigned, done, pending: Math.max(0, assigned - done), unassigned: Math.max(0, given - assigned) };
};
export const isAdmin = () => currentActor().role === "admin";
/** The signed-in person's id in the staff list. */
export const myStaffId = () => (backendOn ? ME.id : people().find((p) => p.name === currentActor().name)?.id ?? "");
export const myShare = (orderId: string) => { const me = myStaffId(); return SHARES.find((s) => s.orderId === orderId && s.graderId === me); };
export const canRecord = (s: Share) => isAdmin() || (canUpdate("grading") && s.graderId === myStaffId());

type Res = { ok: boolean; msg: string };
const uidOf = (code: string) => ORDERS.find((o) => o.id === code)?.uid;
const nameOf = (id: string) => people().find((p) => p.id === id)?.name ?? "—";

async function write(rows: Share[], del?: Share): Promise<string | null> {
  if (!backendOn) return null;
  const { sb } = await import("./db/core");
  if (rows.length) {
    const order_id = uidOf(rows[0]!.orderId); if (!order_id) return "Order not found";
    const { error } = await sb().from("grading_shares").upsert(rows.map((r) => ({ order_id, grader: r.graderId, assigned: r.assigned, done: r.done })), { onConflict: "order_id,grader" });
    if (error) return error.message;
  }
  if (del) {
    const order_id = uidOf(del.orderId); if (!order_id) return "Order not found";
    const { error } = await sb().from("grading_shares").delete().eq("order_id", order_id).eq("grader", del.graderId);
    if (error) return error.message;
  }
  return null;
}
const put = (s: Share) => { const i = SHARES.findIndex((x) => x.orderId === s.orderId && x.graderId === s.graderId); if (i >= 0) SHARES[i] = s; else SHARES.push(s); };
/** Keep the order's "photos graded" equal to the shares' total (drives the automatic move to the admin). */
async function syncGraded(orderId: string): Promise<Res> {
  const t = splitTotals(orderId);
  return saveProgress(orderId, "grading", { count: t.done, status: t.done > 0 ? "working" : undefined }, 0);
}

/** Admin: give `photos` to a grader (a new share, or more photos for one who already has a share). */
export async function assignPhotos(orderId: string, graderId: string, photos: number): Promise<Res> {
  if (!isAdmin()) return { ok: false, msg: "Only an admin divides the photos" };
  if (!graderId) return { ok: false, msg: "Choose who grades these photos" };
  if (!Number.isInteger(photos) || photos <= 0) return { ok: false, msg: "Enter a whole number of photos, e.g. 40" };
  const t = splitTotals(orderId);
  if (photos > t.unassigned) return { ok: false, msg: t.given ? `Only ${t.unassigned} of ${t.given} photos are left to divide — use "Add extra photos" for more` : "Enter the photos given on the order first (or use Add extra photos)" };
  const cur = SHARES.find((s) => s.orderId === orderId && s.graderId === graderId);
  const next: Share = { orderId, graderId, grader: cur?.grader ?? nameOf(graderId), assigned: (cur?.assigned ?? 0) + photos, done: cur?.done ?? 0 };
  const e = await write([next]); if (e) return { ok: false, msg: e };
  put(next); if (!backendOn) logAudit({ entity: "order", entityId: orderId, action: "grading_split", detail: `${photos} photos to ${next.grader} (now ${next.assigned})` });
  notify(); return { ok: true, msg: `${photos} photos assigned to ${next.grader} · ${next.grader} has ${next.assigned}` };
}

/** Admin: extra photos arrived — add them to the order's photos given and give them to a grader. */
export async function addExtraPhotos(orderId: string, graderId: string, photos: number): Promise<Res> {
  if (!isAdmin()) return { ok: false, msg: "Only an admin adds photos" };
  if (!graderId) return { ok: false, msg: "Choose who grades the extra photos" };
  if (!Number.isInteger(photos) || photos <= 0) return { ok: false, msg: "Enter a whole number of photos, e.g. 20" };
  const before = photosGiven(orderId) ?? 0, t = splitTotals(orderId);
  const given = Math.max(before, t.assigned) + photos;
  const r = await saveProgress(orderId, "order", { count: given }, 0); if (!r.ok) return r;
  const a = await assignPhotos(orderId, graderId, photos); if (!a.ok) return a;
  return { ok: true, msg: `${photos} extra photos added (photos given ${given}) · ${a.msg}` };
}

/** Admin: move a grader's pending photos (all, or `photos` of them) to another grader — an existing one or someone new. */
export async function movePending(orderId: string, fromId: string, toId: string, photos?: number): Promise<Res> {
  if (!isAdmin()) return { ok: false, msg: "Only an admin moves photos between graders" };
  const from = SHARES.find((s) => s.orderId === orderId && s.graderId === fromId); if (!from) return { ok: false, msg: "That grader has no photos on this order" };
  if (!toId || toId === fromId) return { ok: false, msg: "Choose another person to give the pending photos to" };
  const pend = pendingOf(from), n = photos ?? pend;
  if (!Number.isInteger(n) || n <= 0) return { ok: false, msg: "Enter how many pending photos to move" };
  if (n > pend) return { ok: false, msg: `${from.grader} has only ${pend} photos pending` };
  const to = SHARES.find((s) => s.orderId === orderId && s.graderId === toId);
  const nf: Share = { ...from, assigned: from.assigned - n }, nt: Share = { orderId, graderId: toId, grader: to?.grader ?? nameOf(toId), assigned: (to?.assigned ?? 0) + n, done: to?.done ?? 0 };
  const drop = nf.assigned === 0 && nf.done === 0;                                       // nothing left with the first grader
  const e = await write(drop ? [nt] : [nf, nt], drop ? from : undefined); if (e) return { ok: false, msg: e };
  if (drop) SHARES.splice(SHARES.indexOf(from), 1); else put(nf);
  put(nt); if (!backendOn) logAudit({ entity: "order", entityId: orderId, action: "grading_move", detail: `${n} pending photos: ${from.grader} → ${nt.grader}` });
  notify(); return { ok: true, msg: `${n} pending photos moved from ${from.grader} to ${nt.grader}` };
}

/** Admin: take a grader off the order (only when they have done nothing; else move their pending photos instead). */
export async function removeShare(orderId: string, graderId: string): Promise<Res> {
  if (!isAdmin()) return { ok: false, msg: "Only an admin changes the split" };
  const s = SHARES.find((x) => x.orderId === orderId && x.graderId === graderId); if (!s) return { ok: false, msg: "Not found" };
  if (s.done > 0) return { ok: false, msg: `${s.grader} has already graded ${s.done} photos — move the pending ones instead` };
  const e = await write([], s); if (e) return { ok: false, msg: e };
  SHARES.splice(SHARES.indexOf(s), 1); notify(); return { ok: true, msg: `${s.grader} removed — ${s.assigned} photos are free to divide again` };
}

/** A grader (or the admin) adds the photos graded in this sitting to that grader's share. */
export async function addDone(orderId: string, graderId: string, photos: number): Promise<Res> {
  const s = SHARES.find((x) => x.orderId === orderId && x.graderId === graderId); if (!s) return { ok: false, msg: "No photos assigned" };
  if (!canRecord(s)) return { ok: false, msg: "You can update only your own photos" };
  if (!Number.isInteger(photos) || photos <= 0) return { ok: false, msg: "Enter how many photos were graded, e.g. 20" };
  if (s.done + photos > s.assigned) return { ok: false, msg: `${s.grader} has only ${pendingOf(s)} photos pending` };
  const next = { ...s, done: s.done + photos };
  if (backendOn) {                                  // a plain update: graders may change only their own done count (not insert)
    const order_id = uidOf(orderId); if (!order_id) return { ok: false, msg: "Order not found" };
    const { sb } = await import("./db/core");
    const { error } = await sb().from("grading_shares").update({ done: next.done }).eq("order_id", order_id).eq("grader", graderId);
    if (error) return { ok: false, msg: error.message };
  }
  put(next); notify();
  const r = await syncGraded(orderId); if (!r.ok) return r;
  const t = splitTotals(orderId);
  return { ok: true, msg: `${s.grader}: +${photos} → ${next.done}/${next.assigned} · order ${t.done}/${t.given || t.assigned} graded` };
}

/** Database: load the shares. */
export async function hydrateShares() {
  if (!backendOn) return;
  const { sb } = await import("./db/core");
  const { data, error } = await sb().from("grading_shares").select("*");
  if (error) throw new Error(error.message);
  const code = new Map(ORDERS.filter((o) => o.uid).map((o) => [o.uid!, o.id]));
  SHARES.splice(0, SHARES.length, ...((data ?? []) as Record<string, unknown>[]).flatMap((r) => { const id = code.get(String(r.order_id)); return id ? [{ orderId: id, graderId: String(r.grader), grader: nameOf(String(r.grader)), assigned: Number(r.assigned), done: Number(r.done) }] : []; }));
  notify();
}
/** A share's grader name (staff names may load after the shares). */
export const graderName = (s: Share) => people().find((p) => p.id === s.graderId)?.name ?? s.grader;
