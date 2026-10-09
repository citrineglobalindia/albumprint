import { useNavigate } from "react-router-dom";
import {
  FilePlus2, FolderOpen, IndianRupee, PackageCheck, CalendarClock, Palette, PlayCircle, Hourglass, Undo2, CheckCircle2, AlarmClock,
  LayoutTemplate, Send, MessageSquare, Lock, Printer, Cog, BookOpen, Boxes, Truck, ShieldCheck, XCircle, Wrench, Timer, FileText, Receipt, RefreshCcw, Wallet, ArrowRight,
} from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, PriorityPill, PayPill, Th, Td, trCls, tableCls, RowViewButton, LinkAction, TodayChip, PrimaryButton, Avatar, Thumb, type Kpi } from "../components/ui";
import { useAuth, ROLES, type RoleKey } from "../lib/auth";
import { ORDERS, stageLabel, stageTone, type Order, type StageKey } from "../lib/data";
import { fmtDate, inr, isOverdue, TODAY } from "../lib/format";

type Icon = typeof Palette;
interface Cfg {
  title: string; subtitle: string; cta?: { label: string; to: string };
  kpis: { label: string; icon: Icon; tone: Kpi["tone"]; fn: (o: Order) => boolean | number }[];
  queueTitle: string; queue: (o: Order) => boolean; link: string;
}
const st = (...k: StageKey[]) => (o: Order) => k.includes(o.stage);
const today = (d: string) => new Date(d).toDateString() === TODAY.toDateString();
const due = (o: Order) => isOverdue(o.due) && o.stage !== "delivered";

// KPI sets follow SRS widgets: §4.1 Reception, §8.1 Colour, §9.1 Designer, §12.1 Printing, §13.1 QC, §15 Accounts.
const CFG: Partial<Record<RoleKey, Cfg>> = {
  reception: {
    title: "Reception Desk", subtitle: "Register customers, create orders and track what is waiting on you.", cta: { label: "New Order", to: "/orders" },
    kpis: [
      { label: "New Orders Today", icon: FilePlus2, tone: "blue", fn: (o) => today(o.pendingAt) || o.stage === "new_order" },
      { label: "Files Pending", icon: FolderOpen, tone: "orange", fn: st("new_order", "files_received") },
      { label: "Payment Pending", icon: IndianRupee, tone: "red", fn: (o) => o.pay !== "Paid" },
      { label: "Ready for Pickup", icon: PackageCheck, tone: "green", fn: st("ready_for_delivery") },
      { label: "Due Today", icon: CalendarClock, tone: "amber", fn: (o) => today(o.due) },
    ],
    queueTitle: "Recent Orders", queue: () => true, link: "/orders",
  },
  colour: {
    title: "Colour Grading", subtitle: "Your grading queue — start, save drafts and submit for admin approval.", cta: { label: "Open queue", to: "/colour-grading" },
    kpis: [
      { label: "New Jobs", icon: Palette, tone: "blue", fn: st("files_received") },
      { label: "In Progress", icon: PlayCircle, tone: "violet", fn: st("colour_grading") },
      { label: "Pending Admin Approval", icon: Hourglass, tone: "pink", fn: st("admin_approval") },
      { label: "Revision Required", icon: Undo2, tone: "orange", fn: (o) => o.priority === "High" && o.stage === "colour_grading" },
      { label: "Completed", icon: CheckCircle2, tone: "green", fn: (o) => ["designing", "client_review", "final_approval"].includes(o.stage) },
      { label: "Due Today / Overdue", icon: AlarmClock, tone: "red", fn: (o) => o.stage === "colour_grading" && (today(o.due) || isOverdue(o.due)) },
    ],
    queueTitle: "My Queue", queue: st("files_received", "colour_grading", "admin_approval"), link: "/colour-grading",
  },
  designer: {
    title: "Designer Dashboard", subtitle: "Album drafts, admin corrections and client feedback in one place.", cta: { label: "Open workspace", to: "/designing" },
    kpis: [
      { label: "Awaiting Design", icon: LayoutTemplate, tone: "blue", fn: st("admin_approval") },
      { label: "Designing", icon: PlayCircle, tone: "pink", fn: st("designing") },
      { label: "Pending Admin Review", icon: Send, tone: "violet", fn: st("client_review") },
      { label: "Client Correction", icon: MessageSquare, tone: "orange", fn: (o) => o.stage === "client_review" && o.priority !== "Normal" },
      { label: "Admin Correction", icon: Undo2, tone: "red", fn: (o) => o.stage === "designing" && o.priority === "High" },
      { label: "Final Approved", icon: Lock, tone: "green", fn: st("final_approval", "printing") },
      { label: "Due Today / Overdue", icon: AlarmClock, tone: "amber", fn: (o) => o.stage === "designing" && (today(o.due) || isOverdue(o.due)) },
    ],
    queueTitle: "My Design Jobs", queue: st("admin_approval", "designing", "client_review"), link: "/designing",
  },
  printing: {
    title: "Printing Dashboard", subtitle: "Approved print jobs and production stages.", cta: { label: "Open production", to: "/printing" },
    kpis: [
      { label: "Waiting for Printing", icon: Printer, tone: "blue", fn: st("final_approval") },
      { label: "Print File Preparation", icon: FileText, tone: "violet", fn: (o) => o.stage === "final_approval" && o.priority !== "Normal" },
      { label: "Printing Started", icon: PlayCircle, tone: "teal", fn: st("printing") },
      { label: "Finishing / Binding", icon: BookOpen, tone: "orange", fn: (o) => o.stage === "printing" && o.pages > 36 },
      { label: "Packaging", icon: Boxes, tone: "amber", fn: (o) => o.stage === "printing" && o.pages <= 36 },
      { label: "Sent to QC", icon: ShieldCheck, tone: "green", fn: st("qc") },
      { label: "Delayed Jobs", icon: AlarmClock, tone: "red", fn: (o) => o.stage === "printing" && isOverdue(o.due) },
      { label: "Today Target", icon: Cog, tone: "pink", fn: () => 12 },
    ],
    queueTitle: "Print Jobs", queue: st("final_approval", "printing"), link: "/printing",
  },
  qc: {
    title: "QC Dashboard", subtitle: "Inspect finished albums and decide pass, fail or rework.", cta: { label: "Open inspections", to: "/qc" },
    kpis: [
      { label: "Awaiting QC", icon: Timer, tone: "orange", fn: st("qc") },
      { label: "QC In Progress", icon: PlayCircle, tone: "violet", fn: (o) => o.stage === "qc" && o.priority === "High" },
      { label: "Passed", icon: CheckCircle2, tone: "green", fn: st("ready_for_delivery", "delivered") },
      { label: "Failed", icon: XCircle, tone: "red", fn: () => 8 },
      { label: "Rework Pending", icon: Wrench, tone: "amber", fn: () => 6 },
      { label: "Ready for Delivery", icon: Truck, tone: "teal", fn: st("ready_for_delivery") },
      { label: "QC SLA Breached", icon: AlarmClock, tone: "pink", fn: (o) => o.stage === "qc" && isOverdue(o.due) },
    ],
    queueTitle: "Inspection Queue", queue: st("qc"), link: "/qc",
  },
  accounts: {
    title: "Accounts", subtitle: "Billing, collections, dues and invoices.", cta: { label: "Record Payment", to: "/payments" },
    kpis: [
      { label: "Invoices Pending", icon: Receipt, tone: "blue", fn: (o) => o.pay === "Unpaid" },
      { label: "Partially Paid", icon: Wallet, tone: "amber", fn: (o) => o.pay === "Partial" },
      { label: "Overdue", icon: AlarmClock, tone: "red", fn: (o) => o.pay === "Overdue" },
      { label: "Paid", icon: CheckCircle2, tone: "green", fn: (o) => o.pay === "Paid" },
      { label: "Refunds Pending", icon: RefreshCcw, tone: "violet", fn: () => 2 },
    ],
    queueTitle: "Orders with Dues", queue: (o) => o.pay !== "Paid", link: "/payments",
  },
};

export default function RoleHome() {
  const { role, user } = useAuth();
  const nav = useNavigate();
  const cfg = CFG[role!]!;
  const items: Kpi[] = cfg.kpis.map((k) => {
    const n = ORDERS.reduce((a, o) => { const r = k.fn(o); return a + (typeof r === "number" ? 0 : r ? 1 : 0); }, 0);
    const fixed = ORDERS.length > 0 ? cfg.kpis.find((x) => x === k)!.fn(ORDERS[0]!) : 0;
    return { label: k.label, value: typeof fixed === "number" ? fixed : n, icon: k.icon, tone: k.tone };
  });
  const rows = ORDERS.filter(cfg.queue).slice(0, 10);
  const money = role === "accounts";
  return (
    <>
      <PageHeader title={cfg.title} subtitle={`${cfg.subtitle} Signed in as ${user} · ${ROLES[role!].dept}.`}>
        <TodayChip />
        {cfg.cta && <PrimaryButton icon={ArrowRight} onClick={() => nav(cfg.cta!.to)}>{cfg.cta.label}</PrimaryButton>}
      </PageHeader>
      <KpiRow items={items} />
      <Panel title={cfg.queueTitle} subtitle="Orders waiting on your department" action={<LinkAction onClick={() => nav(cfg.link)}>Open module →</LinkAction>} bodyClassName="px-2 pb-2">
        <div className="scroll-thin overflow-x-auto">
          <table className={tableCls}>
            <thead><tr><Th>Order ID</Th><Th>Customer</Th><Th>Event</Th><Th>Workflow</Th><Th>Stage</Th><Th>Priority</Th><Th>Assigned</Th><Th>Due</Th>{money && <><Th>Balance</Th><Th>Payment</Th></>}<Th /></tr></thead>
            <tbody>
              {rows.map((o, i) => (
                <tr key={o.id} onClick={() => nav(role === "accounts" || role === "reception" ? `/orders/${o.id}` : cfg.link)} className={`${trCls} cursor-pointer`}>
                  <Td><span className="flex items-center gap-2"><Thumb seed={i} size={28} /><b>{o.id}</b></span></Td>
                  <Td>{o.customer}</Td><Td>{o.event}</Td><Td>{o.workflow}</Td>
                  <Td><Pill tone={stageTone(o.stage)} dot>{stageLabel(o.stage)}</Pill></Td>
                  <Td><PriorityPill p={o.priority} /></Td>
                  <Td><span className="inline-flex items-center gap-2"><Avatar name={o.assignee} size={22} />{o.assignee}</span></Td>
                  <Td className={due(o) ? "font-semibold text-rose-600" : ""}>{fmtDate(o.due)}</Td>
                  {money && <><Td>{inr(o.total - o.paid)}</Td><Td><PayPill s={o.pay} /></Td></>}
                  <Td>{role === "accounts" || role === "reception" ? <RowViewButton to={`/orders/${o.id}`} /> : <RowViewButton to={cfg.link} />}</Td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-sub">Nothing waiting — all caught up.</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
