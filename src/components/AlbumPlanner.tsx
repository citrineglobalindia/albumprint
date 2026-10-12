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

export interface PlannerProps {
  pos: number; totalSheets: number; lines: CostLine[]; editable: boolean; admin: boolean;
  onSheets: (n: number) => void;
  onChange: (id: string, patch: Partial<CostLine>) => void; onRemove: (id: string) => void;
  onPick: (section: string, replaceId?: string) => void;
  extraSections: string[]; onAddSection: (name: string) => void;
}

/** Enter the album's sheet count, then give each part (front cover, inside pages, back cover…) a sheet type and a count: the amount follows. */
export default function AlbumPlanner(p: PlannerProps) {
  const [newSection, setNewSection] = useState("");
  const [adding, setAdding] = useState(false);
  const [sheetsText, setSheetsText] = useState<string | null>(null);
  const sheetLines = p.lines.filter((l) => l.section);
  const custom = [...new Set([...p.extraSections, ...sheetLines.map((l) => l.section!).filter((s) => !DEFAULT_SECTIONS.includes(s))])];
  const order = [FRONT, INSIDE, ...custom, BACK];
  const parts = order.map((label) => ({ label, color: colorOf(label, custom.indexOf(label)), count: sheetLines.filter((l) => l.section === label).reduce((a, l) => a + l.qty, 0), cover: label === FRONT || label === BACK }));
  const assigned = parts.reduce((a, x) => a + x.count, 0), remaining = p.totalSheets - assigned;
  const commitSheets = (v: number) => { setSheetsText(null); if (Number.isFinite(v) && v !== p.totalSheets) p.onSheets(Math.round(v)); };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,320px)_1fr]" data-testid={`planner-${p.pos}`}>
      <div>
        <div className="mb-3 flex items-center gap-2">
          <Layers className="size-4 text-brand" aria-hidden />
          <span className="text-xs font-bold text-sub">Total sheets in this album</span>
          <div className="ml-auto flex items-center gap-1">
            <button className={stepBtn} aria-label="Fewer sheets" disabled={!p.editable || p.totalSheets <= 1} onClick={() => commitSheets(p.totalSheets - 1)}><Minus className="size-4" /></button>
            <input aria-label="Total sheets" type="number" min={1} className={numCls} disabled={!p.editable} value={sheetsText ?? p.totalSheets} onChange={(e) => setSheetsText(e.target.value)} onBlur={() => sheetsText !== null && commitSheets(Number(sheetsText))} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            <button className={stepBtn} aria-label="More sheets" disabled={!p.editable} onClick={() => commitSheets(p.totalSheets + 1)}><Plus className="size-4" /></button>
          </div>
        </div>
        <AlbumVisual total={p.totalSheets} parts={parts} />
      </div>

      <div className="space-y-3">
        {order.map((label) => {
          const rows = sheetLines.filter((l) => l.section === label), color = colorOf(label, custom.indexOf(label)), count = rows.reduce((a, l) => a + l.qty, 0), amount = rows.reduce((a, l) => a + l.qty * l.sell, 0);
          return (
            <section key={label} aria-label={label} className="rounded-xl border border-line p-3" style={{ borderLeft: `4px solid ${color}` }}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h4 className="text-[13px] font-extrabold">{label}</h4>
                <span className="text-xs text-sub">{count} sheet{count === 1 ? "" : "s"}</span>
                {label === INSIDE && p.editable && remaining > 0 && rows.length > 0 && <button onClick={() => p.onChange(rows[rows.length - 1]!.id, { qty: rows[rows.length - 1]!.qty + remaining })} className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 hover:bg-emerald-100">Assign remaining {remaining}</button>}
                <span className="ml-auto text-[13px] font-bold">{inr(amount)}</span>
              </div>
              {rows.map((l) => (
                <div key={l.id} className="mb-2 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 px-2 py-1.5">
                  <button type="button" disabled={!p.editable} onClick={() => p.onPick(label, l.id)} className="min-w-40 flex-1 truncate rounded-lg border border-line bg-white px-2.5 py-1.5 text-left text-[13px] font-semibold hover:bg-brand-soft disabled:bg-white" aria-label={`Sheet type of ${l.name}`}>{l.name || "Choose sheet type"}</button>
                  <div className="flex items-center gap-1">
                    <button className={stepBtn} aria-label={`Fewer ${l.name} sheets`} disabled={!p.editable || l.qty <= 1} onClick={() => p.onChange(l.id, { qty: l.qty - 1 })}><Minus className="size-4" /></button>
                    <input type="number" min={1} aria-label={`Sheets of ${l.name}`} className={numCls} disabled={!p.editable} value={l.qty} onChange={(e) => p.onChange(l.id, { qty: Number(e.target.value) })} />
                    <button className={stepBtn} aria-label={`More ${l.name} sheets`} disabled={!p.editable} onClick={() => p.onChange(l.id, { qty: l.qty + 1 })}><Plus className="size-4" /></button>
                  </div>
                  <label className="flex items-center gap-1 text-[11px] text-sub">₹/sheet<input type="number" min={0} aria-label={`Rate of ${l.name}`} className={cx(numCls, "w-20")} disabled={!p.editable} value={l.sell} onChange={(e) => p.onChange(l.id, { sell: Number(e.target.value) })} /></label>
                  {p.admin && <label className="flex items-center gap-1 text-[11px] text-sub">cost<input type="number" min={0} aria-label={`Purchase price of ${l.name}`} className={cx(numCls, "w-20")} disabled={!p.editable} value={l.cost ?? ""} onChange={(e) => p.onChange(l.id, { cost: e.target.value === "" ? undefined : Number(e.target.value) })} /></label>}
                  <b className="ml-auto w-24 text-right text-[13px]">{inr(l.qty * l.sell)}</b>
                  {p.editable && <button aria-label={`Remove ${l.name}`} onClick={() => p.onRemove(l.id)} className="text-sub hover:text-rose-600"><Trash2 className="size-4" /></button>}
                </div>
              ))}
              {p.editable && <button onClick={() => p.onPick(label)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-dashed px-3 text-xs font-bold hover:bg-brand-soft" style={{ borderColor: color, color }}><Plus className="size-3.5" />{rows.length ? "Add another sheet type" : "Choose sheet type"}</button>}
              {!p.editable && !rows.length && <p className="text-xs text-sub">Not assigned.</p>}
            </section>
          );
        })}
        {p.editable && (adding ? (
          <div className="flex gap-2"><input aria-label="New section name" autoFocus className="h-9 flex-1 rounded-lg border border-line px-3 text-[13px]" placeholder="e.g. Insert pages" value={newSection} onChange={(e) => setNewSection(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && newSection.trim()) { p.onAddSection(newSection.trim()); setNewSection(""); setAdding(false); } }} />
            <button onClick={() => { if (newSection.trim()) { p.onAddSection(newSection.trim()); setNewSection(""); setAdding(false); } }} className="h-9 rounded-lg bg-brand px-3 text-xs font-bold text-white">Add section</button></div>
        ) : <button onClick={() => setAdding(true)} className="text-xs font-bold text-brand hover:underline">+ Add another section (insert pages, mini book…)</button>)}
      </div>
    </div>
  );
}
