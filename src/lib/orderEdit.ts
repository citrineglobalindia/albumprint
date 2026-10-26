import { ORDERS, type Order } from "./data";
import { logAudit } from "./audit";
import { notify } from "./store";
import { dbEditOrder } from "./db/workflowDb";
import { reportDbError } from "./db/core";

/** Non-stage edits (priority, assignee, dates, size, workflow type) — applied in place and written to the audit trail. */
export function editOrder(id: string, patch: Partial<Order>, action: string, detail?: string) {
  const o = ORDERS.find((x) => x.id === id); if (!o) return undefined;
  const keys = Object.keys(patch) as (keyof Order)[];
  const from = keys.map((k) => `${String(k)}=${String(o[k] ?? "")}`).join(", ");
  const to = keys.map((k) => `${String(k)}=${String(patch[k] ?? "")}`).join(", ");
  const before = Object.fromEntries(keys.map((k) => [k, o[k]])) as Partial<Order>;
  const refused = dbEditOrder(o.uid, patch as Record<string, unknown>, () => { Object.assign(o, before); notify(); });
  if (refused) { reportDbError("Saving order changes", { message: refused }); return o; }
  Object.assign(o, patch); notify();
  logAudit({ entity: "order", entityId: id, action, from, to, detail });
  return o;
}
