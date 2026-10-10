import { ORDERS, type PayStatus } from "../data";
import { notify } from "../store";
import { discountLimit } from "../production";
import { PAYMENTS, INVOICES, type Payment, type Invoice, type Mode } from "../finance";
import { backendOn, sb, q, registerHydrator, reportDbError } from "./core";

// Payments, invoices (+lines) and credit notes. The database is the source of truth: receipt / invoice / credit-note numbers are
// assigned by triggers, order.paid / pay_status are recomputed by the payments trigger, and the discount-approval gate, refund cap and
// invoice immutability are enforced there too. RLS gives roles without money access empty result sets (handled below).
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const MODE_FROM: Record<string, Mode> = { upi: "UPI", cash: "Cash", bank_transfer: "Bank Transfer", cheque: "Cheque", card: "UPI", online: "UPI" };
const MODE_TO: Record<Mode, string> = { UPI: "upi", Cash: "cash", "Bank Transfer": "bank_transfer", Cheque: "cheque" };
const PAY: Record<string, PayStatus> = { unpaid: "Unpaid", partially_paid: "Partial", paid: "Paid", overpaid: "Paid", refunded: "Unpaid", credit: "Paid" };
const day = (s: string | null | undefined) => (s ?? "").slice(0, 10);

/** Friendly text for a PostgREST / trigger error (strips noise, keeps the database's own message). */
export const dbMsg = (e: unknown) => (typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));

export const orderUidOf = (code: string) => ORDERS.find((o) => o.id === code)?.uid;

async function hydrate() {
  const c = sb();
  const [pays, invs, profs] = await Promise.all([
    q<Row[]>("Loading payments", c.from("payments").select("*").order("created_at", { ascending: false }) as never),
    q<Row[]>("Loading invoices", c.from("invoices").select("*, invoice_lines(*)").order("created_at", { ascending: false }) as never),
    q<Row[]>("Loading staff", c.from("profiles").select("id,full_name,role") as never),
  ]);
  const staff = new Map((profs ?? []).map((p) => [p.id as string, p]));
  const codeOf = new Map(ORDERS.filter((o) => o.uid).map((o) => [o.uid!, o]));
  const invNo = new Map((invs ?? []).map((i) => [i.id as string, i.number as string]));
  const payments: Payment[] = (pays ?? []).map((r) => ({
    uid: r.id, id: r.id, orderId: codeOf.get(r.order_id)?.id ?? "", kind: r.kind, date: r.paid_on, mode: MODE_FROM[r.mode] ?? "UPI", ref: r.reference ?? "", amount: Number(r.amount),
    receipt: r.receipt_no, note: r.notes ?? undefined, by: String(staff.get(r.recorded_by)?.full_name ?? "—"), byRole: String(staff.get(r.recorded_by)?.role ?? ""), creditNote: r.credit_note_id ? invNo.get(r.credit_note_id) : undefined,
  })).filter((p) => p.orderId);
  const invoices: Invoice[] = (invs ?? []).map((r) => {
    const o = codeOf.get(r.order_id);
    const lines = ((r.invoice_lines ?? []) as Row[]).map((l) => ({ desc: l.description, qty: Number(l.qty), price: Number(l.rate) }));
    const disc = Number(r.discount_pct);
    return {
      uid: r.id, no: r.number, kind: r.kind, orderId: o?.id ?? "", customer: o?.customer ?? "", date: day(r.issue_date), due: day(r.due_date), lines, gstPct: Number(r.gst_rate), igst: !!r.igst, discountPct: disc,
      status: r.status === "draft" ? "Draft" : r.status === "overdue" ? "Overdue" : "Sent", approval: r.discount_approved_by ? "approved" : r.kind === "invoice" && disc > discountLimit() ? "pending" : "none",
      approvedBy: r.discount_approved_by ? String(staff.get(r.discount_approved_by)?.full_name ?? "Admin") : undefined, refNo: r.ref_invoice_id ? invNo.get(r.ref_invoice_id) : undefined,
      amount: r.kind === "credit_note" && r.amount != null ? Number(r.amount) : undefined, notes: r.notes ?? undefined, sentAt: r.sent_at ?? undefined,
    } satisfies Invoice;
  }).filter((i) => i.orderId);
  PAYMENTS.splice(0, PAYMENTS.length, ...payments);
  INVOICES.splice(0, INVOICES.length, ...invoices);
  notify();
}
if (backendOn) registerHydrator("payments and invoices", hydrate);

/** Re-read paid / pay_status for one order after the payments trigger recomputed them. */
export async function dbRefreshOrder(orderUid: string) {
  const r = await q<Row>("Refreshing order", sb().from("orders").select("paid,pay_status,total").eq("id", orderUid).single() as never);
  const o = ORDERS.find((x) => x.uid === orderUid);
  if (r && o) { o.paid = Number(r.paid); o.total = Number(r.total); o.pay = PAY[r.pay_status] ?? "Unpaid"; notify(); }
}

export interface DbPayment { uid: string; receipt: string }
export async function dbReceivePayment(orderUid: string, d: { amount: number; mode: Mode; ref: string; date: string; note?: string }): Promise<DbPayment | { error: string }> {
  const { data, error } = await sb().from("payments").insert({ receipt_no: "pending", order_id: orderUid, kind: "payment", amount: d.amount, mode: MODE_TO[d.mode], reference: d.ref.trim() || null, paid_on: d.date, notes: d.note?.trim() || null }).select("id,receipt_no").single();
  if (error || !data) return { error: dbMsg(error) };
  await dbRefreshOrder(orderUid);
  return { uid: data.id as string, receipt: data.receipt_no as string };
}
export async function dbRefund(orderUid: string, d: { amount: number; mode: Mode; reason: string; date: string }): Promise<{ paymentUid: string; receipt: string; creditNote: string; creditUid: string; refNo?: string } | { error: string }> {
  const { data, error } = await sb().rpc("issue_refund", { p_order: orderUid, p_amount: d.amount, p_mode: MODE_TO[d.mode], p_reason: d.reason, p_date: d.date });
  if (error || !data) return { error: dbMsg(error) };
  const r = data as Row;
  await dbRefreshOrder(orderUid);
  return { paymentUid: r.payment_id, receipt: r.receipt_no, creditNote: r.credit_note, creditUid: r.credit_note_id, refNo: INVOICES.find((i) => i.uid === r.ref_invoice_id)?.no };
}
export async function dbCreateInvoice(orderUid: string, d: { due: string; discPct: number; gstPct: number; igst: boolean; notes?: string; lines: { desc: string; qty: number; price: number }[] }): Promise<{ uid: string; no: string } | { error: string }> {
  const { data, error } = await sb().rpc("create_invoice", { p_order: orderUid, p_due: d.due, p_discount: d.discPct, p_gst: d.gstPct, p_igst: d.igst, p_notes: d.notes ?? "", p_lines: d.lines });
  if (error || !data) return { error: dbMsg(error) };
  return { uid: (data as Row).id, no: (data as Row).number };
}
export const dbSendInvoice = (uid: string) => sb().from("invoices").update({ status: "sent" }).eq("id", uid);
export const dbMarkOverdue = (uid: string) => sb().from("invoices").update({ status: "overdue" }).eq("id", uid);
export const dbApproveDiscount = (uid: string) => sb().rpc("approve_discount", { p_invoice: uid });
export { reportDbError };
