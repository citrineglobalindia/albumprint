import { useEffect, useRef, useState, type ReactNode } from "react";
import { Columns3, MoreVertical, Plus, Search, TrendingUp, X } from "lucide-react";
import { cx } from "./ui";
import { ITEMS, addManualItem, itemById, pathLabel, pathOf, usableItem, type CItem, type PricingMethod } from "../lib/catalog2";

/** On screen an item shows every level: "Paper - NT - 125 GSM - Glossy". */
export const fullName = (i: CItem) => [...pathOf(i.categoryId).map((c) => c.name), i.name].join(" - ");
import { money, type DraftAlbum, type DraftItem, type PricedOrder } from "../lib/orderPricing";
import { topItems } from "../lib/orders2";

type Line = PricedOrder["albums"][number]["lines"][number];
type Col = "desc" | "withTax" | "discount";
const COL_LABEL: Record<Col, string> = { desc: "Description", withTax: "Price/Unit with tax", discount: "Discount" };
const COLS_KEY = "albumpro.v1.album_item_cols";
const readCols = (): Record<Col, boolean> => { try { return { desc: true, withTax: true, discount: true, ...JSON.parse(localStorage.getItem(COLS_KEY) ?? "{}") }; } catch { return { desc: true, withTax: true, discount: true }; } };
const cell = "h-9 rounded-lg border border-line bg-white px-2 text-[13px] outline-none focus:border-brand";
const th = "px-1.5 py-2";

/** The album's items as an invoice table: every row editable (description, qty, price, discount), items added from inside the table
 *  (search by name / path / code — a barcode scanner types the code and Enter), totals underneath. Printing and design rows are automatic. */
export function AlbumItemsTable({ a, n, priced, set, accept, onAdd, taxRate, browse, footer }: {
  a: DraftAlbum; n: number; priced?: PricedOrder["albums"][number]; set: (p: Partial<DraftAlbum>) => void;
  accept: (i: CItem) => boolean; onAdd: (itemId: string) => string | null; taxRate: number; browse: ReactNode; footer?: ReactNode;
}) {
  const [cols, setCols] = useState(readCols);
  const [colsOpen, setColsOpen] = useState(false);
  const [q, setQ] = useState(""); const [msg, setMsg] = useState("");
  const [menu, setMenu] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);                                     // the blank line opened by "+ Add item"
  // an item that is not in the catalog: typed here, saved under "Manual items", then added to this album
  const [manual, setManual] = useState<{ name: string; method: PricingMethod; unit: string; rate: string } | null>(null);
  const [savingItem, setSavingItem] = useState(false);
  const saveManual = async () => {
    if (!manual) return;
    const t = manual.rate.replace(/[₹,\s]/g, ""); const rate = t === "" ? null : Number(t);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) { setMsg("Enter a rate of 0 or more"); return; }
    setSavingItem(true); const r = await addManualItem({ name: manual.name, method: manual.method, unit: manual.unit, rate }); setSavingItem(false);
    if ("error" in r) { setMsg(r.error); return; }
    const e = onAdd(r.id); if (e) { setMsg(e); return; }
    setMsg(""); setManual(null);
  };
  const search = useRef<HTMLInputElement>(null);
  useEffect(() => { try { localStorage.setItem(COLS_KEY, JSON.stringify(cols)); } catch { /* private mode */ } }, [cols]);

  const lines = priced?.lines ?? [];
  const sheets = Number(a.sheets) || 0;
  const upd = (id: string, p: Partial<DraftItem>) => set({ items: a.items.map((x) => (x.itemId === id ? { ...x, ...p } : x)) });
  const num = (v: string) => (v === "" ? ("" as unknown as number) : Number(v));
  const withTax = (r: number) => Math.round(r * (100 + taxRate)) / 100;

  // search: every word must appear in the item's path, name or code
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const results = words.length ? ITEMS.filter((i) => usableItem(i) && accept(i) && words.every((w) => `${pathLabel(i.categoryId)} ${i.name} ${i.code ?? ""}`.toLowerCase().includes(w))).slice(0, 8) : [];
  const add = (id: string) => { const e = onAdd(id); if (e) { setMsg(e); return; } setQ(""); setMsg(""); search.current?.focus(); };
  const onEnter = () => {
    const code = q.trim().toLowerCase();
    const exact = ITEMS.find((i) => usableItem(i) && accept(i) && (i.code ?? "").toLowerCase() === code);
    if (exact) add(exact.id); else if (results.length === 1) add(results[0]!.id); else if (!results.length) setMsg("No product matches — check the name or code");
  };
  const totalQty = lines.reduce((s, l) => s + (l.scope === "copy" ? l.qty : 1), 0);

  return (
    <div className="mt-4 rounded-2xl border border-line bg-white" data-testid={`album-items-${n}`}>
      <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
        <h3 className="text-base font-extrabold">Album items</h3>
        <span className="rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-bold text-brand">{a.items.length} item{a.items.length === 1 ? "" : "s"}</span>
        <div className="ml-auto flex w-full items-center justify-end gap-2 sm:w-auto">
        <div className="relative min-w-0 flex-1 sm:w-72 sm:flex-none">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sub" />
          <input ref={search} aria-label="Search products" className={cx(cell, "h-10 w-full pl-9")} placeholder="Search products or scan barcode" value={q}
            onChange={(e) => { setQ(e.target.value); setMsg(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onEnter(); } if (e.key === "Escape") setQ(""); }} />
          {results.length > 0 && <ul role="listbox" aria-label="Matching products" className="absolute right-0 z-30 mt-1 max-h-72 w-full min-w-[300px] overflow-y-auto rounded-xl border border-line bg-white p-1 shadow-xl">
            {results.map((i) => <li key={i.id}><button type="button" role="option" aria-selected={false} onClick={() => add(i.id)} className="w-full rounded-lg px-3 py-2 text-left hover:bg-brand-soft">
              <span className="block text-sm font-semibold">{fullName(i)}{i.code ? <span className="ml-1 text-xs text-sub">({i.code})</span> : null}</span>
              <span className="block text-[11px] text-sub">{i.rate != null ? `${money(i.rate)} / ${i.method === "per_sheet" ? "sheet" : i.unit}` : "price not set"}</span></button></li>)}
          </ul>}
        </div>
        <div className="relative">
          <button type="button" onClick={() => setColsOpen(!colsOpen)} className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-line px-3 text-sm font-semibold hover:bg-brand-soft"><Columns3 className="size-4" />Columns</button>
          {colsOpen && <div role="dialog" aria-label="Columns" className="absolute right-0 z-30 mt-1 w-56 rounded-xl border border-line bg-white p-2 shadow-xl">
            {(Object.keys(COL_LABEL) as Col[]).map((c) => <label key={c} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50"><input type="checkbox" checked={cols[c]} onChange={() => setCols({ ...cols, [c]: !cols[c] })} />{COL_LABEL[c]}</label>)}
          </div>}
        </div>
        </div>
      </div>
      {msg && <p role="alert" className="border-b border-line bg-rose-50 px-4 py-2 text-xs font-semibold text-rose-700">{msg}</p>}

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]" data-testid={`album-lines-${n}`}>
          <thead className="bg-slate-100/80 text-[12px] font-bold text-ink">
            <tr>
              <th className="w-8 px-2 py-2 text-left">#</th><th className={cx(th, "min-w-[150px] text-left")}>Item / Finish</th>
              {cols.desc && <th className={cx(th, "text-left")}>Description</th>}
              <th className={cx(th, "text-center")}>Qty</th><th className={cx(th, "text-left")}>Unit</th>
              <th className={cx(th, "text-center leading-tight")}>Price/Unit<span className="block text-[10px] font-semibold text-sub">Without tax</span></th>
              {cols.withTax && <th className={cx(th, "text-center leading-tight")}>Price/Unit<span className="block text-[10px] font-semibold text-sub">With tax</span></th>}
              {cols.discount && <th className={cx(th, "text-center")}>Discount</th>}
              <th className={cx(th, "text-right")}>Total cost</th><th className="w-8" />
            </tr>
          </thead>
          <tbody>{lines.map((l, k) => {
            const di = a.items.find((x) => x.itemId === l.itemId && l.kind === "item");
            const it = di ? itemById(di.itemId) : undefined;
            const auto = !di;
            const nm = it?.name ?? l.name;                                                // short name for labels; the row shows the full path
            const unit = l.method === "per_sheet" ? "Sheets" : l.method === "fixed_per_album" ? "Album" : (l.unit || "pcs");
            const eff = l.rate;
            return (
              <tr key={`${l.kind}${l.itemId}${k}`} className={cx("border-t border-line align-middle", auto && "bg-slate-50/60")}>
                <td className="px-2 py-2 font-bold">{k + 1}</td>
                <td className="px-1.5 py-2"><span className="font-bold" data-testid="line-name">{it ? fullName(it) : l.name}</span>
                  {auto && <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">{l.kind === "design" && !l.itemId ? "entered" : "automatic"}</span>}
                  <span className="block text-[11px] text-sub">{it ? (di?.price ? "price set on this order" : l.rule ?? "") : l.rule ?? (l.kind === "printing" ? "Printing rate card" : "Design")}</span></td>
                {cols.desc && <td className="px-1.5">{di ? <input aria-label={`Description of ${nm}`} className={cx(cell, "w-28")} maxLength={200} placeholder="e.g. 12 × 30" value={di.note ?? ""} onChange={(e) => upd(di.itemId, { note: e.target.value })} />
                  : <span className="text-xs text-sub">{l.scope === "album" ? "Once per album" : "Every copy"}</span>}</td>}
                <td className="px-1.5 text-center">
                  {di && l.method === "per_unit" ? <input aria-label={`Quantity of ${nm}`} type="number" min={1} step={1} className={cx(cell, "w-16 text-center")} value={di.qty} onChange={(e) => upd(di.itemId, { qty: num(e.target.value) })} />
                    : di && l.method === "per_sheet" ? <span className="inline-flex items-center gap-1"><input aria-label={`Quantity of ${nm}`} type="number" min={1} step={1} className={cx(cell, "w-16 text-center")} value={di.sheetQty ?? a.sheets}
                        onChange={(e) => upd(di.itemId, { sheetQty: e.target.value === "" || e.target.value === String(a.sheets) ? null : e.target.value })} />
                      {di.sheetQty == null || di.sheetQty === "" ? <span className="text-[10px] font-semibold text-emerald-700" title="Follows the album's sheet count">auto</span>
                        : <button type="button" aria-label={`Match ${nm} to album sheets`} onClick={() => upd(di.itemId, { sheetQty: null })} className="text-[10px] font-semibold text-brand hover:underline" title="Follow the album's sheet count again">↺</button>}</span>
                    : <span className="tabular-nums" data-testid={`qty-${l.kind}-${n}`}>{l.scope === "copy" || (l.method === "per_sheet" && l.qty > 1) ? l.qty : 1}</span>}
                </td>
                <td className="px-1.5"><span className="text-xs text-sub">{unit}</span></td>
                <td className="px-1.5 text-center">{di ? <input aria-label={`Price of ${nm}`} inputMode="decimal" className={cx(cell, "w-20 text-right", l.missing && "border-rose-300 bg-rose-50", di.price && "border-brand/50")}
                    placeholder={l.missing ? "Not set" : "₹"} title={di.price ? `Catalog price ${l.listRate != null ? money(l.listRate) : "not set"} — typed on this order` : "Catalog price — type to change it for this order"}
                    value={di.price ?? (l.listRate != null ? String(l.listRate) : "")}
                    onChange={(e) => { const v = e.target.value.replace(/[₹,\s]/g, ""); upd(di.itemId, { price: v === "" || (l.listRate != null && Number(v) === l.listRate && v === String(l.listRate)) ? null : v }); }} />
                  : <span className={cx("tabular-nums", l.missing && "font-bold text-rose-600")}>{l.missing ? "Not set" : money(eff!)}</span>}</td>
                {cols.withTax && <td className="px-1.5 text-center"><span className="tabular-nums text-sub" title={taxRate ? `Including ${taxRate}% tax` : "Tax is off for this order"}>{eff == null || l.missing ? "—" : money(withTax(eff))}</span></td>}
                {cols.discount && <td className="px-1.5 text-center">{di ? <span className="inline-flex">
                    <input aria-label={`Discount on ${nm}`} inputMode="decimal" className={cx(cell, "w-14 rounded-r-none text-right")} placeholder="0" value={di.disc?.value ?? ""}
                      onChange={(e) => { const v = e.target.value.replace(/[₹,%\s]/g, ""); upd(di.itemId, { disc: v === "" ? null : { type: di.disc?.type ?? "fixed", value: v } }); }} />
                    <select aria-label={`Discount type for ${nm}`} className={cx(cell, "-ml-px w-12 rounded-l-none px-1")} value={di.disc?.type ?? "fixed"} onChange={(e) => upd(di.itemId, { disc: { type: e.target.value as "fixed" | "percent", value: di.disc?.value ?? "" } })}>
                      <option value="fixed">₹</option><option value="percent">%</option></select></span>
                  : <span className="text-xs text-sub">—</span>}</td>}
                <td className="whitespace-nowrap px-1.5 text-right"><span className="text-[14px] font-extrabold tabular-nums">{l.missing ? "—" : money(l.amount)}</span>
                  {!l.missing && l.scope === "copy" && (priced?.copies ?? 1) > 1 && <span className="block text-[10px] text-sub">{money(l.unitAmount)} × {priced!.copies} copies</span>}
                  {!!l.discount && <span className="block text-[10px] font-semibold text-emerald-700">− {money(Math.round(l.discount * (l.scope === "copy" ? priced?.copies ?? 1 : 1) * 100) / 100)} off</span>}</td>
                <td className="relative pr-1 text-right">{di && <>
                  <button type="button" aria-label={`More for ${nm}`} onClick={() => setMenu(menu === di.itemId ? null : di.itemId)} className="grid size-8 place-items-center rounded-lg hover:bg-slate-100"><MoreVertical className="size-4" /></button>
                  {menu === di.itemId && <div role="menu" className="absolute right-2 top-10 z-30 w-48 rounded-xl border border-line bg-white p-1 text-left shadow-xl" onMouseLeave={() => setMenu(null)}>
                    {di.price != null && <button type="button" role="menuitem" onClick={() => { upd(di.itemId, { price: null }); setMenu(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">Use catalog price</button>}
                    {di.disc && <button type="button" role="menuitem" onClick={() => { upd(di.itemId, { disc: null }); setMenu(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50">Remove discount</button>}
                    <button type="button" role="menuitem" aria-label={`Remove ${nm}`} onClick={() => { set({ items: a.items.filter((x) => x.itemId !== di.itemId) }); setMenu(null); }} className="w-full rounded-lg px-3 py-2 text-left text-sm font-semibold text-rose-600 hover:bg-rose-50">Remove item</button>
                  </div>}</>}</td>
              </tr>);
          })}
            {adding && <NewLine no={lines.length + 1} accept={accept} onCancel={() => setAdding(false)} onPick={(id) => { const e = onAdd(id); if (!e) setAdding(false); return e; }} />}
            {(() => {
              const have = new Set(a.items.map((x) => x.itemId));
              const top = topItems(8, (id) => { const it = itemById(id); return !!it && accept(it) && !have.has(id); });
              return top.length > 0 ? <tr className="border-t border-line"><td colSpan={20} className="px-3 pt-3" data-testid="top-items">
                <span className="mr-2 inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wide text-sub"><TrendingUp className="size-3.5" />Most used</span>
                {top.map((t) => { const it = itemById(t.itemId)!; return <button key={t.itemId} type="button" title={`${pathLabel(it.categoryId)} · ${it.name} · on ${t.orders} order(s)`} onClick={() => add(t.itemId)} className="mb-1 mr-1.5 inline-flex h-7 items-center gap-1 rounded-full border border-brand/40 bg-brand-soft/50 px-2.5 text-xs font-semibold text-brand hover:bg-brand-soft"><Plus className="size-3" />{it.name}<span className="text-[10px] text-sub">×{t.orders}</span></button>; })}
              </td></tr> : null;
            })()}
            <tr className="border-t border-line"><td colSpan={20} className="p-3">
              <span className="flex gap-2">
                <button type="button" onClick={() => setAdding(true)} disabled={adding} className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line text-sm font-bold text-brand hover:bg-brand-soft disabled:opacity-50"><Plus className="size-4" />Add item</button>
                <button type="button" onClick={() => setManual(manual ? null : { name: "", method: "per_unit", unit: "pcs", rate: "" })} data-testid={`manual-item-${n}`} className="flex h-11 items-center justify-center gap-2 rounded-xl border-2 border-dashed border-violet-300 px-4 text-sm font-bold text-violet-800 hover:bg-violet-50"><Plus className="size-4" />New item (not in list)</button>
              </span>
              {manual && (
                <div className="mt-2 flex flex-wrap items-end gap-2 rounded-xl border border-violet-200 bg-violet-50/50 p-3" data-testid={`manual-form-${n}`}>
                  <label className="block min-w-[180px] flex-1"><span className="mb-1 block text-[11px] font-semibold text-sub">Item name</span>
                    <input aria-label="New item name" autoFocus className={cx(cell, "w-full")} value={manual.name} maxLength={120} placeholder="e.g. Velvet cover with name" onChange={(e) => setManual({ ...manual, name: e.target.value })} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-semibold text-sub">Charged</span>
                    <select aria-label="New item charged" className={cell} value={manual.method} onChange={(e) => setManual({ ...manual, method: e.target.value as PricingMethod, unit: e.target.value === "per_sheet" ? "sheet" : manual.unit === "sheet" ? "pcs" : manual.unit })}>
                      <option value="per_unit">Per piece (per copy)</option><option value="per_sheet">Per sheet (per copy)</option><option value="fixed_per_album">Once per album</option>
                    </select></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-semibold text-sub">Unit</span>
                    <input aria-label="New item unit" className={cx(cell, "w-20")} value={manual.unit} maxLength={20} onChange={(e) => setManual({ ...manual, unit: e.target.value })} /></label>
                  <label className="block"><span className="mb-1 block text-[11px] font-semibold text-sub">Rate (₹)</span>
                    <input aria-label="New item rate" inputMode="decimal" className={cx(cell, "w-28 text-right")} value={manual.rate} placeholder="0.00" onChange={(e) => setManual({ ...manual, rate: e.target.value })} /></label>
                  <button type="button" disabled={savingItem} onClick={() => void saveManual()} className="h-9 rounded-lg bg-violet-700 px-4 text-xs font-bold text-white hover:bg-violet-800 disabled:opacity-50">{savingItem ? "Saving…" : "Save & add"}</button>
                  <button type="button" onClick={() => setManual(null)} className="h-9 rounded-lg px-3 text-xs font-bold hover:bg-white">Cancel</button>
                  <p className="w-full text-[11px] text-sub">Saved in the catalog under <b>Manual items</b>, so you can pick it on later orders. An admin can move or edit it in Catalog & Pricing.</p>
                </div>
              )}
            </td></tr>
          </tbody>
          {priced && <tfoot className="bg-slate-50/80">
            <tr className="border-t border-line"><td colSpan={3} className="px-3 py-2 text-sub">Total quantity <b className="ml-2 text-ink" data-testid={`total-qty-${n}`}>{totalQty}</b>{sheets > 0 && <span className="ml-2 text-xs">(album: {sheets} sheets)</span>}</td>
              <td colSpan={20} className="px-3 py-2 text-right"><span className="text-sub">Per-copy subtotal</span> <b className="ml-3 tabular-nums" data-testid={`per-copy-${n}`}>{money(priced.perCopy)}</b></td></tr>
            {priced.copies > 1 && <tr><td colSpan={20} className="px-3 py-1 text-right text-sub">× {priced.copies} copies <span className="ml-3 tabular-nums text-ink">{money(Math.round(priced.perCopy * priced.copies * 100) / 100)}</span></td></tr>}
            {priced.perAlbum > 0 && <tr><td colSpan={20} className="px-3 py-1 text-right text-sub">Per-album charges (once) <span className="ml-3 tabular-nums text-ink">{money(priced.perAlbum)}</span></td></tr>}
            <tr><td colSpan={20} className="px-3 py-2 text-right text-base font-extrabold">Subtotal <span className="ml-3 tabular-nums" data-testid={`album-total-${n}`}>{money(priced.total)}</span></td></tr>
          </tfoot>}
        </table>
      </div>
      {footer}
      <details className="border-t border-line p-3" data-testid={`browse-${n}`} open>
        <summary className="cursor-pointer text-xs font-bold text-sub">Browse by category</summary>
        <div className="mt-2">{browse}</div>
      </details>
    </div>
  );
}

/** A blank line in the table: search or pick a product right there. With nothing typed it lists every product (by category);
 *  ↑ ↓ move, Enter picks (an exact item code — e.g. from a barcode scanner — is picked at once), Esc closes the line. */
function NewLine({ no, accept, onPick, onCancel }: { no: number; accept: (i: CItem) => boolean; onPick: (id: string) => string | null; onCancel: () => void }) {
  const [q, setQ] = useState(""); const [hi, setHi] = useState(0); const [err, setErr] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const all = ITEMS.filter((i) => usableItem(i) && accept(i))
    .map((i) => ({ i, path: pathLabel(i.categoryId) }))
    .filter(({ i, path }) => words.every((w) => `${path} ${i.name} ${i.code ?? ""}`.toLowerCase().includes(w)))
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }) || a.i.sort - b.i.sort);
  const shown = all.slice(0, 80);
  const cur = Math.min(hi, Math.max(shown.length - 1, 0));
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${cur}"]`)?.scrollIntoView({ block: "nearest" }); }, [cur]);
  const pick = (id: string) => { const e = onPick(id); setErr(e ?? ""); };
  const enter = () => {
    const code = q.trim().toLowerCase();
    const exact = code ? all.find(({ i }) => (i.code ?? "").toLowerCase() === code) : undefined;
    if (exact) pick(exact.i.id); else if (shown[cur]) pick(shown[cur]!.i.id); else setErr("No product matches — check the name or code");
  };
  return (
    <>
      <tr className="border-t-2 border-brand/40 bg-brand-soft/40" data-testid="new-line">
        <td className="px-2 py-2 font-bold">{no}</td>
        <td colSpan={18} className="px-1.5 py-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-sub" />
            <input autoFocus aria-label="New line product" role="combobox" aria-expanded aria-controls="new-line-options" aria-autocomplete="list"
              className={cx(cell, "h-10 w-full pl-9 font-semibold")} placeholder="Search or select a product…" value={q}
              onChange={(e) => { setQ(e.target.value); setHi(0); setErr(""); }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setHi(Math.min(cur + 1, shown.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setHi(Math.max(cur - 1, 0)); }
                else if (e.key === "Enter") { e.preventDefault(); enter(); }
                else if (e.key === "Escape") { e.preventDefault(); onCancel(); }
              }} />
          </div>
        </td>
        <td className="pr-1 text-right"><button type="button" aria-label="Cancel new line" onClick={onCancel} className="grid size-8 place-items-center rounded-lg text-sub hover:bg-white"><X className="size-4" /></button></td>
      </tr>
      <tr className="bg-brand-soft/40"><td colSpan={20} className="px-3 pb-3">
        {err && <p role="alert" className="mb-2 text-xs font-semibold text-rose-600">{err}</p>}
        {shown.length ? (
          <ul id="new-line-options" ref={listRef} role="listbox" aria-label="Products" className="max-h-64 overflow-y-auto rounded-xl border border-line bg-white p-1">
            {shown.map(({ i }, k) => (
              <li key={i.id} data-i={k}><button type="button" role="option" aria-selected={k === cur} onMouseEnter={() => setHi(k)} onClick={() => pick(i.id)}
                className={cx("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left", k === cur ? "bg-brand-soft" : "hover:bg-slate-50")}>
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold" title={fullName(i)}>{fullName(i)}{i.code ? <span className="ml-1 text-xs font-normal text-sub">({i.code})</span> : null}</span></span>
                <span className="shrink-0 text-xs tabular-nums text-sub">{i.rate != null ? `${money(i.rate)} / ${i.method === "per_sheet" ? "sheet" : i.unit}` : "price not set"}</span>
              </button></li>))}
            {all.length > shown.length && <li className="px-3 py-2 text-[11px] text-sub">{all.length - shown.length} more — type to narrow the list</li>}
          </ul>
        ) : <p className="rounded-xl border border-dashed border-line bg-white p-3 text-center text-xs text-sub">{ITEMS.length ? "No product matches — check the name or code" : "No products yet — an admin adds them in Catalog & Pricing"}</p>}
      </td></tr>
    </>
  );
}
