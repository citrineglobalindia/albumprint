import { ORDERS, type Order } from "./data";
import { logAudit } from "./audit";
import { notify } from "./store";

/** Non-stage edits (priority, assignee, dates, size, workflow type) — applied in place and written to the audit trail. */
export function editOrder(id: string, patch: Partial<Order>, action: string, detail?: string) {
  const o = ORDERS.find((x) => x.id === id); if (!o) return undefined;
  const keys = Object.keys(patch) as (keyof Order)[];
  const from = keys.map((k) => `${String(k)}=${String(o[k] ?? "")}`).join(", ");
  const to = keys.map((k) => `${String(k)}=${String(patch[k] ?? "")}`).join(", ");
  Object.assign(o, patch); notify();
  logAudit({ entity: "order", entityId: id, action, from, to, detail });
  return o;
}
