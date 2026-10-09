import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ClipboardList, Palette, LayoutTemplate, Users, Printer, ShieldCheck, Truck, IndianRupee, FileCheck, ArrowRight,
  AlarmClock, Clock, MessageSquare, Send, PackageCheck, CheckCircle2, Plus,
} from "lucide-react";
import { Avatar, KpiRow, Panel, LinkAction, PageHeader, PrimaryButton, MoreButton, KpiCard, TodayChip, Pill, PriorityPill, TONE, cx, Thumb, Th, Td, trCls, tableCls, RowViewButton, ProgressBar, type Kpi } from "../components/ui";
import { ORDERS, STAGES, countByStage, stageLabel, stageTone, type StageKey } from "../lib/data";
import { DateRangePicker, presetRange, inRange, type DateRange } from "../components/controls";
import { useNewOrder } from "../components/NewOrderWizard";
import { useStore } from "../lib/store";
import { fmtDate, inr, isOverdue } from "../lib/format";

const DAY = 86400000;
const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
const stageQ = (...k: StageKey[]) => `/orders?stage=${k.join(",")}`;

const activity = [
  { t: "Design approved", d: "Wedding Album - Rahul & Priya", by: "by Admin", ago: "10 min ago", tone: "green" as const, icon: CheckCircle2 },
  { t: "Colour grading completed", d: "IDP00071 - Naveen Photography", by: "by Suresh", ago: "32 min ago", tone: "violet" as const, icon: Palette },
  { t: "Sent to printing", d: "IDP00068 - Photo Corner", by: "14x40 Crystal", ago: "2 hours ago", tone: "blue" as const, icon: Printer },
  { t: "QC completed", d: "IDP00066 - Chethu", by: "12x36 Premium", ago: "3 hours ago", tone: "green" as const, icon: ShieldCheck },
  { t: "Delivered", d: "IDP00064 - Arjun & Meera", by: "", ago: "4 hours ago", tone: "amber" as const, icon: Truck },
];

const schedule = [
  ["10:00 AM", "Admin review - Colour grading (5 jobs)"],
  ["12:00 PM", "Client follow-up calls (3 pending)"],
  ["02:00 PM", "Approve designs for printing (4 jobs)"],
  ["04:00 PM", "QC reports review"],
  ["05:30 PM", "Team meeting - Production status"],
];

function IconTile({ icon: Icon, tone }: { icon: typeof Palette; tone: keyof typeof TONE }) {
  return <span className={cx("grid size-10 shrink-0 place-items-center rounded-xl", TONE[tone].soft, TONE[tone].text)}><Icon className="size-5" /></span>;
}

export default function Dashboard() {
  useStore();
  const nav = useNavigate();
  const newOrder = useNewOrder();
  const [range, setRange] = useState<DateRange>(() => presetRange("Last 30 Days"));
  const [rrange, setRrange] = useState<DateRange>(() => presetRange("Last 30 Days"));
  const c = (...k: StageKey[]) => ORDERS.filter((o) => k.includes(o.stage)).length;
  const late = ORDERS.filter((o) => o.stage !== "delivered" && !o.hold && isOverdue(o.due));
  const dues = ORDERS.reduce((a, o) => a + (o.hold === "Cancelled" ? 0 : o.total - o.paid), 0);
  const kpis: (Kpi & { to: string })[] = [
    { label: "Total Orders", value: ORDERS.length, delta: 12, icon: ClipboardList, tone: "blue", to: "/orders" },
    { label: "Awaiting Colour Grading", value: c("files_received", "colour_grading"), delta: 0, icon: Palette, tone: "orange", to: stageQ("files_received", "colour_grading") },
    { label: "In Designing", value: c("designing"), delta: 28, icon: LayoutTemplate, tone: "pink", to: stageQ("designing") },
    { label: "Client Review Pending", value: c("client_review"), delta: -18, icon: Users, tone: "pink", invert: true, to: stageQ("client_review") },
    { label: "In Printing", value: c("printing"), delta: 10, icon: Printer, tone: "blue", to: stageQ("printing") },
    { label: "QC Pending", value: c("qc"), delta: 33, icon: ShieldCheck, tone: "green", to: stageQ("qc") },
    { label: "Ready for Delivery", value: c("ready_for_delivery"), delta: 50, icon: Truck, tone: "teal", to: stageQ("ready_for_delivery") },
    { label: "Pending Dues", value: inr(dues), delta: 12, icon: IndianRupee, tone: "red", invert: true, to: "/orders?pay=Unpaid,Partial,Overdue" },
  ];
  const approvals = [
    { label: "Colour Grading Approvals", sub: "Photos awaiting admin approval", n: c("admin_approval"), icon: Palette, tone: "orange" as const, to: "/colour-grading" },
    { label: "Design Approvals", sub: "Album designs awaiting approval", n: c("designing"), icon: LayoutTemplate, tone: "pink" as const, to: "/designing" },
    { label: "Client Correction Follow-ups", sub: "Client feedback pending", n: ORDERS.filter((o) => o.stage === "client_review" && o.priority !== "Normal").length, icon: MessageSquare, tone: "orange" as const, to: stageQ("client_review") },
    { label: "Print Release Approvals", sub: "Designs ready for print approval", n: c("final_approval"), icon: Printer, tone: "blue" as const, to: "/printing" },
    { label: "Overdue Jobs", sub: "Past due date and pending action", n: late.length, icon: AlarmClock, tone: "red" as const, to: "/orders?overdue=1" },
  ];
  const alerts = [
    { t: "Orders overdue", s: "Past due date", n: late.length, icon: AlarmClock, tone: "red" as const, to: "/orders?overdue=1" },
    { t: "Client review pending", s: "Needs follow up", n: c("client_review"), icon: Clock, tone: "orange" as const, to: stageQ("client_review") },
    { t: "Designs in progress", s: "Awaiting designer", n: c("designing"), icon: LayoutTemplate, tone: "violet" as const, to: "/designing" },
    { t: "Print release pending", s: "Designs ready for print approval", n: c("final_approval"), icon: Send, tone: "red" as const, to: "/printing" },
    { t: "QC pending", s: "Awaiting quality check", n: c("qc"), icon: ShieldCheck, tone: "green" as const, to: "/qc" },
  ];
  const pipeline = STAGES.map((s) => ({ ...s, count: countByStage(s.key) }));
  const recent = ORDERS.slice(0, 8);
  const latest = ORDERS[0];

  // Orders overview: cumulative orders by day across the chosen range, derived from ORDERS.
  const trend = (() => {
    const ts = ORDERS.map((o) => new Date(o.pendingAt).getTime());
    const end = range.to ? range.to.getTime() : Math.max(...ts);
    const start = range.from ? range.from.getTime() : Math.min(...ts);
    const span = Math.max(1, Math.min(90, Math.round((end - start) / DAY) + 1));
    return Array.from({ length: span }, (_, i) => {
      const iso = isoDay(end - (span - 1 - i) * DAY); const upto = ORDERS.filter((o) => o.pendingAt <= iso);
      return { day: new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }), total: upto.length, production: upto.filter((o) => !["new_order", "delivered"].includes(o.stage)).length, completed: upto.filter((o) => o.stage === "delivered").length };
    });
  })();
  const inR = ORDERS.filter((o) => o.hold !== "Cancelled" && inRange(o.pendingAt, rrange));
  const revTotal = inR.reduce((a, o) => a + o.total, 0);
  const revPaid = inR.reduce((a, o) => a + o.paid, 0);
  const revenue = (() => {
    const days = Array.from(new Set(inR.map((o) => o.pendingAt).sort())).slice(-24);
    return days.map((d, i) => ({ d: i, label: d, v: Math.round(inR.filter((o) => o.pendingAt === d).reduce((a, o) => a + o.total, 0) / 1000) }));
  })();
  return (
    <>
      <PageHeader title="Good Morning, Admin 👋" subtitle="Here's what's happening in your album production today.">
        <TodayChip />
        <PrimaryButton onClick={() => newOrder.open()}>New Order</PrimaryButton>
        <MoreButton />
      </PageHeader>

      <div className="mb-5 grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {kpis.map((k) => <button key={k.label} data-kpi={k.label} onClick={() => nav(k.to)} className="rounded-2xl text-left transition hover:-translate-y-0.5 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"><KpiCard k={k} /></button>)}
      </div>

      <Panel className="mb-5" title="Production Pipeline" subtitle="Complete flow from order to delivery" action={<LinkAction onClick={() => nav("/pipeline")}>View All Pipeline →</LinkAction>}>
        <div className="scroll-thin flex items-center gap-1 overflow-x-auto pb-1">
          {pipeline.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1">
              <Link to={`/orders?stage=${s.key}`} data-stage-tile={s.key} className={cx("flex min-w-[110px] items-center gap-2.5 rounded-xl px-3 py-2.5", TONE[s.tone].soft)}>
                <span className={cx("grid size-8 place-items-center rounded-lg bg-white", TONE[s.tone].text)}><PackageCheck className="size-4" /></span>
                <span className="leading-tight"><span className="block text-[11px] font-semibold text-sub">{s.label}</span><span className="block text-base font-extrabold">{s.count}</span></span>
              </Link>
              {i < pipeline.length - 1 && <span className="text-slate-400">›</span>}
            </div>
          ))}
        </div>
      </Panel>

      <div className="mb-5 grid gap-5 xl:grid-cols-[1.35fr_1fr_1fr]">
        <Panel title="Orders Overview" action={<DateRangePicker value={range} onChange={setRange} />}>
          <div className="mb-2 flex gap-5 text-xs font-semibold">
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-blue-500" />Total Orders</span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-emerald-500" />Completed</span>
            <span className="flex items-center gap-1.5"><i className="size-2.5 rounded-full bg-violet-500" />In Production</span>
          </div>
          <div className="h-60">
            <ResponsiveContainer>
              <AreaChart data={trend} margin={{ left: -20, right: 8 }}>
                <defs><linearGradient id="g1" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#3f4fe0" stopOpacity={0.25} /><stop offset="100%" stopColor="#3f4fe0" stopOpacity={0} /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="#e6e9f5" />
                <XAxis dataKey="day" tickLine={false} axisLine={false} fontSize={11} interval={4} />
                <YAxis tickLine={false} axisLine={false} fontSize={11} domain={[0, "auto"]} />
                <Tooltip />
                <Area dataKey="total" name="Total Orders" stroke="#3f4fe0" strokeWidth={2} fill="url(#g1)" />
                <Area dataKey="completed" name="Completed" stroke="#10b981" strokeWidth={2} fill="none" />
                <Area dataKey="production" name="In Production" stroke="#8b5cf6" strokeWidth={2} fill="none" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Panel>

        <Panel title="Revenue & Collections" action={<DateRangePicker value={rrange} onChange={setRrange} />}>
          <div className="flex items-end justify-between">
            <div><div className="text-3xl font-extrabold">{inr(revTotal)}</div><div className="text-sm text-sub">Total Revenue</div></div>
            <div className="text-right text-xs font-bold text-emerald-600">{inR.length} orders<div className="font-medium text-sub">{rrange.preset}</div></div>
          </div>
          <div className="my-3 h-28">
            <ResponsiveContainer><BarChart data={revenue}><Tooltip formatter={(v) => [`₹${v}K`, "Order value"]} labelFormatter={(_, p) => p?.[0]?.payload?.label ?? ""} /><Bar dataKey="v" fill="#a5b4fc" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-line pt-3 text-xs">
            <div><b className="block text-sm">{inr(revPaid)}</b>Collected<ProgressBar value={revTotal ? Math.round((revPaid / revTotal) * 100) : 0} tone="green" className="mt-1.5" /></div>
            <div><b className="block text-sm">{inr(revTotal - revPaid)}</b>Pending<ProgressBar value={revTotal ? Math.round(((revTotal - revPaid) / revTotal) * 100) : 0} tone="red" className="mt-1.5" /></div>
            <div><b className="block text-sm">{inr(inR.length ? Math.round(revTotal / inR.length) : 0)}</b>Avg. Order Value ({inR.length} orders)</div>
          </div>
        </Panel>

        <Panel title="Admin Approvals & Tasks" action={<LinkAction onClick={() => nav("/colour-grading")}>View All →</LinkAction>} bodyClassName="space-y-2.5">
          {approvals.map((a) => (
            <Link key={a.label} to={a.to} className="flex items-center gap-3 rounded-xl border border-line p-2.5 hover:bg-brand-soft/60">
              <IconTile icon={a.icon} tone={a.tone} />
              <span className="min-w-0 flex-1 leading-tight"><b className="block truncate text-[13px]">{a.label}</b><span className="text-[11px] text-sub">{a.sub}</span></span>
              <span className="grid size-7 place-items-center rounded-full bg-slate-100 text-xs font-bold">{a.n}</span>
            </Link>
          ))}
        </Panel>
      </div>

      <div className="grid gap-5 xl:grid-cols-[1fr_340px]">
        <Panel title="Recent Orders" subtitle="Latest orders across all workflows" action={<LinkAction onClick={() => nav("/orders")}>View All Orders →</LinkAction>} bodyClassName="px-2 pb-2">
          <div className="scroll-thin overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><Th>Order ID</Th><Th>Customer</Th><Th>Event</Th><Th>Workflow Type</Th><Th>Album Size</Th><Th>Current Stage</Th><Th>Priority</Th><Th>Assigned To</Th><Th>Due Date</Th><Th>Actions</Th></tr></thead>
              <tbody>
                {recent.map((o, i) => (
                  <tr key={o.id} data-recent={o.id} className={trCls}>
                    <Td><span className="flex items-center gap-2"><Thumb seed={i} size={30} /><b>{o.id}</b></span></Td>
                    <Td>{o.customer}</Td><Td>{o.event}</Td><Td>{o.workflow}</Td><Td>{o.size}</Td>
                    <Td><Pill tone={stageTone(o.stage)} dot>{stageLabel(o.stage)}</Pill></Td>
                    <Td><PriorityPill p={o.priority} /></Td>
                    <Td>{o.assignee}</Td>
                    <Td className={isOverdue(o.due) ? "font-semibold text-rose-600" : ""}>{fmtDate(o.due)}</Td>
                    <Td><RowViewButton to={`/orders/${o.id}`} /></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel title="Recent Activity" action={<LinkAction onClick={() => nav("/notifications")}>View All →</LinkAction>} bodyClassName="space-y-3">
            {latest && (
              <Link to={`/orders/${latest.id}`} className="flex items-start gap-3 rounded-lg hover:bg-brand-soft/60">
                <IconTile icon={ClipboardList} tone="red" />
                <div className="min-w-0 flex-1 text-xs leading-snug"><b className="text-[13px]">New order created</b><div className="text-sub">{latest.id} - {latest.customer}</div><div className="text-sub">{latest.event} - {latest.size}</div></div>
                <span className="whitespace-nowrap text-[11px] text-sub">latest</span>
              </Link>
            )}
            {activity.map((a) => (
              <Link key={a.t + a.d} to={/^IDP\d+/.test(a.d.split(" ")[0]!) ? `/orders/${a.d.split(" ")[0]}` : "/orders"} className="flex items-start gap-3 rounded-lg hover:bg-brand-soft/60">
                <IconTile icon={a.icon} tone={a.tone} />
                <div className="min-w-0 flex-1 text-xs leading-snug"><b className="text-[13px]">{a.t}</b><div className="text-sub">{a.d}</div><div className="text-sub">{a.by}</div></div>
                <span className="whitespace-nowrap text-[11px] text-sub">{a.ago}</span>
              </Link>
            ))}
          </Panel>
          <Panel title="Workflow Alerts" action={<LinkAction onClick={() => nav("/orders")}>View All →</LinkAction>} bodyClassName="space-y-2.5">
            {alerts.map((a) => (
              <Link key={a.t} to={a.to} className="flex items-center gap-3 rounded-lg hover:bg-brand-soft/60">
                <IconTile icon={a.icon} tone={a.tone} />
                <span className="flex-1 text-xs leading-tight"><b className="block text-[13px]">{a.t}</b><span className="text-sub">{a.s}</span></span>
                <span className={cx("rounded-lg px-3 py-1 text-xs font-bold", TONE[a.tone].soft, TONE[a.tone].text)}>{a.n}</span>
              </Link>
            ))}
          </Panel>
          <Panel title="Today's Schedule" action={<LinkAction onClick={() => nav("/notifications")}>View All →</LinkAction>} bodyClassName="space-y-2">
            {schedule.map(([t, d]) => (
              <Link key={t} to={d.includes("Colour") ? "/colour-grading" : d.includes("QC") ? "/qc" : d.includes("follow-up") ? "/customers" : d.includes("printing") ? "/printing" : "/pipeline"} className="flex gap-3 rounded-lg text-xs hover:bg-brand-soft/60"><span className="w-16 font-semibold text-sub">{t}</span><span>{d}</span></Link>
            ))}
          </Panel>
        </div>
      </div>
    </>
  );
}
