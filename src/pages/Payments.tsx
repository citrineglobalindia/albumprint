import { useMemo, useRef, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, Download, FileText, Receipt, RefreshCw, Undo2, Wallet, Clock, MoreVertical } from "lucide-react";
import { Avatar, Field, FilterSelect, KpiRow, Panel, PageHeader, Pagination, PayPill, PrimaryButton, SearchInput, SlideOver, Td, Th, TodayChip, MoreButton, OutlineButton, inputCls, tableCls, trCls, LinkAction, cx } from "../components/ui";
import { useToast } from "../components/Toast";
import { downloadCsv } from "../lib/csv";
import { ORDERS, type PayStatus } from "../lib/data";
import { fmtDate, inr } from "../lib/format";

type Mode = "UPI" | "Cash" | "Bank Transfer" | "Online";
const MODES: Mode[] = ["UPI", "Cash", "Bank Transfer", "Online"];

interface Row { orderId: string; customer: string; event: string; workflow: string; size: string; total: number; paid: number; overdue: boolean; date: string | null; mode: Mode | null; receipt: string | null }
interface Recent { id: number; kind: "received" | "refunded"; amount: number; orderId: string; customer: string; mode: string }

const seedRows = (): Row[] =>
  ORDERS.slice(0, 40).map((o, i) => ({
    orderId: o.id, customer: o.customer, event: o.event, workflow: o.workflow, size: o.size, total: o.total, paid: o.paid,
    overdue: o.pay === "Overdue",
    date: o.paid > 0 ? `2026-10-${String(1 + (i % 3)).padStart(2, "0")}` : null,
    mode: o.paid > 0 ? MODES[i % 4]! : null,
    receipt: o.paid > 0 ? `RCP${2026305 - i}` : null,
  }));

const statusOf = (r: Row): PayStatus => (r.paid >= r.total ? "Paid" : r.paid > 0 ? "Partial" : r.overdue ? "Overdue" : "Unpaid");

const trend = Array.from({ length: 30 }, (_, i) => {
  const billed = 40000 + ((i * 7919) % 110000);
  return { day: `${i + 1} Oct`, billed, collected: Math.round(billed * (0.45 + ((i * 13) % 30) / 100)) };
});

const seedRecent: Recent[] = [
  { id: 1, kind: "received", amount: 25000, orderId: "IDP00072", customer: "Chidanan da", mode: "Online Transfer" },
  { id: 2, kind: "received", amount: 40000, orderId: "IDP00068", customer: "Photo Corner", mode: "UPI" },
  { id: 3, kind: "received", amount: 15000, orderId: "IDP00066", customer: "Chethu", mode: "Cash" },
  { id: 4, kind: "refunded", amount: 10000, orderId: "IDP00059", customer: "Ravi Studio", mode: "Bank Transfer" },
  { id: 5, kind: "received", amount: 30000, orderId: "IDP00070", customer: "Freezing Frames", mode: "UPI" },
];

const DONUT = [
  { name: "Paid", color: "#10b981" },
  { name: "Partially Paid", color: "#f59e0b" },
  { name: "Overdue", color: "#f43f5e" },
  { name: "Unpaid", color: "#8b8cf0" },
];

function SelectFull({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { v: string; l: string }[] }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
      {options.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
    </select>
  );
}

export default function Payments() {
  const [rows, setRows] = useState<Row[]>(seedRows);
  const [recent, setRecent] = useState<Recent[]>(seedRecent);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState("All Payment Status");
  const [fMode, setFMode] = useState("All Payment Modes");
  const [range, setRange] = useState("Last 30 Days");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<Row | null>(null);
  const [toast, show] = useToast();
  const [receiptSeq, setReceiptSeq] = useState(306);
  const [menu, setMenu] = useState<string | null>(null);
  const [lrange, setLrange] = useState("All Time");
  const ledgerRef = useRef<HTMLDivElement>(null);
  const [refundRow, setRefundRow] = useState<Row | null>(null);
  const [rAmt, setRAmt] = useState("");
  const [rReason, setRReason] = useState("");
  const [rErr, setRErr] = useState("");
  const [refunded, setRefunded] = useState(0);

  const [orderId, setOrderId] = useState("");
  const [amount, setAmount] = useState("");
  const [mode, setMode] = useState<Mode>("UPI");
  const [date, setDate] = useState("2026-10-03");
  const [ref, setRef] = useState("");
  const [notes, setNotes] = useState("");
  const [err, setErr] = useState("");

  const payable = rows.filter((r) => r.paid < r.total);
  const sel = rows.find((r) => r.orderId === orderId);

  const openForm = () => {
    const first = payable[0];
    setOrderId(first?.orderId ?? "");
    setAmount(first ? String(first.total - first.paid) : "");
    setMode("UPI"); setDate("2026-10-03"); setRef(""); setNotes(""); setErr("");
    setOpen(true);
  };
  const pickOrder = (id: string) => {
    setOrderId(id);
    const r = rows.find((x) => x.orderId === id);
    setAmount(r ? String(r.total - r.paid) : "");
    setErr("");
  };
  const receiptNo = `RCP2026${receiptSeq}`;

  const submit = () => {
    const amt = Number(amount);
    if (!sel) return setErr("Select an order");
    if (!amt || amt <= 0) return setErr("Enter a valid amount");
    if (amt > sel.total - sel.paid) return setErr(`Amount exceeds balance of ${inr(sel.total - sel.paid)}`);
    if (mode !== "Cash" && !ref.trim()) return setErr("Transaction / reference no. is required for non-cash payments");
    setRows((rs) => rs.map((r) => (r.orderId === sel.orderId ? { ...r, paid: r.paid + amt, overdue: false, date, mode, receipt: receiptNo } : r)));
    setRecent((rc) => [{ id: Date.now(), kind: "received" as const, amount: amt, orderId: sel.orderId, customer: sel.customer, mode }, ...rc].slice(0, 6));
    setReceiptSeq((n) => n + 1);
    setOpen(false);
    show(`Payment of ${inr(amt)} recorded - ${receiptNo}`);
  };

  const filtered = useMemo(() => rows.filter((r) => {
    const s = statusOf(r);
    if (fStatus !== "All Payment Status" && (fStatus === "Partially Paid" ? s !== "Partial" : s !== fStatus)) return false;
    if (fMode !== "All Payment Modes" && r.mode !== fMode) return false;
    if (lrange === "Today" && r.date !== "2026-10-03") return false;
    if (lrange === "Last 7 Days" && !r.date) return false;
    const t = q.trim().toLowerCase();
    return !t || r.orderId.toLowerCase().includes(t) || r.customer.toLowerCase().includes(t) || (r.receipt ?? "").toLowerCase().includes(t);
  }), [rows, q, fStatus, fMode, lrange]);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const counts = useMemo(() => {
    const c = { Paid: 0, Partial: 0, Overdue: 0, Unpaid: 0 };
    rows.forEach((r) => { c[statusOf(r)]++; });
    return c;
  }, [rows]);
  const donut = [counts.Paid, counts.Partial, counts.Overdue, counts.Unpaid].map((v, i) => ({ ...DONUT[i]!, value: v }));

  const totalBilled = rows.reduce((a, r) => a + r.total, 0);
  const collected = rows.reduce((a, r) => a + r.paid, 0);
  const overdueAmt = rows.filter((r) => statusOf(r) === "Overdue").reduce((a, r) => a + r.total - r.paid, 0);
  const pending = totalBilled - collected - overdueAmt;

  const downloadReceipt = (r: Row) => {
    if (!r.receipt) { show("No receipt yet - no payment recorded"); return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`PAYMENT RECEIPT ${r.receipt}\nOrder: ${r.orderId}\nCustomer: ${r.customer}\nAmount paid: ${inr(r.paid)}\nBalance: ${inr(r.total - r.paid)}\nMode: ${r.mode ?? "-"}\nDate: ${r.date ?? "-"}\n`], { type: "text/plain" }));
    a.download = `${r.receipt}.txt`; document.body.appendChild(a); a.click(); a.remove();
    show(`Receipt ${r.receipt} downloaded`);
  };
  const openRefund = (r: Row) => {
    if (r.paid <= 0) { show("Nothing to refund on this order"); return; }
    setRefundRow(r); setRAmt(String(r.paid)); setRReason(""); setRErr("");
  };
  const submitRefund = () => {
    const amt = Number(rAmt);
    if (!refundRow) return;
    if (!amt || amt <= 0) return setRErr("Enter a valid refund amount");
    if (amt > refundRow.paid) return setRErr(`Refund cannot exceed paid amount of ${inr(refundRow.paid)}`);
    if (!rReason.trim()) return setRErr("Reason is required");
    setRows((rs) => rs.map((r) => (r.orderId === refundRow.orderId ? { ...r, paid: r.paid - amt } : r)));
    setRecent((rc) => [{ id: Date.now(), kind: "refunded" as const, amount: amt, orderId: refundRow.orderId, customer: refundRow.customer, mode: refundRow.mode ?? "Bank Transfer" }, ...rc].slice(0, 6));
    setRefunded((n) => n + amt);
    setRefundRow(null); show(`Refund of ${inr(amt)} issued for ${refundRow.orderId}`);
  };
  const exportCsv = () => {
    downloadCsv("payment-ledger.csv", [["Order ID", "Customer", "Total", "Paid", "Balance", "Status", "Last Payment Date", "Mode", "Receipt No"],
      ...filtered.map((r) => [r.orderId, r.customer, r.total, r.paid, r.total - r.paid, statusOf(r), r.date ?? "", r.mode ?? "", r.receipt ?? ""])]);
    show("Ledger exported");
  };

  return (
    <div className="min-w-0">
      {toast}
      <PageHeader title="Payments" subtitle="Track collections, pending payments and manage customer payments.">
        <TodayChip />
        <PrimaryButton onClick={openForm}>Record Payment</PrimaryButton>
        <MoreButton />
      </PageHeader>

      <KpiRow items={[
        { label: "Total Billing", value: inr(totalBilled), delta: 18, icon: FileText, tone: "indigo" },
        { label: "Collected", value: inr(collected), delta: 22, icon: CheckCircle2, tone: "green" },
        { label: "Pending", value: inr(pending), delta: 12, icon: Clock, tone: "amber", invert: true },
        { label: "Overdue", value: inr(overdueAmt), delta: 28, icon: AlertTriangle, tone: "red", invert: true },
        { label: "Advance Received", value: inr(120000), delta: 35, icon: Wallet, tone: "violet" },
        { label: "Refunds", value: inr(12000 + refunded), delta: 5, icon: Undo2, tone: "pink", invert: true },
      ]} />

      <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,0.8fr)]">
        <Panel title="Collections Trend" subtitle={`${range}: collected ${inr((range === "Last 7 Days" ? trend.slice(-7) : range === "Last 14 Days" ? trend.slice(-14) : trend).reduce((a, d) => a + d.collected, 0))}`} action={<FilterSelect className="w-36" value={range} onChange={setRange} options={["Last 7 Days", "Last 14 Days", "Last 30 Days"]} />}>
          <div className="h-[260px]">
            <ResponsiveContainer>
              <BarChart data={range === "Last 7 Days" ? trend.slice(-7) : range === "Last 14 Days" ? trend.slice(-14) : trend} barGap={0}>
                <CartesianGrid vertical={false} stroke="#e6e9f5" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}K` : String(v))} />
                <Tooltip formatter={(v) => inr(Number(v))} />
                <Legend iconType="circle" verticalAlign="top" align="left" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="billed" name="Billed Amount" fill="#a5a8f5" radius={[3, 3, 0, 0]} />
                <Bar dataKey="collected" name="Collected Amount" fill="#10b981" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Payment Status Distribution">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative h-[200px] w-[200px] shrink-0">
              <ResponsiveContainer>
                <PieChart>
                  <Pie data={donut} dataKey="value" innerRadius={62} outerRadius={92} paddingAngle={2} stroke="none">
                    {donut.map((d) => <Cell key={d.name} fill={d.color} />)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                <div><div className="text-3xl font-extrabold">{rows.length}</div><div className="text-xs text-sub">Total Orders</div></div>
              </div>
            </div>
            <ul className="min-w-[150px] flex-1 space-y-3 text-[13px]">
              {donut.map((d) => (
                <li key={d.name} className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: d.color }} /><span><b className="font-semibold">{d.name}</b><span className="block text-xs text-sub">{d.value} orders</span></span></span>
                  <b>{Math.round((d.value / rows.length) * 100)}%</b>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel title="Recent Payments" action={<LinkAction onClick={() => { setQ(""); setFStatus("All Payment Status"); setFMode("All Payment Modes"); setLrange("All Time"); setPage(1); ledgerRef.current?.scrollIntoView({ behavior: "smooth" }); show("Showing full payment ledger"); }}>View All →</LinkAction>} bodyClassName="pt-3">
          <ul className="space-y-3">
            {recent.map((p) => (
              <li key={p.id} className="flex items-start gap-2.5">
                <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg", p.kind === "received" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>
                  {p.kind === "received" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}
                </span>
                <div className="min-w-0 text-xs">
                  <div className="text-[13px] font-bold">{inr(p.amount)} {p.kind}</div>
                  <div className="truncate text-sub">{p.orderId} - {p.customer}</div>
                  <div className="text-sub">{p.mode}</div>
                </div>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <div ref={ledgerRef} />
      <Panel
        title="Payment Ledger" subtitle="All payments received from customers"
        action={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <FilterSelect className="w-36" value={lrange} onChange={(v) => { setLrange(v); setPage(1); }} options={["All Time", "Today", "Last 7 Days"]} />
            <FilterSelect className="w-44" value={fStatus} onChange={(v) => { setFStatus(v); setPage(1); }} options={["All Payment Status", "Paid", "Partially Paid", "Unpaid", "Overdue"]} />
            <FilterSelect className="w-44" value={fMode} onChange={(v) => { setFMode(v); setPage(1); }} options={["All Payment Modes", ...MODES]} />
            <SearchInput className="w-64" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by order ID, customer, receipt..." />
            <OutlineButton icon={Download} onClick={exportCsv} className="h-10">Export</OutlineButton>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead>
              <tr><Th>Order ID</Th><Th>Customer</Th><Th>Total Amount</Th><Th>Paid Amount</Th><Th>Balance</Th><Th>Payment Status</Th><Th>Last Payment Date</Th><Th>Mode</Th><Th>Receipt No.</Th><Th>Actions</Th></tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const bal = r.total - r.paid;
                return (
                  <tr key={r.orderId} className={trCls}>
                    <Td><span className="flex items-center gap-2"><Avatar name={r.customer} size={26} /><b>{r.orderId}</b></span></Td>
                    <Td>{r.customer}</Td>
                    <Td>{inr(r.total)}</Td>
                    <Td>{inr(r.paid)}</Td>
                    <Td className={bal > 0 ? "font-semibold text-rose-600" : ""}>{inr(bal)}</Td>
                    <Td><PayPill s={statusOf(r)} /></Td>
                    <Td>{r.date ? fmtDate(r.date) : "-"}</Td>
                    <Td>{r.mode ?? "-"}</Td>
                    <Td>{r.receipt ?? "-"}</Td>
                    <Td><div className="flex items-center gap-2"><button onClick={() => setViewing(r)} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button>
                      <div className="relative"><button aria-label="Row actions" onClick={() => setMenu(menu === r.orderId ? null : r.orderId)} onBlur={() => setTimeout(() => setMenu(null), 150)}><MoreVertical className="size-4 text-sub" /></button>
                        {menu === r.orderId && (
                          <div className="absolute right-0 top-6 z-30 w-36 rounded-xl border border-line bg-white p-1 text-left shadow-xl">
                            {([["View receipt", () => setViewing(r)], ["Print receipt", () => downloadReceipt(r)], ["Refund", () => openRefund(r)]] as [string, () => void][]).map(([l, f]) => <button key={l} onMouseDown={() => { setMenu(null); f(); }} className="block w-full rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-brand-soft">{l}</button>)}
                          </div>
                        )}</div></div></Td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-sub">No payments match the filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="payments" />
      </Panel>

      <SlideOver open={open} onClose={() => setOpen(false)} title="Record Payment" footer={<>
        <button onClick={() => setOpen(false)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={Receipt} onClick={submit}>Record Payment</PrimaryButton>
      </>}>
        <h3 className="mb-3 text-[15px] font-extrabold">Order Details</h3>
        <Field label="Order" required>
          <SelectFull value={orderId} onChange={pickOrder} options={payable.map((r) => ({ v: r.orderId, l: `${r.orderId} - ${r.customer}` }))} />
        </Field>
        {sel && (
          <div className="mb-5 rounded-xl border border-line bg-slate-50/60 p-3">
            <div className="text-sm font-bold">{sel.customer}</div>
            <div className="text-xs text-sub">{sel.event} - {sel.size} - {sel.workflow}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-sub">
              <div>Total Amount<div className="text-sm font-bold text-ink">{inr(sel.total)}</div></div>
              <div>Paid Amount<div className="text-sm font-bold text-ink">{inr(sel.paid)}</div></div>
              <div>Balance Amount<div className="text-sm font-bold text-rose-600">{inr(sel.total - sel.paid)}</div></div>
            </div>
          </div>
        )}
        <h3 className="mb-3 text-[15px] font-extrabold">Payment Details</h3>
        <Field label="Payment Amount" required hint={sel ? `Max ${inr(sel.total - sel.paid)}. Part payments are recorded as advance / partial.` : undefined}>
          <input className={inputCls} type="number" min={1} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </Field>
        <Field label="Payment Mode" required>
          <SelectFull value={mode} onChange={(v) => setMode(v as Mode)} options={MODES.map((m) => ({ v: m, l: m }))} />
        </Field>
        <Field label="Transaction Date" required><input className={inputCls} type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Transaction ID / Reference No."><input className={inputCls} value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e.g. UTR7845213695" /></Field>
        <Field label="Receipt No." required hint="Auto-generated sequentially">
          <div className="flex gap-2">
            <input className={cx(inputCls, "bg-slate-50")} readOnly value={receiptNo} />
            <button type="button" onClick={() => setReceiptSeq((n) => n + 1)} className="grid size-10 shrink-0 place-items-center rounded-lg border border-line text-brand" aria-label="Regenerate"><RefreshCw className="size-4" /></button>
          </div>
        </Field>
        <Field label="Notes (Optional)">
          <textarea className="h-20 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" maxLength={200} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <span className="block text-right text-xs text-sub">{notes.length}/200</span>
        </Field>
        {err && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{err}</div>}
      </SlideOver>

      <SlideOver open={!!viewing} onClose={() => setViewing(null)} title={`Payment - ${viewing?.orderId ?? ""}`} width={400} footer={viewing && <><button onClick={() => downloadReceipt(viewing)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Download receipt</button><button onClick={() => { const v = viewing; setViewing(null); openRefund(v); }} className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white">Refund</button></>}>
        {viewing && (
          <dl className="space-y-3 text-sm">
            {[
              ["Customer", viewing.customer], ["Total", inr(viewing.total)], ["Paid", inr(viewing.paid)], ["Balance", inr(viewing.total - viewing.paid)],
              ["Last payment", viewing.date ? fmtDate(viewing.date) : "-"], ["Mode", viewing.mode ?? "-"], ["Receipt", viewing.receipt ?? "-"],
            ].map(([k, v]) => <div key={k} className="flex justify-between border-b border-line pb-2"><dt className="text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
            <div className="flex items-center gap-2 pt-2">Status <PayPill s={statusOf(viewing)} /></div>
            <p className="text-xs text-sub">Delivery is blocked until dues are cleared unless Admin overrides.</p>
          </dl>
        )}
      </SlideOver>
      <SlideOver open={!!refundRow} onClose={() => setRefundRow(null)} title={`Refund - ${refundRow?.orderId ?? ""}`} footer={<><button onClick={() => setRefundRow(null)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Cancel</button><button onClick={submitRefund} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Issue Refund</button></>}>
        {refundRow && <p className="mb-4 text-sm text-sub">{refundRow.customer} - paid {inr(refundRow.paid)}</p>}
        <Field label="Refund amount" required><input aria-label="Refund amount" type="number" className={inputCls} value={rAmt} onChange={(e) => setRAmt(e.target.value)} /></Field>
        <Field label="Reason" required><textarea aria-label="Refund reason" className="h-20 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={rReason} onChange={(e) => setRReason(e.target.value)} /></Field>
        {rErr && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{rErr}</div>}
      </SlideOver>
    </div>
  );
}
