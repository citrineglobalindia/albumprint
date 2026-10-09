import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AlertTriangle, ArrowDownLeft, ArrowUpRight, CheckCircle2, Download, FileText, Printer, Receipt, Undo2, Wallet, Clock } from "lucide-react";
import { Avatar, Field, FilterSelect, KpiRow, Panel, PageHeader, Pagination, PayPill, PrimaryButton, SearchInput, SlideOver, Td, TodayChip, MoreButton, OutlineButton, inputCls, tableCls, trCls, LinkAction, cx } from "../components/ui";
import { ColumnsMenu, Combobox, DateRangePicker, FilterChips, MultiSelect, SavedViews, SortTh, sortRows, type DateRange, type SortState } from "../components/controls";
import { Banner, DateField, FieldBox, Err, PrintStyle, Segmented, TODAY_ISO, ALL_TIME, desRange, inRangeOpt, orderOpt, rangeLabel, serRange, usePersisted, useSlashSearch, type SavedRange } from "../components/pageKit";
import { RowMenu } from "../components/RowMenu";
import { useToast } from "../components/Toast";
import { downloadCsv } from "../lib/csv";
import { ORDERS, type Order, type PayStatus } from "../lib/data";
import { fmtDate, inr } from "../lib/format";

const MODES = ["UPI", "Cash", "Bank Transfer", "Cheque"] as const;
type Mode = (typeof MODES)[number];
const STATUS_OPTS = ["Paid", "Partially Paid", "Unpaid", "Overdue"];

interface Txn { id: string; kind: "payment" | "refund"; date: string; mode: Mode; ref: string; amount: number; receipt: string; note?: string }
interface Row { orderId: string; history: Txn[] }
interface Recent { id: number; kind: "received" | "refunded"; amount: number; orderId: string; customer: string; mode: string }

let receiptSeq = 306; // module-level so it keeps incrementing across visits
const nextReceipt = () => `RCP2026${receiptSeq}`;

const ord = (id: string) => ORDERS.find((o) => o.id === id)!;
const paidOf = (r: Row) => ord(r.orderId).paid;
const balOf = (r: Row) => ord(r.orderId).total - ord(r.orderId).paid;
const statusOf = (r: Row): PayStatus => { const o = ord(r.orderId); return o.paid >= o.total ? "Paid" : o.paid > 0 ? "Partial" : o.pay === "Overdue" ? "Overdue" : "Unpaid"; };
const statusLabel = (s: PayStatus) => (s === "Partial" ? "Partially Paid" : s);
const lastPay = (r: Row) => [...r.history].reverse().find((t) => t.kind === "payment");
const syncPay = (o: Order) => { o.pay = o.paid >= o.total ? "Paid" : o.paid > 0 ? "Partial" : o.pay === "Overdue" ? "Overdue" : "Unpaid"; };

const seedRows = (): Row[] =>
  ORDERS.slice(0, 40).map((o, i) => ({
    orderId: o.id,
    history: o.paid > 0 ? [{ id: `T-${o.id}-0`, kind: "payment", date: `2026-10-${String(1 + (i % 3)).padStart(2, "0")}`, mode: MODES[i % 4]!, ref: i % 4 === 1 ? "" : `UTR${4521300000 + i * 7919}`, amount: o.paid, receipt: `RCP${2026305 - i}` }] : [],
  }));

const trend = Array.from({ length: 30 }, (_, i) => {
  const billed = 40000 + ((i * 7919) % 110000);
  return { day: `${i + 1} Oct`, billed, collected: Math.round(billed * (0.45 + ((i * 13) % 30) / 100)) };
});
const seedRecent: Recent[] = [
  { id: 1, kind: "received", amount: 25000, orderId: "IDP00072", customer: "Chidanan da", mode: "Bank Transfer" },
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

interface Form { orderId: string; amount: string; mode: Mode; date: string; utr: string; bank: string; chequeNo: string; chequeDate: string; receivedBy: string; notes: string }
const blankForm = (orderId = ""): Form => ({ orderId, amount: orderId ? String(ord(orderId).total - ord(orderId).paid) : "", mode: "UPI", date: TODAY_ISO, utr: "", bank: "", chequeNo: "", chequeDate: TODAY_ISO, receivedBy: "", notes: "" });

interface ViewState { status: string[]; mode: string[]; range: SavedRange; q: string; hidden: string[]; sort: SortState }
const COLS = [{ key: "order", label: "Order ID" }, { key: "customer", label: "Customer" }, { key: "total", label: "Total Amount" }, { key: "paid", label: "Paid Amount" }, { key: "balance", label: "Balance" }, { key: "status", label: "Payment Status" }, { key: "date", label: "Last Payment Date" }, { key: "mode", label: "Mode" }, { key: "receipt", label: "Receipt No." }];

export default function Payments() {
  const [rows, setRows] = usePersisted<Row[]>("payments.rows", seedRows);
  const [recent, setRecent] = usePersisted<Recent[]>("payments.recent", () => seedRecent);
  const [refunded, setRefunded] = usePersisted("payments.refunded", () => 0);
  const [advance, setAdvance] = usePersisted("payments.advance", () => 0);
  const [, setTick] = useState(0);
  const [q, setQ] = useState("");
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [fMode, setFMode] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>(ALL_TIME());
  const [sort, setSort] = useState<SortState>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [chartRange, setChartRange] = useState("Last 30 Days");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [open, setOpen] = useState(false);
  const [viewing, setViewing] = useState<{ orderId: string; txnId?: string } | null>(null);
  const [toast, show] = useToast();
  const ledgerRef = useRef<HTMLDivElement>(null);
  const [refundRow, setRefundRow] = useState<Row | null>(null);
  const [rAmt, setRAmt] = useState("");
  const [rReason, setRReason] = useState("");
  const [rErr, setRErr] = useState("");
  const [f, setF] = useState<Form>(blankForm());
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [sp, setSp] = useSearchParams();
  useSlashSearch();

  useEffect(() => { setPage(1); }, [q, fStatus, fMode, range]);

  const sel = f.orderId ? ord(f.orderId) : undefined;
  const selBal = sel ? sel.total - sel.paid : 0;
  const setField = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  const openForm = (orderId?: string) => {
    if (orderId) {
      const o = ORDERS.find((x) => x.id === orderId);
      if (!o) { show(`Order ${orderId} not found`); return; }
      if (o.paid >= o.total) { show(`${orderId} is already fully paid`); return; }
    }
    setF(blankForm(orderId)); setErrs({}); setOpen(true);
  };
  useEffect(() => {
    const id = sp.get("pay");
    if (id) { openForm(id); setSp({}, { replace: true }); }
    else if (sp.get("new")) { openForm(); setSp({}, { replace: true }); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pickOrder = (id: string) => { const o = ord(id); setF((x) => ({ ...x, orderId: id, amount: String(o.total - o.paid) })); setErrs({}); };

  const amt = Number(f.amount);
  const validate = () => {
    const e: Record<string, string> = {};
    if (!sel) e.order = "Select an order";
    if (!f.amount || !Number.isFinite(amt) || amt <= 0) e.amount = "Enter a valid amount greater than zero";
    else if (sel && amt > selBal) e.amount = `Over-payment: amount exceeds the balance of ${inr(selBal)}`;
    if (!f.date) e.date = "Transaction date is required"; else if (f.date > TODAY_ISO) e.date = "Date cannot be in the future";
    if (f.mode === "UPI" || f.mode === "Bank Transfer") {
      if (!/^[A-Za-z0-9]{8,22}$/.test(f.utr.trim())) e.utr = f.mode === "UPI" ? "Enter the UPI transaction ID / UTR (8-22 letters or digits)" : "Enter the bank UTR / reference (8-22 letters or digits)";
    }
    if (f.mode === "Cheque") {
      if (!/^\d{6}$/.test(f.chequeNo.trim())) e.chequeNo = "Cheque number must be 6 digits";
      if (f.bank.trim().length < 2) e.bank = "Drawee bank is required";
      if (!f.chequeDate) e.chequeDate = "Cheque date is required";
    }
    setErrs(e);
    return Object.keys(e).length === 0;
  };

  const submit = () => {
    if (!validate() || !sel) return;
    const receipt = nextReceipt();
    const txn: Txn = {
      id: `T-${Date.now()}`, kind: "payment", date: f.date, mode: f.mode, amount: amt, receipt, note: f.notes.trim() || undefined,
      ref: f.mode === "Cheque" ? `Cheque ${f.chequeNo.trim()} · ${f.bank.trim()}` : f.mode === "Cash" ? (f.receivedBy.trim() ? `Received by ${f.receivedBy.trim()}` : "") : f.utr.trim().toUpperCase(),
    };
    sel.paid += amt; syncPay(sel);
    setRows((rs) => (rs.some((r) => r.orderId === sel.id) ? rs.map((r) => (r.orderId === sel.id ? { ...r, history: [...r.history, txn] } : r)) : [{ orderId: sel.id, history: [txn] }, ...rs]));
    setRecent((rc) => [{ id: Date.now(), kind: "received" as const, amount: amt, orderId: sel.id, customer: sel.customer, mode: f.mode }, ...rc].slice(0, 6));
    if (sel.paid < sel.total) setAdvance((a) => a + amt);
    receiptSeq += 1; setTick((t) => t + 1);
    setOpen(false);
    setViewing({ orderId: sel.id, txnId: txn.id });
    show(`Payment of ${inr(amt)} recorded - ${receipt}`);
  };

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = rows.filter((r) => {
      const o = ord(r.orderId); const s = statusLabel(statusOf(r)); const lp = lastPay(r);
      if (fStatus.length && !fStatus.includes(s)) return false;
      if (fMode.length && !(lp && fMode.includes(lp.mode))) return false;
      if (!inRangeOpt(lp?.date, range)) return false;
      return !t || r.orderId.toLowerCase().includes(t) || o.customer.toLowerCase().includes(t) || (lp?.receipt ?? "").toLowerCase().includes(t);
    });
    return sortRows(list, sort, (r, k) => {
      const lp = lastPay(r);
      switch (k) { case "order": return r.orderId; case "customer": return ord(r.orderId).customer.toLowerCase(); case "total": return ord(r.orderId).total; case "paid": return paidOf(r); case "balance": return balOf(r); case "status": return statusOf(r); case "date": return lp?.date ?? ""; case "mode": return lp?.mode ?? ""; default: return lp?.receipt ?? ""; }
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, q, fStatus, fMode, range, sort]);
  const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const counts = { Paid: 0, Partial: 0, Overdue: 0, Unpaid: 0 };
  rows.forEach((r) => { counts[statusOf(r)]++; });
  const donut = [counts.Paid, counts.Partial, counts.Overdue, counts.Unpaid].map((v, i) => ({ ...DONUT[i]!, value: v }));
  const totalBilled = rows.reduce((a, r) => a + ord(r.orderId).total, 0);
  const collected = rows.reduce((a, r) => a + paidOf(r), 0);
  const overdueAmt = rows.filter((r) => statusOf(r) === "Overdue").reduce((a, r) => a + balOf(r), 0);
  const pending = totalBilled - collected - overdueAmt;

  const chartData = chartRange === "Last 7 Days" ? trend.slice(-7) : chartRange === "Last 14 Days" ? trend.slice(-14) : trend;

  const rowFor = (id: string) => rows.find((r) => r.orderId === id);
  const downloadReceipt = (r: Row, t?: Txn) => {
    const tx = t ?? lastPay(r);
    if (!tx) { show("No receipt yet - no payment recorded"); return; }
    const o = ord(r.orderId);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`PAYMENT RECEIPT ${tx.receipt}\nOrder: ${r.orderId}\nCustomer: ${o.customer}\nAmount: ${inr(tx.amount)}\nMode: ${tx.mode}\nReference: ${tx.ref || "-"}\nDate: ${tx.date}\nBalance: ${inr(o.total - o.paid)}\n`], { type: "text/plain" }));
    a.download = `${tx.receipt}.txt`; document.body.appendChild(a); a.click(); a.remove();
    show(`Receipt ${tx.receipt} downloaded`);
  };
  const printReceipt = (orderId: string, txnId?: string) => { setViewing({ orderId, txnId }); setTimeout(() => window.print(), 300); };
  const openRefund = (r: Row) => {
    if (paidOf(r) <= 0) { show("Nothing to refund on this order"); return; }
    setViewing(null); setRefundRow(r); setRAmt(String(paidOf(r))); setRReason(""); setRErr("");
  };
  const submitRefund = () => {
    const a = Number(rAmt);
    if (!refundRow) return;
    if (!a || a <= 0) return setRErr("Enter a valid refund amount");
    if (a > paidOf(refundRow)) return setRErr(`Refund cannot exceed paid amount of ${inr(paidOf(refundRow))}`);
    if (!rReason.trim()) return setRErr("Reason is required");
    const o = ord(refundRow.orderId);
    o.paid -= a; syncPay(o);
    const lp = lastPay(refundRow);
    setRows((rs) => rs.map((r) => (r.orderId === o.id ? { ...r, history: [...r.history, { id: `T-${Date.now()}`, kind: "refund" as const, date: TODAY_ISO, mode: lp?.mode ?? "Bank Transfer", ref: "", amount: a, receipt: `REF-${o.id.slice(-5)}`, note: rReason.trim() }] } : r)));
    setRecent((rc) => [{ id: Date.now(), kind: "refunded" as const, amount: a, orderId: o.id, customer: o.customer, mode: lp?.mode ?? "Bank Transfer" }, ...rc].slice(0, 6));
    setRefunded((n) => n + a);
    setRefundRow(null); show(`Refund of ${inr(a)} issued for ${o.id}`);
  };
  const exportCsv = () => {
    downloadCsv("payment-ledger.csv", [["Order ID", "Customer", "Total", "Paid", "Balance", "Status", "Last Payment Date", "Mode", "Receipt No"],
      ...filtered.map((r) => { const lp = lastPay(r); const o = ord(r.orderId); return [r.orderId, o.customer, o.total, o.paid, o.total - o.paid, statusLabel(statusOf(r)), lp?.date ?? "", lp?.mode ?? "", lp?.receipt ?? ""]; })]);
    show(`Exported ${filtered.length} ledger rows`);
  };

  const chips = [
    ...fStatus.map((s) => ({ label: `Status: ${s}`, onRemove: () => setFStatus(fStatus.filter((x) => x !== s)) })),
    ...fMode.map((s) => ({ label: `Mode: ${s}`, onRemove: () => setFMode(fMode.filter((x) => x !== s)) })),
    ...(range.preset !== "All Time" ? [{ label: `Paid: ${range.preset === "Custom" ? rangeLabel(range) : range.preset}`, onRemove: () => setRange(ALL_TIME()) }] : []),
    ...(q ? [{ label: `Search: ${q}`, onRemove: () => setQ("") }] : []),
  ];
  const clearAll = () => { setFStatus([]); setFMode([]); setRange(ALL_TIME()); setQ(""); };
  const view: ViewState = { status: fStatus, mode: fMode, range: serRange(range), q, hidden, sort };
  const applyView = (v: ViewState) => { setFStatus(v.status); setFMode(v.mode); setRange(desRange(v.range)); setQ(v.q); setHidden(v.hidden); setSort(v.sort); };
  const vis = (k: string) => !hidden.includes(k);

  const vRow = viewing ? rowFor(viewing.orderId) : undefined;
  const vTxn = vRow ? (vRow.history.find((t) => t.id === viewing?.txnId) ?? lastPay(vRow)) : undefined;

  return (
    <div className="min-w-0">
      {toast}
      <PageHeader title="Payments" subtitle="Track collections, pending payments and manage customer payments.">
        <TodayChip />
        <PrimaryButton onClick={() => openForm()}>Record Payment</PrimaryButton>
        <MoreButton />
      </PageHeader>

      <KpiRow items={[
        { label: "Total Billing", value: inr(totalBilled), delta: 18, icon: FileText, tone: "indigo" },
        { label: "Collected", value: inr(collected), delta: 22, icon: CheckCircle2, tone: "green" },
        { label: "Pending", value: inr(pending), delta: 12, icon: Clock, tone: "amber", invert: true },
        { label: "Overdue", value: inr(overdueAmt), delta: 28, icon: AlertTriangle, tone: "red", invert: true },
        { label: "Advance Received", value: inr(120000 + advance), delta: 35, icon: Wallet, tone: "violet" },
        { label: "Refunds", value: inr(12000 + refunded), delta: 5, icon: Undo2, tone: "pink", invert: true },
      ]} />

      <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,0.8fr)]">
        <Panel title="Collections Trend" subtitle={`${chartRange}: collected ${inr(chartData.reduce((a, d) => a + d.collected, 0))}`} action={<FilterSelect className="w-36" value={chartRange} onChange={setChartRange} options={["Last 7 Days", "Last 14 Days", "Last 30 Days"]} />}>
          <div className="h-[260px]">
            <ResponsiveContainer>
              <BarChart data={chartData} barGap={0}>
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
                  <button onClick={() => { setFStatus([d.name]); ledgerRef.current?.scrollIntoView({ behavior: "smooth" }); }} className="flex items-center gap-2 text-left"><span className="size-2.5 rounded-full" style={{ background: d.color }} /><span><b className="font-semibold">{d.name}</b><span className="block text-xs text-sub">{d.value} orders</span></span></button>
                  <b>{rows.length ? Math.round((d.value / rows.length) * 100) : 0}%</b>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel title="Recent Payments" action={<LinkAction onClick={() => { clearAll(); setPage(1); ledgerRef.current?.scrollIntoView({ behavior: "smooth" }); show("Showing full payment ledger"); }}>View All →</LinkAction>} bodyClassName="pt-3">
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
        action={<OutlineButton icon={Download} onClick={exportCsv} className="h-10">Export</OutlineButton>}
      >
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <DateRangePicker value={range} onChange={setRange} align="left" />
          <MultiSelect className="w-44" label="Payment status" options={STATUS_OPTS} value={fStatus} onChange={setFStatus} />
          <MultiSelect className="w-44" label="Payment mode" options={[...MODES]} value={fMode} onChange={setFMode} />
          <SearchInput className="w-64" value={q} onChange={setQ} placeholder="Search by order ID, customer, receipt... ( / )" />
          <div className="ml-auto flex gap-2">
            <SavedViews<ViewState> storageKey="payments" current={view} onApply={applyView} />
            <ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} />
          </div>
        </div>
        <FilterChips chips={chips} onClearAll={clearAll} />
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead>
              <tr>
                {vis("order") && <SortTh k="order" sort={sort} onSort={setSort}>Order ID</SortTh>}
                {vis("customer") && <SortTh k="customer" sort={sort} onSort={setSort}>Customer</SortTh>}
                {vis("total") && <SortTh k="total" sort={sort} onSort={setSort}>Total Amount</SortTh>}
                {vis("paid") && <SortTh k="paid" sort={sort} onSort={setSort}>Paid Amount</SortTh>}
                {vis("balance") && <SortTh k="balance" sort={sort} onSort={setSort}>Balance</SortTh>}
                {vis("status") && <SortTh k="status" sort={sort} onSort={setSort}>Payment Status</SortTh>}
                {vis("date") && <SortTh k="date" sort={sort} onSort={setSort}>Last Payment Date</SortTh>}
                {vis("mode") && <SortTh k="mode" sort={sort} onSort={setSort}>Mode</SortTh>}
                {vis("receipt") && <SortTh k="receipt" sort={sort} onSort={setSort}>Receipt No.</SortTh>}
                <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((r) => {
                const o = ord(r.orderId); const bal = o.total - o.paid; const lp = lastPay(r);
                return (
                  <tr key={r.orderId} onClick={() => setViewing({ orderId: r.orderId })} className={cx(trCls, "cursor-pointer")}>
                    {vis("order") && <Td><span className="flex items-center gap-2"><Avatar name={o.customer} size={26} /><b>{r.orderId}</b></span></Td>}
                    {vis("customer") && <Td>{o.customer}</Td>}
                    {vis("total") && <Td>{inr(o.total)}</Td>}
                    {vis("paid") && <Td>{inr(o.paid)}</Td>}
                    {vis("balance") && <Td className={bal > 0 ? "font-semibold text-rose-600" : ""}>{inr(bal)}</Td>}
                    {vis("status") && <Td><PayPill s={statusOf(r)} /></Td>}
                    {vis("date") && <Td>{lp ? fmtDate(lp.date) : "-"}</Td>}
                    {vis("mode") && <Td>{lp?.mode ?? "-"}</Td>}
                    {vis("receipt") && <Td>{lp?.receipt ?? "-"}</Td>}
                    <Td>
                      <div className="flex items-center gap-2">
                        <button onClick={(e) => { e.stopPropagation(); setViewing({ orderId: r.orderId }); }} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button>
                        <RowMenu items={[
                          { label: "View receipt", onClick: () => setViewing({ orderId: r.orderId }) },
                          ...(bal > 0 ? [{ label: "Record payment", onClick: () => openForm(r.orderId) }] : []),
                          { label: "Print receipt", onClick: () => (lp ? printReceipt(r.orderId) : show("No receipt yet - no payment recorded")) },
                          { label: "Download receipt", onClick: () => downloadReceipt(r) },
                          { label: "Refund", onClick: () => openRefund(r), danger: true },
                        ]} />
                      </div>
                    </Td>
                  </tr>
                );
              })}
              {pageRows.length === 0 && <tr><td colSpan={10} className="py-10 text-center text-sub">No payments match the filters.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="payments" />
      </Panel>

      {/* ───── Record payment ───── */}
      <SlideOver open={open} onClose={() => setOpen(false)} title="Record Payment" width={520} footer={<>
        <button onClick={() => setOpen(false)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={Receipt} onClick={submit}>Record Payment</PrimaryButton>
      </>}>
        <h3 className="mb-3 text-[15px] font-extrabold">Order Details</h3>
        <FieldBox label="Order" required>
          <Combobox error={!!errs.order} placeholder="Search order or customer…" value={f.orderId} onChange={pickOrder} options={ORDERS.filter((o) => o.total > o.paid).map(orderOpt)} />
          <Err>{errs.order}</Err>
        </FieldBox>
        {sel && (
          <div className="mb-5 rounded-xl border border-line bg-slate-50/60 p-3">
            <div className="text-sm font-bold">{sel.customer}</div>
            <div className="text-xs text-sub">{sel.event} - {sel.size} - {sel.workflow}</div>
            <div className="mt-3 grid grid-cols-3 gap-2 text-xs text-sub">
              <div>Total Amount<div className="text-sm font-bold text-ink">{inr(sel.total)}</div></div>
              <div>Paid Amount<div className="text-sm font-bold text-ink">{inr(sel.paid)}</div></div>
              <div>Balance Amount<div className="text-sm font-bold text-rose-600">{inr(selBal)}</div></div>
            </div>
          </div>
        )}
        <h3 className="mb-3 text-[15px] font-extrabold">Payment Details</h3>
        <FieldBox label="Payment Amount" required>
          <input aria-label="Payment amount" className={cx(inputCls, errs.amount && "border-rose-400")} type="number" min={1} value={f.amount} onChange={(e) => setField("amount", e.target.value)} />
          <div className="mt-2 flex flex-wrap gap-1.5">
            {sel && ([["Full balance", selBal], ["50%", Math.round(selBal * 0.5)], ["Advance 25%", Math.min(selBal, Math.round(sel.total * 0.25))]] as [string, number][]).map(([l, v]) => (
              <button key={l} type="button" onClick={() => setField("amount", String(v))} className={cx("rounded-full border px-3 py-1 text-xs font-bold", Number(f.amount) === v ? "border-brand bg-brand-soft text-brand" : "border-line text-sub hover:bg-slate-50")}>{l} · {inr(v)}</button>
            ))}
          </div>
          <Err>{errs.amount}</Err>
          {sel && !errs.amount && amt > 0 && amt < selBal && <div className="mt-2"><Banner tone="amber">Partial payment: {inr(selBal - amt)} will remain pending on {sel.id}.</Banner></div>}
          {sel && !errs.amount && amt > 0 && amt === selBal && <div className="mt-2"><Banner tone="green">This clears the balance - the order will be marked Paid.</Banner></div>}
        </FieldBox>
        <FieldBox label="Payment Mode" required>
          <Segmented value={f.mode} options={MODES} onChange={(m) => { setField("mode", m); setErrs({}); }} />
        </FieldBox>
        {(f.mode === "UPI" || f.mode === "Bank Transfer") && (
          <Field label={f.mode === "UPI" ? "UPI Transaction ID / UTR" : "Bank UTR / Reference No."} required>
            <input aria-label="UTR" className={cx(inputCls, errs.utr && "border-rose-400")} value={f.utr} onChange={(e) => setField("utr", e.target.value)} placeholder="e.g. UTR7845213695" />
            <Err>{errs.utr}</Err>
          </Field>
        )}
        {f.mode === "Bank Transfer" && <Field label="Bank (optional)"><input className={inputCls} value={f.bank} onChange={(e) => setField("bank", e.target.value)} placeholder="e.g. HDFC Bank" /></Field>}
        {f.mode === "Cheque" && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Cheque No." required><input aria-label="Cheque number" className={cx(inputCls, errs.chequeNo && "border-rose-400")} inputMode="numeric" maxLength={6} value={f.chequeNo} onChange={(e) => setField("chequeNo", e.target.value.replace(/\D/g, ""))} placeholder="6 digits" /><Err>{errs.chequeNo}</Err></Field>
              <FieldBox label="Cheque Date" required><DateField value={f.chequeDate} onChange={(v) => setField("chequeDate", v)} error={!!errs.chequeDate} label="Cheque date" /><Err>{errs.chequeDate}</Err></FieldBox>
            </div>
            <Field label="Drawee Bank" required><input aria-label="Drawee bank" className={cx(inputCls, errs.bank && "border-rose-400")} value={f.bank} onChange={(e) => setField("bank", e.target.value)} placeholder="e.g. ICICI Bank" /><Err>{errs.bank}</Err></Field>
          </>
        )}
        {f.mode === "Cash" && <Field label="Received by (optional)"><input className={inputCls} value={f.receivedBy} onChange={(e) => setField("receivedBy", e.target.value)} placeholder="Counter staff name" /></Field>}
        <FieldBox label="Transaction Date" required>
          <DateField value={f.date} onChange={(v) => setField("date", v)} error={!!errs.date} label="Transaction date" />
          <Err>{errs.date}</Err>
        </FieldBox>
        <Field label="Receipt No." hint="Auto-generated, increments after every payment">
          <input className={cx(inputCls, "bg-slate-50 font-semibold")} readOnly aria-label="Receipt number" value={nextReceipt()} />
        </Field>
        <Field label="Notes (Optional)">
          <textarea className="h-20 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" maxLength={200} value={f.notes} onChange={(e) => setField("notes", e.target.value)} />
          <span className="block text-right text-xs text-sub">{f.notes.length}/200</span>
        </Field>
      </SlideOver>

      {/* ───── Receipt / payment detail drawer ───── */}
      <SlideOver open={!!viewing && !!vRow} onClose={() => setViewing(null)} title={`Receipt - ${viewing?.orderId ?? ""}`} width={520} footer={vRow && <>
        <button onClick={() => downloadReceipt(vRow, vTxn)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Download</button>
        {balOf(vRow) > 0 && <button onClick={() => { setViewing(null); openForm(vRow.orderId); }} className="h-10 rounded-lg border border-brand px-4 text-sm font-bold text-brand">Record payment</button>}
        <button onClick={() => openRefund(vRow)} className="h-10 rounded-lg border border-rose-200 px-4 text-sm font-bold text-rose-600">Refund</button>
        <button onClick={() => window.print()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-bold text-white"><Printer className="size-4" />Print</button>
      </>}>
        {vRow && (() => {
          const o = ord(vRow.orderId);
          let running = 0;
          const afterBal: Record<string, number> = {};
          vRow.history.forEach((t) => { running += t.kind === "payment" ? t.amount : -t.amount; afterBal[t.id] = o.total - running; });
          return (
            <div className="space-y-5">
              <PrintStyle />
              <div id="print-area" className="rounded-xl border border-line p-5 text-[13px]">
                <div className="flex items-start justify-between">
                  <div><div className="text-lg font-extrabold text-brand">AlbumPro</div><div className="text-[11px] text-sub">AlbumPro Studio Pvt. Ltd. · Hyderabad</div></div>
                  <div className="text-right"><div className="text-[11px] font-bold uppercase text-sub">Payment Receipt</div><div className="text-base font-extrabold">{vTxn?.receipt ?? "No receipt"}</div></div>
                </div>
                {vTxn ? (
                  <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5">
                    <dt className="text-sub">Received from</dt><dd className="font-semibold">{o.customer}</dd>
                    <dt className="text-sub">Order</dt><dd className="font-semibold">{o.id} · {o.event} · {o.size}</dd>
                    <dt className="text-sub">Date</dt><dd>{fmtDate(vTxn.date)}</dd>
                    <dt className="text-sub">Mode</dt><dd>{vTxn.mode}</dd>
                    <dt className="text-sub">Reference</dt><dd>{vTxn.ref || "-"}</dd>
                    <dt className="text-sub">{vTxn.kind === "refund" ? "Amount refunded" : "Amount received"}</dt><dd className="text-lg font-extrabold">{inr(vTxn.amount)}</dd>
                    <dt className="text-sub">Order total</dt><dd>{inr(o.total)}</dd>
                    <dt className="text-sub">Balance after this</dt><dd className="font-bold text-rose-600">{inr(afterBal[vTxn.id] ?? o.total - o.paid)}</dd>
                  </dl>
                ) : <p className="mt-4 text-sub">No payment has been recorded for this order yet.</p>}
                <div className="mt-5 flex justify-between border-t border-line pt-3 text-[11px] text-sub"><span>Thank you for your business.</span><span>Authorised signatory</span></div>
              </div>
              <div>
                <div className="mb-2 flex items-center justify-between"><h3 className="text-sm font-extrabold">Payment history</h3><PayPill s={statusOf(vRow)} /></div>
                <div className="mb-3 grid grid-cols-3 gap-2 rounded-xl bg-slate-50 p-3 text-xs text-sub">
                  <div>Total<div className="text-sm font-bold text-ink">{inr(o.total)}</div></div>
                  <div>Paid<div className="text-sm font-bold text-ink">{inr(o.paid)}</div></div>
                  <div>Balance<div className="text-sm font-bold text-rose-600">{inr(o.total - o.paid)}</div></div>
                </div>
                <ol className="space-y-2">
                  {vRow.history.length === 0 && <li className="rounded-lg border border-dashed border-line p-3 text-center text-xs text-sub">No transactions yet.</li>}
                  {[...vRow.history].reverse().map((t) => (
                    <li key={t.id}>
                      <button onClick={() => setViewing({ orderId: vRow.orderId, txnId: t.id })} className={cx("flex w-full items-center gap-3 rounded-xl border p-3 text-left text-xs", t.id === vTxn?.id ? "border-brand bg-brand-soft/40" : "border-line hover:bg-slate-50")}>
                        <span className={cx("grid size-8 place-items-center rounded-lg", t.kind === "payment" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>{t.kind === "payment" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span>
                        <span className="min-w-0 flex-1"><b className="block text-[13px]">{t.kind === "payment" ? "+" : "-"}{inr(t.amount)} · {t.mode}</b><span className="block truncate text-sub">{fmtDate(t.date)} · {t.receipt}{t.ref ? ` · ${t.ref}` : ""}{t.note ? ` · ${t.note}` : ""}</span></span>
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
              <p className="text-xs text-sub">Delivery is blocked until dues are cleared unless Admin overrides.</p>
            </div>
          );
        })()}
      </SlideOver>

      <SlideOver open={!!refundRow} onClose={() => setRefundRow(null)} title={`Refund - ${refundRow?.orderId ?? ""}`} footer={<><button onClick={() => setRefundRow(null)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Cancel</button><button onClick={submitRefund} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Issue Refund</button></>}>
        {refundRow && <p className="mb-4 text-sm text-sub">{ord(refundRow.orderId).customer} - paid {inr(paidOf(refundRow))}</p>}
        <Field label="Refund amount" required><input aria-label="Refund amount" type="number" className={inputCls} value={rAmt} onChange={(e) => setRAmt(e.target.value)} /></Field>
        <Field label="Reason" required><textarea aria-label="Refund reason" className="h-20 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={rReason} onChange={(e) => setRReason(e.target.value)} /></Field>
        {rErr && <div className="rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{rErr}</div>}
      </SlideOver>
    </div>
  );
}
