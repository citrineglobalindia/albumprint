import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Columns3, Bookmark, Search, X, Plus, Trash2, SlidersHorizontal } from "lucide-react";
import { cx } from "./ui";
import { ORDERS, stageLabel } from "../lib/data";
import { TODAY } from "../lib/format";

/* ───────────── popover plumbing ───────────── */
export function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", h); document.addEventListener("keydown", k);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("keydown", k); };
  }, [open]);
  return { open, setOpen, ref };
}

/* ───────────── dates ───────────── */
export interface DateRange { from: Date | null; to: Date | null; preset: string }
const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return day(x); };
const same = (a: Date | null, b: Date | null) => !!a && !!b && a.toDateString() === b.toDateString();
export const fmtShort = (d: Date | null) => d ? d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "—";
export const PRESETS = ["Today", "Yesterday", "Last 7 Days", "Last 30 Days", "This Month", "Last Month", "This Quarter", "All Time"] as const;
export function presetRange(p: string): DateRange {
  const t = day(TODAY);
  switch (p) {
    case "Today": return { from: t, to: t, preset: p };
    case "Yesterday": return { from: addDays(t, -1), to: addDays(t, -1), preset: p };
    case "Last 7 Days": return { from: addDays(t, -6), to: t, preset: p };
    case "Last 30 Days": return { from: addDays(t, -29), to: t, preset: p };
    case "This Month": return { from: new Date(t.getFullYear(), t.getMonth(), 1), to: new Date(t.getFullYear(), t.getMonth() + 1, 0), preset: p };
    case "Last Month": return { from: new Date(t.getFullYear(), t.getMonth() - 1, 1), to: new Date(t.getFullYear(), t.getMonth(), 0), preset: p };
    case "This Quarter": { const q = Math.floor(t.getMonth() / 3) * 3; return { from: new Date(t.getFullYear(), q, 1), to: new Date(t.getFullYear(), q + 3, 0), preset: p }; }
    default: return { from: null, to: null, preset: "All Time" };
  }
}
export const inRange = (iso: string, r: DateRange) => { if (!r.from || !r.to) return true; const d = day(new Date(iso)); return d >= r.from && d <= r.to; };

export function Calendar({ month, onMonth, from, to, onPick, marks }: { month: Date; onMonth: (d: Date) => void; from: Date | null; to: Date | null; onPick: (d: Date) => void; marks?: Record<string, number> }) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(first, i - first.getDay()));
  return (
    <div className="w-full max-w-[300px] sm:w-[260px]">
      <div className="mb-2 flex items-center justify-between">
        <button onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))} className="grid size-7 place-items-center rounded-lg hover:bg-slate-100" aria-label="Previous month"><ChevronLeft className="size-4" /></button>
        <b className="text-sm">{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</b>
        <button onClick={() => onMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))} className="grid size-7 place-items-center rounded-lg hover:bg-slate-100" aria-label="Next month"><ChevronRight className="size-4" /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-bold text-sub">{["S", "M", "T", "W", "T", "F", "S"].map((d, i) => <span key={i} className="py-1">{d}</span>)}</div>
      <div className="grid grid-cols-7">
        {cells.map((d) => {
          const out = d.getMonth() !== month.getMonth();
          const edge = same(d, from) || same(d, to);
          const mid = from && to && d > from && d < to;
          const n = marks?.[d.toDateString()];
          return (
            <button key={d.toISOString()} onClick={() => onPick(d)} className={cx("relative h-8 text-xs font-semibold", out && "text-slate-300", mid && "bg-brand-soft", edge && "rounded-lg bg-brand text-white", !edge && !mid && "rounded-lg hover:bg-slate-100", same(d, day(TODAY)) && !edge && "text-brand ring-1 ring-brand/40 rounded-lg")}>
              {d.getDate()}
              {n ? <span className={cx("absolute bottom-0.5 left-1/2 size-1 -translate-x-1/2 rounded-full", edge ? "bg-white" : "bg-brand")} /> : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function DateRangePicker({ value, onChange, className, align = "right" }: { value: DateRange; onChange: (r: DateRange) => void; className?: string; align?: "left" | "right" }) {
  const { open, setOpen, ref } = usePopover();
  const [draft, setDraft] = useState<DateRange>(value);
  const [month, setMonth] = useState(() => value.to ?? day(TODAY));
  const [picking, setPicking] = useState(false);
  const openIt = () => { setDraft(value); setMonth(value.to ?? day(TODAY)); setPicking(false); setOpen(!open); };
  const pick = (d: Date) => {
    if (!picking || !draft.from) { setDraft({ from: d, to: null, preset: "Custom" }); setPicking(true); }
    else { const [a, b] = d < draft.from ? [d, draft.from] : [draft.from, d]; setDraft({ from: a, to: b, preset: "Custom" }); setPicking(false); }
  };
  const label = value.preset === "All Time" ? "All Time" : value.from && value.to && same(value.from, value.to) ? fmtShort(value.from) : `${fmtShort(value.from)} – ${fmtShort(value.to)}`;
  return (
    <div ref={ref} className={cx("relative", className)}>
      <button aria-haspopup="dialog" aria-expanded={open} onClick={openIt} className="flex h-10 items-center gap-2.5 rounded-xl border border-line bg-white px-3.5 text-left hover:bg-brand-soft/50">
        <CalendarDays className="size-5 text-sub" />
        <span className="leading-tight"><span className="block text-[11px] text-sub">{value.preset}</span><span className="block text-[13px] font-bold">{label}</span></span>
        <ChevronDown className="size-4 text-sub" />
      </button>
      {open && (
        <div role="dialog" aria-label="Choose date range" className={cx("fixed inset-x-3 top-20 z-50 flex max-h-[80dvh] flex-col overflow-y-auto rounded-2xl border border-line bg-white p-3 shadow-2xl sm:absolute sm:inset-x-auto sm:top-12 sm:max-h-none sm:flex-row sm:overflow-visible", align === "right" ? "sm:right-0" : "sm:left-0")}>
          <div className="mb-3 flex flex-wrap gap-1 border-b border-line pb-3 sm:mb-0 sm:mr-3 sm:block sm:w-36 sm:gap-0 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-3">
            {PRESETS.map((p) => (
              <button key={p} onClick={() => { const r = presetRange(p); setDraft(r); if (r.to) setMonth(r.to); }} className={cx("block w-full rounded-lg px-2.5 py-1.5 text-left text-[13px] font-semibold", draft.preset === p ? "bg-brand-soft text-brand" : "hover:bg-slate-100")}>{p}</button>
            ))}
          </div>
          <div>
            <Calendar month={month} onMonth={setMonth} from={draft.from} to={draft.to} onPick={pick} />
            <div className="mt-2 flex items-center justify-between border-t border-line pt-2">
              <span className="text-xs text-sub">{draft.from ? `${fmtShort(draft.from)}${draft.to ? " – " + fmtShort(draft.to) : " …pick end date"}` : "Pick a start date"}</span>
              <span className="flex gap-2">
                <button onClick={() => setOpen(false)} className="h-8 rounded-lg px-3 text-xs font-bold hover:bg-slate-100">Cancel</button>
                <button disabled={!!draft.from && !draft.to} onClick={() => { onChange(draft); setOpen(false); }} className="h-8 rounded-lg bg-brand px-3 text-xs font-bold text-white disabled:opacity-40">Apply</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Replaces the static "Today" chip: click for a calendar + that day's due orders. */
export function TodayChip() {
  const { open, setOpen, ref } = usePopover();
  const [sel, setSel] = useState(day(TODAY));
  const [month, setMonth] = useState(day(TODAY));
  const marks = useMemo(() => { const m: Record<string, number> = {}; ORDERS.forEach((o) => { const k = day(new Date(o.due)).toDateString(); m[k] = (m[k] ?? 0) + 1; }); return m; }, []);
  const due = ORDERS.filter((o) => same(day(new Date(o.due)), sel));
  return (
    <div ref={ref} className="relative">
      <button aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(!open)} className="flex items-center gap-3 rounded-xl border border-line bg-white px-3 py-2 sm:px-4 hover:bg-brand-soft/50">
        <CalendarDays className="size-6 text-sub" />
        <span className="text-left text-xs leading-tight text-sub">{same(sel, day(TODAY)) ? "Today" : "Viewing"}<span className="block text-sm font-semibold text-ink">{sel.toLocaleDateString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}</span></span>
        <ChevronDown className="size-4 text-sub" />
      </button>
      {open && (
        <div role="dialog" aria-label="Calendar and due orders" className="fixed inset-x-3 top-20 z-50 flex max-h-[80dvh] flex-col gap-4 overflow-y-auto rounded-2xl border border-line bg-white p-4 shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-14 sm:max-h-none sm:flex-row sm:overflow-visible">
          <div>
            <Calendar month={month} onMonth={setMonth} from={sel} to={sel} onPick={setSel} marks={marks} />
            <button onClick={() => { setSel(day(TODAY)); setMonth(day(TODAY)); }} className="mt-2 text-xs font-bold text-brand">Jump to today</button>
          </div>
          <div className="border-t border-line pt-3 sm:w-64 sm:border-l sm:border-t-0 sm:pl-4 sm:pt-0">
            <div className="mb-2 text-sm font-extrabold">Due on {fmtShort(sel)} <span className="text-sub">({due.length})</span></div>
            <div className="scroll-thin max-h-60 space-y-1.5 overflow-y-auto">
              {due.length === 0 && <p className="text-xs text-sub">No deliveries promised on this day.</p>}
              {due.map((o) => <Link key={o.id} to={`/orders/${o.id}`} onClick={() => setOpen(false)} className="flex items-center justify-between rounded-lg border border-line px-2.5 py-1.5 text-xs hover:bg-brand-soft"><span><b>{o.id}</b> · {o.customer}</span><span className="text-sub">{stageLabel(o.stage)}</span></Link>)}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── filters ───────────── */
export function MultiSelect({ label, options, value, onChange, className }: { label: string; options: string[]; value: string[]; onChange: (v: string[]) => void; className?: string }) {
  const { open, setOpen, ref } = usePopover();
  const [q, setQ] = useState("");
  const shown = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const toggle = (o: string) => onChange(value.includes(o) ? value.filter((x) => x !== o) : [...value, o]);
  return (
    <div ref={ref} className={cx("relative", className)}>
      <button onClick={() => setOpen(!open)} className={cx("flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-[13px] font-medium", value.length ? "border-brand text-brand" : "border-line")}>
        <span className="truncate">{value.length === 0 ? label : value.length === 1 ? value[0] : `${label} · ${value.length}`}</span>
        <ChevronDown className="size-4 shrink-0 text-sub" />
      </button>
      {open && (
        <div className="absolute left-0 top-11 z-50 w-60 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-2 shadow-2xl">
          {options.length > 6 && <label className="mb-1 flex h-9 items-center gap-2 rounded-lg border border-line px-2.5"><Search className="size-3.5 text-sub" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="w-full bg-transparent text-xs outline-none" /></label>}
          <div className="scroll-thin max-h-56 overflow-y-auto">
            {shown.map((o) => (
              <button key={o} onClick={() => toggle(o)} className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] hover:bg-brand-soft">
                <span className={cx("grid size-4 place-items-center rounded border", value.includes(o) ? "border-brand bg-brand text-white" : "border-slate-300")}>{value.includes(o) && <Check className="size-3" />}</span>{o}
              </button>
            ))}
            {shown.length === 0 && <p className="p-2 text-xs text-sub">No matches</p>}
          </div>
          <div className="mt-1 flex justify-between border-t border-line pt-1.5 text-xs font-bold">
            <button onClick={() => onChange([...options])} className="text-brand">Select all</button>
            <button onClick={() => onChange([])} className="text-sub">Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function FilterChips({ chips, onClearAll }: { chips: { label: string; onRemove: () => void }[]; onClearAll: () => void }) {
  if (!chips.length) return null;
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <span className="flex items-center gap-1 text-xs font-bold text-sub"><SlidersHorizontal className="size-3.5" />Filters:</span>
      {chips.map((c) => <span key={c.label} className="inline-flex items-center gap-1.5 rounded-full bg-brand-soft px-2.5 py-1 text-xs font-bold text-brand">{c.label}<button onClick={c.onRemove} aria-label={`Remove ${c.label}`}><X className="size-3" /></button></span>)}
      <button onClick={onClearAll} className="text-xs font-bold text-sub hover:text-ink">Clear all</button>
    </div>
  );
}

export interface ComboOption { value: string; label: string; sub?: string }
/** Searchable single select with optional "create new" action. */
export function Combobox({ options, value, onChange, placeholder = "Select…", onCreate, createLabel = "Add new", className, error }: { options: ComboOption[]; value: string; onChange: (v: string) => void; placeholder?: string; onCreate?: (q: string) => void; createLabel?: string; className?: string; error?: boolean }) {
  const { open, setOpen, ref } = usePopover();
  const [q, setQ] = useState("");
  const cur = options.find((o) => o.value === value);
  const shown = options.filter((o) => (o.label + " " + (o.sub ?? "")).toLowerCase().includes(q.toLowerCase())).slice(0, 50);
  return (
    <div ref={ref} className={cx("relative", className)}>
      <button type="button" onClick={() => { setOpen(!open); setQ(""); }} className={cx("flex h-10 w-full items-center justify-between gap-2 rounded-lg border bg-white px-3 text-left text-sm", error ? "border-rose-400" : "border-line")}>
        <span className={cx("truncate", !cur && "text-slate-400")}>{cur ? <>{cur.label}{cur.sub && <span className="ml-2 text-xs text-sub">{cur.sub}</span>}</> : placeholder}</span>
        <ChevronsUpDown className="size-4 shrink-0 text-sub" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 top-11 z-50 rounded-xl border border-line bg-white p-2 shadow-2xl">
          <label className="mb-1 flex h-9 items-center gap-2 rounded-lg border border-line px-2.5"><Search className="size-3.5 text-sub" /><input autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && shown[0] && (onChange(shown[0].value), setOpen(false))} placeholder="Type to search…" className="w-full bg-transparent text-sm outline-none" /></label>
          <div className="scroll-thin max-h-56 overflow-y-auto">
            {shown.map((o) => <button key={o.value} type="button" onClick={() => { onChange(o.value); setOpen(false); }} className={cx("flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-brand-soft", o.value === value && "bg-brand-soft")}><span>{o.label}</span>{o.sub && <span className="text-xs text-sub">{o.sub}</span>}</button>)}
            {shown.length === 0 && <p className="p-2 text-xs text-sub">No matches</p>}
          </div>
          {onCreate && <button type="button" onClick={() => { setOpen(false); onCreate(q); }} className="mt-1 flex w-full items-center gap-2 border-t border-line px-2.5 pt-2 text-left text-sm font-bold text-brand"><Plus className="size-4" />{createLabel}{q && ` “${q}”`}</button>}
        </div>
      )}
    </div>
  );
}

/* ───────────── saved views & columns ───────────── */
export function SavedViews<T>({ storageKey, current, onApply }: { storageKey: string; current: T; onApply: (v: T) => void }) {
  const key = `albumpro.views.${storageKey}`;
  const { open, setOpen, ref } = usePopover();
  const read = (): { name: string; state: T }[] => { try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; } };
  const [views, setViews] = useState(read);
  const [name, setName] = useState("");
  const write = (v: typeof views) => { setViews(v); try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* ignore */ } };
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold hover:bg-brand-soft"><Bookmark className="size-4 text-sub" />Views{views.length > 0 && <span className="rounded-full bg-slate-100 px-1.5 text-xs">{views.length}</span>}</button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-64 max-w-[calc(100vw-2rem)] rounded-xl border border-line bg-white p-2 shadow-2xl">
          {views.length === 0 && <p className="p-2 text-xs text-sub">No saved views yet. Set up filters, then save them here.</p>}
          {views.map((v) => (
            <div key={v.name} className="flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-brand-soft">
              <button onClick={() => { onApply(v.state); setOpen(false); }} className="flex-1 text-left text-[13px] font-semibold">{v.name}</button>
              <button aria-label={`Delete view ${v.name}`} onClick={() => write(views.filter((x) => x.name !== v.name))} className="text-sub hover:text-rose-600"><Trash2 className="size-3.5" /></button>
            </div>
          ))}
          <div className="mt-1 flex gap-1.5 border-t border-line pt-2">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this view" className="h-8 min-w-0 flex-1 rounded-lg border border-line px-2 text-xs outline-none focus:border-brand" />
            <button disabled={!name.trim()} onClick={() => { write([...views.filter((x) => x.name !== name.trim()), { name: name.trim(), state: current }]); setName(""); }} className="h-8 rounded-lg bg-brand px-3 text-xs font-bold text-white disabled:opacity-40">Save</button>
          </div>
        </div>
      )}
    </div>
  );
}

export function ColumnsMenu({ columns, hidden, onChange }: { columns: { key: string; label: string }[]; hidden: string[]; onChange: (h: string[]) => void }) {
  const { open, setOpen, ref } = usePopover();
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)} className="flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-semibold hover:bg-brand-soft"><Columns3 className="size-4 text-sub" />Columns</button>
      {open && (
        <div className="absolute right-0 top-11 z-50 w-52 rounded-xl border border-line bg-white p-2 shadow-2xl">
          {columns.map((c) => (
            <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] hover:bg-brand-soft">
              <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => onChange(hidden.includes(c.key) ? hidden.filter((x) => x !== c.key) : [...hidden, c.key])} />{c.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────── sorting ───────────── */
export type SortState = { key: string; dir: 1 | -1 } | null;
export function sortRows<T>(rows: T[], sort: SortState, get: (row: T, key: string) => string | number) {
  if (!sort) return rows;
  return [...rows].sort((a, b) => { const x = get(a, sort.key), y = get(b, sort.key); return (x < y ? -1 : x > y ? 1 : 0) * sort.dir; });
}
/** Clickable table header: click cycles asc → desc → none. */
export function SortTh({ k, sort, onSort, children, className }: { k: string; sort: SortState; onSort: (s: SortState) => void; children: ReactNode; className?: string }) {
  const active = sort?.key === k;
  return (
    <th scope="col" aria-sort={active ? (sort!.dir === 1 ? "ascending" : "descending") : "none"} className={cx("whitespace-nowrap px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub", className)}>
      <button onClick={() => onSort(!active ? { key: k, dir: 1 } : sort!.dir === 1 ? { key: k, dir: -1 } : null)} className="inline-flex items-center gap-1 uppercase hover:text-ink">
        {children}{active ? (sort!.dir === 1 ? <ChevronUp className="size-3 text-brand" /> : <ChevronDown className="size-3 text-brand" />) : <ChevronsUpDown className="size-3 opacity-40" />}
      </button>
    </th>
  );
}
