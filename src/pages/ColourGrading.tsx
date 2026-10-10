import { useMemo, useRef, useState } from "react";
import { ClipboardList, Settings, Users, RotateCcw, CheckCircle2, Clock, Image as ImageIcon, UploadCloud, Send, Save, Check, X, AlertCircle, Lock } from "lucide-react";
import { PageHeader, PrimaryButton, OutlineButton, MoreButton, SlideOver, Field, inputCls, KpiRow, Panel, Pill, Avatar, SearchInput, LineTabs, TodayChip, Pagination, PriorityPill, tableCls, Th, Td, trCls, cx, type Kpi } from "../components/ui";
import { ORDERS, PRIORITIES, type Priority, type Tone } from "../lib/data";
import { MultiSelect, Combobox } from "../components/controls";
import { useStore, useSlashFocus } from "../lib/store";
import { fmtDate, TODAY } from "../lib/format";
import { useToast } from "../components/Toast";
import { useAuth } from "../lib/auth";
import { fmtSize } from "../lib/files";
import { slaState } from "../lib/sla";
import { GJOBS, COLORISTS, ensureGradingJobs, gradedFiles, createGradingJob, startGrading, saveDraft, uploadGraded, submitGrading, approveGrading, rejectGrading, ackRevision, can, fmtDT, type GJob, type GStatus, type Out } from "../lib/production";

type Tab = "queue" | "progress" | "submitted" | "approved" | "rework";
const STATUS_TONE: Record<GStatus, Tone> = { New: "blue", "In Progress": "blue", Rework: "red", Submitted: "violet", Approved: "green" };
const inTab = (j: GJob, t: Tab) => t === "queue" ? ["New", "In Progress", "Rework"].includes(j.status) : t === "progress" ? j.status === "In Progress" : t === "submitted" ? j.status === "Submitted" : t === "approved" ? j.status === "Approved" : j.status === "Rework";
const ordOf = (id: string) => ORDERS.find((o) => o.id === id)!;

export default function ColourGrading() {
  const { role } = useAuth();
  const work = can(role, "grading");
  const isAdmin = role === "admin";
  ensureGradingJobs();
  useStore();
  const [tab, setTab] = useState<Tab>("queue");
  const [q, setQ] = useState("");
  const [col, setCol] = useState<string[]>([]);
  const [prio, setPrio] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [rejected, setRejected] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [draft, setDraft] = useState<Record<string, { d: string; n: string }>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const searchWrap = useRef<HTMLDivElement>(null);
  useSlashFocus(searchWrap);
  const [toast, show] = useToast();
  const pageSize = 12;
  const [creating, setCreating] = useState(false);
  const EMPTY = { order: "", colorist: "", priority: "Normal" as Priority, due: "", notes: "" };
  const [f, setF] = useState(EMPTY);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const run = (r: Out) => { show(r.msg); return r.ok; };
  const guard = (area: "grading") => { if (can(role, area)) return true; show(`Your role (${role}) cannot perform colour grading actions`); return false; };

  const base = useMemo(() => GJOBS.filter((j) => {
    const o = ordOf(j.orderId); if (!o) return false;
    const s = q.trim().toLowerCase();
    if (s && ![j.orderId, o.customer, o.event].some((v) => v.toLowerCase().includes(s))) return false;
    if (col.length && !col.includes(j.colorist)) return false;
    if (prio.length && !prio.includes(j.priority)) return false;
    return true;
  }), [q, col, prio, GJOBS.length, GJOBS.map((j) => j.status).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  const list = base.filter((j) => inTab(j, tab));
  const rows = list.slice((page - 1) * pageSize, page * pageSize);
  const cur = GJOBS.find((j) => j.orderId === activeId) ?? list[0] ?? null;
  const cnt = (s: GStatus) => GJOBS.filter((j) => j.status === s).length;
  const overdue = GJOBS.filter((j) => j.status !== "Approved" && j.status !== "Submitted" && ordOf(j.orderId) && new Date(j.due) < TODAY).length;

  const kpis: Kpi[] = [
    { label: "New Jobs", value: cnt("New"), icon: ClipboardList, tone: "blue" },
    { label: "In Progress", value: cnt("In Progress"), icon: Settings, tone: "blue" },
    { label: "Pending Admin Approval", value: cnt("Submitted"), icon: Users, tone: "pink" },
    { label: "Rework", value: cnt("Rework"), icon: RotateCcw, tone: "orange", invert: true },
    { label: "Approved", value: cnt("Approved"), icon: CheckCircle2, tone: "green" },
    { label: "Overdue", value: overdue, icon: Clock, tone: "red", invert: true },
  ];

  const addFiles = (fl: FileList | File[]) => {
    if (!cur || !guard("grading")) return;
    const bad: string[] = []; let n = 0;
    Array.from(fl).forEach((file) => {
      const r = uploadGraded(cur.orderId, file.name, file.size);
      if (r.ok) n++; else bad.push(r.msg);
    });
    setRejected(bad);
    if (n) show(`${n} graded file${n > 1 ? "s" : ""} added to ${cur.orderId}`);
    else if (bad[0]) show(bad[0]);
  };
  const saveJob = () => {
    const e: Record<string, string> = {};
    if (!f.order) e.order = "Pick an order";
    if (!f.colorist) e.colorist = "Assign a colorist";
    if (!f.due) e.due = "Choose a due date";
    setErrs(e);
    if (Object.keys(e).length) return;
    if (run(createGradingJob(f.order, { colorist: f.colorist, priority: f.priority, due: f.due, instructions: f.notes.trim() }))) { setActiveId(f.order); setTab("queue"); setPage(1); setCreating(false); setF(EMPTY); }
  };
  const available = ORDERS.filter((o) => o.stage === "files_received" && o.workflow !== "Printing" && !o.hold && !GJOBS.some((j) => j.orderId === o.id));

  const o = cur ? ordOf(cur.orderId) : null;
  const closed = !!o?.closed;
  const files = cur ? gradedFiles(cur.orderId) : [];
  const dr = cur ? (draft[cur.orderId] ?? { d: cur.draft ?? "", n: cur.internalNote }) : { d: "", n: "" };
  const sla = o ? slaState(o) : null;
  const canEdit = work && !closed;
  const tabs: { key: Tab; label: string }[] = [{ key: "queue", label: "My Queue" }, { key: "progress", label: "In Progress" }, { key: "submitted", label: "Submitted" }, { key: "approved", label: "Approved" }, { key: "rework", label: "Rework" }];

  const approve = (id: string) => { if (!isAdmin) { show("Only an admin can approve grading — graders cannot approve their own work"); return; } run(approveGrading(id)); };
  const doReject = (id: string) => { if (!isAdmin) { show("Only an admin can reject grading"); return; } if (run(rejectGrading(id, reason))) { setRejecting(false); setReason(""); } };
  const rowAction = (j: GJob) => {
    if (j.status === "New" && work) return { label: "Start", primary: true, run: () => { setActiveId(j.orderId); run(startGrading(j.orderId)); } };
    if (j.status === "Rework" && work) return { label: "Revise", run: () => setActiveId(j.orderId) };
    if (j.status === "In Progress" && work) return { label: "Continue", run: () => setActiveId(j.orderId) };
    return { label: "View", run: () => setActiveId(j.orderId) };
  };

  return (
    <div>
      <PageHeader title="Colour Grading" subtitle="Manage and process colour grading jobs for all orders.">
        <TodayChip />
        {isAdmin && <PrimaryButton onClick={() => setCreating(true)}>New Job</PrimaryButton>}
        <MoreButton />
      </PageHeader>
      {!work && <div role="status" className="mb-3 flex items-center gap-2 rounded-xl bg-amber-50 px-4 py-2 text-[13px] font-semibold text-amber-800"><Lock className="size-4" />View only — colour grading work is limited to the Colour Grading team and Admin.</div>}
      <KpiRow items={kpis} />

      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_440px]">
        <Panel bodyClassName="!p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <LineTabs<Tab> className="!border-0" value={tab} onChange={(t) => { setTab(t); setPage(1); }} tabs={tabs.map((t) => ({ ...t, count: base.filter((j) => inTab(j, t.key)).length }))} />
            <div ref={searchWrap} className="w-64"><SearchInput value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search by order ID, customer, event...  ( / )" /></div>
          </div>
          <div className="mt-3 flex justify-end gap-3">
            <MultiSelect className="w-40" label="Colorist" options={COLORISTS} value={col} onChange={(v) => { setCol(v); setPage(1); }} />
            <MultiSelect className="w-36" label="Priority" options={PRIORITIES} value={prio} onChange={(v) => { setPrio(v); setPage(1); }} />
            {(col.length > 0 || prio.length > 0) && <button onClick={() => { setCol([]); setPrio([]); }} className="text-xs font-bold text-brand">Clear</button>}
          </div>
          <div className="mt-3 overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><Th>Order ID</Th><Th>Customer</Th><Th>Event</Th><Th>Files</Th><Th>Colorist</Th><Th>Priority</Th><Th>SLA due</Th><Th>Status</Th><Th className="text-right">Actions</Th></tr></thead>
              <tbody>
                {rows.map((j) => {
                  const oo = ordOf(j.orderId); const a = rowAction(j); const s = slaState(oo);
                  return (
                    <tr key={j.orderId} data-testid={`job-${j.orderId}`} onClick={() => setActiveId(j.orderId)} className={cx(trCls, "cursor-pointer", cur?.orderId === j.orderId && "bg-brand-soft")}>
                      <Td className="font-bold">{j.orderId}</Td><Td>{oo.customer}</Td><Td>{oo.event}</Td>
                      <Td><span className="inline-flex items-center gap-1.5"><ImageIcon className="size-3.5 text-sub" />{gradedFiles(j.orderId).length}</span></Td>
                      <Td><span className="inline-flex items-center gap-2"><Avatar name={j.colorist} size={24} />{j.colorist}</span></Td>
                      <Td><PriorityPill p={j.priority as Priority} /></Td>
                      <Td className={s.status === "breached" ? "text-rose-600" : ""}>{fmtDate(j.due)}</Td>
                      <Td><Pill tone={STATUS_TONE[j.status]} className="min-w-[84px] justify-center">{j.status}</Pill></Td>
                      <Td className="text-right"><span className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                        {isAdmin && j.status === "Submitted" ? (<>
                          <button aria-label={`Approve ${j.orderId}`} onClick={() => approve(j.orderId)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"><Check className="size-3.5" />Approve</button>
                          <button aria-label={`Reject ${j.orderId}`} onClick={() => { setActiveId(j.orderId); setRejecting(true); }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-300 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50"><X className="size-3.5" />Reject</button>
                        </>) : (
                          <button onClick={a.run} className={cx("h-8 w-[84px] rounded-lg border text-xs font-bold", a.primary ? "border-brand bg-brand text-white hover:bg-brand-dark" : "border-line bg-white hover:bg-brand-soft")}>{a.label}</button>
                        )}
                      </span></Td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-sub">No jobs found.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={list.length} onPage={setPage} noun="jobs" />
        </Panel>

        {cur && o ? (
          <Panel bodyClassName="!p-5" className="xl:sticky xl:top-4">
            <div className="flex items-start justify-between">
              <div><h3 className="text-xl font-extrabold">{cur.orderId}</h3><div className="text-[13px] text-sub">{o.customer} • {o.event} • {o.size}</div></div>
              <Pill tone={STATUS_TONE[cur.status]}>{cur.status}</Pill>
            </div>
            {closed && <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold"><Lock className="size-3.5" />Order is closed — read-only</p>}
            <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px]">
              <div><dt className="text-xs text-sub">Assigned grader</dt><dd className="font-semibold">{cur.colorist}</dd></div>
              <div><dt className="text-xs text-sub">SLA due</dt><dd data-testid="sla-due" className={cx("font-semibold", sla?.status === "breached" && "text-rose-600")}>{sla?.dueAt ? fmtDate(sla.dueAt) : fmtDate(cur.due)}<span className="block text-[11px] font-normal text-sub">{sla ? sla.status.replace("_", " ") : ""}</span></dd></div>
              <div><dt className="text-xs text-sub">Rounds</dt><dd className="font-semibold">{cur.rounds}</dd></div>
            </dl>
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-[13px]"><div className="mb-1 text-xs font-bold uppercase text-sub">Grading instructions</div><p data-testid="instructions">{cur.instructions}</p></div>
            {cur.status === "Rework" && cur.revision && <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700"><b>Revision requested:</b> {cur.revision}</div>}

            <Field label="Internal note (not visible to client)">
              <textarea rows={2} disabled={!canEdit} className={cx(inputCls, "h-auto py-2")} value={dr.n} onChange={(e) => setDraft({ ...draft, [cur.orderId]: { ...dr, n: e.target.value } })} placeholder="Notes for the team…" />
            </Field>

            <div className="mb-1 text-sm font-extrabold">Graded files ({files.length})</div>
            <ul data-testid="file-list" className="space-y-1.5">
              {files.map((x) => (
                <li key={x.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-1.5 text-xs">
                  <ImageIcon className="size-4 text-sub" /><span className="min-w-0 flex-1 truncate font-semibold">{x.name}</span>
                  <span className="text-sub">v{x.version} · {fmtSize(x.size)}</span><Pill tone={x.state === "Approved" ? "green" : x.state === "Rejected" ? "red" : x.state === "Submitted" ? "violet" : "slate"}>{x.state}</Pill>
                </li>
              ))}
              {files.length === 0 && <li className="text-xs text-sub">No graded files yet.</li>}
            </ul>

            {canEdit && cur.status === "In Progress" && (<>
              <div data-testid="dropzone" role="button" tabIndex={0} aria-label="Upload graded files"
                onClick={() => fileInput.current?.click()} onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && fileInput.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
                onDrop={(e) => { e.preventDefault(); setDragOver(false); addFiles(e.dataTransfer.files); }}
                className={cx("mt-3 flex w-full cursor-pointer flex-col items-center gap-1 rounded-xl border border-dashed px-4 py-4 text-center transition", dragOver ? "border-brand bg-brand-soft ring-2 ring-brand/40" : "border-brand/50 bg-brand-soft/40")}>
                <span className="inline-flex items-center gap-2 font-extrabold"><UploadCloud className="size-5 text-brand" />{dragOver ? "Drop to upload" : cur.rounds > 0 ? "Upload revised version" : "Upload Graded Files"}</span>
                <span className="text-xs text-sub">Drag & drop or click · JPG, TIFF, ZIP · max 5 GB per file · new uploads become new versions</span>
              </div>
              <input ref={fileInput} data-testid="file-input" type="file" multiple accept=".jpg,.jpeg,.tif,.tiff,.zip" className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ""; }} />
            </>)}
            {rejected.length > 0 && (
              <ul data-testid="rejected" className="mt-2 space-y-1 rounded-lg bg-rose-50 p-2.5 text-xs font-semibold text-rose-600">
                {rejected.map((r) => <li key={r} className="flex items-start gap-1.5"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{r}</li>)}
              </ul>
            )}

            <div className="mt-4 flex flex-wrap gap-2">
              {canEdit && cur.status === "New" && <button onClick={() => run(startGrading(cur.orderId))} className="h-11 flex-1 rounded-xl border border-brand text-sm font-bold text-brand hover:bg-brand-soft">Start Grading</button>}
              {canEdit && cur.status === "Rework" && <button onClick={() => run(ackRevision(cur.orderId))} className="h-11 flex-1 rounded-xl border border-brand text-sm font-bold text-brand hover:bg-brand-soft">Acknowledge Revision</button>}
              {canEdit && cur.status === "In Progress" && <>
                <button onClick={() => run(saveDraft(cur.orderId, dr.d, dr.n))} className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-line text-sm font-bold hover:bg-brand-soft"><Save className="size-4" />Save Draft</button>
                <button onClick={() => run(submitGrading(cur.orderId))} className="inline-flex h-11 flex-[2] items-center justify-center gap-2 rounded-xl bg-brand text-sm font-bold text-white shadow-md shadow-brand/25 hover:bg-brand-dark"><Send className="size-4" />{cur.rounds > 0 ? "Resubmit to Admin" : "Submit to Admin"}</button>
              </>}
              {!work && cur.status !== "Approved" && <button onClick={() => show(`Your role (${role}) cannot perform colour grading actions`)} className="h-11 flex-1 rounded-xl border border-line text-sm font-bold text-sub">Grading actions unavailable</button>}
            </div>

            {cur.status === "Submitted" && !closed && (
              <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50/50 p-3">
                <div className="text-sm font-extrabold">Admin review</div>
                {isAdmin ? (<>
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => approve(cur.orderId)} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 text-sm font-bold text-white hover:bg-emerald-700"><Check className="size-4" />Approve → Designing</button>
                    <button onClick={() => setRejecting(!rejecting)} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-rose-300 text-sm font-bold text-rose-600 hover:bg-rose-50"><X className="size-4" />Reject</button>
                  </div>
                  {rejecting && (
                    <div className="mt-2 flex gap-2">
                      <input autoFocus aria-label="Rejection reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason for rejection (required)" className={inputCls} />
                      <button onClick={() => doReject(cur.orderId)} className="h-10 rounded-lg bg-rose-600 px-4 text-sm font-bold text-white">Send back</button>
                    </div>
                  )}
                </>) : (
                  <p className="mt-1 text-xs text-sub">Waiting for admin review. Graders cannot approve their own work.</p>
                )}
              </div>
            )}

            <div className="mt-4">
              <div className="mb-1 text-sm font-extrabold">History</div>
              <ul className="max-h-44 space-y-1.5 overflow-y-auto text-[12px]">
                {cur.events.map((h, i) => <li key={i} className="rounded-lg border border-line px-3 py-1.5"><b>{h.text}</b><span className="block text-sub">{h.by} · {fmtDT(h.at)}</span></li>)}
              </ul>
            </div>
          </Panel>
        ) : <Panel bodyClassName="!p-5"><p className="text-sm text-sub">Select a job to see its details.</p></Panel>}
      </div>

      <SlideOver open={creating} onClose={() => setCreating(false)} title="New Grading Job"
        footer={<><OutlineButton onClick={() => setCreating(false)}>Cancel</OutlineButton><PrimaryButton onClick={saveJob}>Create Job</PrimaryButton></>}>
        <Field label="Order" required>
          <Combobox error={!!errs.order} placeholder="Search files-received orders…" value={f.order}
            onChange={(v) => { const oo = ORDERS.find((x) => x.id === v); setF({ ...f, order: v, due: oo?.due ?? f.due }); }}
            options={available.map((x) => ({ value: x.id, label: x.id, sub: `${x.customer} · ${x.event}` }))} />
          {errs.order && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{errs.order}</p>}
          <span className="mt-1 block text-xs text-sub">Only Design + Printing orders at Files Received. Printing Only orders skip colour grading.</span>
        </Field>
        <Field label="Assignee" required>
          <Combobox error={!!errs.colorist} placeholder="Pick a colorist…" value={f.colorist} onChange={(v) => setF({ ...f, colorist: v })} options={COLORISTS.map((c) => ({ value: c, label: c }))} />
          {errs.colorist && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{errs.colorist}</p>}
        </Field>
        <Field label="Priority"><div className="flex flex-wrap gap-1.5">{PRIORITIES.map((p) => <button type="button" key={p} aria-pressed={f.priority === p} onClick={() => setF({ ...f, priority: p })} className={cx("rounded-full border px-3 py-1 text-xs font-bold", f.priority === p ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{p}</button>)}</div></Field>
        <Field label="Due date" required><input type="date" className={cx(inputCls, errs.due && "border-rose-400")} value={f.due} onChange={(e) => setF({ ...f, due: e.target.value })} />{errs.due && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{errs.due}</p>}</Field>
        <Field label="Grading instructions"><textarea rows={4} className={cx(inputCls, "h-auto py-2")} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
      </SlideOver>
      {toast}
    </div>
  );
}
