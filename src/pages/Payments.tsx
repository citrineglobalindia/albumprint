import { useMemo, useState } from "react";
import { IndianRupee, Wallet, AlertCircle, RotateCcw, Receipt, Lock, Download, Plus } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, SearchInput, CountTabs, TodayChip, MoreButton, PrimaryButton, SlideOver, Pagination, Td, tableCls, trCls, Field, inputCls, cx, type Kpi } from "../components/ui";
import { Combobox } from "../components/controls";
import { Banner, Err, orderOpt, TODAY_ISO } from "../components/pageKit";
import { useToast } from "../components/Toast";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { ORDERS } from "../lib/data";
import { fmtDate, inr } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { can, type Out } from "../lib/production";
import { PAYMENTS, MODES, ensureFinance, position, recordPayment, refundPayment, type Mode } from "../lib/finance";

type Tab = "all" | "Unpaid" | "Partial" | "Paid" | "Overdue";
const ordOf = (id: string) => ORDERS.find((o) => o.id === id)!;

export default function Payments() {
  const { role } = useAuth();
  const receive = can(role, "receive");
  const finance = can(role, "finance");
  ensureFinance();
  useStore();
  const [toast, show] = useToast();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [selId, setSelId] = useState<string | null>(null);
  const [mode, setMode] = useState<"pay" | "refund" | null>(null);
  const [f, setF] = useState({ orderId: "", amount: "", mode: "UPI" as Mode, ref: "", date: TODAY_ISO, note: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const run = (r: Out) => { show(r.msg); return r.ok; };

  const stateOf = (id: string) => position(ordOf(id)).state;
  const base = useMemo(() => ORDERS.filter((o) => { const t = q.trim().toLowerCase(); return !t || `${o.id} ${o.customer}`.toLowerCase().includes(t); }),
    [q, ORDERS.length, ORDERS.reduce((a, o) => a + o.paid, 0)]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = base.filter((o) => tab === "all" || stateOf(o.id).startsWith(tab) || (tab === "Paid" && stateOf(o.id).startsWith("Overpaid")));
  const rows = list.slice((page - 1) * 10, page * 10);
  const cur = ORDERS.find((o) => o.id === selId) ?? null;
  const pos = cur ? position(cur) : null;
  const closed = !!cur?.closed;
  const hist = cur ? PAYMENTS.filter((p) => p.orderId === cur.id) : [];

  const collected = PAYMENTS.filter((p) => p.kind === "payment").reduce((a, p) => a + p.amount, 0);
  const refunded = PAYMENTS.filter((p) => p.kind === "refund").reduce((a, p) => a + p.amount, 0);
  const outstanding = ORDERS.reduce((a, o) => a + Math.max(0, o.total - o.paid), 0);
  const overdueAmt = ORDERS.filter((o) => position(o).overdue).reduce((a, o) => a + (o.total - o.paid), 0);
  const kpis: Kpi[] = [
    { label: "Collected", value: inr(collected - refunded), icon: IndianRupee, tone: "green" },
    { label: "Outstanding", value: inr(outstanding), icon: Wallet, tone: "orange", invert: true },
    { label: "Overdue", value: inr(overdueAmt), icon: AlertCircle, tone: "red", invert: true },
    { label: "Refunded", value: inr(refunded), icon: RotateCcw, tone: "pink", invert: true },
    { label: "Receipts issued", value: PAYMENTS.length, icon: Receipt, tone: "blue" },
  ];

  const open = (m: "pay" | "refund", orderId = cur?.id ?? "") => {
    if (m === "pay" && !receive) { show(`Your role (${role}) cannot record payments`); return; }
    if (m === "refund" && !finance) { show(`Your role (${role}) cannot issue refunds — only Accounts and Admin can`); return; }
    const o = orderId ? ordOf(orderId) : undefined;
    setF({ orderId, amount: m === "pay" && o ? String(Math.max(0, o.total - o.paid)) : "", mode: "UPI", ref: "", date: TODAY_ISO, note: "" }); setErrs({}); setMode(m);
  };
  const submit = () => {
    const e: Record<string, string> = {};
    if (!f.orderId) e.orderId = "Select an order";
    if (!(Number(f.amount) > 0)) e.amount = "Enter an amount greater than zero";
    if (mode === "refund" && !f.note.trim()) e.note = "Reason is required";
    if (mode === "pay" && f.mode !== "Cash" && !f.ref.trim()) e.ref = "Reference is required";
    setErrs(e);
    if (Object.keys(e).length) return;
    const amount = Number(f.amount);
    const r = mode === "pay" ? recordPayment(f.orderId, { amount, mode: f.mode, ref: f.ref, date: f.date, note: f.note }) : refundPayment(f.orderId, { amount, mode: f.mode, reason: f.note, date: f.date });
    if (run(r)) { setSelId(f.orderId); setMode(null); }
  };
  const tabs: { key: Tab; label: string }[] = [{ key: "all", label: "All" }, { key: "Unpaid", label: "Unpaid" }, { key: "Partial", label: "Partial" }, { key: "Overdue", label: "Overdue" }, { key: "Paid", label: "Paid" }];

  return (
    <div>
      <PageHeader title="Payments" subtitle="Track collections, pending payments and manage customer payments.">
        <TodayChip />
        {receive && <PrimaryButton icon={Plus} onClick={() => open("pay")}>Record Payment</PrimaryButton>}
        <MoreButton />
      </PageHeader>
      {!finance && <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-[13px] font-semibold text-amber-800"><Lock className="size-4" />{receive ? "Receive-only access — refunds and protected finance records are limited to Accounts and Admin." : "View only."}</div>}
      <KpiRow items={kpis} cols={5} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <Panel title="Payment Ledger" subtitle="Click an order to see its financial position" action={<button onClick={() => downloadCsv("payments.csv", [["Receipt", "Order", "Type", "Date", "Mode", "Ref", "Amount", "By"], ...PAYMENTS.map((p) => [p.receipt, p.orderId, p.kind, p.date, p.mode, p.ref, p.amount, p.by])])} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-brand-soft"><Download className="size-4 text-sub" />Export</button>}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <CountTabs<Tab> value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={tabs.map((t) => ({ ...t, count: base.filter((o) => t.key === "all" || stateOf(o.id).startsWith(t.key) || (t.key === "Paid" && stateOf(o.id).startsWith("Overpaid"))).length }))} />
            <SearchInput className="w-56" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search order or customer…" />
          </div>
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr>{["Order", "Customer", "Total", "Paid", "Balance", "Due", "Status"].map((h) => <th key={h} className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">{h}</th>)}</tr></thead>
              <tbody>
                {rows.map((o) => { const p = position(o); return (
                  <tr key={o.id} data-testid={`pay-${o.id}`} onClick={() => setSelId(o.id)} className={cx(trCls, "cursor-pointer", selId === o.id && "bg-brand-soft")}>
                    <Td className="font-bold">{o.id}</Td><Td>{o.customer}</Td><Td>{inr(o.total)}</Td><Td>{inr(o.paid)}</Td>
                    <Td className={p.balance > 0 ? "font-semibold text-rose-600" : ""}>{p.balance < 0 ? `+${inr(-p.balance)} credit` : inr(p.balance)}</Td>
                    <Td className={p.overdue ? "text-rose-600" : ""}>{fmtDate(o.due)}</Td>
                    <Td><Pill tone={p.state === "Paid" ? "green" : p.state === "Partial" ? "amber" : p.state === "Overdue" ? "red" : p.state.startsWith("Over") ? "violet" : "slate"}>{p.state === "Partial" ? "Partially Paid" : p.state}</Pill></Td>
                  </tr>); })}
                {rows.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-sub">No orders match.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={10} total={list.length} onPage={setPage} noun="orders" />
        </Panel>

        <div className="space-y-4 xl:sticky xl:top-4">
          {cur && pos ? (
            <Panel title={`${cur.id} · ${cur.customer}`} bodyClassName="!p-5">
              {closed && <div className="mb-3"><Banner tone="amber">Order is closed — payments are read-only.</Banner></div>}
              <dl data-testid="fin-panel" className="grid grid-cols-2 gap-3 text-[13px]">
                {([["Total", inr(cur.total)], ["Discount", pos.discount ? inr(pos.discount) : "—"], ["Taxable value", inr(pos.taxable)], ["Tax (GST 18%)", inr(pos.tax)], ["Advance", pos.advance ? inr(pos.advance) : "—"], ["Paid", inr(cur.paid)], ["Balance", inr(Math.max(0, pos.balance))], ["Due date", fmtDate(cur.due)]] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
              </dl>
              <div className="mt-3 flex items-center gap-2"><Pill tone={pos.state === "Paid" ? "green" : pos.state === "Overdue" ? "red" : pos.state.startsWith("Over") ? "violet" : "amber"}>{pos.state}</Pill>{pos.credit > 0 && <span className="text-xs font-semibold text-violet-700">{inr(pos.credit)} held as credit</span>}</div>
              <div className="mt-3 flex gap-2">
                {receive && !closed && <button onClick={() => open("pay", cur.id)} className="h-10 flex-1 rounded-lg bg-brand text-sm font-bold text-white hover:bg-brand-dark">Record payment</button>}
                {finance && !closed && <button onClick={() => open("refund", cur.id)} disabled={cur.paid <= 0} className="h-10 flex-1 rounded-lg border border-rose-300 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40">Refund</button>}
                {!finance && <button onClick={() => open("refund", cur.id)} className="h-10 flex-1 rounded-lg border border-line text-sm font-bold text-sub">Refund (Accounts only)</button>}
              </div>
              <h4 className="mb-1 mt-4 text-sm font-extrabold">Transactions</h4>
              <ul data-testid="pay-history" className="space-y-1.5 text-[12px]">
                {hist.map((p) => <li key={p.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5"><Pill tone={p.kind === "refund" ? "red" : "green"}>{p.kind === "refund" ? "Refund" : "Payment"}</Pill><span className="font-bold">{p.kind === "refund" ? "−" : ""}{inr(p.amount)}</span><span className="min-w-0 flex-1 truncate text-sub">{p.mode} · {p.receipt}{p.creditNote ? ` · ${p.creditNote}` : ""}</span><span className="text-sub">{fmtDate(p.date)}</span></li>)}
                {hist.length === 0 && <li className="text-sub">No transactions yet.</li>}
              </ul>
            </Panel>
          ) : <Panel bodyClassName="!p-5"><p className="text-sm text-sub">Select an order to see its financial position.</p></Panel>}
        </div>
      </div>

      <Panel title="Recent Transactions" className="mt-4" bodyClassName="!p-4">
        <div className="overflow-x-auto"><table className={tableCls}>
          <thead><tr>{["Receipt", "Order", "Type", "Date", "Mode", "Amount", "Recorded by"].map((h) => <th key={h} className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">{h}</th>)}</tr></thead>
          <tbody>{PAYMENTS.slice(0, 8).map((p) => <tr key={p.id} className={trCls}><Td className="font-bold">{p.receipt}</Td><Td>{p.orderId}</Td><Td><Pill tone={p.kind === "refund" ? "red" : "green"}>{p.kind}</Pill></Td><Td>{fmtDate(p.date)}</Td><Td>{p.mode}</Td><Td>{p.kind === "refund" ? "−" : ""}{inr(p.amount)}</Td><Td>{p.by}</Td></tr>)}</tbody>
        </table></div>
      </Panel>

      <SlideOver open={mode !== null} onClose={() => setMode(null)} title={mode === "refund" ? "Issue Refund" : "Record Payment"} width={480}
        footer={<><button onClick={() => setMode(null)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Cancel</button><button onClick={submit} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">{mode === "refund" ? "Issue refund" : "Save payment"}</button></>}>
        <Field label="Order" required><Combobox error={!!errs.orderId} value={f.orderId} placeholder="Search order or customer…" onChange={(v) => { const o = ordOf(v); setF({ ...f, orderId: v, amount: mode === "pay" ? String(Math.max(0, o.total - o.paid)) : f.amount }); }} options={(mode === "refund" ? ORDERS.filter((o) => o.paid > 0) : ORDERS).map(orderOpt)} /><Err>{errs.orderId}</Err></Field>
        {f.orderId && <p className="mb-3 text-xs text-sub">Total {inr(ordOf(f.orderId).total)} · paid {inr(ordOf(f.orderId).paid)}{mode === "refund" ? ` · refundable up to ${inr(ordOf(f.orderId).paid)}` : ""}</p>}
        <Field label="Amount (₹)" required><input aria-label="Amount" type="number" min={1} className={cx(inputCls, errs.amount && "border-rose-400")} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><Err>{errs.amount}</Err></Field>
        <Field label="Mode"><div className="flex flex-wrap gap-1.5">{MODES.map((m) => <button key={m} type="button" aria-pressed={f.mode === m} onClick={() => setF({ ...f, mode: m })} className={cx("rounded-full border px-3 py-1 text-xs font-bold", f.mode === m ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{m}</button>)}</div></Field>
        {mode === "pay" && <Field label={f.mode === "Cash" ? "Reference (optional)" : f.mode === "Cheque" ? "Cheque no." : "UTR / reference"} required={f.mode !== "Cash"}><input aria-label="Reference" className={cx(inputCls, errs.ref && "border-rose-400")} value={f.ref} onChange={(e) => setF({ ...f, ref: e.target.value })} /><Err>{errs.ref}</Err></Field>}
        <Field label="Date"><input type="date" className={inputCls} value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
        <Field label={mode === "refund" ? "Reason" : "Notes"} required={mode === "refund"}><textarea aria-label={mode === "refund" ? "Refund reason" : "Notes"} rows={2} className={cx(inputCls, "h-auto py-2", errs.note && "border-rose-400")} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /><Err>{errs.note}</Err></Field>
        {mode === "refund" && <Banner tone="blue">A credit note is generated automatically and the order balance is restored.</Banner>}
      </SlideOver>
      {toast}
    </div>
  );
}
