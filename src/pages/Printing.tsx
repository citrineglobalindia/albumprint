import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Printer, PlayCircle, Layers, BookOpen, Package, ShieldCheck, Flag, FileText, ArrowRight, CheckCircle2, Circle, CalendarDays, Download, ChevronLeft } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, Thumb, SearchInput, Pagination, Td, trCls, tableCls, LinkAction, PrimaryButton, TodayChip, MoreButton, SlideOver, Field, inputCls, cx, TONE, type Kpi } from "../components/ui";
import { ColumnsMenu, Combobox, DateRangePicker, FilterChips, MultiSelect, SavedViews, SortTh, sortRows, type DateRange, type SortState } from "../components/controls";
import { ALL_TIME, Banner, DateField, Err, FieldBox, StatusMenu, TODAY_ISO, desRange, inRangeOpt, orderOpt, rangeLabel, serRange, strOpts, usePersisted, useSlashSearch, type SavedRange } from "../components/pageKit";
import { RowMenu } from "../components/RowMenu";
import { useToast } from "../components/Toast";
import { ORDERS, ASSIGNEES, type Order, type Tone } from "../lib/data";
import { fmtDate, inr } from "../lib/format";
import { downloadCsv } from "../lib/csv";

type PStage = "Waiting for Print" | "Printing" | "Lamination" | "Binding" | "Packaging" | "Sent to QC" | "Completed";
const PSTAGES: { key: PStage; tone: Tone; icon: typeof Printer }[] = [
  { key: "Waiting for Print", tone: "violet", icon: Printer },
  { key: "Printing", tone: "blue", icon: PlayCircle },
  { key: "Lamination", tone: "pink", icon: Layers },
  { key: "Binding", tone: "orange", icon: BookOpen },
  { key: "Packaging", tone: "amber", icon: Package },
  { key: "Sent to QC", tone: "green", icon: ShieldCheck },
  { key: "Completed", tone: "teal", icon: Flag },
];
const QC_IDX = 5;
const PAPERS = ["Sapphire Matte", "Lustre", "Matte", "Silk", "Glossy"];
const OPERATORS = ["Suresh", "Ramesh", "Divya", "Manoj", "Admin", "Karthik", "Anil"];

interface Job { id: string; order: Order; stage: PStage; paper: string; sheets: number; copies: number; operator: string; due: string; history: Partial<Record<PStage, string>>; cover?: string; lamination?: string; box?: string; finishing?: string }

const buildJobs = (): Job[] =>
  ORDERS.filter((o) => ["printing", "qc", "ready_for_delivery", "delivered"].includes(o.stage)).map((o, i) => ({
    id: o.id, order: o, stage: o.stage === "printing" ? PSTAGES[i % 5]!.key : o.stage === "qc" ? "Sent to QC" : "Completed", paper: PAPERS[i % PAPERS.length]!,
    sheets: o.pages, copies: 1 + (i % 3), operator: OPERATORS[i % OPERATORS.length]!, due: o.due, history: {},
  }));

const TL_DATES = ["30 Sep 2026, 10:15 AM", "30 Sep 2026, 04:20 PM", "1 Oct 2026, 11:30 AM"];
const stageInfo = (s: PStage) => PSTAGES.find((x) => x.key === s)!;
const stageIdx = (s: PStage) => PSTAGES.findIndex((x) => x.key === s);
const nowStr = () => `${fmtDate("2026-10-03")}, ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;

/** Keep the shared order stage in step with the production stage. */
function syncOrder(j: Job, stage: PStage) {
  const o = ORDERS.find((x) => x.id === j.order.id);
  if (!o) return;
  if (stageIdx(stage) >= QC_IDX) { if (o.stage === "printing" || o.stage === "final_approval") o.stage = "qc"; }
  else if (o.stage === "qc" || o.stage === "final_approval") o.stage = "printing";
}

const COLS = [{ key: "id", label: "Order ID" }, { key: "customer", label: "Customer" }, { key: "specs", label: "Album Specs" }, { key: "paper", label: "Paper Type" }, { key: "sheets", label: "Sheets" }, { key: "copies", label: "Copies" }, { key: "stage", label: "Current Stage" }, { key: "operator", label: "Operator" }, { key: "due", label: "Due Date" }];
interface ViewState { stages: string[]; ops: string[]; papers: string[]; range: SavedRange; q: string; hidden: string[]; sort: SortState }
const blankForm = () => ({ order: "", paper: PAPERS[0]!, sheets: "", copies: "1", operator: OPERATORS[0]!, due: "" });

export default function Printing() {
  const [jobs, setJobs] = usePersisted<Job[]>("printing.jobs", buildJobs);
  const [fStage, setFStage] = useState<string[]>([]);
  const [fOp, setFOp] = useState<string[]>([]);
  const [fPaper, setFPaper] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>(ALL_TIME());
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const nav = useNavigate();
  const [toast, show] = useToast();
  const jobsRef = useRef<HTMLDivElement>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [form, setForm] = useState(blankForm);
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [spec, setSpec] = useState({ paper: "", sheets: "", copies: "", cover: "", lamination: "", box: "", finishing: "" });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropOver, setDropOver] = useState<PStage | null>(null);
  const [bulkOp, setBulkOp] = useState("");
  useSlashSearch();

  useEffect(() => { setPage(1); }, [fStage, fOp, fPaper, range, q]);

  const counts = useMemo(() => Object.fromEntries(PSTAGES.map((s) => [s.key, jobs.filter((j) => j.stage === s.key).length])) as Record<PStage, number>, [jobs]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const list = jobs.filter((j) => (!fStage.length || fStage.includes(j.stage)) && (!fOp.length || fOp.includes(j.operator)) && (!fPaper.length || fPaper.includes(j.paper)) && inRangeOpt(j.due, range) && (!t || `${j.id} ${j.order.customer} ${j.operator}`.toLowerCase().includes(t)));
    return sortRows(list, sort, (j, k) => {
      switch (k) { case "id": return j.id; case "customer": return j.order.customer.toLowerCase(); case "specs": return j.order.size; case "paper": return j.paper; case "sheets": return j.sheets; case "copies": return j.copies; case "stage": return stageIdx(j.stage); case "operator": return j.operator; default: return j.due; }
    });
  }, [jobs, fStage, fOp, fPaper, range, q, sort]);
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const sel = jobs.find((j) => j.id === selId) ?? null;
  const selIdx = sel ? stageIdx(sel.stage) : 0;

  const patchJob = (id: string, p: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...p } : j)));
  const moveJob = (id: string, to: PStage, quiet = false) => {
    const j = jobs.find((x) => x.id === id);
    if (!j || j.stage === to) return false;
    syncOrder(j, to);
    patchJob(id, { stage: to, history: { ...j.history, [to]: nowStr() } });
    if (!quiet) show(to === "Sent to QC" ? `${id} sent to QC - order moved to QC stage` : `${id} moved to ${to}`);
    return true;
  };
  const advanceJob = (id: string, quiet = false) => { const j = jobs.find((x) => x.id === id); if (!j) return false; const i = stageIdx(j.stage); return i < PSTAGES.length - 1 ? moveJob(id, PSTAGES[i + 1]!.key, quiet) : false; };
  const bulkAdvance = () => { let n = 0; checked.forEach((id) => { if (advanceJob(id, true)) n++; }); show(`Advanced ${n} job(s) to the next stage`); setChecked(new Set()); };
  const bulkAssign = (op: string) => { checked.forEach((id) => patchJob(id, { operator: op })); show(`Assigned ${checked.size} job(s) to ${op}`); setBulkOp(""); setChecked(new Set()); };

  /* new job */
  const eligible = ORDERS.filter((o) => o.stage === "final_approval");
  const fOrder = ORDERS.find((o) => o.id === form.order);
  const pickOrder = (id: string) => { const o = ORDERS.find((x) => x.id === id)!; setForm((f) => ({ ...f, order: id, sheets: String(o.pages), due: o.due })); setErrs({}); };
  const submitNew = () => {
    const e: Record<string, string> = {};
    if (!fOrder) e.order = "Select an order at Final Approval";
    if (!(Number.isInteger(Number(form.sheets)) && Number(form.sheets) > 0)) e.sheets = "Enter a whole number of sheets";
    if (!(Number.isInteger(Number(form.copies)) && Number(form.copies) >= 1 && Number(form.copies) <= 50)) e.copies = "Copies must be between 1 and 50";
    if (!form.due) e.due = "Choose a due date"; else if (form.due < TODAY_ISO) e.due = "Due date cannot be in the past";
    setErrs(e);
    if (Object.keys(e).length || !fOrder) return;
    const reruns = jobs.filter((j) => j.order.id === fOrder.id).length;
    const job: Job = { id: reruns ? `${fOrder.id}-R${reruns}` : fOrder.id, order: fOrder, stage: "Waiting for Print", paper: form.paper, sheets: Number(form.sheets), copies: Number(form.copies), operator: form.operator, due: form.due, history: { "Waiting for Print": nowStr() } };
    fOrder.stage = "printing";
    setJobs((js) => [job, ...js]);
    setSelId(job.id); setFStage([]); setSort(null); setPage(1); setNewOpen(false);
    show(`Print job ${job.id} created - order moved to Printing`);
  };
  const openSpec = (j: Job) => {
    setSpec({ paper: j.paper, sheets: String(j.sheets), copies: String(j.copies), cover: j.cover ?? "Acrylic Photo Cover", lamination: j.lamination ?? "Matte Lamination (Both Sides)", box: j.box ?? "Premium Magnetic Box, Black with Gold Foil", finishing: j.finishing ?? "Spot UV on Cover" });
    setErrs({}); setSelId(j.id); setSpecOpen(true);
  };
  const saveSpec = () => {
    const e: Record<string, string> = {};
    if (!(Number(spec.sheets) > 0)) e.sheets = "Enter number of sheets";
    if (!(Number(spec.copies) > 0)) e.copies = "Enter copies";
    setErrs(e);
    if (Object.keys(e).length || !sel) return;
    patchJob(sel.id, { paper: spec.paper, sheets: Number(spec.sheets), copies: Number(spec.copies), cover: spec.cover, lamination: spec.lamination, box: spec.box, finishing: spec.finishing });
    setSpecOpen(false); show("Print specifications updated");
  };

  const kpis: Kpi[] = [
    { label: "Waiting for Printing", value: counts["Waiting for Print"], delta: 20, icon: Printer, tone: "blue" },
    { label: "Printing Started", value: counts.Printing, delta: 12, icon: PlayCircle, tone: "teal" },
    { label: "Lamination", value: counts.Lamination, delta: -5, icon: Layers, tone: "pink" },
    { label: "Binding", value: counts.Binding, delta: 10, icon: BookOpen, tone: "orange" },
    { label: "Packaging", value: counts.Packaging, delta: 33, icon: Package, tone: "pink" },
    { label: "Sent to QC", value: counts["Sent to QC"], delta: 18, icon: ShieldCheck, tone: "green" },
    { label: "Production Completed", value: counts.Completed, delta: 26, icon: Flag, tone: "pink" },
  ];

  const timeline = sel ? [
    { label: "Order Received", sub: TL_DATES[0]!, by: "by Admin", done: true, current: false },
    { label: "Design Approved", sub: TL_DATES[1]!, by: "by Design Team", done: true, current: false },
    ...PSTAGES.map((s, i) => ({
      label: s.key === "Printing" ? "Printing Started" : s.key,
      sub: sel.history[s.key] ?? (i <= selIdx ? TL_DATES[2]! : ""),
      by: `by ${sel.operator}`,
      done: i < selIdx || (s.key === "Completed" && i === selIdx),
      current: i === selIdx && s.key !== "Completed",
    })),
  ] : [];

  const chips = [
    ...fStage.map((s) => ({ label: `Stage: ${s}`, onRemove: () => setFStage(fStage.filter((x) => x !== s)) })),
    ...fOp.map((s) => ({ label: `Operator: ${s}`, onRemove: () => setFOp(fOp.filter((x) => x !== s)) })),
    ...fPaper.map((s) => ({ label: `Paper: ${s}`, onRemove: () => setFPaper(fPaper.filter((x) => x !== s)) })),
    ...(range.preset !== "All Time" ? [{ label: `Due: ${range.preset === "Custom" ? rangeLabel(range) : range.preset}`, onRemove: () => setRange(ALL_TIME()) }] : []),
    ...(q ? [{ label: `Search: ${q}`, onRemove: () => setQ("") }] : []),
  ];
  const clearAll = () => { setFStage([]); setFOp([]); setFPaper([]); setRange(ALL_TIME()); setQ(""); };
  const view: ViewState = { stages: fStage, ops: fOp, papers: fPaper, range: serRange(range), q, hidden, sort };
  const applyView = (v: ViewState) => { setFStage(v.stages); setFOp(v.ops); setFPaper(v.papers); setRange(desRange(v.range)); setQ(v.q); setHidden(v.hidden); setSort(v.sort); };
  const vis = (k: string) => !hidden.includes(k);
  const toggleStage = (s: PStage) => setFStage((f) => (f.length === 1 && f[0] === s ? [] : [s]));

  return (
    <div className="min-w-0">
      <PageHeader title="Printing" subtitle="Manage and track all printing operations for album production">
        <TodayChip />
        <PrimaryButton onClick={() => { setForm(blankForm()); setErrs({}); setNewOpen(true); }}>New Print Job</PrimaryButton>
        <MoreButton />
      </PageHeader>
      <KpiRow items={kpis} />

      <div className="min-w-0 space-y-4">
        <Panel title="Printing Production Pipeline" subtitle="Click a stage to filter - drag a job row onto a stage to move it." action={<LinkAction onClick={() => { clearAll(); jobsRef.current?.scrollIntoView({ behavior: "smooth" }); show("Showing all print jobs"); }}>View Full Pipeline →</LinkAction>} bodyClassName="pt-3">
          <div className="flex items-center gap-1.5">
            <button onClick={() => setFStage([])} className={cx("min-w-0 flex-1 rounded-xl border p-2.5 text-center", fStage.length === 0 ? "border-brand ring-2 ring-brand/30" : "border-transparent", "bg-sky-50")}>
              <FileText className="mx-auto size-5 text-sky-600" /><div className="truncate text-[11px] text-sub">All Jobs</div><div className="text-lg font-extrabold">{jobs.length}</div>
            </button>
            {PSTAGES.map((s) => (
              <div key={s.key} className="flex min-w-0 flex-1 items-center gap-1.5">
                <ArrowRight className="size-3 shrink-0 text-slate-400" />
                <button data-stage={s.key} onClick={() => toggleStage(s.key)}
                  onDragOver={(e) => { if (dragId) { e.preventDefault(); setDropOver(s.key); } }} onDragLeave={() => setDropOver(null)}
                  onDrop={(e) => { e.preventDefault(); setDropOver(null); if (dragId) moveJob(dragId, s.key); setDragId(null); }}
                  className={cx("min-w-0 flex-1 rounded-xl border p-2.5 text-center transition", TONE[s.tone].soft, fStage.includes(s.key) ? "border-brand ring-2 ring-brand/30" : "border-transparent", dropOver === s.key && "scale-105 border-dashed !border-brand ring-2 ring-brand")}>
                  <s.icon className={cx("mx-auto size-5", TONE[s.tone].text)} /><div className="truncate text-[11px] text-sub">{s.key}</div><div className="text-lg font-extrabold">{counts[s.key]}</div>
                </button>
              </div>
            ))}
          </div>
        </Panel>

        <div ref={jobsRef} />
        <Panel title="Printing Jobs" subtitle="Click a row for job details and stage actions" action={<button onClick={() => { downloadCsv("print-jobs.csv", [["Order", "Customer", "Stage", "Paper", "Sheets", "Copies", "Operator", "Due"], ...filtered.map((j) => [j.id, j.order.customer, j.stage, j.paper, j.sheets, j.copies, j.operator, j.due])]); show(`Exported ${filtered.length} jobs`); }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-brand-soft"><Download className="size-4 text-sub" />Export</button>}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <DateRangePicker value={range} onChange={setRange} align="left" />
            <MultiSelect className="w-44" label="Stage" options={PSTAGES.map((s) => s.key)} value={fStage} onChange={setFStage} />
            <MultiSelect className="w-40" label="Operator" options={OPERATORS} value={fOp} onChange={setFOp} />
            <MultiSelect className="w-40" label="Paper" options={PAPERS} value={fPaper} onChange={setFPaper} />
            <SearchInput className="w-60" value={q} onChange={setQ} placeholder="Search order, customer... ( / )" />
            <div className="ml-auto flex gap-2">
              <SavedViews<ViewState> storageKey="printing" current={view} onApply={applyView} />
              <ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} />
            </div>
          </div>
          <FilterChips chips={chips} onClearAll={clearAll} />
          {checked.size > 0 && (
            <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl bg-brand-soft px-4 py-2 text-[13px] font-semibold">
              {checked.size} selected
              <button onClick={bulkAdvance} className="rounded-lg bg-brand px-3 py-1 text-xs font-bold text-white">Advance selected</button>
              <Combobox className="w-44" placeholder="Assign operator…" value={bulkOp} onChange={bulkAssign} options={strOpts(OPERATORS)} />
              <button onClick={() => { downloadCsv("print-jobs.csv", [["Order", "Customer", "Stage", "Paper", "Sheets", "Copies", "Operator"], ...jobs.filter((j) => checked.has(j.id)).map((j) => [j.id, j.order.customer, j.stage, j.paper, j.sheets, j.copies, j.operator])]); show("Exported selected jobs"); }} className="rounded-lg border border-line bg-white px-3 py-1 text-xs font-bold">Export</button>
              <button onClick={() => setChecked(new Set())} className="ml-auto text-xs font-bold text-brand">Clear</button>
            </div>
          )}
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr>
                <th className="px-3 py-3"><input aria-label="Select all" type="checkbox" checked={rows.length > 0 && rows.every((r) => checked.has(r.id))} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>
                {vis("id") && <SortTh k="id" sort={sort} onSort={setSort}>Order ID</SortTh>}
                {vis("customer") && <SortTh k="customer" sort={sort} onSort={setSort}>Customer</SortTh>}
                {vis("specs") && <SortTh k="specs" sort={sort} onSort={setSort}>Album Specs</SortTh>}
                {vis("paper") && <SortTh k="paper" sort={sort} onSort={setSort}>Paper Type</SortTh>}
                {vis("sheets") && <SortTh k="sheets" sort={sort} onSort={setSort}>Sheets</SortTh>}
                {vis("copies") && <SortTh k="copies" sort={sort} onSort={setSort}>Copies</SortTh>}
                {vis("stage") && <SortTh k="stage" sort={sort} onSort={setSort}>Current Stage</SortTh>}
                {vis("operator") && <SortTh k="operator" sort={sort} onSort={setSort}>Operator</SortTh>}
                {vis("due") && <SortTh k="due" sort={sort} onSort={setSort}>Due Date</SortTh>}
                <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">Actions</th>
              </tr></thead>
              <tbody>
                {rows.map((j) => {
                  const st = stageInfo(j.stage);
                  return (
                    <tr key={j.id} draggable onDragStart={(e) => { setDragId(j.id); e.dataTransfer.setData("text/plain", j.id); e.dataTransfer.effectAllowed = "move"; }} onDragEnd={() => { setDragId(null); setDropOver(null); }}
                      onClick={() => setSelId(j.id)} className={cx(trCls, "cursor-pointer", selId === j.id && "bg-brand-soft", dragId === j.id && "opacity-50")}>
                      <Td><input aria-label={`Select ${j.id}`} type="checkbox" checked={checked.has(j.id)} onClick={(e) => e.stopPropagation()} onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(j.id)) n.delete(j.id); else n.add(j.id); return n; })} /></Td>
                      {vis("id") && <Td><div className="flex items-center gap-2"><Thumb seed={j.id} size={30} /><div><div className="font-bold">{j.id}</div><div className="text-[11px] text-sub">{j.order.event}</div></div></div></Td>}
                      {vis("customer") && <Td>{j.order.customer}</Td>}
                      {vis("specs") && <Td><div>{j.order.size}</div><div className="text-[11px] text-sub">{j.order.pages} Pages</div></Td>}
                      {vis("paper") && <Td>{j.paper}</Td>}
                      {vis("sheets") && <Td>{j.sheets}</Td>}
                      {vis("copies") && <Td>{j.copies}</Td>}
                      {vis("stage") && (
                        <Td>
                          <StatusMenu<PStage> label={`Change stage of ${j.id}`} trigger={<Pill tone={st.tone} icon={st.icon}>{j.stage}</Pill>} options={PSTAGES.map((s) => ({ value: s.key }))} onPick={(s) => moveJob(j.id, s)} />
                        </Td>
                      )}
                      {vis("operator") && <Td>{j.operator}</Td>}
                      {vis("due") && <Td className="font-semibold text-rose-600">{fmtDate(j.due)}</Td>}
                      <Td>
                        <div className="flex items-center gap-2">
                          <button onClick={(e) => { e.stopPropagation(); setSelId(j.id); }} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button>
                          <RowMenu items={[
                            { label: "Open order", onClick: () => nav(`/orders/${j.order.id}`) },
                            { label: "Advance stage", onClick: () => (advanceJob(j.id) ? undefined : show("Already at the last stage")) },
                            { label: "Edit specs", onClick: () => openSpec(j) },
                          ]} />
                        </div>
                      </Td>
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-sub">No jobs match the filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="jobs" />
        </Panel>
      </div>
      {toast}

      {/* ───── job drawer ───── */}
      <SlideOver open={!!sel && !specOpen} onClose={() => setSelId(null)} title={sel ? `Print Job ${sel.id}` : "Print Job"} width={520} footer={sel && <>
        <button onClick={() => nav(`/orders/${sel.order.id}`)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">View Order</button>
        <button onClick={() => openSpec(sel)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Edit specs</button>
        <button onClick={() => advanceJob(sel.id)} disabled={selIdx >= PSTAGES.length - 1} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark disabled:bg-slate-300">
          {selIdx >= PSTAGES.length - 1 ? "Production Completed" : <>Advance to {PSTAGES[selIdx + 1]!.key}<ArrowRight className="size-4" /></>}
        </button>
      </>}>
        {sel && (
          <div>
            <div className="flex gap-3">
              <Thumb seed={sel.id} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="text-lg font-extrabold">{sel.id}</span>
                  <StatusMenu<PStage> label="Change job stage" trigger={<Pill tone={stageInfo(sel.stage).tone}>{sel.stage} ▾</Pill>} options={PSTAGES.map((s) => ({ value: s.key }))} onPick={(s) => moveJob(sel.id, s)} /></div>
                <div className="text-xs text-sub">{sel.order.event} Album</div>
                <div className="mt-2 flex justify-between text-xs"><div><div className="text-sub">Customer</div><b className="text-[13px]">{sel.order.customer}</b></div>
                  <div><div className="flex items-center gap-1 text-sub"><CalendarDays className="size-3" />Due Date</div><b className="text-[13px] text-rose-600">{fmtDate(sel.due)}</b></div></div>
              </div>
            </div>
            {selIdx === QC_IDX - 1 && <div className="mt-3"><Banner tone="blue">Advancing from Packaging sends this album to QC and moves the order to the QC stage.</Banner></div>}
            {selIdx >= QC_IDX && <div className="mt-3"><Banner tone="green">Order {sel.order.id} is now at: {ORDERS.find((o) => o.id === sel.order.id)?.stage.replace(/_/g, " ")}.</Banner></div>}
            <FieldBox label="Operator">
              <Combobox value={sel.operator} onChange={(v) => { patchJob(sel.id, { operator: v }); show(`Assigned to ${v}`); }} options={strOpts([...new Set([...OPERATORS, ...ASSIGNEES])])} />
            </FieldBox>
            <h4 className="mt-2 flex justify-between text-sm font-extrabold">Print Specifications<LinkAction onClick={() => openSpec(sel)}>Edit</LinkAction></h4>
            <div className="mt-2 grid grid-cols-2 gap-3 text-[13px]">
              <div><div className="text-xs text-sub">Album Size</div>{sel.order.size.replace("x", " x ")} ({sel.order.pages} Pages)</div>
              <div><div className="text-xs text-sub">Paper Type</div>{sel.paper} 300 GSM</div>
              <div><div className="text-xs text-sub">No. of Sheets</div>{sel.sheets} ({sel.order.pages} Pages)</div>
              <div><div className="text-xs text-sub">Copies</div>{sel.copies}</div>
            </div>
            <h4 className="mt-4 text-sm font-extrabold">Cover & Finishing</h4>
            <div className="mt-2 grid grid-cols-2 gap-3 text-[13px]">
              <div><div className="text-xs text-sub">Cover Type</div>{sel.cover ?? "Acrylic Photo Cover"}</div>
              <div><div className="text-xs text-sub">Lamination</div>{sel.lamination ?? "Matte Lamination (Both Sides)"}</div>
              <div><div className="text-xs text-sub">Box Details</div>{sel.box ?? "Premium Magnetic Box, Black with Gold Foil"}</div>
              <div><div className="text-xs text-sub">Additional Finishing</div>{sel.finishing ?? "Spot UV on Cover"}</div>
            </div>
            <h4 className="mb-2 mt-5 text-sm font-extrabold">Production Timeline</h4>
            <ol className="space-y-2.5">
              {timeline.map((t, i) => (
                <li key={i} className={cx("flex items-start gap-3 rounded-lg px-1.5 py-0.5 text-[13px]", t.current && "bg-brand-soft")}>
                  {t.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-500" /> : <Circle className={cx("mt-0.5 size-4 shrink-0", t.current ? "fill-brand text-brand" : "text-slate-300")} />}
                  <div className="min-w-0 flex-1"><div className={cx("font-semibold", !t.done && !t.current && "text-sub")}>{t.label}</div>{t.sub && <div className="text-[11px] text-sub">{t.sub}</div>}</div>
                  <div className="text-right text-[11px]">
                    <Pill tone={t.done ? "green" : t.current ? "indigo" : "slate"}>{t.done ? "Completed" : t.current ? "In Progress" : "Pending"}</Pill>
                    {(t.done || t.current) && <div className="text-sub">{t.by}</div>}
                  </div>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-sub">Order value {inr(sel.order.total)} · payment {sel.order.pay}</p>
          </div>
        )}
      </SlideOver>

      {/* ───── new print job ───── */}
      <SlideOver open={newOpen} onClose={() => setNewOpen(false)} title="New Print Job" width={520} footer={<><button onClick={() => setNewOpen(false)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Cancel</button><button onClick={submitNew} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Create Job</button></>}>
        <FieldBox label="Order (Final Approval)" required>
          <Combobox error={!!errs.order} placeholder="Search order or customer…" value={form.order} onChange={pickOrder} options={eligible.map(orderOpt)} />
          <Err>{errs.order}</Err>
          {eligible.length === 0 && <p className="mt-1 text-xs text-sub">No orders are waiting at Final Approval.</p>}
        </FieldBox>
        {fOrder && (
          <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-line bg-slate-50/60 p-3 text-xs text-sub">
            <div className="col-span-3 text-sm font-bold text-ink">{fOrder.customer} <span className="font-normal text-sub">· {fOrder.event}</span></div>
            <div>Album size<div className="text-sm font-bold text-ink">{fOrder.size}</div></div>
            <div>Pages<div className="text-sm font-bold text-ink">{fOrder.pages}</div></div>
            <div>Balance<div className="text-sm font-bold text-ink">{inr(fOrder.total - fOrder.paid)}</div></div>
          </div>
        )}
        <FieldBox label="Paper type"><Combobox value={form.paper} onChange={(v) => setForm({ ...form, paper: v })} options={strOpts(PAPERS)} /></FieldBox>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Sheets" required><input aria-label="Sheets" type="number" className={cx(inputCls, errs.sheets && "border-rose-400")} value={form.sheets} onChange={(e) => setForm({ ...form, sheets: e.target.value })} /><Err>{errs.sheets}</Err></Field>
          <Field label="Copies" required><input aria-label="Copies" type="number" className={cx(inputCls, errs.copies && "border-rose-400")} value={form.copies} onChange={(e) => setForm({ ...form, copies: e.target.value })} /><Err>{errs.copies}</Err></Field>
        </div>
        <FieldBox label="Operator"><Combobox value={form.operator} onChange={(v) => setForm({ ...form, operator: v })} options={strOpts(OPERATORS)} /></FieldBox>
        <FieldBox label="Due date" required><DateField label="Due date" value={form.due} error={!!errs.due} min={TODAY_ISO} onChange={(v) => setForm({ ...form, due: v })} /><Err>{errs.due}</Err></FieldBox>
      </SlideOver>

      <SlideOver open={specOpen && !!sel} onClose={() => setSpecOpen(false)} title={`Edit Specifications - ${sel?.id ?? ""}`} footer={<><button onClick={() => setSpecOpen(false)} className="inline-flex h-10 items-center gap-1 rounded-lg border border-line px-4 text-sm font-bold"><ChevronLeft className="size-4" />Back</button><button onClick={saveSpec} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Save</button></>}>
        <FieldBox label="Paper type"><Combobox value={spec.paper} onChange={(v) => setSpec({ ...spec, paper: v })} options={strOpts(PAPERS)} /></FieldBox>
        <Field label="Sheets" required><input aria-label="Spec sheets" type="number" className={inputCls} value={spec.sheets} onChange={(e) => setSpec({ ...spec, sheets: e.target.value })} /><Err>{errs.sheets}</Err></Field>
        <Field label="Copies" required><input type="number" className={inputCls} value={spec.copies} onChange={(e) => setSpec({ ...spec, copies: e.target.value })} /><Err>{errs.copies}</Err></Field>
        <Field label="Cover type"><input className={inputCls} value={spec.cover} onChange={(e) => setSpec({ ...spec, cover: e.target.value })} /></Field>
        <Field label="Lamination"><input className={inputCls} value={spec.lamination} onChange={(e) => setSpec({ ...spec, lamination: e.target.value })} /></Field>
        <Field label="Box details"><input className={inputCls} value={spec.box} onChange={(e) => setSpec({ ...spec, box: e.target.value })} /></Field>
        <Field label="Additional finishing"><input className={inputCls} value={spec.finishing} onChange={(e) => setSpec({ ...spec, finishing: e.target.value })} /></Field>
      </SlideOver>
    </div>
  );
}
