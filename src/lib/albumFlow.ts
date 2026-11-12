import { ORDERS, STAFF as DEMO_STAFF, stageLabel, type Order, type StageKey } from "./data";
import { backendOn } from "./supabase";
import { notify } from "./store";
import { staffPeople } from "./db/production";
import { moveStage, onStageMoved } from "./workflow";
import { assignAlbum, photosGiven, photosGraded, progressOf, type Dept, type WorkStatus } from "./jobProgress";
import { GJOBS, startGrading, submitGrading } from "./production";
import { ALBUM_LABS, albumLab } from "./labs";
import { currentActor } from "./audit";

// The Design + Printing process, album by album (migration 0068):
//   order (invoice optional) → each album's grader, designer and lab assigned → colour grading → admin approves → designing
//   → the designer records the client's approval (taken manually) → admin's final approval → lab (albums marked "sent")
//   → received from the lab → QC → delivery.
// The order moves on by itself when every album has finished the step it is at.

/** Every album of the order has this status for the department (one album: the order's own row counts too).
 *  Printing: an album received back from its lab counts as printed. */
export function allAlbumsAt(o: Order, dept: Dept, status: WorkStatus = "done"): boolean {
  const n = Math.max(1, o.albums?.length ?? 0);
  const ok = (k: number) => progressOf(o.id, dept, k)?.status === status || (dept === "printing" && status === "done" && albumLab(o.id, k)?.status === "received");
  if (n === 1 && progressOf(o.id, dept)?.status === status) return true;
  return Array.from({ length: n }, (_, i) => i + 1).every(ok);
}

type Msg = { ok: boolean; msg: string };
const go = (o: Order, to: StageKey): Msg | null => {
  const r = moveStage(o.id, to);
  return r.ok ? null : { ok: false, msg: `${o.id} could not move to ${stageLabel(to)}: ${r.error}` };
};
/** After an update on a department's work: move the order on when every album is through the step it is at. */
export function advanceAfter(orderId: string, dept: Dept): Msg | null {
  const o = ORDERS.find((x) => x.id === orderId); if (!o || o.hold || o.closed) return null;
  const done = (to: StageKey): Msg => ({ ok: true, msg: `All albums done — ${o.id} moved to ${stageLabel(to)}` });
  if (dept === "grading" && o.stage === "colour_grading") {
    // every photo graded (the grader's count reached the photos given), or every album marked done → the job goes to the admin
    const given = photosGiven(o.id) ?? 0, graded = photosGraded(o.id) ?? 0;
    const allPhotos = given > 0 && graded >= given;
    if (allPhotos || allAlbumsAt(o, "grading")) {
      const j = GJOBS.find((x) => x.orderId === o.id);
      if (j) {
        if (j.status === "New") { const s = startGrading(o.id); if (!s.ok) return { ok: false, msg: s.msg }; }
        if (j.status === "In Progress") {
          const r = submitGrading(o.id);
          return r.ok ? { ok: true, msg: allPhotos ? `All ${given} photos graded — ${o.id} sent to the admin for approval` : `All albums graded — ${o.id} sent to the admin for approval` }
            : { ok: false, msg: `All graded, but ${o.id} could not be sent to the admin: ${r.msg}` };
        }
        return null;
      }
      return go(o, "admin_approval") ?? done("admin_approval");
    }
  }
  if (dept === "design" && (o.stage === "designing" || o.stage === "client_review") && allAlbumsAt(o, "design", "client_approved")) {
    if (o.stage === "designing") { const e = go(o, "client_review"); if (e) return e; }
    return go(o, "final_approval") ?? { ok: true, msg: `Client approved every album — ${o.id} is waiting for the admin's final approval` };
  }
  if (dept === "design" && o.stage === "designing" && allAlbumsAt(o, "design")) return { ok: true, msg: "All albums designed — get the client's approval, then set each album to “Client approved”" };
  if (dept === "printing" && o.stage === "printing" && allAlbumsAt(o, "printing")) return go(o, "qc") ?? done("qc");
  if (dept === "delivery" && o.stage === "ready_for_delivery" && allAlbumsAt(o, "delivery")) return go(o, "delivered") ?? done("delivered");
  return null;
}

// On the way to the lab: albums with a lab chosen are marked "sent" (the database does it in a trigger; this keeps the screen in step).
onStageMoved((o, from, to) => {
  if (to !== "printing" || from === "qc") return;
  const now = new Date().toISOString(), me = currentActor().name;
  let changed = false;
  for (const a of ALBUM_LABS) if (a.orderId === o.id && a.labId && a.status === "not_sent") { a.status = "sent"; a.sentAt = now; a.sentBy = me; changed = true; }
  if (changed) notify();
});

/* ───────── people to assign ───────── */
export type Person = { id: string; name: string; role: string };
export const people = (): Person[] => (backendOn ? staffPeople() : DEMO_STAFF.filter((s) => s.status === "Active").map((s) => ({ id: s.id, name: s.name, role: s.role })));
const ROLE_LABEL: Record<string, string> = { admin: "Administrator", reception: "Reception", colour: "Colour Grader", designer: "Designer", printing: "Printing", qc: "QC", accounts: "Accounts" };
const MODULE_LABEL: Record<string, string> = { grading: "Colour Grading", design: "Designing", printing: "Printing", qc: "QC", delivery: "Delivery", order: "Orders", payments: "Payments", invoices: "Invoices", customer: "Customers", reports: "Reports" };
const ROLE_OF: Partial<Record<Dept, RegExp>> = { grading: /^colou?r/i, design: /^designer/i };
const MODULE_OF: Partial<Record<Dept, string>> = { grading: "grading", design: "design" };
/** Extra modules of every user (database mode; what this user may read), so pickers show "Sanjay — Administrator + Designing". */
let MODS: Record<string, string[]> = {}; let modsLoaded = false;
export async function loadMods(): Promise<boolean> {
  if (!backendOn || modsLoaded) return false;
  modsLoaded = true;
  const { sb } = await import("./db/core");
  const { data, error } = await sb().from("user_modules").select("user_id,module");
  if (error) return false;
  MODS = {}; for (const r of (data ?? []) as { user_id: string; module: string }[]) (MODS[r.user_id] ??= []).push(r.module);
  return true;
}
export const personLabel = (p: Person) => `${p.name} — ${[ROLE_LABEL[p.role] ?? p.role, ...(MODS[p.id] ?? []).map((m) => MODULE_LABEL[m] ?? m)].join(" + ")}`;
/** The people for a department: those whose role or extra module fits first, then everyone else. */
export function pickFor(dept: Dept): { fit: Person[]; other: Person[] } {
  const staff = people(), re = ROLE_OF[dept], mod = MODULE_OF[dept];
  const fit = staff.filter((s) => re?.test(s.role) || (!!ROLE_LABEL[s.role] && !!re?.test(ROLE_LABEL[s.role]!)) || (!!mod && (MODS[s.id] ?? []).includes(mod)));
  return { fit, other: staff.filter((s) => !fit.includes(s)) };
}

/** After an order is created: the grader and designer chosen for each album in the order builder. */
export async function applyAlbumAssignments(code: string, albums: { graderId?: string; designerId?: string }[]): Promise<string | null> {
  if (!albums.some((a) => a.graderId || a.designerId)) return null;
  if (backendOn && !ORDERS.some((o) => o.id === code && o.uid)) { const { rehydrate } = await import("./db/core"); await rehydrate(["customers and orders"]); }
  const staff = people();
  for (const [i, a] of albums.entries()) for (const [dept, id] of [["grading", a.graderId], ["design", a.designerId]] as [Dept, string | undefined][]) {
    if (!id) continue;
    const p = staff.find((s) => s.id === id); if (!p) continue;
    const r = await assignAlbum(code, i + 1, dept, { id: p.id, name: p.name }); if (!r.ok) return r.msg;
  }
  return null;
}
