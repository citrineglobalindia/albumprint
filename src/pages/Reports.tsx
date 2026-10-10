import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { CalendarClock, Clock, Coins, Download, ExternalLink, FileText, History, Printer, Save, ShieldCheck, Trash2, Play, GitCompareArrows } from "lucide-react";
import { Combobox, DateRangePicker, FilterChips, MultiSelect, fmtShort, presetRange, type DateRange } from "../components/controls";
import { KpiRow, LineTabs, Panel, PageHeader, Pill, ProgressBar, Td, Th, tableCls, trCls, inputCls, Field, SlideOver, cx } from "../components/ui";
import { useToast } from "../components/Toast";
import { downloadCsv } from "../lib/csv";
import { ORDERS, STAFF, STAGES, CUSTOMERS, stageLabel, type Order, type StageKey } from "../lib/data";
import { AUDIT } from "../lib/audit";
import { useLive } from "../lib/useLive";
import { inr } from "../lib/format";

const TABS = ["Overview", "Orders", "Production", "Team Performance", "Financial", "Delivery", "Customer", "Custom Report"] as const;
type Tab = (typeof TABS)[number];
type Gran = "day" | "week" | "month";

const PALETTE = ["#3b5bf0", "#7c5cf0", "#ec4899", "#14b8a6", "#f59e0b", "#fbbf24", "#9aa5bd", "#10b981"];
// Fallback turnaround estimates (days) used until the audit trail has recorded real stage hand-offs for a stage group.
const TAT_EST = [
  { s: "Colour Grading", d: 1.2, c: "#3b9bf0", stages: ["colour_grading", "admin_approval"] as StageKey[] }, { s: "Designing", d: 2.8, c: "#7c5cf0", stages: ["designing"] as StageKey[] },
  { s: "Client Approval", d: 1.5, c: "#ec4899", stages: ["client_review", "final_approval"] as StageKey[] }, { s: "Printing", d: 2.1, c: "#10b981", stages: ["printing"] as StageKey[] },
  { s: "QC", d: 0.8, c: "#fbbf24", stages: ["qc"] as StageKey[] }, { s: "Delivery", d: 1.0, c: "#2563eb", stages: ["ready_for_delivery", "delivered"] as StageKey[] },
];
const WIP_CAP: Partial<Record<StageKey, number>> = { colour_grading: 8, admin_approval: 6, designing: 10, client_review: 8, final_approval: 5, printing: 8, qc: 6, ready_for_delivery: 8 };
const KEY_OF_LABEL = new Map(STAGES.map((s) => [s.label, s.key] as const));
interface Hand { orderId: string; stage: StageKey; ms: number; by: string }
/** Time spent in each stage, measured from consecutive stage_change/stage_override audit rows per order (enter = event.to, leave = the next event). */
function handOffs(): Hand[] {
  const by = new Map<string, typeof AUDIT>();
  AUDIT.filter((a) => a.entity === "order" && (a.action === "stage_change" || a.action === "stage_override")).forEach((a) => by.set(a.entityId, [...(by.get(a.entityId) ?? []), a]));
  const out: Hand[] = [];
  by.forEach((list, orderId) => {
    const asc = [...list].sort((a, b) => a.at.localeCompare(b.at));
    for (let i = 0; i + 1 < asc.length; i++) {
      const st = KEY_OF_LABEL.get(asc[i]!.to ?? ""); if (!st) continue;
      out.push({ orderId, stage: st, ms: Math.max(0, +new Date(asc[i + 1]!.at) - +new Date(asc[i]!.at)), by: asc[i + 1]!.actor });
    }
  });
  return out;
}
const fmtDur = (ms: number) => ms < 6e4 ? `${Math.round(ms / 1000)} s` : ms < 36e5 ? `${Math.round(ms / 6e4)} min` : ms < 864e5 ? `${(ms / 36e5).toFixed(1)} h` : `${(ms / 864e5).toFixed(1)} d`;
const DEPT_OF: Record<StageKey, string> = { new_order: "Others", files_received: "Others", colour_grading: "Colour Grading", admin_approval: "Colour Grading", designing: "Designing", client_review: "Client Review", final_approval: "Client Review", printing: "Printing", qc: "QC", ready_for_delivery: "Delivery", delivered: "Delivery" };
const DEPTS = ["Colour Grading", "Designing", "Client Review", "Printing", "QC", "Delivery", "Others"];

const gridProps = { vertical: false, stroke: "#e6e9f5" } as const;
const axis = { tick: { fontSize: 11 }, tickLine: false, axisLine: false } as const;
const Chart = ({ h = 260, children }: { h?: number; children: ReactNode }) => <div className="cursor-pointer" style={{ height: h }}><ResponsiveContainer>{children as never}</ResponsiveContainer></div>;

// ---------- date helpers ----------
const DAY = 864e5;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const toD = (s: string) => new Date(s + "T00:00:00");
const addD = (d: Date, n: number) => { const c = new Date(d); c.setDate(c.getDate() + n); return c; };
const weekStart = (d: Date) => addD(d, -((d.getDay() + 6) % 7));
const bucketKey = (s: string, g: Gran) => (g === "day" ? s : g === "week" ? iso(weekStart(toD(s))) : s.slice(0, 7) + "-01");
const bucketLabel = (k: string, g: Gran) => (g === "month" ? toD(k).toLocaleDateString("en-GB", { month: "short", year: "2-digit" }) : g === "week" ? "Wk " + toD(k).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : toD(k).toLocaleDateString("en-GB", { day: "numeric", month: "short" }));
const bucketsOf = (from: string, to: string, g: Gran) => { const out: string[] = []; for (let d = toD(from); iso(d) <= to; d = addD(d, 1)) { const k = bucketKey(iso(d), g); if (out[out.length - 1] !== k) out.push(k); } return out; };
const DATA_MIN = ORDERS.reduce((a, o) => (o.pendingAt < a ? o.pendingAt : a), "9999-12-31");
const DATA_MAX = ORDERS.reduce((a, o) => (o.pendingAt > a ? o.pendingAt : a), "0000-01-01");
const isDone = (o: Order) => o.stage === "delivered" || o.stage === "ready_for_delivery";
const pct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 100) : undefined);
const sum = (os: Order[], f: (o: Order) => number) => os.reduce((a, o) => a + f(o), 0);

interface Row { key: string; label: string; new: number; done: number; pending: number; revenue: number; collections: number; orders: Order[]; prevNew?: number; prevRevenue?: number; prevCollections?: number }

function Donut({ data, center, onSlice }: { data: { name: string; v: number; c: string }[]; center: string; onSlice?: (name: string) => void }) {
  const [off, setOff] = useState<Set<string>>(new Set());
  const shown = data.filter((d) => !off.has(d.name) && d.v > 0);
  const tot = shown.reduce((a, d) => a + d.v, 0);
  const toggle = (n: string) => setOff((p) => { const c = new Set(p); if (c.has(n)) c.delete(n); else if (c.size < data.length - 1) c.add(n); return c; });
  return (
    <div className="flex flex-wrap items-center gap-5">
      <div className="relative h-[200px] w-[200px] shrink-0">
        <ResponsiveContainer><PieChart><Pie data={shown} dataKey="v" nameKey="name" innerRadius={62} outerRadius={96} stroke="#fff" strokeWidth={2} className="cursor-pointer" onClick={(d: { name?: string }) => d?.name && onSlice?.(d.name)}>{shown.map((d) => <Cell key={d.name} fill={d.c} />)}</Pie><Tooltip /></PieChart></ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 grid place-items-center text-center"><div><div className="text-3xl font-extrabold">{tot}</div><div className="text-xs text-sub">{center}</div></div></div>
      </div>
      <ul className="min-w-[200px] flex-1 space-y-1 text-[13px]">
        {data.map((d) => { const hid = off.has(d.name); return (
          <li key={d.name} className="flex items-center gap-1">
            <button onClick={() => toggle(d.name)} aria-pressed={!hid} title="Click to show/hide" className={cx("flex flex-1 items-center gap-2 rounded-md px-1 py-1 hover:bg-slate-50", hid && "opacity-40")}><span className="size-2.5 rounded-full" style={{ background: d.c }} /><span className={cx("flex-1 text-left", hid && "line-through")}>{d.name}</span><b className="w-8 text-right">{d.v}</b><span className="w-10 text-right text-sub">{hid || !tot ? "-" : `${Math.round((d.v / tot) * 100)}%`}</span></button>
            {onSlice && <button onClick={() => onSlice(d.name)} aria-label={`View ${d.v} orders: ${d.name}`} title="View orders" className="grid size-6 place-items-center rounded-md text-sub hover:bg-brand-soft hover:text-brand"><ExternalLink className="size-3.5" /></button>}
          </li>); })}
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

function GroupToggle({ value, onChange }: { value: Gran; onChange: (g: Gran) => void }) {
  return (
    <div role="group" aria-label="Group by" className="inline-flex rounded-lg border border-line bg-white p-0.5 text-xs font-bold">
      {(["day", "week", "month"] as Gran[]).map((g) => <button key={g} aria-pressed={value === g} onClick={() => onChange(g)} className={cx("rounded-md px-2.5 py-1 capitalize", value === g ? "bg-brand text-white" : "text-sub hover:text-ink")}>{g}</button>)}
    </div>
  );
}
const Delta = ({ v }: { v: number | undefined }) => (v === undefined ? null : <span className={cx("ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold", v >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-600")}>{v >= 0 ? "+" : ""}{v}% vs prev</span>);

// ---------- custom report ----------
const METRICS = ["Orders", "Revenue", "Collections", "Outstanding", "Avg order value"];
const GROUPS = ["Event Type", "Stage", "Assignee", "Priority", "Customer", "Payment status", "Album size"];
const groupKey = (o: Order, g: string) => (g === "Event Type" ? o.event : g === "Stage" ? stageLabel(o.stage) : g === "Assignee" ? o.assignee : g === "Priority" ? o.priority : g === "Customer" ? o.customer : g === "Payment status" ? o.pay : o.size);
const metricVal = (os: Order[], m: string) => (m === "Orders" ? os.length : m === "Revenue" ? sum(os, (o) => o.total) : m === "Collections" ? sum(os, (o) => o.paid) : m === "Outstanding" ? sum(os, (o) => o.total - o.paid) : os.length ? Math.round(sum(os, (o) => o.total) / os.length) : 0);
const fmtMetric = (m: string, v: number) => (m === "Orders" ? String(v) : inr(v));
interface CFilters { stage: string[]; priority: string[]; event: string[]; pay: string[] }
interface Saved { id: string; name: string; metrics: string[]; groupBy: string; filters: CFilters }
interface Sched { id: string; name: string; freq: string; day: string; time: string; to: string; format: string }
interface RunRec { id: string; name: string; at: string; rows: number; range: string; metrics: string[]; groupBy: string; filters: CFilters }
const NOF: CFilters = { stage: [], priority: [], event: [], pay: [] };
const lsGet = <T,>(k: string, d: T): T => { try { const r = localStorage.getItem(k); return r ? (JSON.parse(r) as T) : d; } catch { return d; } };
const lsSet = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } };
const ERR = "mt-1 block text-xs font-semibold text-rose-600";
const filterOrders = (os: Order[], f: CFilters) => os.filter((o) => (!f.stage.length || f.stage.includes(stageLabel(o.stage))) && (!f.priority.length || f.priority.includes(o.priority)) && (!f.event.length || f.event.includes(o.event)) && (!f.pay.length || f.pay.includes(o.pay)));
const customTable = (os: Order[], metrics: string[], groupBy: string) => {
  const m = new Map<string, Order[]>();
  os.forEach((o) => { const k = groupKey(o, groupBy); m.set(k, [...(m.get(k) ?? []), o]); });
  return [...m].map(([k, list]) => ({ k, vals: metrics.map((x) => metricVal(list, x)), orders: list })).sort((a, b) => (b.vals[0] ?? 0) - (a.vals[0] ?? 0));
};

export default function Reports() {
  useLive(false);
  const [tab, setTab] = useState<Tab>("Overview");
  const [range, setRange] = useState<DateRange>(() => presetRange("This Month"));
  const [compare, setCompare] = useState(false);
  const [gran, setGran] = useState<Gran>("day");
  const [toast, show] = useToast();
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [drill, setDrill] = useState<null | { title: string; orders: Order[] }>(null);
  // custom report
  const [metrics, setMetrics] = useState<string[]>(["Orders", "Revenue"]);
  const [groupBy, setGroupBy] = useState("Event Type");
  const [cf, setCf] = useState<CFilters>(NOF);
  const [rname, setRname] = useState("Custom report");
  const [nameErr, setNameErr] = useState("");
  const [saved, setSaved] = useState<Saved[]>(() => lsGet<Partial<Saved & { metric: string }>[]>("albumpro.reports.saved", []).map((r) => ({ id: r.id ?? `R${Math.random()}`, name: r.name ?? "Report", metrics: r.metrics ?? [r.metric ?? "Orders"], groupBy: r.groupBy ?? "Event Type", filters: r.filters ?? NOF })));
  const [scheds, setScheds] = useState<Sched[]>(() => lsGet("albumpro.reports.scheduled", []));
  const [runs, setRuns] = useState<RunRec[]>(() => lsGet("albumpro.reports.runs", []));
  const [schedOpen, setSchedOpen] = useState(false);
  const [sf, setSf] = useState({ freq: "Weekly", day: "Monday", time: "09:00", to: "", format: "CSV" });
  const [sErr, setSErr] = useState<{ to?: string }>({});

  const from = range.from ? iso(range.from) : DATA_MIN, to = range.to ? iso(range.to) : DATA_MAX;
  const label = range.preset === "All Time" ? "All Time" : `${fmtShort(range.from)} – ${fmtShort(range.to)}`;
  const canCompare = !!range.from && !!range.to;
  const cmp = compare && canCompare;
  const sig = ORDERS.map((o) => `${o.id}${o.stage}${o.hold ?? ""}${o.pay}${o.paid}${o.assignee}${o.priority}`).join("|") + AUDIT.length;
  const orders = useMemo(() => ORDERS.filter((o) => o.pendingAt >= from && o.pendingAt <= to), [from, to, sig]);   // eslint-disable-line react-hooks/exhaustive-deps
  const hands = useMemo(() => handOffs(), [sig]);   // eslint-disable-line react-hooks/exhaustive-deps
  const tat = useMemo(() => TAT_EST.map((t) => {
    const m = hands.filter((h) => t.stages.includes(h.stage));
    const measured = m.length ? m.reduce((a, h) => a + h.ms, 0) / m.length / DAY : undefined;
    return { ...t, d: Math.round((measured ?? t.d) * 100) / 100, n: m.length, src: m.length ? "audit trail" : "estimate", ms: m.length ? m.reduce((a, h) => a + h.ms, 0) / m.length : t.d * DAY };
  }), [hands]);
  const days = Math.max(1, Math.round((+toD(to) - +toD(from)) / DAY) + 1);
  const prevTo = iso(addD(toD(from), -1)), prevFrom = iso(addD(toD(from), -days));
  const prevOrders = useMemo(() => (cmp ? ORDERS.filter((o) => o.pendingAt >= prevFrom && o.pendingAt <= prevTo) : []), [cmp, prevFrom, prevTo, sig]);   // eslint-disable-line react-hooks/exhaustive-deps
  // The demo dataset only covers early October: when no earlier orders exist, the previous period is simulated so the comparison UI is still demonstrable.
  const simulated = cmp && prevOrders.length === 0;

  const series = useMemo<Row[]>(() => {
    const keys = bucketsOf(from, to, gran);
    const pKeys = cmp ? bucketsOf(prevFrom, prevTo, gran) : [];
    return keys.map((key, i) => {
      const os = orders.filter((o) => bucketKey(o.pendingAt, gran) === key);
      const row: Row = { key, label: bucketLabel(key, gran), new: os.length, done: os.filter(isDone).length, pending: os.length - os.filter(isDone).length, revenue: sum(os, (o) => o.total), collections: sum(os, (o) => o.paid), orders: os };
      if (cmp) {
        const ps = prevOrders.filter((o) => bucketKey(o.pendingAt, gran) === pKeys[i]);
        const f = 0.78 + ((i * 7) % 5) / 20;
        row.prevNew = simulated ? Math.round(row.new * f) : ps.length;
        row.prevRevenue = simulated ? Math.round(row.revenue * f) : sum(ps, (o) => o.total);
        row.prevCollections = simulated ? Math.round(row.collections * f) : sum(ps, (o) => o.paid);
      }
      return row;
    });
  }, [orders, prevOrders, from, to, prevFrom, prevTo, gran, cmp, simulated]);

  const kpi = (cur: number, prevReal: number, simF: number) => (cmp ? pct(cur, simulated ? Math.round(cur * simF) : prevReal) : undefined);
  const done = orders.filter((o) => o.stage === "delivered").length;
  const collected = sum(orders, (o) => o.paid);
  const billed = sum(orders, (o) => o.total);
  const outstanding = billed - collected;
  const pDone = prevOrders.filter((o) => o.stage === "delivered").length, pCollected = sum(prevOrders, (o) => o.paid), pBilled = sum(prevOrders, (o) => o.total);
  const dl = cmp ? "vs previous period" : undefined;

  const byStage = useMemo(() => STAGES.map((s) => ({ stage: s.label, key: s.key, orders: orders.filter((o) => o.stage === s.key).length })), [orders]);
  const byEvent = useMemo(() => Object.entries(orders.reduce<Record<string, number>>((a, o) => ((a[o.event] = (a[o.event] ?? 0) + 1), a), {})).map(([name, v], i) => ({ name, v, c: PALETTE[i % 8]! })), [orders]);
  const byDept = useMemo(() => DEPTS.map((name, i) => ({ name, v: orders.filter((o) => DEPT_OF[o.stage] === name).length, c: PALETTE[i % 8]! })), [orders]);
  const byPay = useMemo(() => (["Paid", "Partial", "Unpaid", "Overdue"] as const).map((name, i) => ({ name, v: orders.filter((o) => o.pay === name).length, c: ["#10b981", "#f59e0b", "#f43f5e", "#be123c"][i]! })), [orders]);
  const byPriority = useMemo(() => (["Low", "Normal", "High", "Urgent", "VIP"] as const).map((name, i) => ({ name, v: orders.filter((o) => o.priority === name).length, c: PALETTE[i % 8]! })), [orders]);
  const byDelivery = useMemo(() => [
    { name: "Delivered", v: orders.filter((o) => o.stage === "delivered").length, c: "#10b981" },
    { name: "Ready for delivery", v: orders.filter((o) => o.stage === "ready_for_delivery").length, c: "#3b5bf0" },
    { name: "Overdue", v: orders.filter((o) => !isDone(o) && o.due < "2026-10-03").length, c: "#f43f5e" },
    { name: "In production", v: orders.filter((o) => !isDone(o) && o.due >= "2026-10-03").length, c: "#f59e0b" },
  ], [orders]);
  const customers = useMemo(() => [...orders.reduce((m, o) => m.set(o.customer, (m.get(o.customer) ?? 0) + o.total), new Map<string, number>())].sort((a, b) => b[1] - a[1]).slice(0, 8), [orders]);
  const team = useMemo(() => STAFF.filter((s) => s.status === "Active").map((s) => {
    const first = s.name.split(" ")[0]!; const mine = orders.filter((o) => o.assignee === first);
    const late = mine.filter((o) => o.stage !== "delivered" && o.hold !== "Cancelled" && o.due < "2026-10-03").length;
    const moved = hands.filter((h) => h.by === s.name);
    const moves = AUDIT.filter((a) => a.actor === s.name && (a.action === "stage_change" || a.action === "stage_override")).length;
    return { name: s.name, role: s.role, done: mine.length, late, onTime: mine.length ? Math.round(((mine.length - late) / mine.length) * 100) : null, moves, avgMs: moved.length ? moved.reduce((a, h) => a + h.ms, 0) / moved.length : null, first };
  }), [orders, hands]);
  // Customer mix: join orders to the customer master by studio/name so VIP / Regular / New can be compared.
  const mix = useMemo(() => {
    const byName = new Map<string, { n: number; billed: number; paid: number; last: string }>();
    orders.filter((o) => o.hold !== "Cancelled").forEach((o) => { const r = byName.get(o.customer) ?? { n: 0, billed: 0, paid: 0, last: "" }; r.n++; r.billed += o.total; r.paid += o.paid; if (o.pendingAt > r.last) r.last = o.pendingAt; byName.set(o.customer, r); });
    const rows = [...byName].map(([name, r]) => { const c = CUSTOMERS.find((x) => x.studio.toLowerCase() === name.toLowerCase() || x.name.toLowerCase() === name.toLowerCase()); return { name, type: c?.type ?? "Unlinked", ...r }; }).sort((a, b) => b.billed - a.billed);
    const total = rows.reduce((a, r) => a + r.billed, 0);
    const types = ["VIP", "Regular", "New", "Unlinked"].map((t, i) => ({ name: t, v: rows.filter((r) => r.type === t).reduce((a, r) => a + r.n, 0), c: ["#f59e0b", "#3b5bf0", "#10b981", "#9aa5bd"][i]! }));
    const repeat = rows.filter((r) => r.n >= 2).length;
    return { rows, total, types, repeat, top3: total ? Math.round((rows.slice(0, 3).reduce((a, r) => a + r.billed, 0) / total) * 100) : 0 };
  }, [orders]);
  const cust = useMemo(() => filterOrders(orders, cf), [orders, cf]);
  const customRows = useMemo(() => customTable(cust, metrics.length ? metrics : ["Orders"], groupBy), [cust, metrics, groupBy]);

  const openDrill = (title: string, list: Order[]) => setDrill({ title, orders: list });
  const drillRow = (r: Row | undefined) => r && openDrill(`Orders - ${r.label}`, r.orders);
  // recharts click payloads differ by chart type; pull the active datum safely
  const fromChart = (s: unknown) => { const i = Number((s as { activeTooltipIndex?: number })?.activeTooltipIndex); return Number.isFinite(i) ? series[i] : undefined; };
  const fromBar = <T,>(d: unknown): T | undefined => ((d as { payload?: T })?.payload ?? (d as T));
  const legend = (e: { dataKey?: unknown }) => { const k = String(e.dataKey); setHidden((p) => { const c = new Set(p); if (c.has(k)) c.delete(k); else c.add(k); return c; }); };
  const lf = (v: string, e: { dataKey?: unknown }) => <span className={hidden.has(String(e.dataKey)) ? "text-slate-400 line-through" : ""}>{v}</span>;
  const trendDelta = cmp ? pct(orders.length, simulated ? Math.round(orders.length * 0.86) : prevOrders.length) : undefined;

  const csvFor = (t: Tab): (string | number)[][] => {
    const hdr: (string | number)[][] = [["Report", t], ["Range", label], cmp ? ["Compared with", `${fmtShort(toD(prevFrom))} - ${fmtShort(toD(prevTo))}${simulated ? " (simulated)" : ""}`] : [], []];
    const trendHead = ["Period", "New Orders", "Completed", "Pending", ...(cmp ? ["New (prev period)"] : [])];
    const trendRows = series.map((r) => [r.label, r.new, r.done, r.pending, ...(cmp ? [r.prevNew ?? 0] : [])]);
    const money = [["Period", "Revenue", "Collections", ...(cmp ? ["Revenue (prev)", "Collections (prev)"] : [])], ...series.map((r) => [r.label, r.revenue, r.collections, ...(cmp ? [r.prevRevenue ?? 0, r.prevCollections ?? 0] : [])])];
    switch (t) {
      case "Overview": return [...hdr, trendHead, ...trendRows, [], ...money, [], ["Department", "Orders"], ...byDept.map((d) => [d.name, d.v])];
      case "Orders": return [...hdr, ["Stage", "Orders"], ...byStage.map((r) => [r.stage, r.orders]), [], ["Event", "Orders"], ...byEvent.map((e) => [e.name, e.v]), [], trendHead, ...trendRows];
      case "Production": return [...hdr, ["Stage group", "Avg TAT (days)", "Samples", "Source"], ...tat.map((r) => [r.s, r.d, r.n, r.src])];
      case "Team Performance": return [...hdr, ["Name", "Role", "Orders assigned", "Overdue", "On-time %", "Stage moves", "Avg time before hand-off"], ...team.map((r) => [r.name, r.role, r.done, r.late, r.onTime ?? "", r.moves, r.avgMs === null ? "" : fmtDur(r.avgMs)])];
      case "Financial": return [...hdr, ...money, [], ["Payment status", "Orders"], ...byPay.map((r) => [r.name, r.v])];
      case "Delivery": return [...hdr, ["Order", "Customer", "Due", "Stage"], ...orders.filter(isDone).map((o) => [o.id, o.customer, o.due, stageLabel(o.stage)])];
      case "Customer": return [...hdr, ["Customer", "Type", "Orders", "Billed", "Outstanding"], ...mix.rows.map((r) => [r.name, r.type, r.n, r.billed, r.billed - r.paid])];
      case "Custom Report": return [...hdr, [groupBy, ...metrics], ...customRows.map((r) => [r.k, ...r.vals])];
    }
  };
  const exportCsv = () => { downloadCsv(`report-${tab.toLowerCase().replace(/\s+/g, "-")}.csv`, csvFor(tab)); show(`${tab} report exported (${label})`); };
  const printIt = () => { const t = document.title; document.title = `AlbumPro ${tab} report - ${label}`; window.print(); document.title = t; };
  const exportDrill = () => { if (!drill) return; downloadCsv("drill-orders.csv", [["Order", "Customer", "Event", "Stage", "Total", "Paid"], ...drill.orders.map((o) => [o.id, o.customer, o.event, stageLabel(o.stage), o.total, o.paid])]); show(`Exported ${drill.orders.length} orders`); };

  // ---- custom report actions ----
  const cfCount = cf.stage.length + cf.priority.length + cf.event.length + cf.pay.length;
  const logRun = (name: string, rowsN: number, m = metrics, g = groupBy, f = cf) => { const next = [{ id: `RUN${Date.now()}`, name, at: new Date().toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }), rows: rowsN, range: label, metrics: m, groupBy: g, filters: f }, ...runs].slice(0, 10); setRuns(next); lsSet("albumpro.reports.runs", next); };
  const validName = () => { if (!rname.trim()) { setNameErr("Report name is required"); return false; } setNameErr(""); return true; };
  const generate = () => { if (!validName()) return; if (!metrics.length) { show("Pick at least one metric"); return; } logRun(rname.trim(), customRows.length); show(`Ran "${rname.trim()}": ${customRows.length} rows for ${label}`); };
  const saveReport = () => {
    if (!validName()) return;
    const next = [...saved.filter((r) => r.name.toLowerCase() !== rname.trim().toLowerCase()), { id: `R${Date.now()}`, name: rname.trim(), metrics, groupBy, filters: cf }];
    setSaved(next); lsSet("albumpro.reports.saved", next); show(`Report "${rname.trim()}" saved`);
  };
  const saveSched = () => {
    const list = sf.to.split(/[,;\s]+/).filter(Boolean);
    if (!list.length) { setSErr({ to: "Add at least one recipient email" }); return; }
    if (list.some((e) => !/^\S+@\S+\.\S+$/.test(e))) { setSErr({ to: "One or more email addresses are invalid" }); return; }
    const next = [...scheds, { id: `S${Date.now()}`, name: rname.trim(), freq: sf.freq, day: sf.day, time: sf.time, to: list.join(", "), format: sf.format }];
    setScheds(next); lsSet("albumpro.reports.scheduled", next); setSchedOpen(false); setSErr({});
    show(`"${rname.trim()}" scheduled ${sf.freq.toLowerCase()} at ${sf.time} to ${list.length} recipient${list.length > 1 ? "s" : ""}`);
  };
  const loadReport = (r: { name: string; metrics: string[]; groupBy: string; filters: CFilters }) => { setMetrics(r.metrics); setGroupBy(r.groupBy); setCf(r.filters); setRname(r.name); };
  const downloadRun = (r: RunRec) => { const t = customTable(filterOrders(orders, r.filters), r.metrics, r.groupBy); downloadCsv(`${r.name.replace(/\W+/g, "-").toLowerCase()}.csv`, [[r.groupBy, ...r.metrics], ...t.map((x) => [x.k, ...x.vals])]); show(`Downloaded "${r.name}"`); };
  const cfChips = [
    ...cf.stage.map((v) => ({ label: `Stage: ${v}`, onRemove: () => setCf({ ...cf, stage: cf.stage.filter((x) => x !== v) }) })),
    ...cf.priority.map((v) => ({ label: `Priority: ${v}`, onRemove: () => setCf({ ...cf, priority: cf.priority.filter((x) => x !== v) }) })),
    ...cf.event.map((v) => ({ label: `Event: ${v}`, onRemove: () => setCf({ ...cf, event: cf.event.filter((x) => x !== v) }) })),
    ...cf.pay.map((v) => ({ label: `Payment: ${v}`, onRemove: () => setCf({ ...cf, pay: cf.pay.filter((x) => x !== v) }) })),
  ];

  const trendPanelAction = <GroupToggle value={gran} onChange={setGran} />;

  return (
    <div className="min-w-0">
      {toast}
      <PageHeader title="Reports" subtitle="Track performance, productivity and business growth">
        <DateRangePicker value={range} onChange={(r) => { setRange(r); show(`Date range set: ${r.preset === "All Time" ? "All Time" : `${fmtShort(r.from)} – ${fmtShort(r.to)}`}`); }} />
        <button onClick={() => canCompare && setCompare(!compare)} aria-pressed={cmp} disabled={!canCompare} title={canCompare ? "Compare with the previous period of equal length" : "Pick a bounded date range to compare"} className={cx("inline-flex h-10 items-center gap-2 rounded-xl border px-3.5 text-[13px] font-bold disabled:opacity-40", cmp ? "border-brand bg-brand-soft text-brand" : "border-line bg-white hover:bg-brand-soft")}><GitCompareArrows className="size-4" />Compare to previous period</button>
        <button onClick={printIt} className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-white px-3.5 text-[13px] font-bold hover:bg-brand-soft"><Printer className="size-4" />Print / PDF</button>
        <button onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand px-4 text-sm font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dark"><Download className="size-4" />Export CSV</button>
      </PageHeader>
      {cmp && <p data-testid="compare-note" className="-mt-2 mb-3 text-xs text-sub">Comparing {label} with {fmtShort(toD(prevFrom))} – {fmtShort(toD(prevTo))}{simulated ? ". No earlier orders exist in the demo data, so the previous period is simulated." : "."} Dashed series show the previous period.</p>}

      <div className="no-print mb-5 overflow-x-auto rounded-2xl border border-line bg-white px-5 pt-3"><LineTabs className="min-w-max border-b-0" tabs={TABS.map((t) => ({ key: t, label: t }))} value={tab} onChange={setTab} /></div>
      <h2 className="mb-3 hidden text-lg font-extrabold print:block">{tab} report · {label}</h2>

      {tab === "Overview" && (<>
        <KpiRow items={[
          { label: "Total Orders", value: orders.length, delta: kpi(orders.length, prevOrders.length, 0.88), deltaLabel: dl, icon: FileText, tone: "blue" },
          { label: "Completed Orders", value: done, delta: kpi(done, pDone, 0.8), deltaLabel: dl, icon: ShieldCheck, tone: "green" },
          { label: "Pending Orders", value: orders.length - done, delta: kpi(orders.length - done, prevOrders.length - pDone, 1.1), deltaLabel: dl, icon: Clock, tone: "red", invert: true },
          { label: "Revenue", value: inr(collected), delta: kpi(collected, pCollected, 0.86), deltaLabel: dl, icon: Coins, tone: "teal" },
        ]} />
        <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <Panel title={<>Orders Trend<Delta v={trendDelta} /></>} subtitle="Click a point to see the orders" action={trendPanelAction}>
            <Chart>
              <AreaChart data={series} onClick={(s) => drillRow(fromChart(s))}>
                <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3b5bf0" stopOpacity={0.25} /><stop offset="100%" stopColor="#3b5bf0" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid {...gridProps} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} allowDecimals={false} /><Tooltip /><Legend iconType="circle" verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={legend} formatter={lf} />
                <Area dataKey="new" name="New Orders" hide={hidden.has("new")} stroke="#3b5bf0" strokeWidth={2} fill="url(#g1)" />
                <Area dataKey="done" name="Completed" hide={hidden.has("done")} stroke="#10b981" strokeWidth={2} fill="none" />
                <Area dataKey="pending" name="Pending" hide={hidden.has("pending")} stroke="#ec4899" strokeWidth={2} fill="none" />
                {cmp && <Area dataKey="prevNew" name="New (prev period)" hide={hidden.has("prevNew")} stroke="#3b5bf0" strokeWidth={2} strokeDasharray="6 4" fill="none" />}
              </AreaChart>
            </Chart>
          </Panel>
          <Panel title="Orders by Department" subtitle="Click a slice"><Donut data={byDept} center="Total Orders" onSlice={(n) => openDrill(`Orders in ${n}`, orders.filter((o) => DEPT_OF[o.stage] === n))} /></Panel>
        </div>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Panel title="Revenue & Collections" subtitle="Click a bar" action={trendPanelAction}>
            <Chart h={230}>
              <BarChart data={series} onClick={(s) => drillRow(fromChart(s))}>
                <CartesianGrid {...gridProps} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} tickFormatter={(v: number) => `${Math.round(v / 1000)}K`} /><Tooltip formatter={(v) => inr(Number(v))} /><Legend iconType="square" verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12, cursor: "pointer" }} onClick={legend} formatter={lf} />
                <Bar dataKey="revenue" name="Billed" hide={hidden.has("revenue")} fill="#8b8cf0" radius={[3, 3, 0, 0]} /><Bar dataKey="collections" name="Collections" hide={hidden.has("collections")} fill="#7dc4f7" radius={[3, 3, 0, 0]} />
                {cmp && <Bar dataKey="prevRevenue" name="Billed (prev)" hide={hidden.has("prevRevenue")} fill="#8b8cf0" fillOpacity={0.08} stroke="#8b8cf0" strokeDasharray="4 3" radius={[3, 3, 0, 0]} />}
              </BarChart>
            </Chart>
          </Panel>
          <Panel title="Average Turnaround Time" subtitle="Click a stage · * = estimate, shown until the audit trail has data">
            <ul className="space-y-3 pt-2">
              {tat.map((t) => (
                <li key={t.s}><button onClick={() => openDrill(`Orders in ${t.s}`, orders.filter((o) => t.stages.includes(o.stage)))} className="grid w-full grid-cols-[96px_1fr_52px] sm:grid-cols-[110px_1fr_52px] items-center gap-3 rounded-md text-[13px] hover:bg-slate-50">
                  <span className="text-right text-sub">{t.s}</span>
                  <div className="h-2.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, (t.d / 3.2) * 100))}%`, background: t.c, opacity: t.n ? 1 : 0.45 }} /></div>
                  <b title={t.n ? `Measured from ${t.n} hand-offs in the audit trail` : "Estimate: no hand-offs recorded yet"}>{t.n ? fmtDur(t.ms) : `${t.d} d*`}</b>
                </button></li>
              ))}
            </ul>
          </Panel>
        </div>
      </>)}

      {tab === "Orders" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Orders by Stage" subtitle="Click a bar"><Chart><BarChart data={byStage} layout="vertical" margin={{ left: 40 }}><CartesianGrid horizontal={false} stroke="#e6e9f5" /><XAxis type="number" {...axis} allowDecimals={false} /><YAxis type="category" dataKey="stage" {...axis} width={110} /><Tooltip /><Bar dataKey="orders" fill="#3b5bf0" radius={[0, 4, 4, 0]} onClick={(d) => { const r = fromBar<{ stage: string; key: StageKey }>(d); if (r) openDrill(`Orders - ${r.stage}`, orders.filter((o) => o.stage === r.key)); }} /></BarChart></Chart></Panel>
          <Panel title="Orders by Event Type" subtitle="Click a slice"><Donut data={byEvent} center="Orders" onSlice={(n) => openDrill(`${n} orders`, orders.filter((o) => o.event === n))} /></Panel>
          <Panel title={<>Order Intake<Delta v={trendDelta} /></>} subtitle="Click a point" action={trendPanelAction} className="xl:col-span-2"><Chart h={220}><LineChart data={series} onClick={(s) => drillRow(fromChart(s))}><CartesianGrid {...gridProps} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} allowDecimals={false} /><Tooltip /><Legend iconType="circle" verticalAlign="top" align="right" wrapperStyle={{ fontSize: 12 }} /><Line dataKey="new" name="New Orders" stroke="#3b5bf0" strokeWidth={2} dot={{ r: 3 }} />{cmp && <Line dataKey="prevNew" name="New (prev period)" stroke="#3b5bf0" strokeWidth={2} strokeDasharray="6 4" dot={false} />}</LineChart></Chart></Panel>
        </div>
      )}

      {tab === "Production" && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Average Turnaround per Stage" subtitle="Click a bar · faded bars are estimates (no audit data yet)">
            <Chart><BarChart data={tat}><CartesianGrid {...gridProps} /><XAxis dataKey="s" {...axis} /><YAxis {...axis} unit=" d" /><Tooltip formatter={(v, _n, p) => [`${v} days (${(p?.payload as { src?: string })?.src ?? ""})`, "Avg TAT"]} /><Bar dataKey="d" name="Days" radius={[4, 4, 0, 0]} onClick={(d) => { const r = fromBar<(typeof tat)[number]>(d); if (r) openDrill(`Orders in ${r.s}`, orders.filter((o) => r.stages.includes(o.stage))); }}>{tat.map((t) => <Cell key={t.s} fill={t.c} fillOpacity={t.n ? 1 : 0.4} />)}</Bar></BarChart></Chart>
          </Panel>
          <Panel title="Stage Load vs WIP Limit" subtitle="Current orders in each stage against the Pipeline WIP limit">
            <ul className="space-y-4">{(Object.keys(WIP_CAP) as StageKey[]).map((k) => { const n = orders.filter((o) => o.stage === k && !o.hold).length; const cap = WIP_CAP[k]!; const pc = Math.round((n / cap) * 100); return <li key={k}><button onClick={() => openDrill(`Orders in ${stageLabel(k)}`, orders.filter((o) => o.stage === k))} className="block w-full text-left"><div className="mb-1 flex justify-between text-[13px]"><b>{stageLabel(k)}</b><span className="text-sub">{n} / {cap} · {pc}%</span></div><ProgressBar value={Math.min(100, pc)} tone={pc > 100 ? "red" : pc > 80 ? "amber" : "blue"} /></button></li>; })}</ul>
          </Panel>
          <Panel title="Measured Stage Hand-offs" subtitle="Computed from stage_change rows in the audit trail" className="xl:col-span-2">
            <DataTable head={["Stage group", "Avg turnaround", "Hand-offs measured", "Source"]} rows={tat.map((t) => [t.s, t.n ? fmtDur(t.ms) : `${t.d} d (est.)`, t.n, <Pill key="s" tone={t.n ? "green" : "slate"}>{t.src}</Pill>])} />
            <p className="mt-2 text-xs text-sub">{hands.length ? `${hands.length} hand-offs recorded across ${new Set(hands.map((h) => h.orderId)).size} orders.` : "No stage moves have been recorded yet. Move an order through the pipeline and measured values replace the estimates."}</p>
          </Panel>
        </div>
      )}

      {tab === "Team Performance" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
          <Panel title="Team Output" subtitle="Assigned orders from the order list · stage moves and hand-off time from the audit trail"><DataTable head={["Name", "Role", "Assigned", "Overdue", "On-time %", "Stage moves", "Avg before hand-off"]} rows={team.map((t) => [<button key="n" onClick={() => openDrill(`Orders assigned to ${t.name}`, orders.filter((o) => o.assignee === t.first))} className="font-semibold text-brand hover:underline">{t.name}</button>, t.role, t.done, t.late, t.onTime === null ? "-" : <Pill key="p" tone={t.onTime > 90 ? "green" : "amber"}>{t.onTime}%</Pill>, t.moves, t.avgMs === null ? "-" : fmtDur(t.avgMs)])} /><p className="mt-2 text-xs text-sub">On-time % = assigned orders not past their due date. Avg before hand-off = how long orders sat in a stage before this person moved them on.</p></Panel>
          <Panel title="Orders Handled" subtitle="Click a bar"><Chart><BarChart data={team} layout="vertical" margin={{ left: 30 }}><CartesianGrid horizontal={false} stroke="#e6e9f5" /><XAxis type="number" {...axis} allowDecimals={false} /><YAxis type="category" dataKey="name" {...axis} width={90} /><Tooltip /><Bar dataKey="done" name="Orders" fill="#7c5cf0" radius={[0, 4, 4, 0]} onClick={(d) => { const r = fromBar<(typeof team)[number]>(d); if (r) openDrill(`Orders assigned to ${r.name}`, orders.filter((o) => o.assignee === r.first)); }} /></BarChart></Chart></Panel>
        </div>
      )}

      {tab === "Financial" && (<>
        <KpiRow items={[
          { label: "Billed", value: inr(billed), delta: kpi(billed, pBilled, 0.84), deltaLabel: dl, icon: FileText, tone: "indigo" },
          { label: "Collected", value: inr(collected), delta: kpi(collected, pCollected, 0.86), deltaLabel: dl, icon: Coins, tone: "green" },
          { label: "Outstanding", value: inr(outstanding), delta: kpi(outstanding, pBilled - pCollected, 1.1), deltaLabel: dl, icon: Clock, tone: "amber", invert: true },
          { label: "GST Collected (18%)", value: inr(Math.round(collected * 0.18 / 1.18)), delta: kpi(collected, pCollected, 0.86), deltaLabel: dl, icon: ShieldCheck, tone: "teal" },
        ]} />
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Revenue vs Collections" subtitle="Click a bar" action={trendPanelAction}><Chart><BarChart data={series} onClick={(s) => drillRow(fromChart(s))}><CartesianGrid {...gridProps} /><XAxis dataKey="label" {...axis} /><YAxis {...axis} tickFormatter={(v: number) => `${Math.round(v / 1000)}K`} /><Tooltip formatter={(v) => inr(Number(v))} /><Legend wrapperStyle={{ cursor: "pointer" }} onClick={legend} formatter={lf} /><Bar dataKey="revenue" name="Billed" hide={hidden.has("revenue")} fill="#8b8cf0" radius={[3, 3, 0, 0]} /><Bar dataKey="collections" name="Collections" hide={hidden.has("collections")} fill="#7dc4f7" radius={[3, 3, 0, 0]} />{cmp && <Bar dataKey="prevCollections" name="Collections (prev)" hide={hidden.has("prevCollections")} fill="#7dc4f7" fillOpacity={0.08} stroke="#7dc4f7" strokeDasharray="4 3" radius={[3, 3, 0, 0]} />}</BarChart></Chart></Panel>
          <Panel title="Orders by Payment Status" subtitle="Click a slice"><Donut data={byPay} center="Orders" onSlice={(n) => openDrill(`${n} orders`, orders.filter((o) => o.pay === n))} /></Panel>
        </div>
      </>)}

      {tab === "Delivery" && (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <Panel title="Delivery Performance" subtitle="Click a slice"><Donut data={byDelivery} center="Orders" onSlice={(n) => openDrill(n, orders.filter((o) => (n === "Delivered" ? o.stage === "delivered" : n === "Ready for delivery" ? o.stage === "ready_for_delivery" : n === "Overdue" ? !isDone(o) && o.due < "2026-10-03" : !isDone(o) && o.due >= "2026-10-03")))} /></Panel>
          <Panel title="Ready for Delivery / Delivered"><DataTable head={["Order", "Customer", "Due", "Stage"]} rows={orders.filter(isDone).slice(0, 8).map((o) => [<Link key="l" to={`/orders/${o.id}`} className="text-brand hover:underline">{o.id}</Link>, o.customer, o.due, <Pill key="s" tone={o.stage === "delivered" ? "green" : "amber"}>{o.stage === "delivered" ? "Delivered" : "Ready"}</Pill>])} /></Panel>
        </div>
      )}

      {tab === "Customer" && (<>
        <KpiRow items={[
          { label: "Active customers", value: mix.rows.length, icon: FileText, tone: "blue" },
          { label: "Repeat customers", value: mix.rows.length ? `${Math.round((mix.repeat / mix.rows.length) * 100)}%` : "0%", icon: History, tone: "violet" },
          { label: "Avg order value", value: inr(orders.length ? Math.round(billed / orders.length) : 0), icon: Coins, tone: "teal" },
          { label: "Top-3 share of billing", value: `${mix.top3}%`, icon: ShieldCheck, tone: "amber" },
        ]} />
        <div className="grid gap-4 xl:grid-cols-2">
          <Panel title="Top Customers by Billing" subtitle="Click a bar"><Chart><BarChart data={mix.rows.slice(0, 8).map((r) => ({ n: r.name, v: r.billed }))} layout="vertical" margin={{ left: 50 }}><CartesianGrid horizontal={false} stroke="#e6e9f5" /><XAxis type="number" {...axis} tickFormatter={(v: number) => `${Math.round(v / 1000)}K`} /><YAxis type="category" dataKey="n" {...axis} width={120} /><Tooltip formatter={(v) => inr(Number(v))} /><Bar dataKey="v" name="Billed" fill="#3b5bf0" radius={[0, 4, 4, 0]} onClick={(d) => { const r = fromBar<{ n: string }>(d); if (r) openDrill(`Orders - ${r.n}`, orders.filter((o) => o.customer === r.n)); }} /></BarChart></Chart></Panel>
          <Panel title="Customer Mix" subtitle="Orders by customer type (matched to the Customers list)"><Donut data={mix.types} center="Orders" onSlice={(n) => openDrill(`${n} customers' orders`, orders.filter((o) => (mix.rows.find((r) => r.name === o.customer)?.type ?? "Unlinked") === n))} /></Panel>
          <Panel title="Customer Ledger" subtitle="Billing, collections and last order per customer" className="xl:col-span-2">
            <DataTable head={["Customer", "Type", "Orders", "Billed", "Outstanding", "Last order"]} rows={mix.rows.slice(0, 12).map((r) => [<button key="c" onClick={() => openDrill(`Orders - ${r.name}`, orders.filter((o) => o.customer === r.name))} className="font-semibold text-brand hover:underline">{r.name}</button>, <Pill key="t" tone={r.type === "VIP" ? "amber" : r.type === "New" ? "green" : r.type === "Regular" ? "blue" : "slate"}>{r.type}</Pill>, r.n, inr(r.billed), r.billed - r.paid > 0 ? <span key="o" className="font-semibold text-rose-600">{inr(r.billed - r.paid)}</span> : inr(0), r.last])} />
          </Panel>
          <Panel title="Orders by Priority" subtitle="Click a slice"><Donut data={byPriority} center="Orders" onSlice={(n) => openDrill(`${n} priority orders`, orders.filter((o) => o.priority === n))} /></Panel>
        </div>
      </>)}

      {tab === "Custom Report" && (<div className="space-y-4">
        <Panel title="Custom Report Builder" subtitle={`Choose metrics, grouping and filters. The preview updates live. Range: ${label}`}>
          <div className="mb-3 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div><span className="mb-1.5 block text-[13px] font-semibold">Metrics</span><MultiSelect label="Pick metrics" options={METRICS} value={metrics} onChange={setMetrics} /></div>
            <div><span className="mb-1.5 block text-[13px] font-semibold">Group by</span><Combobox options={GROUPS.map((g) => ({ value: g, label: g }))} value={groupBy} onChange={setGroupBy} /></div>
            <Field label="Report Name" required><input className={inputCls} value={rname} onChange={(e) => { setRname(e.target.value); setNameErr(""); }} />{nameErr && <span className={ERR}>{nameErr}</span>}</Field>
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2"><span className="text-[13px] font-semibold">Filters</span>
            <MultiSelect className="w-40" label="Stage" options={STAGES.map((s) => s.label)} value={cf.stage} onChange={(v) => setCf({ ...cf, stage: v })} />
            <MultiSelect className="w-36" label="Priority" options={["Low", "Normal", "High", "Urgent", "VIP"]} value={cf.priority} onChange={(v) => setCf({ ...cf, priority: v })} />
            <MultiSelect className="w-40" label="Event" options={[...new Set(ORDERS.map((o) => o.event))]} value={cf.event} onChange={(v) => setCf({ ...cf, event: v })} />
            <MultiSelect className="w-40" label="Payment" options={["Paid", "Partial", "Unpaid", "Overdue"]} value={cf.pay} onChange={(v) => setCf({ ...cf, pay: v })} />
          </div>
          <FilterChips chips={cfChips} onClearAll={() => setCf(NOF)} />
          <div className="mb-5 flex flex-wrap gap-2">
            <button onClick={generate} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-bold text-white"><Play className="size-4" />Run report</button>
            <button onClick={saveReport} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft"><Save className="size-4" />Save report</button>
            <button onClick={() => { if (!validName()) return; setSErr({}); setSchedOpen(true); }} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft"><CalendarClock className="size-4" />Schedule</button>
            <button onClick={() => { exportCsv(); if (validName()) logRun(rname.trim(), customRows.length); }} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft"><Download className="size-4" />Export CSV</button>
          </div>
          <div className="grid gap-4 xl:grid-cols-2" data-testid="custom-preview">
            <Chart h={240}><BarChart data={customRows.map((r) => ({ k: r.k, v: r.vals[0] ?? 0 }))}><CartesianGrid {...gridProps} /><XAxis dataKey="k" {...axis} /><YAxis {...axis} /><Tooltip /><Bar dataKey="v" name={metrics[0] ?? "Orders"} fill="#7c5cf0" radius={[4, 4, 0, 0]} onClick={(d) => { const r = fromBar<{ k: string }>(d); const row = r && customRows.find((x) => x.k === r.k); if (row) openDrill(`${groupBy}: ${row.k}`, row.orders); }} /></BarChart></Chart>
            <DataTable head={[groupBy, ...(metrics.length ? metrics : ["Orders"])]} rows={customRows.map((r) => [<button key="k" onClick={() => openDrill(`${groupBy}: ${r.k}`, r.orders)} className="text-brand hover:underline">{r.k}</button>, ...r.vals.map((v, i) => fmtMetric((metrics.length ? metrics : ["Orders"])[i]!, v))])} />
          </div>
          <p className="mt-2 text-xs text-sub">{cust.length} orders in range{cfCount ? ` after ${cfCount} filter${cfCount > 1 ? "s" : ""}` : ""} · {customRows.length} groups</p>
        </Panel>

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Saved reports" bodyClassName="pt-3">
            {saved.length === 0 && <p className="text-xs text-sub">None yet.</p>}
            <ul className="space-y-2">{saved.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                <span className="flex-1"><b>{r.name}</b><span className="block text-xs text-sub">{r.metrics.join(", ")} by {r.groupBy}</span></span>
                <button onClick={() => { loadReport(r); show(`Loaded "${r.name}"`); }} className="h-8 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft">Load</button>
                <button aria-label={`Delete ${r.name}`} onClick={() => { const n = saved.filter((x) => x.id !== r.id); setSaved(n); lsSet("albumpro.reports.saved", n); show(`Deleted "${r.name}"`); }} className="text-rose-600"><Trash2 className="size-4" /></button>
              </li>))}</ul>
          </Panel>
          <Panel title="Scheduled reports" bodyClassName="pt-3">
            {scheds.length === 0 && <p className="text-xs text-sub">None yet.</p>}
            <ul className="space-y-2">{scheds.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                <span className="flex-1"><b>{r.name}</b><span className="block text-xs text-sub">{r.freq}{r.freq !== "Daily" ? ` (${r.day})` : ""} at {r.time} · {r.format} · {r.to}</span></span>
                <button aria-label={`Remove schedule ${r.name}`} onClick={() => { const n = scheds.filter((x) => x.id !== r.id); setScheds(n); lsSet("albumpro.reports.scheduled", n); show(`Schedule removed for "${r.name}"`); }} className="text-rose-600"><Trash2 className="size-4" /></button>
              </li>))}</ul>
          </Panel>
          <Panel title={<span className="flex items-center gap-2"><History className="size-4 text-brand" />Run history</span>} bodyClassName="pt-3">
            {runs.length === 0 && <p className="text-xs text-sub">No runs yet. Press Run report.</p>}
            <ul className="space-y-2" data-testid="run-history">{runs.map((r) => (
              <li key={r.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                <span className="flex-1"><b>{r.name}</b><span className="block text-xs text-sub">{r.at} · {r.rows} rows · {r.range}</span></span>
                <button onClick={() => { loadReport(r); show(`Re-loaded "${r.name}"`); }} className="h-8 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft">Re-run</button>
                <button aria-label={`Download run ${r.name}`} onClick={() => downloadRun(r)} className="text-sub hover:text-brand"><Download className="size-4" /></button>
              </li>))}</ul>
          </Panel>
        </div>
      </div>)}

      <SlideOver width={520} open={!!drill} onClose={() => setDrill(null)} title={drill?.title ?? ""} footer={<>
        <button onClick={exportDrill} className="mr-auto inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft"><Download className="size-4" />Export these orders</button>
        <button onClick={() => setDrill(null)} className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white">Close</button>
      </>}>
        {drill && (<>
          <div data-testid="drill-summary" className="mb-3 flex flex-wrap gap-2 text-xs"><Pill tone="blue">{drill.orders.length} orders</Pill><Pill tone="slate">Billed {inr(sum(drill.orders, (o) => o.total))}</Pill><Pill tone="green">Collected {inr(sum(drill.orders, (o) => o.paid))}</Pill></div>
          {drill.orders.length === 0 && <p className="text-sm text-sub">No orders behind this data point in the selected range.</p>}
          <ul className="space-y-2" data-testid="drill-list">{drill.orders.map((o) => (
            <li key={o.id}><Link to={`/orders/${o.id}`} onClick={() => setDrill(null)} className="flex items-center gap-3 rounded-xl border border-line px-3.5 py-2.5 text-[13px] hover:bg-brand-soft">
              <span className="flex-1"><b>{o.id}</b> · {o.customer}<span className="block text-xs text-sub">{o.event} · {o.size} · due {o.due}</span></span>
              <Pill tone="indigo">{stageLabel(o.stage)}</Pill><b className="w-20 text-right">{inr(o.total)}</b><ExternalLink className="size-3.5 text-sub" />
            </Link></li>
          ))}</ul>
        </>)}
      </SlideOver>

      <SlideOver open={schedOpen} onClose={() => setSchedOpen(false)} title="Schedule report" footer={<>
        <button onClick={() => setSchedOpen(false)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <button onClick={saveSched} className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white">Save schedule</button>
      </>}>
        <p className="mb-4 text-sm text-sub">Email "{rname}" ({metrics.join(", ")} by {groupBy}) automatically (SRS 19.3).</p>
        <Field label="Frequency"><Combobox options={["Daily", "Weekly", "Monthly"].map((x) => ({ value: x, label: x }))} value={sf.freq} onChange={(v) => setSf({ ...sf, freq: v, day: v === "Weekly" ? "Monday" : "1st" })} /></Field>
        {sf.freq !== "Daily" && <Field label={sf.freq === "Weekly" ? "Day of week" : "Day of month"}><Combobox options={(sf.freq === "Weekly" ? ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"] : ["1st", "5th", "10th", "15th", "Last day"]).map((x) => ({ value: x, label: x }))} value={sf.day} onChange={(v) => setSf({ ...sf, day: v })} /></Field>}
        <Field label="Time"><input type="time" className={inputCls} value={sf.time} onChange={(e) => setSf({ ...sf, time: e.target.value })} /></Field>
        <Field label="Format"><Combobox options={["CSV", "PDF", "Excel"].map((x) => ({ value: x, label: x }))} value={sf.format} onChange={(v) => setSf({ ...sf, format: v })} /></Field>
        <Field label="Recipients" required hint="Comma-separated email addresses"><input className={inputCls} value={sf.to} onChange={(e) => { setSf({ ...sf, to: e.target.value }); setSErr({}); }} placeholder="owner@studio.com, accounts@studio.com" />{sErr.to && <span className={ERR}>{sErr.to}</span>}</Field>
      </SlideOver>
    </div>
  );
}
