import { ORDERS, STAGES, stageLabel, type Order, type StageKey } from "./data";
import { currentActor, logAudit } from "./audit";
import { hasPrintReadyFile } from "./files";
import { proofApproved } from "./proofs";
import { notify, progressFor } from "./store";
import type { RoleKey } from "./auth";

// Client-side mirror of the database's advance_order() (supabase/migrations/0002_rules.sql).
// When the backend is connected, moveStage() becomes a thin call to that function; callers don't change.
type Flow = "Design + Printing" | "Printing";
interface T { flow: Flow | "both"; from: StageKey; to: StageKey; roles: RoleKey[]; reason?: boolean }
export const TRANSITIONS: T[] = [
  { flow: "both", from: "new_order", to: "files_received", roles: ["admin", "reception"] },
  { flow: "Design + Printing", from: "files_received", to: "colour_grading", roles: ["admin", "reception"] },
  { flow: "Design + Printing", from: "colour_grading", to: "admin_approval", roles: ["admin", "colour"] },
  { flow: "Design + Printing", from: "admin_approval", to: "designing", roles: ["admin"] },
  { flow: "Design + Printing", from: "admin_approval", to: "colour_grading", roles: ["admin"], reason: true },
  { flow: "Design + Printing", from: "designing", to: "client_review", roles: ["admin", "designer"] },
  { flow: "Design + Printing", from: "client_review", to: "designing", roles: ["admin", "designer"], reason: true },
  { flow: "Design + Printing", from: "client_review", to: "final_approval", roles: ["admin"] },
  { flow: "Design + Printing", from: "final_approval", to: "printing", roles: ["admin"] },
  { flow: "Printing", from: "files_received", to: "printing", roles: ["admin", "reception"] },
  { flow: "both", from: "printing", to: "qc", roles: ["admin", "printing"] },
  { flow: "both", from: "qc", to: "ready_for_delivery", roles: ["admin", "qc"] },
  { flow: "both", from: "qc", to: "printing", roles: ["admin", "qc"], reason: true },          // rework loop
  { flow: "both", from: "ready_for_delivery", to: "delivered", roles: ["admin", "reception", "printing", "qc"] },
];
const idx = (s: StageKey) => STAGES.findIndex((x) => x.key === s);
const flowOf = (o: Order): Flow => o.workflow;
export const SKIPPED_FOR_PRINTING_ONLY: StageKey[] = ["colour_grading", "admin_approval", "designing", "client_review", "final_approval"];

export type Result = { ok: true; order: Order } | { ok: false; error: string };
const fail = (error: string): Result => ({ ok: false, error });
const qcPassed = (o: Order) => o.qc === "passed" || idx(o.stage) > idx("qc");

/** Valid next stages for the current user (used to build menus / disable drops). */
export function nextStages(o: Order, role: RoleKey | "system" = currentActor().role): { to: StageKey; needsReason: boolean }[] {
  if (o.closed || o.hold === "Cancelled") return [];
  return TRANSITIONS.filter((t) => (t.flow === "both" || t.flow === flowOf(o)) && t.from === o.stage && (role === "system" || t.roles.includes(role as RoleKey)))
    .map((t) => ({ to: t.to, needsReason: !!t.reason }));
}

export function moveStage(orderId: string, to: StageKey, opts: { reason?: string; override?: boolean } = {}): Result {
  const o = ORDERS.find((x) => x.id === orderId);
  if (!o) return fail("Order not found");
  const { role } = currentActor();
  const reason = (opts.reason ?? "").trim();
  const admin = role === "admin" || role === "system";
  if (o.closed) return fail(`${o.id} is closed and read-only — reopen it first`);                       // ALB-FR-0497
  if (o.hold === "Cancelled") return fail(`${o.id} is cancelled`);
  if (o.hold === "On Hold" && !(opts.override && admin)) return fail(`${o.id} is on hold`);
  const t = TRANSITIONS.find((x) => (x.flow === "both" || x.flow === flowOf(o)) && x.from === o.stage && x.to === to);
  let overridden = false;
  if (!t) {
    if (!(opts.override && admin && reason)) return fail(`${stageLabel(o.stage)} → ${stageLabel(to)} is not allowed for ${flowOf(o)} orders${admin ? " (admin override needs a reason)" : ""}`);
    overridden = true;                                                                                    // ALB-FR-0494
  } else {
    if (role !== "system" && !t.roles.includes(role)) return fail(`Your role (${role}) may not move ${stageLabel(o.stage)} → ${stageLabel(to)}`);
    if (t.reason && !reason) return fail("A reason is required for this move");
  }
  if (!opts.override) {                                                                                   // gates
    if (o.stage === "final_approval" && to === "printing" && flowOf(o) === "Design + Printing" && !proofApproved(o.id)) return fail("Final client approval is required before release to printing");   // ALB-FR-0495
    if (o.stage === "files_received" && to === "printing" && flowOf(o) === "Printing" && !hasPrintReadyFile(o.id)) return fail("Upload a print-ready file (category Final Print) before printing");               // ALB-FR-0077
    if (to === "ready_for_delivery" && !qcPassed(o)) return fail("QC must pass before Ready for Delivery");                                                                                              // ALB-FR-0496
  }
  const from = o.stage;
  o.stage = to; o.progress = progressFor(to);
  if (from === "qc" && to === "printing") o.qc = "rework";
  if (to === "qc") o.qc = "pending";
  notify();
  logAudit({ entity: "order", entityId: o.id, action: overridden ? "stage_override" : "stage_change", from: stageLabel(from), to: stageLabel(to), reason: reason || undefined, override: overridden || undefined });
  return { ok: true, order: o };
}

export function setHold(orderId: string, hold: boolean, reason = ""): Result {
  const o = ORDERS.find((x) => x.id === orderId); if (!o) return fail("Order not found");
  if (o.closed) return fail("Closed orders are read-only");
  if (hold && !reason.trim()) return fail("A reason is required to put an order on hold");
  o.hold = hold ? "On Hold" : undefined; notify();
  logAudit({ entity: "order", entityId: o.id, action: hold ? "hold" : "resume", reason: reason || undefined }); return { ok: true, order: o };
}

export function cancelOrder(orderId: string, reason: string): Result {
  const o = ORDERS.find((x) => x.id === orderId); if (!o) return fail("Order not found");
  if (currentActor().role !== "admin") return fail("Only an admin can cancel an order");
  if (!reason.trim()) return fail("Cancellation reason is required");                                    // ALB-FR-0498: history is preserved, nothing is deleted
  o.hold = "Cancelled"; o.cancelReason = reason.trim(); notify();
  logAudit({ entity: "order", entityId: o.id, action: "cancel", reason: reason.trim() }); return { ok: true, order: o };
}

/** §14.2 — an order closes only once it is delivered AND fully paid, unless an admin overrides with a reason. */
export function closeOrder(orderId: string, opts: { override?: boolean; reason?: string } = {}): Result {
  const o = ORDERS.find((x) => x.id === orderId); if (!o) return fail("Order not found");
  if (currentActor().role !== "admin") return fail("Only an admin can close an order");
  if (o.stage !== "delivered") return fail("Only delivered orders can be closed");
  if (o.paid < o.total && !(opts.override && opts.reason?.trim())) return fail(`${o.total - o.paid} is still outstanding — collect payment or close with an override reason`);
  o.closed = true; o.closedAt = new Date().toISOString(); notify();
  logAudit({ entity: "order", entityId: o.id, action: "close", reason: opts.reason, override: o.paid < o.total || undefined }); return { ok: true, order: o };
}
export function reopenOrder(orderId: string, reason: string): Result {
  const o = ORDERS.find((x) => x.id === orderId); if (!o) return fail("Order not found");
  if (currentActor().role !== "admin") return fail("Only an admin can reopen an order");
  if (!reason.trim()) return fail("A reason is required to reopen an order");
  o.closed = false; o.closedAt = undefined; notify();
  logAudit({ entity: "order", entityId: o.id, action: "reopen", reason: reason.trim() }); return { ok: true, order: o };
}

export function pauseSla(orderId: string, reason: string): Result {
  const o = ORDERS.find((x) => x.id === orderId); if (!o) return fail("Order not found");
  if (!reason.trim()) return fail("A reason is required to pause the SLA clock");                          // ALB-FR-0006
  o.slaPausedAt = new Date().toISOString(); o.slaPauseReason = reason.trim(); notify();
  logAudit({ entity: "order", entityId: o.id, action: "sla_pause", reason: reason.trim() }); return { ok: true, order: o };
}
export function resumeSla(orderId: string): Result {
  const o = ORDERS.find((x) => x.id === orderId); if (!o) return fail("Order not found");
  o.slaPausedAt = undefined; o.slaPauseReason = undefined; notify(); logAudit({ entity: "order", entityId: o.id, action: "sla_resume" }); return { ok: true, order: o };
}
