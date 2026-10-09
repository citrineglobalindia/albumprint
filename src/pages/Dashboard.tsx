import { Link, useNavigate } from "react-router-dom";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ClipboardList, Palette, LayoutTemplate, Users, Printer, ShieldCheck, Truck, IndianRupee, FileCheck, ArrowRight,
  AlarmClock, Clock, MessageSquare, Send, PackageCheck, CheckCircle2, Plus,
} from "lucide-react";
import { Avatar, KpiRow, Panel, LinkAction, PageHeader, PrimaryButton, MoreButton, TodayChip, Pill, PriorityPill, TONE, cx, Thumb, Th, Td, trCls, tableCls, RowViewButton, ProgressBar, type Kpi } from "../components/ui";
import { ORDERS, STAGES, countByStage, stageLabel, stageTone } from "../lib/data";
import { fmtDate, inr, isOverdue } from "../lib/format";

const kpis: Kpi[] = [
  { label: "Total Orders", value: 72, delta: 12, icon: ClipboardList, tone: "blue" },
  { label: "Awaiting Colour Grading", value: 12, delta: 0, icon: Palette, tone: "orange" },
  { label: "In Designing", value: 18, delta: 28, icon: LayoutTemplate, tone: "pink" },
  { label: "Client Review Pending", value: 13, delta: -18, icon: Users, tone: "pink", invert: true },
  { label: "In Printing", value: 9, delta: 10, icon: Printer, tone: "blue" },
  { label: "QC Pending", value: 8, delta: 33, icon: ShieldCheck, tone: "green" },
  { label: "Ready for Delivery", value: 6, delta: 50, icon: Truck, tone: "teal" },
  { label: "Pending Dues", value: inr(274583), delta: 12, icon: IndianRupee, tone: "red", invert: true },
];

const trend = Array.from({ length: 30 }, (_, i) => ({
  day: `${i + 1} Oct`,
  total: Math.round(40 + 40 * Math.sin(i / 6) + (i % 5) * 3),
  production: Math.round(20 + 20 * Math.sin(i / 7 + 1) + (i % 4) * 2),
  completed: Math.round(15 + 18 * Math.sin(i / 8 + 2) + (i % 3) * 2),
}));
const revenue = Array.from({ length: 24 }, (_, i) => ({ d: i, v: 8 + ((i * 37) % 23) + (i > 17 ? 12 : 0) }));

const approvals = [
  { label: "Colour Grading Approvals", sub: "Photos awaiting admin approval", n: 8, icon: Palette, tone: "orange" as const, to: "/colour-grading" },
  { label: "Design Approvals", sub: "Album designs awaiting approval", n: 6, icon: LayoutTemplate, tone: "pink" as const, to: "/designing" },
  { label: "Client Correction Follow-ups", sub: "Client feedback pending", n: 5, icon: MessageSquare, tone: "orange" as const, to: "/pipeline" },
  { label: "Print Release Approvals", sub: "Designs ready for print approval", n: 4, icon: Printer, tone: "blue" as const, to: "/printing" },
  { label: "Overdue Jobs", sub: "Past due date and pending action", n: 7, icon: AlarmClock, tone: "red" as const, to: "/orders" },
];

const activity = [
  { t: "Design approved", d: "Wedding Album - Rahul & Priya", by: "by Admin", ago: "10 min ago", tone: "green" as const, icon: CheckCircle2 },
  { t: "Colour grading completed", d: "IDP00071 - Naveen Photography", by: "by Suresh", ago: "32 min ago", tone: "violet" as const, icon: Palette },
  { t: "New order created", d: "IDP00072 - Chidanan da", by: "Wedding - 12x36 Premium", ago: "1 hour ago", tone: "red" as const, icon: ClipboardList },
  { t: "Sent to printing", d: "IDP00068 - Photo Corner", by: "14x40 Crystal", ago: "2 hours ago", tone: "blue" as const, icon: Printer },
  { t: "QC completed", d: "IDP00066 - Chethu", by: "12x36 Premium", ago: "3 hours ago", tone: "green" as const, icon: ShieldCheck },
  { t: "Delivered", d: "IDP00064 - Arjun & Meera", by: "", ago: "4 hours ago", tone: "amber" as const, icon: Truck },
];

const alerts = [
  { t: "Orders overdue", s: "Past due date", n: 5, icon: AlarmClock, tone: "red" as const },
  { t: "Client review pending > 3 days", s: "Needs follow up", n: 7, icon: Clock, tone: "orange" as const },
  { t: "Designs waiting for approval", s: "Awaiting admin approval", n: 6, icon: LayoutTemplate, tone: "violet" as const },
  { t: "Print release pending", s: "Designs ready for print approval", n: 4, icon: Send, tone: "red" as const },
  { t: "QC pending > 2 days", s: "Awaiting quality check", n: 3, icon: ShieldCheck, tone: "green" as const },
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
  const nav = useNavigate();
  const pipeline = STAGES.map((s) => ({ ...s, count: s.key === "new_order" ? ORDERS.length : countByStage(s.key) }));
  const recent = ORDERS.slice(0, 8);
  return (
    <>
      <PageHeader title="Good Morning, Admin 👋" subtitle="Here's what's happening in your album production today.">
        <TodayChip />
        <PrimaryButton onClick={() => nav("/orders")}>New Order</PrimaryButton>
        <MoreButton />
      </PageHeader>

      <KpiRow items={kpis} cols={4} />

      <Panel className="mb-5" title="Production Pipeline" subtitle="Complete flow from order to delivery" action={<LinkAction onClick={() => nav("/pipeline")}>View All Pipeline →</LinkAction>}>
        <div className="scroll-thin flex items-center gap-1 overflow-x-auto pb-1">
          {pipeline.map((s, i) => (
            <div key={s.key} className="flex items-center gap-1">
              <Link to="/pipeline" className={cx("flex min-w-[110px] items-center gap-2.5 rounded-xl px-3 py-2.5", TONE[s.tone].soft)}>
                <span className={cx("grid size-8 place-items-center rounded-lg bg-white", TONE[s.tone].text)}><PackageCheck className="size-4" /></span>
                <span className="leading-tight"><span className="block text-[11px] font-semibold text-sub">{s.label}</span><span className="block text-base font-extrabold">{s.count}</span></span>
              </Link>
              {i < pipeline.length - 1 && <span className="text-slate-400">›</span>}
            </div>
          ))}
        </div>
      </Panel>

      <div className="mb-5 grid gap-5 xl:grid-cols-[1.35fr_1fr_1fr]">
        <Panel title="Orders Overview" action={<span className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold">Last 30 Days</span>}>
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

        <Panel title="Revenue & Collections" action={<span className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold">Last 30 Days</span>}>
          <div className="flex items-end justify-between">
            <div><div className="text-3xl font-extrabold">{inr(645000)}</div><div className="text-sm text-sub">Total Revenue</div></div>
            <div className="text-right text-xs font-bold text-emerald-600">↑ 18%<div className="font-medium text-sub">vs last month</div></div>
          </div>
          <div className="my-3 h-28">
            <ResponsiveContainer><BarChart data={revenue}><Bar dataKey="v" fill="#a5b4fc" radius={[3, 3, 0, 0]} /></BarChart></ResponsiveContainer>
          </div>
          <div className="grid grid-cols-3 gap-3 border-t border-line pt-3 text-xs">
            <div><b className="block text-sm">{inr(420000)}</b>Collected<ProgressBar value={65} tone="green" className="mt-1.5" /></div>
            <div><b className="block text-sm">{inr(225000)}</b>Pending<ProgressBar value={35} tone="red" className="mt-1.5" /></div>
            <div><b className="block text-sm">{inr(1280000)}</b>Total Order Value</div>
          </div>
        </Panel>

        <Panel title="Admin Approvals & Tasks" action={<LinkAction>View All →</LinkAction>} bodyClassName="space-y-2.5">
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
                  <tr key={o.id} className={trCls}>
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
          <Panel title="Recent Activity" action={<LinkAction>View All →</LinkAction>} bodyClassName="space-y-3">
            {activity.map((a) => (
              <div key={a.t + a.d} className="flex items-start gap-3">
                <IconTile icon={a.icon} tone={a.tone} />
                <div className="min-w-0 flex-1 text-xs leading-snug"><b className="text-[13px]">{a.t}</b><div className="text-sub">{a.d}</div><div className="text-sub">{a.by}</div></div>
                <span className="whitespace-nowrap text-[11px] text-sub">{a.ago}</span>
              </div>
            ))}
          </Panel>
          <Panel title="Workflow Alerts" action={<LinkAction>View All →</LinkAction>} bodyClassName="space-y-2.5">
            {alerts.map((a) => (
              <div key={a.t} className="flex items-center gap-3">
                <IconTile icon={a.icon} tone={a.tone} />
                <span className="flex-1 text-xs leading-tight"><b className="block text-[13px]">{a.t}</b><span className="text-sub">{a.s}</span></span>
                <span className={cx("rounded-lg px-3 py-1 text-xs font-bold", TONE[a.tone].soft, TONE[a.tone].text)}>{a.n}</span>
              </div>
            ))}
          </Panel>
          <Panel title="Today's Schedule" action={<LinkAction>View All →</LinkAction>} bodyClassName="space-y-2">
            {schedule.map(([t, d]) => (
              <div key={t} className="flex gap-3 text-xs"><span className="w-16 font-semibold text-sub">{t}</span><span>{d}</span></div>
            ))}
          </Panel>
        </div>
      </div>
    </>
  );
}
