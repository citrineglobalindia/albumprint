import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, FolderPlus, ListTree, Library, Pencil, Plus, Sparkles, Trash2, Upload } from "lucide-react";
import { Field, LineTabs, PageHeader, Panel, Pill, SlideOver, Td, Th, Toggle, cx, inputCls, tableCls, trCls } from "../components/ui";
import { useToast } from "../components/Toast";
import { PriceGrid } from "../components/PriceGrid";
import { useConfirm } from "../components/ConfirmDialog";
import "../lib/orders2";                                   // registers which items are on finalized orders (delete protection in demo mode)
import { useStore } from "../lib/store";
import { backendOn } from "../lib/supabase";
import { LAMINATION, PAPER, SIZES } from "../lib/pricing";
import {
  CATEGORIES, ITEMS, KIND_LABEL, MAX_DEPTH, METHOD_LABEL, RATES, SCOPE_LABEL, categoryById, childrenOf, descendantsOf, deleteCategory, deleteItem, branchSummary, importClassic, importProductList, itemsIn, loadCatalog2, loadSampleCatalog, pathLabel, pricingSettings,
  removeRate, saveCategory, saveItem, savePricingSettings, saveRate, seedDemoCatalog, type CItem, type Category, type OptionKind, type PricingMethod,
} from "../lib/catalog2";
import { scopeOf } from "../lib/orderPricing";

const LEVEL = ["Category", "Subcategory", "Level 3", "Level 4"];
const fmt = (n: number | null) => (n == null ? "—" : `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })}`);

export default function CatalogAdmin() {
  useStore();
  const [tab, setTab] = useState<"tree" | "prices" | "settings">("tree");
  const [sel, setSel] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [catForm, setCatForm] = useState<{ id?: string; parentId: string | null; name: string; sort: number; active: boolean } | null>(null);
  const [itemForm, setItemForm] = useState<Partial<CItem> & { categoryId: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, confirm] = useConfirm();
  const askDeleteCategory = (c: Category) => {
    const b = branchSummary(c.id);
    const what = [b.categories > 1 && `${b.categories - 1} sub-categor${b.categories - 1 === 1 ? "y" : "ies"}`, b.items && `${b.items} item(s) and their rates`].filter(Boolean).join(" and ");
    if (b.used) { show(`“${c.name}” holds ${b.used} item(s) used on existing orders, so it cannot be deleted — switch it off (Inactive) instead`); return; }
    confirm({ title: `Delete “${c.name}”?`, message: `${pathLabel(c.id)}${what ? ` — this also deletes ${what}` : ""}. Saved drafts that use these items will ask for a replacement. This cannot be undone.`, confirmLabel: "Delete", danger: true },
      async () => { const e = await deleteCategory(c.id); if (e) { show(e); return; } setSel(c.parentId); show(`“${c.name}” deleted`); });
  };
  const askDeleteItem = (i: CItem) => confirm({ title: `Delete “${i.name}”?`, message: `${pathLabel(i.categoryId)} ▸ ${i.name}${RATES.some((r) => r.itemId === i.id) ? " and its rate rules" : ""}. Saved drafts that use it will ask for a replacement. This cannot be undone.`, confirmLabel: "Delete", danger: true },
    async () => { const e = await deleteItem(i.id); show(e ?? `“${i.name}” deleted`); });
  const [toast, show] = useToast();
  useEffect(() => { seedDemoCatalog(); void loadCatalog2().then((e) => e && setErr(e)); }, []);
  const cur = categoryById(sel);

  const move = async (c: Category, dir: -1 | 1) => {
    const sibs = childrenOf(c.parentId); const i = sibs.findIndex((x) => x.id === c.id), j = i + dir;
    if (j < 0 || j >= sibs.length) return;
    const order = [...sibs]; [order[i], order[j]] = [order[j]!, order[i]!];
    for (const [k, s] of order.entries()) if (s.sort !== k + 1) { const r = await saveCategory({ ...s, sort: k + 1 }); if ("error" in r) { show(r.error); return; } }
  };
  const Node = ({ c }: { c: Category }) => {
    const kids = childrenOf(c.id), isOpen = open[c.id] ?? c.depth < 2;
    return (
      <li>
        <div className={cx("group flex items-center gap-1 rounded-lg px-1.5 py-1", sel === c.id ? "bg-brand-soft" : "hover:bg-slate-50")}>
          <button aria-label={isOpen ? `Collapse ${c.name}` : `Expand ${c.name}`} onClick={() => setOpen({ ...open, [c.id]: !isOpen })} className={cx("grid size-6 place-items-center rounded text-sub", !kids.length && "invisible")}>{isOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}</button>
          <button onClick={() => setSel(c.id)} className={cx("min-w-0 flex-1 truncate text-left text-[13px] font-semibold", !c.active && "text-sub line-through")} data-testid={`cat-${c.name}`}>{c.name}</button>
          {c.sample && <Pill tone="amber" className="!px-1.5 !py-0 text-[10px]">Sample</Pill>}
          <span className="text-[10px] text-sub">{itemsIn(c.id).length || ""}</span>
          <span className="hidden gap-0.5 group-hover:flex">
            <button aria-label={`Move ${c.name} up`} onClick={() => void move(c, -1)} className="grid size-6 place-items-center rounded hover:bg-white"><ArrowUp className="size-3.5" /></button>
            <button aria-label={`Move ${c.name} down`} onClick={() => void move(c, 1)} className="grid size-6 place-items-center rounded hover:bg-white"><ArrowDown className="size-3.5" /></button>
          </span>
        </div>
        {isOpen && kids.length > 0 && <ul className="ml-4 border-l border-line pl-1">{kids.map((k) => <Node key={k.id} c={k} />)}</ul>}
      </li>
    );
  };

  return (
    <div>
      <PageHeader title="Catalog & pricing" subtitle="Categories, items and rates used by the order builder. Nothing is priced unless it is configured here." icon={<span className="mt-1 grid size-10 place-items-center rounded-xl bg-brand-soft text-brand"><Library className="size-5" aria-hidden /></span>}>
        <button disabled={busy} onClick={async () => { setBusy(true); const r = await importProductList(); setBusy(false); if (typeof r === "string") show(r); else { show(r ? `Product list imported — ${r} item(s) added. Enter their prices in the Prices tab.` : "The product list is already in the catalog"); setTab("prices"); } }} className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-3 text-[13px] font-bold text-white hover:bg-brand-dark disabled:opacity-50"><ListTree className="size-4" />{busy ? "Importing…" : "Import product list"}</button>
        <button onClick={async () => { const e = await loadSampleCatalog(); show(e ?? "Sample catalog added (demonstration prices, labelled “Sample”)"); }} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-bold hover:bg-brand-soft"><Sparkles className="size-4" />Add sample catalog</button>
        {backendOn && <button onClick={async () => { const r = await importClassic(); show(typeof r === "string" ? r : `${r} item(s) copied from the classic catalog`); }} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-[13px] font-bold hover:bg-brand-soft"><Upload className="size-4" />Import classic catalog</button>}
      </PageHeader>
      {err && <p role="alert" className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm font-semibold text-rose-700">Could not load the catalog: {err}</p>}
      <LineTabs className="mb-5" value={tab} onChange={setTab} tabs={[{ key: "tree", label: "Categories & items" }, { key: "prices", label: "Prices" }, { key: "settings", label: "Tax & defaults" }]} />
      {tab === "settings" ? <SettingsCard show={show} /> : tab === "prices" ? <PriceGrid show={show} /> : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,330px)_minmax(0,1fr)]">
          <Panel title="Hierarchy" subtitle={`Up to ${MAX_DEPTH} levels · items can sit at any level`} action={<button onClick={() => setCatForm({ parentId: null, name: "", sort: childrenOf(null).length + 1, active: true })} className="inline-flex items-center gap-1 text-xs font-bold text-brand hover:underline"><FolderPlus className="size-4" />Category</button>}>
            {CATEGORIES.length ? <ul className="-mx-1 max-h-[65vh] overflow-y-auto scroll-thin" data-testid="cat-tree">{childrenOf(null).map((c) => <Node key={c.id} c={c} />)}</ul>
              : <p className="py-6 text-center text-sm text-sub">No categories yet. Add one, or use “Add sample catalog”.</p>}
          </Panel>
          <div className="min-w-0 space-y-5">
            {!cur ? <Panel title="Select a category"><p className="text-sm text-sub">Choose a category on the left to see and edit its sub-categories and items.</p></Panel> : (
              <>
                <Panel title={pathLabel(cur.id)} subtitle={`${LEVEL[cur.depth - 1]} · ${cur.active ? "Active" : "Inactive (hidden from new orders; existing orders keep their prices)"}`}
                  action={<div className="flex gap-2">
                    <button onClick={() => setCatForm({ id: cur.id, parentId: cur.parentId, name: cur.name, sort: cur.sort, active: cur.active })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft"><Pencil className="size-3.5" />Edit</button>
                    {cur.depth < MAX_DEPTH && <button onClick={() => setCatForm({ parentId: cur.id, name: "", sort: childrenOf(cur.id).length + 1, active: true })} className="inline-flex h-8 items-center gap-1 rounded-lg border border-line px-2.5 text-xs font-bold hover:bg-brand-soft"><FolderPlus className="size-3.5" />Add {LEVEL[cur.depth]?.toLowerCase()}</button>}
                    <button aria-label={`Delete category ${cur.name}`} onClick={() => askDeleteCategory(cur)} className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 px-2.5 text-xs font-bold text-rose-600 hover:bg-rose-50"><Trash2 className="size-3.5" />Delete</button>
                  </div>}>
                  <div className="flex flex-wrap gap-2 text-xs">{childrenOf(cur.id).map((k) => <button key={k.id} onClick={() => setSel(k.id)} className={cx("rounded-full border border-line px-3 py-1 font-semibold hover:bg-brand-soft", !k.active && "text-sub line-through")}>{k.name}</button>)}
                    {!childrenOf(cur.id).length && <span className="text-sub">No sub-categories (that is fine — levels are optional).</span>}</div>
                </Panel>
                <Panel title="Items" subtitle="Each item has its own pricing method and rate" bodyClassName="p-0"
                  action={<button onClick={() => setItemForm({ categoryId: cur.id, method: "per_unit", unit: "pcs", active: true })} className="inline-flex h-8 items-center gap-1 rounded-lg bg-brand px-3 text-xs font-bold text-white hover:bg-brand-dark"><Plus className="size-3.5" />Add item</button>}>
                  <div className="overflow-x-auto"><table className={tableCls} data-testid="item-table">
                    <thead className="bg-slate-50"><tr><Th>Item</Th><Th>Code</Th><Th>Pricing</Th><Th className="text-right">Rate</Th><Th>Unit</Th><Th>Rules</Th><Th>Status</Th><Th /></tr></thead>
                    <tbody>{itemsIn(cur.id).map((i) => (
                      <tr key={i.id} className={trCls} data-testid={`item-${i.name}`}>
                        <Td className="font-semibold">{i.name}{i.kind && <Pill tone="indigo" className="ml-2 !py-0 text-[10px]">{KIND_LABEL[i.kind]}</Pill>}{i.sample && <Pill tone="amber" className="ml-1 !py-0 text-[10px]">Sample</Pill>}</Td>
                        <Td className="text-sub">{i.code ?? "—"}</Td><Td className="text-xs">{METHOD_LABEL[i.method]}</Td><Td className="text-right tabular-nums">{fmt(i.rate)}</Td><Td>{i.unit}</Td>
                        <Td>{RATES.filter((r) => r.itemId === i.id).length || "—"}</Td><Td><Pill tone={i.active ? "green" : "slate"}>{i.active ? "Active" : "Inactive"}</Pill></Td>
                        <Td className="whitespace-nowrap"><button aria-label={`Edit ${i.name}`} onClick={() => setItemForm({ ...i })} className="text-xs font-bold text-brand hover:underline">Edit</button>
                          <button aria-label={`Delete ${i.name}`} onClick={() => askDeleteItem(i)} className="ml-3 align-middle text-rose-600 hover:text-rose-700"><Trash2 className="inline size-4" /></button></Td>
                      </tr>))}
                      {!itemsIn(cur.id).length && <tr><td colSpan={8} className="p-6 text-center text-sm text-sub">No items directly in this category.</td></tr>}
                    </tbody>
                  </table></div>
                </Panel>
              </>
            )}
          </div>
        </div>
      )}
      {catForm && <CategoryForm f={catForm} onClose={() => setCatForm(null)} onSaved={(id, m) => { setCatForm(null); setSel(id); show(m); }} />}
      {itemForm && <ItemForm f={itemForm} onClose={() => setItemForm(null)} onSaved={(m) => { show(m); }} />}
      {dialog}
      {toast}
    </div>
  );
}

function CategoryForm({ f: init, onClose, onSaved }: { f: { id?: string; parentId: string | null; name: string; sort: number; active: boolean }; onClose: () => void; onSaved: (id: string, m: string) => void }) {
  const [f, setF] = useState(init); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const blocked = new Set(init.id ? [init.id, ...descendantsOf(init.id)] : []);
  const parents = CATEGORIES.filter((c) => !blocked.has(c.id) && c.depth < MAX_DEPTH).sort((a, b) => pathLabel(a.id).localeCompare(pathLabel(b.id)));
  const save = async () => { setBusy(true); const r = await saveCategory(f); setBusy(false); if ("error" in r) setMsg(r.error); else onSaved(r.id, init.id ? "Category saved" : "Category added"); };
  return (
    <SlideOver open title={init.id ? "Edit category" : "New category"} onClose={onClose} footer={<><button onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-bold hover:bg-slate-100">Cancel</button><button disabled={busy} onClick={() => void save()} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60">Save category</button></>}>
      <Field label="Parent category" hint="Leave as “None” for a top-level category. A category cannot move under itself."><select aria-label="Parent category" className={inputCls} value={f.parentId ?? ""} onChange={(e) => setF({ ...f, parentId: e.target.value || null })}>
        <option value="">None (top level)</option>{parents.map((c) => <option key={c.id} value={c.id}>{pathLabel(c.id)}</option>)}</select></Field>
      <Field label="Name" required><input aria-label="Category name" className={inputCls} value={f.name} maxLength={100} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Display order"><input aria-label="Display order" type="number" min={0} className={inputCls} value={f.sort} onChange={(e) => setF({ ...f, sort: Number(e.target.value) })} /></Field>
      <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3"><div><div className="text-sm font-bold">Active</div><div className="text-xs text-sub">Inactive categories (and everything under them) are hidden from new orders. Existing orders are unaffected.</div></div><Toggle label="Active" on={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
      {msg && <p role="alert" className="mt-3 text-sm font-semibold text-rose-600">{msg}</p>}
    </SlideOver>
  );
}

const ANY = "";
function ItemForm({ f: init, onClose, onSaved }: { f: Partial<CItem> & { categoryId: string }; onClose: () => void; onSaved: (m: string) => void }) {
  useStore();
  const [f, setF] = useState({ ...init, rateText: init.rate == null ? "" : String(init.rate) });
  const [id, setId] = useState(init.id); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [rule, setRule] = useState({ size: ANY, paper: ANY, finish: ANY, rate: "" }); const [ruleMsg, setRuleMsg] = useState("");
  const cats = useMemo(() => CATEGORIES.slice().sort((a, b) => pathLabel(a.id).localeCompare(pathLabel(b.id))), []);
  const rules = RATES.filter((r) => r.itemId === id);
  const save = async () => {
    setBusy(true); setMsg("");
    const rate = f.rateText.trim() === "" ? null : Number(f.rateText);
    if (rate != null && !Number.isFinite(rate)) { setBusy(false); setMsg("Enter the rate as a number (or leave it empty to price only by rules)"); return; }
    const r = await saveItem({ ...f, id, rate, method: (f.method ?? "per_unit") as PricingMethod, name: f.name ?? "", unit: f.unit ?? "pcs", kind: (f.kind || undefined) as OptionKind | undefined });
    setBusy(false);
    if ("error" in r) { setMsg(r.error); return; }
    setId(r.id); onSaved(id ? "Item saved" : "Item added — you can now add rate rules");
  };
  const addRule = async () => {
    if (!id) return; setRuleMsg("");
    const e = await saveRate({ itemId: id, size: rule.size, paper: rule.paper, finish: rule.finish, rate: rule.rate.trim() === "" ? NaN : Number(rule.rate) });
    if (e) setRuleMsg(e); else setRule({ size: ANY, paper: ANY, finish: ANY, rate: "" });
  };
  const scope = scopeOf((f.method ?? "per_unit") as PricingMethod);
  return (
    <SlideOver open width={560} title={id ? `Edit item${f.sample ? " (sample)" : ""}` : "New item"} onClose={onClose} footer={<><button onClick={onClose} className="h-10 rounded-lg px-4 text-sm font-bold hover:bg-slate-100">Close</button><button disabled={busy} onClick={() => void save()} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark disabled:opacity-60">Save item</button></>}>
      <Field label="Category" required hint="Items can belong to any level."><select aria-label="Item category" className={inputCls} value={f.categoryId} onChange={(e) => setF({ ...f, categoryId: e.target.value })}>{cats.map((c) => <option key={c.id} value={c.id}>{pathLabel(c.id)}</option>)}</select></Field>
      <div className="grid grid-cols-[1fr_140px] gap-3">
        <Field label="Item name" required><input aria-label="Item name" className={inputCls} value={f.name ?? ""} maxLength={150} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        <Field label="Code"><input aria-label="Item code" className={inputCls} value={f.code ?? ""} maxLength={40} onChange={(e) => setF({ ...f, code: e.target.value })} /></Field>
      </div>
      <Field label="Description"><textarea aria-label="Description" className="h-16 w-full rounded-lg border border-line p-3 text-sm outline-none focus:border-brand" value={f.description ?? ""} maxLength={500} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Pricing method" required hint={`Charged ${SCOPE_LABEL[scope].toLowerCase()}`}><select aria-label="Pricing method" className={inputCls} value={f.method ?? "per_unit"} onChange={(e) => setF({ ...f, method: e.target.value as PricingMethod })}>{(Object.keys(METHOD_LABEL) as PricingMethod[]).map((m) => <option key={m} value={m}>{METHOD_LABEL[m]}</option>)}</select></Field>
        <Field label="Use as" hint="Printing/design are added to every album automatically"><select aria-label="Use as" className={inputCls} value={f.kind ?? ""} onChange={(e) => setF({ ...f, kind: (e.target.value || undefined) as OptionKind | undefined })}><option value="">Extra item</option>{(Object.keys(KIND_LABEL) as OptionKind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}</select></Field>
        <Field label="Standard rate (₹)" hint="Leave empty to price only through the rules below"><input aria-label="Standard rate" inputMode="decimal" className={inputCls} value={f.rateText} onChange={(e) => setF({ ...f, rateText: e.target.value })} placeholder="e.g. 120.50" /></Field>
        <Field label="Unit" required><input aria-label="Unit" className={inputCls} value={f.unit ?? ""} maxLength={20} onChange={(e) => setF({ ...f, unit: e.target.value })} placeholder="pcs, sheet, album" /></Field>
        <Field label="Display order"><input aria-label="Item display order" type="number" className={inputCls} value={f.sort ?? 0} onChange={(e) => setF({ ...f, sort: Number(e.target.value) })} /></Field>
        <div className="mb-4 flex items-end justify-between rounded-xl border border-line px-3 py-2"><span className="text-sm font-bold">Active</span><Toggle label="Item active" on={f.active ?? true} onChange={(v) => setF({ ...f, active: v })} /></div>
      </div>
      {msg && <p role="alert" className="mb-3 text-sm font-semibold text-rose-600">{msg}</p>}
      <div className="mt-2 rounded-xl border border-line p-4" data-testid="rate-rules">
        <div className="mb-1 text-sm font-extrabold">Rates by requirement</div>
        <p className="mb-3 text-xs text-sub">A different rate for a size, paper or finish (or a combination). The most specific matching rule is used; otherwise the standard rate; otherwise the order shows “Price not configured”.</p>
        {!id ? <p className="text-xs text-sub">Save the item first.</p> : (
          <>
            <table className={cx(tableCls, "mb-3")}><thead><tr><Th>Size</Th><Th>Paper</Th><Th>Finish</Th><Th className="text-right">Rate</Th><Th /></tr></thead>
              <tbody>{rules.map((r) => <tr key={r.id} className={trCls}><Td>{r.size ?? "Any"}</Td><Td>{r.paper ?? "Any"}</Td><Td>{r.finish ?? "Any"}</Td><Td className="text-right tabular-nums">{fmt(r.rate)}</Td>
                <Td><button aria-label="Remove rule" onClick={() => void removeRate(r.id)} className="text-rose-600"><Trash2 className="size-4" /></button></Td></tr>)}
                {!rules.length && <tr><td colSpan={5} className="py-3 text-center text-xs text-sub">No rules — the standard rate applies to every combination.</td></tr>}</tbody></table>
            <div className="grid grid-cols-[1fr_1fr_1fr_100px_auto] items-end gap-2">
              <select aria-label="Rule size" className={inputCls} value={rule.size} onChange={(e) => setRule({ ...rule, size: e.target.value })}><option value={ANY}>Any size</option>{SIZES.map((s) => <option key={s}>{s}</option>)}</select>
              <select aria-label="Rule paper" className={inputCls} value={rule.paper} onChange={(e) => setRule({ ...rule, paper: e.target.value })}><option value={ANY}>Any paper</option>{Object.keys(PAPER).map((s) => <option key={s}>{s}</option>)}</select>
              <select aria-label="Rule finish" className={inputCls} value={rule.finish} onChange={(e) => setRule({ ...rule, finish: e.target.value })}><option value={ANY}>Any finish</option>{Object.keys(LAMINATION).map((s) => <option key={s}>{s}</option>)}</select>
              <input aria-label="Rule rate" inputMode="decimal" className={inputCls} value={rule.rate} onChange={(e) => setRule({ ...rule, rate: e.target.value })} placeholder="₹" />
              <button onClick={() => void addRule()} className="h-10 rounded-lg border border-line px-3 text-sm font-bold hover:bg-brand-soft">Add</button>
            </div>
            {ruleMsg && <p role="alert" className="mt-2 text-xs font-semibold text-rose-600">{ruleMsg}</p>}
          </>
        )}
      </div>
    </SlideOver>
  );
}

function SettingsCard({ show }: { show: (m: string) => void }) {
  useStore();
  const [s, setS] = useState(pricingSettings()); const [msg, setMsg] = useState("");
  const save = async () => { setMsg(""); const e = await savePricingSettings({ ...s, taxRate: Number(s.taxRate), defaultDeliveryDays: Number(s.defaultDeliveryDays) }); if (e) setMsg(e); else show("Pricing settings saved"); };
  return (
    <Panel title="Tax & defaults" subtitle="Tax is optional. When it is on, it is charged on the amount after discount and rounded to the paisa." className="max-w-2xl">
      <div className="mb-4 flex items-center justify-between rounded-xl border border-line px-4 py-3"><div><div className="text-sm font-bold">Charge tax on orders</div><div className="text-xs text-sub">No rate is assumed — set your own.</div></div><Toggle label="Charge tax" on={s.taxEnabled} onChange={(v) => setS({ ...s, taxEnabled: v })} /></div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Tax label"><input aria-label="Tax label" className={inputCls} value={s.taxLabel} maxLength={30} onChange={(e) => setS({ ...s, taxLabel: e.target.value })} placeholder="GST" /></Field>
        <Field label="Tax rate (%)"><input aria-label="Tax rate" inputMode="decimal" className={inputCls} value={s.taxRate} onChange={(e) => setS({ ...s, taxRate: e.target.value as unknown as number })} /></Field>
        <Field label="Default delivery (days after order)" hint="Used when an order has no delivery date"><input aria-label="Default delivery days" type="number" min={0} max={365} className={inputCls} value={s.defaultDeliveryDays} onChange={(e) => setS({ ...s, defaultDeliveryDays: Number(e.target.value) })} /></Field>
      </div>
      {msg && <p role="alert" className="mb-3 text-sm font-semibold text-rose-600">{msg}</p>}
      <button onClick={() => void save()} className="h-10 rounded-lg bg-brand px-5 text-sm font-bold text-white hover:bg-brand-dark">Save settings</button>
    </Panel>
  );
}
