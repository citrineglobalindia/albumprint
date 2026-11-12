import { useNavigate } from "react-router-dom";
import { useNewOrder } from "../components/NewOrderWizard";
import { useStore } from "../lib/store";
import {
  FilePlus2, FolderOpen, IndianRupee, PackageCheck, CalendarClock, Palette, PlayCircle, Hourglass, Undo2, CheckCircle2, AlarmClock,
  LayoutTemplate, Send, Lock, Printer, Boxes, Truck, ShieldCheck, Wrench, Timer, Receipt, Wallet, ArrowRight,
} from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, PriorityPill, PayPill, Th, Td, trCls, tableCls, RowViewButton, LinkAction, TodayChip, PrimaryButton, Avatar, Thumb, type Kpi } from "../components/ui";
import { useAuth, ROLES, type RoleKey } from "../lib/auth";
import { ORDERS, STAGES, stageLabel, stageTone, type Order, type StageKey } from "../lib/data";
import { GJOBS } from "../lib/production";
import { djob } from "../lib/designJobs";
import { PROGRESS } from "../lib/jobProgress";
import { ALBUM_LABS } from "../lib/labs";
import { fmtDate, inr, isOverdue, TODAY } from "../lib/format";

type Icon = typeof Palette;
interface Cfg {
  title: string; subtitle: string; cta?: { label: string; to: string };
  kpis: { label: string; icon: Icon; tone: Kpi["tone"]; fn: (o: Order) => boolean | number }[];
  queueTitle: string; queue: (o: Order) => boolean; link: string;
  /** Colour grading / designing: only this person's work (assigned to them, or their own job). */
  mine?: "grading" | "design";
}
const st = (...k: StageKey[]) => (o: Order) => k.includes(o.stage);
const today = (d: string) => new Date(d).toDateString() === TODAY.toDateString();
const due = (o: Order) => isOverdue(o.due) && o.stage !== "delivered";
const gjob = (o: Order) => GJOBS.find((j) => j.orderId === o.id);
const past = (o: Order, k: StageKey) => o.hold !== "Cancelled" && STAGES.findIndex((x) => x.key === o.stage) > STAGES.findIndex((x) => x.key === k);
/** This person's work in a department: the job is theirs, the order is assigned to them, or one of its albums is. */
function isMine(o: Order, dept: "grading" | "design", me: string): boolean {
  if (o.workflow !== "Design + Printing" || !me) return false;
  if (dept === "grading" && gjob(o)?.colorist === me) return true;
  if (dept === "design" && djob(o.id)?.designer === me) return true;
  const stages: StageKey[] = dept === "grading" ? ["colour_grading", "admin_approval"] : ["designing", "client_review"];
  if (o.assignee === me && stages.includes(o.stage)) return true;
  return PROGRESS.some((p) => p.orderId === o.id && p.dept === dept && p.assignee === me);
}

// KPI sets follow SRS widgets: §4.1 Reception, §8.1 Colour, §9.1 Designer, §12.1 Printing, §13.1 QC, §15 Accounts.
const CFG: Partial<Record<RoleKey, Cfg>> = {
  reception: {
    title: "Reception Desk", subtitle: "Register customers, create orders and track what is waiting on you.", cta: { label: "New Order", to: "new-order" },
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
    title: "Colour Grading", subtitle: "Your grading jobs — start, save drafts and submit for admin approval.", cta: { label: "Open queue", to: "/colour-grading" }, mine: "grading",
    kpis: [
      { label: "New Jobs", icon: Palette, tone: "blue", fn: (o) => o.stage === "files_received" || (o.stage === "colour_grading" && gjob(o)?.status === "New") },
      { label: "In Progress", icon: PlayCircle, tone: "violet", fn: (o) => o.stage === "colour_grading" && gjob(o)?.status !== "New" && gjob(o)?.status !== "Rework" },
      { label: "Pending Admin Approval", icon: Hourglass, tone: "pink", fn: st("admin_approval") },
      { label: "Revision Required", icon: Undo2, tone: "orange", fn: (o) => gjob(o)?.status === "Rework" },
      { label: "Completed", icon: CheckCircle2, tone: "green", fn: (o) => past(o, "admin_approval") },
      { label: "Due Today / Overdue", icon: AlarmClock, tone: "red", fn: (o) => o.stage === "colour_grading" && (today(o.due) || isOverdue(o.due)) },
    ],
    queueTitle: "My Queue", queue: st("files_received", "colour_grading", "admin_approval"), link: "/my-jobs",
  },
  designer: {
    title: "Designer Dashboard", subtitle: "Your album designs, from waiting to the client's final approval.", cta: { label: "My Jobs", to: "/my-jobs" }, mine: "design",
    kpis: [
      { label: "Awaiting Design", icon: LayoutTemplate, tone: "blue", fn: st("new_order", "files_received", "colour_grading", "admin_approval") },
      { label: "Designing", icon: PlayCircle, tone: "pink", fn: st("designing") },
      { label: "With the Client", icon: Send, tone: "violet", fn: st("client_review") },
      { label: "Final Approved", icon: Lock, tone: "green", fn: (o) => past(o, "client_review") },
      { label: "Due Today / Overdue", icon: AlarmClock, tone: "amber", fn: (o) => ["designing", "client_review"].includes(o.stage) && (today(o.due) || isOverdue(o.due)) },
    ],
    queueTitle: "My Design Jobs", queue: st("admin_approval", "designing", "client_review"), link: "/my-jobs",
  },
  printing: {
    title: "Printing Dashboard", subtitle: "Approved print jobs, albums at the lab and production.", cta: { label: "Open production", to: "/printing" },
    kpis: [
      { label: "Waiting for Printing", icon: Printer, tone: "blue", fn: st("final_approval") },
      { label: "Printing", icon: PlayCircle, tone: "teal", fn: st("printing") },
      { label: "Albums at the Lab", icon: Boxes, tone: "amber", fn: (o) => ALBUM_LABS.filter((a) => a.orderId === o.id && a.status === "sent").length },
      { label: "Sent to QC", icon: ShieldCheck, tone: "green", fn: st("qc") },
      { label: "Delayed Jobs", icon: AlarmClock, tone: "red", fn: (o) => o.stage === "printing" && isOverdue(o.due) },
    ],
    queueTitle: "Print Jobs", queue: st("final_approval", "printing"), link: "/printing",
  },
  qc: {
    title: "QC Dashboard", subtitle: "Inspect finished albums and decide pass, fail or rework.", cta: { label: "Open inspections", to: "/qc" },
    kpis: [
      { label: "Awaiting QC", icon: Timer, tone: "orange", fn: st("qc") },
      { label: "Sent Back for Rework", icon: Wrench, tone: "amber", fn: (o) => o.stage === "printing" && o.qc === "rework" },
      { label: "Ready for Delivery", icon: Truck, tone: "teal", fn: st("ready_for_delivery") },
      { label: "Passed", icon: CheckCircle2, tone: "green", fn: st("ready_for_delivery", "delivered") },
      { label: "QC SLA Breached", icon: AlarmClock, tone: "pink", fn: (o) => o.stage === "qc" && isOverdue(o.due) },
    ],
    queueTitle: "Inspection Queue", queue: st("qc"), link: "/qc",
  },
  accounts: {
    title: "Accounts", subtitle: "Billing, collections, dues and invoices.", cta: { label: "Record Payment", to: "/payments" },
    kpis: [
      { label: "Unpaid", icon: Receipt, tone: "blue", fn: (o) => o.pay === "Unpaid" && o.total > 0 },
      { label: "Partially Paid", icon: Wallet, tone: "amber", fn: (o) => o.pay === "Partial" },
      { label: "Overdue", icon: AlarmClock, tone: "red", fn: (o) => o.pay === "Overdue" },
      { label: "Paid", icon: CheckCircle2, tone: "green", fn: (o) => o.pay === "Paid" && o.total > 0 },
    ],
    queueTitle: "Orders with Dues", queue: (o) => o.pay !== "Paid" && o.total > o.paid, link: "/payments",
  },
};

export default function RoleHome() {
  const { role, user } = useAuth();
  useStore();
  const nav = useNavigate();
  const newOrder = useNewOrder();
  const cfg = CFG[role!]!;
  const scope = cfg.mine ? ORDERS.filter((o) => isMine(o, cfg.mine!, user)) : ORDERS;   // graders and designers: only their own work
  const items: Kpi[] = cfg.kpis.map((k) => ({ label: k.label, value: scope.reduce((a, o) => { const r = k.fn(o); return a + (typeof r === "number" ? r : r ? 1 : 0); }, 0), icon: k.icon, tone: k.tone }));
  const rows = scope.filter(cfg.queue).slice(0, 10);
  const money = role === "accounts";
  return (
    <>
      <PageHeader title={cfg.title} subtitle={`${cfg.subtitle} Signed in as ${user} · ${ROLES[role!].dept}.`}>
        <TodayChip />
        {cfg.cta && <PrimaryButton icon={ArrowRight} onClick={() => (cfg.cta!.to === "new-order" ? newOrder.open() : nav(cfg.cta!.to))}>{cfg.cta.label}</PrimaryButton>}
      </PageHeader>
      <KpiRow items={items} />
      <Panel title={cfg.queueTitle} subtitle={cfg.mine ? "Orders assigned to you" : "Orders waiting on your department"} action={<LinkAction onClick={() => nav(cfg.link)}>Open module →</LinkAction>} bodyClassName="px-2 pb-2">
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
              {rows.length === 0 && <tr><td colSpan={9} className="p-8 text-center text-sub">{cfg.mine ? "Nothing assigned to you right now — new work appears here when an order or album is assigned to you." : "Nothing waiting — all caught up."}</td></tr>}
            </tbody>
          </table>
        </div>
      </Panel>
    </>
  );
}
