import { useEffect, useReducer, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  AlarmClock, AlertTriangle, ArrowRightLeft, Ban, BellRing, Check, CheckCircle2, ClipboardList, Clock, CreditCard, Factory, IndianRupee, Lock, LockOpen, MessageSquareWarning,
  Palette, PauseCircle, PlayCircle, Printer, ShieldAlert, ShieldCheck, Truck, UserCog, LayoutTemplate, Users, X, Flag, Gauge, Siren, Send, ListOrdered, Wrench,
} from "lucide-react";
import { Avatar, Pill, PageHeader, Panel, PriorityPill, TONE, cx, inputCls, Th, Td, tableCls, trCls } from "../components/ui";
import { Combobox, DateRangePicker, inRange, presetRange, type DateRange } from "../components/controls";
import { Banner, orderOpt } from "../components/pageKit";
import { useToast } from "../components/Toast";
import { ORDERS, STAFF, STAGES, ASSIGNEES, PRIORITIES, stageLabel, stageTone, type Order, type Priority, type StageKey, type Tone } from "../lib/data";
import { inr, isOverdue } from "../lib/format";
import { TODAY_ISO } from "../components/pageKit";
import { useStore, patchOrder } from "../lib/store";
import { AUDIT, currentActor, logAudit, onAudit } from "../lib/audit";
import { moveStage, setHold, cancelOrder, closeOrder, reopenOrder, pauseSla, resumeSla, type Result } from "../lib/workflow";
import { DEPARTMENTS, fmtHours, sequenceOrders, slaState, type SlaState } from "../lib/sla";
import { DESIGN_META, save as saveDesign } from "../lib/design";
import { PROOFS } from "../lib/proofs";
import { notifStore } from "../lib/notifStore";
import { loadJson, saveJson } from "../lib/localState";

/* ───────── reason / extra-field dialog ───────── */
interface Dlg {
  title: string; subtitle?: ReactNode; warn?: string; label?: string; required?: boolean; confirm: string; danger?: boolean;
  extra?: { label: string; options: { value: string; label: string; sub?: string }[]; initial: string };
  run: (reason: string, extra: string) => string | void;
}
function ReasonDialog({ d, onClose }: { d: Dlg; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [extra, setExtra] = useState(d.extra?.initial ?? "");
  const [err, setErr] = useState("");
  const required = d.required !== false;
  const go = () => {
    if (required && !reason.trim()) { setErr(`${d.label ?? "Reason"} is required`); return; }
    const e = d.run(reason.trim(), extra);
    if (e) setErr(e); else onClose();
  };
  return (
    <div className="fixed inset-0 z-[58] grid place-items-center bg-ink/40 p-4" onClick={onClose}>
      <div role="dialog" aria-label={d.title} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-extrabold">{d.title}</h3>
        {d.subtitle && <p className="mt-1 text-sm text-sub">{d.subtitle}</p>}
        {d.warn && <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800"><ShieldAlert className="mt-0.5 size-4 shrink-0" />{d.warn}</div>}
        {d.extra && (
          <div className="mt-4"><span className="mb-1.5 block text-[13px] font-semibold">{d.extra.label}</span>
            <Combobox options={d.extra.options} value={extra} onChange={setExtra} /></div>
        )}
        <label className="mt-4 block"><span className="mb-1.5 block text-[13px] font-semibold">{d.label ?? "Reason"}{required && <span className="text-rose-500"> *</span>}</span>
          <textarea autoFocus aria-label={d.label ?? "Reason"} value={reason} onChange={(e) => { setReason(e.target.value); setErr(""); }} className="h-20 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" /></label>
        {err && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{err}</p>}
        <div className="mt-5 flex justify-end gap-3">
          <button onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-bold hover:bg-slate-100">Cancel</button>
          <button onClick={go} className={cx("h-10 rounded-lg px-5 text-sm font-bold text-white", d.danger ? "bg-rose-600 hover:bg-rose-700" : "bg-brand hover:bg-brand-dark")}>{d.confirm}</button>
        </div>
      </div>
    </div>
  );
}

/* ───────── helpers ───────── */
const ACTIVE_PROD: StageKey[] = ["colour_grading", "admin_approval", "designing", "client_review", "final_approval", "printing", "qc"];
const live = (o: Order) => !o.closed && o.hold !== "Cancelled";
const deliveredDay = (o: Order): string => {
  const hit = AUDIT.find((a) => a.entity === "order" && a.entityId === o.id && a.to === "Delivered");
  return hit ? hit.at.slice(0, 10) : o.due;
};
const realToday = () => new Date().toISOString().slice(0, 10);
const STATUS_TONE: Record<string, Tone> = { ok: "green", at_risk: "amber", breached: "red", paused: "slate" };
const STATUS_LABEL: Record<string, string> = { ok: "On track", at_risk: "At risk", breached: "Breached", paused: "Paused" };
const SEV: Record<string, number> = { breached: 0, at_risk: 1, paused: 3, ok: 4 };
const stageQ = (...k: StageKey[]) => `/orders?stage=${k.join(",")}`;
const staffNames = [...new Set([...ASSIGNEES, ...STAFF.filter((s) => s.status === "Active").map((s) => s.name)])];

interface Tile { key: string; label: string; value: string | number; hint: string; icon: typeof ClipboardList; tone: Tone; to: string }

export default function ControlCenter() {
  useStore();
  const [, bump] = useReducer((x: number) => x + 1, 0);
  useEffect(() => onAudit(bump), []);
  const [toast, show] = useToast();
  const [range, setRange] = useState<DateRange>(() => presetRange("Last 7 Days"));
  const [dlg, setDlg] = useState<Dlg | null>(null);
  const [selId, setSelId] = useState("");
  const [dept, setDept] = useState<string | null>(null);
  const [escalated, setEscalated] = useState<Record<string, string>>(() => loadJson("escalated", {}));
  const me = currentActor();
  const isAdmin = me.role === "admin";

  const res = (r: Result, ok: string) => { if (r.ok) { show(ok); return undefined; } return r.error; };

  /* ---- derived KPIs ---- */
  const sla = new Map<string, SlaState>(ORDERS.map((o) => [o.id, slaState(o)]));
  const active = ORDERS.filter((o) => live(o) && o.stage !== "delivered");
  const inPeriod = (iso: string) => inRange(iso.length <= 10 ? `${iso}T00:00:00` : iso, range);
  const received = ORDERS.filter((o) => inPeriod(o.pendingAt));
  const correctionIds = new Set(PROOFS.filter((p) => p.status === "corrections").map((p) => p.orderId));
  const corrections = active.filter((o) => correctionIds.has(o.id) && PROOFS.find((p) => p.orderId === o.id)?.status === "corrections");
  const delivered = ORDERS.filter((o) => o.stage === "delivered" && [TODAY_ISO, realToday()].includes(deliveredDay(o)));
  const collected = received.reduce((a, o) => a + (o.hold === "Cancelled" ? 0 : o.paid), 0);
  const dues = ORDERS.reduce((a, o) => a + (o.hold === "Cancelled" ? 0 : Math.max(0, o.total - o.paid)), 0);
  const overdue = active.filter((o) => !o.hold && isOverdue(o.due));
  const risky = active.filter((o) => ["at_risk", "breached"].includes(sla.get(o.id)!.status));
  const per = range.preset === "All Time" ? "all time" : range.preset.toLowerCase();
  const tiles: Tile[] = [
    { key: "recv", label: "Orders Received", value: received.length, hint: per, icon: ClipboardList, tone: "blue", to: "/orders" },
    { key: "prod", label: "In Production", value: active.filter((o) => ACTIVE_PROD.includes(o.stage) && !o.hold).length, hint: "active jobs", icon: Factory, tone: "indigo", to: stageQ(...ACTIVE_PROD) },
    { key: "cg", label: "Colour Grading Pending", value: ORDERS.filter((o) => live(o) && o.stage === "colour_grading").length, hint: "open grading jobs", icon: Palette, tone: "violet", to: stageQ("colour_grading") },
    { key: "dg", label: "Designing Pending", value: ORDERS.filter((o) => live(o) && o.stage === "designing").length, hint: "open design jobs", icon: LayoutTemplate, tone: "pink", to: stageQ("designing") },
    { key: "ca", label: "Client Approval Pending", value: ORDERS.filter((o) => live(o) && o.stage === "client_review").length, hint: "proofs awaiting client", icon: Users, tone: "amber", to: stageQ("client_review") },
    { key: "corr", label: "Corrections Pending", value: corrections.length, hint: "client change requests", icon: MessageSquareWarning, tone: "orange", to: stageQ("client_review", "designing") },
    { key: "pr", label: "Printing Pending", value: ORDERS.filter((o) => live(o) && o.stage === "printing").length, hint: "queued / active", icon: Printer, tone: "teal", to: stageQ("printing") },
    { key: "qc", label: "QC Pending", value: ORDERS.filter((o) => live(o) && o.stage === "qc").length, hint: "awaiting inspection", icon: ShieldCheck, tone: "green", to: stageQ("qc") },
    { key: "rd", label: "Ready for Delivery", value: ORDERS.filter((o) => live(o) && o.stage === "ready_for_delivery").length, hint: "QC-passed", icon: Truck, tone: "teal", to: stageQ("ready_for_delivery") },
    { key: "dt", label: "Delivered Today", value: delivered.length, hint: "completed hand-overs", icon: CheckCircle2, tone: "green", to: stageQ("delivered") },
    { key: "pay", label: "Payments Received", value: inr(collected), hint: `on orders of ${per}`, icon: CreditCard, tone: "green", to: "/payments" },
    { key: "due", label: "Pending Dues", value: inr(dues), hint: "outstanding receivables", icon: IndianRupee, tone: "red", to: "/orders?pay=Unpaid,Partial,Overdue" },
    { key: "od", label: "Overdue Orders", value: overdue.length, hint: "promised date breached", icon: AlarmClock, tone: "red", to: "/orders?overdue=1" },
    { key: "sla", label: "Department SLA Risk", value: risky.length, hint: `${risky.filter((o) => sla.get(o.id)!.status === "breached").length} breached`, icon: Gauge, tone: "amber", to: "#escalations" },
  ];

  /* ---- approvals inbox ---- */
  const gradingQ = ORDERS.filter((o) => live(o) && o.stage === "admin_approval" && !o.hold);
  const designQ = ORDERS.filter((o) => live(o) && o.stage === "designing" && !o.hold && DESIGN_META.some((m) => m.orderId === o.id && m.submitted && !m.adminApproved));
  const releaseQ = ORDERS.filter((o) => live(o) && o.stage === "final_approval" && !o.hold);
  const inbox: { o: Order; kind: "grading" | "design" | "release" }[] = [
    ...gradingQ.map((o) => ({ o, kind: "grading" as const })), ...designQ.map((o) => ({ o, kind: "design" as const })), ...releaseQ.map((o) => ({ o, kind: "release" as const })),
  ];
  const KIND = { grading: { label: "Grading approval", tone: "violet" as Tone }, design: { label: "Design approval", tone: "pink" as Tone }, release: { label: "Release to printing", tone: "indigo" as Tone } };

  const approve = (o: Order, kind: "grading" | "design" | "release") => {
    let r: Result;
    if (kind === "grading") r = moveStage(o.id, "designing");
    else if (kind === "design") { r = moveStage(o.id, "client_review"); if (r.ok) saveDesign(o.id, { adminApproved: true }, "design_admin_approved"); }
    else r = moveStage(o.id, "printing");
    if (r.ok) show(`${o.id} approved: ${KIND[kind].label.toLowerCase()}`); else show(r.error);
  };
  const reject = (o: Order, kind: "grading" | "design" | "release") => setDlg({
    title: `Reject ${KIND[kind].label.toLowerCase()}`, subtitle: `${o.id} · ${o.customer}`, confirm: "Reject", danger: true,
    run: (reason) => {
      if (kind === "grading") return res(moveStage(o.id, "colour_grading", { reason }), `${o.id} sent back to Colour Grading`);
      if (kind === "design") { saveDesign(o.id, { submitted: false, adminApproved: false }, "design_admin_rejected", reason); show(`${o.id} design returned to designer`); return; }
      return res(moveStage(o.id, "designing", { reason, override: true }), `${o.id} returned to Designing`);
    },
  });

  /* ---- order controls ---- */
  const sel = ORDERS.find((o) => o.id === selId);
  const manage = (id: string) => { setSelId(id); document.getElementById("order-controls")?.scrollIntoView({ behavior: "smooth", block: "center" }); };
  const reassign = (o: Order) => setDlg({
    title: "Reassign job", subtitle: `${o.id} currently with ${o.assignee}`, confirm: "Reassign",
    extra: { label: "New assignee", options: staffNames.filter((n) => n !== o.assignee).map((n) => ({ value: n, label: n, sub: STAFF.find((s) => s.name.startsWith(n))?.role })), initial: "" },
    run: (reason, to) => {
      if (!to) return "Choose who to reassign to";
      const from = o.assignee;
      patchOrder(o.id, { assignee: to });
      logAudit({ entity: "order", entityId: o.id, action: "reassign", from, to, reason });
      notifStore.push({ title: "Job reassigned to you", body: `${o.id} (${o.customer}) moved from ${from}. Reason: ${reason}`, time: "just now", to: `/orders/${o.id}` });
      show(`${o.id} reassigned to ${to}`);
    },
  });
  const changePriority = (o: Order) => setDlg({
    title: "Change priority", subtitle: `${o.id} is ${o.priority}`, confirm: "Update priority", required: false, label: "Reason (optional)",
    extra: { label: "New priority", options: PRIORITIES.filter((p) => p !== o.priority).map((p) => ({ value: p, label: p })), initial: "" },
    run: (reason, p) => {
      if (!p) return "Choose a priority";
      const from = o.priority;
      patchOrder(o.id, { priority: p as Priority });
      logAudit({ entity: "order", entityId: o.id, action: "priority_change", from, to: p, reason: reason || undefined });
      show(`${o.id} priority ${from} → ${p}`);
    },
  });
  const holdIt = (o: Order) => setDlg({ title: "Put on hold", subtitle: `${o.id} · ${o.customer}`, confirm: "Put on hold", run: (reason) => res(setHold(o.id, true, reason), `${o.id} is on hold`) });
  const cancelIt = (o: Order) => setDlg({ title: "Cancel order", subtitle: `${o.id} · ${o.customer}. History is preserved, nothing is deleted.`, confirm: "Cancel order", danger: true, label: "Cancellation reason", run: (reason) => res(cancelOrder(o.id, reason), `${o.id} cancelled`) });
  const reopenIt = (o: Order) => setDlg({ title: "Reopen closed order", subtitle: `${o.id} · records an amendment event`, confirm: "Reopen", run: (reason) => res(reopenOrder(o.id, reason), `${o.id} reopened`) });
  const closeIt = (o: Order) => {
    const owing = o.total - o.paid;
    if (owing > 0) setDlg({ title: "Close with outstanding balance", subtitle: `${o.id} still owes ${inr(owing)}.`, warn: "Closing with dues is an override and is flagged in the audit log.", confirm: "Close with override", run: (reason) => res(closeOrder(o.id, { override: true, reason }), `${o.id} closed (override)`) });
    else { const r = closeOrder(o.id); show(r.ok ? `${o.id} closed` : r.error); }
  };
  const pauseIt = (o: Order) => setDlg({ title: "Pause SLA clock", subtitle: `${o.id}: e.g. waiting for client, material or payment`, confirm: "Pause SLA", run: (reason) => res(pauseSla(o.id, reason), `SLA paused for ${o.id}`) });
  const resumeIt = (o: Order) => { const r = resumeSla(o.id); show(r.ok ? `SLA resumed for ${o.id}` : r.error); };
  const overrideIt = (o: Order) => setDlg({
    title: "Override workflow", subtitle: `${o.id} is at ${stageLabel(o.stage)}`, warn: "Elevated audit: this bypasses the normal route and gates (skip or reopen a stage). It is recorded as a stage override with your name and reason.",
    confirm: "Force move", danger: true, label: "Reason for override",
    extra: { label: "Move to stage", options: STAGES.filter((s) => s.key !== o.stage).map((s) => ({ value: s.key, label: s.label })), initial: "" },
    run: (reason, to) => { if (!to) return "Choose a target stage"; return res(moveStage(o.id, to as StageKey, { override: true, reason }), `${o.id} forced to ${stageLabel(to as StageKey)} (override logged)`); },
  });

  /* ---- escalation ---- */
  const queue = active.map((o) => ({ o, s: sla.get(o.id)! })).filter(({ s }) => s.status === "breached" || s.status === "at_risk")
    .filter(({ s }) => !dept || s.dept === dept).sort((a, b) => SEV[a.s.status]! - SEV[b.s.status]! || a.s.hoursLeft - b.s.hoursLeft);
  const escalate = (o: Order, s: SlaState) => {
    const at = new Date().toISOString();
    const next = { ...escalated, [o.id]: at }; setEscalated(next); saveJson("escalated", next);
    logAudit({ entity: "order", entityId: o.id, action: "sla_escalate", detail: `${s.dept}: ${fmtHours(s.hoursLeft)}`, reason: `SLA ${s.status === "breached" ? "breached" : "at risk"} at ${stageLabel(o.stage)}` });
    notifStore.push({ title: s.status === "breached" ? "SLA breach escalated" : "SLA at risk", body: `${o.id} (${o.customer}) · ${stageLabel(o.stage)} · ${fmtHours(s.hoursLeft)}`, time: "just now", to: `/orders/${o.id}` });
    show(`${o.id} escalated to admin`);
  };
  const nudge = (o: Order, s: SlaState) => {
    logAudit({ entity: "order", entityId: o.id, action: "sla_nudge", detail: `Nudged ${o.assignee}`, reason: `${stageLabel(o.stage)} ${fmtHours(s.hoursLeft)}` });
    notifStore.push({ title: `Nudge for ${o.assignee}`, body: `${o.id} is ${s.status === "breached" ? "past" : "close to"} its SLA at ${stageLabel(o.stage)} (${fmtHours(s.hoursLeft)})`, time: "just now", to: `/orders/${o.id}` });
    show(`Nudge sent to ${o.assignee}`);
  };

  /* ---- heat strip ---- */
  const heat = DEPARTMENTS.map((d) => {
    const rows = active.map((o) => sla.get(o.id)!).filter((s) => s.dept === d && s.slaHours != null);
    return { d, ok: rows.filter((s) => s.status === "ok").length, risk: rows.filter((s) => s.status === "at_risk").length, br: rows.filter((s) => s.status === "breached").length, paused: rows.filter((s) => s.status === "paused").length, n: rows.length };
  });

  const seq = sequenceOrders().slice(0, 12);
  const opts = ORDERS.map(orderOpt);

  return (
    <div className="min-w-0">
      {toast}
      {dlg && <ReasonDialog d={dlg} onClose={() => setDlg(null)} />}
      <PageHeader title="Admin Control Center" subtitle="Live KPIs, approvals, SLA escalations and administrative overrides">
        <DateRangePicker value={range} onChange={setRange} />
      </PageHeader>
      {!isAdmin && <div className="mb-4"><Banner tone="amber">You are signed in as {me.role}. Approval, override, cancel and close actions require the Admin role and will be refused.</Banner></div>}

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7" data-testid="kpi-grid">
        {tiles.map((t) => {
          const body = (
            <>
              <span className={cx("grid size-9 place-items-center rounded-xl", TONE[t.tone].soft, TONE[t.tone].text)}><t.icon className="size-[18px]" /></span>
              <div className="mt-2 text-[22px] font-extrabold leading-none" data-testid={`kpi-${t.key}`}>{t.value}</div>
              <div className="mt-1 text-[12.5px] font-bold">{t.label}</div>
              <div className="text-[11px] text-sub">{t.hint}</div>
            </>
          );
          const cls = "block rounded-2xl border border-line bg-white p-3.5 shadow-[0_1px_2px_rgba(20,30,90,0.04)] transition hover:border-brand hover:shadow-md";
          return t.to.startsWith("#")
            ? <a key={t.key} href={t.to} className={cls} onClick={(e) => { e.preventDefault(); document.getElementById("escalations")?.scrollIntoView({ behavior: "smooth" }); }}>{body}</a>
            : <Link key={t.key} to={t.to} className={cls}>{body}</Link>;
        })}
      </div>

      <Panel title="Department SLA heat" subtitle="Active orders by SLA state, per department (click to filter the escalation queue)" className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="heat-strip">
          {heat.map((h) => (
            <button key={h.d} onClick={() => setDept(dept === h.d ? null : h.d)} aria-pressed={dept === h.d}
              className={cx("rounded-xl border p-3 text-left transition", dept === h.d ? "border-brand bg-brand-soft" : "border-line hover:border-brand/50", h.br ? "ring-1 ring-rose-300" : "")}>
              <div className="flex items-center justify-between text-[13px] font-bold"><span>{h.d}</span><span className="text-sub">{h.n}</span></div>
              <div className="mt-2 flex h-2.5 overflow-hidden rounded-full bg-slate-100" title={`${h.ok} on track, ${h.risk} at risk, ${h.br} breached`}>
                {h.n > 0 && <><span className="bg-emerald-500" style={{ width: `${(h.ok / h.n) * 100}%` }} /><span className="bg-amber-400" style={{ width: `${(h.risk / h.n) * 100}%` }} /><span className="bg-rose-500" style={{ width: `${(h.br / h.n) * 100}%` }} /><span className="bg-slate-300" style={{ width: `${(h.paused / h.n) * 100}%` }} /></>}
              </div>
              <div className="mt-1.5 flex gap-3 text-[11px] font-semibold"><span className="text-emerald-600">{h.ok} ok</span><span className="text-amber-600">{h.risk} risk</span><span className="text-rose-600">{h.br} breached</span></div>
            </button>
          ))}
        </div>
      </Panel>

      <div className="mb-5 grid gap-5 xl:grid-cols-2">
        <Panel title="Approvals Inbox" subtitle={`${inbox.length} awaiting admin`} bodyClassName="p-0" action={<ClipboardList className="size-5 text-sub" />}>
          <div className="max-h-[420px] overflow-y-auto scroll-thin" data-testid="approvals-inbox">
            {inbox.map(({ o, kind }) => (
              <div key={o.id + kind} className="flex flex-wrap items-center gap-3 border-t border-line px-5 py-3 first:border-t-0" data-testid="approval-row">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2"><Link to={`/orders/${o.id}`} className="text-[13px] font-extrabold text-brand hover:underline">{o.id}</Link><Pill tone={KIND[kind].tone}>{KIND[kind].label}</Pill></div>
                  <div className="truncate text-xs text-sub">{o.customer} · {o.event} · {o.size} · due {o.due}</div>
                </div>
                <button onClick={() => approve(o, kind)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"><Check className="size-3.5" />Approve</button>
                <button onClick={() => reject(o, kind)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50"><X className="size-3.5" />Reject</button>
              </div>
            ))}
            {inbox.length === 0 && <p className="px-5 py-10 text-center text-sm text-sub">Nothing is waiting for approval.</p>}
          </div>
        </Panel>

        <Panel title="Priority sequencing" subtitle="VIP > Urgent > High > Normal, then earliest due date" bodyClassName="p-0" action={<ListOrdered className="size-5 text-sub" />}>
          <div className="max-h-[420px] overflow-auto scroll-thin"><table className={tableCls} data-testid="priority-seq">
            <thead><tr><Th>#</Th><Th>Order</Th><Th>Priority</Th><Th>Stage</Th><Th>Due</Th></tr></thead>
            <tbody>{seq.map((o, i) => (
              <tr key={o.id} className={trCls}><Td>{i + 1}</Td><Td><Link to={`/orders/${o.id}`} className="font-bold text-brand hover:underline">{o.id}</Link><span className="block text-xs text-sub">{o.customer}</span></Td>
                <Td><PriorityPill p={o.priority} /></Td><Td><Pill tone={stageTone(o.stage)}>{stageLabel(o.stage)}</Pill></Td><Td className={isOverdue(o.due) ? "font-bold text-rose-600" : ""}>{o.due}</Td></tr>
            ))}</tbody>
          </table></div>
        </Panel>
      </div>

      <div id="escalations" className="scroll-mt-4">
        <Panel title="Escalation queue" subtitle={`${queue.length} breached or at risk${dept ? ` in ${dept}` : ""}`} className="mb-5" bodyClassName="p-0"
          action={dept ? <button onClick={() => setDept(null)} className="text-xs font-bold text-brand">Clear department filter</button> : <Siren className="size-5 text-sub" />}>
          <div className="overflow-x-auto"><table className={tableCls} data-testid="escalation-queue">
            <thead><tr><Th>Order</Th><Th>Stage / Dept</Th><Th>Assignee</Th><Th>SLA</Th><Th>Time</Th><Th>Actions</Th></tr></thead>
            <tbody>
              {queue.map(({ o, s }) => (
                <tr key={o.id} className={trCls} data-status={s.status}>
                  <Td><Link to={`/orders/${o.id}`} className="font-bold text-brand hover:underline">{o.id}</Link><span className="block text-xs text-sub">{o.customer}</span></Td>
                  <Td>{stageLabel(o.stage)}<span className="block text-xs text-sub">{s.dept}</span></Td>
                  <Td><span className="flex items-center gap-2"><Avatar name={o.assignee} size={24} />{o.assignee}</span></Td>
                  <Td><Pill tone={STATUS_TONE[s.status]} dot>{STATUS_LABEL[s.status]}</Pill><span className="block text-[11px] text-sub">{Math.round(s.usedPct)}% of {s.slaHours}h used</span></Td>
                  <Td className={cx("font-bold", s.status === "breached" ? "text-rose-600" : "text-amber-600")}>{fmtHours(s.hoursLeft)}</Td>
                  <Td><span className="flex flex-wrap gap-1.5">
                    <button onClick={() => escalate(o, s)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-rose-600 px-2.5 text-xs font-bold text-white hover:bg-rose-700"><Siren className="size-3.5" />{escalated[o.id] ? "Escalated" : "Escalate to admin"}</button>
                    <button onClick={() => nudge(o, s)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft"><BellRing className="size-3.5" />Nudge assignee</button>
                    <button onClick={() => manage(o.id)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft"><Wrench className="size-3.5" />Manage</button>
                  </span></Td>
                </tr>
              ))}
              {queue.length === 0 && <tr><td colSpan={6} className="py-10 text-center text-sm text-sub">No orders are breached or at risk.</td></tr>}
            </tbody>
          </table></div>
        </Panel>
      </div>

      <div id="order-controls" className="scroll-mt-4">
        <Panel title="Order controls" subtitle="Reassign, re-prioritise, hold, cancel, close/reopen, pause SLA or force a stage move (all audited)" action={<UserCog className="size-5 text-sub" />}>
          <div className="max-w-md"><Combobox options={opts} value={selId} onChange={setSelId} placeholder="Select an order to manage…" /></div>
          {sel ? (
            <div className="mt-4" data-testid="order-controls">
              <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-slate-50 px-4 py-3 text-[13px]">
                <Link to={`/orders/${sel.id}`} className="font-extrabold text-brand hover:underline">{sel.id}</Link><span className="font-semibold">{sel.customer}</span>
                <Pill tone={stageTone(sel.stage)}>{stageLabel(sel.stage)}</Pill><PriorityPill p={sel.priority} />
                <span className="text-sub">Assignee: <b className="text-ink">{sel.assignee}</b></span>
                {sel.hold && <Pill tone={sel.hold === "Cancelled" ? "red" : "amber"}>{sel.hold}</Pill>}
                {sel.closed && <Pill tone="slate">Closed</Pill>}
                {sel.slaPausedAt && <Pill tone="slate">SLA paused: {sel.slaPauseReason}</Pill>}
                {(() => { const s = slaState(sel); return s.slaHours ? <Pill tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]} · {s.status === "paused" ? "clock stopped" : fmtHours(s.hoursLeft)}</Pill> : null; })()}
              </div>
              <div className="flex flex-wrap gap-2">
                <CtlBtn icon={Users} onClick={() => reassign(sel)}>Reassign</CtlBtn>
                <CtlBtn icon={Flag} onClick={() => changePriority(sel)}>Change priority</CtlBtn>
                {sel.hold === "On Hold" ? <CtlBtn icon={PlayCircle} onClick={() => { const r = setHold(sel.id, false); show(r.ok ? `${sel.id} resumed` : r.error); }}>Resume</CtlBtn> : <CtlBtn icon={PauseCircle} onClick={() => holdIt(sel)}>Hold</CtlBtn>}
                <CtlBtn icon={Ban} danger onClick={() => cancelIt(sel)}>Cancel order</CtlBtn>
                {sel.closed ? <CtlBtn icon={LockOpen} onClick={() => reopenIt(sel)}>Reopen</CtlBtn> : <CtlBtn icon={Lock} onClick={() => closeIt(sel)}>Close order</CtlBtn>}
                {sel.slaPausedAt ? <CtlBtn icon={PlayCircle} onClick={() => resumeIt(sel)}>Resume SLA</CtlBtn> : <CtlBtn icon={Clock} onClick={() => pauseIt(sel)}>Pause SLA</CtlBtn>}
                <CtlBtn icon={ArrowRightLeft} danger onClick={() => overrideIt(sel)}>Override stage…</CtlBtn>
              </div>
              <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-700"><AlertTriangle className="size-3.5" />Override moves bypass the route and gates. A reason is mandatory and the event is flagged in the Audit Log.</p>
            </div>
          ) : <p className="mt-4 text-sm text-sub">Pick an order above, or use “Manage” in the escalation queue.</p>}
        </Panel>
      </div>
    </div>
  );
}

function CtlBtn({ icon: Icon, children, onClick, danger }: { icon: typeof Send; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return <button onClick={onClick} className={cx("inline-flex h-10 items-center gap-2 rounded-lg border px-3.5 text-[13px] font-bold", danger ? "border-rose-200 text-rose-600 hover:bg-rose-50" : "border-line hover:bg-brand-soft")}><Icon className="size-4" />{children}</button>;
}
