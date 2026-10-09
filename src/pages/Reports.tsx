import { useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, Clock, Coins, Download, FileText, ShieldCheck } from "lucide-react";
import { FilterSelect, KpiRow, LineTabs, Panel, PageHeader, Pill, ProgressBar, Td, Th, tableCls, trCls, inputCls, Field } from "../components/ui";
import { useToast } from "../components/Toast";
import { downloadCsv } from "../lib/csv";
import { ORDERS, STAFF, STAGES } from "../lib/data";
import { inr } from "../lib/format";

const TABS = ["Overview", "Orders", "Production", "Team Performance", "Financial", "Delivery", "Customer", "Custom Report"] as const;
type Tab = (typeof TABS)[number];

const trend = Array.from({ length: 16 }, (_, i) => {
  const d = 1 + i * 2;
  const n = Math.round(24 + 14 * Math.sin(i / 2.2) + (i % 3) * 2);
  return { day: `${d} Oct`, new: n, done: Math.round(n * 0.65), pending: Math.round(n * 0.25) };
});
const dept = [
  { name: "Colour Grading", v: 12, c: "#3b5bf0" }, { name: "Designing", v: 18, c: "#7c5cf0" }, { name: "Client Review", v: 10, c: "#ec4899" },
  { name: "Printing", v: 9, c: "#14b8a6" }, { name: "QC", v: 6, c: "#f59e0b" }, { name: "Delivery", v: 8, c: "#fbbf24" }, { name: "Others", v: 9, c: "#9aa5bd" },
];
const revenue = [
  { m: "Oct", revenue: 80, collections: 65 }, { m: "Nov", revenue: 120, collections: 100 }, { m: "Dec", revenue: 95, collections: 80 },
  { m: "Jan", revenue: 150, collections: 120 }, { m: "Feb", revenue: 180, collections: 160 }, { m: "Mar", revenue: 140, collections: 110 },
];
const tat = [
  { s: "Colour Grading", d: 1.2, c: "#3b9bf0" }, { s: "Designing", d: 2.8, c: "#7c5cf0" }, { s: "Client Approval", d: 1.5, c: "#ec4899" },
  { s: "Printing", d: 2.1, c: "#10b981" }, { s: "QC", d: 0.8, c: "#fbbf24" }, { s: "Delivery", d: 1.0, c: "#2563eb" },
];

const gridProps = { vertical: false, stroke: "#e6e9f5" } as const;
const axis = { tick: { fontSize: 11 }, tickLine: false, axisLine: false } as const;
const Chart = ({ h = 260, children }: { h?: number; children: ReactNode }) => <div style={{ height: h }}><ResponsiveContainer>{children as never}</ResponsiveContainer></div>;

function Donut({ data, center }: { data: { name: string; v: number; c: string }[]; center: string }) {
  const tot = data.reduce((a, d) => a + d.v, 0);
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative h-[200px] w-[200px] shrink-0">
        <ResponsiveContainer><PieChart><Pie data={data} dataKey="v" innerRadius={62} outerRadius={96} stroke="#fff" strokeWidth={2}>{data.map((d) => <Cell key={d.name} fill={d.c} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="text-3xl font-extrabold">{tot}</div><div className="text-xs text-sub">{center}</div></div></div>
      </div>
      <ul className="min-w-[200px] flex-1 space-y-2.5 text-[13px]">
        {data.map((d) => <li key={d.name} className="flex items-center gap-2"><span className="size-2.5 rounded-full" style={{ background: d.c }} /><span className="flex-1">{d.name}</span><b className="w-8 text-right">{d.v}</b><span className="w-10 text-right text-sub">{Math.round((d.v / tot) * 100)}%</span></li>)}
      </ul>
    </div>
  );
}

function DataTable({ head, rows }: { head: string[]; rows: (string | number | ReactNode)[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className={tableCls}>
        <thead><tr>{head.map((h) => <Th key={h}>{h}</Th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i} className={trCls}>{r.map((c, j) => <Td key={j} className={j === 0 ? "font-semibold" : ""}>{c}</Td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

// ---- derived mock datasets ----
const byEvent = Object.entries(ORDERS.reduce<Record<string, number>>((a, o) => ((a[o.event] = (a[o.event] ?? 0) + 1), a), {})).map(([name, v], i) => ({ name, v, c: ["#3b5bf0", "#7c5cf0", "#ec4899", "#14b8a6", "#f59e0b", "#fbbf24", "#9aa5bd", "#10b981"][i % 8]! }));
const byStage = STAGES.map((s) => ({ stage: s.label, orders: ORDERS.filter((o) => o.stage === s.key).length }));
const team = STAFF.filter((s) => s.status === "Active").map((s, i) => ({ name: s.name, role: s.role, done: 18 + ((i * 7) % 20), onTime: 82 + ((i * 5) % 17), avg: (1 + ((i * 3) % 25) / 10).toFixed(1) }));
const customers = [...ORDERS.reduce((m, o) => m.set(o.customer, (m.get(o.customer) ?? 0) + o.total), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 8);

export default function Reports() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [range, setRange] = useState("01 Oct 2026 - 31 Oct 2026");
  const [toast, show] = useToast();
  // custom report
  const [metric, setMetric] = useState("Orders");
  const [groupBy, setGroupBy] = useState("Event Type");
  const [generated, setGenerated] = useState(true);

  const customRows = (): [string, number][] => {
    const key = (o: (typeof ORDERS)[number]) => (groupBy === "Event Type" ? o.event : groupBy === "Stage" ? o.stage : groupBy === "Assignee" ? o.assignee : o.priority);
    const m = new Map<string, number>();
    ORDERS.forEach((o) => m.set(key(o), (m.get(key(o)) ?? 0) + (metric === "Orders" ? 1 : metric === "Revenue" ? o.total : o.paid)));
    return [...m];
  };

  const csvFor = (t: Tab): (string | number)[][] => {
    switch (t) {
      case "Overview": return [["Date", "New Orders", "Completed", "Pending"], ...trend.map((r) => [r.day, r.new, r.done, r.pending]), [], ["Month", "Revenue (K)", "Collections (K)"], ...revenue.map((r) => [r.m, r.revenue, r.collections])];
      case "Orders": return [["Stage", "Orders"], ...byStage.map((r) => [r.stage, r.orders])];
      case "Production": return [["Stage", "Avg TAT (days)"], ...tat.map((r) => [r.s, r.d])];
      case "Team Performance": return [["Name", "Role", "Completed", "On-time %", "Avg days"], ...team.map((r) => [r.name, r.role, r.done, r.onTime, r.avg])];
      case "Financial": return [["Month", "Revenue (K)", "Collections (K)"], ...revenue.map((r) => [r.m, r.revenue, r.collections])];
      case "Delivery": return [["Order", "Customer", "Due", "Stage"], ...ORDERS.filter((o) => o.stage === "ready_for_delivery" || o.stage === "delivered").map((o) => [o.id, o.customer, o.due, o.stage])];
      case "Customer": return [["Customer", "Billed"], ...customers.map(([n, v]) => [n, v])];
      case "Custom Report": return [[groupBy, metric], ...customRows()];
    }
  };
  const exportCsv = () => { downloadCsv(`report-${tab.toLowerCase().replace(/\s+/g, "-")}.csv`, csvFor(tab)); show(`${tab} report exported`); };

  const kpiOrders = ORDERS.length;
  const done = ORDERS.filter((o) => o.stage === "delivered").length;
  const revenueTotal = ORDERS.reduce((a, o) => a + o.paid, 0);

  return (
    <div className="min-w-0">
      {toast}
      <PageHeader title="Reports" subtitle="Track performance, productivity and business growth">
        <label className="flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-semibold">
          <CalendarDays className="size-4 text-sub" />
          <select value={range} onChange={(e) => setRange(e.target.value)} className="bg-transparent outline-none">
            {["01 Oct 2026 - 31 Oct 2026", "01 Sep 2026 - 30 Sep 2026", "01 Jul 2026 - 30 Sep 2026"].map((r) => <option key={r}>{r}</option>)}
          </select>
        </label>
        <button onClick={exportCsv} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dark"><Download className="size-4" />Export</button>
      </PageHeader>

      <div className="mb-5 overflow-x-auto rounded-2xl border border-line bg-white px-5 pt-3"><LineTabs className="min-w-max border-b-0" tabs={TABS.map((t) => ({ key: t, label: t }))} value={tab} onChange={setTab} /></div>

      {tab === "Overview" && (<>
        <KpiRow items={[
          { label: "Total Orders", value: kpiOrders, delta: 12, icon: FileText, tone: "blue" },
          { label: "Completed Orders", value: Math.max(done, 48), delta: 20, icon: ShieldCheck, tone: "green" },
          { label: "Pending Orders", value: 24, delta: -8, icon: Clock, tone: "red" },
          { label: "Revenue", value: inr(Math.max(revenueTotal, 645000)), delta: 18, icon: Coins, tone: "teal" },
        ]} />
        <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Panel title="Orders Trend">
            <Chart>
              <AreaChart data={trend}>
                <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b5bf0" stopOpacity={0.25} /><stop offset="100%" stopColor="#3b5bf0" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid {...gridProps} /><XAxis dataKey="day" {...axis} /><YAxis {...axis} /><Tooltip /><Legend iconType="circle" verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12 }} />
                <Area dataKey="new" name="New Orders" stroke="#3b5bf0" strokeWidth={2} fill="url(#g1)" />
                <Area dataKey="done" name="Completed" stroke="#10b981" strokeWidth={2} fill="none" />
                <Area dataKey="pending" name="Pending" stroke="#ec4899" strokeWidth={2} fill="none" />
              </AreaChart>
            </Chart>
          </Panel>
          <Panel title="Orders by Department"><Donut data={dept} center="Total Orders" /></Panel>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Panel title="Revenue & Collections">
            <Chart h={230}>
              <BarChart data={revenue}>
                <CartesianGrid {...gridProps} /><XAxis dataKey="m" {...axis} /><YAxis {...axis} tickFormatter={(v: number) => `${v}K`} /><Tooltip formatter={(v) => `₹${v}K`} /><Legend iconType="square" verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="revenue" name="Revenue" fill="#8b8cf0" radius={[3, 3, 0, 0]} /><Bar dataKey="collections" name="Collections" fill="#7dc4f7" radius={[3, 3, 0, 0]} />
              </BarChart>
            </Chart>
          </Panel>
          <Panel title="Average Turnaround Time (Days)">
            <ul className="space-y-4 pt-2">
              {tat.map((t) => (
                <li key={t.s} className="grid grid-cols-[110px_1fr_32px] items-center gap-3 text-[13px]">
                  <span className="text-right text-sub">{t.s}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${(t.d / 3.2) * 100}%`, background: t.c }} /></div>
                  <b>{t.d}</b>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
      </>)}

      {tab === "Orders" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Orders by Stage"><Chart><BarChart data={byStage} layout="vertical" margin={{ left: 40 }}><CartesianGrid horizontal={false} stroke="#e6e9f5" /><XAxis type="number" {...axis} /><YAxis type="category" dataKey="stage" {...axis} width={110} /><Tooltip /><Bar dataKey="orders" fill="#3b5bf0" radius={[0, 4, 4, 0]} /></BarChart></Chart></Panel>
          <Panel title="Orders by Event Type"><Donut data={byEvent} center="Orders" /></Panel>
          <Panel title="Daily Order Intake" className="xl:col-span-2"><Chart h={220}><LineChart data={trend}><CartesianGrid {...gridProps} /><XAxis dataKey="day" {...axis} /><YAxis {...axis} /><Tooltip /><Line dataKey="new" name="New Orders" stroke="#3b5bf0" strokeWidth={2} dot={false} /></LineChart></Chart></Panel>
        </div>
      )}

      {tab === "Production" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Average TAT per Stage (days)"><Chart><BarChart data={tat}><CartesianGrid {...gridProps} /><XAxis dataKey="s" {...axis} /><YAxis {...axis} /><Tooltip /><Bar dataKey="d" name="Days" radius={[4, 4, 0, 0]}>{tat.map((t) => <Cell key={t.s} fill={t.c} />)}</Bar></BarChart></Chart></Panel>
          <Panel title="Stage Load vs Capacity">
            <ul className="space-y-4">{["Colour Grading", "Designing", "Printing", "QC"].map((s, i) => { const pct = [72, 88, 64, 45][i]!; return <li key={s}><div className="mb-1 flex justify-between text-[13px]"><b>{s}</b><span className="text-sub">{pct}%</span></div><ProgressBar value={pct} tone={pct > 80 ? "red" : "blue"} /></li>; })}</ul>
          </Panel>
          <Panel title="QC First-Pass Yield" className="xl:col-span-2"><Chart h={200}><LineChart data={trend}><CartesianGrid {...gridProps} /><XAxis dataKey="day" {...axis} /><YAxis {...axis} domain={[80, 100]} /><Tooltip /><Line dataKey={(d: { new: number }) => 90 + (d.new % 7)} name="Pass %" stroke="#10b981" strokeWidth={2} dot={false} /></LineChart></Chart></Panel>
        </div>
      )}

      {tab === "Team Performance" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Panel title="Team Output"><DataTable head={["Name", "Role", "Completed", "On-time %", "Avg Days"]} rows={team.map((t) => [t.name, t.role, t.done, <Pill key="p" tone={t.onTime > 90 ? "green" : "amber"}>{t.onTime}%</Pill>, t.avg])} /></Panel>
          <Panel title="Jobs Completed"><Chart><BarChart data={team} layout="vertical" margin={{ left: 30 }}><CartesianGrid horizontal={false} stroke="#e6e9f5" /><XAxis type="number" {...axis} /><YAxis type="category" dataKey="name" {...axis} width={90} /><Tooltip /><Bar dataKey="done" fill="#7c5cf0" radius={[0, 4, 4, 0]} /></BarChart></Chart></Panel>
        </div>
      )}

      {tab === "Financial" && (<>
        <KpiRow items={[
          { label: "Billed", value: inr(ORDERS.reduce((a, o) => a + o.total, 0)), delta: 18, icon: FileText, tone: "indigo" },
          { label: "Collected", value: inr(revenueTotal), delta: 22, icon: Coins, tone: "green" },
          { label: "Outstanding", value: inr(ORDERS.reduce((a, o) => a + o.total - o.paid, 0)), delta: 9, icon: Clock, tone: "amber", invert: true },
          { label: "GST Collected (18%)", value: inr(Math.round(revenueTotal * 0.18 / 1.18)), delta: 14, icon: ShieldCheck, tone: "teal" },
        ]} />
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Revenue vs Collections"><Chart><BarChart data={revenue}><CartesianGrid {...gridProps} /><XAxis dataKey="m" {...axis} /><YAxis {...axis} tickFormatter={(v: number) => `${v}K`} /><Tooltip /><Legend /><Bar dataKey="revenue" fill="#8b8cf0" radius={[3, 3, 0, 0]} /><Bar dataKey="collections" fill="#7dc4f7" radius={[3, 3, 0, 0]} /></BarChart></Chart></Panel>
          <Panel title="Collections by Payment Mode"><Donut data={[{ name: "UPI", v: 42, c: "#3b5bf0" }, { name: "Bank Transfer", v: 28, c: "#7c5cf0" }, { name: "Cash", v: 18, c: "#f59e0b" }, { name: "Online", v: 12, c: "#10b981" }]} center="Payments" /></Panel>
        </div>
      </>)}

      {tab === "Delivery" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Panel title="Delivery Performance"><Donut data={[{ name: "On time", v: 38, c: "#10b981" }, { name: "Delayed", v: 9, c: "#f43f5e" }, { name: "Early", v: 6, c: "#3b5bf0" }]} center="Deliveries" /></Panel>
          <Panel title="Ready for Delivery / Delivered"><DataTable head={["Order", "Customer", "Due", "Stage"]} rows={ORDERS.filter((o) => o.stage === "ready_for_delivery" || o.stage === "delivered").slice(0, 8).map((o) => [o.id, o.customer, o.due, <Pill key="s" tone={o.stage === "delivered" ? "green" : "amber"}>{o.stage === "delivered" ? "Delivered" : "Ready"}</Pill>])} /></Panel>
        </div>
      )}

      {tab === "Customer" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Top Customers by Billing"><Chart><BarChart data={customers.map(([n, v]) => ({ n, v }))} layout="vertical" margin={{ left: 50 }}><CartesianGrid horizontal={false} stroke="#e6e9f5" /><XAxis type="number" {...axis} tickFormatter={(v: number) => `${Math.round(v / 1000)}K`} /><YAxis type="category" dataKey="n" {...axis} width={120} /><Tooltip formatter={(v) => inr(Number(v))} /><Bar dataKey="v" fill="#3b5bf0" radius={[0, 4, 4, 0]} /></BarChart></Chart></Panel>
          <Panel title="Customer Mix"><Donut data={[{ name: "VIP", v: 3, c: "#f59e0b" }, { name: "Regular", v: 6, c: "#3b5bf0" }, { name: "New", v: 1, c: "#10b981" }]} center="Customers" /></Panel>
        </div>
      )}

      {tab === "Custom Report" && (
        <Panel title="Custom Report Builder" subtitle="Pick a metric and a grouping, then export">
          <div className="mb-4 grid max-w-2xl gap-4 sm:grid-cols-3">
            <Field label="Metric"><FilterSelect value={metric} onChange={(v) => { setMetric(v); setGenerated(false); }} options={["Orders", "Revenue", "Collections"]} /></Field>
            <Field label="Group By"><FilterSelect value={groupBy} onChange={(v) => { setGroupBy(v); setGenerated(false); }} options={["Event Type", "Stage", "Assignee", "Priority"]} /></Field>
            <Field label="Report Name"><input className={inputCls} defaultValue="Custom report" /></Field>
          </div>
          <button onClick={() => setGenerated(true)} className="mb-5 h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Generate</button>
          {generated && (
            <div className="grid gap-4 xl:grid-cols-2">
              <Chart h={240}><BarChart data={customRows().map(([k, v]) => ({ k, v }))}><CartesianGrid {...gridProps} /><XAxis dataKey="k" {...axis} /><YAxis {...axis} /><Tooltip /><Bar dataKey="v" name={metric} fill="#7c5cf0" radius={[4, 4, 0, 0]} /></BarChart></Chart>
              <DataTable head={[groupBy, metric]} rows={customRows().map(([k, v]) => [k, metric === "Orders" ? v : inr(v)])} />
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
