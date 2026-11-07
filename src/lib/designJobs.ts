import { persistArray } from "./persist";
import { ORDERS, type Order } from "./data";
import { notify } from "./store";
import { backendOn } from "./supabase";
import { currentActor, logAudit } from "./audit";
import { latestProof } from "./proofs";
import { dutyBlock } from "./duty";
import type { GEvent } from "./production";

// Design jobs, the designer's job card (like a grading job): who is designing, when they started, when the proof went to the client,
// how many rounds, an internal note and the history. The order's stage and the proofs still drive the workflow.
// Database: tasks kind 'design' (migration 0053, design_task); demo: kept in this browser.
export interface DJob { orderId: string; designer: string; startedAt?: string; submittedAt?: string; rounds: number; internalNote: string; events: GEvent[] }
export const DJOBS: DJob[] = persistArray<DJob>("design_jobs", []);
export type DStatus = "New" | "In Progress" | "Corrections" | "Admin Review" | "With Client" | "Approved";
export const DSTATUS_TONE: Record<DStatus, "blue" | "violet" | "red" | "amber" | "indigo" | "green"> = { New: "blue", "In Progress": "violet", Corrections: "red", "Admin Review": "amber", "With Client": "indigo", Approved: "green" };

const STAGES_SHOWN = ["designing", "client_review", "final_approval", "printing", "qc", "ready_for_delivery"];
/** Orders that have (or had) design work, newest stage first. */
export const designOrders = (): Order[] => ORDERS.filter((o) => o.workflow !== "Printing" && STAGES_SHOWN.includes(o.stage) && o.hold !== "Cancelled");
export const djob = (orderId: string) => DJOBS.find((j) => j.orderId === orderId);

export function dstatus(o: Order): DStatus {
  const j = djob(o.id), p = latestProof(o.id);
  if (o.stage === "designing") return p?.status === "corrections" ? "Corrections" : j?.startedAt ? "In Progress" : "New";
  if (o.stage === "client_review") return "With Client";
  return "Approved";
}
/** When the design work ended (the latest proof sent), or nothing while it is being worked on. */
export const designEnd = (o: Order): string | undefined => { const s = dstatus(o); return s === "With Client" || s === "Admin Review" || s === "Approved" ? djob(o.id)?.submittedAt ?? latestProof(o.id)?.createdAt : undefined; };
export const designerOf = (o: Order) => djob(o.id)?.designer || (o.assignee && o.assignee !== "—" && o.assignee !== "Unassigned" ? o.assignee : "Unassigned");

type Out = { ok: boolean; msg: string };
const ensure = (o: Order): DJob => { let j = djob(o.id); if (!j) { j = { orderId: o.id, designer: designerOf(o) === "Unassigned" ? currentActor().name : designerOf(o), rounds: 0, internalNote: "", events: [] }; DJOBS.push(j); } return j; };
const ev = (j: DJob, text: string) => j.events.unshift({ at: new Date().toISOString(), by: currentActor().name, text });

async function rpc(o: Order, action: "start" | "submit" | "note", note?: string): Promise<string | null> {
  if (!backendOn || !o.uid) return null;
  const { sb } = await import("./db/core");
  const { error } = await sb().rpc("design_task", { p_order: o.uid, p_action: action, p_note: note ?? null });
  return error ? error.message : null;
}

export async function startDesign(orderId: string): Promise<Out> {
  const o = ORDERS.find((x) => x.id === orderId); if (!o) return { ok: false, msg: "Order not found" };
  const r = currentActor().role; if (r !== "admin" && r !== "designer") return { ok: false, msg: "Only designers start design jobs" };
  if (o.stage !== "designing") return { ok: false, msg: `${o.id} is not in Designing` };
  const duty = dutyBlock(); if (duty) return { ok: false, msg: duty };
  const e = await rpc(o, "start"); if (e) return { ok: false, msg: e };
  const j = ensure(o); const resumed = j.rounds > 0; j.startedAt ??= new Date().toISOString(); ev(j, resumed ? "Design resumed (corrections)" : "Design started");
  if (!backendOn) logAudit({ entity: "order", entityId: o.id, action: "design_start" });
  notify(); return { ok: true, msg: resumed ? `${o.id}: working on the corrections` : `${o.id}: design started` };
}
/** Called when a proof goes to the client. */
export async function designSubmitted(orderId: string): Promise<void> {
  const o = ORDERS.find((x) => x.id === orderId); if (!o) return;
  const e = await rpc(o, "submit"); if (e) console.warn("[db] Recording the design submission:", e);
  const j = ensure(o); j.startedAt ??= new Date().toISOString(); j.submittedAt = new Date().toISOString(); j.rounds += 1; ev(j, `Proof sent to the client (round ${j.rounds})`); notify();
}
export async function saveDesignNote(orderId: string, note: string): Promise<Out> {
  const o = ORDERS.find((x) => x.id === orderId); if (!o) return { ok: false, msg: "Order not found" };
  const e = await rpc(o, "note", note); if (e) return { ok: false, msg: e };
  ensure(o).internalNote = note.trim(); notify(); return { ok: true, msg: "Note saved" };
}
