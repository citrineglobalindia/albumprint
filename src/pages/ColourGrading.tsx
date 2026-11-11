import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ClipboardList, Settings, Users, RotateCcw, CheckCircle2, Clock, Image as ImageIcon, Send, Save, Check, X, AlertCircle, Lock } from "lucide-react";
import { PageHeader, PrimaryButton, OutlineButton, MoreButton, SlideOver, Field, inputCls, KpiRow, Panel, Pill, Avatar, SearchInput, LineTabs, TodayChip, Pagination, PriorityPill, tableCls, Th, Td, trCls, cx, type Kpi } from "../components/ui";
import { JobProgress } from "../components/JobProgress";
import { PROGRESS, gradingBy, photosGiven, photosGraded, photosPending } from "../lib/jobProgress";
import { currentActor } from "../lib/audit";
import { AlbumProgress } from "../components/AlbumProgress";
import { WorkFiles } from "../components/WorkFiles";
import { ORDERS, PRIORITIES, type Priority, type Tone } from "../lib/data";
import { MultiSelect, Combobox, ColumnsMenu, DateRangePicker, FilterChips, SavedViews, SortTh, sortRows, type DateRange, type SortState } from "../components/controls";
import { ALL_TIME, desRange, inRangeOpt, rangeLabel, serRange, type SavedRange } from "../components/pageKit";
import { RowMenu } from "../components/RowMenu";
import { BulkBar, BulkBtn, ExportBtn, SelectTd, SelectTh, Toolbar, rangeChip, runBulk, useSelection } from "../components/listKit";
import { downloadCsv } from "../lib/csv";
import { useStore, useSlashFocus } from "../lib/store";
import { fmtDate, TODAY } from "../lib/format";
import { useToast } from "../components/Toast";
import { useAuth } from "../lib/auth";
import { FILES, uploadsRequired } from "../lib/files";
import { Elapsed, JobTimer } from "../components/JobTimer";
import { slaState } from "../lib/sla";
import { GJOBS, COLORISTS, ensureGradingJobs, no, gradedFiles, createGradingJob, startGrading, saveDraft, uploadGraded, submitGrading, approveGrading, rejectGrading, ackRevision, can, fmtDT, type GJob, type GStatus, type Out } from "../lib/production";

type Tab = "queue" | "progress" | "submitted" | "approved" | "rework";
const STATUS_TONE: Record<GStatus, Tone> = { New: "blue", "In Progress": "blue", Rework: "red", Submitted: "violet", Approved: "green" };
const inTab = (j: GJob, t: Tab) => t === "queue" ? ["New", "In Progress", "Rework"].includes(j.status) : t === "progress" ? j.status === "In Progress" : t === "submitted" ? j.status === "Submitted" : t === "approved" ? j.status === "Approved" : j.status === "Rework";
const ordOf = (id: string) => ORDERS.find((o) => o.id === id)!;
/** The grader of a job: the job's assignee; else the graders assigned to its albums; else whoever started it. */
const graderOf = (j: GJob): string => {
  if (j.colorist && j.colorist !== "Unassigned") return j.colorist;
  const albums = [...new Set(PROGRESS.filter((p) => p.orderId === j.orderId && p.dept === "grading" && (p.album ?? 0) > 0 && p.assignee).map((p) => p.assignee!))];
  if (albums.length) return albums.join(", ");
  const started = [...j.events].reverse().find((e) => e.text === "Grading started")?.by;
  return started && started !== "System" ? started : "Unassigned";
};
const COLS = [{ key: "order", label: "Order ID" }, { key: "customer", label: "Customer" }, { key: "event", label: "Event" }, { key: "files", label: "Files" }, { key: "graded", label: "Photos graded" }, { key: "pending", label: "Photos pending" }, { key: "colorist", label: "Colorist" }, { key: "priority", label: "Priority" }, { key: "due", label: "SLA due" }, { key: "time", label: "Time" }, { key: "status", label: "Status" }];
/** When the grading finished (the latest submission), or nothing while it is still being worked on. */
const gradEnd = (j: GJob) => (j.status === "Submitted" || j.status === "Approved" ? j.submittedAt : undefined);
interface ViewState { tab: Tab; col: string[]; prio: string[]; status: string[]; range: SavedRange; q: string; hidden: string[]; sort: SortState }
const PRIO_RANK: Record<string, number> = { Urgent: 0, High: 1, Normal: 2, Low: 3 };

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
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>(ALL_TIME());
  const [sort, setSort] = useState<SortState>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const sel = useSelection();
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [rejected, setRejected] = useState<string[]>([]);
  const [draft, setDraft] = useState<Record<string, { d: string; n: string }>>({});
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

  const vis = (k: string) => !hidden.includes(k);
  const reset = () => setPage(1);
  const base = GJOBS.filter((j) => {
    const o = ordOf(j.orderId); if (!o) return false;
    const t = q.trim().toLowerCase();
    if (t && ![j.orderId, o.customer, o.event].some((v) => v.toLowerCase().includes(t))) return false;
    if (col.length && !col.includes(j.colorist) && !col.some((c) => graderOf(j).split(", ").includes(c))) return false;
    if (prio.length && !prio.includes(j.priority)) return false;
    if (fStatus.length && !fStatus.includes(j.status)) return false;
    return inRangeOpt(j.due, range);
  });
  const list = sortRows(base.filter((j) => inTab(j, tab)), sort, (j, k) => {
    switch (k) { case "order": return j.orderId; case "customer": return ordOf(j.orderId).customer.toLowerCase(); case "event": return ordOf(j.orderId).event; case "files": return gradedFiles(j.orderId).length; case "colorist": return j.colorist; case "priority": return PRIO_RANK[j.priority] ?? 9; case "due": return j.due; default: return j.status; }
  });
  const rows = list.slice((page - 1) * pageSize, page * pageSize);
  const selected = sel.within(list.map((j) => j.orderId));
  const cur = GJOBS.find((j) => j.orderId === activeId) ?? null;
  const cnt = (s: GStatus) => GJOBS.filter((j) => j.status === s).length;
  const overdue = GJOBS.filter((j) => j.status !== "Approved" && j.status !== "Submitted" && ordOf(j.orderId) && new Date(j.due) < TODAY).length;

  const exportRows = (items: GJob[]) => { downloadCsv("grading-jobs.csv", [["Order", "Customer", "Event", "Colorist", "Priority", "Due", "Status", "Rounds", "Started", "Ended", "Minutes"], ...items.map((j) => [j.orderId, ordOf(j.orderId).customer, ordOf(j.orderId).event, j.colorist, j.priority, j.due, j.status, j.rounds, j.startedAt ?? "", gradEnd(j) ?? "", j.startedAt ? Math.round(((gradEnd(j) ? new Date(gradEnd(j)!).getTime() : Date.now()) - new Date(j.startedAt).getTime()) / 60000) : ""])]); show(`Exported ${items.length} jobs`); };
  const chips = [
    ...col.map((x) => ({ label: `Colorist: ${x}`, onRemove: () => setCol(col.filter((y) => y !== x)) })),
    ...prio.map((x) => ({ label: `Priority: ${x}`, onRemove: () => setPrio(prio.filter((y) => y !== x)) })),
    ...fStatus.map((x) => ({ label: `Status: ${x}`, onRemove: () => setFStatus(fStatus.filter((y) => y !== x)) })),
    ...rangeChip("Due", range.preset, rangeLabel(range), () => setRange(ALL_TIME())),
    ...(q ? [{ label: `Search: ${q}`, onRemove: () => setQ("") }] : []),
  ];
  const clearAll = () => { setCol([]); setPrio([]); setFStatus([]); setRange(ALL_TIME()); setQ(""); reset(); };
  const view: ViewState = { tab, col, prio, status: fStatus, range: serRange(range), q, hidden, sort };
  const applyView = (v: ViewState) => { setTab(v.tab); setCol(v.col); setPrio(v.prio); setFStatus(v.status); setRange(desRange(v.range)); setQ(v.q); setHidden(v.hidden); setSort(v.sort); reset(); };

  const kpis: Kpi[] = [
    { label: "New Jobs", value: cnt("New"), icon: ClipboardList, tone: "blue" },
    { label: "In Progress", value: cnt("In Progress"), icon: Settings, tone: "blue" },
    { label: "Pending Admin Approval", value: cnt("Submitted"), icon: Users, tone: "pink" },
    { label: "Rework", value: cnt("Rework"), icon: RotateCcw, tone: "orange", invert: true },
    { label: "Approved", value: cnt("Approved"), icon: CheckCircle2, tone: "green" },
    { label: "Overdue", value: overdue, icon: Clock, tone: "red", invert: true },
  ];
  // photo counts: everything for the admin, otherwise the jobs this person works on (assigned, or their own updates)
  const me = currentActor().name;
  const mine = isAdmin ? GJOBS : GJOBS.filter((j) => graderOf(j).split(", ").includes(me) || gradingBy(j.orderId).has(me));
  const worked = mine.filter((j) => j.status !== "New" || (photosGraded(j.orderId) ?? 0) > 0);
  const photoKpis: Kpi[] = [
    { label: isAdmin ? "Photos graded (all)" : "Photos graded by you", value: worked.reduce((s, j) => s + (photosGraded(j.orderId) ?? 0), 0), icon: CheckCircle2, tone: "green" },
    { label: "Photos pending", value: mine.filter((j) => j.status !== "Approved").reduce((s, j) => s + (photosPending(j.orderId) ?? 0), 0), icon: Clock, tone: "orange" },
    { label: isAdmin ? "Projects worked (all)" : "Projects you worked on", value: worked.length, icon: ClipboardList, tone: "blue" },
    { label: "Projects completed", value: worked.filter((j) => j.status === "Approved" || j.status === "Submitted").length, icon: CheckCircle2, tone: "green" },
  ];

  const saveJob = () => {
    const e: Record<string, string> = {};
    if (!f.order) e.order = "Pick an order";
    if (!f.colorist) e.colorist = "Assign a colorist";
    if (!f.due) e.due = "Choose a due date";
    setErrs(e);
    if (Object.keys(e).length) return;
    if (run(createGradingJob(f.order, { colorist: f.colorist, priority: f.priority, due: f.due, instructions: f.notes.trim() }))) { setActiveId(f.order); setTab("queue"); setPage(1); setCreating(false); setF(EMPTY); }
  };
  // orders at Files Received, plus (backend) orders another route already moved to Colour Grading that still have no grader
  const available = ORDERS.filter((o) => o.workflow !== "Printing" && !o.hold && ((o.stage === "files_received" && !GJOBS.some((j) => j.orderId === o.id)) || (o.stage === "colour_grading" && GJOBS.some((j) => j.orderId === o.id && j.colorist === "Unassigned"))));

  const o = cur ? ordOf(cur.orderId) : null;
  const closed = !!o?.closed;
  const files = cur ? gradedFiles(cur.orderId) : [];
  const uploading = cur ? FILES.filter((x) => x.orderId === cur.orderId && x.category === "Graded" && x.pending) : [];
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
      <KpiRow items={kpis} cols={6} />
      <div className="mt-3" data-testid="photo-kpis"><KpiRow items={photoKpis} cols={4} /></div>

      <Panel title="Grading Jobs" subtitle="Click a job for instructions, graded files and review" action={<ExportBtn onClick={() => exportRows(list)} />} bodyClassName="!p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <LineTabs<Tab> className="!border-0" value={tab} onChange={(t) => { setTab(t); reset(); }} tabs={tabs.map((t) => ({ ...t, count: base.filter((j) => inTab(j, t.key)).length }))} />
          <div ref={searchWrap} className="w-64"><SearchInput value={q} onChange={(v) => { setQ(v); reset(); }} placeholder="Search by order ID, customer, event...  ( / )" /></div>
        </div>
        <div className="mt-3"><Toolbar right={<><SavedViews<ViewState> storageKey="colour-grading" current={view} onApply={applyView} /><ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} /></>}>
          <DateRangePicker value={range} onChange={(r) => { setRange(r); reset(); }} align="left" />
          <MultiSelect className="w-40" label="Colorist" options={COLORISTS} value={col} onChange={(v) => { setCol(v); reset(); }} />
          <MultiSelect className="w-36" label="Priority" options={PRIORITIES} value={prio} onChange={(v) => { setPrio(v); reset(); }} />
          <MultiSelect className="w-40" label="Status" options={["New", "In Progress", "Submitted", "Rework", "Approved"]} value={fStatus} onChange={(v) => { setFStatus(v); reset(); }} />
        </Toolbar></div>
        <FilterChips chips={chips} onClearAll={clearAll} />
        <BulkBar count={selected.length} onClear={sel.clear}>
          {work && <BulkBtn tone="primary" testid="bulk-start" onClick={() => { if (guard("grading")) runBulk(selected, (id) => startGrading(id), show, "Started"); }}>Start selected</BulkBtn>}
          {isAdmin && <BulkBtn testid="bulk-approve" onClick={() => runBulk(selected, (id) => (isAdmin ? approveGrading(id) : no("Only an admin can approve grading")), show, "Approved")}><Check className="size-3.5" />Approve selected</BulkBtn>}
          <BulkBtn testid="bulk-export" onClick={() => exportRows(GJOBS.filter((j) => selected.includes(j.orderId)))}>Export selected</BulkBtn>
        </BulkBar>
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead><tr>
              <SelectTh rows={rows.map((j) => j.orderId)} sel={sel} />
              {vis("order") && <SortTh k="order" sort={sort} onSort={setSort}>Order ID</SortTh>}
              {vis("customer") && <SortTh k="customer" sort={sort} onSort={setSort}>Customer</SortTh>}
              {vis("event") && <SortTh k="event" sort={sort} onSort={setSort}>Event</SortTh>}
              {vis("files") && <SortTh k="files" sort={sort} onSort={setSort}>Files</SortTh>}
              {vis("graded") && <Th>Photos graded</Th>}
              {vis("pending") && <Th>Photos pending</Th>}
              {vis("colorist") && <SortTh k="colorist" sort={sort} onSort={setSort}>Colorist</SortTh>}
              {vis("priority") && <SortTh k="priority" sort={sort} onSort={setSort}>Priority</SortTh>}
              {vis("due") && <SortTh k="due" sort={sort} onSort={setSort}>SLA due</SortTh>}
              {vis("time") && <Th>Time</Th>}
              {vis("status") && <SortTh k="status" sort={sort} onSort={setSort}>Status</SortTh>}
              <Th className="text-right">Actions</Th>
            </tr></thead>
            <tbody>
              {rows.map((j) => {
                const oo = ordOf(j.orderId); const a = rowAction(j); const s = slaState(oo);
                return (
                  <tr key={j.orderId} data-testid={`job-${j.orderId}`} onClick={() => setActiveId(j.orderId)} className={cx(trCls, "cursor-pointer", (cur?.orderId === j.orderId || sel.has(j.orderId)) && "bg-brand-soft")}>
                    <SelectTd id={j.orderId} sel={sel} />
                    {vis("order") && <Td className="font-bold">{j.orderId}</Td>}
                    {vis("customer") && <Td>{oo.customer}</Td>}
                    {vis("event") && <Td>{oo.event}</Td>}
                    {vis("files") && <Td><span className="inline-flex items-center gap-1.5"><ImageIcon className="size-3.5 text-sub" />{gradedFiles(j.orderId).length}</span></Td>}
                    {vis("graded") && <Td>{(() => { const g = photosGraded(j.orderId), t = photosGiven(j.orderId); return g == null && t == null ? <span className="text-sub">—</span> : <span data-testid={`graded-${j.orderId}`} className="font-semibold text-emerald-700">{g ?? 0}{t ? <span className="font-normal text-sub"> / {t}</span> : null}</span>; })()}</Td>}
                    {vis("pending") && <Td>{(() => { const p = photosPending(j.orderId); return <span data-testid={`pending-${j.orderId}`}>{p == null ? <span className="text-sub">—</span> : p === 0 ? <Pill tone="green">All done</Pill> : <Pill tone="amber">{p} pending</Pill>}</span>; })()}</Td>}
                    {vis("colorist") && <Td><span className="inline-flex items-center gap-2" data-testid={`grader-${j.orderId}`}><Avatar name={graderOf(j)} size={24} />{graderOf(j)}</span></Td>}
                    {vis("priority") && <Td><PriorityPill p={j.priority as Priority} /></Td>}
                    {vis("due") && <Td className={s.status === "breached" ? "text-rose-600" : ""}>{fmtDate(j.due)}</Td>}
                    {vis("time") && <Td><Elapsed start={j.startedAt} end={gradEnd(j)} /></Td>}
                    {vis("status") && <Td><Pill tone={STATUS_TONE[j.status]} className="min-w-[84px] justify-center">{j.status}</Pill></Td>}
                    <Td className="text-right"><span className="inline-flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      {isAdmin && j.status === "Submitted" ? (<>
                        <button aria-label={`Approve ${j.orderId}`} onClick={() => approve(j.orderId)} className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"><Check className="size-3.5" />Approve</button>
                        <button aria-label={`Reject ${j.orderId}`} onClick={() => { setActiveId(j.orderId); setRejecting(true); }} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-300 px-3 text-xs font-bold text-rose-600 hover:bg-rose-50"><X className="size-3.5" />Reject</button>
                      </>) : (
                        <button onClick={a.run} className={cx("h-8 w-[84px] rounded-lg border text-xs font-bold", a.primary ? "border-brand bg-brand text-white hover:bg-brand-dark" : "border-line bg-white hover:bg-brand-soft")}>{a.label}</button>
                      )}
                      <RowMenu label={`Actions for ${j.orderId}`} items={[
                        { label: "View job", onClick: () => setActiveId(j.orderId) },
                        ...(j.status === "New" ? [{ label: "Start grading", onClick: () => { if (guard("grading")) run(startGrading(j.orderId)); } }] : []),
                        ...(j.status === "Rework" ? [{ label: "Acknowledge revision", onClick: () => { if (guard("grading")) run(ackRevision(j.orderId)); } }] : []),
                        ...(j.status === "Submitted" ? [{ label: "Approve → Designing", onClick: () => approve(j.orderId) }, { label: "Reject…", onClick: () => { setActiveId(j.orderId); setRejecting(true); }, danger: true }] : []),
                        { label: "Export row", onClick: () => exportRows([j]) },
                        { label: "Open order", onClick: () => nav(`/orders/${j.orderId}`) },
                      ]} />
                    </span></Td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-sub">No jobs found.</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={pageSize} total={list.length} onPage={setPage} noun="jobs" />
      </Panel>

      <SlideOver open={!!cur && !!o} onClose={() => { setActiveId(null); setRejecting(false); }} title={cur ? `Grading ${cur.orderId}` : "Grading"} width={520}>
        {cur && o && (
          <div>
            <div className="flex items-start justify-between">
              <div><h3 className="text-xl font-extrabold">{cur.orderId}</h3><div className="text-[13px] text-sub">{o.customer} • {o.event} • {o.size}</div></div>
              <Pill tone={STATUS_TONE[cur.status]}>{cur.status}</Pill>
            </div>
            {closed && <p className="mt-2 flex items-center gap-1.5 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-semibold"><Lock className="size-3.5" />Order is closed — read-only</p>}
            <dl className="mt-3 grid grid-cols-3 gap-3 text-[13px]">
              <div><dt className="text-xs text-sub">Assigned grader</dt><dd className="font-semibold" data-testid="assigned-grader">{graderOf(cur)}</dd></div>
              <div><dt className="text-xs text-sub">SLA due</dt><dd data-testid="sla-due" className={cx("font-semibold", sla?.status === "breached" && "text-rose-600")}>{sla?.dueAt ? fmtDate(sla.dueAt) : fmtDate(cur.due)}<span className="block text-[11px] font-normal text-sub">{sla ? sla.status.replace("_", " ") : ""}</span></dd></div>
              <div><dt className="text-xs text-sub">Rounds</dt><dd className="font-semibold">{cur.rounds}</dd></div>
            </dl>
            <JobProgress orderId={cur.orderId} dept="grading" countLabel="Photos graded" of={photosGiven(cur.orderId)} onDone={(m) => show(m)} />
            {o && <div className="mt-3"><AlbumProgress o={o} only={["grading"]} onDone={(m) => show(m)} /></div>}
            <JobTimer start={cur.startedAt} end={gradEnd(cur)} label="Grading time" paused={o.hold ? "On hold" : undefined} />
            <div className="mt-3 rounded-xl bg-slate-50 p-3 text-[13px]"><div className="mb-1 text-xs font-bold uppercase text-sub">Grading instructions</div><p data-testid="instructions">{cur.instructions}</p></div>
            {cur.status === "Rework" && cur.revision && <div role="alert" className="mt-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700"><b>Revision requested:</b> {cur.revision}</div>}

            <Field label="Internal note (not visible to client)">
              <textarea rows={2} disabled={!canEdit} className={cx(inputCls, "h-auto py-2")} value={dr.n} onChange={(e) => setDraft({ ...draft, [cur.orderId]: { ...dr, n: e.target.value } })} placeholder="Notes for the team…" />
            </Field>

            <WorkFiles orderId={cur.orderId}
              inputs={[{ category: "Source Photos", label: "Photos to grade (from the customer)" }]}
              output={{ category: "Graded", label: cur.rounds > 0 ? "Graded photos (upload the revised version)" : "Graded photos" }}
              upload={canEdit && cur.status === "In Progress" ? (file) => { if (!guard("grading")) return { ok: false, msg: "You can't upload to this job" }; const r = uploadGraded(cur.orderId, file.name, file.size, file); return { ok: r.ok, msg: r.msg }; } : undefined}
              accept=".jpg,.jpeg,.png,.tif,.tiff,.pdf,.zip" hint="Images (JPG, PNG, TIFF) or PDF · ZIP for many files"
              onMessage={(m, ok) => { setRejected(ok ? [] : m.split(" · ")); if (ok) show(m); }} />
            {files.length === 0 && uploading.length === 0 && <p className="mt-1 text-xs text-sub" data-testid="no-files">No graded files yet.{!uploadsRequired() && " Uploading is optional: you can submit without files (e.g. put the drive link in the internal note)."}</p>}
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
                    </div>
        )}
      </SlideOver>

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
