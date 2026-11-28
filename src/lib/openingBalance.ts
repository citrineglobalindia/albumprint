import { CUSTOMERS, type Customer } from "./data";
import { persistArray } from "./persist";
import { currentActor, logAudit } from "./audit";
import { notify } from "./store";
import { can, no, ok, denied, type Out } from "./production";
import type { RoleKey } from "./auth";
import { backendOn } from "./supabase";
import { TODAY_STR, PAYMENTS, type Mode } from "./finance";

// Old balance (opening balance): what a customer already owed before this system, kept in another platform until now.
// Accounts / admin enter it once on the customer; it counts in the customer's dues, the pending-payments list and
// WhatsApp reminders, and payments are received against it (with a receipt number) until it is cleared.
// Database: customers.opening_balance + opening_payments (supabase/migrations/0071). Demo: kept in this browser.

export interface OpeningPayment { uid?: string; customerId: string; amount: number; mode: Mode; ref: string; date: string; receipt: string; note?: string; by: string }
export const OPENING_PAYMENTS: OpeningPayment[] = persistArray<OpeningPayment>("opening_payments", []);

const roleOf = () => { const r = currentActor().role; return r === "system" ? null : (r as RoleKey); };
const r2 = (n: number) => Math.round(n * 100) / 100;
const inr = (n: number) => `₹${n.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

export const openingReceived = (c: Pick<Customer, "id">) => r2(OPENING_PAYMENTS.filter((p) => p.customerId === c.id).reduce((a, p) => a + p.amount, 0));
/** What is still due on the old balance. */
export const openingDue = (c: Pick<Customer, "id" | "openingBalance">) => Math.max(0, r2((c.openingBalance ?? 0) - openingReceived(c)));
export const openingPaymentsOf = (c: Pick<Customer, "id">) => OPENING_PAYMENTS.filter((p) => p.customerId === c.id).sort((a, b) => b.date.localeCompare(a.date) || b.receipt.localeCompare(a.receipt));
export const canSetOpening = () => can(roleOf(), "finance");
export const canReceiveOpening = () => can(roleOf(), "receive");

/** Set or correct a customer's old balance (accounts / admin). Never below what has already been received. */
export async function setOpeningBalance(c: Customer, amount: number, note: string): Promise<Out> {
  const role = roleOf();
  if (!can(role, "finance")) return denied(role, "finance");
  if (!Number.isFinite(amount) || amount < 0) return no("Enter an amount of zero or more");
  const got = openingReceived(c);
  if (amount < got) return no(`${inr(got)} has already been received against the old balance — the balance cannot be less than that`);
  const before = c.openingBalance ?? 0;
  if (backendOn) {
    if (!c.uid) return no("Customer not found");
    const { sb } = await import("./db/core");
    const { error } = await sb().rpc("set_opening_balance", { p_customer: c.uid, p_amount: amount, p_note: note.trim() || null, p_on: TODAY_STR });
    if (error) return no(error.message);
  }
  for (const x of CUSTOMERS.filter((k) => k.id === c.id)) { x.openingBalance = r2(amount) || undefined; x.openingNote = note.trim() || undefined; x.openingOn ??= TODAY_STR; }
  logAudit({ entity: "customer", entityId: c.id, action: "old_balance", detail: `Old balance set to ${inr(amount)}${note.trim() ? ` (${note.trim()})` : ""}`, from: inr(before), to: inr(amount) });
  notify();
  return ok(amount > 0 ? `Old balance of ${inr(amount)} saved for ${c.studio}` : `Old balance cleared for ${c.studio}`);
}

/** Receive money against the old balance. */
export async function receiveOpening(c: Customer, d: { amount: number; mode: Mode; ref: string; date: string; note?: string }): Promise<Out> {
  const role = roleOf();
  if (!can(role, "receive")) return denied(role, "receive");
  const due = openingDue(c);
  if (!(d.amount > 0) || !Number.isFinite(d.amount)) return no("Enter an amount greater than zero");
  if (d.amount > due) return no(`Amount is more than the old balance still due (${inr(due)})`);
  if (d.mode !== "Cash" && !d.ref.trim()) return no("A reference (UTR / cheque no.) is required for non-cash payments");
  const by = currentActor().name;
  let p: OpeningPayment;
  if (backendOn) {
    if (!c.uid) return no("Customer not found");
    const [{ sb }, { MODE_TO }] = await Promise.all([import("./db/core"), import("./db/finance")]);
    const { data, error } = await sb().from("opening_payments").insert({ receipt_no: "pending", customer_id: c.uid, amount: d.amount, mode: MODE_TO[d.mode], reference: d.ref.trim() || null, paid_on: d.date, notes: d.note?.trim() || null }).select("id, receipt_no").single();
    if (error || !data) return no(error?.message ?? "Could not save the payment");
    p = { uid: data.id as string, customerId: c.id, amount: d.amount, mode: d.mode, ref: d.ref.trim(), date: d.date, receipt: data.receipt_no as string, note: d.note?.trim() || undefined, by };
  } else {
    const year = TODAY_STR.slice(0, 4);
    const n = Math.max(0, ...[...PAYMENTS.map((x) => x.receipt), ...OPENING_PAYMENTS.map((x) => x.receipt)].map((r) => Number(/(\d+)$/.exec(r)?.[1] ?? 0))) + 1;
    p = { customerId: c.id, amount: d.amount, mode: d.mode, ref: d.ref.trim(), date: d.date, receipt: `RCP-${year}-${String(n).padStart(4, "0")}`, note: d.note?.trim() || undefined, by };
  }
  OPENING_PAYMENTS.unshift(p);
  logAudit({ entity: "payment", entityId: c.id, action: "receive_old_balance", detail: `${inr(d.amount)} via ${d.mode} against the old balance · ${p.receipt}` });
  notify();
  const left = openingDue(c);
  return ok(`Received ${inr(d.amount)} against the old balance — receipt ${p.receipt}${left > 0 ? ` · ${inr(left)} still due` : " · old balance cleared"}`);
}

/** Database: the payments received against old balances (registered in db/index.ts; runs after customers are loaded). */
export async function hydrateOpening() {
  const [{ sb, q, sharedStaff }, { MODE_FROM }] = await Promise.all([import("./db/core"), import("./db/finance")]);
  const [rows, staff] = await Promise.all([
    q<Record<string, never>[]>("Loading old-balance payments", sb().from("opening_payments").select("*").order("paid_on", { ascending: false }) as never),
    sharedStaff(),
  ]);
  const code = new Map(CUSTOMERS.filter((c) => c.uid).map((c) => [c.uid!, c.id]));
  const names = new Map((staff ?? []).map((s) => [s.id as string, String(s.full_name ?? "—")]));
  const list: OpeningPayment[] = (rows ?? []).map((r: Record<string, unknown>) => ({
    uid: String(r.id), customerId: code.get(String(r.customer_id)) ?? "", amount: Number(r.amount), mode: MODE_FROM[String(r.mode)] ?? "UPI", ref: String(r.reference ?? ""),
    date: String(r.paid_on), receipt: String(r.receipt_no), note: (r.notes as string | null) ?? undefined, by: names.get(String(r.recorded_by)) ?? "—",
  })).filter((p) => p.customerId);
  OPENING_PAYMENTS.splice(0, OPENING_PAYMENTS.length, ...list);
  notify();
}
