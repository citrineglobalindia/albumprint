import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Printer, PlayCircle, Layers, BookOpen, Package, ShieldCheck, Flag, FileText, ArrowRight, CheckCircle2, Circle, MoreVertical, CalendarDays } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, Thumb, SearchInput, FilterSelect, Pagination, Th, Td, trCls, tableCls, LinkAction, PrimaryButton, TodayChip, MoreButton, SlideOver, Field, inputCls, cx, TONE, type Kpi } from "../components/ui";
import { useToast } from "../components/Toast";
import { ORDERS, type Order, type Tone } from "../lib/data";
import { fmtDate } from "../lib/format";
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
const PAPERS = ["Sapphire Matte", "Lustre", "Matte", "Silk", "Glossy"];
const OPERATORS = ["Suresh", "Ramesh", "Divya", "Manoj", "Admin", "Karthik", "Anil"];

interface Job { id: string; order: Order; stage: PStage; paper: string; sheets: number; copies: number; operator: string; history: Partial<Record<PStage, string>>; cover?: string; lamination?: string; box?: string; finishing?: string }

const buildJobs = (): Job[] =>
  ORDERS.map((o, i) => ({
    id: o.id, order: o, stage: PSTAGES[i % PSTAGES.length]!.key, paper: PAPERS[i % PAPERS.length]!,
    sheets: o.pages * 2, copies: 1 + (i % 3), operator: OPERATORS[i % OPERATORS.length]!, history: {},
  }));

const TL_DATES = ["30 Sep 2026, 10:15 AM", "30 Sep 2026, 04:20 PM", "1 Oct 2026, 11:30 AM"];
const stageInfo = (s: PStage) => PSTAGES.find((x) => x.key === s)!;

export default function Printing() {
  const [jobs, setJobs] = useState(buildJobs);
  const [filter, setFilter] = useState<PStage | "All">("All");
  const [q, setQ] = useState("");
  const nav = useNavigate();
  const [toast, show] = useToast();
  const jobsRef = useRef<HTMLDivElement>(null);
  const [selId, setSelId] = useState("IDP00072");
  const [newOpen, setNewOpen] = useState(false);
  const [specOpen, setSpecOpen] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [menu, setMenu] = useState<string | null>(null);
  const [form, setForm] = useState({ order: "", paper: PAPERS[0]!, sheets: "", copies: "1", operator: OPERATORS[0]!, due: "" });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [spec, setSpec] = useState({ paper: "", sheets: "", copies: "", cover: "", lamination: "", box: "", finishing: "" });
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(8);

  const counts = useMemo(() => Object.fromEntries(PSTAGES.map((s) => [s.key, jobs.filter((j) => j.stage === s.key).length])) as Record<PStage, number>, [jobs]);
  const filtered = jobs.filter((j) => (filter === "All" || j.stage === filter) && (!q || `${j.id} ${j.order.customer} ${j.operator}`.toLowerCase().includes(q.toLowerCase())));
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);
  const sel = jobs.find((j) => j.id === selId) ?? jobs[0]!;
  const selIdx = PSTAGES.findIndex((s) => s.key === sel.stage);

  const advance = () => {
    if (selIdx >= PSTAGES.length - 1) return;
    const next = PSTAGES[selIdx + 1]!.key;
    setJobs((js) => js.map((j) => (j.id === sel.id ? { ...j, stage: next, history: { ...j.history, [next]: "3 Oct 2026, 10:00 AM" } } : j)));
  };

  const eligible = ORDERS.filter((o) => (o.stage === "final_approval" || o.stage === "printing"));
  const submitNew = () => {
    const e: Record<string, string> = {};
    const ord = ORDERS.find((o) => o.id === form.order);
    if (!ord) e.order = "Select an order";
    if (!(Number(form.sheets) > 0)) e.sheets = "Enter number of sheets";
    if (!(Number(form.copies) > 0)) e.copies = "Enter copies";
    if (!form.due) e.due = "Choose a due date";
    setErrs(e);
    if (Object.keys(e).length || !ord) return;
    const reruns = jobs.filter((j) => j.order.id === ord.id).length;
    const job: Job = { id: reruns ? `${ord.id}-R${reruns}` : ord.id, order: { ...ord, due: form.due }, stage: "Waiting for Print", paper: form.paper, sheets: Number(form.sheets), copies: Number(form.copies), operator: form.operator, history: {} };
    setJobs((js) => [job, ...js]);
    setSelId(job.id); setFilter("All"); setPage(1); setNewOpen(false);
    show(`Print job ${job.order.id} created`);
  };
  const openSpec = () => {
    setSpec({ paper: sel.paper, sheets: String(sel.sheets), copies: String(sel.copies), cover: sel.cover ?? "Acrylic Photo Cover", lamination: sel.lamination ?? "Matte Lamination (Both Sides)", box: sel.box ?? "Premium Magnetic Box, Black with Gold Foil", finishing: sel.finishing ?? "Spot UV on Cover" });
    setErrs({}); setSpecOpen(true);
  };
  const saveSpec = () => {
    const e: Record<string, string> = {};
    if (!(Number(spec.sheets) > 0)) e.sheets = "Enter number of sheets";
    if (!(Number(spec.copies) > 0)) e.copies = "Enter copies";
    setErrs(e);
    if (Object.keys(e).length) return;
    setJobs((js) => js.map((j) => j.id === sel.id ? { ...j, paper: spec.paper, sheets: Number(spec.sheets), copies: Number(spec.copies), cover: spec.cover, lamination: spec.lamination, box: spec.box, finishing: spec.finishing } : j));
    setSpecOpen(false); show("Print specifications updated");
  };
  const advanceJob = (id: string) => setJobs((js) => js.map((j) => { const i = PSTAGES.findIndex((s) => s.key === j.stage); return j.id === id && i < PSTAGES.length - 1 ? { ...j, stage: PSTAGES[i + 1]!.key, history: { ...j.history, [PSTAGES[i + 1]!.key]: "3 Oct 2026, 10:00 AM" } } : j; }));
  const bulkAdvance = () => { checked.forEach(advanceJob); show(`Advanced ${checked.size} job(s) to next stage`); setChecked(new Set()); };

  const kpis: Kpi[] = [
    { label: "Waiting for Printing", value: counts["Waiting for Print"], delta: 20, icon: Printer, tone: "blue" },
    { label: "Printing Started", value: counts.Printing, delta: 12, icon: PlayCircle, tone: "teal" },
    { label: "Lamination", value: counts.Lamination, delta: -5, icon: Layers, tone: "pink" },
    { label: "Binding", value: counts.Binding, delta: 10, icon: BookOpen, tone: "orange" },
    { label: "Packaging", value: counts.Packaging, delta: 33, icon: Package, tone: "pink" },
    { label: "Sent to QC", value: counts["Sent to QC"], delta: 18, icon: ShieldCheck, tone: "green" },
    { label: "Production Completed", value: counts.Completed, delta: 26, icon: Flag, tone: "pink" },
  ];

  const timeline = [
    { label: "Order Received", sub: TL_DATES[0]!, by: "by Admin", done: true, current: false },
    { label: "Design Approved", sub: TL_DATES[1]!, by: "by Design Team", done: true, current: false },
    ...PSTAGES.map((s, i) => ({
      label: s.key === "Printing" ? "Printing Started" : s.key,
      sub: sel.history[s.key] ?? (i <= selIdx ? TL_DATES[2]! : ""),
      by: `by ${sel.operator}`,
      done: i < selIdx || (s.key === "Completed" && i === selIdx),
      current: i === selIdx && s.key !== "Completed",
    })),
  ];

  return (
    <div className="min-w-0">
      <PageHeader title="Printing" subtitle="Manage and track all printing operations for album production">
        <TodayChip />
        <PrimaryButton onClick={() => { setForm({ order: "", paper: PAPERS[0]!, sheets: "", copies: "1", operator: OPERATORS[0]!, due: "" }); setErrs({}); setNewOpen(true); }}>New Print Job</PrimaryButton>
        <MoreButton />
      </PageHeader>
      <KpiRow items={kpis} />

      <div className="grid grid-cols-[minmax(0,1fr)_380px] gap-4">
        <div className="min-w-0 space-y-4">
          <Panel title="Printing Production Pipeline" subtitle="Click a stage to filter jobs." action={<LinkAction onClick={() => { setFilter("All"); setQ(""); setPage(1); jobsRef.current?.scrollIntoView({ behavior: "smooth" }); show("Showing all print jobs"); }}>View Full Pipeline →</LinkAction>} bodyClassName="pt-3">
            <div className="flex items-center gap-1.5">
              <button onClick={() => { setFilter("All"); setPage(1); }} className={cx("min-w-0 flex-1 rounded-xl border p-2.5 text-center", filter === "All" ? "border-brand ring-2 ring-brand/30" : "border-transparent", "bg-sky-50")}>
                <FileText className="mx-auto size-5 text-sky-600" /><div className="truncate text-[11px] text-sub">All Jobs</div><div className="text-lg font-extrabold">{jobs.length}</div>
              </button>
              {PSTAGES.map((s) => (
                <div key={s.key} className="flex min-w-0 flex-1 items-center gap-1.5">
                  <ArrowRight className="size-3 shrink-0 text-slate-400" />
                  <button onClick={() => { setFilter(s.key); setPage(1); }} className={cx("min-w-0 flex-1 rounded-xl border p-2.5 text-center", TONE[s.tone].soft, filter === s.key ? "border-brand ring-2 ring-brand/30" : "border-transparent")}>
                    <s.icon className={cx("mx-auto size-5", TONE[s.tone].text)} /><div className="truncate text-[11px] text-sub">{s.key}</div><div className="text-lg font-extrabold">{counts[s.key]}</div>
                  </button>
                </div>
              ))}
            </div>
          </Panel>

          <div ref={jobsRef} />
          <Panel title="Printing Jobs" subtitle="Manage and monitor all printing tasks" action={
            <div className="flex items-center gap-3">
              <FilterSelect className="w-44" value={filter} onChange={(v) => { setFilter(v as PStage | "All"); setPage(1); }} options={["All", ...PSTAGES.map((s) => s.key)]} />
              <SearchInput className="w-56" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search order, customer..." />
            </div>
          }>
            {checked.size > 0 && (
              <div className="mb-3 flex items-center gap-3 rounded-xl bg-brand-soft px-4 py-2 text-[13px] font-semibold">
                {checked.size} selected
                <button onClick={bulkAdvance} className="rounded-lg bg-brand px-3 py-1 text-xs font-bold text-white">Advance stage</button>
                <button onClick={() => { downloadCsv("print-jobs.csv", [["Order", "Customer", "Stage", "Paper", "Sheets", "Copies", "Operator"], ...jobs.filter((j) => checked.has(j.id)).map((j) => [j.id, j.order.customer, j.stage, j.paper, j.sheets, j.copies, j.operator])]); show("Exported selected jobs"); }} className="rounded-lg border border-line bg-white px-3 py-1 text-xs font-bold">Export</button>
                <button onClick={() => setChecked(new Set())} className="ml-auto text-xs font-bold text-brand">Clear</button>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className={tableCls}>
                <thead><tr>
                  <Th><input type="checkbox" checked={rows.length > 0 && rows.every((r) => checked.has(r.id))} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></Th>
                  <Th>Order ID</Th><Th>Customer</Th><Th>Album Specs</Th><Th>Paper Type</Th><Th>Sheets</Th><Th>Copies</Th><Th>Current Stage</Th><Th>Operator</Th><Th>Due Date</Th><Th>Actions</Th>
                </tr></thead>
                <tbody>
                  {rows.map((j) => {
                    const st = stageInfo(j.stage);
                    return (
                      <tr key={j.id} onClick={() => setSelId(j.id)} className={cx(trCls, "cursor-pointer", sel.id === j.id && "bg-brand-soft")}>
                        <Td><input type="checkbox" checked={checked.has(j.id)} onClick={(e) => e.stopPropagation()} onChange={() => setChecked((s) => { const n = new Set(s); if (n.has(j.id)) n.delete(j.id); else n.add(j.id); return n; })} /></Td>
                        <Td><div className="flex items-center gap-2"><Thumb seed={j.id} size={30} /><div><div className="font-bold">{j.order.id}</div><div className="text-[11px] text-sub">{j.order.event}</div></div></div></Td>
                        <Td>{j.order.customer}</Td>
                        <Td><div>{j.order.size}</div><div className="text-[11px] text-sub">{j.order.pages} Pages</div></Td>
                        <Td>{j.paper}</Td><Td>{j.sheets}</Td><Td>{j.copies}</Td>
                        <Td><Pill tone={st.tone} icon={st.icon}>{j.stage}</Pill></Td>
                        <Td>{j.operator}</Td>
                        <Td className="font-semibold text-rose-600">{fmtDate(j.order.due)}</Td>
                        <Td><div className="flex items-center gap-2"><button onClick={() => setSelId(j.id)} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button><div className="relative"><button aria-label="Row actions" onClick={(e) => { e.stopPropagation(); setMenu(menu === j.id ? null : j.id); }} onBlur={() => setTimeout(() => setMenu(null), 150)}><MoreVertical className="size-4 text-sub" /></button>
                          {menu === j.id && (
                            <div className="absolute right-0 top-6 z-30 w-40 rounded-xl border border-line bg-white p-1 text-left shadow-xl">
                              {([["Open order", () => nav(`/orders/${j.order.id}`)], ["Advance stage", () => { advanceJob(j.id); show(`${j.id} advanced`); }], ["Edit specs", () => { setSelId(j.id); setTimeout(openSpec, 0); }]] as [string, () => void][]).map(([l, f]) => <button key={l} onMouseDown={() => { setMenu(null); f(); }} className="block w-full rounded-lg px-3 py-1.5 text-xs font-semibold hover:bg-brand-soft">{l}</button>)}
                            </div>
                          )}</div></div></Td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={11} className="py-10 text-center text-sub">No jobs in this stage.</td></tr>}
                </tbody>
              </table>
            </div>
            <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="jobs" />
          </Panel>
        </div>

        <div className="min-w-0 space-y-4">
          <Panel title="Production Job Details" action={<button onClick={() => nav(`/orders/${sel.order.id}`)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-3 text-xs font-bold">View Order <ArrowRight className="size-3" /></button>} bodyClassName="pt-3">
            <div className="flex gap-3">
              <Thumb seed={sel.id} size={64} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2"><span className="text-lg font-extrabold">{sel.id}</span><Pill tone={stageInfo(sel.stage).tone}>{sel.stage}</Pill></div>
                <div className="text-xs text-sub">{sel.order.event} Album</div>
                <div className="mt-2 flex justify-between text-xs"><div><div className="text-sub">Customer</div><b className="text-[13px]">{sel.order.customer}</b></div>
                  <div><div className="flex items-center gap-1 text-sub"><CalendarDays className="size-3" />Due Date</div><b className="text-[13px] text-rose-600">{fmtDate(sel.order.due)}</b></div></div>
              </div>
            </div>
            <h4 className="mt-4 flex justify-between text-sm font-extrabold">Print Specifications<LinkAction onClick={openSpec}>Edit</LinkAction></h4>
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
          </Panel>

          <Panel title="Production Timeline" action={<LinkAction onClick={() => setHistOpen(true)}>View Full History →</LinkAction>} bodyClassName="pt-3">
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
            <button onClick={advance} disabled={selIdx >= PSTAGES.length - 1} className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-brand text-sm font-bold text-white hover:bg-brand-dark disabled:bg-slate-300">
              {selIdx >= PSTAGES.length - 1 ? "Production Completed" : <>Advance to {PSTAGES[selIdx + 1]!.key}<ArrowRight className="size-4" /></>}
            </button>
          </Panel>
        </div>
      </div>
      {toast}
      <SlideOver open={newOpen} onClose={() => setNewOpen(false)} title="New Print Job" footer={<><button onClick={() => setNewOpen(false)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Cancel</button><button onClick={submitNew} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Create Job</button></>}>
        <Field label="Order (Final Approval / Printing)" required>
          <select aria-label="Order" className={inputCls} value={form.order} onChange={(e) => setForm({ ...form, order: e.target.value })}>
            <option value="">Select order…</option>
            {eligible.map((o) => <option key={o.id} value={o.id}>{o.id} - {o.customer} ({o.size})</option>)}
          </select>
          {errs.order && <span className="text-xs text-rose-600">{errs.order}</span>}
        </Field>
        <Field label="Paper type"><select className={inputCls} value={form.paper} onChange={(e) => setForm({ ...form, paper: e.target.value })}>{PAPERS.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Sheets" required><input aria-label="Sheets" type="number" className={inputCls} value={form.sheets} onChange={(e) => setForm({ ...form, sheets: e.target.value })} />{errs.sheets && <span className="text-xs text-rose-600">{errs.sheets}</span>}</Field>
        <Field label="Copies" required><input aria-label="Copies" type="number" className={inputCls} value={form.copies} onChange={(e) => setForm({ ...form, copies: e.target.value })} />{errs.copies && <span className="text-xs text-rose-600">{errs.copies}</span>}</Field>
        <Field label="Operator"><select className={inputCls} value={form.operator} onChange={(e) => setForm({ ...form, operator: e.target.value })}>{OPERATORS.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Due date" required><input aria-label="Due date" type="date" className={inputCls} value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />{errs.due && <span className="text-xs text-rose-600">{errs.due}</span>}</Field>
      </SlideOver>
      <SlideOver open={specOpen} onClose={() => setSpecOpen(false)} title={`Edit Specifications - ${sel.id}`} footer={<><button onClick={() => setSpecOpen(false)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Cancel</button><button onClick={saveSpec} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Save</button></>}>
        <Field label="Paper type"><select className={inputCls} value={spec.paper} onChange={(e) => setSpec({ ...spec, paper: e.target.value })}>{PAPERS.map((p) => <option key={p}>{p}</option>)}</select></Field>
        <Field label="Sheets" required><input aria-label="Spec sheets" type="number" className={inputCls} value={spec.sheets} onChange={(e) => setSpec({ ...spec, sheets: e.target.value })} />{errs.sheets && <span className="text-xs text-rose-600">{errs.sheets}</span>}</Field>
        <Field label="Copies" required><input type="number" className={inputCls} value={spec.copies} onChange={(e) => setSpec({ ...spec, copies: e.target.value })} />{errs.copies && <span className="text-xs text-rose-600">{errs.copies}</span>}</Field>
        <Field label="Cover type"><input className={inputCls} value={spec.cover} onChange={(e) => setSpec({ ...spec, cover: e.target.value })} /></Field>
        <Field label="Lamination"><input className={inputCls} value={spec.lamination} onChange={(e) => setSpec({ ...spec, lamination: e.target.value })} /></Field>
        <Field label="Box details"><input className={inputCls} value={spec.box} onChange={(e) => setSpec({ ...spec, box: e.target.value })} /></Field>
        <Field label="Additional finishing"><input className={inputCls} value={spec.finishing} onChange={(e) => setSpec({ ...spec, finishing: e.target.value })} /></Field>
      </SlideOver>
      <SlideOver open={histOpen} onClose={() => setHistOpen(false)} title={`Full History - ${sel.id}`}>
        <ol className="space-y-4 border-l-2 border-line pl-4">
          {timeline.map((t, i) => (
            <li key={i} className="relative text-[13px]">
              <span className={cx("absolute -left-[23px] top-1 size-3 rounded-full", t.done ? "bg-emerald-500" : t.current ? "bg-brand" : "bg-slate-300")} />
              <div className="font-semibold">{t.label}</div>
              <div className="text-xs text-sub">{t.sub || "Pending"}{(t.done || t.current) && ` - ${t.by}`}</div>
            </li>
          ))}
        </ol>
      </SlideOver>
    </div>
  );
}
