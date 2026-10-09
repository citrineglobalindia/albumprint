import { useState } from "react";
import { Clock, Search, CheckCircle2, XCircle, Wrench, Truck, ShieldCheck, MoreVertical, ChevronLeft, ChevronRight, Check, X, Plus, ScanLine, Layers, Scissors, BookOpen, AlignCenter, Square, Package, Palette, ChevronDown } from "lucide-react";
import { PageHeader, KpiRow, Panel, Pill, Avatar, Thumb, SearchInput, FilterSelect, LineTabs, PrimaryButton, TodayChip, cx, type Kpi } from "../components/ui";
import { ORDERS } from "../lib/data";
import type { Tone } from "../lib/data";
import { fmtDate } from "../lib/format";

type QStatus = "Awaiting QC" | "In Inspection" | "Passed" | "Failed" | "Rework" | "Ready for Delivery";
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

interface Insp { id: string; customer: string; event: string; size: string; pages: number; due: string; operator: string; status: QStatus; marks: Record<string, Mark>; notes: string; defect: string; evidence: number; log: string[] }

const OPS = ["Suresh K", "Ramesh K", "Divya", "Manoj", "Admin", "Anil"];
const STATUSES: QStatus[] = ["In Inspection", "Awaiting QC", "Rework", "Passed", "Failed", "Awaiting QC"];
const blank = (): Record<string, Mark> => Object.fromEntries(CHECK.map((c) => [c.k, ""]));

const build = (): Insp[] =>
  ORDERS.slice(0, 18).map((o, i) => ({
    id: o.id, customer: o.customer, event: o.event, size: o.size, pages: o.pages, due: o.due, operator: OPS[i % OPS.length]!,
    status: STATUSES[i % STATUSES.length]!,
    marks: i === 0 ? { print: "pass", colour: "pass", trim: "pass", bind: "fail", align: "pass", cover: "pass", pack: "" } : blank(),
    notes: i === 0 ? "Overall print quality is excellent. Found minor scratch on back cover. Sending for rework." : "",
    defect: i === 0 ? "Scratch" : "", evidence: i === 0 ? 3 : 0, log: ["Received from Printing - 2 Oct 2026, 05:30 PM"],
  }));

export default function QualityControl() {
  const [items, setItems] = useState(build);
  const [selId, setSelId] = useState("IDP00072");
  const [statusF, setStatusF] = useState("All Statuses");
  const [q, setQ] = useState("");
  const [tab, setTab] = useState<"check" | "notes" | "evidence" | "history">("check");
  const [thumb, setThumb] = useState(0);
  const [err, setErr] = useState("");

  const sel = items.find((i) => i.id === selId)!;
  const list = items.filter((i) => (statusF === "All Statuses" || i.status === statusF) && (!q || `${i.id} ${i.customer} ${i.event}`.toLowerCase().includes(q.toLowerCase())));
  const cnt = (s: QStatus) => items.filter((i) => i.status === s).length;
  const patch = (p: Partial<Insp>) => setItems((is) => is.map((i) => (i.id === selId ? { ...i, ...p } : i)));
  const spreads = Math.ceil(sel.pages / 2) + 1;
  const prev = ["Cover", ...Array.from({ length: 8 }, (_, i) => `Page ${i * 2 + 1}-${i * 2 + 2}`)];

  const kpis: Kpi[] = [
    { label: "Awaiting QC", value: cnt("Awaiting QC") + 12, delta: 12, icon: Clock, tone: "orange" },
    { label: "In Inspection", value: cnt("In Inspection") + 11, delta: 20, icon: Search, tone: "violet" },
    { label: "Passed", value: cnt("Passed") + 153, delta: 28, icon: CheckCircle2, tone: "green" },
    { label: "Failed", value: cnt("Failed") + 6, delta: 0, icon: XCircle, tone: "red", invert: true },
    { label: "Rework", value: cnt("Rework") + 4, delta: -25, icon: Wrench, tone: "orange", invert: true },
    { label: "Ready for Delivery", value: cnt("Ready for Delivery") + 142, delta: 32, icon: Truck, tone: "blue" },
  ];

  const setMark = (k: string, m: Mark) => patch({ marks: { ...sel.marks, [k]: m } });
  const dispose = (s: QStatus) => {
    const failing = s === "Failed" || s === "Rework";
    if (failing && !sel.defect) { setErr("Select a defect reason (required for Fail / Rework)."); setTab("notes"); return; }
    if (s === "Passed" || s === "Ready for Delivery") {
      if (Object.values(sel.marks).includes("fail")) { setErr("Checklist has failed items - cannot pass."); return; }
      if (Object.values(sel.marks).some((m) => m === "")) { setErr("Complete the checklist before passing."); return; }
    }
    setErr("");
    patch({ status: s, log: [...sel.log, `${s}${failing ? ` (${sel.defect})` : ""} - 3 Oct 2026, 10:00 AM by Divya S`] });
  };

  return (
    <div className="min-w-0">
      <PageHeader title="Quality Control" subtitle="Inspect completed albums for quality, ensure perfection before delivery." icon={<ShieldCheck className="size-10 text-brand" />}>
        <TodayChip />
        <PrimaryButton>New Inspection</PrimaryButton>
        <button className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold">More <ChevronDown className="size-4" /></button>
      </PageHeader>
      <KpiRow items={kpis} />

      <div className="grid grid-cols-[360px_minmax(0,1fr)_420px] gap-4">
        <Panel title="Inspection Queue" action={<span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold">{list.length}</span>} bodyClassName="p-3">
          <FilterSelect className="mb-2" value={statusF} onChange={setStatusF} options={["All Statuses", "Awaiting QC", "In Inspection", "Passed", "Failed", "Rework", "Ready for Delivery"]} />
          <SearchInput className="mb-3" value={q} onChange={setQ} placeholder="Search by order ID, customer, event..." />
          <div className="scroll-thin max-h-[640px] space-y-2 overflow-y-auto pr-1">
            {list.map((i) => (
              <button key={i.id} onClick={() => { setSelId(i.id); setErr(""); }} className={cx("flex w-full items-start gap-3 rounded-xl border p-3 text-left", i.id === selId ? "border-brand bg-brand-soft/40" : "border-line hover:bg-slate-50")}>
                <Thumb seed={i.id} size={56} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2"><b className="text-[13px]">{i.id}</b><Pill tone={Q_TONE[i.status]} dot>{i.status}</Pill></div>
                  <div className="truncate text-xs text-sub">{i.customer}</div>
                  <div className="text-xs text-sub">{i.event} Album</div>
                  <div className="mt-0.5 flex items-center justify-between text-xs text-sub"><span>{i.size} | {i.pages} Pages</span><span className="flex items-center gap-1.5 font-medium text-ink"><Avatar name={i.operator} size={20} />{i.operator}</span></div>
                </div>
                <MoreVertical className="size-4 shrink-0 text-sub" />
              </button>
            ))}
            {list.length === 0 && <div className="py-8 text-center text-sm text-sub">No albums match.</div>}
          </div>
        </Panel>

        <Panel title="Album Preview" bodyClassName="p-4" action={
          <div className="flex items-center gap-2 text-xs">
            <button aria-label="Previous" disabled={thumb === 0} onClick={() => setThumb(thumb - 1)} className="grid size-7 place-items-center rounded-lg border border-line disabled:opacity-40"><ChevronLeft className="size-4" /></button>
            <span>{thumb + 1} / {sel.pages}</span>
            <button aria-label="Next" disabled={thumb >= spreads - 1} onClick={() => setThumb(thumb + 1)} className="grid size-7 place-items-center rounded-lg border border-line disabled:opacity-40"><ChevronRight className="size-4" /></button>
          </div>
        }>
          <div className="relative grid h-[290px] place-items-center rounded-xl bg-gradient-to-br from-stone-200 to-stone-300">
            <div className="flex h-[86%] w-[70%] overflow-hidden rounded-md bg-[#f1ece4] shadow-2xl">
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
          <div className="mt-4 flex items-baseline justify-between text-sm"><h3 className="font-extrabold">Page Thumbnails <span className="text-xs font-normal text-sub">({sel.pages} pages)</span></h3><span className="text-xs font-bold text-brand">View All Pages →</span></div>
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
            <div className="flex items-center gap-2 text-xs text-sub">Order ID <b className="text-ink">{sel.id}</b><Pill tone={Q_TONE[sel.status]} dot>{sel.status}</Pill></div></div>
          <div className="grid grid-cols-[1.5fr_1fr_1fr] gap-2 text-xs">
            <div className="flex gap-2 rounded-xl border border-line p-2"><Thumb seed={sel.id} size={40} /><div className="min-w-0"><b className="block truncate text-[13px]">{sel.customer}</b><span className="text-sub">{sel.event} Album</span><div className="text-sub">{sel.size} | {sel.pages} Pages</div></div></div>
            <div className="rounded-xl border border-line p-2"><div className="text-sub">Due Date</div><b className="text-[13px]">{fmtDate(sel.due)}</b></div>
            <div className="rounded-xl border border-line p-2"><div className="text-sub">Assigned To</div><b className="flex items-center gap-1 text-[13px]"><Avatar name={sel.operator} size={20} /><span className="truncate">{sel.operator}</span></b></div>
          </div>
          <LineTabs className="mt-3 gap-5" value={tab} onChange={setTab} tabs={[{ key: "check", label: "QC Checklist" }, { key: "notes", label: "Defects & Notes" }, { key: "evidence", label: `Evidence (${sel.evidence})` }, { key: "history", label: "History" }]} />

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
            </div>
          )}

          {(tab === "notes" || tab === "check") && (
            <div className="mt-3">
              {tab === "notes" && (
                <div className="mb-3">
                  <div className="mb-1.5 text-[13px] font-bold">Defect reason <span className="font-normal text-sub">(required for Fail / Rework)</span></div>
                  <div className="flex flex-wrap gap-1.5">
                    {DEFECTS.map((d) => <button key={d} onClick={() => patch({ defect: sel.defect === d ? "" : d })} className={cx("rounded-full border px-3 py-1 text-xs font-bold", sel.defect === d ? "border-rose-500 bg-rose-50 text-rose-600" : "border-line text-sub hover:bg-slate-50")}>{d}</button>)}
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
                  <div className="mb-1 flex justify-between text-[13px] font-bold">Evidence Photos ({sel.evidence})</div>
                  <div className="flex gap-2">
                    {Array.from({ length: Math.min(sel.evidence, 2) }, (_, i) => (
                      <div key={i} className="relative"><Thumb seed={i + 20} size={56} /><button aria-label="Remove" onClick={() => patch({ evidence: sel.evidence - 1 })} className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-ink text-white"><X className="size-3" /></button></div>
                    ))}
                    <button onClick={() => patch({ evidence: sel.evidence + 1 })} className="grid size-14 place-items-center rounded-lg border-2 border-dashed border-brand/40 text-[10px] font-semibold text-brand"><span><Plus className="mx-auto size-4" />Add Photo</span></button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "evidence" && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {Array.from({ length: sel.evidence }, (_, i) => <Thumb key={i} seed={i + 20} size={80} className="!w-full" />)}
              <button onClick={() => patch({ evidence: sel.evidence + 1 })} className="grid h-20 place-items-center rounded-lg border-2 border-dashed border-brand/40 text-xs font-semibold text-brand">+ Add Photo</button>
            </div>
          )}
          {tab === "history" && (
            <ol className="mt-3 space-y-2 text-[13px]">{sel.log.map((l, i) => <li key={i} className="flex gap-2"><Layers className="mt-0.5 size-4 text-brand" />{l}</li>)}</ol>
          )}

          <h3 className="mb-2 mt-3 text-sm font-extrabold">Disposition</h3>
          {err && <div className="mb-2 rounded-lg bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-600">{err}</div>}
          <div className="grid grid-cols-4 gap-2 text-center">
            <button onClick={() => dispose("Passed")} className="rounded-xl border border-emerald-300 bg-emerald-50 py-2 text-emerald-700"><div className="flex items-center justify-center gap-1 text-[13px] font-extrabold"><Check className="size-4" />Pass</div><div className="text-[10px]">Send to Delivery</div></button>
            <button onClick={() => dispose("Failed")} className="rounded-xl border border-rose-200 bg-rose-50 py-2 text-rose-600"><div className="flex items-center justify-center gap-1 text-[13px] font-extrabold"><X className="size-4" />Fail</div><div className="text-[10px]">Hold & Review</div></button>
            <button onClick={() => dispose("Rework")} className="rounded-xl border border-orange-200 bg-orange-50 py-2 text-orange-600"><div className="flex items-center justify-center gap-1 text-[13px] font-extrabold"><Wrench className="size-4" />Rework</div><div className="text-[10px]">Send for Rework</div></button>
            <button onClick={() => dispose("Ready for Delivery")} className="rounded-xl border border-sky-200 bg-sky-50 py-2 text-sky-700"><div className="flex items-center justify-center gap-1 text-[12px] font-extrabold"><Truck className="size-4" />Ready</div><div className="text-[10px]">Mark as Ready</div></button>
          </div>
        </Panel>
      </div>
    </div>
  );
}
