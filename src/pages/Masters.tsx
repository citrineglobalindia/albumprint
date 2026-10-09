import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Copy, Download, LayoutGrid, Pencil, Plus, ChevronRight, Power, Trash2, Upload } from "lucide-react";
import { useRef } from "react";
import { RowMenu } from "../components/RowMenu";
import { useConfirm } from "../components/ConfirmDialog";
import { Field, FilterSelect, LineTabs, Pagination, Panel, PageHeader, Pill, PrimaryButton, SearchInput, SlideOver, Td, Th, Thumb, Toggle, inputCls, tableCls, trCls, cx } from "../components/ui";
import { useToast } from "../components/Toast";
import { downloadCsv, parseCsv } from "../lib/csv";
import { inr } from "../lib/format";

const TABS = ["Album Products", "Printing Options", "Materials", "Event Types", "Cover Types", "Box Types", "Design Styles", "Other Masters"] as const;
type Tab = (typeof TABS)[number];

interface Product { id: string; name: string; category: string; size: string; sheets: number; price: number; active: boolean }
interface Item { id: string; name: string; detail: string; price?: number; active: boolean }

const CATS = ["Premium Albums", "Standard Albums", "Magnetic Albums", "Acrylic Albums", "Photobooks", "Flush Mount Albums", "Layflat Albums", "Parents Albums"];
const P: [string, string, string, number, number, boolean][] = [
  ["Premium Album", "Premium Albums", "12x36", 60, 8500, true], ["Classic Album", "Standard Albums", "12x30", 50, 6200, true],
  ["Magnetic Album", "Magnetic Albums", "14x10", 50, 10500, true], ["Acrylic Album", "Acrylic Albums", "12x18", 45, 12000, true],
  ["Photobook", "Photobooks", "10x10", 30, 3800, true], ["Layflat Album", "Layflat Albums", "12x36", 40, 9500, true],
  ["Flush Mount Album", "Premium Albums", "11x14", 40, 7800, false], ["Parents Album", "Standard Albums", "8x12", 25, 4200, true],
  ["Mini Album", "Photobooks", "6x8", 20, 2500, true], ["Designer Album", "Premium Albums", "12x30", 50, 9800, true],
];
const seedProducts: Product[] = P.map(([name, category, size, sheets, price, active], i) => ({ id: `PRD${String(i + 1).padStart(3, "0")}`, name, category, size, sheets, price, active }));

const mk = (names: [string, string][], priced = false): Item[] => names.map(([name, detail], i) => ({ id: `M${i + 1}`, name, detail, price: priced ? 500 + i * 250 : undefined, active: true }));
const SEED: Record<Exclude<Tab, "Album Products" | "Other Masters">, Item[]> = {
  "Printing Options": mk([["Silk", "Paper type"], ["Metallic", "Paper type"], ["Matte", "Paper type"], ["Glossy", "Paper type"], ["Velvet", "Paper type"], ["Fine Art", "Paper type"]], true),
  Materials: mk([["Leatherette", "Cover material"], ["Acrylic", "Cover material"], ["Photo Wrap", "Cover material"], ["Fabric", "Cover material"], ["Wood", "Cover material"]], true),
  "Event Types": mk([["Wedding", "Order category"], ["Reception", "Order category"], ["Engagement", "Order category"], ["Baby", "Order category"], ["Corporate", "Order category"], ["Pre Wedding", "Order category"]]),
  "Cover Types": mk([["Acrylic", "Hard cover"], ["Leatherette", "Hard cover"], ["Photo Wrap", "Printed wrap"], ["Fabric", "Soft cover"], ["Custom", "On request"]], true),
  "Box Types": mk([["Standard", "Cardboard"], ["Premium", "Rigid box"], ["Wooden", "Teak finish"], ["Acrylic", "Clear case"], ["Custom", "On request"]], true),
  "Design Styles": mk([["Classic", "Traditional spreads"], ["Candid / Magazine", "Editorial layouts"], ["Minimal", "White space focus"], ["Cinematic", "Full-bleed spreads"]]),
};
const OTHER = ["Paper GSM", "Lamination", "Binding Type", "QC Defects", "Delivery Modes", "Priorities"] as const;
const OTHER_SEED: Record<(typeof OTHER)[number], string[]> = {
  "Paper GSM": ["200", "250", "300", "350"], Lamination: ["Matte", "Gloss", "Texture", "None"], "Binding Type": ["Lay-flat", "Flush mount", "Standard", "Custom"],
  "QC Defects": ["Colour shift", "Misalignment", "Scratches", "Missing page", "Binding defect"], "Delivery Modes": ["Pickup", "Courier", "Hand delivery", "Studio dispatch"], Priorities: ["Low", "Normal", "High", "Urgent", "VIP"],
};

type Errs = { name?: string; price?: string; sheets?: string };
const ERR = "mt-1 block text-xs font-semibold text-rose-600";
const GHOST = "inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-[13px] font-bold hover:bg-brand-soft";

export default function Masters() {
  const [tab, setTab] = useState<Tab>("Album Products");
  const [products, setProducts] = useState<Product[]>(seedProducts);
  const [items, setItems] = useState(SEED);
  const [other, setOther] = useState<Record<string, Item[]>>(() => Object.fromEntries(OTHER.map((k) => [k, OTHER_SEED[k].map((n, i) => ({ id: `${k}${i}`, name: n, detail: k, active: true }))])));
  const [otherKey, setOtherKey] = useState<(typeof OTHER)[number]>("Paper GSM");
  const [cat, setCat] = useState("All Categories");
  const [q, setQ] = useState("");
  const [fCat, setFCat] = useState("All Categories");
  const [fStatus, setFStatus] = useState("All Status");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [toast, show] = useToast();
  const [dialog, confirm] = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(1000);

  const [slide, setSlide] = useState<null | { kind: "product" | "item"; id: string | null }>(null);
  const [f, setF] = useState({ name: "", category: CATS[0]!, size: "12x36", sheets: "40", price: "0", detail: "", active: true });
  const [errs, setErrs] = useState<Errs>({});

  const filtered = useMemo(() => products.filter((p) => {
    if (cat !== "All Categories" && p.category !== cat) return false;
    if (fCat !== "All Categories" && p.category !== fCat) return false;
    if (fStatus !== "All Status" && (p.active ? "Active" : "Inactive") !== fStatus) return false;
    const t = q.trim().toLowerCase();
    return !t || p.name.toLowerCase().includes(t) || p.id.toLowerCase().includes(t) || p.category.toLowerCase().includes(t);
  }), [products, cat, fCat, fStatus, q]);
  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, maxPage);
  const rows = filtered.slice((cur - 1) * pageSize, cur * pageSize);
  const cards = products.filter((p) => cat === "All Categories" || p.category === cat).slice(0, 6);
  const allOnPage = rows.length > 0 && rows.every((p) => sel.has(p.id));

  const changeTab = (t: Tab) => { setTab(t); setPage(1); setSel(new Set()); };
  const openProduct = (p?: Product) => {
    setErrs({});
    setF(p ? { name: p.name, category: p.category, size: p.size, sheets: String(p.sheets), price: String(p.price), detail: "", active: p.active } : { name: "", category: CATS[0]!, size: "12x36", sheets: "40", price: "0", detail: "", active: true });
    setSlide({ kind: "product", id: p?.id ?? null });
  };
  const openItem = (it?: Item) => {
    setErrs({});
    setF({ name: it?.name ?? "", category: CATS[0]!, size: "", sheets: "0", price: String(it?.price ?? ""), detail: it?.detail ?? "", active: it?.active ?? true });
    setSlide({ kind: "item", id: it?.id ?? null });
  };

  const curList = (): Item[] => (tab === "Other Masters" ? other[otherKey]! : items[tab as keyof typeof SEED]);
  const setCurList = (fn: (l: Item[]) => Item[]) => (tab === "Other Masters" ? setOther((o) => ({ ...o, [otherKey]: fn(o[otherKey]!) })) : setItems((o) => ({ ...o, [tab]: fn(o[tab as keyof typeof SEED]) })));
  const nextPid = () => `PRD${String(Math.max(0, ...products.map((p) => Number(p.id.slice(3)) || 0)) + 1).padStart(3, "0")}`;
  const hasPrice = tab !== "Other Masters" && tab !== "Event Types" && tab !== "Design Styles";
  const noun = tab === "Other Masters" ? otherKey : tab.replace(/s$/, "");

  const save = () => {
    const e: Errs = {};
    const name = f.name.trim();
    if (!name) e.name = "Name is required";
    if (slide?.kind === "product") {
      if (name && products.some((p) => p.id !== slide.id && p.name.toLowerCase() === name.toLowerCase())) e.name = "A product with this name already exists";
      if (f.price === "" || !(Number(f.price) >= 0)) e.price = "Enter a valid price (0 or more)";
      if (!(Number(f.sheets) > 0)) e.sheets = "Sheets must be at least 1";
    } else {
      if (name && curList().some((i) => i.id !== slide?.id && i.name.toLowerCase() === name.toLowerCase())) e.name = "This name already exists in the list";
      if (hasPrice && f.price !== "" && !(Number(f.price) >= 0)) e.price = "Enter a valid price";
    }
    setErrs(e);
    if (Object.keys(e).length) return;
    if (slide?.kind === "product") {
      const price = Number(f.price), sheets = Number(f.sheets);
      if (slide.id) setProducts((l) => l.map((p) => (p.id === slide.id ? { ...p, name, category: f.category, size: f.size, sheets, price, active: f.active } : p)));
      else { setProducts((l) => [...l, { id: nextPid(), name, category: f.category, size: f.size, sheets, price, active: f.active }]); setQ(""); setFCat("All Categories"); setFStatus("All Status"); setCat("All Categories"); setPage(Math.ceil((products.length + 1) / pageSize)); }
    } else {
      const price = f.price === "" ? undefined : Number(f.price);
      if (slide?.id) setCurList((l) => l.map((i) => (i.id === slide.id ? { ...i, name, detail: f.detail, price, active: f.active } : i)));
      else setCurList((l) => [...l, { id: `N${seq.current++}`, name, detail: f.detail || tab, price, active: f.active }]);
    }
    show(`${name} ${slide?.id ? "updated" : "added"}`);
    setSlide(null);
  };

  // ---- products ----
  const setProductActive = (ids: string[], active: boolean) => setProducts((l) => l.map((p) => (ids.includes(p.id) ? { ...p, active } : p)));
  const toggleProduct = (id: string) => setProducts((l) => l.map((p) => (p.id === id ? { ...p, active: !p.active } : p)));
  const dupProduct = (p: Product) => { setProducts((l) => [...l, { ...p, id: nextPid(), name: `${p.name} (Copy)` }]); show(`${p.name} duplicated`); };
  const delProducts = (ids: string[], label: string) => confirm({ title: "Delete product", message: `Delete ${label}? This cannot be undone.`, confirmLabel: "Delete", danger: true }, () => { setProducts((l) => l.filter((p) => !ids.includes(p.id))); setSel(new Set()); show(`${ids.length} product${ids.length > 1 ? "s" : ""} deleted`); });
  const exportCsv = () => { downloadCsv("products.csv", [["ID", "Name", "Category", "Size", "Sheets", "Price", "Status"], ...filtered.map((p) => [p.id, p.name, p.category, p.size, p.sheets, p.price, p.active ? "Active" : "Inactive"])]); show(`Exported ${filtered.length} products`); };
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = (ids: string[], all: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((i) => (all ? n.delete(i) : n.add(i))); return n; });
  const countCat = (c: string) => products.filter((p) => p.category === c).length;
  const addLabel = tab === "Album Products" ? "Add Product" : `Add ${noun}`;

  // ---- simple masters ----
  const list = tab === "Album Products" ? [] : curList();
  const move = (id: string, d: -1 | 1) => setCurList((l) => { const i = l.findIndex((x) => x.id === id), j = i + d; if (i < 0 || j < 0 || j >= l.length) return l; const c = [...l]; [c[i], c[j]] = [c[j]!, c[i]!]; return c; });
  const dupItem = (it: Item) => { setCurList((l) => { const i = l.findIndex((x) => x.id === it.id); const c = [...l]; c.splice(i + 1, 0, { ...it, id: `N${seq.current++}`, name: `${it.name} (Copy)` }); return c; }); show(`${it.name} duplicated`); };
  const setItemActive = (ids: string[], active: boolean) => setCurList((l) => l.map((x) => (ids.includes(x.id) ? { ...x, active } : x)));
  const delItems = (ids: string[], label: string) => confirm({ title: `Delete ${noun}`, message: `Delete ${label}? This cannot be undone.`, confirmLabel: "Delete", danger: true }, () => { setCurList((l) => l.filter((x) => !ids.includes(x.id))); setSel(new Set()); show(`${ids.length} entr${ids.length > 1 ? "ies" : "y"} deleted`); });
  const exportItems = () => { downloadCsv(`${(tab === "Other Masters" ? otherKey : tab).toLowerCase().replace(/\W+/g, "-")}.csv`, [["Name", "Description", "Add-on Price", "Status"], ...list.map((i) => [i.name, i.detail, i.price ?? "", i.active ? "Active" : "Inactive"])]); show(`Exported ${list.length} ${tab === "Other Masters" ? otherKey : tab}`); };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const data = parseCsv(await file.text());
    const first = (data[0] ?? []).map((h) => h.toLowerCase());
    const body = first.includes("name") ? data.slice(1) : data;
    let added = 0, skipped = 0;
    if (tab === "Album Products") {
      const base = Math.max(0, ...products.map((p) => Number(p.id.slice(3)) || 0));
      const next: Product[] = [];
      body.forEach((r) => {
        const off = first.includes("id") ? 1 : 0;
        const [name = "", category = "", size = "", sheets = "", price = "", status = ""] = r.slice(off);
        if (!name || !(Number(sheets) > 0) || !(Number(price) >= 0) || price === "" || [...products, ...next].some((p) => p.name.toLowerCase() === name.toLowerCase())) { skipped++; return; }
        next.push({ id: `PRD${String(base + next.length + 1).padStart(3, "0")}`, name, category: CATS.includes(category) ? category : CATS[0]!, size: size || "12x36", sheets: Number(sheets), price: Number(price), active: !/inactive/i.test(status) });
      });
      if (next.length) setProducts((l) => [...l, ...next]);
      added = next.length;
    } else {
      const have = new Set(curList().map((i) => i.name.toLowerCase()));
      const next: Item[] = [];
      body.forEach((r) => {
        const [name = "", detail = "", price = "", status = ""] = r;
        if (!name || have.has(name.toLowerCase())) { skipped++; return; }
        have.add(name.toLowerCase());
        next.push({ id: `N${seq.current++}`, name, detail: detail || tab, price: price === "" || isNaN(Number(price)) ? undefined : Number(price), active: !/inactive/i.test(status) });
      });
      if (next.length) setCurList((l) => [...l, ...next]);
      added = next.length;
    }
    show(`Imported ${added} row${added === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped (invalid or duplicate)` : ""}`);
    if (fileRef.current) fileRef.current.value = "";
  };

  const bar = (ids: string[], onAct: (a: boolean) => void, onDel: () => void, onExp?: () => void) => ids.length > 0 && (
    <div role="toolbar" aria-label="Bulk actions" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft px-4 py-2.5 text-[13px]">
      <b className="mr-2 text-brand">{ids.length} selected</b>
      <button onClick={() => { onAct(true); show(`${ids.length} activated`); setSel(new Set()); }} className="h-8 rounded-lg border border-line bg-white px-3 font-bold hover:bg-slate-50">Activate</button>
      <button onClick={() => { onAct(false); show(`${ids.length} deactivated`); setSel(new Set()); }} className="h-8 rounded-lg border border-line bg-white px-3 font-bold hover:bg-slate-50">Deactivate</button>
      {onExp && <button onClick={onExp} className="h-8 rounded-lg border border-line bg-white px-3 font-bold hover:bg-slate-50">Export</button>}
      <button onClick={onDel} className="h-8 rounded-lg border border-rose-200 bg-white px-3 font-bold text-rose-600 hover:bg-rose-50">Delete</button>
      <button onClick={() => setSel(new Set())} className="ml-auto font-bold text-sub hover:text-ink">Clear selection</button>
    </div>
  );
  const importBtn = <button onClick={() => fileRef.current?.click()} className={GHOST}><Upload className="size-4" />Import</button>;
  const selIds = [...sel];

  return (
    <div className="min-w-0">
      {toast}{dialog}
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="import-file" onChange={(e) => importFile(e.target.files?.[0])} />
      <PageHeader title="Masters" subtitle="Manage all configurable options used across the system.">
        <PrimaryButton onClick={() => (tab === "Album Products" ? openProduct() : openItem())}>{addLabel}</PrimaryButton>
      </PageHeader>

      <div className="mb-5 overflow-x-auto"><LineTabs className="min-w-max" tabs={TABS.map((t) => ({ key: t, label: t }))} value={tab} onChange={changeTab} /></div>

      {tab === "Album Products" ? (
        <div className="grid gap-4 xl:grid-cols-[250px_minmax(0,1fr)]">
          <Panel title="Album Categories" bodyClassName="pt-3">
            <ul className="space-y-1 text-[13px]">
              {["All Categories", ...CATS].map((c) => {
                const n = c === "All Categories" ? products.length : countCat(c);
                const active = c === cat;
                return (
                  <li key={c}><button onClick={() => { setCat(c); setFCat("All Categories"); setPage(1); }} className={cx("flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-semibold", active ? "bg-brand-soft text-brand" : "hover:bg-slate-50")}>
                    <LayoutGrid className="size-4 text-sub" /><span className="flex-1">{c}</span><span>{n}</span>{!active && <ChevronRight className="size-3.5 text-sub" />}
                  </button></li>
                );
              })}
            </ul>
          </Panel>

          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 2xl:grid-cols-6">
              {cards.map((p, i) => (
                <div key={p.id} className="overflow-hidden rounded-2xl border border-line bg-white">
                  <Thumb seed={i} size={160} rounded="rounded-none" className="!h-28 !w-full" />
                  <div className="p-3">
                    <div className="truncate text-sm font-extrabold">{p.name}</div>
                    <div className="text-xs text-sub">{p.size} | {p.sheets} Sheets</div>
                    <div className="mt-1 text-base font-extrabold">{inr(p.price)}</div>
                    <Pill tone={p.active ? "green" : "red"} dot className="mt-1">{p.active ? "Active" : "Inactive"}</Pill>
                    <button onClick={() => openProduct(p)} className="mt-2 h-8 w-full rounded-lg border border-line text-xs font-bold hover:bg-brand-soft">Edit</button>
                  </div>
                </div>
              ))}
              {cards.length === 0 && <div className="col-span-full rounded-2xl border border-dashed border-line p-6 text-center text-sm text-sub">No products in this category yet.</div>}
            </div>

            <Panel
              title="Product List"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <SearchInput className="w-60" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search product name, SKU, category..." />
                  <FilterSelect className="w-44" value={fCat} onChange={(v) => { setFCat(v); setPage(1); }} options={["All Categories", ...CATS]} />
                  <FilterSelect className="w-32" value={fStatus} onChange={(v) => { setFStatus(v); setPage(1); }} options={["All Status", "Active", "Inactive"]} />
                  {importBtn}
                  <button onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[13px] font-bold hover:bg-brand-soft"><Download className="size-4" />Export</button>
                </div>
              }
            >
              {bar(selIds, (a) => setProductActive(selIds, a), () => delProducts(selIds, `${selIds.length} selected product${selIds.length > 1 ? "s" : ""}`), () => { downloadCsv("selected-products.csv", [["ID", "Name", "Category", "Size", "Sheets", "Price", "Status"], ...products.filter((p) => sel.has(p.id)).map((p) => [p.id, p.name, p.category, p.size, p.sheets, p.price, p.active ? "Active" : "Inactive"])]); show(`Exported ${selIds.length} products`); })}
              <div className="overflow-x-auto">
                <table className={tableCls}>
                  <thead><tr><Th><input type="checkbox" aria-label="Select all on page" className="size-4 accent-[#3f4fe0]" checked={allOnPage} onChange={() => togglePage(rows.map((r) => r.id), allOnPage)} /></Th><Th>Product ID</Th><Th>Product Name</Th><Th>Category</Th><Th>Size</Th><Th>No. of Sheets</Th><Th>Price</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className={cx(trCls, sel.has(p.id) && "bg-brand-soft/60")}>
                        <Td><input type="checkbox" aria-label={`Select ${p.name}`} className="size-4 accent-[#3f4fe0]" checked={sel.has(p.id)} onChange={() => toggleSel(p.id)} /></Td>
                        <Td className="font-bold">{p.id}</Td><Td>{p.name}</Td><Td>{p.category}</Td><Td>{p.size}</Td><Td>{p.sheets}</Td><Td>{inr(p.price)}</Td>
                        <Td><Pill tone={p.active ? "green" : "red"} dot>{p.active ? "Active" : "Inactive"}</Pill></Td>
                        <Td><span className="flex items-center gap-2"><button onClick={() => openProduct(p)} aria-label={`Edit ${p.name}`} className="text-sub hover:text-brand"><Pencil className="size-4" /></button><Toggle on={p.active} onChange={() => { toggleProduct(p.id); show(`${p.name} ${p.active ? "deactivated" : "activated"}`); }} />
                          <RowMenu label={`Actions for ${p.name}`} items={[
                            { label: "Edit", icon: Pencil, onClick: () => openProduct(p) },
                            { label: "Duplicate", icon: Copy, onClick: () => dupProduct(p) },
                            { label: p.active ? "Deactivate" : "Activate", icon: Power, onClick: () => { toggleProduct(p.id); show(`${p.name} ${p.active ? "deactivated" : "activated"}`); } },
                            { label: "Delete", icon: Trash2, danger: true, onClick: () => delProducts([p.id], p.name) },
                          ]} /></span></Td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={9} className="py-10 text-center text-sub">No products found.</td></tr>}
                  </tbody>
                </table>
              </div>
              <Pagination page={cur} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="products" />
            </Panel>
          </div>
        </div>
      ) : (
        <Panel
          title={tab === "Other Masters" ? otherKey : tab}
          subtitle="SRS 3.1 - configurable master values used in order capture, pricing and production"
          action={<div className="flex flex-wrap items-center gap-2">
            {tab === "Other Masters" && <FilterSelect className="w-48" value={otherKey} onChange={(v) => { setOtherKey(v as (typeof OTHER)[number]); setSel(new Set()); }} options={[...OTHER]} />}
            {importBtn}
            <button onClick={exportItems} className={GHOST}><Download className="size-4" />Export</button>
          </div>}
        >
          {bar(selIds, (a) => setItemActive(selIds, a), () => delItems(selIds, `${selIds.length} selected entr${selIds.length > 1 ? "ies" : "y"}`))}
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><Th><input type="checkbox" aria-label="Select all" className="size-4 accent-[#3f4fe0]" checked={list.length > 0 && list.every((x) => sel.has(x.id))} onChange={() => togglePage(list.map((x) => x.id), list.every((x) => sel.has(x.id)))} /></Th><Th>#</Th><Th>Name</Th><Th>Description</Th>{hasPrice && <Th>Add-on Price</Th>}<Th>Status</Th><Th>Actions</Th></tr></thead>
              <tbody>
                {list.map((it, i) => (
                  <tr key={it.id} className={cx(trCls, sel.has(it.id) && "bg-brand-soft/60")}>
                    <Td><input type="checkbox" aria-label={`Select ${it.name}`} className="size-4 accent-[#3f4fe0]" checked={sel.has(it.id)} onChange={() => toggleSel(it.id)} /></Td>
                    <Td>{i + 1}</Td><Td className="font-semibold">{it.name}</Td><Td className="text-sub">{it.detail}</Td>
                    {hasPrice && <Td>{it.price !== undefined ? inr(it.price) : "-"}</Td>}
                    <Td><Pill tone={it.active ? "green" : "red"} dot>{it.active ? "Active" : "Inactive"}</Pill></Td>
                    <Td><span className="flex items-center gap-2">
                      <button onClick={() => move(it.id, -1)} disabled={i === 0} aria-label={`Move ${it.name} up`} className="text-sub hover:text-brand disabled:opacity-30"><ArrowUp className="size-4" /></button>
                      <button onClick={() => move(it.id, 1)} disabled={i === list.length - 1} aria-label={`Move ${it.name} down`} className="text-sub hover:text-brand disabled:opacity-30"><ArrowDown className="size-4" /></button>
                      <button onClick={() => openItem(it)} aria-label={`Edit ${it.name}`} className="text-sub hover:text-brand"><Pencil className="size-4" /></button>
                      <Toggle on={it.active} onChange={() => { setItemActive([it.id], !it.active); show(`${it.name} ${it.active ? "deactivated" : "activated"}`); }} />
                      <RowMenu label={`Actions for ${it.name}`} items={[
                        { label: "Edit", icon: Pencil, onClick: () => openItem(it) },
                        { label: "Duplicate", icon: Copy, onClick: () => dupItem(it) },
                        { label: it.active ? "Deactivate" : "Activate", icon: Power, onClick: () => { setItemActive([it.id], !it.active); show(`${it.name} ${it.active ? "deactivated" : "activated"}`); } },
                        { label: "Delete", icon: Trash2, danger: true, onClick: () => delItems([it.id], it.name) },
                      ]} />
                    </span></Td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={7} className="py-10 text-center text-sub">Nothing here yet. Use Add to create the first entry.</td></tr>}
              </tbody>
            </table>
          </div>
          <button onClick={() => openItem()} className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-brand"><Plus className="size-4" />{addLabel}</button>
        </Panel>
      )}

      <SlideOver open={!!slide} onClose={() => setSlide(null)} title={`${slide?.id ? "Edit" : "Add"} ${slide?.kind === "product" ? "Product" : noun}`} footer={<>
        <button onClick={() => setSlide(null)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={Plus} onClick={save}>Save</PrimaryButton>
      </>}>
        <Field label="Name" required><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />{errs.name && <span className={ERR}>{errs.name}</span>}</Field>
        {slide?.kind === "product" ? (<>
          <Field label="Category" required><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Size" required><select className={inputCls} value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}>{["8x12", "6x8", "10x10", "11x14", "12x18", "12x30", "12x36", "14x10", "14x40"].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="No. of Sheets" required><input type="number" min={1} className={inputCls} value={f.sheets} onChange={(e) => setF({ ...f, sheets: e.target.value })} />{errs.sheets && <span className={ERR}>{errs.sheets}</span>}</Field>
          </div>
          <Field label="Base Price (INR, excl. GST)" required><input type="number" min={0} className={inputCls} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />{errs.price && <span className={ERR}>{errs.price}</span>}</Field>
        </>) : (<>
          <Field label="Description"><input className={inputCls} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
          {hasPrice && <Field label="Add-on Price (INR)"><input type="number" min={0} className={inputCls} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />{errs.price && <span className={ERR}>{errs.price}</span>}</Field>}
        </>)}
        <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm font-semibold">Active <Toggle on={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
      </SlideOver>
    </div>
  );
}
