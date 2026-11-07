import { persistArray } from "./persist";
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
export interface Progress { orderId: string; dept: Dept; count?: number; status?: WorkStatus; note?: string; by?: string; at?: string }
export const PROGRESS: Progress[] = persistArray<Progress>("job_progress", []);
export const progressOf = (orderId: string, dept: Dept) => PROGRESS.find((p) => p.orderId === orderId && p.dept === dept);
export const photosGiven = (orderId: string) => progressOf(orderId, "order")?.count;

const WRITE: Record<Dept, RoleKey[]> = { order: ["admin", "reception"], grading: ["admin", "colour"], design: ["admin", "designer"], printing: ["admin", "printing"], qc: ["admin", "qc"], delivery: ["admin", "reception", "qc"] };
export const canUpdate = (dept: Dept) => { const r = currentActor().role; return r !== "system" && WRITE[dept].includes(r as RoleKey); };

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
export async function hydrateProgress() {
  if (!backendOn) return;
  const { sb } = await import("./db/core"); const { staffName } = await import("./db/production");
  const { data, error } = await sb().from("job_progress").select("*");
  if (error) throw new Error(error.message);
  PROGRESS.splice(0, PROGRESS.length, ...((data ?? []) as Row[]).flatMap((r) => { const o = ORDERS.find((x) => x.uid === r.order_id); return o ? [{ orderId: o.id, dept: r.dept as Dept, count: r.count ?? undefined, status: r.status ?? undefined, note: r.note ?? undefined, by: staffName(r.updated_by) ?? undefined, at: r.updated_at }] : []; }));
  notify();
}

/** Save a count and/or status update. Fields left undefined keep their value. */
export async function saveProgress(orderId: string, dept: Dept, patch: { count?: number | null; status?: WorkStatus | null; note?: string | null }): Promise<{ ok: boolean; msg: string }> {
  if (!canUpdate(dept)) return { ok: false, msg: `Your role can't update ${DEPT_LABEL[dept]}` };
  if (patch.count != null && (!Number.isInteger(patch.count) || patch.count < 0)) return { ok: false, msg: "Enter a whole number of 0 or more" };
  const cur = progressOf(orderId, dept);
  const next: Progress = { orderId, dept, count: patch.count === undefined ? cur?.count : patch.count ?? undefined, status: patch.status === undefined ? cur?.status : patch.status ?? undefined, note: patch.note === undefined ? cur?.note : patch.note?.trim() || undefined, by: currentActor().name, at: new Date().toISOString() };
  if (backendOn) {
    const o = ORDERS.find((x) => x.id === orderId); if (!o?.uid) return { ok: false, msg: "Order not found" };
    const { sb } = await import("./db/core");
    const { error } = await sb().from("job_progress").upsert({ order_id: o.uid, dept, count: next.count ?? null, status: next.status ?? null, note: next.note ?? null }, { onConflict: "order_id,dept" });
    if (error) return { ok: false, msg: error.message };
  } else logAudit({ entity: "order", entityId: orderId, action: "progress", detail: `${DEPT_LABEL[dept]}: ${[next.count != null ? `count ${next.count}` : "", statusLabel(next.status), next.note ?? ""].filter(Boolean).join(" · ")}` });
  const i = PROGRESS.indexOf(cur!); if (cur && i >= 0) PROGRESS[i] = next; else PROGRESS.push(next);
  notify(); return { ok: true, msg: `${DEPT_LABEL[dept]} updated` };
}

/** After an order is finalized: the optional photos-given count from the order builder. */
export async function applyPhotosGiven(code: string, n: number | undefined): Promise<string | null> {
  if (n === undefined) return null;
  if (backendOn && !ORDERS.some((o) => o.id === code && o.uid)) { const { rehydrate } = await import("./db/core"); await rehydrate(["customers and orders"]); }
  const r = await saveProgress(code, "order", { count: n }); return r.ok ? null : r.msg;
}
