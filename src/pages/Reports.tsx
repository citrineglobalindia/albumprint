import { useMemo, useState, type ReactNode } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarDays, CalendarClock, ChevronDown, Clock, Coins, Download, FileText, Save, ShieldCheck, Trash2, Play } from "lucide-react";
import { FilterSelect, KpiRow, LineTabs, Panel, PageHeader, Pill, ProgressBar, Td, Th, tableCls, trCls, inputCls, Field, SlideOver, cx } from "../components/ui";
import { useToast } from "../components/Toast";
import { downloadCsv } from "../lib/csv";
import { ORDERS, STAFF, STAGES } from "../lib/data";
import { inr, TODAY } from "../lib/format";

const TABS = ["Overview", "Orders", "Production", "Team Performance", "Financial", "Delivery", "Customer", "Custom Report"] as const;
type Tab = (typeof TABS)[number];

const dept = [
  { name: "Colour Grading", v: 12, c: "#3b5bf0" }, { name: "Designing", v: 18, c: "#7c5cf0" }, { name: "Client Review", v: 10, c: "#ec4899" },
  { name: "Printing", v: 9, c: "#14b8a6" }, { name: "QC", v: 6, c: "#f59e0b" }, { name: "Delivery", v: 8, c: "#fbbf24" }, { name: "Others", v: 9, c: "#9aa5bd" },
];
const REVENUE = [
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
  const [off, setOff] = useState<Set<string>>(new Set());
  const shown = data.filter((d) => !off.has(d.name));
  const tot = shown.reduce((a, d) => a + d.v, 0);
  const toggle = (n: string) => setOff((p) => { const c = new Set(p); if (c.has(n)) c.delete(n); else if (c.size < data.length - 1) c.add(n); return c; });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative h-[200px] w-[200px] shrink-0">
        <ResponsiveContainer><PieChart><Pie data={shown} dataKey="v" innerRadius={62} outerRadius={96} stroke="#fff" strokeWidth={2}>{shown.map((d) => <Cell key={d.name} fill={d.c} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="text-3xl font-extrabold">{tot}</div><div className="text-xs text-sub">{center}</div></div></div>
      </div>
      <ul className="min-w-[200px] flex-1 space-y-1 text-[13px]">
        {data.map((d) => { const hid = off.has(d.name); return <li key={d.name}><button onClick={() => toggle(d.name)} aria-pressed={!hid} title="Click to show/hide" className={cx("flex w-full items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50", hid && "opacity-40")}><span className="size-2.5 rounded-full" style={{ background: d.c }} /><span className={cx("flex-1 text-left", hid && "line-through")}>{d.name}</span><b className="w-8 text-right">{d.v}</b><span className="w-10 text-right text-sub">{hid || !tot ? "-" : `${Math.round((d.v / tot) * 100)}%`}</span></button></li>; })}
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
const eventsOf = (os: typeof ORDERS) => Object.entries(os.reduce<Record<string, number>>((a, o) => ((a[o.event] = (a[o.event] ?? 0) + 1), a), {})).map(([name, v], i) => ({ name, v, c: ["#3b5bf0", "#7c5cf0", "#ec4899", "#14b8a6", "#f59e0b", "#fbbf24", "#9aa5bd", "#10b981"][i % 8]! }));
const team = STAFF.filter((s) => s.status === "Active").map((s, i) => ({ name: s.name, role: s.role, done: 18 + ((i * 7) % 20), onTime: 82 + ((i * 5) % 17), avg: (1 + ((i * 3) % 25) / 10).toFixed(1) }));
const customersOf = (os: typeof ORDERS) => [...os.reduce((m, o) => m.set(o.customer, (m.get(o.customer) ?? 0) + o.total), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 8);

// ---- date range ----
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const fmt = (s: string) => new Date(s + "T00:00:00").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
type Preset = "Today" | "Last 7 days" | "Last 30 days" | "This month" | "Custom";
const PRESETS: Preset[] = ["Today", "Last 7 days", "Last 30 days", "This month", "Custom"];
const presetRange = (p: Preset): [string, string] => {
  const t = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate());
  switch (p) {
    case "Today": return [iso(t), iso(t)];
    case "Last 7 days": return [iso(addDays(t, -6)), iso(t)];
    case "Last 30 days": return [iso(addDays(t, -29)), iso(t)];
    default: return [iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(new Date(t.getFullYear(), t.getMonth() + 1, 0))];
  }
};
const trendFor = (from: string, to: string) => {
  const a = new Date(from + "T00:00:00"), b = new Date(to + "T00:00:00");
  const days = Math.max(1, Math.round((+b - +a) / 864e5) + 1);
  const single = days === 1;
  const n = single ? 8 : Math.min(16, days), step = single ? 1 : days / n;
  return Array.from({ length: n }, (_, i) => {
    const d = addDays(a, Math.floor(i * step));
    const base = Math.round(24 + 14 * Math.sin((d.getDate() + i) / 2.2) + (i % 3) * 2);
    const v = single ? Math.max(2, Math.round(base / 6)) : Math.max(1, Math.round(base * Math.max(1, step) * 0.7));
    return { day: single ? `${9 + i}:00` : d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }), new: v, done: Math.round(v * 0.65), pending: Math.round(v * 0.25) };
  });
};

interface Saved { id: string; name: string; metric: string; groupBy: string }
interface Sched { id: string; name: string; freq: string; day: string; time: string; to: string; format: string }
const lsGet = <T,>(k: string, d: T): T => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : d; } catch { return d; } };
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const ERR = "mt-1 block text-xs font-semibold text-rose-600";

export default function Reports() {
  const [tab, setTab] = useState<Tab>("Overview");
  const [preset, setPreset] = useState<Preset>("This month");
  const [[from, to], setRange] = useState<[string, string]>(presetRange("This month"));
  const [pickOpen, setPickOpen] = useState(false);
  const [cFrom, setCFrom] = useState(from);
  const [cTo, setCTo] = useState(to);
  const [rangeErr, setRangeErr] = useState("");
  const [toast, show] = useToast();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // custom report
  const [metric, setMetric] = useState("Orders");
  const [groupBy, setGroupBy] = useState("Event Type");
  const [generated, setGenerated] = useState(true);
  const [rname, setRname] = useState("Custom report");
  const [nameErr, setNameErr] = useState("");
  const [saved, setSaved] = useState<Saved[]>(() => lsGet("albumpro.reports.saved", []));
  const [scheds, setScheds] = useState<Sched[]>(() => lsGet("albumpro.reports.scheduled", []));
  const [schedOpen, setSchedOpen] = useState(false);
  const [sf, setSf] = useState({ freq: "Weekly", day: "Monday", time: "09:00", to: "", format: "CSV" });
  const [sErr, setSErr] = useState<{ to?: string }>({});

  const label = `${fmt(from)} - ${fmt(to)}`;
  const days = Math.max(1, Math.round((+new Date(to) - +new Date(from)) / 864e5) + 1);
  const scale = Math.min(1.5, Math.max(0.05, days / 31));
  const orders = useMemo(() => ORDERS.filter((o) => o.pendingAt >= from && o.pendingAt <= to), [from, to]);
  const trend = useMemo(() => trendFor(from, to), [from, to]);
  const revenue = useMemo(() => REVENUE.map((r) => ({ ...r, revenue: Math.round(r.revenue * scale), collections: Math.round(r.collections * scale) })), [scale]);
  const deptS = useMemo(() => dept.map((d) => ({ ...d, v: Math.max(0, Math.round(d.v * scale)) })), [scale]);
  const byStage = useMemo(() => STAGES.map((s) => ({ stage: s.label, orders: orders.filter((o) => o.stage === s.key).length })), [orders]);
  const byEvent = useMemo(() => eventsOf(orders), [orders]);
  const customers = useMemo(() => customersOf(orders), [orders]);

  const applyPreset = (p: Preset) => {
    setPreset(p);
    if (p === "Custom") { setCFrom(from); setCTo(to); setRangeErr(""); return; }
    const r = presetRange(p);
    setRange(r); setPickOpen(false); show(`Date range set to ${p}: ${fmt(r[0])} - ${fmt(r[1])}`);
  };
  const applyCustom = () => {
    if (!cFrom || !cTo) { setRangeErr("Pick both a start and an end date"); return; }
    if (cFrom > cTo) { setRangeErr("Start date must be on or before the end date"); return; }
    setRange([cFrom, cTo]); setPickOpen(false); setRangeErr(""); show(`Date range set: ${fmt(cFrom)} - ${fmt(cTo)}`);
  };
  const legend = (e: { dataKey?: unknown }) => { const k = String(e.dataKey); setHidden((p) => { const c = new Set(p); if (c.has(k)) c.delete(k); else c.add(k); return c; }); };
  const lf = (v: string, e: { dataKey?: unknown }) => <span className={hidden.has(String(e.dataKey)) ? "text-slate-400 line-through" : ""}>{v}</span>;

  const customRows = (): [string, number][] => {
    const key = (o: (typeof ORDERS)[number]) => (groupBy === "Event Type" ? o.event : groupBy === "Stage" ? o.stage : groupBy === "Assignee" ? o.assignee : o.priority);
    const m = new Map<string, number>();
    orders.forEach((o) => m.set(key(o), (m.get(key(o)) ?? 0) + (metric === "Orders" ? 1 : metric === "Revenue" ? o.total : o.paid)));
    return [...m];
  };

  const csvFor = (t: Tab): (string | number)[][] => {
    const hdr: (string | number)[][] = [["Report", t], ["Range", label], []];
    switch (t) {
      case "Overview": return [...hdr, ["Date", "New Orders", "Completed", "Pending"], ...trend.map((r) => [r.day, r.new, r.done, r.pending]), [], ["Month", "Revenue (K)", "Collections (K)"], ...revenue.map((r) => [r.m, r.revenue, r.collections])];
      case "Orders": return [...hdr, ["Stage", "Orders"], ...byStage.map((r) => [r.stage, r.orders])];
      case "Production": return [...hdr, ["Stage", "Avg TAT (days)"], ...tat.map((r) => [r.s, r.d])];
      case "Team Performance": return [...hdr, ["Name", "Role", "Completed", "On-time %", "Avg days"], ...team.map((r) => [r.name, r.role, r.done, r.onTime, r.avg])];
      case "Financial": return [...hdr, ["Month", "Revenue (K)", "Collections (K)"], ...revenue.map((r) => [r.m, r.revenue, r.collections])];
      case "Delivery": return [...hdr, ["Order", "Customer", "Due", "Stage"], ...orders.filter((o) => o.stage === "ready_for_delivery" || o.stage === "delivered").map((o) => [o.id, o.customer, o.due, o.stage])];
      case "Customer": return [...hdr, ["Customer", "Billed"], ...customers.map(([n, v]) => [n, v])];
      case "Custom Report": return [...hdr, [groupBy, metric], ...customRows()];
    }
  };
  const exportCsv = () => { downloadCsv(`report-${tab.toLowerCase().replace(/\s+/g, "-")}.csv`, csvFor(tab)); show(`${tab} report exported (${label})`); };

  const generate = () => {
    if (!rname.trim()) { setNameErr("Report name is required"); return; }
    setNameErr(""); setGenerated(true); show(`Generated "${rname.trim()}": ${customRows().length} rows for ${label}`);
  };
  const saveReport = () => {
    if (!rname.trim()) { setNameErr("Report name is required"); return; }
    setNameErr("");
    const next = [...saved.filter((r) => r.name.toLowerCase() !== rname.trim().toLowerCase()), { id: `R${Date.now()}`, name: rname.trim(), metric, groupBy }];
    setSaved(next); lsSet("albumpro.reports.saved", next); show(`Report "${rname.trim()}" saved`);
  };
  const saveSched = () => {
    if (!rname.trim()) { setSErr({ to: undefined }); setSchedOpen(false); setNameErr("Report name is required"); return; }
    const list = sf.to.split(/[,;\s]+/).filter(Boolean);
    if (!list.length) { setSErr({ to: "Add at least one recipient email" }); return; }
    if (list.some((e) => !/^\S+@\S+\.\S+$/.test(e))) { setSErr({ to: "One or more email addresses are invalid" }); return; }
    const next = [...scheds, { id: `S${Date.now()}`, name: rname.trim(), freq: sf.freq, day: sf.day, time: sf.time, to: list.join(", "), format: sf.format }];
    setScheds(next); lsSet("albumpro.reports.scheduled", next); setSchedOpen(false); setSErr({});
    show(`"${rname.trim()}" scheduled ${sf.freq.toLowerCase()} at ${sf.time} to ${list.length} recipient${list.length > 1 ? "s" : ""}`);
  };

  const kpiOrders = orders.length;
  const done = orders.filter((o) => o.stage === "delivered").length;
  const revenueTotal = orders.reduce((a, o) => a + o.paid, 0);

  return (
    <div className="min-w-0">
      {toast}
      <PageHeader title="Reports" subtitle="Track performance, productivity and business growth">
        <div className="relative">
          <button onClick={() => setPickOpen(!pickOpen)} aria-haspopup="dialog" aria-expanded={pickOpen} className="flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-semibold hover:bg-brand-soft">
            <CalendarDays className="size-4 text-sub" />{label}<ChevronDown className="size-4 text-sub" />
          </button>
          {pickOpen && (
            <div className="fixed inset-0 z-40" onClick={() => setPickOpen(false)}>
              <div role="dialog" aria-label="Date range" className="absolute right-7 top-[132px] w-72 rounded-xl border border-line bg-white p-2 shadow-xl" onClick={(e) => e.stopPropagation()}>
                {PRESETS.map((p) => <button key={p} onClick={() => applyPreset(p)} className={cx("flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] font-semibold hover:bg-brand-soft", preset === p && "bg-brand-soft text-brand")}>{p}{preset === p && <span className="text-xs">&#10003;</span>}</button>)}
                {preset === "Custom" && (
                  <div className="mt-1 space-y-2 border-t border-line p-2">
                    <label className="block text-xs font-semibold text-sub">From<input type="date" className={inputCls} value={cFrom} onChange={(e) => setCFrom(e.target.value)} /></label>
                    <label className="block text-xs font-semibold text-sub">To<input type="date" className={inputCls} value={cTo} onChange={(e) => setCTo(e.target.value)} /></label>
                    {rangeErr && <span className={ERR}>{rangeErr}</span>}
                    <button onClick={applyCustom} className="h-9 w-full rounded-lg bg-brand text-sm font-bold text-white">Apply range</button>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
        <button onClick={exportCsv} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dark"><Download className="size-4" />Export</button>
      </PageHeader>

      <div className="mb-5 overflow-x-auto rounded-2xl border border-line bg-white px-5 pt-3"><LineTabs className="min-w-max border-b-0" tabs={TABS.map((t) => ({ key: t, label: t }))} value={tab} onChange={setTab} /></div>

      {tab === "Overview" && (<>
        <KpiRow items={[
          { label: "Total Orders", value: kpiOrders, delta: 12, icon: FileText, tone: "blue" },
          { label: "Completed Orders", value: done, delta: 20, icon: ShieldCheck, tone: "green" },
          { label: "Pending Orders", value: kpiOrders - done, delta: -8, icon: Clock, tone: "red" },
          { label: "Revenue", value: inr(revenueTotal), delta: 18, icon: Coins, tone: "teal" },
        ]} />
        <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Panel title="Orders Trend">
            <Chart>
              <AreaChart data={trend}>
                <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b5bf0" stopOpacity={0.25} /><stop offset="100%" stopColor="#3b5bf0" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid {...gridProps} /><XAxis dataKey="day" {...axis} /><YAxis {...axis} /><Tooltip /><Legend iconType="circle" verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={legend} formatter={lf} />
                <Area dataKey="new" name="New Orders" hide={hidden.has("new")} stroke="#3b5bf0" strokeWidth={2} fill="url(#g1)" />
                <Area dataKey="done" name="Completed" hide={hidden.has("done")} stroke="#10b981" strokeWidth={2} fill="none" />
                <Area dataKey="pending" name="Pending" hide={hidden.has("pending")} stroke="#ec4899" strokeWidth={2} fill="none" />
              </AreaChart>
            </Chart>
          </Panel>
          <Panel title="Orders by Department"><Donut data={deptS} center="Total Orders" /></Panel>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Panel title="Revenue & Collections">
            <Chart h={230}>
              <BarChart data={revenue}>
                <CartesianGrid {...gridProps} /><XAxis dataKey="m" {...axis} /><YAxis {...axis} tickFormatter={(v: number) => `${v}K`} /><Tooltip formatter={(v) => `₹${v}K`} /><Legend iconType="square" verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={legend} formatter={lf} />
                <Bar dataKey="revenue" name="Revenue" hide={hidden.has("revenue")} fill="#8b8cf0" radius={[3, 3, 0, 0]} /><Bar dataKey="collections" name="Collections" hide={hidden.has("collections")} fill="#7dc4f7" radius={[3, 3, 0, 0]} />
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
          { label: "Billed", value: inr(orders.reduce((a, o) => a + o.total, 0)), delta: 18, icon: FileText, tone: "indigo" },
          { label: "Collected", value: inr(revenueTotal), delta: 22, icon: Coins, tone: "green" },
          { label: "Outstanding", value: inr(orders.reduce((a, o) => a + o.total - o.paid, 0)), delta: 9, icon: Clock, tone: "amber", invert: true },
          { label: "GST Collected (18%)", value: inr(Math.round(revenueTotal * 0.18 / 1.18)), delta: 14, icon: ShieldCheck, tone: "teal" },
        ]} />
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Revenue vs Collections"><Chart><BarChart data={revenue}><CartesianGrid {...gridProps} /><XAxis dataKey="m" {...axis} /><YAxis {...axis} tickFormatter={(v: number) => `${v}K`} /><Tooltip /><Legend wrapperStyle={{ cursor: "pointer" }} onClick={legend} formatter={lf} /><Bar dataKey="revenue" hide={hidden.has("revenue")} fill="#8b8cf0" radius={[3, 3, 0, 0]} /><Bar dataKey="collections" hide={hidden.has("collections")} fill="#7dc4f7" radius={[3, 3, 0, 0]} /></BarChart></Chart></Panel>
          <Panel title="Collections by Payment Mode"><Donut data={[{ name: "UPI", v: 42, c: "#3b5bf0" }, { name: "Bank Transfer", v: 28, c: "#7c5cf0" }, { name: "Cash", v: 18, c: "#f59e0b" }, { name: "Online", v: 12, c: "#10b981" }]} center="Payments" /></Panel>
        </div>
      </>)}

      {tab === "Delivery" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Panel title="Delivery Performance"><Donut data={[{ name: "On time", v: 38, c: "#10b981" }, { name: "Delayed", v: 9, c: "#f43f5e" }, { name: "Early", v: 6, c: "#3b5bf0" }]} center="Deliveries" /></Panel>
          <Panel title="Ready for Delivery / Delivered"><DataTable head={["Order", "Customer", "Due", "Stage"]} rows={orders.filter((o) => o.stage === "ready_for_delivery" || o.stage === "delivered").slice(0, 8).map((o) => [o.id, o.customer, o.due, <Pill key="s" tone={o.stage === "delivered" ? "green" : "amber"}>{o.stage === "delivered" ? "Delivered" : "Ready"}</Pill>])} /></Panel>
        </div>
      )}

      {tab === "Customer" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Top Customers by Billing"><Chart><BarChart data={customers.map(([n, v]) => ({ n, v }))} layout="vertical" margin={{ left: 50 }}><CartesianGrid horizontal={false} stroke="#e6e9f5" /><XAxis type="number" {...axis} tickFormatter={(v: number) => `${Math.round(v / 1000)}K`} /><YAxis type="category" dataKey="n" {...axis} width={120} /><Tooltip formatter={(v) => inr(Number(v))} /><Bar dataKey="v" fill="#3b5bf0" radius={[0, 4, 4, 0]} /></BarChart></Chart></Panel>
          <Panel title="Customer Mix"><Donut data={[{ name: "VIP", v: 3, c: "#f59e0b" }, { name: "Regular", v: 6, c: "#3b5bf0" }, { name: "New", v: 1, c: "#10b981" }]} center="Customers" /></Panel>
        </div>
      )}

      {tab === "Custom Report" && (
        <Panel title="Custom Report Builder" subtitle={`Pick a metric and a grouping, then export. Range: ${label}`}>
          <div className="mb-4 grid max-w-2xl gap-4 sm:grid-cols-3">
            <Field label="Metric"><FilterSelect value={metric} onChange={(v) => { setMetric(v); setGenerated(false); }} options={["Orders", "Revenue", "Collections"]} /></Field>
            <Field label="Group By"><FilterSelect value={groupBy} onChange={(v) => { setGroupBy(v); setGenerated(false); }} options={["Event Type", "Stage", "Assignee", "Priority"]} /></Field>
            <Field label="Report Name" required><input className={inputCls} value={rname} onChange={(e) => { setRname(e.target.value); setNameErr(""); }} />{nameErr && <span className={ERR}>{nameErr}</span>}</Field>
          </div>
          <div className="mb-5 flex flex-wrap gap-2">
            <button onClick={generate} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-bold text-white"><Play className="size-4" />Generate</button>
            <button onClick={saveReport} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft"><Save className="size-4" />Save report</button>
            <button onClick={() => { if (!rname.trim()) { setNameErr("Report name is required"); return; } setSErr({}); setSchedOpen(true); }} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft"><CalendarClock className="size-4" />Schedule</button>
          </div>
          {generated ? (
            <div className="grid gap-4 xl:grid-cols-2">
              <Chart h={240}><BarChart data={customRows().map(([k, v]) => ({ k, v }))}><CartesianGrid {...gridProps} /><XAxis dataKey="k" {...axis} /><YAxis {...axis} /><Tooltip /><Bar dataKey="v" name={metric} fill="#7c5cf0" radius={[4, 4, 0, 0]} /></BarChart></Chart>
              <DataTable head={[groupBy, metric]} rows={customRows().map(([k, v]) => [k, metric === "Orders" ? v : inr(v)])} />
            </div>
          ) : <p className="text-sm text-sub">Settings changed. Press Generate to refresh the report.</p>}

          {(saved.length > 0 || scheds.length > 0) && (
            <div className="mt-6 grid gap-4 border-t border-line pt-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-sm font-extrabold">Saved reports</h3>
                {saved.length === 0 && <p className="text-xs text-sub">None yet.</p>}
                <ul className="space-y-2">{saved.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                    <span className="flex-1"><b>{r.name}</b><span className="block text-xs text-sub">{r.metric} by {r.groupBy}</span></span>
                    <button onClick={() => { setMetric(r.metric); setGroupBy(r.groupBy); setRname(r.name); setGenerated(true); show(`Loaded "${r.name}"`); }} className="h-8 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft">Run</button>
                    <button aria-label={`Delete ${r.name}`} onClick={() => { const n = saved.filter((x) => x.id !== r.id); setSaved(n); lsSet("albumpro.reports.saved", n); show(`Deleted "${r.name}"`); }} className="text-rose-600"><Trash2 className="size-4" /></button>
                  </li>))}</ul>
              </div>
              <div>
                <h3 className="mb-2 text-sm font-extrabold">Scheduled reports</h3>
                {scheds.length === 0 && <p className="text-xs text-sub">None yet.</p>}
                <ul className="space-y-2">{scheds.map((r) => (
                  <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                    <span className="flex-1"><b>{r.name}</b><span className="block text-xs text-sub">{r.freq}{r.freq !== "Daily" ? ` (${r.day})` : ""} at {r.time} · {r.format} · {r.to}</span></span>
                    <button aria-label={`Remove schedule ${r.name}`} onClick={() => { const n = scheds.filter((x) => x.id !== r.id); setScheds(n); lsSet("albumpro.reports.scheduled", n); show(`Schedule removed for "${r.name}"`); }} className="text-rose-600"><Trash2 className="size-4" /></button>
                  </li>))}</ul>
              </div>
            </div>
          )}
        </Panel>
      )}

      <SlideOver open={schedOpen} onClose={() => setSchedOpen(false)} title="Schedule report" footer={<>
        <button onClick={() => setSchedOpen(false)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <button onClick={saveSched} className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white">Save schedule</button>
      </>}>
        <p className="mb-4 text-sm text-sub">Email "{rname}" ({metric} by {groupBy}) automatically (SRS 19.3).</p>
        <Field label="Frequency"><FilterSelect value={sf.freq} onChange={(v) => setSf({ ...sf, freq: v })} options={["Daily", "Weekly", "Monthly"]} /></Field>
        {sf.freq !== "Daily" && <Field label={sf.freq === "Weekly" ? "Day of week" : "Day of month"}><FilterSelect value={sf.day} onChange={(v) => setSf({ ...sf, day: v })} options={sf.freq === "Weekly" ? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] : ["1st", "5th", "10th", "15th", "Last day"]} /></Field>}
        <Field label="Time"><input type="time" className={inputCls} value={sf.time} onChange={(e) => setSf({ ...sf, time: e.target.value })} /></Field>
        <Field label="Format"><FilterSelect value={sf.format} onChange={(v) => setSf({ ...sf, format: v })} options={["CSV", "PDF", "Excel"]} /></Field>
        <Field label="Recipients" required hint="Comma-separated email addresses"><input className={inputCls} value={sf.to} onChange={(e) => { setSf({ ...sf, to: e.target.value }); setSErr({}); }} placeholder="owner@studio.com, accounts@studio.com" />{sErr.to && <span className={ERR}>{sErr.to}</span>}</Field>
      </SlideOver>
    </div>
  );
}
