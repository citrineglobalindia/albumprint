import { useMemo, useState } from "react";
import { Download, LayoutGrid, Pencil, Plus, ChevronRight } from "lucide-react";
import { Field, FilterSelect, LineTabs, Pagination, Panel, PageHeader, Pill, PrimaryButton, SearchInput, SlideOver, Td, Th, Thumb, Toggle, inputCls, tableCls, trCls, cx } from "../components/ui";
import { useToast } from "../components/Toast";
import { downloadCsv } from "../lib/csv";
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
  const [toast, show] = useToast();

  const [slide, setSlide] = useState<null | { kind: "product" | "item"; id: string | null }>(null);
  const [f, setF] = useState({ name: "", category: CATS[0]!, size: "12x36", sheets: "40", price: "0", detail: "", active: true });
  const [err, setErr] = useState("");

  const filtered = useMemo(() => products.filter((p) => {
    if (cat !== "All Categories" && p.category !== cat) return false;
    if (fCat !== "All Categories" && p.category !== fCat) return false;
    if (fStatus !== "All Status" && (p.active ? "Active" : "Inactive") !== fStatus) return false;
    const t = q.trim().toLowerCase();
    return !t || p.name.toLowerCase().includes(t) || p.id.toLowerCase().includes(t) || p.category.toLowerCase().includes(t);
  }), [products, cat, fCat, fStatus, q]);
  const rows = filtered.slice((page - 1) * pageSize, page * pageSize);

  const openProduct = (p?: Product) => {
    setErr("");
    setF(p ? { name: p.name, category: p.category, size: p.size, sheets: String(p.sheets), price: String(p.price), detail: "", active: p.active } : { name: "", category: CATS[0]!, size: "12x36", sheets: "40", price: "0", detail: "", active: true });
    setSlide({ kind: "product", id: p?.id ?? null });
  };
  const openItem = (it?: Item) => {
    setErr("");
    setF({ name: it?.name ?? "", category: CATS[0]!, size: "", sheets: "0", price: String(it?.price ?? ""), detail: it?.detail ?? "", active: it?.active ?? true });
    setSlide({ kind: "item", id: it?.id ?? null });
  };

  const curList = (): Item[] => (tab === "Other Masters" ? other[otherKey]! : items[tab as keyof typeof SEED]);
  const setCurList = (fn: (l: Item[]) => Item[]) => (tab === "Other Masters" ? setOther((o) => ({ ...o, [otherKey]: fn(o[otherKey]!) })) : setItems((o) => ({ ...o, [tab]: fn(o[tab as keyof typeof SEED]) })));

  const save = () => {
    if (!f.name.trim()) return setErr("Name is required");
    if (slide?.kind === "product") {
      const price = Number(f.price), sheets = Number(f.sheets);
      if (!(price >= 0) || !(sheets > 0)) return setErr("Enter a valid price and sheet count");
      if (slide.id) setProducts((l) => l.map((p) => (p.id === slide.id ? { ...p, name: f.name, category: f.category, size: f.size, sheets, price, active: f.active } : p)));
      else setProducts((l) => [...l, { id: `PRD${String(l.length + 1).padStart(3, "0")}`, name: f.name, category: f.category, size: f.size, sheets, price, active: f.active }]);
    } else {
      const price = f.price === "" ? undefined : Number(f.price);
      if (slide?.id) setCurList((l) => l.map((i) => (i.id === slide.id ? { ...i, name: f.name, detail: f.detail, price, active: f.active } : i)));
      else setCurList((l) => [...l, { id: `N${Date.now()}`, name: f.name, detail: f.detail || tab, price, active: f.active }]);
    }
    show(`${f.name} ${slide?.id ? "updated" : "added"}`);
    setSlide(null);
  };

  const toggleProduct = (id: string) => setProducts((l) => l.map((p) => (p.id === id ? { ...p, active: !p.active } : p)));
  const exportCsv = () => { downloadCsv("products.csv", [["ID", "Name", "Category", "Size", "Sheets", "Price", "Status"], ...filtered.map((p) => [p.id, p.name, p.category, p.size, p.sheets, p.price, p.active ? "Active" : "Inactive"])]); show("Products exported"); };
  const countCat = (c: string) => products.filter((p) => p.category === c).length;
  const addLabel = tab === "Album Products" ? "Add Product" : `Add ${tab === "Other Masters" ? otherKey : tab.replace(/s$/, "")}`;

  return (
    <div className="min-w-0">
      {toast}
      <PageHeader title="Masters" subtitle="Manage all configurable options used across the system.">
        <PrimaryButton onClick={() => (tab === "Album Products" ? openProduct() : openItem())}>{addLabel}</PrimaryButton>
      </PageHeader>

      <div className="mb-5 overflow-x-auto"><LineTabs className="min-w-max" tabs={TABS.map((t) => ({ key: t, label: t }))} value={tab} onChange={(t) => { setTab(t); setPage(1); }} /></div>

      {tab === "Album Products" ? (
        <div className="grid gap-4 xl:grid-cols-[250px_minmax(0,1fr)]">
          <Panel title="Album Categories" bodyClassName="pt-3">
            <ul className="space-y-1 text-[13px]">
              {["All Categories", ...CATS].map((c) => {
                const n = c === "All Categories" ? products.length : countCat(c);
                const active = c === cat;
                return (
                  <li key={c}><button onClick={() => { setCat(c); setPage(1); }} className={cx("flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-semibold", active ? "bg-brand-soft text-brand" : "hover:bg-slate-50")}>
                    <LayoutGrid className="size-4 text-sub" /><span className="flex-1">{c}</span><span>{n}</span>{!active && <ChevronRight className="size-3.5 text-sub" />}
                  </button></li>
                );
              })}
            </ul>
          </Panel>

          <div className="min-w-0 space-y-4">
            <div className="grid gap-3 sm:grid-cols-3 2xl:grid-cols-6">
              {products.slice(0, 6).map((p, i) => (
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
            </div>

            <Panel
              title="Product List"
              action={
                <div className="flex flex-wrap items-center gap-2">
                  <SearchInput className="w-60" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search product name, SKU, category..." />
                  <FilterSelect className="w-44" value={fCat} onChange={(v) => { setFCat(v); setPage(1); }} options={["All Categories", ...CATS]} />
                  <FilterSelect className="w-32" value={fStatus} onChange={(v) => { setFStatus(v); setPage(1); }} options={["All Status", "Active", "Inactive"]} />
                  <button onClick={exportCsv} className="inline-flex h-10 items-center gap-2 rounded-lg border border-line px-3.5 text-[13px] font-bold hover:bg-brand-soft"><Download className="size-4" />Export</button>
                </div>
              }
            >
              <div className="overflow-x-auto">
                <table className={tableCls}>
                  <thead><tr><Th>Product ID</Th><Th>Product Name</Th><Th>Category</Th><Th>Size</Th><Th>No. of Sheets</Th><Th>Price</Th><Th>Status</Th><Th>Actions</Th></tr></thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} className={trCls}>
                        <Td className="font-bold">{p.id}</Td><Td>{p.name}</Td><Td>{p.category}</Td><Td>{p.size}</Td><Td>{p.sheets}</Td><Td>{inr(p.price)}</Td>
                        <Td><Pill tone={p.active ? "green" : "red"} dot>{p.active ? "Active" : "Inactive"}</Pill></Td>
                        <Td><span className="flex items-center gap-3"><button onClick={() => openProduct(p)} aria-label="Edit" className="text-sub hover:text-brand"><Pencil className="size-4" /></button><Toggle on={p.active} onChange={() => toggleProduct(p.id)} /></span></Td>
                      </tr>
                    ))}
                    {rows.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-sub">No products found.</td></tr>}
                  </tbody>
                </table>
              </div>
              <Pagination page={page} pageSize={pageSize} total={filtered.length} onPage={setPage} onPageSize={(n) => { setPageSize(n); setPage(1); }} noun="products" />
            </Panel>
          </div>
        </div>
      ) : (
        <Panel
          title={tab === "Other Masters" ? otherKey : tab}
          subtitle="SRS 3.1 - configurable master values used in order capture, pricing and production"
          action={tab === "Other Masters" ? <FilterSelect className="w-48" value={otherKey} onChange={(v) => setOtherKey(v as (typeof OTHER)[number])} options={[...OTHER]} /> : undefined}
        >
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><Th>#</Th><Th>Name</Th><Th>Description</Th>{tab !== "Other Masters" && tab !== "Event Types" && tab !== "Design Styles" && <Th>Add-on Price</Th>}<Th>Status</Th><Th>Actions</Th></tr></thead>
              <tbody>
                {curList().map((it, i) => (
                  <tr key={it.id} className={trCls}>
                    <Td>{i + 1}</Td><Td className="font-semibold">{it.name}</Td><Td className="text-sub">{it.detail}</Td>
                    {tab !== "Other Masters" && tab !== "Event Types" && tab !== "Design Styles" && <Td>{it.price !== undefined ? inr(it.price) : "-"}</Td>}
                    <Td><Pill tone={it.active ? "green" : "red"} dot>{it.active ? "Active" : "Inactive"}</Pill></Td>
                    <Td><span className="flex items-center gap-3"><button onClick={() => openItem(it)} aria-label="Edit" className="text-sub hover:text-brand"><Pencil className="size-4" /></button><Toggle on={it.active} onChange={() => setCurList((l) => l.map((x) => (x.id === it.id ? { ...x, active: !x.active } : x)))} /></span></Td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button onClick={() => openItem()} className="mt-4 inline-flex items-center gap-1.5 text-sm font-bold text-brand"><Plus className="size-4" />{addLabel}</button>
        </Panel>
      )}

      <SlideOver open={!!slide} onClose={() => setSlide(null)} title={`${slide?.id ? "Edit" : "Add"} ${slide?.kind === "product" ? "Product" : tab === "Other Masters" ? otherKey : tab.replace(/s$/, "")}`} footer={<>
        <button onClick={() => setSlide(null)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={Plus} onClick={save}>Save</PrimaryButton>
      </>}>
        <Field label="Name" required><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
        {slide?.kind === "product" ? (<>
          <Field label="Category" required><select className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map((c) => <option key={c}>{c}</option>)}</select></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Size" required><select className={inputCls} value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}>{["8x12", "6x8", "10x10", "11x14", "12x18", "12x30", "12x36", "14x10", "14x40"].map((s) => <option key={s}>{s}</option>)}</select></Field>
            <Field label="No. of Sheets" required><input type="number" min={1} className={inputCls} value={f.sheets} onChange={(e) => setF({ ...f, sheets: e.target.value })} /></Field>
          </div>
          <Field label="Base Price (INR, excl. GST)" required><input type="number" min={0} className={inputCls} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>
        </>) : (<>
          <Field label="Description"><input className={inputCls} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
          {tab !== "Other Masters" && tab !== "Event Types" && tab !== "Design Styles" && <Field label="Add-on Price (INR)"><input type="number" min={0} className={inputCls} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></Field>}
        </>)}
        <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm font-semibold">Active <Toggle on={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
        {err && <div className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm font-semibold text-rose-600">{err}</div>}
      </SlideOver>
    </div>
  );
}
