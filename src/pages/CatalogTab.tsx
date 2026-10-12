import { useMemo, useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { Field, Pagination, Panel, Pill, PrimaryButton, SearchInput, SlideOver, Td, Th, Toggle, inputCls, tableCls, trCls, cx } from "../components/ui";
import { CATALOG, categoryOf, saveCatalog, type CatalogDraft, type CatalogItem } from "../lib/catalog";
import { downloadCsv, parseCsv } from "../lib/csv";
import { useStore } from "../lib/store";
import { inr } from "../lib/format";

/** Masters > Product Catalog (admin): the products New Order picks from; the sell price decides what the customer is charged. */
export default function CatalogTab({ show }: { show: (m: string) => void }) {
  useStore();                                       // re-render when the catalog changes
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("All");
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(25);
  const [edit, setEdit] = useState<{ id?: string; name: string; sku: string; unit: string; sell: string; cost: string; active: boolean } | null>(null);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const rows = useMemo(() => CATALOG.filter((c) => (cat === "All" || c.category === cat) && (!q.trim() || `${c.name} ${c.sku}`.toLowerCase().includes(q.trim().toLowerCase()))).sort((a, b) => a.name.localeCompare(b.name)), [q, cat, CATALOG.length, JSON.stringify(CATALOG)]); // eslint-disable-line react-hooks/exhaustive-deps
  const cats = ["All", ...[...new Set(CATALOG.map((c) => c.category))].sort()];
  const view = rows.slice((page - 1) * size, page * size);

  const open = (c?: CatalogItem) => { setErr(""); setEdit(c ? { id: c.id, name: c.name, sku: c.sku, unit: c.unit, sell: String(c.sell), cost: c.cost === undefined ? "" : String(c.cost), active: c.active } : { name: "", sku: "", unit: "Nos", sell: "", cost: "", active: true }); };
  const save = async () => {
    if (!edit) return;
    const sell = edit.sell.trim() === "" ? NaN : Number(edit.sell);
    const e = await saveCatalog([{ id: edit.id, name: edit.name, sku: edit.sku, unit: edit.unit, sell, cost: edit.cost.trim() === "" ? undefined : Number(edit.cost), active: edit.active }]);
    if (e) { setErr(e); return; }
    show(edit.id ? "Product updated" : "Product added"); setEdit(null);
  };
  const toggle = async (c: CatalogItem) => { const e = await saveCatalog([{ id: c.id, name: c.name, sku: c.sku, unit: c.unit, sell: c.sell, cost: c.cost, active: !c.active }]); show(e ?? `${c.name} ${c.active ? "deactivated" : "activated"}`); };
  const exportCsv = () => { downloadCsv("product-catalog.csv", [["Name", "SKU", "Unit", "Sell Price", "Expected Cost", "Status"], ...CATALOG.map((c) => [c.name, c.sku, c.unit, c.sell, c.cost ?? "", c.active ? "Active" : "Inactive"])]); show(`Exported ${CATALOG.length} products`); };
  const importCsv = async (f: File | undefined) => {
    if (!f) return;
    const data = parseCsv(await f.text()).filter((r) => r.some((c) => c.trim()));
    const head = (data[0] ?? []).map((h) => h.trim().toLowerCase());
    const body = /name/.test(head[0] ?? "") ? data.slice(1) : data;                    // a header row is optional
    const col = (names: string[], fallback: number) => { const i = head.findIndex((h) => names.some((n) => h.includes(n))); return i >= 0 ? i : fallback; };
    const iN = col(["name"], 0), iS = col(["sku"], 1), iU = col(["unit"], 2), iP = col(["sell", "price"], 3), iC = col(["cost"], 4), iT = col(["status"], 5);
    const money = (v: string | undefined) => (v === undefined || v.trim() === "" || v.trim() === "—" ? undefined : Number(v.replace(/[₹,\s]/g, "")));
    const drafts: CatalogDraft[] = body.map((r) => ({ name: r[iN] ?? "", sku: r[iS] ?? "", unit: r[iU] || "Nos", sell: money(r[iP]) ?? 0, cost: money(r[iC]), active: !/inactive/i.test(r[iT] ?? "") }));
    if (!drafts.length) { show("No products found in that file"); return; }
    const e = await saveCatalog(drafts);
    show(e ?? `Imported ${drafts.length} products`);
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div data-testid="catalog-tab">
      <Panel title="Product Catalog" subtitle="Products and prices used by New Order. Choosing a product there fills in its sell price; the total is calculated for you."
        action={<div className="flex flex-wrap items-center gap-2">
          <button onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-[13px] font-bold hover:bg-brand-soft"><Download className="size-4" />Export</button>
          <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-[13px] font-bold hover:bg-brand-soft"><Upload className="size-4" />Import CSV<input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="Import products CSV" onChange={(e) => void importCsv(e.target.files?.[0])} /></label>
          <PrimaryButton onClick={() => open()}>Add product</PrimaryButton>
        </div>}>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <SearchInput className="w-72" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search name or SKU…" />
          <div className="flex flex-wrap gap-1.5">{cats.map((c) => <button key={c} onClick={() => { setCat(c); setPage(1); }} className={cx("h-8 rounded-full border px-3 text-xs font-bold", cat === c ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{c}</button>)}</div>
        </div>
        <div className="overflow-x-auto">
          <table className={tableCls}>
            <thead><tr><Th>Name</Th><Th>SKU</Th><Th>Unit</Th><Th className="text-right">Sell price</Th><Th className="text-right">Expected cost</Th><Th>Status</Th><Th /></tr></thead>
            <tbody>
              {view.map((c) => (
                <tr key={c.id} className={trCls}>
                  <Td><b>{c.name}</b></Td><Td>{c.sku || "—"}</Td><Td>{c.unit}</Td>
                  <Td className="text-right font-semibold">{inr(c.sell)}</Td><Td className="text-right text-sub">{c.cost === undefined ? "—" : inr(c.cost)}</Td>
                  <Td><button onClick={() => void toggle(c)} aria-label={`${c.active ? "Deactivate" : "Activate"} ${c.name}`}><Pill tone={c.active ? "green" : "slate"}>{c.active ? "Active" : "Inactive"}</Pill></button></Td>
                  <Td><button onClick={() => open(c)} className="text-[13px] font-bold text-brand hover:underline" aria-label={`Edit ${c.name}`}>Edit</button></Td>
                </tr>
              ))}
              {!view.length && <tr><td colSpan={7} className="px-3 py-10 text-center text-sm text-sub">No products yet. Add one, or import your product list as a CSV (Name, SKU, Unit, Sell Price, Expected Cost, Status).</td></tr>}
            </tbody>
          </table>
        </div>
        <Pagination page={page} pageSize={size} total={rows.length} onPage={setPage} onPageSize={(n) => { setSize(n); setPage(1); }} noun="products" />
      </Panel>

      <SlideOver open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? "Edit product" : "Add product"}
        footer={<div className="flex gap-2"><button onClick={() => setEdit(null)} className="h-10 flex-1 rounded-lg border border-line text-sm font-bold">Cancel</button><button onClick={() => void save()} className="h-10 flex-1 rounded-lg bg-brand text-sm font-bold text-white">Save</button></div>}>
        {edit && (
          <div className="space-y-1">
            <Field label="Name" required hint={edit.name.trim() ? `Category: ${categoryOf(edit.name)}` : "Write it as CATEGORY-ITEM-VARIANT, e.g. PAPER-NT-125 GSM-GLOSSY"}><input aria-label="Product name" className={inputCls} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="SKU"><input className={inputCls} value={edit.sku} onChange={(e) => setEdit({ ...edit, sku: e.target.value })} /></Field>
              <Field label="Unit"><input className={inputCls} value={edit.unit} onChange={(e) => setEdit({ ...edit, unit: e.target.value })} /></Field>
              <Field label="Sell price (₹)" required><input aria-label="Sell price" type="number" min={0} className={inputCls} value={edit.sell} onChange={(e) => setEdit({ ...edit, sell: e.target.value })} /></Field>
              <Field label="Expected cost (₹)"><input aria-label="Expected cost" type="number" min={0} className={inputCls} value={edit.cost} onChange={(e) => setEdit({ ...edit, cost: e.target.value })} /></Field>
            </div>
            <label className="flex items-center gap-3 pt-2 text-sm"><Toggle on={edit.active} onChange={(v) => setEdit({ ...edit, active: v })} label="Active" />Active (available in New Order)</label>
            {err && <p className="pt-2 text-xs font-semibold text-rose-600" role="alert">{err}</p>}
          </div>
        )}
      </SlideOver>
    </div>
  );
}
