import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, ChevronRight, MessageCircle } from "lucide-react";
import { Panel, Pill, Avatar, cx } from "./ui";
import { ExportBtn } from "./listKit";
import { downloadCsv } from "../lib/csv";
import { useStore } from "../lib/store";
import { inr, fmtDate } from "../lib/format";
import type { Order } from "../lib/data";
import { balanceOf, duesByCustomer, lastReminder, loadSentReminders, remindBalance, remindOrder, waNumber, type CustomerDues } from "../lib/reminders";

const ago = (iso: string) => { const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000); return d <= 0 ? "today" : d === 1 ? "yesterday" : `${d} days ago`; };
const waBtn = "inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-40";

/** One-tap WhatsApp reminder for one order's pending payment (order page, lists). */
export function OrderReminderButton({ o, onDone }: { o: Order; onDone: (msg: string, ok: boolean) => void }) {
  useStore();
  if (balanceOf(o) <= 0) return null;
  return <button type="button" className={waBtn} data-testid="remind-order" onClick={() => { const e = remindOrder(o); onDone(e ?? `WhatsApp opened with a reminder for ${inr(balanceOf(o))}`, !e); }}><MessageCircle className="size-3.5" />Payment reminder</button>;
}
/** One-tap WhatsApp reminder for a customer's whole outstanding balance (customer panel). */
export function BalanceReminderButton({ d, onDone }: { d?: CustomerDues; onDone: (msg: string, ok: boolean) => void }) {
  useStore();
  if (!d || d.total <= 0) return null;
  const last = lastReminder(d.customer.id);
  return <span className="inline-flex flex-wrap items-center gap-2"><button type="button" className={waBtn} data-testid="remind-balance" onClick={() => { const e = remindBalance(d); onDone(e ?? `WhatsApp opened with the balance of ${inr(d.total)}`, !e); }}><MessageCircle className="size-3.5" />Remind balance {inr(d.total)}</button>{last && <span className="text-[11px] text-sub">last reminded {ago(last.at)}</span>}</span>;
}

/** Payments: everyone with money pending, the biggest overdue first, with WhatsApp reminders per customer and per order. */
export function PendingDuesPanel({ onDone }: { onDone: (msg: string, ok: boolean) => void }) {
  useStore();
  useEffect(() => { void loadSentReminders(); }, []);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [only, setOnly] = useState<"all" | "overdue">("all");
  const rows = duesByCustomer().filter((d) => only === "all" || d.overdue > 0);
  const total = rows.reduce((a, d) => a + d.total, 0), overdue = rows.reduce((a, d) => a + d.overdue, 0);
  return (
    <Panel className="mb-5" title={`Pending payments · ${rows.length} customer${rows.length === 1 ? "" : "s"}`} subtitle={`${inr(total)} outstanding · ${inr(overdue)} overdue — send a WhatsApp reminder in one tap`}
      action={<div className="flex flex-wrap items-center gap-2"><ExportBtn aria="Export pending payments" onClick={() => downloadCsv("pending-payments.csv", [["Customer", "Mobile", "Order", "Event", "Order total", "Paid", "Balance", "Due", "Overdue"], ...rows.flatMap((d) => d.dues.map((x) => [d.customer.studio, d.customer.mobile, x.order.id, x.order.event, x.order.total, x.order.paid, x.balance, x.order.due, x.overdue ? "yes" : ""]))])} /><div className="flex gap-1 rounded-lg border border-line p-0.5 text-xs font-bold">{(["all", "overdue"] as const).map((k) => <button key={k} type="button" onClick={() => setOnly(k)} className={cx("rounded-md px-3 py-1", only === k ? "bg-brand text-white" : "text-sub")}>{k === "all" ? "All dues" : "Overdue only"}</button>)}</div></div>}
      bodyClassName="p-0">
      <div data-testid="pending-dues" className="divide-y divide-line">
        {rows.map((d) => {
          const last = lastReminder(d.customer.id), isOpen = !!open[d.customer.id], noNum = waNumber(d.customer).length < 11;
          return (
            <div key={d.customer.id} data-testid={`due-${d.customer.id}`}>
              <div className="flex flex-wrap items-center gap-3 px-5 py-2.5">
                <button type="button" aria-label={isOpen ? "Hide orders" : "Show orders"} onClick={() => setOpen({ ...open, [d.customer.id]: !isOpen })} className="text-sub">{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button>
                <Avatar name={d.customer.studio} size={30} />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{d.customer.studio}</div><div className="text-xs text-sub">{d.customer.mobile || "no mobile"} · {d.dues.length} order{d.dues.length === 1 ? "" : "s"} · oldest due {fmtDate(d.oldestDue)}</div></div>
                <div className="text-right"><div className="text-sm font-extrabold">{inr(d.total)}</div>{d.overdue > 0 && <Pill tone="red">{inr(d.overdue)} overdue</Pill>}</div>
                <div className="w-36 text-right text-[11px] text-sub">{last ? `reminded ${ago(last.at)}` : "not reminded yet"}</div>
                <button type="button" disabled={noNum} title={noNum ? "No mobile / WhatsApp number" : undefined} className={waBtn} onClick={() => { const e = remindBalance(d); onDone(e ?? `WhatsApp opened for ${d.customer.studio}: ${inr(d.total)}`, !e); }}><MessageCircle className="size-3.5" />Remind {inr(d.total)}</button>
              </div>
              {isOpen && (
                <ul className="bg-slate-50/60 px-5 pb-2 pl-16">
                  {d.dues.map((x) => (
                    <li key={x.order.id} className="flex flex-wrap items-center gap-3 border-t border-line py-1.5 text-[13px]">
                      <Link to={`/orders/${x.order.id}`} className="w-24 font-bold text-brand hover:underline">{x.order.id}</Link>
                      <span className="min-w-0 flex-1 truncate text-sub">{x.order.event} · total {inr(x.order.total)} · paid {inr(x.order.paid)} · due {fmtDate(x.order.due)}</span>
                      <b className={x.overdue ? "text-rose-600" : ""}>{inr(x.balance)}</b>
                      <button type="button" disabled={noNum} className={waBtn} onClick={() => { const e = remindOrder(x.order); onDone(e ?? `WhatsApp opened for ${x.order.id}: ${inr(x.balance)}`, !e); }}><MessageCircle className="size-3.5" />Remind</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
        {rows.length === 0 && <p className="px-5 py-8 text-center text-sm text-sub">No pending payments{only === "overdue" ? " are overdue" : ""}. 🎉</p>}
      </div>
    </Panel>
  );
}
