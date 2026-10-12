import { useMemo, useState } from "react";
import { Layers, Minus, Plus, Trash2 } from "lucide-react";
import { cx } from "./ui";
import type { CostLine } from "../lib/data";
import { inr } from "../lib/format";

export const FRONT = "Front cover", INSIDE = "Inside pages", BACK = "Back cover";
const DEFAULT_SECTIONS = [FRONT, INSIDE, BACK];
const CUSTOM_COLORS = ["#f59e0b", "#0ea5e9", "#ec4899", "#14b8a6", "#f97316"];
const colorOf = (section: string, customIndex: number) => (section === FRONT ? "#3f4fe0" : section === INSIDE ? "#10b981" : section === BACK ? "#8b5cf6" : CUSTOM_COLORS[customIndex % CUSTOM_COLORS.length]!);
const UNASSIGNED = "#cbd5e1";
/** Where the catalog picker starts for each kind of section. */
export const startPathFor = (section: string) => (section === FRONT || section === BACK ? ["COVER"] : section === INSIDE ? ["PAPER"] : []);

/** The album as a stack of sheets: one leaf per sheet, coloured by section, animating as the plan changes. */
export function AlbumVisual({ total, parts }: { total: number; parts: { label: string; color: string; count: number; cover?: boolean }[] }) {
  const assigned = parts.reduce((a, p) => a + p.count, 0);
  const shown = Math.min(Math.max(total, assigned), 80), per = Math.max(total, assigned) / shown;       // up to 80 leaves; each stands for several sheets on big albums
  const leaves = useMemo(() => {
    const seq: { color: string; cover: boolean; label: string }[] = [];
    const expand = (p: (typeof parts)[number]) => Array.from({ length: Math.round(p.count / per) }, () => ({ color: p.color, cover: !!p.cover, label: p.label }));
    const front = parts.filter((p) => p.cover && p.label === FRONT), back = parts.filter((p) => p.cover && p.label === BACK), mid = parts.filter((p) => !p.cover);
    front.forEach((p) => seq.push(...expand(p)));
    mid.forEach((p) => seq.push(...expand(p)));
    const gap = Math.max(0, Math.round((total - assigned) / per));
    for (let i = 0; i < gap; i++) seq.push({ color: UNASSIGNED, cover: false, label: "Not assigned yet" });
    back.forEach((p) => seq.push(...expand(p)));
    return seq;
  }, [parts, total, assigned, per]);
  const over = assigned > total;
  return (
    <div data-testid="album-visual">
      <div className="album-stack mb-3 grid place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-slate-50 to-brand-soft px-4 pb-4 pt-6" aria-hidden>
        <div className="album-stack-inner flex items-end gap-[2px]" style={{ height: 150 }}>
          {leaves.map((l, i) => (
            <span key={`${i}-${l.color}`} title={l.label} className="leaf rounded-[2px] shadow-sm" style={{ width: l.cover ? 10 : 5, height: l.cover ? 140 : l.color === UNASSIGNED ? 104 : 120, background: l.color === UNASSIGNED ? `repeating-linear-gradient(135deg, ${UNASSIGNED}, ${UNASSIGNED} 3px, #e2e8f0 3px, #e2e8f0 6px)` : l.color, animationDelay: `${Math.min(i, 60) * 9}ms` }} />
          ))}
        </div>
      </div>
      <div className="flex h-3 overflow-hidden rounded-full bg-slate-100" role="img" aria-label={`${assigned} of ${total} sheets assigned`}>
        {parts.filter((p) => p.count > 0).map((p) => <span key={p.label} className="transition-[width] duration-500 ease-out" style={{ width: `${(p.count / Math.max(total, assigned, 1)) * 100}%`, background: p.color }} title={`${p.label}: ${p.count}`} />)}
      </div>
      <p className={cx("mt-1.5 text-xs font-semibold", over ? "text-rose-600" : assigned === total ? "text-emerald-700" : "text-amber-700")}>
        {over ? `${assigned - total} sheet${assigned - total === 1 ? "" : "s"} more than the album has` : assigned === total ? "Every sheet is assigned" : `${total - assigned} sheet${total - assigned === 1 ? "" : "s"} still to assign`}
      </p>
    </div>
  );
}

const stepBtn = "grid size-8 place-items-center rounded-lg border border-line bg-white text-sub hover:bg-brand-soft disabled:opacity-40";
const numCls = "h-8 w-16 rounded-lg border border-line bg-white px-2 text-center text-[13px] font-bold outline-none focus:border-brand disabled:bg-slate-50";
const cell = "h-9 rounded-lg border border-line bg-white px-2 text-[13px] outline-none focus:border-brand disabled:bg-slate-50";
const COVER_RE = /^(MINI BOOK )?COVER\b/i;

export interface ItemsProps {
  pos: number; totalSheets: number; lines: CostLine[]; categories: string[]; editable: boolean; admin: boolean;
  onSheets: (n: number) => void;
  onCategory: (category: string) => void;
  onAddCustom: (name: string, qty: number, sell: number, cost?: number) => void;
  onChange: (id: string, patch: Partial<CostLine>) => void; onRemove: (id: string) => void;
}

/** An album's costing: the sheet stack on the left; on the right the admin clicks a category, picks the item, and the priced items table is right there. */
export default function AlbumItems(p: ItemsProps) {
  const [sheetsText, setSheetsText] = useState<string | null>(null);
  const [cust, setCust] = useState({ name: "", qty: "1", sell: "", cost: "" });
  const [msg, setMsg] = useState("");
  const sheetLines = p.lines.filter((l) => l.countsSheets);
  const covers = sheetLines.filter((l) => COVER_RE.test(l.name.trim()));
  const parts = [
    { label: FRONT, color: colorOf(FRONT, 0), count: covers[0]?.qty ?? 0, cover: true },
    { label: INSIDE, color: colorOf(INSIDE, 0), count: sheetLines.filter((l) => !COVER_RE.test(l.name.trim())).reduce((a, l) => a + l.qty, 0) },
    { label: BACK, color: colorOf(BACK, 0), count: covers.slice(1).reduce((a, l) => a + l.qty, 0), cover: true },
  ];
  const commitSheets = (v: number) => { setSheetsText(null); if (Number.isFinite(v) && v !== p.totalSheets) p.onSheets(Math.round(v)); };
  const total = p.lines.reduce((a, l) => a + l.qty * l.sell, 0);
  const addCustom = () => {
    const qty = Number(cust.qty), sell = Number(cust.sell);
    if (cust.name.trim().length < 2) { setMsg("Enter the item name"); return; }
    if (!(qty > 0) || cust.sell === "" || !(sell >= 0)) { setMsg("Enter a quantity above 0 and a selling price"); return; }
    p.onAddCustom(cust.name.trim(), qty, sell, cust.cost === "" ? undefined : Number(cust.cost));
    setCust({ name: "", qty: "1", sell: "", cost: "" }); setMsg("");
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,260px)_minmax(0,1fr)]" data-testid={`planner-${p.pos}`}>
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Layers className="size-4 text-brand" aria-hidden />
          <span className="text-xs font-bold text-sub">Total sheets</span>
          <div className="ml-auto flex items-center gap-1">
            <button className={stepBtn} aria-label="Fewer sheets" disabled={!p.editable || p.totalSheets <= 1} onClick={() => commitSheets(p.totalSheets - 1)}><Minus className="size-4" /></button>
            <input aria-label="Total sheets" type="number" min={1} className={numCls} disabled={!p.editable} value={sheetsText ?? p.totalSheets} onChange={(e) => setSheetsText(e.target.value)} onBlur={() => sheetsText !== null && commitSheets(Number(sheetsText))} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            <button className={stepBtn} aria-label="More sheets" disabled={!p.editable} onClick={() => commitSheets(p.totalSheets + 1)}><Plus className="size-4" /></button>
          </div>
        </div>
        <AlbumVisual total={p.totalSheets} parts={parts} />
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-sub">{parts.map((x) => <span key={x.label} className="inline-flex items-center gap-1.5"><i className="size-2.5 rounded-sm" style={{ background: x.color }} />{x.label} {x.count}</span>)}</div>
      </div>

      <div className="min-w-0">
        {p.editable && (
          <>
            <label className="mb-3 block max-w-xs text-xs font-bold">Category
              <select aria-label="Category" className={cx(cell, "mt-1 w-full")} value="" onChange={(e) => e.target.value && p.onCategory(e.target.value)}>
                <option value="">Select category…</option>{p.categories.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <div className="mb-3 rounded-xl border border-line bg-slate-50 p-3">
              <div className="mb-1 text-[13px] font-extrabold text-brand">Add custom item</div>
              <div className="grid items-end gap-2 sm:grid-cols-[1fr_80px_110px_110px_auto]">
                <label className="text-[11px] font-bold">Item Name<input aria-label="Item Name" className={cx(cell, "mt-1 w-full")} value={cust.name} onChange={(e) => setCust({ ...cust, name: e.target.value })} placeholder="Enter item name manually" /></label>
                <label className="text-[11px] font-bold">Qty<input type="number" min={1} aria-label="Custom Qty" className={cx(cell, "mt-1 w-full")} value={cust.qty} onChange={(e) => setCust({ ...cust, qty: e.target.value })} /></label>
                <label className="text-[11px] font-bold">Selling Price<input type="number" min={0} aria-label="Custom Selling Price" className={cx(cell, "mt-1 w-full")} value={cust.sell} onChange={(e) => setCust({ ...cust, sell: e.target.value })} /></label>
                <label className="text-[11px] font-bold">Purchase Price<input type="number" min={0} aria-label="Custom Purchase Price" className={cx(cell, "mt-1 w-full")} value={cust.cost} onChange={(e) => setCust({ ...cust, cost: e.target.value })} /></label>
                <button onClick={addCustom} className="h-9 rounded-lg bg-brand px-4 text-[13px] font-bold text-white hover:bg-brand-dark">Add Item</button>
              </div>
              {msg && <p role="alert" className="mt-1 text-xs font-semibold text-rose-600">{msg}</p>}
            </div>
          </>
        )}
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[600px] text-[13px]">
            <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-sub"><tr>
              <th className="px-3 py-2 text-left">Item name</th><th className="px-2 py-2 text-left">Qty</th><th className="px-2 py-2 text-left">Remarks</th><th className="px-2 py-2 text-left">Dimension</th>
              <th className="px-2 py-2 text-left">Selling price</th>{p.admin && <th className="px-2 py-2 text-left">Purchase price</th>}<th className="px-3 py-2 text-right">Total</th><th /></tr></thead>
            <tbody>
              {p.lines.map((l) => (
                <tr key={l.id} className="border-t border-line">
                  <td className="px-3 py-1.5"><input aria-label="Item name" className={cx(cell, "w-full min-w-40")} value={l.name} disabled={!p.editable} onChange={(e) => p.onChange(l.id, { name: e.target.value })} />
                    <label className="mt-1 flex items-center gap-1.5 text-[11px] text-sub"><input type="checkbox" disabled={!p.editable} checked={l.countsSheets} onChange={(e) => p.onChange(l.id, { countsSheets: e.target.checked })} />counts toward the album&apos;s sheets</label></td>
                  <td className="px-2 py-1.5"><input type="number" min={1} aria-label={`Quantity of ${l.name || "item"}`} className={cx(cell, "w-16")} value={l.qty} disabled={!p.editable} onChange={(e) => p.onChange(l.id, { qty: Number(e.target.value) })} /></td>
                  <td className="px-2 py-1.5"><input aria-label="Remarks" className={cx(cell, "w-24")} value={l.remarks ?? ""} disabled={!p.editable} onChange={(e) => p.onChange(l.id, { remarks: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><input aria-label="Dimension" className={cx(cell, "w-24")} value={l.dimension ?? ""} disabled={!p.editable} onChange={(e) => p.onChange(l.id, { dimension: e.target.value })} /></td>
                  <td className="px-2 py-1.5"><input type="number" min={0} aria-label={`Selling price of ${l.name || "item"}`} className={cx(cell, "w-20")} value={l.sell} disabled={!p.editable} onChange={(e) => p.onChange(l.id, { sell: Number(e.target.value) })} /></td>
                  {p.admin && <td className="px-2 py-1.5"><input type="number" min={0} aria-label={`Purchase price of ${l.name || "item"}`} className={cx(cell, "w-20")} value={l.cost ?? ""} disabled={!p.editable} onChange={(e) => p.onChange(l.id, { cost: e.target.value === "" ? undefined : Number(e.target.value) })} /></td>}
                  <td className="px-3 py-1.5 text-right font-bold">{inr(l.qty * l.sell)}</td>
                  <td className="px-2 py-1.5">{p.editable && <button aria-label={`Remove ${l.name || "item"}`} onClick={() => p.onRemove(l.id)} className="grid size-8 place-items-center rounded-lg bg-rose-500 text-white hover:bg-rose-600"><Trash2 className="size-4" /></button>}</td>
                </tr>
              ))}
              {!p.lines.length && <tr><td colSpan={p.admin ? 8 : 7} className="px-3 py-6 text-center text-sm text-sub">{p.editable ? "No items yet. Select a category above, pick the item and quantity, and it is priced here." : "No items."}</td></tr>}
            </tbody>
            <tfoot><tr className="border-t border-line bg-slate-50"><td colSpan={p.admin ? 6 : 5} className="px-3 py-2 text-right text-xs font-bold text-sub">Album total (before design, discount and GST)</td><td className="px-3 py-2 text-right font-extrabold">{inr(total)}</td><td /></tr></tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}
