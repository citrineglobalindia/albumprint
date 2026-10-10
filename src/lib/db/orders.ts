import { ORDERS, CUSTOMERS, type Order, type Customer, type Priority, type StageKey, type PayStatus } from "../data";
import { notify, progressFor } from "../store";
import { backendOn, sb, q, registerHydrator, reportDbError } from "./core";

// ───────── mappings: database rows ⇄ the shapes the UI uses ─────────
const PRI: Record<string, Priority> = { low: "Low", normal: "Normal", high: "High", urgent: "Urgent", vip: "VIP" };
const PRI_DB = Object.fromEntries(Object.entries(PRI).map(([k, v]) => [v, k]));
const PAY: Record<string, PayStatus> = { unpaid: "Unpaid", partially_paid: "Partial", paid: "Paid", overpaid: "Paid", refunded: "Unpaid", credit: "Paid" };
// DB has stages the UI folds together: design_review → client_review; closed → delivered (+closed flag); cancelled → hold flag
export const stageFromDb = (s: string): StageKey => (s === "design_review" ? "client_review" : s === "closed" ? "delivered" : s === "cancelled" ? "new_order" : (s as StageKey));
export const priorityToDb = (p: Priority) => PRI_DB[p] ?? "normal";
const SEG: Record<string, Customer["type"]> = { regular: "Regular", vip: "VIP", new: "New" };
export const segmentToDb = (t: Customer["type"]) => t.toLowerCase();

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

export function customerFromRow(r: Row): Customer {
  return { uid: r.id, id: r.code, name: r.contact_person || r.studio_name, studio: r.studio_name, mobile: r.mobile ?? "", email: r.email ?? "", city: r.city ?? "", state: r.state ?? "",
    type: SEG[r.segment] ?? "Regular", status: r.active ? "Active" : "Inactive", activeOrders: 0, lifetime: 0, lastOrder: "", since: (r.created_at ?? "").slice(0, 10), dues: 0, tags: [],
    gstin: r.gstin ?? undefined, whatsapp: r.whatsapp ?? undefined };
}

export function orderFromRow(r: Row, cust: Map<string, Customer>, staff: Map<string, string>): Order {
  const c = cust.get(r.customer_id);
  const spec: Row | undefined = Array.isArray(r.order_specs) ? r.order_specs[0] : r.order_specs ?? undefined;
  const stage = stageFromDb(r.stage);
  const o: Order = {
    uid: r.id, id: r.code, customer: c?.studio ?? "", mobile: c?.mobile ?? "", event: r.event_type ?? r.event_name ?? "—",
    workflow: r.type === "printing_only" ? "Printing" : "Design + Printing", size: spec?.album_size ?? "", pages: spec?.pages ?? 0,
    stage, priority: PRI[r.priority] ?? "Normal", pendingAt: r.order_date, assignee: (r.assignee && staff.get(r.assignee)) || "—", due: r.due_date,
    pay: PAY[r.pay_status] ?? "Unpaid", total: Number(r.total), paid: Number(r.paid), progress: progressFor(stage),
    qc: r.qc_status === "pending" ? undefined : r.qc_status,
  };
  if (r.sla_paused_at) { o.slaPausedAt = r.sla_paused_at; o.slaPauseReason = r.sla_pause_reason ?? undefined; }
  if (r.stage === "closed") { o.closed = true; }
  if (r.stage === "cancelled") { o.hold = "Cancelled"; o.cancelReason = r.cancel_reason ?? undefined; o.progress = 0; }
  else if (r.on_hold) o.hold = "On Hold";
  return o;
}

export const orderUid = (code: string) => ORDERS.find((o) => o.id === code)?.uid;
export const customerUid = (code: string) => CUSTOMERS.find((c) => c.id === code)?.uid;

// ───────── hydrate ─────────
async function hydrate() {
  const client = sb();
  const [custRows, ordRows, staffRows] = await Promise.all([
    q<Row[]>("Loading customers", client.rpc("list_customers") as never),
    q<Row[]>("Loading orders", client.from("orders").select("*, order_specs(album_size,pages)").order("created_at", { ascending: false }) as never),
    q<Row[]>("Loading staff", client.from("profiles").select("id,full_name") as never),
  ]);
  const customers = (custRows ?? []).map(customerFromRow);
  const staff = new Map((staffRows ?? []).map((p) => [p.id as string, String(p.full_name).split(" ")[0]!]));
  const cmap = new Map(customers.map((c) => [c.uid!, c]));
  const orders = (ordRows ?? []).map((r) => orderFromRow(r, cmap, staff));
  // derived customer stats
  for (const c of customers) {
    const mine = orders.filter((o) => o.customer === c.studio);
    c.activeOrders = mine.filter((o) => !["delivered"].includes(o.stage) && o.hold !== "Cancelled").length;
    c.lifetime = mine.reduce((a, o) => a + o.paid, 0);
    c.dues = mine.reduce((a, o) => a + Math.max(0, o.total - o.paid), 0);
    c.lastOrder = mine.map((o) => o.pendingAt).sort().at(-1) ?? c.since;
  }
  ORDERS.splice(0, ORDERS.length, ...orders);
  CUSTOMERS.splice(0, CUSTOMERS.length, ...customers);
  notify();
}
if (backendOn) registerHydrator("customers and orders", hydrate);

// ───────── writes ─────────
export interface NewCustomer { studio: string; contact?: string; mobile: string; whatsapp?: string; email?: string; address?: string; city?: string; state?: string; pin?: string; gstin?: string; segment?: Customer["type"]; notes?: string }
export async function dbCreateCustomer(c: NewCustomer): Promise<Customer | null> {
  const row = await q<Row>("Creating customer", sb().from("customers").insert({
    studio_name: c.studio, contact_person: c.contact || null, mobile: c.mobile, whatsapp: c.whatsapp || null, email: c.email || null, address: c.address || null,
    city: c.city || null, state: c.state || null, pin: c.pin || null, gstin: c.gstin ? c.gstin.toUpperCase() : null, segment: c.segment ? segmentToDb(c.segment) : "new", notes: c.notes || null, code: "pending",
  }).select().single() as never);
  if (!row) return null;
  const cust = customerFromRow(row); cust.status = "Active";
  CUSTOMERS.unshift(cust); notify(); return cust;
}
export async function dbUpdateCustomer(code: string, patch: Partial<NewCustomer> & { active?: boolean }) {
  const uid = customerUid(code); if (!uid) return;
  const row: Row = {};
  if (patch.studio !== undefined) row.studio_name = patch.studio; if (patch.contact !== undefined) row.contact_person = patch.contact || null;
  if (patch.mobile !== undefined) row.mobile = patch.mobile; if (patch.whatsapp !== undefined) row.whatsapp = patch.whatsapp || null; if (patch.email !== undefined) row.email = patch.email || null;
  if (patch.address !== undefined) row.address = patch.address || null; if (patch.city !== undefined) row.city = patch.city || null; if (patch.state !== undefined) row.state = patch.state || null;
  if (patch.pin !== undefined) row.pin = patch.pin || null; if (patch.gstin !== undefined) row.gstin = patch.gstin ? patch.gstin.toUpperCase() : null; if (patch.notes !== undefined) row.notes = patch.notes || null;
  if (patch.segment !== undefined) row.segment = segmentToDb(patch.segment); if (patch.active !== undefined) row.active = patch.active;
  const { error } = await sb().from("customers").update(row).eq("id", uid);
  if (error) reportDbError("Updating customer", error);
}

export interface NewOrder {
  customerUid: string; type: "design_printing" | "printing_only"; priority: Priority; eventName?: string; eventType?: string; bride?: string; groom?: string; eventDate?: string;
  orderDate: string; dueDate: string; total: number; instructions?: string;
  spec: { albumType: string; albumSize: string; orientation: string; pages: number; copies: number; paperType: string; paperGsm?: number; coverType: string; lamination?: string; binding: string; boxType?: string; finishes: string[]; namePrinting?: string };
}
export async function dbCreateOrder(n: NewOrder): Promise<Order | null> {
  const row = await q<Row>("Creating order", sb().from("orders").insert({
    customer_id: n.customerUid, type: n.type, priority: priorityToDb(n.priority), event_name: n.eventName || null, event_type: n.eventType || null, bride: n.bride || null, groom: n.groom || null,
    event_date: n.eventDate || null, order_date: n.orderDate, due_date: n.dueDate, total: n.total, special_instructions: n.instructions || null, code: "pending",
  }).select().single() as never);
  if (!row) return null;
  const s = n.spec;
  const sp = await q("Saving album specification", sb().from("order_specs").insert({
    order_id: row.id, album_type: s.albumType, album_size: s.albumSize, orientation: s.orientation.toLowerCase(), pages: s.pages, copies: s.copies, paper_type: s.paperType, paper_gsm: s.paperGsm ?? null,
    cover_type: s.coverType, lamination: s.lamination ?? null, binding: s.binding, box_required: !!s.boxType && s.boxType !== "None", box_type: s.boxType && s.boxType !== "None" ? s.boxType : null,
    uv_printing: s.finishes.includes("UV Printing"), foiling: s.finishes.includes("Foiling"), embossing: s.finishes.includes("Embossing"), name_printing: s.namePrinting || null,
  }) as never);
  if (sp === null && false) return null;
  const cust = new Map(CUSTOMERS.filter((c) => c.uid).map((c) => [c.uid!, c]));
  const { data: me } = await sb().auth.getUser();
  const order = orderFromRow({ ...row, order_specs: [{ album_size: s.albumSize, pages: s.pages }] }, cust, new Map(me.user ? [[me.user.id, "Me"]] : []));
  ORDERS.unshift(order); notify(); return order;
}
