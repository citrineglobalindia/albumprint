import { persistArray } from "./persist";
import { hasModule, type Module } from "./access";
import { ORDERS } from "./data";
import { notify } from "./store";
import { backendOn } from "./supabase";
import { currentActor, logAudit } from "./audit";
import type { RoleKey } from "./auth";

// Work counts and status updates per order and department (migration 0056, job_progress):
// photos given (order), photos graded (grading), sheets designed (design), and each department's own status update with a note.
export type Dept = "order" | "grading" | "design" | "printing" | "qc" | "delivery";
export type WorkStatus = "not_started" | "working" | "waiting_files" | "waiting_client" | "paused" | "done";
export const WORK_STATUS: { key: WorkStatus; label: string; tone: "slate" | "blue" | "amber" | "indigo" | "orange" | "green" }[] = [
  { key: "not_started", label: "Not started", tone: "slate" }, { key: "working", label: "Working on it", tone: "blue" },
  { key: "waiting_files", label: "Waiting for files", tone: "amber" }, { key: "waiting_client", label: "Waiting for client", tone: "indigo" },
  { key: "paused", label: "Paused", tone: "orange" }, { key: "done", label: "Done", tone: "green" },
];
export const statusLabel = (s?: WorkStatus) => WORK_STATUS.find((x) => x.key === s)?.label ?? "";
export const DEPT_LABEL: Record<Dept, string> = { order: "Order", grading: "Colour Grading", design: "Designing", printing: "Printing", qc: "QC", delivery: "Delivery" };
/** album: 0 or left out = the whole order; 1.. = the album at that position on the order (migration 0064). */
export interface Progress { orderId: string; album?: number; dept: Dept; assigneeId?: string; assignee?: string; count?: number; status?: WorkStatus; note?: string; by?: string; at?: string }
export const PROGRESS: Progress[] = persistArray<Progress>("job_progress", []);
export const progressOf = (orderId: string, dept: Dept, album = 0) => PROGRESS.find((p) => p.orderId === orderId && p.dept === dept && (p.album ?? 0) === album);
export const photosGiven = (orderId: string) => progressOf(orderId, "order")?.count;
/** Photos graded on an order: the albums' counts added up when they are kept per album, else the order's own count. */
export function photosGraded(orderId: string): number | undefined {
  const per = PROGRESS.filter((p) => p.orderId === orderId && p.dept === "grading" && (p.album ?? 0) > 0 && p.count != null);
  return per.length ? per.reduce((s, p) => s + (p.count ?? 0), 0) : progressOf(orderId, "grading")?.count;
}
/** Photos still to grade (photos given − graded), when the photos given are known. */
export const photosPending = (orderId: string) => { const g = photosGiven(orderId); return g == null ? undefined : Math.max(0, g - (photosGraded(orderId) ?? 0)); };
/** Who updated the grading of an order (the order's own row or any album's). */
export const gradingBy = (orderId: string) => new Set(PROGRESS.filter((p) => p.orderId === orderId && p.dept === "grading").flatMap((p) => [p.by, p.assignee]).filter(Boolean) as string[]);

const WRITE: Record<Dept, RoleKey[]> = { order: ["admin", "reception"], grading: ["admin", "colour"], design: ["admin", "designer"], printing: ["admin", "printing"], qc: ["admin", "qc"], delivery: ["admin", "reception", "qc"] };
const DEPT_MODULE: Record<Dept, Module> = { order: "order", grading: "grading", design: "design", printing: "printing", qc: "qc", delivery: "delivery" };
export const canUpdate = (dept: Dept) => { const r = currentActor().role; return r !== "system" && (WRITE[dept].includes(r as RoleKey) || hasModule(DEPT_MODULE[dept])); };

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export async function hydrateProgress() {
  if (!backendOn) return;
  const { sb } = await import("./db/core"); const { staffName } = await import("./db/production");
  const { data, error } = await sb().from("job_progress").select("*");
  if (error) throw new Error(error.message);
  PROGRESS.splice(0, PROGRESS.length, ...((data ?? []) as Row[]).flatMap((r) => { const o = ORDERS.find((x) => x.uid === r.order_id); return o ? [{ orderId: o.id, album: r.album ?? 0, dept: r.dept as Dept, assigneeId: r.assignee ?? undefined, assignee: staffName(r.assignee) ?? undefined, count: r.count ?? undefined, status: r.status ?? undefined, note: r.note ?? undefined, by: staffName(r.updated_by) ?? undefined, at: r.updated_at }] : []; }));
  notify();
}

/** Save a count and/or status update. Fields left undefined keep their value. */
export async function saveProgress(orderId: string, dept: Dept, patch: { count?: number | null; status?: WorkStatus | null; note?: string | null }, album = 0): Promise<{ ok: boolean; msg: string }> {
  if (!canUpdate(dept)) return { ok: false, msg: `Your role can't update ${DEPT_LABEL[dept]}` };
  if (patch.count != null && (!Number.isInteger(patch.count) || patch.count < 0)) return { ok: false, msg: "Enter a whole number of 0 or more" };
  const cur = progressOf(orderId, dept, album);
  const next: Progress = { ...(cur ?? {}), orderId, album, dept, count: patch.count === undefined ? cur?.count : patch.count ?? undefined, status: patch.status === undefined ? cur?.status : patch.status ?? undefined, note: patch.note === undefined ? cur?.note : patch.note?.trim() || undefined, by: currentActor().name, at: new Date().toISOString() };
  if (backendOn) {
    const o = ORDERS.find((x) => x.id === orderId); if (!o?.uid) return { ok: false, msg: "Order not found" };
    const { sb } = await import("./db/core");
    const { error } = await sb().from("job_progress").upsert({ order_id: o.uid, album, dept, count: next.count ?? null, status: next.status ?? null, note: next.note ?? null }, { onConflict: "order_id,album,dept" });
    if (error) return { ok: false, msg: error.message };
  } else logAudit({ entity: "order", entityId: orderId, action: "progress", detail: `${album ? `Album ${album} · ` : ""}${DEPT_LABEL[dept]}: ${[next.count != null ? `count ${next.count}` : "", statusLabel(next.status), next.note ?? ""].filter(Boolean).join(" · ")}` });
  const i = PROGRESS.indexOf(cur!); if (cur && i >= 0) PROGRESS[i] = next; else PROGRESS.push(next);
  notify(); return { ok: true, msg: `${album ? `Album ${album}: ` : ""}${DEPT_LABEL[dept]} updated` };
}

/** After an order is finalized: the optional photos-given count from the order builder. */
export async function applyPhotosGiven(code: string, n: number | undefined): Promise<string | null> {
  if (n === undefined) return null;
  if (backendOn && !ORDERS.some((o) => o.id === code && o.uid)) { const { rehydrate } = await import("./db/core"); await rehydrate(["customers and orders"]); }
  const r = await saveProgress(code, "order", { count: n }); return r.ok ? null : r.msg;
}

/** Admin / reception: who works on an album for a department (null = nobody). The person is notified (database mode). */
export async function assignAlbum(orderId: string, album: number, dept: Dept, person: { id: string; name: string } | null): Promise<{ ok: boolean; msg: string }> {
  const r = currentActor().role;
  if (r !== "admin" && r !== "reception" && !hasModule("order")) return { ok: false, msg: "Only admin or reception assigns work" };
  if (backendOn) {
    const o = ORDERS.find((x) => x.id === orderId); if (!o?.uid) return { ok: false, msg: "Order not found" };
    const { sb } = await import("./db/core");
    const { error } = await sb().rpc("assign_album_work", { p_order: o.uid, p_album: album, p_dept: dept, p_user: person?.id ?? null });
    if (error) return { ok: false, msg: error.message };
  } else logAudit({ entity: "order", entityId: orderId, action: "album_assign", detail: `Album ${album} · ${DEPT_LABEL[dept]}: ${person?.name ?? "unassigned"}` });
  const cur = progressOf(orderId, dept, album);
  if (cur) { cur.assigneeId = person?.id; cur.assignee = person?.name; } else PROGRESS.push({ orderId, album, dept, assigneeId: person?.id, assignee: person?.name });
  notify(); return { ok: true, msg: person ? `Album ${album} · ${DEPT_LABEL[dept]}: assigned to ${person.name}` : `Album ${album} · ${DEPT_LABEL[dept]}: unassigned` };
}
