import { useState, type ReactNode } from "react";
import { Download, X } from "lucide-react";
import { cx } from "./ui";
import type { Out } from "../lib/production";

/** Checkbox row selection for list pages. */
export function useSelection() {
  const [ids, setIds] = useState<string[]>([]);
  return {
    ids,
    has: (id: string) => ids.includes(id),
    toggle: (id: string) => setIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id])),
    toggleAll: (rows: string[]) => setIds((s) => (rows.length > 0 && rows.every((r) => s.includes(r)) ? s.filter((x) => !rows.includes(x)) : [...new Set([...s, ...rows])])),
    clear: () => setIds([]),
    /** Selection limited to rows that are still in the filtered list. */
    within: (rows: string[]) => ids.filter((i) => rows.includes(i)),
  };
}

export function SelectTh({ rows, sel }: { rows: string[]; sel: ReturnType<typeof useSelection> }) {
  const n = rows.filter((r) => sel.has(r)).length;
  return (
    <th scope="col" className="w-10 px-3 py-3">
      <input type="checkbox" aria-label="Select all rows on this page" checked={rows.length > 0 && n === rows.length} ref={(el) => { if (el) el.indeterminate = n > 0 && n < rows.length; }} onChange={() => sel.toggleAll(rows)} />
    </th>
  );
}
export function SelectTd({ id, sel }: { id: string; sel: ReturnType<typeof useSelection> }) {
  return (
    <td className="w-10 px-3 py-2.5" onClick={(e) => e.stopPropagation()}>
      <input type="checkbox" aria-label={`Select ${id}`} checked={sel.has(id)} onChange={() => sel.toggle(id)} />
    </td>
  );
}

/** Sticky-ish bar shown above a table while rows are selected. Actions go in children. */
export function BulkBar({ count, onClear, children }: { count: number; onClear: () => void; children?: ReactNode }) {
  if (!count) return null;
  return (
    <div role="region" aria-label="Bulk actions" data-testid="bulk-bar" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-brand/30 bg-brand-soft px-3 py-2 text-[13px]">
      <b className="text-brand">{count} selected</b>
      <span className="flex flex-wrap items-center gap-2">{children}</span>
      <button onClick={onClear} className="ml-auto inline-flex items-center gap-1 text-xs font-bold text-sub hover:text-ink"><X className="size-3.5" />Clear selection</button>
    </div>
  );
}
export function BulkBtn({ children, onClick, tone = "default", testid }: { children: ReactNode; onClick: () => void; tone?: "default" | "primary" | "danger"; testid?: string }) {
  return <button data-testid={testid} onClick={onClick} className={cx("inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-bold", tone === "primary" ? "border-brand bg-brand text-white hover:bg-brand-dark" : tone === "danger" ? "border-rose-300 bg-white text-rose-600 hover:bg-rose-50" : "border-line bg-white hover:bg-slate-50")}>{children}</button>;
}

/** Run the SAME engine function used by the single-row action for each id; surfaces the first engine error in the toast. */
export function runBulk(ids: string[], fn: (id: string) => Out, show: (m: string) => void, verb: string) {
  const fails: string[] = []; let n = 0;
  ids.forEach((id) => { const r = fn(id); if (r.ok) n++; else fails.push(`${id}: ${r.msg}`); });
  show(fails.length ? `${verb} ${n} of ${ids.length}. ${fails[0]}${fails.length > 1 ? ` (+${fails.length - 1} more failed)` : ""}` : `${verb} ${n} of ${ids.length}`);
  return n;
}

export function ExportBtn({ onClick, label = "Export", aria }: { onClick: () => void; label?: string; aria?: string }) {
  return <button aria-label={aria ?? label} onClick={onClick} className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-[13px] font-semibold hover:bg-brand-soft"><Download className="size-4 text-sub" />{label}</button>;
}

/** Toolbar wrapper: left = filters, right = views/columns. */
export function Toolbar({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      {children}
      {right && <div className="ml-auto flex gap-2">{right}</div>}
    </div>
  );
}

export const rangeChip = (label: string, preset: string, text: string, clear: () => void) => (preset !== "All Time" ? [{ label: `${label}: ${preset === "Custom" ? text : preset}`, onRemove: clear }] : []);
