import { useMemo, useState, type ComponentType } from "react";
import { Link } from "react-router-dom";
import {
  AlarmClockCheck, AlertOctagon, AlertTriangle, ArrowDownRight, ArrowUpRight, Boxes, CheckCircle2, ClipboardList, CreditCard, FileText, FolderOpen, Gauge, Info, LayoutTemplate, MessagesSquare, Palette, Printer,
  Receipt, Settings, ShieldCheck, Truck, UserCog, Users, Send,
} from "lucide-react";
import { Avatar, Pill, Panel, TONE, Td, Th, cx, tableCls, trCls } from "./ui";
import { AUDIT } from "../lib/audit";
import { attendanceToday, funnel, workload, type Alert, type Health, type ModuleCard } from "../lib/control";
import { stageTone } from "../lib/data";

const ICONS: Record<string, ComponentType<{ className?: string }>> = {
  orders: ClipboardList, customers: Users, grading: Palette, designing: LayoutTemplate, proofs: Send, printing: Printer, qc: ShieldCheck, delivery: Truck, finance: CreditCard, costing: Receipt,
  files: FolderOpen, attendance: AlarmClockCheck, access: UserCog, messaging: MessagesSquare, system: Settings,
};
const HEALTH: Record<Health, { label: string; dot: string; ring: string; text: string; soft: string }> = {
  ok: { label: "Healthy", dot: "bg-emerald-500", ring: "border-line", text: "text-emerald-700", soft: "bg-emerald-50" },
  attention: { label: "Needs attention", dot: "bg-amber-400", ring: "border-amber-300", text: "text-amber-700", soft: "bg-amber-50" },
  critical: { label: "Critical", dot: "bg-rose-500", ring: "border-rose-300", text: "text-rose-700", soft: "bg-rose-50" },
};
const SEV_ICON = { crit: AlertOctagon, warn: AlertTriangle, info: Info } as const;
const SEV_CLS = { crit: "text-rose-600", warn: "text-amber-600", info: "text-sub" } as const;

/** A tiny trend line with a filled area. */
export function Sparkline({ values, tone = "#3f4fe0", h = 36, w = 120 }: { values: number[]; tone?: string; h?: number; w?: number }) {
  const max = Math.max(1, ...values), step = w / Math.max(1, values.length - 1);
  const pts = values.map((v, i) => `${(i * step).toFixed(1)},${(h - 3 - (v / max) * (h - 8)).toFixed(1)}`);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width={w} height={h} className="overflow-visible" aria-hidden>
      <polygon points={`0,${h} ${pts.join(" ")} ${w},${h}`} fill={tone} opacity={0.12} />
      <polyline points={pts.join(" ")} fill="none" stroke={tone} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      {values.length > 0 && <circle cx={(values.length - 1) * step} cy={h - 3 - ((values.at(-1) ?? 0) / max) * (h - 8)} r={3} fill={tone} />}
    </svg>
  );
}

/** Overall health ring + the two counts that drive it. */
export function HealthSummary({ score, label, tone, crit, warn }: { score: number; label: string; tone: "green" | "amber" | "red"; crit: number; warn: number }) {
  const R = 38, C = 2 * Math.PI * R, stroke = tone === "green" ? "stroke-emerald-500" : tone === "amber" ? "stroke-amber-400" : "stroke-rose-500";
  return (
    <div className="flex items-center gap-4 rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(20,30,90,0.04)]" data-testid="health-summary">
      <div className="relative size-24 shrink-0">
        <svg viewBox="0 0 96 96" className="size-full -rotate-90" aria-hidden>
          <circle cx="48" cy="48" r={R} fill="none" strokeWidth="9" className="stroke-slate-100" />
          <circle cx="48" cy="48" r={R} fill="none" strokeWidth="9" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - score / 100)} className={cx("transition-[stroke-dashoffset] duration-700", stroke)} />
        </svg>
        <div className="absolute inset-0 grid place-content-center text-center"><div className="text-2xl font-extrabold leading-none" data-testid="health-score">{score}</div><div className="text-[10px] font-semibold text-sub">/ 100</div></div>
      </div>
      <div>
        <div className="text-xs font-semibold text-sub">Business health</div>
        <div className={cx("text-xl font-extrabold", tone === "green" ? "text-emerald-700" : tone === "amber" ? "text-amber-700" : "text-rose-700")}>{label}</div>
        <div className="mt-1 text-xs text-sub"><b className="text-rose-600">{crit}</b> critical · <b className="text-amber-600">{warn}</b> to watch</div>
      </div>
    </div>
  );
}

/** What needs the admin's attention right now, across every module, worst first. */
export function AlertsPanel({ alerts }: { alerts: Alert[] }) {
  return (
    <Panel title="Needs your attention" subtitle={alerts.length ? `${alerts.length} item${alerts.length === 1 ? "" : "s"} across all modules, most urgent first` : "Everything is running smoothly"} bodyClassName="p-0">
      <ul className="max-h-[380px] divide-y divide-line overflow-y-auto scroll-thin" data-testid="alerts">
        {alerts.map((a, i) => {
          const Icon = SEV_ICON[a.severity];
          return (
            <li key={`${a.moduleKey}${i}`}>
              <Link to={a.to} className="flex items-center gap-3 px-5 py-3 hover:bg-brand-soft/50">
                <Icon className={cx("size-5 shrink-0", SEV_CLS[a.severity])} aria-hidden />
                <div className="min-w-0 flex-1"><div className="truncate text-[13px] font-semibold">{a.text}</div><div className="text-[11px] text-sub">{a.module}</div></div>
                <Pill tone={a.severity === "crit" ? "red" : "amber"}>{a.severity === "crit" ? "Critical" : "Watch"}</Pill>
              </Link>
            </li>
          );
        })}
        {!alerts.length && <li className="flex items-center gap-2 px-5 py-10 text-sm text-sub"><CheckCircle2 className="size-5 text-emerald-500" />No critical or watch items right now.</li>}
      </ul>
    </Panel>
  );
}

/** One card per module with its health, key numbers and the issues behind the colour. */
export function ModuleBoard({ cards }: { cards: ModuleCard[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="module-board">
      {cards.map((c) => {
        const Icon = ICONS[c.key] ?? Boxes, h = HEALTH[c.health];
        return (
          <section key={c.key} aria-label={`${c.label} health`} data-health={c.health} data-testid={`module-${c.key}`} className={cx("flex flex-col rounded-2xl border bg-white p-4 shadow-[0_1px_2px_rgba(20,30,90,0.04)]", h.ring)}>
            <div className="flex items-center gap-3">
              <span className={cx("grid size-10 place-items-center rounded-xl", h.soft, h.text)}><Icon className="size-5" aria-hidden /></span>
              <div className="min-w-0 flex-1"><h3 className="truncate text-sm font-extrabold">{c.label}</h3></div>
              <span className={cx("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold", h.soft, h.text)}><i className={cx("size-1.5 rounded-full", h.dot)} />{h.label}</span>
            </div>
            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3">
              {c.metrics.map((m) => <div key={m.label} className="min-w-0"><dd className="truncate text-base font-extrabold leading-tight">{m.value}</dd><dt className="truncate text-[11px] text-sub">{m.label}</dt></div>)}
            </dl>
            <ul className="mt-3 flex-1 space-y-1.5">
              {c.issues.slice(0, 3).map((i, k) => { const SI = SEV_ICON[i.severity]; return (
                <li key={k}><Link to={i.to} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-xs hover:bg-brand-soft/60"><SI className={cx("mt-0.5 size-3.5 shrink-0", SEV_CLS[i.severity])} aria-hidden /><span>{i.text}</span></Link></li>
              ); })}
              {!c.issues.length && <li className="flex items-center gap-2 px-2 py-1.5 text-xs text-sub"><CheckCircle2 className="size-3.5 text-emerald-500" />{c.note ?? "Nothing to flag."}</li>}
              {c.issues.length > 3 && <li className="px-2 text-[11px] text-sub">+{c.issues.length - 3} more</li>}
            </ul>
            <Link to={c.to} className="mt-3 inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline">Open {c.label.toLowerCase()} →</Link>
          </section>
        );
      })}
    </div>
  );
}

/** Seven-day trends with a comparison against the seven days before. */
export function TrendCards({ s }: { s: { received: number[]; delivered: number[]; collected: number[] } }) {
  const tot = (a: number[], from: number, to: number) => a.slice(from, to).reduce((x, y) => x + y, 0);
  const items = [
    { key: "received", label: "Orders received", values: s.received, color: "#3f4fe0", fmt: (n: number) => String(n) },
    { key: "delivered", label: "Orders delivered", values: s.delivered, color: "#10b981", fmt: (n: number) => String(n) },
    { key: "collected", label: "Money collected", values: s.collected, color: "#f59e0b", fmt: (n: number) => `₹${n.toLocaleString("en-IN")}` },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3" data-testid="trends">
      {items.map((it) => {
        const now = tot(it.values, 7, 14), prev = tot(it.values, 0, 7), pct = prev === 0 ? (now > 0 ? 100 : 0) : Math.round(((now - prev) / prev) * 100), up = pct >= 0;
        return (
          <div key={it.key} className="rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(20,30,90,0.04)]">
            <div className="text-xs font-semibold text-sub">{it.label} · last 7 days</div>
            <div className="mt-1 flex items-end justify-between gap-2">
              <div><div className="text-2xl font-extrabold leading-tight" data-testid={`trend-${it.key}`}>{it.fmt(now)}</div>
                <div className={cx("flex items-center gap-1 text-xs font-bold", up ? "text-emerald-700" : "text-rose-600")}>{up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}{Math.abs(pct)}% <span className="font-medium text-sub">vs previous 7 days</span></div></div>
              <Sparkline values={it.values} tone={it.color} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** How many live orders sit at each stage. */
export function PipelineFunnel() {
  const rows = funnel(), max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Panel title="Pipeline" subtitle="Live orders at each stage">
      <ul className="space-y-1.5" data-testid="funnel">
        {rows.map((r) => (
          <li key={r.key}><Link to={`/orders?stage=${r.key}`} className="group flex items-center gap-3 rounded-lg px-1 py-0.5 hover:bg-brand-soft/60">
            <span className="w-36 shrink-0 truncate text-xs font-semibold">{r.label}</span>
            <span className="h-3 flex-1 overflow-hidden rounded-full bg-slate-100"><span className={cx("block h-full rounded-full transition-[width] duration-700", TONE[stageTone(r.key)].solid)} style={{ width: `${(r.n / max) * 100}%` }} /></span>
            <span className="w-8 text-right text-xs font-extrabold tabular-nums">{r.n}</span>
          </Link></li>
        ))}
      </ul>
    </Panel>
  );
}

/** Open jobs per person, with their SLA trouble and whether they are in today. */
export function WorkloadPanel() {
  const rows = useMemo(() => workload(), []);                  // eslint-disable-line react-hooks/exhaustive-deps
  const att = attendanceToday();
  const status = (name: string) => att.rows.find((r) => r.emp.name.toLowerCase().startsWith(name.toLowerCase()) || name.toLowerCase().startsWith(r.emp.name.split(" ")[0]!.toLowerCase()))?.today.status;
  const tone = (s?: string) => (s === "Working" || s === "On break" || s === "Present" || s === "Late" ? "green" : s === "Leave" || s === "Half-day leave" ? "violet" : s === "Absent" ? "red" : "slate") as "green" | "violet" | "red" | "slate";
  return (
    <Panel title="Workload by person" subtitle="Open orders per assignee, with SLA trouble and today's attendance" bodyClassName="p-0">
      <div className="overflow-x-auto"><table className={tableCls} data-testid="workload">
        <thead className="bg-slate-50"><tr><Th>Person</Th><Th className="text-right">Open</Th><Th className="text-right">Overdue</Th><Th className="text-right">At risk</Th><Th className="text-right">Breached</Th><Th className="text-right">VIP / Urgent</Th><Th>Today</Th></tr></thead>
        <tbody>
          {rows.map((w) => { const st = status(w.name); return (
            <tr key={w.name} className={trCls}>
              <Td><span className="flex items-center gap-2 font-semibold"><Avatar name={w.name} size={26} />{w.name}</span></Td>
              <Td className="text-right font-bold tabular-nums">{w.open}</Td>
              <Td className={cx("text-right tabular-nums", w.overdue && "font-bold text-rose-600")}>{w.overdue}</Td>
              <Td className={cx("text-right tabular-nums", w.risk && "font-bold text-amber-600")}>{w.risk}</Td>
              <Td className={cx("text-right tabular-nums", w.breached && "font-bold text-rose-600")}>{w.breached}</Td>
              <Td className="text-right tabular-nums">{w.urgent}</Td>
              <Td>{st ? <Pill tone={tone(st)}>{st}</Pill> : <span className="text-xs text-sub">—</span>}</Td>
            </tr>); })}
          {!rows.length && <tr><td colSpan={7} className="p-8 text-center text-sm text-sub">No assigned open orders.</td></tr>}
        </tbody>
      </table></div>
    </Panel>
  );
}

/** The live audit trail: everything that changed, newest first. */
export function ActivityFeed() {
  const [f, setF] = useState<"all" | "overrides" | "escalations">("all");
  const rows = AUDIT.filter((a) => (f === "all" ? true : f === "overrides" ? !!a.override || /override/i.test(a.action) : /escalate|nudge/.test(a.action))).slice(0, 40);
  return (
    <Panel title="Live activity" subtitle="Every recorded action, newest first" bodyClassName="p-0"
      action={<div role="group" aria-label="Activity filter" className="flex gap-1">{(["all", "overrides", "escalations"] as const).map((k) => <button key={k} aria-pressed={f === k} onClick={() => setF(k)} className={cx("h-8 rounded-lg px-3 text-xs font-bold capitalize", f === k ? "bg-brand text-white" : "border border-line hover:bg-brand-soft")}>{k}</button>)}</div>}>
      <ul className="max-h-[420px] divide-y divide-line overflow-y-auto scroll-thin" data-testid="activity">
        {rows.map((a, i) => (
          <li key={`${a.id}-${i}`} className="flex items-start gap-3 px-5 py-2.5">
            <FileText className="mt-0.5 size-4 shrink-0 text-sub" aria-hidden />
            <div className="min-w-0 flex-1 text-[13px]"><span className="font-bold">{a.actor}</span> <span className="text-sub">{a.action.replace(/_/g, " ")}</span> <b>{a.entity}</b> <span className="font-semibold text-brand">{a.entityId}</span>{(a.from || a.to) && <span className="text-sub"> · {a.from ?? "—"} → {a.to ?? "—"}</span>}{a.reason && <div className="truncate text-xs text-sub">{a.reason}</div>}</div>
            {a.override && <Pill tone="red">Override</Pill>}
            <time className="shrink-0 text-[11px] tabular-nums text-sub" dateTime={a.at}>{new Date(a.at).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}</time>
          </li>
        ))}
        {!rows.length && <li className="p-10 text-center text-sm text-sub">Nothing recorded yet.</li>}
      </ul>
    </Panel>
  );
}

export const GaugeIcon = Gauge;
