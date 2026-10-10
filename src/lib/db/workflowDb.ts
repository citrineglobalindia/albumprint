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
export function dbSetSla(orderUid: string | undefined, pausedAt: string | null, reason: string | null, revert: () => void) {
  if (!backendOn || !orderUid) return;
  writeThrough("Updating SLA clock", () => sb().from("orders").update({ sla_paused_at: pausedAt, sla_pause_reason: reason }).eq("id", orderUid) as never, revert);
}
export const uidOf = (id: string) => ORDERS.find((o) => o.id === id)?.uid;
