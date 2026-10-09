import { useEffect, useRef, useState, type ReactNode } from "react";
import { CalendarDays, ChevronDown, ImagePlus, X } from "lucide-react";
import { Calendar, usePopover, fmtShort, presetRange, type ComboOption, type DateRange } from "./controls";
import { cx } from "./ui";
import type { Order } from "../lib/data";
import { TODAY, inr } from "../lib/format";

/* ───────── module-level persisted page state (survives route changes) ───────── */
const STORE = new Map<string, unknown>();
export function usePersisted<T>(key: string, init: () => T) {
  const [v, setV] = useState<T>(() => (STORE.has(key) ? (STORE.get(key) as T) : init()));
  useEffect(() => { STORE.set(key, v); }, [key, v]);
  return [v, setV] as const;
}

/** "/" focuses the first page-level search input. */
export function useSlashSearch() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input,textarea,select,[contenteditable=true]")) return;
      const el = document.querySelector<HTMLInputElement>('main input[placeholder^="Search"]');
      if (el) { e.preventDefault(); el.focus(); el.select(); }
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
}

/* ───────── dates ───────── */
export const isoLocal = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const parseIso = (s: string) => new Date(s + "T00:00:00");
export const addDaysIso = (iso: string, n: number) => { const d = parseIso(iso); d.setDate(d.getDate() + n); return isoLocal(d); };
export const TODAY_ISO = isoLocal(TODAY);
export type SavedRange = { preset: string; from: string | null; to: string | null };
export const serRange = (r: DateRange): SavedRange => ({ preset: r.preset, from: r.from ? isoLocal(r.from) : null, to: r.to ? isoLocal(r.to) : null });
export const desRange = (s: SavedRange): DateRange => ({ preset: s.preset, from: s.from ? parseIso(s.from) : null, to: s.to ? parseIso(s.to) : null });
export const ALL_TIME = () => presetRange("All Time");
/** Rows without a date only match when no range is applied. */
export const inRangeOpt = (iso: string | null | undefined, r: DateRange) => {
  if (!r.from || !r.to) return true;
  if (!iso) return false;
  const d = parseIso(iso.slice(0, 10));
  return d >= r.from && d <= r.to;
};
export const rangeLabel = (r: DateRange) => (r.from && r.to ? (r.from.toDateString() === r.to.toDateString() ? fmtShort(r.from) : `${fmtShort(r.from)} – ${fmtShort(r.to)}`) : "");

/** Single-date picker built on the shared Calendar. Popover is fixed so drawers never clip it. */
export function DateField({ value, onChange, error, min, placeholder = "Pick a date", label }: { value: string; onChange: (iso: string) => void; error?: boolean; min?: string; placeholder?: string; label?: string }) {
  const { open, setOpen, ref } = usePopover();
  const btn = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const cur = value ? parseIso(value) : null;
  const [month, setMonth] = useState<Date>(cur ?? TODAY);
  return (
    <div ref={ref} className="relative">
      <button ref={btn} type="button" aria-label={label ?? placeholder} onClick={() => {
        const r = btn.current!.getBoundingClientRect();
        const h = 330;
        setPos({ top: r.bottom + h > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 296)) });
        setMonth(cur ?? TODAY); setOpen(!open);
      }} className={cx("flex h-10 w-full items-center gap-2 rounded-lg border bg-white px-3 text-left text-sm", error ? "border-rose-400" : "border-line")}>
        <CalendarDays className="size-4 text-sub" />
        <span className={cx(!cur && "text-slate-400")}>{cur ? fmtShort(cur) : placeholder}</span>
        <ChevronDown className="ml-auto size-4 text-sub" />
      </button>
      {open && (
        <div className="fixed z-[70] rounded-2xl border border-line bg-white p-3 shadow-2xl" style={pos}>
          <Calendar month={month} onMonth={setMonth} from={cur} to={cur} onPick={(d) => {
            const iso = isoLocal(d);
            if (min && iso < min) return;
            onChange(iso); setOpen(false);
          }} />
          <div className="mt-2 flex justify-between border-t border-line pt-2 text-xs font-bold">
            <button type="button" onClick={() => { onChange(TODAY_ISO); setOpen(false); }} className="text-brand">Today</button>
            <button type="button" onClick={() => setOpen(false)} className="text-sub">Close</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────── small form bits ───────── */
export const Err = ({ children }: { children?: ReactNode }) => (children ? <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{children}</p> : null);
export const Banner = ({ tone = "red", children }: { tone?: "red" | "amber" | "green" | "blue"; children: ReactNode }) => (
  <div className={cx("rounded-lg px-3 py-2 text-xs font-semibold", tone === "red" && "bg-rose-50 text-rose-600", tone === "amber" && "bg-amber-50 text-amber-700", tone === "green" && "bg-emerald-50 text-emerald-700", tone === "blue" && "bg-sky-50 text-sky-700")}>{children}</div>
);
export function Segmented<T extends string>({ value, options, onChange, className }: { value: T; options: readonly T[]; onChange: (v: T) => void; className?: string }) {
  return (
    <div className={cx("flex flex-wrap gap-1.5", className)} role="radiogroup">
      {options.map((o) => (
        <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)} className={cx("h-9 rounded-lg border px-3.5 text-[13px] font-bold transition", value === o ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-brand-soft")}>{o}</button>
      ))}
    </div>
  );
}
export function Steps({ steps, step }: { steps: string[]; step: number }) {
  return (
    <ol className="mb-5 flex items-center gap-2 text-xs font-bold">
      {steps.map((s, i) => (
        <li key={s} className="flex flex-1 items-center gap-2">
          <span className={cx("grid size-6 shrink-0 place-items-center rounded-full", i < step ? "bg-emerald-500 text-white" : i === step ? "bg-brand text-white" : "bg-slate-200 text-sub")}>{i < step ? "✓" : i + 1}</span>
          <span className={cx("truncate", i === step ? "text-ink" : "text-sub")}>{s}</span>
          {i < steps.length - 1 && <span className="h-px flex-1 bg-line" />}
        </li>
      ))}
    </ol>
  );
}
export const orderOpt = (o: Order): ComboOption => ({ value: o.id, label: `${o.id} · ${o.customer}`, sub: o.total - o.paid > 0 ? `Bal ${inr(o.total - o.paid)}` : "Paid" });
export const strOpts = (xs: readonly string[]): ComboOption[] => xs.map((x) => ({ value: x, label: x }));

/** Fixed-position menu hanging off a status pill / any trigger. */
export function StatusMenu<T extends string>({ trigger, options, onPick, label = "Change status" }: { trigger: ReactNode; options: { value: T; label?: string; disabled?: boolean; hint?: string }[]; onPick: (v: T) => void; label?: string }) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  return (
    <>
      <button type="button" aria-label={label} onClick={(e) => {
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        const h = options.length * 34 + 12;
        setPos(pos ? null : { top: r.bottom + h > window.innerHeight ? Math.max(8, r.top - h - 4) : r.bottom + 4, left: Math.max(8, Math.min(r.left, window.innerWidth - 208)) });
      }} className="inline-flex items-center gap-1 rounded-full hover:ring-2 hover:ring-brand/30">{trigger}</button>
      {pos && (
        <div className="fixed inset-0 z-[65]" onClick={(e) => { e.stopPropagation(); setPos(null); }}>
          <div role="menu" className="fixed w-52 rounded-xl border border-line bg-white p-1.5 shadow-xl" style={pos} onClick={(e) => e.stopPropagation()}>
            {options.map((o) => (
              <button key={o.value} role="menuitem" disabled={o.disabled} onClick={() => { setPos(null); onPick(o.value); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-left text-[13px] font-semibold hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-40">
                {o.label ?? o.value}{o.hint && <span className="text-[10px] font-medium text-sub">{o.hint}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/* ───────── photo / file upload with previews ───────── */
export interface Photo { id: string; url: string; name: string }
export function PhotoUploader({ photos, onChange, label = "Add photo", size = 64, multiple = true, ariaLabel = "Upload photos" }: { photos: Photo[]; onChange: (p: Photo[]) => void; label?: string; size?: number; multiple?: boolean; ariaLabel?: string }) {
  const inp = useRef<HTMLInputElement>(null);
  const add = (files: FileList | null) => {
    if (!files) return;
    const next = [...files].filter((f) => f.type.startsWith("image/")).map((f) => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, url: URL.createObjectURL(f), name: f.name }));
    onChange(multiple ? [...photos, ...next] : next.slice(0, 1));
    if (inp.current) inp.current.value = "";
  };
  return (
    <div className="flex flex-wrap gap-2">
      {photos.map((p) => (
        <div key={p.id} className="relative" data-testid="photo-thumb">
          {p.url ? <img src={p.url} alt={p.name} style={{ width: size, height: size }} className="rounded-lg border border-line object-cover" /> : <div style={{ width: size, height: size }} className="grid place-items-center rounded-lg bg-gradient-to-br from-amber-200 to-rose-300 text-[9px] font-bold text-white/90">{p.name.slice(0, 8)}</div>}
          <button type="button" aria-label={`Remove ${p.name}`} onClick={() => { if (p.url.startsWith("blob:")) URL.revokeObjectURL(p.url); onChange(photos.filter((x) => x.id !== p.id)); }} className="absolute -right-1 -top-1 grid size-4 place-items-center rounded-full bg-ink text-white"><X className="size-3" /></button>
        </div>
      ))}
      <button type="button" onClick={() => inp.current?.click()} style={{ width: size, height: size }} className="grid place-items-center rounded-lg border-2 border-dashed border-brand/40 text-[10px] font-semibold text-brand hover:bg-brand-soft"><span><ImagePlus className="mx-auto size-4" />{label}</span></button>
      <input ref={inp} type="file" accept="image/*" multiple={multiple} aria-label={ariaLabel} className="sr-only" onChange={(e) => add(e.target.files)} />
    </div>
  );
}

/** Wrap printable content: during window.print() only #print-area is visible. */
export function PrintStyle() {
  return <style>{`@media print{body *{visibility:hidden!important}#print-area,#print-area *{visibility:visible!important}#print-area{position:fixed!important;inset:0;background:#fff;padding:32px;overflow:visible!important}}`}</style>;
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="rounded border border-line bg-slate-50 px-1.5 text-[10px] font-bold text-sub">{children}</kbd>;
}

/** Shared toolbar chrome for filtered tables. */
export function useTableView(defaultSort: { key: string; dir: 1 | -1 } | null = null) {
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(defaultSort);
  const [hidden, setHidden] = useState<string[]>([]);
  return { sort, setSort, hidden, setHidden, show: (k: string) => !hidden.includes(k) };
}

/** Same look as <Field> but a div, so label-click forwarding never toggles inner buttons/popovers. */
export function FieldBox({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: string }) {
  return (
    <div className="mb-4 block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-sub">{hint}</span>}
    </div>
  );
}
