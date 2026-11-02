import { useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { cx, inputCls } from "./ui";
import { useStore } from "../lib/store";
import { METHOD_LABEL, branchHas, categoryById, childrenOf, itemById, itemsIn, usableItem, type CItem } from "../lib/catalog2";
import { money } from "../lib/orderPricing";

const LEVEL = ["Category", "Subcategory", "Level 3", "Level 4"];

/** Dependent dropdowns: each level shows only the active children of the level above (and only branches that hold something usable);
 *  changing a level clears everything below it. The item list shows the active items of the deepest level chosen. */
/** sheets: the album's sheet count — a per-sheet item's quantity follows it automatically unless the user types another number. */
/** sheetBalance: for a per-sheet item, how many of the album's sheets its group (top category, e.g. Paper) already uses — the Qty starts at the balance. */
export type SheetBalance = { group: string; used: number; balance: number };
export function CategoryPicker({ accept, onAdd, label = "Add item", testId, sheets, sheetBalance }: { accept: (i: CItem) => boolean; onAdd: (itemId: string, qty: number, sheetQty?: number) => string | null; label?: string; testId?: string; sheets?: number | string; sheetBalance?: (i: CItem) => SheetBalance | null }) {
  useStore();
  const [path, setPath] = useState<string[]>([]);
  const [itemId, setItemId] = useState("");
  const [qty, setQty] = useState("1");
  const [sheetQty, setSheetQty] = useState<string | null>(null);              // null = follow the album's sheets
  const autoSheets = sheets === "" || sheets == null ? "" : String(sheets);
  const [msg, setMsg] = useState("");
  const ok = (i: CItem) => usableItem(i) && accept(i);
  const levels = useMemo(() => {
    const out: { parent: string | null; options: { id: string; name: string }[] }[] = [];
    let parent: string | null = null;
    for (let d = 0; d < 4; d++) {
      const options = childrenOf(parent, true).filter((c) => branchHas(c.id, ok)).map((c) => ({ id: c.id, name: c.name }));
      if (!options.length) break;
      out.push({ parent, options });
      const chosen = path[d];
      if (!chosen || !categoryById(chosen)) break;
      parent = chosen;
    }
    return out;
  }, [path, ok]); // eslint-disable-line react-hooks/exhaustive-deps
  const node = path[path.length - 1];
  const items = node ? itemsIn(node, true).filter(ok) : [];
  const item = itemId ? itemById(itemId) : undefined;
  const bal = item && item.method === "per_sheet" ? sheetBalance?.(item) ?? null : null;
  const pick = (id: string) => {                                                    // a per-sheet item starts with the sheets still left in its group
    setItemId(id); const it = id ? itemById(id) : undefined;
    const b = it && it.method === "per_sheet" ? sheetBalance?.(it) : null;
    setSheetQty(b && b.used > 0 ? String(Math.max(b.balance, 0)) : null);
  };
  const choose = (d: number, id: string) => { setPath([...path.slice(0, d), ...(id ? [id] : [])]); setItemId(""); setSheetQty(null); setMsg(""); };
  const add = () => {
    if (!item) { setMsg("Choose an item"); return; }
    const q = Number(qty);
    if (item.method === "per_unit" && (!Number.isInteger(q) || q < 1)) { setMsg("Enter a whole-number quantity of 1 or more"); return; }
    if (item.method === "per_sheet" && bal && bal.used > 0 && bal.balance <= 0 && (sheetQty === "0" || sheetQty === "")) { setMsg(`All ${autoSheets} sheets are already allocated in ${bal.group} — reduce another line first, or type a quantity`); return; }
    let sq: number | undefined;
    if (item.method === "per_sheet" && sheetQty != null && sheetQty !== autoSheets) {
      sq = Number(sheetQty);
      if (!/^[0-9]{1,5}$/.test(sheetQty) || sq < 1) { setMsg("Enter a whole number of sheets (1 or more), or use Auto"); return; }
    }
    const e = onAdd(item.id, item.method === "per_unit" ? q : 1, sq);
    if (e) { setMsg(e); return; }
    setItemId(""); setQty("1"); setSheetQty(null); setMsg("");
  };
  if (!levels.length) return <p className="rounded-xl border border-dashed border-line p-3 text-center text-xs text-sub" data-testid={testId}>Nothing to add here yet — an admin can add items in Catalog & Pricing.</p>;
  return (
    <div className="rounded-xl border border-line bg-slate-50/60 p-3" data-testid={testId}>
      <div className="mb-2 text-[13px] font-extrabold text-brand">{label}</div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {levels.map((lv, d) => (
          <label key={d} className="text-[11px] font-bold text-sub">{LEVEL[d]}
            <select aria-label={LEVEL[d]} className={cx(inputCls, "mt-1")} value={path[d] ?? ""} onChange={(e) => choose(d, e.target.value)}>
              <option value="">Select {LEVEL[d]!.toLowerCase()}…</option>{lv.options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </label>
        ))}
        {node && (
          <label className="text-[11px] font-bold text-sub">Item
            <select aria-label="Item" className={cx(inputCls, "mt-1")} value={itemId} onChange={(e) => { pick(e.target.value); setMsg(""); }} disabled={!items.length}>
              <option value="">{items.length ? "Select item…" : "No items at this level"}</option>{items.map((i) => <option key={i.id} value={i.id}>{i.name}{i.code ? ` (${i.code})` : ""}</option>)}
            </select>
          </label>
        )}
      </div>
      {item && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 text-xs text-sub">{METHOD_LABEL[item.method]}{item.rate != null ? ` · standard ${money(item.rate)} / ${item.unit}` : " · priced by requirement"}{item.description ? ` · ${item.description}` : ""}</div>
          {item.method === "per_unit" && <label className="text-[11px] font-bold text-sub">Qty<input aria-label="Quantity" type="number" min={1} step={1} className={cx(inputCls, "mt-1 w-24")} value={qty} onChange={(e) => setQty(e.target.value)} /></label>}
          {item.method === "per_sheet" && <label className="text-[11px] font-bold text-sub">Qty (sheets){bal && bal.used > 0 ? <span className={cx("ml-1 font-semibold", bal.balance > 0 ? "text-amber-700" : "text-rose-600")} data-testid="sheet-balance-hint">· balance {Math.max(bal.balance, 0)} of {autoSheets} in {bal.group}</span>
              : sheetQty == null ? <span className="ml-1 font-semibold text-emerald-700">· auto = album sheets</span> : <button type="button" onClick={() => setSheetQty(null)} className="ml-1 font-semibold text-brand hover:underline">· back to auto</button>}
            <input aria-label="Quantity" type="number" min={1} step={1} className={cx(inputCls, "mt-1 w-24")} placeholder="Sheets" value={sheetQty ?? autoSheets} onChange={(e) => setSheetQty(e.target.value)} /></label>}
          {(item.method === "fixed_per_album" || item.method === "one_time_order") && <label className="text-[11px] font-bold text-sub">Qty<input aria-label="Quantity" disabled className={cx(inputCls, "mt-1 w-24 bg-slate-100")} value={item.method === "fixed_per_album" ? "1 / album" : "1 / order"} readOnly /></label>}
          <button type="button" onClick={add} className="inline-flex h-10 items-center gap-1 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark"><Plus className="size-4" />Add</button>
        </div>
      )}
      {msg && <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{msg}</p>}
    </div>
  );
}
