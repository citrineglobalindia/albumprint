import { useState, type ReactNode, type ComponentType } from "react";
import { useToast } from "./Toast";
import { ChevronLeft, ChevronRight, ChevronDown, Search, ArrowUp, ArrowDown, ImageIcon, CalendarDays, Plus } from "lucide-react";
import clsx from "clsx";
import { useNavigate } from "react-router-dom";
import { initials, TODAY } from "../lib/format";
import type { Priority, Tone, PayStatus } from "../lib/data";

export const cx = clsx;

/** Tone → tailwind classes. Static strings so Tailwind can see them. */
export const TONE: Record<Tone, { soft: string; text: string; solid: string; dot: string; border: string }> = {
  blue: { soft: "bg-sky-50", text: "text-sky-700", solid: "bg-sky-500", dot: "bg-sky-500", border: "border-sky-200" },
  orange: { soft: "bg-orange-50", text: "text-orange-600", solid: "bg-orange-500", dot: "bg-orange-500", border: "border-orange-200" },
  pink: { soft: "bg-pink-50", text: "text-pink-600", solid: "bg-pink-500", dot: "bg-pink-500", border: "border-pink-200" },
  violet: { soft: "bg-violet-50", text: "text-violet-700", solid: "bg-violet-500", dot: "bg-violet-500", border: "border-violet-200" },
  green: { soft: "bg-emerald-50", text: "text-emerald-700", solid: "bg-emerald-500", dot: "bg-emerald-500", border: "border-emerald-200" },
  teal: { soft: "bg-teal-50", text: "text-teal-700", solid: "bg-teal-500", dot: "bg-teal-500", border: "border-teal-200" },
  amber: { soft: "bg-amber-50", text: "text-amber-700", solid: "bg-amber-500", dot: "bg-amber-500", border: "border-amber-200" },
  red: { soft: "bg-rose-50", text: "text-rose-600", solid: "bg-rose-500", dot: "bg-rose-500", border: "border-rose-200" },
  slate: { soft: "bg-slate-100", text: "text-slate-600", solid: "bg-slate-500", dot: "bg-slate-400", border: "border-slate-200" },
  indigo: { soft: "bg-indigo-50", text: "text-indigo-700", solid: "bg-indigo-500", dot: "bg-indigo-500", border: "border-indigo-200" },
};

export function PageHeader({ title, subtitle, icon, children }: { title: string; subtitle?: string; icon?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3">
        {icon}
        <div>
          <h1 className="text-[28px] font-extrabold leading-tight tracking-tight text-ink">{title}</h1>
          {subtitle && <p className="mt-0.5 text-sm text-sub">{subtitle}</p>}
        </div>
      </div>
      <div className="flex items-center gap-3">{children}</div>
    </div>
  );
}

export function PrimaryButton({ children, icon: Icon = Plus, onClick }: { children: ReactNode; icon?: ComponentType<{ className?: string }>; onClick?: () => void }) {
  return (
    <button onClick={onClick} className="inline-flex h-11 items-center gap-2 rounded-xl bg-brand px-5 text-sm font-bold text-white shadow-md shadow-brand/25 transition hover:bg-brand-dark active:scale-[0.98]">
      <Icon className="size-4" />
      {children}
    </button>
  );
}

export function OutlineButton({ children, icon: Icon, onClick, className }: { children: ReactNode; icon?: ComponentType<{ className?: string }>; onClick?: () => void; className?: string }) {
  return (
    <button onClick={onClick} className={cx("inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-[13px] font-semibold text-ink transition hover:bg-brand-soft", className)}>
      {Icon && <Icon className="size-4 text-sub" />}
      {children}
    </button>
  );
}

export { TodayChip } from "./controls";

/** Page-level "More" menu: print, refresh, and CSV export of every table on the page. */
export function MoreButton() {
  const [open, setOpen] = useState(false);
  const [toast, show] = useToast();
  const exportTables = () => {
    const rows: string[][] = [];
    document.querySelectorAll("main table").forEach((t) => {
      t.querySelectorAll("tr").forEach((tr) => rows.push([...tr.querySelectorAll("th,td")].map((c) => (c.textContent ?? "").trim())));
      rows.push([]);
    });
    if (!rows.length) { show("No tables on this page to export"); return; }
    const csv = rows.map((r) => r.map((v) => `"${v.replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `${(document.querySelector("main h1")?.textContent ?? "export").trim().toLowerCase().replace(/\W+/g, "-")}.csv`;
    a.click();
    show("Exported tables to CSV");
  };
  const items: [string, () => void][] = [["Export tables (CSV)", exportTables], ["Print page", () => window.print()], ["Refresh data", () => show("Data refreshed")]];
  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} onBlur={() => setTimeout(() => setOpen(false), 150)} className="inline-flex h-11 items-center gap-2 rounded-xl border border-line bg-white px-4 text-sm font-bold text-ink hover:bg-brand-soft">
        More <ChevronDown className="size-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-48 rounded-xl border border-line bg-white p-1.5 shadow-xl">
          {items.map(([l, f]) => <button key={l} onMouseDown={f} className="block w-full rounded-lg px-3 py-2 text-left text-[13px] font-semibold hover:bg-brand-soft">{l}</button>)}
        </div>
      )}
      {toast}
    </div>
  );
}

export function Panel({ title, subtitle, action, children, className, bodyClassName }: { title?: ReactNode; subtitle?: ReactNode; action?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string }) {
  return (
    <section className={cx("rounded-2xl border border-line bg-white shadow-[0_1px_2px_rgba(20,30,90,0.04)]", className)}>
      {(title || action) && (
        <header className="flex items-center justify-between gap-3 px-5 pt-4">
          <div className="flex min-w-0 items-baseline gap-3">
            {title && <h2 className="text-[17px] font-extrabold text-ink">{title}</h2>}
            {subtitle && <p className="truncate text-xs text-sub">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      <div className={cx("p-5", bodyClassName)}>{children}</div>
    </section>
  );
}

export function LinkAction({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return <button onClick={onClick} className="text-xs font-bold text-brand hover:underline">{children}</button>;
}

export interface Kpi { label: string; value: string | number; delta?: number; deltaLabel?: string; icon: ComponentType<{ className?: string }>; tone: Tone; invert?: boolean }

/** KPI tile. `invert` = a rise is bad (overdue, dues): arrows colour red when up. */
export function KpiCard({ k }: { k: Kpi }) {
  const t = TONE[k.tone];
  const up = (k.delta ?? 0) >= 0;
  const good = k.invert ? !up : up;
  return (
    <div className="flex min-w-0 items-center gap-3.5 rounded-2xl border border-line bg-white p-4 shadow-[0_1px_2px_rgba(20,30,90,0.04)]">
      <div className={cx("grid size-14 shrink-0 place-items-center rounded-xl", t.soft, t.text)}>
        <k.icon className="size-7" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-[13px] font-medium text-sub">{k.label}</div>
        <div className="text-2xl font-extrabold leading-tight text-ink">{k.value}</div>
        {k.delta !== undefined && (
          <div className={cx("flex flex-wrap items-center gap-x-1 text-xs font-bold", good ? "text-emerald-600" : "text-rose-600")}>
            {up ? <ArrowUp className="size-3" /> : <ArrowDown className="size-3" />}
            {Math.abs(k.delta)}%
            <span className="whitespace-nowrap text-[11px] font-medium text-sub">{k.deltaLabel ?? "vs last month"}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export function KpiRow({ items, className, cols }: { items: Kpi[]; className?: string; cols?: number }) {
  return (
    <div className={cx("mb-5 grid gap-4", className)} style={{ gridTemplateColumns: cols ? `repeat(${cols}, minmax(0, 1fr))` : `repeat(auto-fit, minmax(205px, 1fr))` }}>
      {items.map((k) => <KpiCard key={k.label} k={k} />)}
    </div>
  );
}

export function Pill({ children, tone = "slate", dot, icon: Icon, className }: { children: ReactNode; tone?: Tone; dot?: boolean; icon?: ComponentType<{ className?: string }>; className?: string }) {
  const t = TONE[tone];
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold", t.soft, t.text, className)}>
      {dot && <span className={cx("size-1.5 rounded-full", t.dot)} />}
      {Icon && <Icon className="size-3.5" />}
      {children}
    </span>
  );
}

const PRIORITY_TONE: Record<Priority, Tone> = { Low: "blue", Normal: "green", High: "red", Urgent: "red", VIP: "amber" };
export const PriorityPill = ({ p }: { p: Priority }) => <Pill tone={PRIORITY_TONE[p]}>{p}</Pill>;

const PAY_TONE: Record<PayStatus, Tone> = { Paid: "green", Partial: "amber", Unpaid: "red", Overdue: "red" };
export const PayPill = ({ s }: { s: PayStatus }) => <Pill tone={PAY_TONE[s]}>{s === "Partial" ? "Partial" : s}</Pill>;

const AVATAR_BG = ["bg-indigo-500", "bg-violet-500", "bg-sky-500", "bg-emerald-500", "bg-pink-500", "bg-amber-500", "bg-teal-500", "bg-rose-500"];
export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const h = [...name].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span className={cx("inline-grid shrink-0 place-items-center rounded-full font-bold text-white", AVATAR_BG[h % AVATAR_BG.length])} style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {initials(name)}
    </span>
  );
}

const THUMB_BG = ["from-amber-200 to-rose-300", "from-sky-200 to-indigo-300", "from-emerald-200 to-teal-300", "from-pink-200 to-orange-300", "from-violet-200 to-fuchsia-300", "from-stone-300 to-amber-200"];
/** Placeholder for customer/album photos until real file storage is wired. */
export function Thumb({ seed = 0, size = 36, rounded = "rounded-lg", className }: { seed?: number | string; size?: number; rounded?: string; className?: string }) {
  const h = typeof seed === "number" ? seed : [...seed].reduce((a, c) => a + c.charCodeAt(0), 0);
  return (
    <span className={cx("inline-grid shrink-0 place-items-center bg-gradient-to-br text-white/80", THUMB_BG[h % THUMB_BG.length], rounded, className)} style={{ width: size, height: size }}>
      <ImageIcon style={{ width: size * 0.4, height: size * 0.4 }} />
    </span>
  );
}

export function SearchInput({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <label className={cx("flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm focus-within:border-brand", className)}>
      <Search className="size-4 text-sub" />
      <input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="w-full min-w-0 bg-transparent outline-none placeholder:text-slate-400" />
    </label>
  );
}

export function FilterSelect({ value, onChange, options, className }: { value: string; onChange: (v: string) => void; options: string[]; className?: string }) {
  return (
    <div className={cx("relative", className)}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className="h-10 w-full appearance-none rounded-lg border border-line bg-white pl-3 pr-8 text-[13px] font-medium text-ink outline-none focus:border-brand">
        {options.map((o) => <option key={o}>{o}</option>)}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-sub" />
    </div>
  );
}

/** Pill-style tab bar with counts, as used on Orders / Customers / Delivery. */
export function CountTabs<T extends string>({ tabs, value, onChange }: { tabs: { key: T; label: string; count?: number; tone?: Tone }[]; value: T; onChange: (k: T) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {tabs.map((t) => {
        const active = t.key === value;
        return (
          <button key={t.key} onClick={() => onChange(t.key)} className={cx("inline-flex h-10 items-center gap-2 rounded-xl border px-4 text-[13px] font-bold transition", active ? "border-brand bg-brand text-white shadow-md shadow-brand/20" : "border-line bg-white text-ink hover:bg-brand-soft")}>
            {t.tone && <span className={cx("size-2 rounded-full", active ? "bg-white" : TONE[t.tone].dot)} />}
            {t.label}
            {t.count !== undefined && <span className={cx("rounded-full px-2 py-0.5 text-xs", active ? "bg-white/25" : "bg-slate-100 text-sub")}>{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Underline tabs used inside panels. */
export function LineTabs<T extends string>({ tabs, value, onChange, className }: { tabs: { key: T; label: string; count?: number }[]; value: T; onChange: (k: T) => void; className?: string }) {
  return (
    <div className={cx("flex gap-6 border-b border-line", className)}>
      {tabs.map((t) => (
        <button key={t.key} onClick={() => onChange(t.key)} className={cx("-mb-px border-b-2 pb-2.5 text-sm font-bold transition", t.key === value ? "border-brand text-brand" : "border-transparent text-sub hover:text-ink")}>
          {t.label}
          {t.count !== undefined && <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs text-sub">{t.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Pagination({ page, pageSize, total, onPage, onPageSize, noun = "items" }: { page: number; pageSize: number; total: number; onPage: (p: number) => void; onPageSize?: (n: number) => void; noun?: string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  const nums = Array.from({ length: pages }, (_, i) => i + 1).filter((n) => n === 1 || n === pages || Math.abs(n - page) <= 1);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 pt-4 text-[13px] text-sub">
      <span>Showing {from} to {to} of {total} {noun}</span>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-1.5">
          <button disabled={page <= 1} onClick={() => onPage(page - 1)} className="grid size-8 place-items-center rounded-lg border border-line bg-white disabled:opacity-40"><ChevronLeft className="size-4" /></button>
          {nums.map((n, i) => (
            <span key={n} className="flex items-center gap-1.5">
              {i > 0 && n - nums[i - 1]! > 1 && <span>…</span>}
              <button onClick={() => onPage(n)} className={cx("grid size-8 place-items-center rounded-lg border text-[13px] font-bold", n === page ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-brand-soft")}>{n}</button>
            </span>
          ))}
          <button disabled={page >= pages} onClick={() => onPage(page + 1)} className="grid size-8 place-items-center rounded-lg border border-line bg-white disabled:opacity-40"><ChevronRight className="size-4" /></button>
        </div>
        {onPageSize && (
          <div className="flex items-center gap-2">
            Rows per page
            <FilterSelect className="w-[76px]" value={String(pageSize)} onChange={(v) => onPageSize(Number(v))} options={["8", "10", "12", "14", "20"]} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Standard table styling. Use <Th>/<Td> inside a <table className={tableCls}>. */
export const tableCls = "w-full text-[13px]";
export const Th = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <th className={cx("whitespace-nowrap px-3 py-3 text-left text-[11px] font-bold uppercase tracking-wide text-sub", className)}>{children}</th>
);
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => (
  <td className={cx("whitespace-nowrap px-3 py-2.5 align-middle", className)}>{children}</td>
);
export const trCls = "border-t border-line hover:bg-brand-soft/50";

export function RowViewButton({ onClick, to }: { onClick?: () => void; to?: string }) {
  const nav = useNavigate();
  return <button onClick={to ? () => nav(to) : onClick} className="h-8 rounded-lg border border-line bg-white px-4 text-xs font-bold text-ink hover:bg-brand-soft">View</button>;
}

export function ProgressBar({ value, tone = "blue", className }: { value: number; tone?: Tone; className?: string }) {
  return (
    <div className={cx("h-1.5 w-full overflow-hidden rounded-full bg-slate-100", className)}>
      <div className={cx("h-full rounded-full", TONE[tone].solid)} style={{ width: `${value}%` }} />
    </div>
  );
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button role="switch" aria-checked={on} onClick={() => onChange(!on)} className={cx("relative h-6 w-11 shrink-0 rounded-full transition", on ? "bg-brand" : "bg-slate-200")}>
      <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", on ? "left-[22px]" : "left-0.5")} />
    </button>
  );
}

/** Right-side slide-over used for create/record forms (New Order, Record Payment…). */
export function SlideOver({ open, onClose, title, children, footer, width = 440 }: { open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; width?: number }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-ink/30" onClick={onClose}>
      <aside className="flex h-full max-w-full flex-col bg-white shadow-2xl" style={{ width }} onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button onClick={onClose} className="grid size-8 place-items-center rounded-lg text-sub hover:bg-slate-100" aria-label="Close">✕</button>
        </header>
        <div className="scroll-thin flex-1 overflow-y-auto p-6">{children}</div>
        {footer && <footer className="flex justify-end gap-3 border-t border-line px-6 py-4">{footer}</footer>}
      </aside>
    </div>
  );
}

export function Field({ label, required, children, hint }: { label: string; required?: boolean; children: ReactNode; hint?: string }) {
  return (
    <label className="mb-4 block">
      <span className="mb-1.5 block text-[13px] font-semibold text-ink">{label}{required && <span className="text-rose-500"> *</span>}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-sub">{hint}</span>}
    </label>
  );
}
export const inputCls = "h-10 w-full rounded-lg border border-line bg-white px-3 text-sm outline-none focus:border-brand";
