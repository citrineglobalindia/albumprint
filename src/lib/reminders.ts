import { CUSTOMERS, ORDERS, type Customer, type Order } from "./data";
import { backendOn } from "./supabase";
import { currentActor, logAudit } from "./audit";
import { loadSettings } from "./localState";
import { persistArray } from "./persist";
import { notify } from "./store";

// Payment reminders on WhatsApp, one tap: opens a WhatsApp chat with the customer and a ready message (what is due, for which orders).
// Pending payment = the balance of one order; credit balance = everything a customer owes across their orders.
// Each send is recorded (database: comm_log; demo: this browser) so the team sees who was reminded and when.
export interface Due { order: Order; balance: number; overdue: boolean }
export interface CustomerDues { customer: Customer; dues: Due[]; total: number; overdue: number; oldestDue: string }

const today = () => new Date().toISOString().slice(0, 10);
const open = (o: Order) => o.hold !== "Cancelled" && !o.closed;
export const balanceOf = (o: Order) => Math.max(0, Math.round((o.total - o.paid) * 100) / 100);
const custOf = (o: Order) => CUSTOMERS.find((c) => c.studio === o.customer || c.name === o.customer);

export function duesByCustomer(): CustomerDues[] {
  const map = new Map<string, CustomerDues>();
  for (const o of ORDERS) {
    const b = balanceOf(o); if (!open(o) || b <= 0) continue;
    const c: Customer = custOf(o) ?? ({ id: `name:${o.customer}`, name: o.customer, studio: o.customer, mobile: o.mobile, email: "", city: "", state: "", type: "Regular", status: "Active", activeOrders: 0, lifetime: 0, lastOrder: "", since: "", dues: 0, tags: [] } as unknown as Customer);
    const row = map.get(c.id) ?? { customer: c, dues: [], total: 0, overdue: 0, oldestDue: o.due };
    const overdue = o.due < today();
    row.dues.push({ order: o, balance: b, overdue }); row.total += b; if (overdue) row.overdue += b; if (o.due < row.oldestDue) row.oldestDue = o.due;
    map.set(c.id, row);
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue || b.total - a.total);
}

const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const fmt = (iso: string) => new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
/** wa.me wants the number with the country code: a 10-digit Indian mobile gets 91 in front. */
export const waNumber = (c?: Pick<Customer, "mobile" | "whatsapp">) => { const d = (c?.whatsapp || c?.mobile || "").replace(/\D/g, ""); return d.length === 10 ? `91${d}` : d; };

export const DEFAULT_ORDER_TEMPLATE = "Hello {name}, this is a friendly reminder from {business}: {amount} is pending for order {order} ({event}){due}. Please pay at your earliest convenience. Thank you!";
export const DEFAULT_BALANCE_TEMPLATE = "Hello {name}, this is a reminder from {business}: your outstanding balance is {amount} across {count} order(s):\n{lines}\nPlease clear the balance at your earliest convenience. Thank you!";
const business = () => String(loadSettings().name || "AlbumPro");
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

export function orderReminderText(o: Order): string {
  const c = custOf(o);
  return fill(String(loadSettings().tpl_pay_reminder || DEFAULT_ORDER_TEMPLATE), {
    name: c?.name || o.customer, business: business(), amount: inr(balanceOf(o)), order: o.id, event: o.event,
    due: o.due ? `${o.due < today() ? ", which was due on" : ", due on"} ${fmt(o.due)}` : "",
  });
}
export function balanceReminderText(d: CustomerDues): string {
  return fill(String(loadSettings().tpl_balance_reminder || DEFAULT_BALANCE_TEMPLATE), {
    name: d.customer.name || d.customer.studio, business: business(), amount: inr(d.total), count: String(d.dues.length),
    lines: d.dues.map((x) => `• ${x.order.id} (${x.order.event}): ${inr(x.balance)}${x.overdue ? " — overdue" : ""}`).join("\n"),
  });
}

// ───────── the record of reminders sent ─────────
export interface SentReminder { id: string; customerId: string; orderId?: string; amount: number; at: string; by: string }
export const SENT: SentReminder[] = persistArray<SentReminder>("payment_reminders", [], { cap: 2000 });
export const lastReminder = (customerId: string, orderId?: string) => SENT.filter((s) => s.customerId === customerId && (!orderId || s.orderId === orderId || !s.orderId)).sort((a, b) => b.at.localeCompare(a.at))[0];

async function record(c: Customer, amount: number, text: string, order?: Order) {
  const rec: SentReminder = { id: `R${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, customerId: c.id, orderId: order?.id, amount, at: new Date().toISOString(), by: currentActor().name };
  SENT.unshift(rec); notify();
  logAudit({ entity: "customer", entityId: c.id, action: "payment_reminder", detail: `${order ? order.id : "balance"} · ${inr(amount)} · WhatsApp` });
  if (backendOn) {
    try {
      const { sb } = await import("./db/core");
      await sb().from("comm_log").insert({ order_id: order?.uid ?? null, customer_id: c.uid ?? null, channel: "whatsapp", direction: "outbound", template: order ? "payment_reminder" : "balance_reminder", recipient: waNumber(c), summary: text.slice(0, 500), status: "sent" });
    } catch { /* the reminder itself went out; the log is best effort */ }
  }
}

/** Open WhatsApp with the reminder for one order. Returns an error message, or null. */
export function remindOrder(o: Order): string | null {
  const c = custOf(o) ?? duesByCustomer().find((d) => d.dues.some((x) => x.order.id === o.id))?.customer; const num = waNumber(c ?? { mobile: o.mobile });
  if (!c || num.length < 11) return `${o.customer} has no mobile / WhatsApp number`;
  const b = balanceOf(o); if (b <= 0) return `${o.id} has nothing pending`;
  const text = orderReminderText(o);
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  void record(c, b, text, o); return null;
}
/** Open WhatsApp with the customer's whole outstanding balance. */
export function remindBalance(d: CustomerDues): string | null {
  const num = waNumber(d.customer); if (num.length < 11) return `${d.customer.studio} has no mobile / WhatsApp number`;
  const text = balanceReminderText(d);
  window.open(`https://wa.me/${num}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
  void record(d.customer, d.total, text); return null;
}

/** Database: the reminders already sent (from the communication log), so "last reminded" survives a reload and shows everyone's sends. */
export async function loadSentReminders(): Promise<void> {
  if (!backendOn) return;
  try {
    const { sb } = await import("./db/core");
    const { data } = await sb().from("comm_log").select("id, order_id, customer_id, summary, sent_at, created_by, template").in("template", ["payment_reminder", "balance_reminder"]).order("sent_at", { ascending: false }).limit(1000);
    const rows = (data ?? []) as { id: string; order_id: string | null; customer_id: string | null; sent_at: string; template: string }[];
    SENT.splice(0, SENT.length, ...rows.map((r) => {
      const o = ORDERS.find((x) => x.uid === r.order_id);
      return { id: r.id, customerId: CUSTOMERS.find((c) => c.uid === r.customer_id)?.id ?? (o ? custOf(o)?.id : undefined) ?? "", orderId: o?.id, amount: 0, at: r.sent_at, by: "" };
    }).filter((r) => r.customerId));
    notify();
  } catch { /* optional */ }
}
