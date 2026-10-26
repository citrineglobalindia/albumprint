import { staffId } from "./production";
import { ORDERS } from "../data";
import { backendOn, sb, writeThrough } from "./core";

// Background database writes behind the client workflow engine (src/lib/workflow.ts). The engine applies the change locally first
// (optimistic) and calls these; if the database refuses (it enforces the same rules), `revert` restores the previous local state.
export function dbAdvance(orderUid: string | undefined, to: string, reason: string | undefined, override: boolean, revert: () => void) {
  if (!backendOn || !orderUid) return;
  writeThrough("Moving order", () => sb().rpc("advance_order", { p_order: orderUid, p_to: to, p_reason: reason ?? null, p_override: override }) as never, revert);
}
export function dbSetHold(orderUid: string | undefined, hold: boolean, reason: string, revert: () => void) {
  if (!backendOn || !orderUid) return;
  writeThrough(hold ? "Putting order on hold" : "Resuming order", () => sb().from("orders").update({ on_hold: hold, hold_reason: hold ? reason : null }).eq("id", orderUid) as never, revert);
}
/** Control Center: reassign the order to a staff member (by display name). Returns false when that name is not a known staff member. */
const PRI_OF = (p: string) => p.toLowerCase();
/** Orders list / Control Center edits (priority, assignee, due date, workflow type). Returns an error text when a value cannot be saved. */
export function dbEditOrder(orderUid: string | undefined, patch: Record<string, unknown>, revert: () => void): string | null {
  if (!backendOn || !orderUid) return null;
  const row: Record<string, unknown> = {};
  if (typeof patch.priority === "string") row.priority = PRI_OF(patch.priority);
  if (typeof patch.due === "string") row.due_date = patch.due;
  if (typeof patch.workflow === "string") row.type = patch.workflow === "Printing" ? "printing_only" : "design_printing";
  if (typeof patch.assignee === "string") { const id = staffId(patch.assignee); if (!id) return `${patch.assignee} has no staff account`; row.assignee = id; }
  if (!Object.keys(row).length) return null;
  writeThrough("Saving order changes", () => sb().from("orders").update(row).eq("id", orderUid) as never, revert);
  return null;
}
export function dbSetAssignee(orderUid: string | undefined, name: string, revert: () => void): boolean {
  if (!backendOn || !orderUid) return true;
  const id = staffId(name);
  if (!id) return false;
  writeThrough("Reassigning order", () => sb().from("orders").update({ assignee: id }).eq("id", orderUid) as never, revert);
  return true;
}
export function dbSetPriority(orderUid: string | undefined, priority: string, revert: () => void) {
  if (!backendOn || !orderUid) return;
  writeThrough("Changing priority", () => sb().from("orders").update({ priority: priority.toLowerCase() }).eq("id", orderUid) as never, revert);
}
export function dbSetSla(orderUid: string | undefined, pausedAt: string | null, reason: string | null, revert: () => void) {
  if (!backendOn || !orderUid) return;
  writeThrough("Updating SLA clock", () => sb().from("orders").update({ sla_paused_at: pausedAt, sla_pause_reason: reason }).eq("id", orderUid) as never, revert);
}
export const uidOf = (id: string) => ORDERS.find((o) => o.id === id)?.uid;
