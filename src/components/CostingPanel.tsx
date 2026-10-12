import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import AlbumPlanner, { startPathFor } from "./AlbumPlanner";
import { Panel, Pill, cx, inputCls } from "./ui";
import { CATALOG, type CatalogItem } from "../lib/catalog";
import { albumName } from "../lib/pricing";
import { allocated, costTotals, costingOf, countsSheetsFor, finalizeCosting, generateInvoices, isAdmin, newLineId, reopenCosting, saveCosting, setAlbumSheets } from "../lib/costing";
import type { Costing, CostLine, Order } from "../lib/data";
import { INVOICES } from "../lib/finance";
import { inr } from "../lib/format";

const cell = "h-9 rounded-lg border border-line bg-white px-2 text-[13px] outline-none focus:border-brand disabled:bg-slate-50";
const segs = (n: string) => n.split("-").map((s) => s.trim()).filter(Boolean);

/** Drill-down product picker: Category → item → variant (the hyphenated parts of the catalog names), then quantity and remarks. */
function CatalogPicker({ onAdd, onClose, startPath = [], defaultQty = 1, qtyLabel = "Qty", withRemarks = true }: { onAdd: (item: CatalogItem, qty: number, remarks: string) => void; onClose: () => void; startPath?: string[]; defaultQty?: number; qtyLabel?: string; withRemarks?: boolean }) {
  const [path, setPath] = useState<string[]>(startPath);
  const [picked, setPicked] = useState<CatalogItem | null>(null);
  const [qty, setQty] = useState(String(defaultQty));
  const [custom, setCustom] = useState<{ name: string; price: string } | null>(null);
  const [remarks, setRemarks] = useState("");
  const [q, setQ] = useState("");
  const active = useMemo(() => CATALOG.filter((c) => c.active).map((c) => ({ c, s: segs(c.name) })), []);
  const here = active.filter(({ s }) => path.every((p, i) => s[i] === p));
  const nodes = new Map<string, { deeper: boolean; item?: CatalogItem }>();
  here.filter(({ s }) => s.length > path.length).forEach(({ c, s }) => {
    const k = s[path.length]!; const n = nodes.get(k) ?? { deeper: false };
    if (s.length > path.length + 1) n.deeper = true; else n.item = c;
    nodes.set(k, n);
  });
  const results = q.trim() ? active.filter(({ c }) => `${c.name} ${c.sku}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 60) : [];
  const title = picked ? "Add Item" : path.length ? path[path.length - 1]! : "Products";
  const back = () => { if (picked) setPicked(null); else if (path.length) setPath(path.slice(0, -1)); else onClose(); };
  const row = "flex w-full items-center justify-between border-b border-line px-5 py-3.5 text-left text-[15px] font-bold hover:bg-brand-soft";
  return (
    <div className="fixed inset-0 z-[80] grid place-items-center bg-ink/40 p-4" onMouseDown={onClose}>
      <div role="dialog" aria-label="Choose product" className="flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-line px-4 py-3">
          <button aria-label="Back" onClick={back} className="grid size-9 place-items-center rounded-lg bg-brand text-white"><ArrowLeft className="size-4" /></button>
          <h2 className="flex-1 text-center text-base font-extrabold uppercase">{title}</h2>
          <button aria-label="Close" onClick={onClose} className="grid size-9 place-items-center rounded-lg bg-slate-100"><X className="size-4" /></button>
        </header>
        {picked ? (
          <div className="p-5">
            <p className="mb-3 text-sm font-extrabold text-brand">Item Selected: {picked.name}</p>
            <p className="mb-3 text-xs text-sub">{inr(picked.sell)} per {picked.unit}</p>
            <div className="flex gap-3">
              <label className="w-28 text-xs font-bold">{qtyLabel}<input type="number" min={1} aria-label="Quantity" className={cx(inputCls, "mt-1")} value={qty} onChange={(e) => setQty(e.target.value)} /></label>
              {withRemarks && <label className="flex-1 text-xs font-bold">Remarks<input className={cx(inputCls, "mt-1")} value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Optional" /></label>}
            </div>
            <button onClick={() => Number(qty) > 0 && onAdd(picked, Number(qty), remarks.trim())} className="mt-4 h-11 w-full rounded-xl bg-brand text-sm font-bold text-white hover:bg-brand-dark">Add Item</button>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col">
            {!path.length && <div className="border-b border-line p-3"><input aria-label="Search products" className={inputCls} placeholder="Search all products…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
            <div className="min-h-0 flex-1 overflow-y-auto">
              {q.trim() ? (
                results.length ? results.map(({ c }) => <button key={c.id} className={row} onClick={() => setPicked(c)}><span>{c.name}</span><span className="text-xs font-semibold text-sub">{inr(c.sell)}</span></button>) : <p className="p-6 text-center text-sm text-sub">No products match.</p>
              ) : (
                <>
                  {path.length > 0 && here.some(({ s }) => s.length === path.length) && <button className={row} onClick={() => setPicked(here.find(({ s }) => s.length === path.length)!.c)}><span>{path[path.length - 1]} (this item)</span></button>}
                  {[...nodes.entries()].map(([label, n]) => (
                    <button key={label} className={row} onClick={() => (n.deeper ? setPath([...path, label]) : setPicked(n.item!))}>
                      <span>{label}</span>
                      {n.deeper ? <ChevronRight className="size-4 text-sub" /> : <span className="text-xs font-semibold text-sub">{inr(n.item!.sell)}</span>}
                    </button>
                  ))}
                  {!nodes.size && <p className="p-6 text-center text-sm text-sub">{CATALOG.some((c) => c.active) ? "Nothing here." : "The product catalog is empty. An admin adds products under Masters → Product Catalog."}</p>}
                </>
              )}
            </div>
            <div className="border-t border-line p-3">
              {custom ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="min-w-40 flex-1 text-xs font-bold">Custom item name<input aria-label="Custom item name" className={cx(inputCls, "mt-1")} value={custom.name} onChange={(e) => setCustom({ ...custom, name: e.target.value })} placeholder="Enter item name manually" /></label>
                  <label className="w-28 text-xs font-bold">Selling price<input type="number" min={0} aria-label="Custom item price" className={cx(inputCls, "mt-1")} value={custom.price} onChange={(e) => setCustom({ ...custom, price: e.target.value })} /></label>
                  <button onClick={() => { if (custom.name.trim().length >= 2 && custom.price !== "" && Number(custom.price) >= 0) setPicked({ id: `custom:${custom.name.trim()}`, name: custom.name.trim(), category: "CUSTOM", sku: "", unit: "Nos", sell: Number(custom.price), active: true }); }} className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white">Next</button>
                </div>
              ) : <button onClick={() => setCustom({ name: "", price: "" })} className="text-sm font-bold text-brand hover:underline">Not in the catalog? Enter a custom item</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** Costing & Invoices: the admin splits each album's sheets into priced lines; the total feeds the order and the invoices. */
export default function CostingPanel({ o, show, fail }: { o: Order; show: (m: string) => void; fail: (m: string) => void }) {
  const admin = isAdmin();
  const saved = costingOf(o);
  const [c, setC] = useState<Costing>(saved);
  const [dirty, setDirty] = useState(false);
  const [pick, setPick] = useState<{ pos: number; section?: string; replaceId?: string } | null>(null);
  const [extra, setExtra] = useState<Record<number, string[]>>({});
  const [mode, setMode] = useState<"all" | "each">("all");
  const [busy, setBusy] = useState(false);
  const [warn, setWarn] = useState(false);
  const fingerprint = JSON.stringify(o.costing ?? null);
  useEffect(() => { if (!dirty) setC(costingOf(o)); }, [fingerprint, o.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const albums = o.albums?.length ? o.albums : [{ title: "", size: o.size, orientation: "", sheets: o.pages, copies: 1 } as NonNullable<Order["albums"]>[number]];
  const names = albums.map((a, i) => albumName(a, i, o.couple ?? "", o.event));
  const finalized = !!o.costing?.finalized;
  const editable = admin && !finalized && !o.closed;
  const t = costTotals(c);
  const hasInvoices = INVOICES.some((i) => i.orderId === o.id && i.kind === "invoice");
  const upd = (p: Partial<Costing>) => { setC((x) => ({ ...x, ...p })); setDirty(true); };
  const setLine = (id: string, p: Partial<CostLine>) => upd({ lines: c.lines.map((l) => (l.id === id ? { ...l, ...p } : l)) });
  const addLine = (albumPos: number, l: Partial<CostLine>) => upd({ lines: [...c.lines, { id: newLineId(), albumPos, name: "", unit: "Nos", qty: 1, countsSheets: false, sell: 0, ...l }] });
  const mismatches = albums.map((a, i) => ({ i, have: allocated(c, i + 1), want: a.sheets })).filter((m) => m.have !== m.want);

  const run = async (f: () => Promise<{ ok: boolean; msg: string }>, after?: () => void) => {
    setBusy(true); const r = await f(); setBusy(false);
    if (r.ok) { show(r.msg); after?.(); } else fail(r.msg);
  };
  const save = () => run(() => saveCosting(o.id, c), () => setDirty(false));
  const finalize = async () => {
    if (dirty) { const r = await saveCosting(o.id, c); if (!r.ok) { fail(r.msg); return; } setDirty(false); }
    if (mismatches.length && !warn) { setWarn(true); return; }
    setWarn(false); await run(() => finalizeCosting(o.id));
  };

  return (
    <Panel title="Costing & Invoices" subtitle={finalized ? "Finalized: the order total below is what the customer is charged" : admin ? "Split each album's sheets into priced items, then finalize to set the order total" : "The admin splits the sheets and prices each album after intake"}
      action={finalized ? <Pill tone="green">Finalized · {inr(o.total)}</Pill> : o.costing ? <Pill tone="amber">Draft</Pill> : <Pill tone="slate">Pending</Pill>}>
      {!admin && !o.costing && <p className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-sub">Costing is pending. An admin will split the sheets, price each album and finalize the order total.</p>}
      {(admin || o.costing) && (
        <div className="space-y-6" data-testid="costing">
          {albums.map((a, i) => {
            const pos = i + 1, have = allocated(c, pos), ok = have === a.sheets, lines = c.lines.filter((l) => l.albumPos === pos);
            const others = lines.filter((l) => !l.section);
            return (
              <section key={pos} aria-label={`Costing for ${names[i]}`} className="rounded-2xl border border-line p-4">
                <div className="mb-3 flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-extrabold">{names[i]}</h3>
                  <span className="text-xs text-sub">{a.size}{a.orientation ? ` · ${a.orientation}` : ""}{a.copies > 1 ? ` · ${a.copies} copies` : ""}</span>
                  <span className={cx("rounded-full px-2.5 py-0.5 text-[11px] font-bold", ok ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700")} data-testid={`alloc-${pos}`}>{have} / {a.sheets} sheets assigned</span>
                  <span className="ml-auto text-sm font-bold">{inr(t.albumSub.get(pos) ?? 0)}</span>
                </div>
                <AlbumPlanner pos={pos} totalSheets={a.sheets} lines={lines} editable={editable} admin={admin}
                  onSheets={(n) => void run(() => setAlbumSheets(o.id, pos, n))}
                  onChange={(id, p) => setLine(id, p)} onRemove={(id) => upd({ lines: c.lines.filter((x) => x.id !== id) })}
                  onPick={(section, replaceId) => setPick({ pos, section, replaceId })}
                  extraSections={extra[pos] ?? []} onAddSection={(name) => setExtra((x) => ({ ...x, [pos]: [...(x[pos] ?? []), name] }))} />
                <h4 className="mb-1 mt-5 text-xs font-extrabold uppercase tracking-wide text-sub">Other items (box, bag, USB…)</h4>
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="w-full min-w-[760px] text-[13px]">
                    <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-sub"><tr>
                      <th className="px-3 py-2 text-left">Item</th><th className="px-2 py-2 text-left">Qty</th><th className="px-2 py-2 text-left">Remarks</th><th className="px-2 py-2 text-left">Dimension</th>
                      <th className="px-2 py-2 text-left">Selling price</th>{admin && <th className="px-2 py-2 text-left">Purchase price</th>}<th className="px-3 py-2 text-right">Total</th><th /></tr></thead>
                    <tbody>
                      {others.map((l) => (
                        <tr key={l.id} className="border-t border-line">
                          <td className="px-3 py-1.5"><input aria-label="Item name" className={cx(cell, "w-full min-w-48")} value={l.name} disabled={!editable} onChange={(e) => setLine(l.id, { name: e.target.value })} />
                            {l.countsSheets && <label className="mt-1 flex items-center gap-1.5 text-[11px] text-sub"><input type="checkbox" disabled={!editable} checked={l.countsSheets} onChange={(e) => setLine(l.id, { countsSheets: e.target.checked })} />counts toward the album&apos;s sheets</label>}</td>
                          <td className="px-2 py-1.5"><input type="number" min={1} aria-label={`Quantity of ${l.name || "item"}`} className={cx(cell, "w-20")} value={l.qty} disabled={!editable} onChange={(e) => setLine(l.id, { qty: Number(e.target.value) })} /></td>
                          <td className="px-2 py-1.5"><input aria-label="Remarks" className={cx(cell, "w-32")} value={l.remarks ?? ""} disabled={!editable} onChange={(e) => setLine(l.id, { remarks: e.target.value })} /></td>
                          <td className="px-2 py-1.5"><input aria-label="Dimension" className={cx(cell, "w-28")} value={l.dimension ?? ""} disabled={!editable} onChange={(e) => setLine(l.id, { dimension: e.target.value })} /></td>
                          <td className="px-2 py-1.5"><input type="number" min={0} aria-label={`Selling price of ${l.name || "item"}`} className={cx(cell, "w-24")} value={l.sell} disabled={!editable} onChange={(e) => setLine(l.id, { sell: Number(e.target.value) })} /></td>
                          {admin && <td className="px-2 py-1.5"><input type="number" min={0} aria-label={`Purchase price of ${l.name || "item"}`} className={cx(cell, "w-24")} value={l.cost ?? ""} disabled={!editable} onChange={(e) => setLine(l.id, { cost: e.target.value === "" ? undefined : Number(e.target.value) })} /></td>}
                          <td className="px-3 py-1.5 text-right font-bold">{inr(l.qty * l.sell)}</td>
                          <td className="px-2 py-1.5">{editable && <button aria-label={`Remove ${l.name || "item"}`} onClick={() => upd({ lines: c.lines.filter((x) => x.id !== l.id) })} className="text-sub hover:text-rose-600"><Trash2 className="size-4" /></button>}</td>
                        </tr>
                      ))}
                      {!others.length && <tr><td colSpan={admin ? 8 : 7} className="px-3 py-4 text-center text-xs text-sub">{editable ? "None. Add a box, bag, USB or anything else that is not a sheet." : "None."}</td></tr>}
                    </tbody>
                  </table>
                </div>
                {editable && <div className="mt-2 flex gap-2">
                  <button onClick={() => setPick({ pos })} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-brand px-3 text-[13px] font-bold text-white hover:bg-brand-dark"><Plus className="size-4" />Add from catalog</button>
                  <button onClick={() => addLine(pos, {})} className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-[13px] font-bold hover:bg-brand-soft">Add custom item</button>
                </div>}
              </section>
            );
          })}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {([["Design charge (₹)", "designCharge"], ["Images to colour-grade", "gradingImages"], ["Grading rate (₹ / image)", "gradingRate"], ["Discount %", "discountPct"], ["GST %", "gstPct"]] as const).map(([label, k]) => (
              <label key={k} className="text-xs font-bold">{label}<input type="number" min={0} aria-label={label} className={cx(cell, "mt-1 w-full")} value={c[k]} disabled={!editable} onChange={(e) => upd({ [k]: Number(e.target.value) } as Partial<Costing>)} /></label>
            ))}
          </div>

          <div className="ml-auto max-w-sm rounded-2xl border border-line bg-slate-50 p-4 text-sm" data-testid="costing-totals">
            {[["Albums", t.lines], ["Design charge", t.design], ["Colour grading", t.grading]].map(([k, v]) => <div key={String(k)} className="flex justify-between py-0.5"><span className="text-sub">{k}</span><span className="font-semibold">{inr(Number(v))}</span></div>)}
            <div className="flex justify-between border-t border-line py-1"><span className="text-sub">Subtotal</span><b>{inr(t.sub)}</b></div>
            {t.discount > 0 && <div className="flex justify-between py-0.5 text-emerald-700"><span>Discount ({c.discountPct}%)</span><b>−{inr(t.discount)}</b></div>}
            <div className="flex justify-between py-0.5"><span className="text-sub">GST ({c.gstPct}%)</span><b>{inr(t.tax)}</b></div>
            <div className="mt-1 flex justify-between border-t-2 border-ink/10 pt-2 text-base"><b>Total</b><b className="text-brand">{inr(t.total)}</b></div>
          </div>

          {warn && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{mismatches.map((m) => `${names[m.i]}: ${m.have} of ${m.want} sheets assigned`).join(" · ")}. Finalize anyway?
            <button onClick={() => void finalize()} className="ml-3 rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white">Finalize anyway</button><button onClick={() => setWarn(false)} className="ml-2 text-xs font-bold">Keep editing</button></p>}

          {editable && <div className="flex flex-wrap justify-end gap-2">
            <button disabled={busy || !dirty} onClick={() => void save()} className="h-10 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft disabled:opacity-40">Save costing</button>
            <button disabled={busy || !c.lines.length} onClick={() => void finalize()} className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-40">Finalize costing</button>
          </div>}
          {admin && finalized && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <b>Generate invoice</b>
                <label className="flex items-center gap-2"><input type="radio" name="inv-mode" checked={mode === "all"} onChange={() => setMode("all")} />One invoice for all albums</label>
                <label className="flex items-center gap-2"><input type="radio" name="inv-mode" checked={mode === "each"} onChange={() => setMode("each")} />One invoice per album</label>
              </div>
              <div className="flex gap-2">
                <button disabled={busy} onClick={() => void run(() => reopenCosting(o.id))} className="h-10 rounded-lg border border-line px-4 text-sm font-bold hover:bg-brand-soft disabled:opacity-40">Reopen costing</button>
                <button disabled={busy || hasInvoices} onClick={() => void run(() => generateInvoices(o.id, mode))} className="h-10 rounded-lg bg-brand px-4 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-40">{hasInvoices ? "Invoices created" : "Generate invoice(s)"}</button>
              </div>
            </div>
          )}
        </div>
      )}
      {pick !== null && (() => {
        const isSheet = !!pick.section, albumSheets = albums[pick.pos - 1]?.sheets ?? 0, left = Math.max(1, albumSheets - allocated(c, pick.pos));
        const prev = pick.replaceId ? c.lines.find((l) => l.id === pick.replaceId) : undefined;
        return <CatalogPicker onClose={() => setPick(null)} startPath={pick.section ? startPathFor(pick.section) : []} qtyLabel={isSheet ? "Sheets" : "Qty"} withRemarks={!isSheet}
          defaultQty={prev ? prev.qty : isSheet ? (pick.section === "Inside pages" ? left : 1) : 1}
          onAdd={(item, qty, remarks) => {
            const itemId = item.id.startsWith("custom:") ? undefined : item.id;
            const base = { itemId, name: item.name, unit: item.unit, qty, sell: item.sell, cost: item.cost, ...(isSheet ? { section: pick.section, countsSheets: true } : { remarks: remarks || undefined, countsSheets: countsSheetsFor(item.name) }) };
            if (pick.replaceId) setLine(pick.replaceId, base); else addLine(pick.pos, base);
            setPick(null);
          }} />;
      })()}
    </Panel>
  );
}
