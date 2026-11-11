import { useRef, useState } from "react";
import { asExcel, downloadCsv, parseCsv } from "../lib/csv";
import { Download, FileUp, Save, Trash2, Undo2, Wand2 } from "lucide-react";
import { useConfirm } from "./ConfirmDialog";
import "../lib/orders2";                                   // registers which items are on finalized orders (delete protection in demo mode)
import { Panel, Pill, Td, Th, Toggle, cx, inputCls, tableCls, trCls } from "./ui";
import { useStore } from "../lib/store";
import { ITEMS, childrenOf, deleteItem, importPricesCsv, pathOf, pricesCsv, savePrices, type PriceRow, type PricingMethod } from "../lib/catalog2";
import { downloadBlob } from "../lib/invoicePdf";
import { LABS, canSeeCost, labRate, saveLabRates } from "../lib/labs";

type Edit = { rate: string; method: PricingMethod; unit: string };
const rateText = (n: number | null) => (n == null ? "" : String(n));
const SHORT: Record<PricingMethod, string> = { per_sheet: "Per sheet", per_unit: "Per piece", fixed_per_album: "Per album (fixed)", one_time_order: "Per order (once)" };

/** One screen to price the whole catalog: filter, type the rates, save all at once. Also CSV export / import for spreadsheets. */
export function PriceGrid({ show }: { show: (m: string) => void }) {
  useStore();
  const [q, setQ] = useState(""); const [group, setGroup] = useState(""); const [unpriced, setUnpriced] = useState(false);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [fill, setFill] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [dialog, confirm] = useConfirm();
  // purchase rates: what the chosen lab charges us per item (admin / accounts), for purchase vs sales
  const cost = canSeeCost();
  const [lab, setLab] = useState(""); const [buy, setBuy] = useState<Record<string, string>>({});
  const buyCur = (id: string) => buy[id] ?? rateText(labRate(lab, id) ?? null);
  const buyChanged = lab ? Object.keys(buy).filter((id) => buy[id]!.replace(/[₹,\s]/g, "") !== rateText(labRate(lab, id) ?? null)) : [];

  const rows = ITEMS.map((i) => { const p = pathOf(i.categoryId); return { i, top: p[0]?.id ?? "", path: p.map((c) => c.name).join(" ▸ ") }; })
    .sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }) || a.i.sort - b.i.sort);
  const cur = (id: string): Edit => { const e = edits[id]; if (e) return e; const i = ITEMS.find((x) => x.id === id)!; return { rate: rateText(i.rate), method: i.method, unit: i.unit }; };
  const words = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const shown = rows.filter(({ i, top, path }) => (!group || top === group) && (!unpriced || cur(i.id).rate.trim() === "")
    && words.every((w) => `${path} ${i.name}`.toLowerCase().includes(w)));
  const changed = Object.keys(edits).filter((id) => { const i = ITEMS.find((x) => x.id === id); const e = edits[id]!; return i && (e.rate.trim() !== rateText(i.rate) || e.method !== i.method || e.unit.trim() !== i.unit); });
  const selected = [...picked].filter((id) => ITEMS.some((i) => i.id === id));
  const allShown = shown.length > 0 && shown.every(({ i }) => picked.has(i.id));
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const remove = (ids: string[]) => {
    const names = ids.map((id) => ITEMS.find((x) => x.id === id)?.name).filter(Boolean);
    confirm({ title: ids.length === 1 ? `Delete “${names[0]}”?` : `Delete ${ids.length} items?`, message: `${ids.length === 1 ? "This item and its rate rules are" : "These items and their rate rules are"} removed from the catalog. Items already used on orders are kept (switch them off instead). This cannot be undone.`, confirmLabel: "Delete", danger: true },
      async () => {
        setBusy(true); setMsg(""); let done = 0; const kept: string[] = [];
        for (const id of ids) { const e = await deleteItem(id); if (e) kept.push(e); else done++; }
        setBusy(false);
        setPicked((p) => { const n = new Set(p); ids.forEach((id) => n.delete(id)); return n; });
        setEdits((s0) => { const n = { ...s0 }; ids.forEach((id) => delete n[id]); return n; });
        if (kept.length) setMsg(kept.length === 1 ? kept[0]! : `${kept.length} item(s) were kept because they are used on existing orders — switch them off instead`);
        if (done) show(`${done} item(s) deleted`);
      });
  };
  const priced = ITEMS.filter((i) => i.rate != null).length;
  const set = (id: string, p: Partial<Edit>) => setEdits((s) => ({ ...s, [id]: { ...cur(id), ...p } }));

  const save = async () => {
    setMsg(""); const out: PriceRow[] = [];
    for (const id of changed) {
      const e = edits[id]!, t = e.rate.replace(/[₹,\s]/g, "");
      const rate = t === "" ? null : Number(t);
      if (rate != null && !Number.isFinite(rate)) { setMsg(`“${e.rate}” is not a number (${ITEMS.find((x) => x.id === id)?.name})`); return; }
      out.push({ id, rate, method: e.method, unit: e.unit });
    }
    const buys: { itemId: string; rate: number | null }[] = [];
    for (const id of buyChanged) {
      const t = buy[id]!.replace(/[₹,\s]/g, ""); const rate = t === "" ? null : Number(t);
      if (rate != null && (!Number.isFinite(rate) || rate < 0)) { setMsg(`“${buy[id]}” is not a valid purchase rate (${ITEMS.find((x) => x.id === id)?.name})`); return; }
      buys.push({ itemId: id, rate });
    }
    setBusy(true);
    const err = out.length ? await savePrices(out) : null;
    const err2 = !err && buys.length ? await saveLabRates(lab, buys) : null;
    setBusy(false);
    if (err || err2) { setMsg((err ?? err2)!); return; }
    setEdits({}); setBuy({});
    show([out.length ? `${out.length} price(s)` : "", buys.length ? `${buys.length} purchase rate(s) for ${LABS.find((l) => l.id === lab)?.name}` : ""].filter(Boolean).join(" and ") + " saved");
  };
  const applyFill = () => {
    const t = fill.replace(/[₹,\s]/g, ""); if (t === "" || !Number.isFinite(Number(t))) { setMsg("Type the rate to apply, then press Apply"); return; }
    setMsg(""); setEdits((s) => { const n = { ...s }; for (const { i } of shown) n[i.id] = { ...cur(i.id), rate: t }; return n; });
  };
  const applyBuy = () => {
    const t = fill.replace(/[₹,\s]/g, ""); if (t === "" || !Number.isFinite(Number(t))) { setMsg("Type the purchase rate to apply, then press Apply"); return; }
    setMsg(""); setBuy((s) => { const n = { ...s }; for (const { i } of shown) n[i.id] = t; return n; });
  };
  const importCsv = async (f: File) => {
    setMsg(""); setBusy(true); const r = await importPricesCsv(await f.text()); setBusy(false);
    if ("error" in r) setMsg(r.error); else { setEdits({}); show(`CSV imported — ${r.added} new item(s), ${r.priced} price(s) updated`); }
  };

  return (
    <Panel title="Prices" subtitle={`${priced} of ${ITEMS.length} items priced · items without a rate show “Price not configured” in orders (unless a rate rule applies)`} bodyClassName="p-0"
      action={<div className="flex flex-wrap gap-2">
        <button onClick={() => downloadBlob(new Blob(["﻿" + pricesCsv()], { type: "text/csv" }), "albumpro-prices.csv")} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft"><Download className="size-3.5" />Export CSV</button>
        <button onClick={() => asExcel(() => downloadCsv("albumpro-prices.csv", parseCsv(pricesCsv().replace(/^\uFEFF/, "")).map((r) => r.map((v) => (v !== "" && /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : v)))))} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft"><Download className="size-3.5" />Export Excel</button>
        <button disabled={busy} onClick={() => file.current?.click()} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft"><FileUp className="size-3.5" />Import CSV</button>
        <input ref={file} type="file" accept=".csv,text/csv" aria-label="Prices CSV file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importCsv(f); }} />
      </div>}>
      <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
        <input aria-label="Search prices" className={cx(inputCls, "w-64")} placeholder="Search, e.g. rexine above 12x9" value={q} onChange={(e) => setQ(e.target.value)} />
        <select aria-label="Price group" className={cx(inputCls, "w-48")} value={group} onChange={(e) => setGroup(e.target.value)}>
          <option value="">All categories</option>{childrenOf(null).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <label className="flex h-10 items-center gap-2 text-sm font-semibold"><Toggle label="Only unpriced" on={unpriced} onChange={setUnpriced} />Only unpriced</label>
        {cost && <select aria-label="Purchase rates of lab" data-testid="purchase-lab" className={cx(inputCls, "w-56", lab && "border-violet-400 bg-violet-50")} value={lab} onChange={(e) => { setLab(e.target.value); setBuy({}); }}>
          <option value="">Purchase rates: choose a lab…</option>{LABS.filter((l) => l.active).map((l) => <option key={l.id} value={l.id}>Purchase rates · {l.name}</option>)}
        </select>}
        <div className="ml-auto flex items-center gap-2">
          <input aria-label="Rate for all shown" inputMode="decimal" className={cx(inputCls, "w-28")} placeholder="₹ rate" value={fill} onChange={(e) => setFill(e.target.value)} />
          <button onClick={applyFill} disabled={!shown.length} className="inline-flex h-10 items-center gap-1 rounded-lg border border-line px-3 text-sm font-bold hover:bg-brand-soft"><Wand2 className="size-4" />Apply to {shown.length} shown</button>
          {lab && <button onClick={applyBuy} disabled={!shown.length} className="inline-flex h-10 items-center gap-1 rounded-lg border border-violet-300 px-3 text-sm font-bold text-violet-800 hover:bg-violet-50"><Wand2 className="size-4" />Purchase rate to {shown.length} shown</button>}
        </div>
      </div>
      <div className="max-h-[62vh] overflow-auto scroll-thin">
        <table className={tableCls} data-testid="price-grid">
          <thead className="sticky top-0 z-10 bg-slate-50"><tr><Th className="w-8"><input type="checkbox" aria-label="Select all shown" checked={allShown} onChange={() => setPicked((p) => { const n = new Set(p); shown.forEach(({ i }) => (allShown ? n.delete(i.id) : n.add(i.id))); return n; })} /></Th><Th>Category</Th><Th>Item</Th><Th>Pricing</Th><Th>Unit</Th><Th className="text-right">{lab ? "Sales rate (₹)" : "Rate (₹)"}</Th>{lab && <><Th className="text-right">Purchase (₹) · {LABS.find((l) => l.id === lab)?.name}</Th><Th className="text-right">Margin</Th></>}<Th /></tr></thead>
          <tbody>{shown.map(({ i, path }) => {
            const e = cur(i.id), dirty = changed.includes(i.id);
            return (
              <tr key={i.id} className={cx(trCls, dirty && "bg-amber-50")} data-testid={`price-${path} ▸ ${i.name}`}>
                <Td><input type="checkbox" aria-label={`Select ${path} ▸ ${i.name}`} checked={picked.has(i.id)} onChange={() => toggle(i.id)} /></Td>
                <Td className="text-xs text-sub">{path}</Td>
                <Td className="font-semibold">{i.name}{!i.active && <Pill tone="slate" className="ml-2 !py-0 text-[10px]">Inactive</Pill>}{i.sample && <Pill tone="amber" className="ml-1 !py-0 text-[10px]">Sample</Pill>}</Td>
                <Td><select aria-label={`Pricing for ${path} ▸ ${i.name}`} className={cx(inputCls, "h-8 w-40 text-xs")} value={e.method} onChange={(ev) => set(i.id, { method: ev.target.value as PricingMethod })}>
                  {(Object.keys(SHORT) as PricingMethod[]).map((m) => <option key={m} value={m}>{SHORT[m]}</option>)}</select></Td>
                <Td><input aria-label={`Unit for ${path} ▸ ${i.name}`} className={cx(inputCls, "h-8 w-20 text-xs")} maxLength={20} value={e.unit} onChange={(ev) => set(i.id, { unit: ev.target.value })} /></Td>
                <Td className="text-right"><input aria-label={`Rate for ${path} ▸ ${i.name}`} inputMode="decimal" placeholder="Not set" className={cx(inputCls, "h-8 w-28 text-right tabular-nums", e.rate.trim() === "" && "border-amber-300")} value={e.rate} onChange={(ev) => set(i.id, { rate: ev.target.value })} /></Td>
                {lab && (() => { const b = buyCur(i.id), bn = Number(b.replace(/[₹,\s]/g, "")), sn = Number(e.rate.replace(/[₹,\s]/g, "")); const both = b.trim() !== "" && e.rate.trim() !== "" && Number.isFinite(bn) && Number.isFinite(sn); const m = sn - bn; return <>
                  <Td className="text-right"><input aria-label={`Purchase rate for ${path} ▸ ${i.name}`} inputMode="decimal" placeholder="Not set" className={cx(inputCls, "h-8 w-28 border-violet-300 text-right tabular-nums", buyChanged.includes(i.id) && "bg-amber-50")} value={b} onChange={(ev) => setBuy((s0) => ({ ...s0, [i.id]: ev.target.value }))} /></Td>
                  <Td className={cx("whitespace-nowrap text-right text-xs font-bold tabular-nums", both ? (m < 0 ? "text-rose-600" : "text-emerald-700") : "text-sub")} data-testid={`margin-${i.name}`}>{both ? `₹${Math.round(m * 100) / 100}${sn > 0 ? ` · ${((m / sn) * 100).toFixed(0)}%` : ""}` : "—"}</Td>
                </>; })()}
                <Td><button type="button" aria-label={`Delete ${path} ▸ ${i.name}`} disabled={busy} onClick={() => remove([i.id])} className="grid size-8 place-items-center rounded-lg text-rose-600 hover:bg-rose-50"><Trash2 className="size-4" /></button></Td>
              </tr>);
          })}
            {!shown.length && <tr><td colSpan={lab ? 9 : 7} className="p-6 text-center text-sm text-sub">{ITEMS.length ? "Nothing matches the filters." : "No items yet — use “Import product list” above, or add items under Categories & items."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3 border-t border-line p-4">
        {selected.length > 0 && <button disabled={busy} onClick={() => remove(selected)} className="inline-flex h-10 items-center gap-1 rounded-lg border border-rose-200 px-3 text-sm font-bold text-rose-600 hover:bg-rose-50 disabled:opacity-40"><Trash2 className="size-4" />Delete {selected.length} selected</button>}
        {msg && <p role="alert" className="text-sm font-semibold text-rose-600">{msg}</p>}
        <span className="ml-auto text-sm text-sub">{changed.length + buyChanged.length ? `${changed.length + buyChanged.length} unsaved change(s)` : "No unsaved changes"}</span>
        <button disabled={!(changed.length + buyChanged.length) || busy} onClick={() => { setEdits({}); setBuy({}); setMsg(""); }} className="inline-flex h-10 items-center gap-1 rounded-lg px-3 text-sm font-bold hover:bg-slate-100 disabled:opacity-40"><Undo2 className="size-4" />Discard</button>
        <button disabled={!(changed.length + buyChanged.length) || busy} onClick={() => void save()} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-40"><Save className="size-4" />Save {changed.length + buyChanged.length || ""} {buyChanged.length ? "change" : "price"}{changed.length + buyChanged.length === 1 ? "" : "s"}</button>
      </div>
      {dialog}
    </Panel>
  );
}
