import { CUSTOMERS, ORDERS, type Customer, type Order } from "./data";
import { backendOn } from "./supabase";
import { notify } from "./store";
import { currentActor, logAudit } from "./audit";

// One customer, one line: records with the same mobile number are the same studio (typed in again as a new customer).
// The list shows the oldest record with every order of the group; an admin can merge the duplicates into it (merge_customers, 0069).
export const mobileKey = (m: string) => m.replace(/\D/g, "").slice(-10);
export interface CustomerGroup { primary: Customer; dupes: Customer[] }
export function customerGroups(list: Customer[] = CUSTOMERS): CustomerGroup[] {
  const by = new Map<string, Customer[]>();
  for (const c of list) { const k = mobileKey(c.mobile) || `id:${c.id}`; by.set(k, [...(by.get(k) ?? []), c]); }
  return [...by.values()].map((g) => { const s = [...g].sort((a, b) => (a.since || "").localeCompare(b.since || "") || a.id.localeCompare(b.id)); return { primary: s[0]!, dupes: s.slice(1) }; });
}
export const groupOf = (c: Customer) => customerGroups().find((g) => g.primary.id === c.id || g.dupes.some((d) => d.id === c.id));
/** Every order of the customer: by mobile number (so the duplicates' orders count too), else by name. */
export function customerOrders(c: Customer): Order[] {
  const k = mobileKey(c.mobile), names = new Set([c.studio, c.name, ...(groupOf(c)?.dupes ?? []).map((d) => d.studio)].filter(Boolean));
  return ORDERS.filter((o) => (k && mobileKey(o.mobile) === k) || names.has(o.customer));
}
/** Totals of a customer from their orders (all records of the group). */
export function customerStats(c: Customer) {
  const os = customerOrders(c).filter((o) => o.hold !== "Cancelled");
  const billed = os.reduce((s, o) => s + o.total, 0), paid = os.reduce((s, o) => s + o.paid, 0);
  const dates = os.map((o) => o.pendingAt).filter(Boolean).sort();
  return { orders: os.length, active: os.filter((o) => !["delivered", "closed"].includes(o.stage) && !o.closed).length, billed, paid, dues: Math.max(0, billed - paid), first: dates[0], last: dates.at(-1) };
}

/** Admin: merge the duplicates into the customer kept (orders, invoices and messages move; the duplicates are removed). */
export async function mergeCustomers(keep: Customer, others: Customer[]): Promise<{ ok: boolean; msg: string }> {
  if (currentActor().role !== "admin") return { ok: false, msg: "Only an admin merges customers" };
  if (!others.length) return { ok: false, msg: "Nothing to merge" };
  if (backendOn) {
    if (!keep.uid || others.some((o) => !o.uid)) return { ok: false, msg: "Customer not found" };
    const { sb, rehydrate } = await import("./db/core");
    const { data, error } = await sb().rpc("merge_customers", { p_keep: keep.uid, p_merge: others.map((o) => o.uid) });
    if (error) return { ok: false, msg: error.message };
    await rehydrate(["customers and orders", "payments and invoices"]);
    const r = data as { merged: number; orders: number };
    return { ok: true, msg: `${r.merged} duplicate record(s) merged into ${keep.id} · ${r.orders} order(s) moved` };
  }
  let moved = 0;
  for (const d of others) {
    for (const o of ORDERS) if (o.customer === d.studio && mobileKey(o.mobile) === mobileKey(d.mobile)) { o.customer = keep.studio; moved++; }
    keep.email ||= d.email; keep.city ||= d.city; keep.state ||= d.state;
    const i = CUSTOMERS.indexOf(d); if (i >= 0) CUSTOMERS.splice(i, 1);
  }
  logAudit({ entity: "customer", entityId: keep.id, action: "merge", detail: `Merged ${others.map((d) => d.id).join(", ")} · ${moved} order(s) moved` });
  notify(); return { ok: true, msg: `${others.length} duplicate record(s) merged into ${keep.id} · ${moved} order(s) moved` };
}
/** An existing customer with this mobile number (to reuse instead of creating a duplicate). */
export const customerByMobile = (m: string) => { const k = mobileKey(m); return k.length === 10 ? customerGroups().find((g) => mobileKey(g.primary.mobile) === k)?.primary : undefined; };
