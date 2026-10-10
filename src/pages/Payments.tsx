import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { IndianRupee, Wallet, AlertCircle, RotateCcw, Receipt, Lock, Plus, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, SearchInput, CountTabs, TodayChip, MoreButton, PrimaryButton, SlideOver, Pagination, Td, tableCls, trCls, Field, inputCls, FilterSelect, LinkAction, cx, type Kpi } from "../components/ui";
import { Combobox, ColumnsMenu, DateRangePicker, FilterChips, MultiSelect, SavedViews, SortTh, sortRows, type DateRange, type SortState } from "../components/controls";
import { ALL_TIME, Banner, Err, desRange, inRangeOpt, isoLocal, orderOpt, rangeLabel, serRange, TODAY_ISO, useSlashSearch, type SavedRange } from "../components/pageKit";
import { RowMenu } from "../components/RowMenu";
import { BulkBar, BulkBtn, ExportBtn, SelectTd, SelectTh, Toolbar, rangeChip, useSelection } from "../components/listKit";
import { useToast } from "../components/Toast";
import { useStore } from "../lib/store";
import { useAuth } from "../lib/auth";
import { ORDERS } from "../lib/data";
import { fmtDate, inr, inrShort, TODAY } from "../lib/format";
import { downloadCsv } from "../lib/csv";
import { can, type Out } from "../lib/production";
import { PAYMENTS, INVOICES, MODES, ensureFinance, position, invTotal, recordPayment, refundPayment, type Mode, type Payment } from "../lib/finance";

type Tab = "all" | "Unpaid" | "Partial" | "Paid" | "Overdue";
const ordOf = (id: string) => ORDERS.find((o) => o.id === id)!;
const lastPay = (id: string): Payment | undefined => PAYMENTS.filter((p) => p.orderId === id && p.kind === "payment").reduce<Payment | undefined>((a, p) => (!a || p.date > a.date ? p : a), undefined);
const COLS = [{ key: "order", label: "Order" }, { key: "customer", label: "Customer" }, { key: "total", label: "Total" }, { key: "paid", label: "Paid" }, { key: "balance", label: "Balance" }, { key: "due", label: "Due" }, { key: "last", label: "Last payment" }, { key: "mode", label: "Mode" }, { key: "receipt", label: "Receipt" }, { key: "status", label: "Status" }];
interface ViewState { tab: Tab; mode: string[]; by: string[]; range: SavedRange; q: string; hidden: string[]; sort: SortState }
const DONUT = [{ name: "Paid", color: "#10b981" }, { name: "Partially Paid", color: "#f59e0b" }, { name: "Overdue", color: "#f43f5e" }, { name: "Unpaid", color: "#8b8cf0" }];
const TAB_OF: Record<string, Tab> = { Paid: "Paid", "Partially Paid": "Partial", Overdue: "Overdue", Unpaid: "Unpaid" };
const TAB_LABEL: Record<Tab, string> = { all: "All", Unpaid: "Unpaid", Partial: "Partially Paid", Overdue: "Overdue", Paid: "Paid" };
const tabOfState = (state: string): Tab => (state.startsWith("Over") && state !== "Overdue" ? "Paid" : (state as Tab));

export default function Payments() {
  const { role } = useAuth();
  const receive = can(role, "receive");
  const finance = can(role, "finance");
  ensureFinance();
  useStore();
  const nav = useNavigate();
  const [toast, show] = useToast();
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [fMode, setFMode] = useState<string[]>([]);
  const [fBy, setFBy] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>(ALL_TIME());
  const [sort, setSort] = useState<SortState>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [chartDays, setChartDays] = useState("Last 30 Days");
  const [page, setPage] = useState(1);
  const [selId, setSelId] = useState<string | null>(null);
  const [mode, setMode] = useState<"pay" | "refund" | null>(null);
  const [f, setF] = useState({ orderId: "", amount: "", mode: "UPI" as Mode, ref: "", date: TODAY_ISO, note: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const sel = useSelection();
  const ledgerRef = useRef<HTMLDivElement>(null);
  useSlashSearch();
  const run = (r: Out) => { show(r.msg); return r.ok; };
  const vis = (k: string) => !hidden.includes(k);
  const reset = () => setPage(1);

  const stateOf = (id: string) => position(ordOf(id)).state;
  const inTab = (id: string, t: Tab) => t === "all" || tabOfState(stateOf(id)) === t;
  const byOpts = [...new Set(PAYMENTS.map((p) => p.by))].sort();
  const base = ORDERS.filter((o) => {
    const t = q.trim().toLowerCase(); const lp = lastPay(o.id);
    if (t && !`${o.id} ${o.customer} ${lp?.receipt ?? ""}`.toLowerCase().includes(t)) return false;
    if (fMode.length && !(lp && fMode.includes(lp.mode))) return false;
    if (fBy.length && !(lp && fBy.includes(lp.by))) return false;
    return inRangeOpt(lp?.date, range);
  });
  const filtered = sortRows(base.filter((o) => inTab(o.id, tab)), sort, (o, k) => {
    const lp = lastPay(o.id);
    switch (k) { case "order": return o.id; case "customer": return o.customer.toLowerCase(); case "total": return o.total; case "paid": return o.paid; case "balance": return o.total - o.paid; case "due": return o.due; case "last": return lp?.date ?? ""; case "mode": return lp?.mode ?? ""; case "receipt": return lp?.receipt ?? ""; default: return stateOf(o.id); }
  });
  const pageSize = 10;
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const selected = sel.within(filtered.map((o) => o.id));
  const cur = ORDERS.find((o) => o.id === selId) ?? null;
  const pos = cur ? position(cur) : null;
  const closed = !!cur?.closed;
  const hist = cur ? PAYMENTS.filter((p) => p.orderId === cur.id) : [];

  const collected = PAYMENTS.filter((p) => p.kind === "payment").reduce((a, p) => a + p.amount, 0);
  const refunded = PAYMENTS.filter((p) => p.kind === "refund").reduce((a, p) => a + p.amount, 0);
  const outstanding = ORDERS.reduce((a, o) => a + Math.max(0, o.total - o.paid), 0);
  const overdueAmt = ORDERS.filter((o) => position(o).overdue).reduce((a, o) => a + (o.total - o.paid), 0);
  const kpis: Kpi[] = [
    { label: "Collected", value: inrShort(collected - refunded), icon: IndianRupee, tone: "green" },
    { label: "Outstanding", value: inrShort(outstanding), icon: Wallet, tone: "orange", invert: true },
    { label: "Overdue", value: inrShort(overdueAmt), icon: AlertCircle, tone: "red", invert: true },
    { label: "Refunded", value: inrShort(refunded), icon: RotateCcw, tone: "pink", invert: true },
    { label: "Receipts issued", value: PAYMENTS.length, icon: Receipt, tone: "blue" },
  ];

  /* ───── charts (real finance store) ───── */
  const nDays = chartDays === "Last 7 Days" ? 7 : chartDays === "Last 14 Days" ? 14 : 30;
  const trend = Array.from({ length: nDays }, (_, i) => {
    const d = new Date(TODAY); d.setDate(d.getDate() - (nDays - 1 - i)); const key = isoLocal(d);
    return {
      day: d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }),
      billed: INVOICES.filter((x) => x.kind === "invoice" && x.date.slice(0, 10) === key).reduce((a, x) => a + invTotal(x), 0),
      collected: PAYMENTS.filter((p) => p.kind === "payment" && p.date.slice(0, 10) === key).reduce((a, p) => a + p.amount, 0),
      refunded: PAYMENTS.filter((p) => p.kind === "refund" && p.date.slice(0, 10) === key).reduce((a, p) => a + p.amount, 0),
    };
  });
  const counts: Record<string, number> = { Paid: 0, "Partially Paid": 0, Overdue: 0, Unpaid: 0 };
  ORDERS.forEach((o) => { const t = tabOfState(position(o).state); counts[t === "Partial" ? "Partially Paid" : t]!++; });
  const donut = DONUT.map((d) => ({ ...d, value: counts[d.name]! }));
  const recent = PAYMENTS.slice(0, 6);

  const open = (m: "pay" | "refund", orderId = cur?.id ?? "") => {
    if (m === "pay" && !receive) { show(`Your role (${role}) cannot record payments`); return; }
    if (m === "refund" && !finance) { show(`Your role (${role}) cannot issue refunds — only Accounts and Admin can`); return; }
    const o = orderId ? ordOf(orderId) : undefined;
    setF({ orderId, amount: m === "pay" && o ? String(Math.max(0, o.total - o.paid)) : "", mode: "UPI", ref: "", date: TODAY_ISO, note: "" }); setErrs({}); setSelId(null); setMode(m);
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
    const done = (x: Out) => { if (run(x)) { setSelId(f.orderId); setMode(null); } };
    if (r instanceof Promise) void r.then(done); else done(r);   // backend mode: wait for the server-assigned receipt number
  };
  const downloadReceipt = (id: string) => {
    const tx = lastPay(id); if (!tx) { show("No receipt yet — no payment recorded"); return; }
    const o = ordOf(id);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([`PAYMENT RECEIPT ${tx.receipt}\nOrder: ${id}\nCustomer: ${o.customer}\nAmount: ${inr(tx.amount)}\nMode: ${tx.mode}\nReference: ${tx.ref || "-"}\nDate: ${tx.date}\nBalance: ${inr(Math.max(0, o.total - o.paid))}\n`], { type: "text/plain" }));
    a.download = `${tx.receipt}.txt`; document.body.appendChild(a); a.click(); a.remove(); show(`Receipt ${tx.receipt} downloaded`);
  };
  const exportRows = (ids: string[] | null) => {
    const set = ids ? new Set(ids) : null;
    const txns = PAYMENTS.filter((p) => (set ? set.has(p.orderId) : true));
    downloadCsv("payments.csv", [["Receipt", "Order", "Type", "Date", "Mode", "Ref", "Amount", "By"], ...txns.map((p) => [p.receipt, p.orderId, p.kind, p.date, p.mode, p.ref, p.amount, p.by])]);
    show(`Exported ${txns.length} transactions${set ? ` for ${set.size} orders` : ""}`);
  };

  const tabs: Tab[] = ["all", "Unpaid", "Partial", "Overdue", "Paid"];
  const chips = [
    ...(tab !== "all" ? [{ label: `Status: ${TAB_LABEL[tab]}`, onRemove: () => setTab("all") }] : []),
    ...fMode.map((s) => ({ label: `Mode: ${s}`, onRemove: () => setFMode(fMode.filter((x) => x !== s)) })),
    ...fBy.map((s) => ({ label: `By: ${s}`, onRemove: () => setFBy(fBy.filter((x) => x !== s)) })),
    ...rangeChip("Last payment", range.preset, rangeLabel(range), () => setRange(ALL_TIME())),
    ...(q ? [{ label: `Search: ${q}`, onRemove: () => setQ("") }] : []),
  ];
  const clearAll = () => { setTab("all"); setFMode([]); setFBy([]); setRange(ALL_TIME()); setQ(""); reset(); };
  const view: ViewState = { tab, mode: fMode, by: fBy, range: serRange(range), q, hidden, sort };
  const applyView = (v: ViewState) => { setTab(v.tab); setFMode(v.mode); setFBy(v.by); setRange(desRange(v.range)); setQ(v.q); setHidden(v.hidden); setSort(v.sort); reset(); };

  return (
    <div className="min-w-0">
      <PageHeader title="Payments" subtitle="Track collections, pending payments and manage customer payments.">
        <TodayChip />
        {receive && <PrimaryButton icon={Plus} onClick={() => open("pay")}>Record Payment</PrimaryButton>}
        <MoreButton />
      </PageHeader>
      {!finance && <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-[13px] font-semibold text-amber-800"><Lock className="size-4" />{receive ? "Receive-only access — refunds and protected finance records are limited to Accounts and Admin." : "View only."}</div>}
      <KpiRow items={kpis} cols={5} />

      <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1.1fr)_minmax(0,0.8fr)]">
        <Panel title="Collections Trend" subtitle={`${chartDays}: collected ${inr(trend.reduce((a, d) => a + d.collected, 0))}`} action={<FilterSelect label="Trend range" className="w-36" value={chartDays} onChange={setChartDays} options={["Last 7 Days", "Last 14 Days", "Last 30 Days"]} />}>
          <div className="h-[260px]" data-testid="trend-chart">
            <ResponsiveContainer>
              <BarChart data={trend} barGap={0} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="#e6e9f5" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v: number) => (v >= 1000 ? `${v / 1000}K` : String(v))} />
                <Tooltip formatter={(v) => inr(Number(v))} />
                <Legend iconType="circle" verticalAlign="bottom" align="left" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="billed" name="Invoiced" fill="#a5a8f5" radius={[3, 3, 0, 0]} />
                <Bar dataKey="collected" name="Collected" fill="#10b981" radius={[3, 3, 0, 0]} />
                <Bar dataKey="refunded" name="Refunded" fill="#f43f5e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Payment Status Distribution">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative h-[200px] w-[200px] shrink-0">
              <PieChart width={200} height={200}>
                <Pie data={donut} dataKey="value" cx={100} cy={100} innerRadius={62} outerRadius={92} paddingAngle={2} stroke="none" isAnimationActive={false}>{donut.map((d) => <Cell key={d.name} fill={d.color} />)}</Pie>
              </PieChart>
              <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="text-3xl font-extrabold">{ORDERS.length}</div><div className="text-xs text-sub">Total Orders</div></div></div>
            </div>
            <ul data-testid="status-legend" className="min-w-[150px] flex-1 space-y-3 text-[13px]">
              {donut.map((d) => (
                <li key={d.name} className="flex items-center justify-between gap-2">
                  <button onClick={() => { setTab(TAB_OF[d.name]!); reset(); ledgerRef.current?.scrollIntoView({ behavior: "smooth" }); }} className="flex items-center gap-2 text-left"><span className="size-2.5 rounded-full" style={{ background: d.color }} /><span><b className="font-semibold">{d.name}</b><span className="block text-xs text-sub">{d.value} orders</span></span></button>
                  <b>{ORDERS.length ? Math.round((d.value / ORDERS.length) * 100) : 0}%</b>
                </li>
              ))}
            </ul>
          </div>
        </Panel>

        <Panel title="Recent Payments" action={<LinkAction onClick={() => { clearAll(); ledgerRef.current?.scrollIntoView({ behavior: "smooth" }); }}>View All →</LinkAction>} bodyClassName="pt-3">
          <ul data-testid="recent-payments" className="space-y-3">
            {recent.map((p) => (
              <li key={p.id} className="flex items-start gap-2.5">
                <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg", p.kind === "payment" ? "bg-emerald-50 text-emerald-600" : "bg-rose-50 text-rose-600")}>{p.kind === "payment" ? <ArrowDownLeft className="size-4" /> : <ArrowUpRight className="size-4" />}</span>
                <div className="min-w-0 text-xs">
                  <div className="text-[13px] font-bold">{inr(p.amount)} {p.kind === "payment" ? "received" : "refunded"}</div>
                  <div className="truncate text-sub">{p.orderId} - {ordOf(p.orderId)?.customer}</div>
                  <div className="text-sub">{p.mode} · {p.receipt}</div>
                </div>
              </li>
            ))}
            {recent.length === 0 && <li className="text-sm text-sub">No payments yet.</li>}
          </ul>
        </Panel>
      </div>

      <div ref={ledgerRef} />
      <Panel title="Payment Ledger" subtitle="Click an order to see its financial position" action={<ExportBtn onClick={() => exportRows(null)} />}>
        <div className="mb-3"><CountTabs<Tab> value={tab} onChange={(t) => { setTab(t); reset(); }} tabs={tabs.map((t) => ({ key: t, label: TAB_LABEL[t], count: base.filter((o) => inTab(o.id, t)).length }))} /></div>
        <Toolbar right={<><SavedViews<ViewState> storageKey="payments" current={view} onApply={applyView} /><ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} /></>}>
          <DateRangePicker value={range} onChange={(r) => { setRange(r); reset(); }} align="left" />
          <MultiSelect className="w-40" label="Payment mode" options={[...MODES]} value={fMode} onChange={(v) => { setFMode(v); reset(); }} />
          <MultiSelect className="w-40" label="Recorded by" options={byOpts} value={fBy} onChange={(v) => { setFBy(v); reset(); }} />
          <SearchInput className="w-60" value={q} onChange={(v) => { setQ(v); reset(); }} placeholder="Search order, customer, receipt… ( / )" />
        </Toolbar>
        <FilterChips chips={chips} onClearAll={clearAll} />
        <BulkBar count={selected.length} onClear={sel.clear}>
          <BulkBtn testid="bulk-export" onClick={() => exportRows(selected)}>Export selected</BulkBtn>
        </BulkBar>
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead><tr>
              <SelectTh rows={rows.map((o) => o.id)} sel={sel} />
              {vis("order") && <SortTh k="order" sort={sort} onSort={setSort}>Order</SortTh>}
              {vis("customer") && <SortTh k="customer" sort={sort} onSort={setSort}>Customer</SortTh>}
              {vis("total") && <SortTh k="total" sort={sort} onSort={setSort}>Total</SortTh>}
              {vis("paid") && <SortTh k="paid" sort={sort} onSort={setSort}>Paid</SortTh>}
              {vis("balance") && <SortTh k="balance" sort={sort} onSort={setSort}>Balance</SortTh>}
              {vis("due") && <SortTh k="due" sort={sort} onSort={setSort}>Due</SortTh>}
              {vis("last") && <SortTh k="last" sort={sort} onSort={setSort}>Last payment</SortTh>}
              {vis("mode") && <SortTh k="mode" sort={sort} onSort={setSort}>Mode</SortTh>}
              {vis("receipt") && <SortTh k="receipt" sort={sort} onSort={setSort}>Receipt</SortTh>}
              {vis("status") && <SortTh k="status" sort={sort} onSort={setSort}>Status</SortTh>}
              <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">Actions</th>
            </tr></thead>
            <tbody>
              {rows.map((o) => { const p = position(o); const lp = lastPay(o.id); return (
                <tr key={o.id} data-testid={`pay-${o.id}`} onClick={() => setSelId(o.id)} className={cx(trCls, "cursor-pointer", sel.has(o.id) && "bg-brand-soft/60")}>
                  <SelectTd id={o.id} sel={sel} />
                  {vis("order") && <Td className="font-bold">{o.id}</Td>}
                  {vis("customer") && <Td>{o.customer}</Td>}
                  {vis("total") && <Td>{inr(o.total)}</Td>}
                  {vis("paid") && <Td>{inr(o.paid)}</Td>}
                  {vis("balance") && <Td className={p.balance > 0 ? "font-semibold text-rose-600" : ""}>{p.balance < 0 ? `+${inr(-p.balance)} credit` : inr(p.balance)}</Td>}
                  {vis("due") && <Td className={p.overdue ? "text-rose-600" : ""}>{fmtDate(o.due)}</Td>}
                  {vis("last") && <Td>{lp ? fmtDate(lp.date) : "—"}</Td>}
                  {vis("mode") && <Td>{lp?.mode ?? "—"}</Td>}
                  {vis("receipt") && <Td>{lp?.receipt ?? "—"}</Td>}
                  {vis("status") && <Td><Pill tone={p.state === "Paid" ? "green" : p.state === "Partial" ? "amber" : p.state === "Overdue" ? "red" : p.state.startsWith("Over") ? "violet" : "slate"}>{p.state === "Partial" ? "Partially Paid" : p.state}</Pill></Td>}
                  <Td><div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                    <button onClick={() => setSelId(o.id)} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button>
                    <RowMenu label={`Actions for ${o.id}`} items={[
                      { label: "View position", onClick: () => setSelId(o.id) },
                      { label: "Record payment", onClick: () => open("pay", o.id) },
                      { label: "Issue refund", onClick: () => open("refund", o.id), danger: true },
                      { label: "Download receipt", onClick: () => downloadReceipt(o.id) },
                      { label: "Export transactions", onClick: () => exportRows([o.id]) },
                      { label: "Open order", onClick: () => nav(`/orders/${o.id}`) },
                    ]} />
                  </div></Td>
                </tr>); })}
              {rows.length === 0 && <tr><td colSpan={13} className="py-10 text-center text-sub">No orders match.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} noun="orders" />
      </Panel>

      {/* ───── order financial position drawer ───── */}
      <SlideOver open={!!cur && !!pos && mode === null} onClose={() => setSelId(null)} title={cur ? `${cur.id} · ${cur.customer}` : "Order"} width={520}
        footer={cur && <>
          <button onClick={() => nav(`/orders/${cur.id}`)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Open order</button>
          {receive && !closed && <button onClick={() => open("pay", cur.id)} className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark">Record payment</button>}
        </>}>
        {cur && pos && (<>
          {closed && <div className="mb-3"><Banner tone="amber">Order is closed — payments are read-only.</Banner></div>}
          <dl data-testid="fin-panel" className="grid grid-cols-2 gap-3 text-[13px]">
            {([["Total", inr(cur.total)], ["Discount", pos.discount ? inr(pos.discount) : "—"], ["Taxable value", inr(pos.taxable)], ["Tax (GST 18%)", inr(pos.tax)], ["Advance", pos.advance ? inr(pos.advance) : "—"], ["Paid", inr(cur.paid)], ["Balance", inr(Math.max(0, pos.balance))], ["Due date", fmtDate(cur.due)]] as const).map(([k, v]) => <div key={k}><dt className="text-xs text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>)}
          </dl>
          <div className="mt-3 flex items-center gap-2"><Pill tone={pos.state === "Paid" ? "green" : pos.state === "Overdue" ? "red" : pos.state.startsWith("Over") ? "violet" : "amber"}>{pos.state}</Pill>{pos.credit > 0 && <span className="text-xs font-semibold text-violet-700">{inr(pos.credit)} held as credit</span>}</div>
          <div className="mt-3 flex gap-2">
            {finance && !closed && <button onClick={() => open("refund", cur.id)} disabled={cur.paid <= 0} className="h-10 flex-1 rounded-lg border border-rose-300 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40">Refund</button>}
            {!finance && <button onClick={() => open("refund", cur.id)} className="h-10 flex-1 rounded-lg border border-line text-sm font-bold text-sub">Refund (Accounts only)</button>}
          </div>
          <h4 className="mb-1 mt-4 text-sm font-extrabold">Transactions</h4>
          <ul data-testid="pay-history" className="space-y-1.5 text-[12px]">
            {hist.map((p) => <li key={p.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5"><Pill tone={p.kind === "refund" ? "red" : "green"}>{p.kind === "refund" ? "Refund" : "Payment"}</Pill><span className="font-bold">{p.kind === "refund" ? "−" : ""}{inr(p.amount)}</span><span className="min-w-0 flex-1 truncate text-sub">{p.mode} · {p.receipt}{p.creditNote ? ` · ${p.creditNote}` : ""}</span><span className="text-sub">{fmtDate(p.date)}</span></li>)}
            {hist.length === 0 && <li className="text-sub">No transactions yet.</li>}
          </ul>
        </>)}
      </SlideOver>

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
