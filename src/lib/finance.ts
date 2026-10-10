import { persistArray } from "./persist";
import { ORDERS, type Order } from "./data";
import { currentActor, logAudit } from "./audit";
import { notify } from "./store";
import { TODAY } from "./format";
import { GST_RATE } from "./pricing";
import { can, discountLimit, no, ok, denied, fmtDT, type Out } from "./production";
import type { RoleKey } from "./auth";

export { fmtDT };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const TODAY_STR = iso(TODAY);
const YEAR = TODAY.getFullYear();
const ord = (id: string) => ORDERS.find((o) => o.id === id);
const actor = () => currentActor();
const roleOf = () => { const r = actor().role; return r === "system" ? null : (r as RoleKey); };

/* ───────────── payments (§15) ───────────── */
export const MODES = ["UPI", "Cash", "Bank Transfer", "Cheque"] as const;
export type Mode = (typeof MODES)[number];
export interface Payment { id: string; orderId: string; kind: "payment" | "refund"; date: string; mode: Mode; ref: string; amount: number; receipt: string; note?: string; by: string; byRole: string; creditNote?: string }
export const PAYMENTS: Payment[] = persistArray<Payment>("payments", []);

/* ───────────── invoices ───────────── */
export interface Line { desc: string; qty: number; price: number }
export interface Invoice {
  no: string; kind: "invoice" | "credit_note"; orderId: string; customer: string; date: string; due: string; lines: Line[]; gstPct: number; igst: boolean; discountPct: number;
  status: "Draft" | "Sent" | "Overdue"; approval: "none" | "pending" | "approved"; approvedBy?: string; refNo?: string; amount?: number; notes?: string; sentAt?: string;
}
export const INVOICES: Invoice[] = persistArray<Invoice>("invoices", []);

export function calc(i: Pick<Invoice, "lines" | "gstPct" | "discountPct" | "igst">) {
  const sub = i.lines.reduce((a, l) => a + l.qty * l.price, 0);
  const discount = Math.round((sub * i.discountPct) / 100);
  const taxable = sub - discount;
  const gst = Math.round((taxable * i.gstPct) / 100);
  const half = Math.round(gst / 2);
  return { sub, discount, taxable, gst, cgst: i.igst ? 0 : half, sgst: i.igst ? 0 : gst - half, igst: i.igst ? gst : 0, total: taxable + gst };
}
export const invTotal = (i: Invoice) => (i.kind === "credit_note" && i.amount != null ? i.amount : calc(i).total);

const nextSeq = (prefix: string, existing: string[]) => {
  const re = new RegExp(`^${prefix}-${YEAR}-(\\d+)$`);
  return Math.max(0, ...existing.map((n) => Number(re.exec(n)?.[1] ?? 0))) + 1;
};
export const nextInvoiceNo = () => `INV-${YEAR}-${String(nextSeq("INV", INVOICES.filter((i) => i.kind === "invoice").map((i) => i.no))).padStart(4, "0")}`;
export const nextCreditNo = () => `CN-${YEAR}-${String(nextSeq("CN", INVOICES.filter((i) => i.kind === "credit_note").map((i) => i.no))).padStart(4, "0")}`;
export const nextReceipt = () => `RCP-${YEAR}-${String(Math.max(0, ...PAYMENTS.map((p) => Number(/(\d+)$/.exec(p.receipt)?.[1] ?? 0))) + 1).padStart(4, "0")}`;

/** Order-level money position. */
export function position(o: Order) {
  const invs = INVOICES.filter((i) => i.orderId === o.id && i.kind === "invoice");
  const discount = invs.reduce((a, i) => a + calc(i).discount, 0);
  const taxable = Math.round(o.total / (1 + GST_RATE));
  const pays = PAYMENTS.filter((p) => p.orderId === o.id && p.kind === "payment");
  const advance = pays.length ? [...pays].sort((a, b) => a.date.localeCompare(b.date))[0]!.amount : 0;
  const balance = o.total - o.paid;
  const overdue = balance > 0 && o.due < TODAY_STR;
  const state = balance < 0 ? "Overpaid (credit)" : balance === 0 ? "Paid" : overdue ? "Overdue" : o.paid > 0 ? "Partial" : "Unpaid";
  return { discount, taxable, tax: o.total - taxable, advance, balance, credit: Math.max(0, -balance), overdue, state };
}
export const syncPay = (o: Order) => { o.pay = o.paid >= o.total ? "Paid" : o.paid > 0 ? "Partial" : "Unpaid"; };

/** Derived invoice state: Paid / Partially Paid / Overdue come from the order's collections and the due date. */
export function invStatus(i: Invoice): "Draft" | "Sent" | "Paid" | "Partially Paid" | "Overdue" | "Credit note" {
  if (i.kind === "credit_note") return "Credit note";
  if (i.status === "Draft") return "Draft";
  const o = ord(i.orderId); const paid = Math.min(invTotal(i), o?.paid ?? 0);
  if (paid >= invTotal(i)) return "Paid";
  if (i.due < TODAY_STR || i.status === "Overdue") return "Overdue";
  return paid > 0 ? "Partially Paid" : "Sent";
}
export const invPaid = (i: Invoice) => (i.kind === "invoice" ? Math.min(invTotal(i), ord(i.orderId)?.paid ?? 0) : 0);

/** Automatic overdue marking (persisted + audited once per invoice). */
export function sweepOverdue() {
  let n = 0;
  INVOICES.forEach((i) => {
    if (i.kind === "invoice" && i.status === "Sent" && i.due < TODAY_STR && invPaid(i) < invTotal(i)) {
      i.status = "Overdue"; n++;
      logAudit({ entity: "invoice", entityId: i.no, action: "mark_overdue", detail: `due ${i.due}` });
    }
  });
  if (n) notify();
}

export function ensureFinance() {
  let changed = false;
  if (PAYMENTS.length === 0) {
    ORDERS.filter((o) => o.paid > 0).slice().reverse().forEach((o, k) => {
      PAYMENTS.unshift({ id: `P${o.id}`, orderId: o.id, kind: "payment", date: o.pendingAt, mode: MODES[k % 3]!, ref: `SEED-${k + 1}`, amount: o.paid, receipt: `RCP-${YEAR}-${String(k + 1).padStart(4, "0")}`, note: "Opening balance", by: "System", byRole: "system" });
    });
    changed = true;
  }
  if (INVOICES.length === 0) {
    const src = ORDERS.filter((o) => o.paid > 0 || o.stage === "delivered").slice(0, 16).reverse();
    src.forEach((o, k) => {
      const sub = Math.round(o.total / (1 + GST_RATE));
      INVOICES.unshift({ no: `INV-${YEAR}-${String(k + 1).padStart(4, "0")}`, kind: "invoice", orderId: o.id, customer: o.customer, date: o.pendingAt, due: iso(new Date(new Date(o.pendingAt).getTime() + [0, 7, 15, 3][k % 4]! * 864e5)), lines: [{ desc: `${o.event} album ${o.size} (${o.pages} pages)`, qty: 1, price: sub }], gstPct: 18, igst: false, discountPct: 0, status: "Sent", approval: "none", sentAt: o.pendingAt });
    });
    changed = true;
  }
  if (changed) notify();
  sweepOverdue();
}

/* ───────────── actions ───────────── */
export function recordPayment(orderId: string, d: { amount: number; mode: Mode; ref: string; date: string; note?: string }): Out {
  const role = roleOf();
  if (!can(role, "receive")) return denied(role, "receive");
  const o = ord(orderId); if (!o) return no("Order not found");
  if (o.closed) return no(`${o.id} is closed and read-only — reopen it first`);
  if (o.hold === "Cancelled") return no(`${o.id} is cancelled`);
  if (!(d.amount > 0) || !Number.isFinite(d.amount)) return no("Enter an amount greater than zero");
  if (!Number.isInteger(d.amount)) return no("Enter a whole-rupee amount");
  const bal = o.total - o.paid;
  if (d.amount > bal && !can(role, "finance")) return no(`Amount exceeds the balance of ₹${Math.max(0, bal).toLocaleString("en-IN")} — reception can only receive up to the balance`);
  if (d.mode !== "Cash" && !d.ref.trim()) return no("A reference (UTR / cheque no.) is required for non-cash payments");
  const before = o.pay;
  o.paid += d.amount; syncPay(o);
  const p: Payment = { id: `P${Date.now().toString(36)}`, orderId, kind: "payment", date: d.date, mode: d.mode, ref: d.ref.trim(), amount: d.amount, receipt: nextReceipt(), note: d.note, by: actor().name, byRole: String(actor().role) };
  PAYMENTS.unshift(p);
  logAudit({ entity: "payment", entityId: orderId, action: "receive", detail: `₹${d.amount} via ${d.mode} · ${p.receipt}`, from: before, to: o.pay }); notify();
  return ok(`Received ₹${d.amount.toLocaleString("en-IN")} — receipt ${p.receipt}${o.paid > o.total ? ` (₹${(o.paid - o.total).toLocaleString("en-IN")} held as credit)` : ""}`);
}
export function refundPayment(orderId: string, d: { amount: number; mode: Mode; reason: string; date: string }): Out {
  const role = roleOf();
  if (!can(role, "finance")) return no(`Your role (${role ?? "guest"}) cannot issue refunds — only Accounts and Admin can`);
  const o = ord(orderId); if (!o) return no("Order not found");
  if (o.closed) return no(`${o.id} is closed and read-only — reopen it first`);
  if (!(d.amount > 0) || !Number.isInteger(d.amount)) return no("Enter a whole-rupee refund amount");
  if (d.amount > o.paid) return no(`Refund cannot exceed the amount paid (₹${o.paid.toLocaleString("en-IN")})`);
  if (!d.reason.trim()) return no("A refund reason is required");
  const before = o.pay;
  o.paid -= d.amount; syncPay(o);
  const inv = INVOICES.filter((i) => i.orderId === orderId && i.kind === "invoice").sort((a, b) => b.date.localeCompare(a.date))[0];
  const cn: Invoice = { no: nextCreditNo(), kind: "credit_note", orderId, customer: o.customer, date: d.date, due: d.date, lines: [{ desc: `Refund: ${d.reason.trim()}`, qty: 1, price: Math.round(d.amount / (1 + GST_RATE)) }], gstPct: 18, igst: false, discountPct: 0, status: "Sent", approval: "none", refNo: inv?.no, amount: d.amount, notes: `Refund of ₹${d.amount}` };
  INVOICES.unshift(cn);
  const p: Payment = { id: `P${Date.now().toString(36)}`, orderId, kind: "refund", date: d.date, mode: d.mode, ref: "", amount: d.amount, receipt: nextReceipt(), note: d.reason.trim(), by: actor().name, byRole: String(actor().role), creditNote: cn.no };
  PAYMENTS.unshift(p);
  logAudit({ entity: "payment", entityId: orderId, action: "refund", detail: `₹${d.amount} · ${cn.no}`, reason: d.reason.trim(), from: before, to: o.pay });
  logAudit({ entity: "invoice", entityId: cn.no, action: "credit_note", detail: `for ${orderId} ₹${d.amount}` }); notify();
  return ok(`Refunded ₹${d.amount.toLocaleString("en-IN")} — credit note ${cn.no}`);
}

export interface Draft { orderId: string; terms: number; discPct: number; gstPct: number; igst: boolean; lines: Line[]; notes?: string }
export function draftFor(o: Order): Draft {
  return { orderId: o.id, terms: 15, discPct: 0, gstPct: 18, igst: false, lines: [{ desc: `${o.event} album ${o.size} (${o.pages} pages)`, qty: 1, price: Math.round(o.total / (1 + GST_RATE)) }] };
}
export function createInvoice(d: Draft): Out {
  const role = roleOf();
  if (!can(role, "finance")) return denied(role, "finance");
  const o = ord(d.orderId); if (!o) return no("Order not found");
  if (o.closed) return no(`${o.id} is closed and read-only`);
  if (!d.lines.length || d.lines.some((l) => !l.desc.trim() || !(l.qty > 0) || !(l.price >= 0))) return no("Every line needs a description, quantity and price");
  if (!(d.discPct >= 0 && d.discPct <= 100)) return no("Discount must be between 0 and 100%");
  const needs = d.discPct > discountLimit();
  const due = iso(new Date(TODAY.getTime() + d.terms * 864e5));
  const inv: Invoice = { no: nextInvoiceNo(), kind: "invoice", orderId: o.id, customer: o.customer, date: TODAY_STR, due, lines: d.lines, gstPct: d.gstPct, igst: d.igst, discountPct: d.discPct, status: "Draft", approval: needs ? "pending" : "none", notes: d.notes };
  INVOICES.unshift(inv);
  logAudit({ entity: "invoice", entityId: inv.no, action: "create", detail: `${o.id} ₹${invTotal(inv)}${needs ? ` · discount ${d.discPct}% needs admin approval` : ""}` }); notify();
  return ok(needs ? `${inv.no} created — discount ${d.discPct}% needs admin approval before sending` : `${inv.no} created as draft`);
}
export function approveDiscount(no_: string): Out {
  if (actor().role !== "admin") return no("Only an admin can approve a discount above the threshold");
  const i = INVOICES.find((x) => x.no === no_); if (!i) return no("Invoice not found");
  if (i.approval !== "pending") return no("No approval pending on this invoice");
  i.approval = "approved"; i.approvedBy = actor().name;
  logAudit({ entity: "invoice", entityId: i.no, action: "discount_approved", detail: `${i.discountPct}%`, override: true }); notify(); return ok(`Discount approved on ${i.no}`);
}
export function sendInvoice(no_: string): Out {
  const role = roleOf(); if (!can(role, "finance")) return denied(role, "finance");
  const i = INVOICES.find((x) => x.no === no_); if (!i) return no("Invoice not found");
  if (i.kind !== "invoice") return no("Credit notes are issued automatically");
  if (i.status !== "Draft") return no("Already sent");
  if (i.approval === "pending") return no(`Discount ${i.discountPct}% is above the ${discountLimit()}% limit — needs admin approval before sending`);
  i.status = "Sent"; i.sentAt = new Date().toISOString();
  logAudit({ entity: "invoice", entityId: i.no, action: "send", detail: `${i.customer} ₹${invTotal(i)}` }); notify(); sweepOverdue(); return ok(`${i.no} sent to ${i.customer}`);
}
