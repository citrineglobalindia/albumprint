import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Check, ChevronRight, FileImage, Lock, Download, Upload, Pause, Play, Repeat, MinusCircle, Phone, CalendarDays, User, History, ArrowRight, Archive, ShieldAlert, Ban, LockOpen, CircleCheck } from "lucide-react";
import { PageHeader, Panel, Pill, PriorityPill, PayPill, Avatar, ProgressBar, OutlineButton, PrimaryButton, LinkAction, SlideOver, Field, inputCls, cx } from "../components/ui";
import ProofPanel from "../components/ProofPanel";
import { useNotice } from "../components/Notice";
import { useReason } from "../components/ReasonDialog";
import { ORDERS, STAGES, stageLabel, stageTone, type Order, type StageKey } from "../lib/data";
import { fmtDate, inr } from "../lib/format";
import { AUDIT, type AuditEntry } from "../lib/audit";
import { FILES, addFile, lockFile, archiveFile, fmtSize, type FileCategory, type FileRec, type FileState } from "../lib/files";
import { proofApproved } from "../lib/proofs";
import { cancelOrder, closeOrder, moveStage, nextStages, reopenOrder, setHold, type Result } from "../lib/workflow";
import { editOrder } from "../lib/orderEdit";
import { useAuth } from "../lib/auth";
import { useLive } from "../lib/useLive";

// Stages skipped for Printing Only orders (SRS §5.2: shown as "Not Required").
const SKIPPED = ["colour_grading", "admin_approval", "designing", "client_review", "final_approval"];
const CATS: FileCategory[] = ["Source Photos", "Graded", "Design Draft", "Final Print", "Cover", "QC Evidence", "Invoice", "Other"];
const FILE_TONE: Record<FileState, "violet" | "green" | "amber" | "slate" | "red"> = { Locked: "violet", Approved: "green", Submitted: "amber", Draft: "slate", Rejected: "red" };
const ACTION_LABEL: Record<string, string> = {
  stage_change: "Stage changed", stage_override: "Admin override", hold: "Put on hold", resume: "Resumed", cancel: "Cancelled", close: "Closed", reopen: "Reopened",
  upload: "File uploaded", lock: "File locked", archive: "File archived", send: "Proof sent", client_approval: "Client approved proof", client_corrections: "Client requested corrections", revoke: "Proof link revoked",
  update: "Order edited", priority: "Priority changed", reassign: "Reassigned", workflow_convert: "Workflow converted", sla_pause: "SLA paused", sla_resume: "SLA resumed",
};
const labelOf = (a: AuditEntry) => ACTION_LABEL[a.action] ?? a.action.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default function OrderDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const tick = useLive();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const base = ORDERS.find((o) => o.id === id);
  const [convert, setConvert] = useState(false);
  const [reason, setReason] = useState("");
  const [cat, setCat] = useState<FileCategory>("Source Photos");
  const [showArchived, setShowArchived] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toast, show, fail] = useNotice();
  const [reasonDlg, askReason] = useReason();
  if (!base) return <PageHeader title="Order not found" subtitle={`No order with ID ${id}.`}><OutlineButton onClick={() => nav("/orders")}>Back to orders</OutlineButton></PageHeader>;
  const o: Order = base;
  const printingOnly = o.workflow === "Printing";
  const cur = STAGES.findIndex((s) => s.key === o.stage);
  const bal = o.total - o.paid;
  const steps = nextStages(o);
  const cancelled = o.hold === "Cancelled";
  const locked = !!o.closed || cancelled;

  const report = (r: Result, okMsg: string) => { r.ok ? show(okMsg) : fail(r.error); return r.ok; };
  const doMove = (to: StageKey, needsReason: boolean) => {
    if (!needsReason) { report(moveStage(o.id, to), `${o.id} moved to ${stageLabel(to)}`); return; }
    askReason({ title: `Move to ${stageLabel(to)}`, message: `${stageLabel(o.stage)} → ${stageLabel(to)} sends the order back, so a reason is required.`, confirmLabel: "Send back" }, (r) => report(moveStage(o.id, to, { reason: r }), `${o.id} sent back to ${stageLabel(to)}`));
  };
  const doHold = () => askReason({ title: `Put ${o.id} on hold`, message: "Work stops and the SLA clock is flagged until the order is resumed.", confirmLabel: "Put on hold" }, (r) => report(setHold(o.id, true, r), `${o.id} put on hold`));
  const doResume = () => report(setHold(o.id, false), `${o.id} resumed`);
  const doCancel = () => askReason({ title: `Cancel ${o.id}`, message: "History is preserved; the order leaves the pipeline.", confirmLabel: "Cancel order", danger: true }, (r) => report(cancelOrder(o.id, r), `${o.id} cancelled`));
  const doClose = () => {
    if (o.paid < o.total) askReason({ title: `Close ${o.id} with ${inr(bal)} outstanding`, message: "An order normally closes only when fully paid. Closing now is an admin override and is audited.", confirmLabel: "Close with override", danger: true }, (r) => report(closeOrder(o.id, { override: true, reason: r }), `${o.id} closed (override)`));
    else report(closeOrder(o.id), `${o.id} closed`);
  };
  const doReopen = () => askReason({ title: `Reopen ${o.id}`, confirmLabel: "Reopen" }, (r) => report(reopenOrder(o.id, r), `${o.id} reopened`));
  const doOverride = () => askReason({
    title: "Admin override", message: "Move the order to any stage, bypassing the normal route and gates. The reason and your name are recorded as an override.",
    choice: { label: "Move to stage", options: STAGES.filter((s) => s.key !== o.stage).map((s) => ({ value: s.key, label: s.label })) }, confirmLabel: "Override move", danger: true,
  }, (r, to) => report(moveStage(o.id, to as StageKey, { override: true, reason: r }), `${o.id} moved to ${stageLabel(to as StageKey)} (override)`));

  const onFiles = (list: FileList | null) => {
    if (!list || !list.length) return;
    if (o.closed) { fail(`${o.id} is closed and read-only — reopen it first`); return; }
    let added = 0; let err = "";
    [...list].forEach((f) => { const r = addFile(o.id, cat, f.name, f.size); if (r.ok) added++; else err ||= `${f.name}: ${r.error}`; });
    if (fileRef.current) fileRef.current.value = "";
    if (err) fail(added ? `${added} uploaded. ${err}` : err); else show(`${added} file${added > 1 ? "s" : ""} added to ${cat}`);
  };

  const files: FileRec[] = FILES.filter((f) => f.orderId === o.id && (showArchived || !f.archived));
  const trail = AUDIT.filter((a) => a.entityId === o.id);
  const stateKey = tick; void stateKey;

  // Gate hints so the user knows why a forward step will be refused before they try it.
  const hints: string[] = [];
  if (o.stage === "final_approval" && !printingOnly && !proofApproved(o.id)) hints.push("Release to Printing needs the client's approval on the latest proof (see Client Proofing).");
  if (o.stage === "files_received" && printingOnly && !FILES.some((f) => f.orderId === o.id && f.category === "Final Print" && !f.archived)) hints.push("Upload a print-ready file (category Final Print) before moving to Printing.");
  if (o.stage === "qc" && o.qc !== "passed") hints.push("QC must pass before the order can be marked Ready for Delivery.");
  if (o.stage === "delivered" && !o.closed && bal > 0) hints.push(`${inr(bal)} is still outstanding — closing will need an override reason.`);

  return (
    <>
      <div className="mb-2 flex items-center gap-1.5 text-xs text-sub"><Link to="/orders" className="hover:underline">Orders</Link><ChevronRight className="size-3" aria-hidden /><b className="text-ink">{o.id}</b></div>
      <PageHeader title={`${o.id} · ${o.customer}`} subtitle={`${o.event} · ${o.workflow} · due ${fmtDate(o.due)}`}>
        {o.closed && <Pill tone="slate" icon={Lock} className="!px-3 !py-1.5 !text-sm">Closed</Pill>}
        <Pill tone={cancelled ? "red" : o.hold ? "pink" : stageTone(o.stage)} dot className="!px-3 !py-1.5 !text-sm" >{cancelled ? "Cancelled" : o.hold ?? stageLabel(o.stage)}</Pill>
        {printingOnly && !locked && <PrimaryButton icon={Repeat} onClick={() => setConvert(true)}>Convert to Design + Printing</PrimaryButton>}
      </PageHeader>

      {(o.closed || cancelled) && (
        <div role="note" className="mb-4 flex items-start gap-2 rounded-xl border border-line bg-slate-50 px-4 py-3 text-sm">
          {cancelled ? <Ban className="mt-0.5 size-4 shrink-0 text-rose-600" aria-hidden /> : <Lock className="mt-0.5 size-4 shrink-0 text-sub" aria-hidden />}
          <span>{cancelled ? <>This order is <b>cancelled</b>{o.cancelReason ? <>: {o.cancelReason}</> : null}. History is preserved.</> : <>This order is <b>closed</b> and read-only{o.closedAt ? ` (since ${when(o.closedAt)})` : ""}. {isAdmin ? "Reopen it to make changes." : "Ask an admin to reopen it."}</>}</span>
        </div>
      )}

      <Panel className="mb-5" title="Next step" subtitle={`Currently ${o.hold === "On Hold" ? "on hold at " : "at "}${stageLabel(o.stage)}`} bodyClassName="space-y-3">
        <div data-testid="next-step-bar" className="flex flex-wrap items-center gap-2">
          {steps.map((n, i) => (
            <button key={n.to} type="button" data-testid={`next-${n.to}`} disabled={o.hold === "On Hold"} onClick={() => doMove(n.to, n.needsReason)}
              className={cx("inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-50", i === 0 && !n.needsReason ? "bg-brand text-white shadow-md shadow-brand/25 hover:bg-brand-dark" : "border border-line bg-white hover:bg-brand-soft")}>
              {n.needsReason ? <Undo /> : <ArrowRight className="size-4" aria-hidden />}{n.needsReason ? `Send back to ${stageLabel(n.to)}` : `Move to ${stageLabel(n.to)}`}
            </button>
          ))}
          {steps.length === 0 && <span data-testid="no-next-step" className="text-sm text-sub">{locked ? (cancelled ? "Cancelled orders cannot move." : "Closed orders cannot move.") : o.stage === "delivered" ? "Delivered — nothing further in the route." : "No step is available to your role at this stage."}</span>}
        </div>
        {o.hold === "On Hold" && steps.length > 0 && <p className="text-xs font-semibold text-amber-700">Resume the order to continue the route.</p>}
        {hints.map((h) => <p key={h} className="flex items-start gap-1.5 text-xs text-sub"><CircleCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />{h}</p>)}
        <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
          {o.hold === "On Hold" ? <OutlineButton icon={Play} className="!h-11" onClick={doResume}>Resume</OutlineButton>
            : !o.hold && !o.closed && <OutlineButton icon={Pause} className="!h-11" onClick={doHold}>Put on hold</OutlineButton>}
          {isAdmin && !cancelled && !o.closed && <OutlineButton icon={Ban} className="!h-11 !text-rose-700" onClick={doCancel}>Cancel order</OutlineButton>}
          {isAdmin && o.stage === "delivered" && !o.closed && !cancelled && <OutlineButton icon={Lock} className="!h-11" onClick={doClose}>Close order</OutlineButton>}
          {isAdmin && o.closed && <OutlineButton icon={LockOpen} className="!h-11" onClick={doReopen}>Reopen order</OutlineButton>}
          {isAdmin && !o.closed && !cancelled && <OutlineButton icon={ShieldAlert} className="!h-11" onClick={doOverride}>Admin override</OutlineButton>}
        </div>
      </Panel>

      <Panel className="mb-5" title="Workflow" subtitle={printingOnly ? "Printing Only — design stages are not required" : "Design + Printing"}>
        <div role="region" aria-label="Workflow stages" tabIndex={0} className="scroll-thin flex items-start gap-1 overflow-x-auto pb-2">
          {STAGES.map((s, i) => {
            const skipped = printingOnly && SKIPPED.includes(s.key);
            const done = !skipped && i < cur;
            const now = i === cur;
            return (
              <div key={s.key} className="flex min-w-[104px] flex-1 flex-col items-center text-center" aria-current={now ? "step" : undefined}>
                <div className="flex w-full items-center">
                  <span className={`h-0.5 flex-1 ${i === 0 ? "opacity-0" : done || now ? "bg-brand" : "bg-line"}`} />
                  <span className={`grid size-8 place-items-center rounded-full border-2 text-xs font-bold ${skipped ? "border-line bg-slate-50 text-slate-400" : done ? "border-brand bg-brand text-white" : now ? "border-brand bg-white text-brand ring-4 ring-brand/15" : "border-line bg-white text-slate-400"}`}>
                    {skipped ? <MinusCircle className="size-4" aria-hidden /> : done ? <Check className="size-4" aria-hidden /> : i + 1}
                  </span>
                  <span className={`h-0.5 flex-1 ${i === STAGES.length - 1 ? "opacity-0" : done ? "bg-brand" : "bg-line"}`} />
                </div>
                <div className={`mt-2 text-[11px] font-bold leading-tight ${now ? "text-brand" : skipped ? "text-slate-400" : "text-ink"}`}>{s.label}</div>
                {skipped && <div className="text-[10px] text-slate-400">Not Required</div>}
              </div>
            );
          })}
        </div>
      </Panel>

      <div className="grid items-start gap-5 xl:grid-cols-[1fr_1fr_340px]">
        <div className="min-w-0 space-y-5">
          <Panel title="Order Details">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[["Order ID", o.id], ["Order Type", o.workflow], ["Event", o.event], ["Priority", <PriorityPill key="p" p={o.priority} />], ["Order Date", fmtDate(o.pendingAt)], ["Expected Delivery", fmtDate(o.due)], ["Assigned To", <span key="a" className="inline-flex items-center gap-1.5"><Avatar name={o.assignee} size={20} />{o.assignee}</span>], ["Progress", <ProgressBar key="g" value={o.progress} className="mt-2 w-24" />]].map(([k, v]) => (
                <div key={String(k)}><dt className="text-xs text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>
              ))}
            </dl>
          </Panel>
          <Panel title="Customer">
            <div className="flex items-center gap-3"><Avatar name={o.customer} size={44} /><div><div className="font-bold">{o.customer}</div><div className="flex items-center gap-1.5 text-xs text-sub"><Phone className="size-3" aria-hidden />{o.mobile}</div></div></div>
            <div className="mt-3 flex gap-4 text-xs text-sub"><span className="flex items-center gap-1"><User className="size-3.5" aria-hidden />Studio client</span><span className="flex items-center gap-1"><CalendarDays className="size-3.5" aria-hidden />Since Jan 2024</span></div>
          </Panel>
          <Panel title="Print Specification">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              {[["Album Size", o.size], ["Pages / Sheets", `${o.pages} / ${o.pages * 2}`], ["Orientation", "Landscape"], ["Copies", "2"], ["Paper", "Sapphire Matte 300 GSM"], ["Cover", "Acrylic Photo Cover"], ["Lamination", "Matte (Both Sides)"], ["Binding", "Lay-flat"], ["Box", "Premium Magnetic Box"], ["Finishing", "Spot UV on Cover"]].map(([k, v]) => (
                <div key={k}><dt className="text-xs text-sub">{k}</dt><dd className="font-semibold">{v}</dd></div>
              ))}
            </dl>
          </Panel>
        </div>

        <div className="min-w-0 space-y-5">
          <Panel title="Files & Versions" subtitle={`${files.length} file${files.length === 1 ? "" : "s"}`} bodyClassName="space-y-3"
            action={<label className="inline-flex cursor-pointer items-center text-xs font-bold text-brand hover:underline"><Upload className="mr-1 size-3" aria-hidden />Upload<input ref={fileRef} data-testid="file-input" type="file" multiple className="sr-only" aria-label="Upload files" onChange={(e) => onFiles(e.target.files)} /></label>}>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 text-xs font-semibold text-sub">Category
                <select data-testid="file-category" value={cat} onChange={(e) => setCat(e.target.value as FileCategory)} className="h-9 rounded-lg border border-line bg-white px-2 text-[13px] font-medium text-ink">{CATS.map((c) => <option key={c}>{c}</option>)}</select>
              </label>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-sub"><input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />Show archived</label>
            </div>
            <ul className="space-y-2.5" data-testid="file-list">
              {files.map((f) => (
                <li key={f.id} className={cx("flex flex-wrap items-center gap-3 rounded-xl border border-line p-3", f.archived && "opacity-60")}>
                  <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"><FileImage className="size-5" aria-hidden /></span>
                  <div className="min-w-0 flex-1 leading-tight"><div className="truncate text-[13px] font-bold">{f.name}</div><div className="text-[11px] text-sub">{f.category} · v{f.version} · {fmtSize(f.size)}</div><div className="text-[11px] text-sub">{f.by} · {when(f.at)}{f.archived ? " · archived" : ""}</div></div>
                  <Pill tone={FILE_TONE[f.state]} icon={f.state === "Locked" ? Lock : undefined}>{f.state}</Pill>
                  <span className="flex items-center">
                    <button type="button" aria-label={`Download ${f.name}`} onClick={() => show(`${f.name}: only the register entry is stored in this demo; file bytes arrive with the storage backend`)} className="grid size-9 place-items-center rounded-lg text-sub hover:bg-slate-100 hover:text-ink"><Download className="size-4" aria-hidden /></button>
                    {f.state !== "Locked" && !f.archived && <button type="button" aria-label={`Lock ${f.name}`} onClick={() => { lockFile(f.id); show(`${f.name} locked`); }} className="grid size-9 place-items-center rounded-lg text-sub hover:bg-slate-100 hover:text-ink"><Lock className="size-4" aria-hidden /></button>}
                    {!f.archived && <button type="button" aria-label={`Archive ${f.name}`} onClick={() => { archiveFile(f.id) ? show(`${f.name} archived`) : fail("Locked files cannot be archived"); }} className="grid size-9 place-items-center rounded-lg text-sub hover:bg-slate-100 hover:text-ink"><Archive className="size-4" aria-hidden /></button>}
                  </span>
                </li>
              ))}
              {files.length === 0 && <li className="rounded-xl border border-dashed border-line p-4 text-center text-xs text-sub">No files yet. Upload photos, drafts or the print-ready file; re-uploading the same name creates a new version.</li>}
            </ul>
            {cur >= 6 && <p className="text-xs text-sub">Final print file is locked and released to Printing (SRS ALB-FR-0120).</p>}
          </Panel>
          {!printingOnly && <ProofPanel orderId={o.id} />}
          <Panel title="Payment Summary" action={<LinkAction onClick={() => nav("/payments")}>Payments →</LinkAction>}>
            <div className="mb-3 flex items-center justify-between"><span className="text-sm text-sub">Status</span><PayPill s={o.pay} /></div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-sub">Order total</span><b>{inr(o.total)}</b></div>
              <div className="flex justify-between"><span className="text-sub">Paid</span><b className="text-emerald-700">{inr(o.paid)}</b></div>
              <div className="flex justify-between border-t border-line pt-2"><span className="text-sub">Balance</span><b className={bal > 0 ? "text-rose-600" : ""}>{inr(bal)}</b></div>
            </div>
            <ProgressBar value={o.total ? Math.round((o.paid / o.total) * 100) : 0} tone="green" className="mt-3" />
          </Panel>
        </div>

        <Panel title="Audit Trail" subtitle={`${trail.length} recorded event${trail.length === 1 ? "" : "s"}`} action={<History className="size-4 text-sub" aria-hidden />} bodyClassName="space-y-4">
          <ol data-testid="audit-trail" className="space-y-4">
            {trail.map((a) => (
              <li key={a.id} data-audit-action={a.action} className="relative border-l-2 border-line pl-4">
                <span className={cx("absolute -left-[5px] top-1 size-2 rounded-full", a.override ? "bg-rose-500" : "bg-brand")} />
                <div className="flex flex-wrap items-center gap-1.5 text-[13px] font-bold">{labelOf(a)}{a.override && <Pill tone="red" className="!px-1.5 !py-0 !text-[10px]">override</Pill>}</div>
                {(a.from || a.to) && <div className="text-xs text-sub">{a.from}{a.from && a.to ? " → " : ""}{a.to}</div>}
                {a.detail && <div className="text-xs text-sub">{a.detail}</div>}
                {a.reason && <div className="text-xs text-sub">Reason: {a.reason}</div>}
                <div className="text-[11px] text-sub">{a.actor} ({a.role}) · {when(a.at)}</div>
              </li>
            ))}
            <li className="relative border-l-2 border-line pl-4">
              <span className="absolute -left-[5px] top-1 size-2 rounded-full bg-slate-400" />
              <div className="text-[13px] font-bold">Order created</div>
              <div className="text-xs text-sub">{o.workflow} · {o.size} · {o.pages} pages</div>
              <div className="text-[11px] text-sub">Order date {fmtDate(o.pendingAt)}</div>
            </li>
          </ol>
        </Panel>
      </div>

      <SlideOver open={convert} onClose={() => setConvert(false)} title="Convert to Design + Printing" footer={<><OutlineButton className="!h-11" onClick={() => setConvert(false)}>Cancel</OutlineButton><PrimaryButton icon={Repeat} onClick={() => { if (!reason.trim()) return; editOrder(o.id, { workflow: "Design + Printing" }, "workflow_convert", `Printing Only → Design + Printing. Reason: ${reason.trim()}`); setConvert(false); setReason(""); show("Converted — revised commercial approval required"); }}>Convert</PrimaryButton></>}>
        <p className="mb-4 text-sm text-sub">Colour Grading and Designing will be added to this order. A reason and revised commercial approval are required (SRS ALB-FR-0080).</p>
        <Field label="Reason" required><textarea className={`${inputCls} h-24 py-2`} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Customer supplied files need redesign" /></Field>
      </SlideOver>
      {reasonDlg}
      {toast}
    </>
  );
}

const Undo = () => <ChevronRight className="size-4 rotate-180" aria-hidden />;
