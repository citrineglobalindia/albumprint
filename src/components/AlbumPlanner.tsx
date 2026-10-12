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

/** Rough look of a cover / paper from its catalog name, so the preview follows what was picked. */
const TONES: [RegExp, [string, string]][] = [
  [/white|ivory|cream/i, ["#f8fafc", "#cbd5e1"]], [/red|maroon/i, ["#b91c1c", "#7f1d1d"]], [/blue|navy/i, ["#1d4ed8", "#1e3a8a"]],
  [/green/i, ["#15803d", "#14532d"]], [/brown|leather|tan|wood/i, ["#92400e", "#5b2a0a"]], [/silver|grey|gray|metal/i, ["#94a3b8", "#475569"]],
  [/gold|golden/i, ["#d4a017", "#8a6508"]], [/black|dark/i, ["#1f2937", "#030712"]],
];
const toneOf = (name?: string): [string, string] => (name && TONES.find(([re]) => re.test(name))?.[1]) || ["#334155", "#0f172a"];

export interface Part { label: string; color: string; count: number; cover?: boolean; item?: string; amount?: number }

/** Live preview: the closed cover, the open inside spread and the sheet strip — all following the items picked. */
export function AlbumVisual({ total, parts, title }: { total: number; parts: Part[]; title?: string }) {
  const assigned = parts.reduce((a, p) => a + p.count, 0);
  const front = parts.find((p) => p.label === FRONT), inside = parts.find((p) => p.label === INSIDE);
  const [c1, c2] = toneOf(front?.item), light = /white|ivory|cream|silver|gold/i.test(front?.item ?? "");
  const [p1, p2] = toneOf(inside?.item);
  const edges = Math.max(2, Math.min(14, Math.round((inside?.count ?? 0) / Math.max(total, 1) * 14) || 2));
  const over = assigned > total;
  const leaves = useMemo(() => {
    const seq: { color: string; label: string }[] = [];
    [FRONT, INSIDE].forEach((k) => { const q = parts.find((x) => x.label === k); if (q) for (let i = 0; i < q.count; i++) seq.push({ color: q.color, label: q.label }); });
    for (let i = 0; i < Math.max(0, total - assigned); i++) seq.push({ color: UNASSIGNED, label: "Not assigned yet" });
    const b = parts.find((x) => x.label === BACK); if (b) for (let i = 0; i < b.count; i++) seq.push({ color: b.color, label: b.label });
    return seq.slice(0, 120);
  }, [parts, total, assigned]);
  const layout = /mini|single|full/i.test(inside?.item ?? "") ? 1 : /transparent|clear/i.test(inside?.item ?? "") ? 4 : 3;
  return (
    <div data-testid="album-visual">
      <Book3D title={title} front={front} inside={inside} back={parts.find((x) => x.label === BACK)} total={total} layout={layout} />
      <div className="mb-2 flex h-8 items-end justify-center gap-[2px] overflow-hidden" aria-hidden>
        {leaves.map((l, i) => <span key={`${i}-${l.color}`} title={l.label} className="leaf rounded-[2px]" style={{ width: 4, height: l.color === UNASSIGNED ? 20 : 30, background: l.color === UNASSIGNED ? "repeating-linear-gradient(135deg,#cbd5e1,#cbd5e1 2px,#e2e8f0 2px,#e2e8f0 4px)" : l.color, animationDelay: `${Math.min(i, 60) * 9}ms` }} />)}
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

/** A real 3D album: spine, page block, back cover and a front cover that swings open. Drag to turn it. */
function Book3D({ title, front, inside, back, total, layout }: { title?: string; front?: Part; inside?: Part; back?: Part; total: number; layout: number }) {
  const [rot, setRot] = useState(-28), [tilt, setTilt] = useState(-12), [open, setOpen] = useState(false), [drag, setDrag] = useState<{ x: number; y: number; r: number; t: number } | null>(null);
  const W = 176, H = 128, T = Math.max(14, Math.min(46, 10 + total * 0.9));
  const [c1, c2] = toneOf(front?.item), [b1, b2] = toneOf(back?.item ?? front?.item), light = /white|ivory|cream|silver|gold/i.test(front?.item ?? "");
  const [p1] = toneOf(inside?.item);
  const slabs = Math.max(3, Math.min(10, Math.round(total / 4)));
  const face = (x: number, y: number, w: number, h: number, t: string, bg: string, extra: React.CSSProperties = {}): React.CSSProperties => ({ position: "absolute", left: x, top: y, width: w, height: h, transform: t, background: bg, backfaceVisibility: "hidden", ...extra });
  const cover = (a: string, b: string) => `linear-gradient(135deg, ${a}, ${b})`;
  const onDown = (e: React.PointerEvent) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); setDrag({ x: e.clientX, y: e.clientY, r: rot, t: tilt }); };
  const onMove = (e: React.PointerEvent) => { if (drag) { setRot(drag.r + (e.clientX - drag.x) * 0.6); setTilt(Math.max(-60, Math.min(40, drag.t - (e.clientY - drag.y) * 0.4))); } };
  return (
    <div className="mb-3 rounded-2xl bg-gradient-to-br from-slate-50 to-brand-soft p-3" data-testid="album-3d">
      <div className="mb-1 flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-wide text-sub">3D preview · drag to turn</span>
        <button type="button" aria-label={open ? "Close album" : "Open album"} onClick={() => setOpen((v) => !v)} className="ml-auto rounded-lg border border-line bg-white px-2 py-0.5 text-[11px] font-bold text-brand hover:bg-brand-soft">{open ? "Close" : "Open"}</button>
        <button type="button" aria-label="Reset view" onClick={() => { setRot(-28); setTilt(-12); }} className="rounded-lg border border-line bg-white px-2 py-0.5 text-[11px] font-bold text-sub hover:bg-brand-soft">Reset</button>
      </div>
      <div aria-hidden className="relative grid cursor-grab touch-none select-none place-items-center active:cursor-grabbing" style={{ height: 210, perspective: 900 }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => setDrag(null)} onPointerCancel={() => setDrag(null)}>
        <span className="absolute bottom-3 h-4 w-44 rounded-[50%] bg-slate-900/20 blur-md" />
        <div style={{ position: "relative", width: W, height: H, transformStyle: "preserve-3d", transform: `translateX(${open ? 62 : 0}px) scale(${open ? 0.76 : 1}) rotateX(${tilt}deg) rotateY(${rot}deg)`, transition: drag ? "none" : "transform .7s cubic-bezier(.2,.8,.2,1)" }}>
          <div style={face(0, 0, W, H, `translateZ(${-T / 2}px)`, cover(b1, b2), { backfaceVisibility: "visible" })} />
          {Array.from({ length: slabs }, (_, i) => (
            <div key={i} style={face(3, 4, W - 7, H - 8, `translateZ(${-T / 2 + 2 + (i * (T - 4)) / slabs}px)`, i === slabs - 1 ? "#fff" : "#f1f5f9", { border: "1px solid #e2e8f0", backfaceVisibility: "visible" })}>
              {i === slabs - 1 && <div className={cx("grid h-full gap-1 p-2", layout === 1 ? "grid-cols-1" : "grid-cols-2")}>{Array.from({ length: layout === 1 ? 1 : layout }, (_, k) => <span key={k} className="rounded-[2px]" style={{ background: ["#fbcfe8", "#fde68a", "#bae6fd", "#bbf7d0"][k % 4], opacity: inside && inside.count > 0 ? 1 : 0.4 }} />)}</div>}
            </div>
          ))}
          <div style={face(-T / 2, 0, T, H, "rotateY(-90deg)", `linear-gradient(90deg, ${c2}, ${c1})`, { backfaceVisibility: "visible" })} />
          <div style={face(W - T / 2, 3, T, H - 6, "rotateY(90deg)", "repeating-linear-gradient(0deg,#fff,#fff 2px,#cbd5e1 2px,#cbd5e1 3px)", { backfaceVisibility: "visible" })} />
          <div style={face(3, -T / 2 + 0, W - 6, T, "rotateX(90deg)", p1 === "#334155" ? "#e2e8f0" : p1, { backfaceVisibility: "visible", opacity: 0.9 })} />
          <div style={{ position: "absolute", left: 0, top: 0, width: W, height: H, transformStyle: "preserve-3d", transformOrigin: "left center", transform: `translateZ(${T / 2}px) rotateY(${open ? -150 : 0}deg)`, transition: drag ? "transform .7s" : "transform .9s cubic-bezier(.2,.8,.2,1)" }}>
            <div style={face(0, 0, W, H, "none", cover(c1, c2), { boxShadow: "inset 6px 0 8px rgba(0,0,0,.35)" })} className="grid place-items-center px-4 text-center">
              {front && front.count > 0
                ? <span className="text-[14px] font-semibold leading-tight tracking-wide" style={{ color: light ? "#334155" : "#f5d98b", fontFamily: "Georgia, serif", textShadow: light ? "none" : "0 1px 2px rgba(0,0,0,.5)" }}>{title || "Our Album"}</span>
                : <span className="text-[11px] font-semibold text-white/60">No cover chosen</span>}
            </div>
            <div style={face(0, 0, W, H, "rotateY(180deg)", cover(c2, c1), { boxShadow: "inset -6px 0 8px rgba(0,0,0,.3)" })} />
          </div>
        </div>
      </div>
      <div className="mt-1 flex justify-between gap-2 text-[11px] font-semibold text-ink">
        <span className="truncate" title={front?.item}>Cover: {front?.item ? shortName(front.item) : "—"}</span>
        <span className="truncate text-right" title={inside?.item}>Pages: {inside?.item ? shortName(inside.item) : "—"}</span>
      </div>
    </div>
  );
}

const shortName = (n: string) => n.split("-").slice(1).join(" · ") || n;

const stepBtn = "grid size-8 place-items-center rounded-lg border border-line bg-white text-sub hover:bg-brand-soft disabled:opacity-40";
const numCls = "h-8 w-16 rounded-lg border border-line bg-white px-2 text-center text-[13px] font-bold outline-none focus:border-brand disabled:bg-slate-50";
const cell = "h-9 rounded-lg border border-line bg-white px-2 text-[13px] outline-none focus:border-brand disabled:bg-slate-50";
const COVER_RE = /^(MINI BOOK )?COVER\b/i;

export interface ItemsProps {
  pos: number; title?: string; totalSheets: number; lines: CostLine[]; categories: string[]; editable: boolean; admin: boolean;
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
  const sum = (ls: CostLine[]) => ls.reduce((a, l) => a + l.qty * l.sell, 0);
  const insideLines = sheetLines.filter((l) => !COVER_RE.test(l.name.trim())), backLines = covers.slice(1);
  const parts: Part[] = [
    { label: FRONT, color: colorOf(FRONT, 0), count: covers[0]?.qty ?? 0, cover: true, item: covers[0]?.name, amount: sum(covers.slice(0, 1)) },
    { label: INSIDE, color: colorOf(INSIDE, 0), count: insideLines.reduce((a, l) => a + l.qty, 0), item: insideLines[0]?.name, amount: sum(insideLines) },
    { label: BACK, color: colorOf(BACK, 0), count: backLines.reduce((a, l) => a + l.qty, 0), cover: true, item: backLines[0]?.name, amount: sum(backLines) },
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
    <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]" data-testid={`planner-${p.pos}`}>
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
        <AlbumVisual total={p.totalSheets} parts={parts} title={p.title} />
        <div className="mt-3 rounded-2xl border border-line bg-white p-3" data-testid={`selections-${p.pos}`}>
          <div className="mb-1 text-xs font-extrabold">Your selections</div>
          {parts.map((x) => (
            <div key={x.label} className="flex items-center gap-2 border-t border-line py-1.5 first:border-t-0 text-[12px]">
              <i className="size-2.5 shrink-0 rounded-sm" style={{ background: x.color }} />
              <div className="min-w-0 flex-1"><div className="font-bold">{x.label} <span className="font-normal text-sub">{x.count} sheet{x.count === 1 ? "" : "s"}</span></div>
                <div className="truncate text-sub" title={x.item}>{x.item ?? "Not chosen yet"}</div></div>
              <span className="font-bold">{inr(x.amount ?? 0)}</span>
              {p.editable && <button className="text-[11px] font-bold text-brand hover:underline" onClick={() => p.onCategory(x.label === INSIDE ? "PAPER" : "COVER")}>{x.item ? "Change" : "Choose"}</button>}
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between border-t border-line pt-2 text-[13px]"><span className="font-bold text-brand">Album total</span><span className="text-base font-extrabold text-brand">{inr(total)}</span></div>
        </div>
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
