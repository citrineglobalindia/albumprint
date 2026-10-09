import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Clock, Search, CheckCircle2, XCircle, Wrench, Truck, ShieldCheck, ChevronLeft, ChevronRight, Check, X, ScanLine, Layers, Scissors, BookOpen, AlignCenter, Square, Package, Palette, ZoomIn, ZoomOut, Maximize2, Minimize2, Download } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, Avatar, Thumb, SearchInput, LineTabs, PrimaryButton, TodayChip, MoreButton, SlideOver, Td, tableCls, trCls, Field, inputCls, cx, type Kpi } from "../components/ui";
import { ColumnsMenu, Combobox, DateRangePicker, FilterChips, MultiSelect, SavedViews, SortTh, sortRows, type DateRange, type SortState } from "../components/controls";
import { ALL_TIME, Banner, DateField, Err, FieldBox, Kbd, PhotoUploader, StatusMenu, desRange, inRangeOpt, orderOpt, rangeLabel, serRange, strOpts, usePersisted, useSlashSearch, type Photo, type SavedRange } from "../components/pageKit";
import { RowMenu } from "../components/RowMenu";
import { useToast } from "../components/Toast";
import { ORDERS } from "../lib/data";
import type { Tone } from "../lib/data";
import { fmtDate, inr } from "../lib/format";
import { downloadCsv } from "../lib/csv";

type QStatus = "Awaiting QC" | "In Inspection" | "Passed" | "Failed" | "Rework" | "Ready for Delivery";
const QSTATUSES: QStatus[] = ["Awaiting QC", "In Inspection", "Passed", "Failed", "Rework", "Ready for Delivery"];
const Q_TONE: Record<QStatus, Tone> = { "Awaiting QC": "orange", "In Inspection": "violet", Passed: "green", Failed: "red", Rework: "orange", "Ready for Delivery": "blue" };
type Mark = "pass" | "fail" | "na" | "";
const DEFECTS = ["Colour", "Scratch", "Alignment", "Binding", "Print", "Damage", "Wrong spec"] as const;
const CHECK = [
  { k: "print", t: "Print Quality", d: "Sharpness, colour accuracy, no banding", I: ScanLine, tone: "text-sky-600 bg-sky-50" },
  { k: "colour", t: "Colour Consistency", d: "Matches approved design", I: Palette, tone: "text-orange-500 bg-orange-50" },
  { k: "trim", t: "Trimming & Cutting", d: "Accurate size and neat edges", I: Scissors, tone: "text-violet-600 bg-violet-50" },
  { k: "bind", t: "Binding & Spine", d: "Strong binding, no loose pages", I: BookOpen, tone: "text-rose-600 bg-rose-50" },
  { k: "align", t: "Page Alignment", d: "Pages aligned correctly", I: AlignCenter, tone: "text-sky-600 bg-sky-50" },
  { k: "cover", t: "Cover Quality", d: "No scratches, proper finishing", I: Square, tone: "text-emerald-600 bg-emerald-50" },
  { k: "pack", t: "Packaging", d: "Properly packed with accessories", I: Package, tone: "text-orange-500 bg-orange-50" },
] as const;

interface LogEntry { at: string; text: string; status?: QStatus }
interface Insp { id: string; customer: string; event: string; size: string; pages: number; due: string; operator: string; status: QStatus; marks: Record<string, Mark>; notes: string; defects: string[]; evidence: Photo[]; log: LogEntry[] }

const OPS = ["Suresh K", "Ramesh K", "Divya", "Manoj", "Admin", "Anil"];
const blank = (): Record<string, Mark> => Object.fromEntries(CHECK.map((c) => [c.k, ""]));
const allPass = (): Record<string, Mark> => Object.fromEntries(CHECK.map((c) => [c.k, "pass" as Mark]));
const nowStr = () => `${fmtDate("2026-10-03")}, ${new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })}`;
const ph = (n: number): Photo[] => Array.from({ length: n }, (_, i) => ({ id: `seed-${i}`, url: "", name: `Defect-${i + 1}` }));

const build = (): Insp[] => {
  const by = (s: string) => ORDERS.filter((o) => o.stage === s);
  const qcSeq: QStatus[] = ["In Inspection", "Awaiting QC", "Awaiting QC", "Failed"];
  const pool = [
    ...by("qc").map((o, i) => ({ o, s: qcSeq[i % qcSeq.length]! })),
    ...ORDERS.filter((o) => o.stage === "printing").slice(0, 2).map((o) => ({ o, s: "Rework" as QStatus })),
    ...by("ready_for_delivery").slice(0, 4).map((o) => ({ o, s: "Passed" as QStatus })),
    ...by("delivered").slice(0, 3).map((o) => ({ o, s: "Passed" as QStatus })),
  ];
  return pool.map(({ o, s }, i) => {
    const bad = s === "Failed" || s === "Rework";
    const done = s === "Passed";
    return {
      id: o.id, customer: o.customer, event: o.event, size: o.size, pages: o.pages, due: o.due, operator: OPS[i % OPS.length]!, status: s,
      marks: bad ? { print: "pass", colour: "pass", trim: "pass", bind: "fail", align: "pass", cover: "pass", pack: "" } : done ? allPass() : blank(),
      notes: bad ? "Overall print quality is excellent. Found minor scratch on back cover." : "",
      defects: bad ? ["Scratch"] : [], evidence: bad ? ph(3) : [],
      log: [{ at: "2 Oct 2026, 05:30 PM", text: "Received from Printing" }, ...(bad ? [{ at: "2 Oct 2026, 06:10 PM", text: `${s} (Scratch)`, status: s }] : done ? [{ at: "2 Oct 2026, 06:40 PM", text: "Passed - sent to Delivery", status: s as QStatus }] : [])],
    };
  });
};

const COLS = [{ key: "id", label: "Order ID" }, { key: "customer", label: "Customer" }, { key: "event", label: "Event" }, { key: "size", label: "Album" }, { key: "due", label: "Due Date" }, { key: "operator", label: "Inspector" }, { key: "status", label: "Status" }, { key: "defects", label: "Defects" }, { key: "evidence", label: "Evidence" }];
interface ViewState { status: string[]; range: SavedRange; q: string; hidden: string[]; sort: SortState }

/** Push the inspection decision onto the shared order. */
function syncOrder(id: string, s: QStatus) {
  const o = ORDERS.find((x) => x.id === id);
  if (!o) return "";
  if (s === "Passed" || s === "Ready for Delivery") { if (o.stage === "qc" || o.stage === "printing") o.stage = "ready_for_delivery"; return "order moved to Ready for Delivery"; }
  if (s === "Rework") { if (o.stage === "qc") o.stage = "printing"; return "order sent back to Printing"; }
  if (s === "Failed") { if (o.stage === "printing") o.stage = "qc"; return "order held at QC"; }
  return "";
}

export default function QualityControl() {
  const [items, setItems] = usePersisted<Insp[]>("qc.items", build);
  const [selId, setSelId] = useState<string>(() => items.find((i) => i.status === "In Inspection")?.id ?? items[0]?.id ?? "");
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [range, setRange] = useState<DateRange>(ALL_TIME());
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [tab, setTab] = useState<"check" | "notes" | "evidence" | "history">("check");
  const [thumb, setThumb] = useState(0);
  const [err, setErr] = useState("");
  const nav = useNavigate();
  const [toast, show] = useToast();
  const [newOpen, setNewOpen] = useState(false);
  const [nForm, setNForm] = useState({ order: "", assignee: OPS[0]!, due: "" });
  const [nErr, setNErr] = useState<Record<string, string>>({});
  const [assignId, setAssignId] = useState<string | null>(null);
  const [assignTo, setAssignTo] = useState(OPS[0]!);
  const [summaryId, setSummaryId] = useState<string | null>(null);
  const [zoomP, setZoomP] = useState(100);
  const [full, setFull] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [decision, setDecision] = useState<{ id: string; status: "Failed" | "Rework" } | null>(null);
  const [dChips, setDChips] = useState<string[]>([]);
  const [dNote, setDNote] = useState("");
  const [dErr, setDErr] = useState("");
  const [page, setPage] = useState(1);
  useSlashSearch();

  useEffect(() => { setPage(1); }, [fStatus, range, q]);

  const sel = items.find((i) => i.id === selId) ?? items[0];
  const patchById = (id: string, p: Partial<Insp>) => setItems((is) => is.map((i) => (i.id === id ? { ...i, ...p } : i)));
  const patch = (p: Partial<Insp>) => sel && patchById(sel.id, p);

  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    return items.filter((i) => (!fStatus.length || fStatus.includes(i.status)) && inRangeOpt(i.due, range) && (!t || `${i.id} ${i.customer} ${i.event}`.toLowerCase().includes(t)));
  }, [items, fStatus, range, q]);
  const register = useMemo(() => sortRows(list, sort, (i, k) => {
    switch (k) { case "id": return i.id; case "customer": return i.customer.toLowerCase(); case "event": return i.event; case "size": return i.size; case "due": return i.due; case "operator": return i.operator; case "status": return i.status; case "defects": return i.defects.join(","); default: return i.evidence.length; }
  }), [list, sort]);
  const regRows = register.slice((page - 1) * 6, page * 6);
  const cnt = (s: QStatus) => items.filter((i) => i.status === s).length;
  const spreads = sel ? Math.ceil(sel.pages / 2) + 1 : 1;
  const prev = ["Cover", ...Array.from({ length: 8 }, (_, i) => `Page ${i * 2 + 1}-${i * 2 + 2}`)];

  const eligible = ORDERS.filter((o) => (o.stage === "qc" || o.stage === "printing") && !items.some((i) => i.id === o.id));
  const nOrder = ORDERS.find((o) => o.id === nForm.order);
  const createInsp = () => {
    const e: Record<string, string> = {};
    if (!nOrder) e.order = "Select an order waiting for QC";
    if (!nForm.due) e.due = "Inspection due date is required";
    setNErr(e);
    if (!nOrder) return;
    if (e.due) return;
    const o = nOrder;
    setItems((is) => [{ id: o.id, customer: o.customer, event: o.event, size: o.size, pages: o.pages, due: nForm.due, operator: nForm.assignee, status: "Awaiting QC", marks: blank(), notes: "", defects: [], evidence: [], log: [{ at: nowStr(), text: `Inspection created, assigned to ${nForm.assignee}` }] }, ...is]);
    if (o.stage === "printing") o.stage = "qc";
    setSelId(o.id); setFStatus([]); setRange(ALL_TIME()); setQ(""); setNewOpen(false); show(`Inspection created for ${o.id}`);
  };

  const kpis: Kpi[] = [
    { label: "Awaiting QC", value: cnt("Awaiting QC") + 12, delta: 12, icon: Clock, tone: "orange" },
    { label: "In Inspection", value: cnt("In Inspection") + 11, delta: 20, icon: Search, tone: "violet" },
    { label: "Passed", value: cnt("Passed") + 153, delta: 28, icon: CheckCircle2, tone: "green" },
    { label: "Failed", value: cnt("Failed") + 6, delta: 0, icon: XCircle, tone: "red", invert: true },
    { label: "Rework", value: cnt("Rework") + 4, delta: -25, icon: Wrench, tone: "orange", invert: true },
    { label: "Ready for Delivery", value: cnt("Ready for Delivery") + 142, delta: 32, icon: Truck, tone: "blue" },
  ];

  const setMark = (k: string, m: Mark) => sel && patch({ marks: { ...sel.marks, [k]: m } });

  const commit = (it: Insp, s: QStatus, defects = it.defects, notes = it.notes) => {
    const note = syncOrder(it.id, s);
    patchById(it.id, { status: s, defects, notes, log: [...it.log, { at: nowStr(), text: `${s}${defects.length && (s === "Failed" || s === "Rework") ? ` (${defects.join(", ")})` : ""} by Divya S`, status: s }] });
    setErr(""); show(`${it.id} ${s.toLowerCase()}${note ? ` - ${note}` : ""}`);
  };
  /** Pass / Ready need a clean checklist; Fail / Rework open the defect popover. */
  const dispose = (s: QStatus, id = sel?.id) => {
    const it = items.find((i) => i.id === id);
    if (!it) return;
    if (id !== selId) setSelId(it.id);
    if (s === "Failed" || s === "Rework") { setDecision({ id: it.id, status: s }); setDChips(it.defects); setDNote(it.notes); setDErr(""); return; }
    if (s === "Passed" || s === "Ready for Delivery") {
      if (Object.values(it.marks).includes("fail")) { setErr("Checklist has failed items - cannot pass."); setTab("check"); return; }
      if (Object.values(it.marks).some((m) => m === "")) { setErr("Complete the checklist before passing."); setTab("check"); return; }
    }
    commit(it, s);
  };
  const confirmDecision = () => {
    if (!decision) return;
    if (dChips.length === 0) { setDErr("Select at least one defect reason (required for Fail / Rework)."); return; }
    const it = items.find((i) => i.id === decision.id)!;
    commit(it, decision.status, dChips, dNote);
    setDecision(null);
  };

  // keyboard shortcuts: P / F / R
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,select,[contenteditable=true]")) return;
      if (newOpen || assignId || pagesOpen || summaryId || decision) return;
      const k = e.key.toLowerCase();
      if (k === "p") { e.preventDefault(); dispose("Passed"); }
      else if (k === "f") { e.preventDefault(); dispose("Failed"); }
      else if (k === "r") { e.preventDefault(); dispose("Rework"); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  });

  const chips = [
    ...fStatus.map((s) => ({ label: `Status: ${s}`, onRemove: () => setFStatus(fStatus.filter((x) => x !== s)) })),
    ...(range.preset !== "All Time" ? [{ label: `Due: ${range.preset === "Custom" ? rangeLabel(range) : range.preset}`, onRemove: () => setRange(ALL_TIME()) }] : []),
    ...(q ? [{ label: `Search: ${q}`, onRemove: () => setQ("") }] : []),
  ];
  const clearAll = () => { setFStatus([]); setRange(ALL_TIME()); setQ(""); };
  const view: ViewState = { status: fStatus, range: serRange(range), q, hidden, sort };
  const applyView = (v: ViewState) => { setFStatus(v.status); setRange(desRange(v.range)); setQ(v.q); setHidden(v.hidden); setSort(v.sort); };
  const vis = (k: string) => !hidden.includes(k);
  const summary = items.find((i) => i.id === summaryId) ?? null;

  if (!sel) return <div className="p-10 text-center text-sub">No inspections yet. Use New Inspection to add one.</div>;

  return (
    <div className="min-w-0">
      <PageHeader title="Quality Control" subtitle="Inspect completed albums for quality, ensure perfection before delivery." icon={<ShieldCheck className="size-10 text-brand" />}>
        <TodayChip />
        <PrimaryButton onClick={() => { setNForm({ order: "", assignee: OPS[0]!, due: "" }); setNErr({}); setNewOpen(true); }}>New Inspection</PrimaryButton>
        <MoreButton />
      </PageHeader>
      <KpiRow items={kpis} />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <DateRangePicker value={range} onChange={setRange} align="left" />
        <MultiSelect className="w-48" label="Inspection status" options={QSTATUSES} value={fStatus} onChange={setFStatus} />
        <SearchInput className="w-72" value={q} onChange={setQ} placeholder="Search by order ID, customer, event... ( / )" />
        <div className="ml-auto flex gap-2">
          <SavedViews<ViewState> storageKey="qc" current={view} onApply={applyView} />
          <ColumnsMenu columns={COLS} hidden={hidden} onChange={setHidden} />
        </div>
      </div>
      <FilterChips chips={chips} onClearAll={clearAll} />

      <div className="grid grid-cols-[360px_minmax(0,1fr)_420px] gap-4">
        <Panel title="Inspection Queue" action={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold">{list.length}</span>} bodyClassName="p-3">
          <div className="scroll-thin max-h-[640px] space-y-2 overflow-y-auto pr-1">
            {list.map((i) => (
              <div key={i.id} role="button" tabIndex={0} onClick={() => { setSelId(i.id); setErr(""); }} className={cx("flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left", i.id === sel.id ? "border-brand bg-brand-soft/40" : "border-line hover:bg-slate-50")}>
                <Thumb seed={i.id} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2"><b className="text-[13px]">{i.id}</b><Pill tone={Q_TONE[i.status]} dot>{i.status}</Pill></div>
                  <div className="truncate text-xs text-sub">{i.customer}</div>
                  <div className="text-xs text-sub">{i.event} Album · due {fmtDate(i.due)}</div>
                  <div className="mt-0.5 flex items-center justify-between text-xs text-sub"><span>{i.size} | {i.pages} Pages</span><span className="flex items-center gap-1.5 font-medium text-ink"><Avatar name={i.operator} size={20} />{i.operator}</span></div>
                </div>
                <RowMenu items={[
                  { label: "View summary", onClick: () => setSummaryId(i.id) },
                  { label: "Assign…", onClick: () => { setAssignId(i.id); setAssignTo(i.operator); } },
                  { label: "Start inspection", onClick: () => { patchById(i.id, { status: "In Inspection", log: [...i.log, { at: nowStr(), text: "Inspection started" }] }); show(`${i.id} moved to In Inspection`); } },
                  { label: "Open order", onClick: () => nav(`/orders/${i.id}`) },
                ]} />
              </div>
            ))}
            {list.length === 0 && <div className="py-8 text-center text-sm text-sub">No albums match.</div>}
          </div>
        </Panel>

        <Panel title="Album Preview" bodyClassName="p-4" action={
          <div className="flex items-center gap-2 text-xs">
            <button aria-label="Zoom out" onClick={() => setZoomP((z) => Math.max(60, z - 20))} className="grid size-7 place-items-center rounded-lg border border-line"><ZoomOut className="size-4" /></button>
            <span className="w-9 text-center">{zoomP}%</span>
            <button aria-label="Zoom in" onClick={() => setZoomP((z) => Math.min(160, z + 20))} className="grid size-7 place-items-center rounded-lg border border-line"><ZoomIn className="size-4" /></button>
            <button aria-label="Toggle fullscreen" onClick={() => setFull((f) => !f)} className="grid size-7 place-items-center rounded-lg border border-line">{full ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}</button>
            <button aria-label="Previous" disabled={thumb === 0} onClick={() => setThumb(thumb - 1)} className="grid size-7 place-items-center rounded-lg border border-line disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <span>{thumb + 1} / {sel.pages}</span>
            <button aria-label="Next" disabled={thumb >= spreads - 1} onClick={() => setThumb(thumb + 1)} className="grid size-7 place-items-center rounded-lg border border-line disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
        }>
          <div data-testid="preview" className={cx("relative grid place-items-center overflow-hidden bg-gradient-to-br from-stone-200 to-stone-300", full ? "fixed inset-4 z-[55] h-auto rounded-2xl shadow-2xl" : "h-[290px] rounded-xl")}>
            {full && <button aria-label="Exit fullscreen" onClick={() => setFull(false)} className="absolute right-3 top-3 z-10 grid size-9 place-items-center rounded-lg bg-white shadow"><Minimize2 className="size-4" /></button>}
            <div className="flex h-[86%] w-[70%] overflow-hidden rounded-md bg-[#f1ece4] shadow-2xl transition-transform" style={{ transform: `scale(${zoomP / 100})` }}>
              <div className="grid flex-1 place-items-center p-3"><Thumb seed={thumb + 1} size={0} rounded="rounded" className="!h-full !w-full" /></div>
              {thumb > 0 && <div className="grid flex-1 place-items-center border-l border-black/10 p-3"><Thumb seed={thumb + 4} size={0} rounded="rounded" className="!h-full !w-full" /></div>}
            </div>
            {thumb === 0 && <div className="absolute bottom-10 font-serif text-lg italic text-white drop-shadow">Our Wedding Story</div>}
          </div>
          <div className="mt-3 flex gap-2">
            {prev.slice(0, 5).map((p, i) => (
              <button key={p} onClick={() => setThumb(i)} className={cx("min-w-0 flex-1 overflow-hidden rounded-lg border-2", thumb === i ? "border-brand" : "border-transparent")}><Thumb seed={i + 2} size={0} rounded="rounded-none" className="!h-16 !w-full" /></button>
            ))}
          </div>
          <div className="mt-4 flex items-baseline justify-between text-sm"><h3 className="font-extrabold">Page Thumbnails <span className="text-xs font-normal text-sub">({sel.pages} pages)</span></h3><button onClick={() => setPagesOpen(true)} className="text-xs font-bold text-brand hover:underline">View All Pages →</button></div>
          <div className="mt-2 flex gap-2">
            {prev.slice(0, 6).map((p, i) => (
              <button key={p} onClick={() => setThumb(i)} className="min-w-0 flex-1 text-center">
                <div className={cx("overflow-hidden rounded-md border-2", thumb === i ? "border-brand" : "border-transparent")}><Thumb seed={i + 7} size={0} rounded="rounded-none" className="!h-14 !w-full" /></div>
                <div className={cx("mt-1 truncate text-[10px]", thumb === i ? "font-bold text-brand" : "text-sub")}>{p}</div>
              </button>
            ))}
          </div>
        </Panel>

        <Panel bodyClassName="p-4">
          <div className="mb-3 flex items-center justify-between"><h2 className="text-[17px] font-extrabold">QC Inspection</h2>
            <div className="flex items-center gap-2 text-xs text-sub">Order ID <b className="text-ink">{sel.id}</b>
              <StatusMenu<QStatus> label="Change inspection status" trigger={<Pill tone={Q_TONE[sel.status]} dot>{sel.status}</Pill>} options={QSTATUSES.map((s) => ({ value: s }))} onPick={(s) => (s === "Awaiting QC" || s === "In Inspection" ? (patch({ status: s, log: [...sel.log, { at: nowStr(), text: s }] }), show(`${sel.id}: ${s}`)) : dispose(s))} /></div></div>
          <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-2 text-xs">
            <div className="flex gap-2 rounded-xl border border-line p-2"><Thumb seed={sel.id} size={40} /><div className="min-w-0"><b className="block truncate text-[13px]">{sel.customer}</b><span className="text-sub">{sel.event} Album</span><div className="text-sub">{sel.size} | {sel.pages} Pages</div></div></div>
            <div className="rounded-xl border border-line p-2"><div className="text-sub">Due Date</div><b className="text-[13px]">{fmtDate(sel.due)}</b></div>
            <div className="rounded-xl border border-line p-2"><div className="text-sub">Assigned To</div><b className="flex items-center gap-1 text-[13px]"><Avatar name={sel.operator} size={20} /><span className="truncate">{sel.operator}</span></b></div>
          </div>
          <LineTabs className="mt-3 gap-5" value={tab} onChange={setTab} tabs={[{ key: "check", label: "QC Checklist" }, { key: "notes", label: "Defects & Notes" }, { key: "evidence", label: `Evidence (${sel.evidence.length})` }, { key: "history", label: "History" }]} />

          {tab === "check" && (
            <div className="mt-3">
              <div className="flex items-end justify-between"><div><h3 className="font-extrabold">Quality Checklist</h3><p className="text-xs text-sub">Verify each item before marking as pass or fail</p></div>
                <div className="grid grid-cols-3 gap-4 text-center text-[11px] font-bold text-sub"><span>Pass</span><span>Fail</span><span>N/A</span></div></div>
              <div className="mt-2 divide-y divide-line">
                {CHECK.map((c) => (
                  <div key={c.k} className="flex items-center gap-3 py-1.5">
                    <span className={cx("grid size-8 shrink-0 place-items-center rounded-lg", c.tone)}><c.I className="size-4" /></span>
                    <div className="min-w-0 flex-1"><div className="text-[13px] font-bold">{c.t}</div><div className="truncate text-[11px] text-sub">{c.d}</div></div>
                    <div className="grid grid-cols-3 gap-4">
                      {(["pass", "fail", "na"] as const).map((m) => (
                        <label key={m} className="grid size-6 cursor-pointer place-items-center" aria-label={`${c.t} ${m}`}>
                          <input type="radio" name={`${sel.id}-${c.k}`} checked={sel.marks[c.k] === m} onChange={() => setMark(c.k, m)} className="sr-only" />
                          <span className={cx("grid size-5 place-items-center rounded-full border-2", sel.marks[c.k] === m ? (m === "pass" ? "border-emerald-500 bg-emerald-500 text-white" : m === "fail" ? "border-rose-500 bg-white" : "border-slate-400 bg-slate-400 text-white") : "border-slate-300")}>
                            {sel.marks[c.k] === m && (m === "pass" ? <Check className="size-3" /> : m === "fail" ? <span className="size-2 rounded-full bg-rose-500" /> : <X className="size-3" />)}
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              <button onClick={() => patch({ marks: allPass() })} className="mt-2 text-xs font-bold text-brand">Mark all as Pass</button>
            </div>
          )}

          {(tab === "notes" || tab === "check") && (
            <div className="mt-3">
              {tab === "notes" && (
                <div className="mb-3">
                  <div className="mb-1.5 text-[13px] font-bold">Defect reason <span className="font-normal text-sub">(required for Fail / Rework)</span></div>
                  <div className="flex flex-wrap gap-1.5">
                    {DEFECTS.map((d) => <button key={d} onClick={() => patch({ defects: sel.defects.includes(d) ? sel.defects.filter((x) => x !== d) : [...sel.defects, d] })} className={cx("rounded-full border px-3 py-1 text-xs font-bold", sel.defects.includes(d) ? "border-rose-500 bg-rose-50 text-rose-600" : "border-line text-sub hover:bg-slate-50")}>{d}</button>)}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1 text-[13px] font-bold">QC Notes</div>
                  <textarea value={sel.notes} maxLength={500} onChange={(e) => patch({ notes: e.target.value })} className="h-[88px] w-full resize-none rounded-lg border border-line p-2 text-xs outline-none focus:border-brand" placeholder="Add inspection notes..." />
                  <div className="text-right text-[10px] text-sub">{sel.notes.length}/500</div>
                </div>
                <div>
                  <div className="mb-1 flex justify-between text-[13px] font-bold">Evidence Photos ({sel.evidence.length})</div>
                  <PhotoUploader ariaLabel="Add evidence photos" photos={sel.evidence} onChange={(p) => patch({ evidence: p })} size={52} />
                </div>
              </div>
            </div>
          )}

          {tab === "evidence" && (
            <div className="mt-3">
              <PhotoUploader ariaLabel="Evidence photos" photos={sel.evidence} onChange={(p) => patch({ evidence: p })} size={84} label="+ Add Photo" />
              {sel.evidence.length === 0 && <p className="mt-2 text-xs text-sub">No evidence yet. Upload photos of defects (JPG/PNG).</p>}
            </div>
          )}
          {tab === "history" && (
            <ol className="mt-3 space-y-2 text-[13px]">{sel.log.map((l, i) => <li key={i} className="flex gap-2"><Layers className="mt-0.5 size-4 text-brand" /><span>{l.text}<span className="block text-xs text-sub">{l.at}</span></span></li>)}</ol>
          )}

          <h3 className="mb-2 mt-3 text-sm font-extrabold">Disposition <span className="ml-1 text-[10px] font-medium text-sub">shortcuts <Kbd>P</Kbd> <Kbd>F</Kbd> <Kbd>R</Kbd></span></h3>
          {err && <div className="mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600">{err}</div>}
          <div className="grid grid-cols-4 gap-2 text-center">
            <button onClick={() => dispose("Passed")} className="rounded-xl border border-emerald-300 bg-emerald-50 py-2 text-emerald-700"><div className="flex items-center justify-center gap-1 text-[13px] font-extrabold"><Check className="size-4" />Pass</div><div className="text-[10px]">Send to Delivery</div></button>
            <button onClick={() => dispose("Failed")} className="rounded-xl border border-rose-200 bg-rose-50 py-2 text-rose-600"><div className="flex items-center justify-center gap-1 text-[13px] font-extrabold"><X className="size-4" />Fail</div><div className="text-[10px]">Hold & Review</div></button>
            <button onClick={() => dispose("Rework")} className="rounded-xl border border-orange-200 bg-orange-50 py-2 text-orange-600"><div className="flex items-center justify-center gap-1 text-[13px] font-extrabold"><Wrench className="size-4" />Rework</div><div className="text-[10px]">Send for Rework</div></button>
            <button onClick={() => dispose("Ready for Delivery")} className="rounded-xl border border-sky-200 bg-sky-50 py-2 text-sky-700"><div className="flex items-center justify-center gap-1 text-[12px] font-extrabold"><Truck className="size-4" />Ready</div><div className="text-[10px]">Mark as Ready</div></button>
          </div>
        </Panel>
      </div>

      <div className="mt-4">
        <Panel title="Inspection Register" subtitle="Click a row for the inspection summary and decision history" action={<button onClick={() => { downloadCsv("qc-register.csv", [["Order", "Customer", "Event", "Album", "Due", "Inspector", "Status", "Defects", "Evidence"], ...register.map((i) => [i.id, i.customer, i.event, `${i.size} / ${i.pages}p`, i.due, i.operator, i.status, i.defects.join("; "), i.evidence.length])]); show(`Exported ${register.length} inspections`); }} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-brand-soft"><Download className="size-4 text-sub" />Export</button>}>
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr>
                {vis("id") && <SortTh k="id" sort={sort} onSort={setSort}>Order ID</SortTh>}
                {vis("customer") && <SortTh k="customer" sort={sort} onSort={setSort}>Customer</SortTh>}
                {vis("event") && <SortTh k="event" sort={sort} onSort={setSort}>Event</SortTh>}
                {vis("size") && <SortTh k="size" sort={sort} onSort={setSort}>Album</SortTh>}
                {vis("due") && <SortTh k="due" sort={sort} onSort={setSort}>Due Date</SortTh>}
                {vis("operator") && <SortTh k="operator" sort={sort} onSort={setSort}>Inspector</SortTh>}
                {vis("status") && <SortTh k="status" sort={sort} onSort={setSort}>Status</SortTh>}
                {vis("defects") && <SortTh k="defects" sort={sort} onSort={setSort}>Defects</SortTh>}
                {vis("evidence") && <SortTh k="evidence" sort={sort} onSort={setSort}>Evidence</SortTh>}
                <th className="px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub">Actions</th>
              </tr></thead>
              <tbody>
                {regRows.map((i) => (
                  <tr key={i.id} onClick={() => setSummaryId(i.id)} className={cx(trCls, "cursor-pointer")}>
                    {vis("id") && <Td><b>{i.id}</b></Td>}
                    {vis("customer") && <Td>{i.customer}</Td>}
                    {vis("event") && <Td>{i.event}</Td>}
                    {vis("size") && <Td>{i.size} · {i.pages}p</Td>}
                    {vis("due") && <Td>{fmtDate(i.due)}</Td>}
                    {vis("operator") && <Td>{i.operator}</Td>}
                    {vis("status") && <Td><StatusMenu<QStatus> label={`Change status of ${i.id}`} trigger={<Pill tone={Q_TONE[i.status]} dot>{i.status}</Pill>} options={QSTATUSES.map((s) => ({ value: s }))} onPick={(s) => (s === "Awaiting QC" || s === "In Inspection" ? (patchById(i.id, { status: s, log: [...i.log, { at: nowStr(), text: s }] }), show(`${i.id}: ${s}`)) : dispose(s, i.id))} /></Td>}
                    {vis("defects") && <Td>{i.defects.join(", ") || "—"}</Td>}
                    {vis("evidence") && <Td>{i.evidence.length}</Td>}
                    <Td><div className="flex items-center gap-2"><button onClick={(e) => { e.stopPropagation(); setSummaryId(i.id); }} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold hover:bg-brand-soft">View</button></div></Td>
                  </tr>
                ))}
                {regRows.length === 0 && <tr><td colSpan={10} className="py-8 text-center text-sub">No inspections match the filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between pt-3 text-[13px] text-sub">
            <span>Showing {register.length ? (page - 1) * 6 + 1 : 0} to {Math.min(register.length, page * 6)} of {register.length} inspections</span>
            <div className="flex gap-2"><button disabled={page <= 1} onClick={() => setPage(page - 1)} className="h-8 rounded-lg border border-line px-3 font-bold disabled:opacity-40">Prev</button><button disabled={page * 6 >= register.length} onClick={() => setPage(page + 1)} className="h-8 rounded-lg border border-line px-3 font-bold disabled:opacity-40">Next</button></div>
          </div>
        </Panel>
      </div>
      {toast}

      {/* ───── inspection summary drawer ───── */}
      <SlideOver open={!!summary} onClose={() => setSummaryId(null)} title={summary ? `Inspection ${summary.id}` : "Inspection"} width={520} footer={summary && <>
        <button onClick={() => nav(`/orders/${summary.id}`)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Open order</button>
        <button onClick={() => { setSelId(summary.id); setSummaryId(null); setTab("check"); }} className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white">Open in inspector</button>
      </>}>
        {summary && (() => {
          const o = ORDERS.find((x) => x.id === summary.id);
          const marks = Object.values(summary.marks);
          return (
            <div className="space-y-4 text-[13px]">
              <div className="flex gap-3"><Thumb seed={summary.id} size={64} />
                <div className="min-w-0 flex-1"><div className="flex items-center justify-between"><b className="text-lg">{summary.id}</b><Pill tone={Q_TONE[summary.status]} dot>{summary.status}</Pill></div>
                  <div className="font-semibold">{summary.customer}</div><div className="text-xs text-sub">{summary.event} · {summary.size} · {summary.pages} pages</div></div></div>
              <div className="grid grid-cols-3 gap-2 text-xs text-sub">
                <div className="rounded-xl border border-line p-2.5">Due<div className="text-[13px] font-bold text-ink">{fmtDate(summary.due)}</div></div>
                <div className="rounded-xl border border-line p-2.5">Inspector<div className="text-[13px] font-bold text-ink">{summary.operator}</div></div>
                <div className="rounded-xl border border-line p-2.5">Order stage<div className="text-[13px] font-bold capitalize text-ink">{o?.stage.replace(/_/g, " ")}</div></div>
              </div>
              <div>
                <h3 className="mb-1.5 font-extrabold">Checklist</h3>
                <div className="mb-2 flex gap-2 text-xs"><Pill tone="green">{marks.filter((m) => m === "pass").length} pass</Pill><Pill tone="red">{marks.filter((m) => m === "fail").length} fail</Pill><Pill tone="slate">{marks.filter((m) => m === "").length} pending</Pill></div>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1">{CHECK.map((c) => <li key={c.k} className="flex justify-between text-xs"><span>{c.t}</span><b className={summary.marks[c.k] === "fail" ? "text-rose-600" : summary.marks[c.k] === "pass" ? "text-emerald-600" : "text-sub"}>{summary.marks[c.k] || "—"}</b></li>)}</ul>
              </div>
              {summary.defects.length > 0 && <div><h3 className="mb-1.5 font-extrabold">Defects</h3><div className="flex flex-wrap gap-1.5">{summary.defects.map((d) => <Pill key={d} tone="red">{d}</Pill>)}</div></div>}
              {summary.notes && <div><h3 className="mb-1.5 font-extrabold">Notes</h3><p className="rounded-xl bg-slate-50 p-3 text-xs">{summary.notes}</p></div>}
              <div><h3 className="mb-1.5 font-extrabold">Evidence ({summary.evidence.length})</h3>
                {summary.evidence.length ? <div className="flex flex-wrap gap-2">{summary.evidence.map((p) => p.url ? <img key={p.id} src={p.url} alt={p.name} className="size-20 rounded-lg border border-line object-cover" /> : <Thumb key={p.id} seed={p.name} size={80} />)}</div> : <p className="text-xs text-sub">No evidence attached.</p>}</div>
              <div>
                <h3 className="mb-1.5 font-extrabold">Decision history</h3>
                <ol className="space-y-2 border-l-2 border-line pl-4">
                  {[...summary.log].reverse().map((l, i) => (
                    <li key={i} className="relative text-xs"><span className={cx("absolute -left-[23px] top-1 size-3 rounded-full", l.status ? "bg-brand" : "bg-slate-300")} /><div className="font-semibold">{l.text}</div><div className="text-sub">{l.at}</div></li>
                  ))}
                </ol>
              </div>
            </div>
          );
        })()}
      </SlideOver>

      {/* ───── defect reason popover (Fail / Rework) ───── */}
      {decision && (
        <div className="fixed inset-0 z-[58] grid place-items-center bg-ink/40 p-4" onClick={() => setDecision(null)}>
          <div role="dialog" aria-label={`Defect reason for ${decision.status}`} className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold">{decision.status === "Failed" ? "Fail" : "Send for rework"} - {decision.id}</h3>
            <p className="mt-1 text-sm text-sub">Pick the defect reason(s). This is required and is saved to the decision history.</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {DEFECTS.map((d) => <button key={d} onClick={() => { setDChips(dChips.includes(d) ? dChips.filter((x) => x !== d) : [...dChips, d]); setDErr(""); }} className={cx("rounded-full border px-3 py-1 text-xs font-bold", dChips.includes(d) ? "border-rose-500 bg-rose-50 text-rose-600" : "border-line text-sub hover:bg-slate-50")}>{d}</button>)}
            </div>
            <textarea aria-label="Defect notes" value={dNote} onChange={(e) => setDNote(e.target.value)} placeholder="Notes for the printing team (optional)" className="mt-3 h-20 w-full resize-none rounded-lg border border-line p-2 text-sm outline-none focus:border-brand" />
            {dErr && <Err>{dErr}</Err>}
            <div className="mt-4 flex justify-end gap-3">
              <button onClick={() => setDecision(null)} className="h-10 rounded-lg px-4 text-sm font-bold hover:bg-slate-100">Cancel</button>
              <button onClick={confirmDecision} className={cx("h-10 rounded-lg px-5 text-sm font-bold text-white", decision.status === "Failed" ? "bg-rose-600 hover:bg-rose-700" : "bg-orange-500 hover:bg-orange-600")}>Confirm {decision.status === "Failed" ? "Fail" : "Rework"}</button>
            </div>
          </div>
        </div>
      )}

      <SlideOver open={newOpen} onClose={() => setNewOpen(false)} title="New Inspection" width={520} footer={<><button onClick={() => setNewOpen(false)} className="h-10 rounded-lg border border-line px-4 text-sm font-bold">Cancel</button><button onClick={createInsp} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Add to Queue</button></>}>
        <FieldBox label="Order waiting for QC (Printing / QC)" required>
          <Combobox error={!!nErr.order} placeholder="Search order or customer…" value={nForm.order} onChange={(v) => { const o = ORDERS.find((x) => x.id === v)!; setNForm({ ...nForm, order: v, due: o.due }); setNErr({}); }} options={eligible.map(orderOpt)} />
          <Err>{nErr.order}</Err>
        </FieldBox>
        {nOrder && (
          <div className="mb-4 grid grid-cols-3 gap-2 rounded-xl border border-line bg-slate-50/60 p-3 text-xs text-sub">
            <div className="col-span-3 text-sm font-bold text-ink">{nOrder.customer} <span className="font-normal text-sub">· {nOrder.event}</span></div>
            <div>Size<div className="text-sm font-bold text-ink">{nOrder.size}</div></div>
            <div>Pages<div className="text-sm font-bold text-ink">{nOrder.pages}</div></div>
            <div>Balance<div className="text-sm font-bold text-ink">{inr(nOrder.total - nOrder.paid)}</div></div>
          </div>
        )}
        <FieldBox label="Assign to"><Combobox value={nForm.assignee} onChange={(v) => setNForm({ ...nForm, assignee: v })} options={strOpts(OPS)} /></FieldBox>
        <FieldBox label="Inspection due" required><DateField label="Inspection due" value={nForm.due} error={!!nErr.due} onChange={(v) => setNForm({ ...nForm, due: v })} /><Err>{nErr.due}</Err></FieldBox>
        {nOrder?.stage === "printing" && <Banner tone="amber">This album is still in Printing - creating the inspection moves the order to the QC stage.</Banner>}
      </SlideOver>
      <SlideOver open={!!assignId} onClose={() => setAssignId(null)} title={`Assign ${assignId ?? ""}`} footer={<button onClick={() => { patchById(assignId!, { operator: assignTo }); show(`Assigned to ${assignTo}`); setAssignId(null); }} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white">Assign</button>}>
        <Field label="Inspector"><select aria-label="Inspector" className={inputCls} value={assignTo} onChange={(e) => setAssignTo(e.target.value)}>{OPS.map((o) => <option key={o}>{o}</option>)}</select></Field>
      </SlideOver>
      <SlideOver open={pagesOpen} onClose={() => setPagesOpen(false)} width={560} title={`All Pages - ${sel.id}`}>
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: spreads }, (_, i) => (
            <button key={i} onClick={() => { setThumb(i); setPagesOpen(false); }} className="text-center">
              <div className={cx("overflow-hidden rounded-md border-2", thumb === i ? "border-brand" : "border-transparent")}><Thumb seed={i + 7} size={0} rounded="rounded-none" className="!h-20 !w-full" /></div>
              <div className="mt-1 text-[10px] text-sub">{i === 0 ? "Cover" : `Page ${i * 2 - 1}-${i * 2}`}</div>
            </button>
          ))}
        </div>
      </SlideOver>
    </div>
  );
}
