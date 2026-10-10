import { useMemo, useRef, useState, type DragEvent } from "react";
import { Archive, ArchiveRestore, Check, ChevronRight, Copy, Download, GripVertical, ImagePlus, LayoutGrid, Pencil, Plus, Power, RotateCcw, Trash2, Upload, X } from "lucide-react";
import { RowMenu } from "../components/RowMenu";
import { useConfirm } from "../components/ConfirmDialog";
import { Field, LineTabs, Pagination, Panel, PageHeader, Pill, PrimaryButton, SearchInput, SlideOver, Td, Th, Thumb, Toggle, inputCls, tableCls, trCls, cx } from "../components/ui";
import { ColumnsMenu, Combobox, FilterChips, MultiSelect, SavedViews, SortTh, sortRows, type SortState } from "../components/controls";
import { useToast } from "../components/Toast";
import { downloadCsv, parseCsv } from "../lib/csv";
import { inr } from "../lib/format";
import { ORDERS } from "../lib/data";
import { usePersistentState } from "../lib/localState";
import { logAudit } from "../lib/audit";
import { GST_RATE, applyPricing, pricingDefaults, snapshotPricing, type PricingSnapshot } from "../lib/pricing";

const TABS = ["Album Products", "Pricing Rules", "Printing Options", "Materials", "Event Types", "Cover Types", "Box Types", "Design Styles", "Other Masters"] as const;
type Tab = (typeof TABS)[number];

interface Product { id: string; name: string; category: string; size: string; sheets: number; price: number; active: boolean; archived: boolean; image?: string }
interface Item { id: string; name: string; detail: string; price?: number; active: boolean; archived: boolean }

const CATS = ["Premium Albums", "Standard Albums", "Magnetic Albums", "Acrylic Albums", "Photobooks", "Flush Mount Albums", "Layflat Albums", "Parents Albums"];
const SIZES = ["6x8", "8x12", "10x10", "11x14", "12x18", "12x30", "12x36", "14x10", "14x40"];
const SHEETS = [20, 25, 30, 40, 45, 50, 60];
const P: [string, string, string, number, number, boolean][] = [
  ["Premium Album", "Premium Albums", "12x36", 60, 8500, true], ["Classic Album", "Standard Albums", "12x30", 50, 6200, true],
  ["Magnetic Album", "Magnetic Albums", "14x10", 50, 10500, true], ["Acrylic Album", "Acrylic Albums", "12x18", 45, 12000, true],
  ["Photobook", "Photobooks", "10x10", 30, 3800, true], ["Layflat Album", "Layflat Albums", "12x36", 40, 9500, true],
  ["Flush Mount Album", "Premium Albums", "11x14", 40, 7800, false], ["Parents Album", "Standard Albums", "8x12", 25, 4200, true],
  ["Mini Album", "Photobooks", "6x8", 20, 2500, true], ["Designer Album", "Premium Albums", "12x30", 50, 9800, true],
];
const seedProducts: Product[] = P.map(([name, category, size, sheets, price, active], i) => ({ id: `PRD${String(i + 1).padStart(3, "0")}`, name, category, size, sheets, price, active, archived: false }));

const mk = (names: [string, string][], priced = false): Item[] => names.map(([name, detail], i) => ({ id: `M${i + 1}`, name, detail, price: priced ? 500 + i * 250 : undefined, active: true, archived: false }));
const SEED: Record<Exclude<Tab, "Album Products" | "Other Masters" | "Pricing Rules">, Item[]> = {
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

type Errs = { name?: string; price?: string; sheets?: string; sku?: string };
const ERR = "mt-1 block text-xs font-semibold text-rose-600";
const GHOST = "inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3.5 text-[13px] font-bold hover:bg-brand-soft";
const statusOf = (x: { active: boolean; archived: boolean }) => (x.archived ? "Archived" : x.active ? "Active" : "Inactive");
const statusTone = (s: string) => (s === "Active" ? "green" : s === "Archived" ? "slate" : "red") as "green" | "slate" | "red";
const usedIn = (p: { size: string }) => ORDERS.filter((o) => o.size === p.size).length;
const usedInItem = (tab: string, name: string) => (tab === "Event Types" ? ORDERS.filter((o) => o.event.toLowerCase() === name.toLowerCase()).length : 0);

interface ImpRow { line: number; cells: string[]; errors: string[] }
interface ProdView { q: string; fCat: string[]; fSize: string[]; fStatus: string[]; sort: SortState; hidden: string[] }
interface ItemView { q: string; fStatus: string[]; sort: SortState; hidden: string[] }
const PCOLS = [{ key: "category", label: "Category" }, { key: "size", label: "Size" }, { key: "sheets", label: "No. of Sheets" }, { key: "price", label: "Price" }, { key: "status", label: "Status" }];

export default function Masters() {
  const [tab, setTab] = useState<Tab>("Album Products");
  const [products, setProducts] = usePersistentState<Product[]>("masters_products", () => seedProducts);
  const [items, setItems] = usePersistentState<typeof SEED>("masters_items", () => SEED);
  const [other, setOther] = usePersistentState<Record<string, Item[]>>("masters_other", () => Object.fromEntries(OTHER.map((k) => [k, OTHER_SEED[k].map((n, i) => ({ id: `${k}${i}`, name: n, detail: k, active: true, archived: false }))])));
  const [otherKey, setOtherKey] = useState<(typeof OTHER)[number]>("Paper GSM");
  const [cat, setCat] = useState("All Categories");
  const [q, setQ] = useState("");
  const [fCat, setFCat] = useState<string[]>([]);
  const [fSize, setFSize] = useState<string[]>([]);
  const [fStatus, setFStatus] = useState<string[]>([]);
  const [sort, setSort] = useState<SortState>(null);
  const [hidden, setHidden] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [toast, show] = useToast();
  const [dialog, confirm] = useConfirm();
  const fileRef = useRef<HTMLInputElement>(null);
  const seq = useRef(Date.now() % 1e8);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [imp, setImp] = useState<null | { rows: ImpRow[]; fileName: string }>(null);
  const [dropOver, setDropOver] = useState(false);

  const [slide, setSlide] = useState<null | { kind: "product" | "item"; id: string | null }>(null);
  const [f, setF] = useState({ name: "", sku: "", category: CATS[0]!, size: "12x36", sheets: "40", price: "0", detail: "", active: true, image: "" });
  const [errs, setErrs] = useState<Errs>({});

  const isProducts = tab === "Album Products";
  const nextPid = (extra: string[] = []) => { const taken = new Set([...products.map((p) => p.id), ...extra]); let n = Math.max(0, ...products.map((p) => Number(p.id.slice(3)) || 0)) + 1; while (taken.has(`PRD${String(n).padStart(3, "0")}`)) n++; return `PRD${String(n).padStart(3, "0")}`; };

  const showStatus = (x: { active: boolean; archived: boolean }) => (fStatus.length ? fStatus.includes(statusOf(x)) : !x.archived);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    const rows = products.filter((p) => {
      if (cat !== "All Categories" && p.category !== cat) return false;
      if (fCat.length && !fCat.includes(p.category)) return false;
      if (fSize.length && !fSize.includes(p.size)) return false;
      if (!showStatus(p)) return false;
      return !t || p.name.toLowerCase().includes(t) || p.id.toLowerCase().includes(t) || p.category.toLowerCase().includes(t);
    });
    return sortRows(rows, sort, (p, k) => (k === "id" ? p.id : k === "name" ? p.name.toLowerCase() : k === "category" ? p.category : k === "size" ? p.size : k === "sheets" ? p.sheets : k === "price" ? p.price : statusOf(p)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products, cat, fCat, fSize, fStatus, q, sort]);
  const maxPage = Math.max(1, Math.ceil(filtered.length / pageSize));
  const cur = Math.min(page, maxPage);
  const rows = filtered.slice((cur - 1) * pageSize, cur * pageSize);
  const cards = products.filter((p) => !p.archived && (cat === "All Categories" || p.category === cat)).slice(0, 6);
  const allOnPage = rows.length > 0 && rows.every((p) => sel.has(p.id));
  const colOn = (k: string) => !hidden.includes(k);

  const curList = (): Item[] => (tab === "Pricing Rules" ? [] : tab === "Other Masters" ? other[otherKey]! : items[tab as keyof typeof SEED] ?? []);
  const setCurList = (fn: (l: Item[]) => Item[]) => (tab === "Other Masters" ? setOther((o) => ({ ...o, [otherKey]: fn(o[otherKey]!) })) : setItems((o) => ({ ...o, [tab]: fn(o[tab as keyof typeof SEED]) })));
  const hasPrice = tab !== "Other Masters" && tab !== "Event Types" && tab !== "Design Styles";
  const noun = tab === "Other Masters" ? otherKey : tab.replace(/s$/, "");
  const fullList = isProducts ? [] : curList();
  const list = useMemo(() => {
    const t = q.trim().toLowerCase();
    const l = fullList.filter((i) => showStatus(i) && (!t || i.name.toLowerCase().includes(t) || i.detail.toLowerCase().includes(t)));
    return sortRows(l, sort, (i, k) => (k === "name" ? i.name.toLowerCase() : k === "detail" ? i.detail : k === "price" ? i.price ?? -1 : statusOf(i)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fullList, q, fStatus, sort]);
  const canReorder = !isProducts && !sort;

  const changeTab = (t: Tab) => { setTab(t); setPage(1); setSel(new Set()); setQ(""); setFCat([]); setFSize([]); setFStatus([]); setSort(null); setHidden([]); };
  const clearFilters = () => { setQ(""); setFCat([]); setFSize([]); setFStatus([]); setCat("All Categories"); setPage(1); };
  const chips = [
    ...(q.trim() ? [{ label: `Search: ${q.trim()}`, onRemove: () => setQ("") }] : []),
    ...(isProducts && cat !== "All Categories" ? [{ label: `Category: ${cat}`, onRemove: () => setCat("All Categories") }] : []),
    ...fCat.map((c) => ({ label: `Category: ${c}`, onRemove: () => setFCat(fCat.filter((x) => x !== c)) })),
    ...fSize.map((c) => ({ label: `Size: ${c}`, onRemove: () => setFSize(fSize.filter((x) => x !== c)) })),
    ...fStatus.map((c) => ({ label: `Status: ${c}`, onRemove: () => setFStatus(fStatus.filter((x) => x !== c)) })),
  ];

  const openProduct = (p?: Product) => {
    setErrs({});
    setF(p ? { name: p.name, sku: p.id, category: p.category, size: p.size, sheets: String(p.sheets), price: String(p.price), detail: "", active: p.active, image: p.image ?? "" } : { name: "", sku: nextPid(), category: CATS[0]!, size: "12x36", sheets: "40", price: "0", detail: "", active: true, image: "" });
    setSlide({ kind: "product", id: p?.id ?? null });
  };
  const openItem = (it?: Item) => {
    setErrs({});
    setF({ name: it?.name ?? "", sku: "", category: CATS[0]!, size: "", sheets: "0", price: String(it?.price ?? ""), detail: it?.detail ?? "", active: it?.active ?? true, image: "" });
    setSlide({ kind: "item", id: it?.id ?? null });
  };
  const setImage = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) { show("Only image files can be used as product photos"); return; }
    if (file.size > 5 * 1024 * 1024) { show("Image is larger than 5 MB"); return; }
    if (f.image.startsWith("blob:")) URL.revokeObjectURL(f.image);
    setF((x) => ({ ...x, image: URL.createObjectURL(file) }));
  };
  const onDropImg = (e: DragEvent) => { e.preventDefault(); setDropOver(false); setImage(e.dataTransfer.files?.[0]); };

  const priceNum = Number(f.price);
  const gstAmt = Math.round(priceNum * GST_RATE), gross = Math.round(priceNum + gstAmt);

  const save = () => {
    const e: Errs = {};
    const name = f.name.trim();
    if (!name) e.name = "Name is required";
    if (slide?.kind === "product") {
      if (name && products.some((p) => p.id !== slide.id && p.name.toLowerCase() === name.toLowerCase())) e.name = "A product with this name already exists";
      if (!/^PRD\d{3,}$/.test(f.sku)) e.sku = "SKU must look like PRD011";
      else if (products.some((p) => p.id !== slide.id && p.id === f.sku)) e.sku = "This SKU is already in use";
      if (f.price === "" || !(priceNum >= 0)) e.price = "Enter a valid price (0 or more)";
      if (!(Number(f.sheets) > 0)) e.sheets = "Sheets must be at least 1";
    } else {
      if (name && curList().some((i) => i.id !== slide?.id && i.name.toLowerCase() === name.toLowerCase())) e.name = "This name already exists in the list";
      if (hasPrice && f.price !== "" && !(Number(f.price) >= 0)) e.price = "Enter a valid price";
    }
    setErrs(e);
    if (Object.keys(e).length) return;
    if (slide?.kind === "product") {
      const price = priceNum, sheets = Number(f.sheets);
      const img = f.image || undefined;
      if (slide.id) setProducts((l) => l.map((p) => (p.id === slide.id ? { ...p, id: f.sku, name, category: f.category, size: f.size, sheets, price, active: f.active, image: img } : p)));
      else { setProducts((l) => [...l, { id: f.sku, name, category: f.category, size: f.size, sheets, price, active: f.active, archived: false, image: img }]); clearFilters(); setSort(null); setPage(Math.ceil((products.length + 1) / pageSize)); }
    } else {
      const price = f.price === "" ? undefined : Number(f.price);
      if (slide?.id) setCurList((l) => l.map((i) => (i.id === slide.id ? { ...i, name, detail: f.detail, price, active: f.active } : i)));
      else { setCurList((l) => [...l, { id: `N${seq.current++}`, name, detail: f.detail || tab, price, active: f.active, archived: false }]); setQ(""); setFStatus([]); setSort(null); }
    }
    show(`${name} ${slide?.id ? "updated" : "added"}`);
    setSlide(null);
  };

  // ---- products ----
  const setProductActive = (ids: string[], active: boolean) => setProducts((l) => l.map((p) => (ids.includes(p.id) ? { ...p, active } : p)));
  const setProductArchived = (ids: string[], archived: boolean) => { setProducts((l) => l.map((p) => (ids.includes(p.id) ? { ...p, archived } : p))); setSel(new Set()); };
  const dupProduct = (p: Product) => { setProducts((l) => [...l, { ...p, id: nextPid(), name: `${p.name} (Copy)` }]); show(`${p.name} duplicated`); };
  const delProducts = (ids: string[], label: string) => {
    const used = products.filter((p) => ids.includes(p.id)).reduce((a, p) => a + usedIn(p), 0);
    confirm({ title: "Delete product", message: <>Delete {label}? This cannot be undone.{used > 0 && <> It is referenced by <b>{used} orders</b>; consider <b>archiving</b> instead so history stays intact.</>}</>, confirmLabel: "Delete", danger: true }, () => { setProducts((l) => l.filter((p) => !ids.includes(p.id))); setSel(new Set()); show(`${ids.length} product${ids.length > 1 ? "s" : ""} deleted`); });
  };
  const exportCsv = () => { downloadCsv("products.csv", [["ID", "Name", "Category", "Size", "Sheets", "Price", "Status"], ...filtered.map((p) => [p.id, p.name, p.category, p.size, p.sheets, p.price, statusOf(p)])]); show(`Exported ${filtered.length} products`); };
  const toggleSel = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const togglePage = (ids: string[], all: boolean) => setSel((s) => { const n = new Set(s); ids.forEach((i) => (all ? n.delete(i) : n.add(i))); return n; });
  const countCat = (c: string) => products.filter((p) => p.category === c && !p.archived).length;
  const addLabel = isProducts ? "Add Product" : `Add ${noun}`;

  // ---- simple masters ----
  const reorder = (from: string, to: string) => {
    if (from === to) return;
    setCurList((l) => { const a = l.findIndex((x) => x.id === from), b = l.findIndex((x) => x.id === to); if (a < 0 || b < 0) return l; const c = [...l]; const [m] = c.splice(a, 1); c.splice(b, 0, m!); return c; });
    show("Order updated");
  };
  const dupItem = (it: Item) => { setCurList((l) => { const i = l.findIndex((x) => x.id === it.id); const c = [...l]; c.splice(i + 1, 0, { ...it, id: `N${seq.current++}`, name: `${it.name} (Copy)` }); return c; }); show(`${it.name} duplicated`); };
  const setItemActive = (ids: string[], active: boolean) => setCurList((l) => l.map((x) => (ids.includes(x.id) ? { ...x, active } : x)));
  const setItemArchived = (ids: string[], archived: boolean) => { setCurList((l) => l.map((x) => (ids.includes(x.id) ? { ...x, archived } : x))); setSel(new Set()); };
  const delItems = (ids: string[], label: string) => {
    const used = curList().filter((i) => ids.includes(i.id)).reduce((a, i) => a + usedInItem(tab, i.name), 0);
    confirm({ title: `Delete ${noun}`, message: <>Delete {label}? This cannot be undone.{used > 0 && <> Used in <b>{used} orders</b>; consider archiving instead.</>}</>, confirmLabel: "Delete", danger: true }, () => { setCurList((l) => l.filter((x) => !ids.includes(x.id))); setSel(new Set()); show(`${ids.length} entr${ids.length > 1 ? "ies" : "y"} deleted`); });
  };
  const exportItems = () => { downloadCsv(`${(tab === "Other Masters" ? otherKey : tab).toLowerCase().replace(/\W+/g, "-")}.csv`, [["Name", "Description", "Add-on Price", "Status"], ...list.map((i) => [i.name, i.detail, i.price ?? "", statusOf(i)])]); show(`Exported ${list.length} ${tab === "Other Masters" ? otherKey : tab}`); };

  // ---- CSV import with preview + per-row validation ----
  const importFile = async (file: File | undefined) => {
    if (!file) return;
    const data = parseCsv(await file.text());
    if (fileRef.current) fileRef.current.value = "";
    if (!data.length) { show("The CSV file is empty"); return; }
    const first = data[0]!.map((h) => h.toLowerCase());
    const hasHdr = first.includes("name");
    const off = hasHdr && first[0] === "id" ? 1 : 0;
    const body = (hasHdr ? data.slice(1) : data).map((r) => r.slice(off));
    const seen = new Set((isProducts ? products.map((p) => p.name) : curList().map((i) => i.name)).map((n) => n.toLowerCase()));
    const out: ImpRow[] = body.map((cells, i) => {
      const errors: string[] = [];
      const name = (cells[0] ?? "").trim();
      if (!name) errors.push("Name is required");
      else if (seen.has(name.toLowerCase())) errors.push("Duplicate name");
      else seen.add(name.toLowerCase());
      if (isProducts) {
        const [, category = "", size = "", sheets = "", price = ""] = cells;
        if (!CATS.includes(category)) errors.push(`Unknown category "${category}"`);
        if (!SIZES.includes(size)) errors.push(`Unknown size "${size}"`);
        if (!(Number(sheets) > 0) || !Number.isInteger(Number(sheets))) errors.push("Sheets must be a whole number > 0");
        if (price === "" || !(Number(price) >= 0)) errors.push("Price must be 0 or more");
      } else {
        const price = cells[2] ?? "";
        if (price !== "" && !(Number(price) >= 0)) errors.push("Price must be a number");
      }
      return { line: i + (hasHdr ? 2 : 1), cells, errors };
    });
    setImp({ rows: out, fileName: file.name });
  };
  const commitImport = () => {
    if (!imp) return;
    const good = imp.rows.filter((r) => !r.errors.length);
    if (isProducts) {
      const used: string[] = [];
      const next: Product[] = good.map((r) => { const [name = "", category = "", size = "", sheets = "", price = "", status = ""] = r.cells; const id = nextPid(used); used.push(id); return { id, name, category, size, sheets: Number(sheets), price: Number(price), active: !/inactive/i.test(status), archived: false }; });
      setProducts((l) => [...l, ...next]);
    } else {
      const next: Item[] = good.map((r) => { const [name = "", detail = "", price = "", status = ""] = r.cells; return { id: `N${seq.current++}`, name, detail: detail || tab, price: price === "" ? undefined : Number(price), active: !/inactive/i.test(status), archived: false }; });
      setCurList((l) => [...l, ...next]);
    }
    show(`Imported ${good.length} row${good.length === 1 ? "" : "s"}${imp.rows.length - good.length ? `, ${imp.rows.length - good.length} skipped (invalid)` : ""}`);
    setImp(null); clearFilters(); setSort(null);
    if (isProducts) setPage(Math.ceil((products.length + good.length) / pageSize));
  };
  const downloadTemplate = () => downloadCsv(isProducts ? "products-template.csv" : "master-template.csv", isProducts ? [["Name", "Category", "Size", "Sheets", "Price", "Status"], ["Sample Album", "Premium Albums", "12x36", 40, 8000, "Active"]] : [["Name", "Description", "Add-on Price", "Status"], ["Sample", "Description", 500, "Active"]]);

  const bar = (ids: string[], onAct: (a: boolean) => void, onArchive: () => void, onDel: () => void, onExp?: () => void) => ids.length > 0 && (
    <div role="toolbar" aria-label="Bulk actions" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl bg-brand-soft px-4 py-2.5 text-[13px]">
      <b className="mr-2 text-brand">{ids.length} selected</b>
      <button onClick={() => { onAct(true); show(`${ids.length} activated`); setSel(new Set()); }} className="h-8 rounded-lg border border-line bg-white px-3 font-bold hover:bg-slate-50">Activate</button>
      <button onClick={() => { onAct(false); show(`${ids.length} deactivated`); setSel(new Set()); }} className="h-8 rounded-lg border border-line bg-white px-3 font-bold hover:bg-slate-50">Deactivate</button>
      <button onClick={() => { onArchive(); show(`${ids.length} archived`); }} className="h-8 rounded-lg border border-line bg-white px-3 font-bold hover:bg-slate-50">Archive</button>
      {onExp && <button onClick={onExp} className="h-8 rounded-lg border border-line bg-white px-3 font-bold hover:bg-slate-50">Export</button>}
      <button onClick={onDel} className="h-8 rounded-lg border border-rose-200 bg-white px-3 font-bold text-rose-600 hover:bg-rose-50">Delete</button>
      <button onClick={() => setSel(new Set())} className="ml-auto font-bold text-sub hover:text-ink">Clear selection</button>
    </div>
  );
  const importBtn = <button onClick={() => fileRef.current?.click()} className={GHOST}><Upload className="size-4" />Import</button>;
  const selIds = [...sel];
  const bad = imp ? imp.rows.filter((r) => r.errors.length).length : 0;
  const heads = isProducts ? ["Name", "Category", "Size", "Sheets", "Price", "Status"] : ["Name", "Description", "Add-on Price", "Status"];

  return (
    <div className="min-w-0">
      {toast}{dialog}
      <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" data-testid="import-file" onChange={(e) => importFile(e.target.files?.[0])} />
      <PageHeader title="Masters" subtitle="Manage all configurable options used across the system.">
        {tab !== "Pricing Rules" && <PrimaryButton onClick={() => (isProducts ? openProduct() : openItem())}>{addLabel}</PrimaryButton>}
      </PageHeader>

      <div className="mb-5 overflow-x-auto"><LineTabs className="min-w-max" tabs={TABS.map((t) => ({ key: t, label: t }))} value={tab} onChange={changeTab} /></div>

      {tab === "Pricing Rules" ? <PricingRules show={show} /> : isProducts ? (
        <div className="grid gap-4 xl:grid-cols-[250px_minmax(0,1fr)]">
          <Panel title="Album Categories" bodyClassName="pt-3">
            <ul className="space-y-1 text-[13px]">
              {["All Categories", ...CATS].map((c) => {
                const n = c === "All Categories" ? products.filter((p) => !p.archived).length : countCat(c);
                const active = c === cat;
                return (
                  <li key={c}><button onClick={() => { setCat(c); setFCat([]); setPage(1); }} className={cx("flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left font-semibold", active ? "bg-brand-soft text-brand" : "hover:bg-slate-50")}>
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
                  {p.image ? <img src={p.image} alt={p.name} className="h-28 w-full object-cover" /> : <Thumb seed={i} size={160} rounded="rounded-none" className="!h-28 !w-full" />}
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

            <Panel title="Product List">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <SearchInput className="w-60" value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search product name, SKU, category..." />
                <MultiSelect className="w-44" label="All Categories" options={CATS} value={fCat} onChange={(v) => { setFCat(v); setPage(1); }} />
                <MultiSelect className="w-32" label="All Sizes" options={SIZES} value={fSize} onChange={(v) => { setFSize(v); setPage(1); }} />
                <MultiSelect className="w-36" label="All Status" options={["Active", "Inactive", "Archived"]} value={fStatus} onChange={(v) => { setFStatus(v); setPage(1); }} />
                <div className="ml-auto flex flex-wrap items-center gap-2">
                  <SavedViews<ProdView> storageKey="masters-products" current={{ q, fCat, fSize, fStatus, sort, hidden }} onApply={(v) => { setQ(v.q); setFCat(v.fCat); setFSize(v.fSize); setFStatus(v.fStatus); setSort(v.sort); setHidden(v.hidden); setPage(1); show("View applied"); }} />
                  <ColumnsMenu columns={PCOLS} hidden={hidden} onChange={setHidden} />
                  {importBtn}
                  <button onClick={exportCsv} className={GHOST}><Download className="size-4" />Export</button>
                </div>
              </div>
              <FilterChips chips={chips} onClearAll={clearFilters} />
              {bar(selIds, (a) => setProductActive(selIds, a), () => setProductArchived(selIds, true), () => delProducts(selIds, `${selIds.length} selected product${selIds.length > 1 ? "s" : ""}`), () => { downloadCsv("selected-products.csv", [["ID", "Name", "Category", "Size", "Sheets", "Price", "Status"], ...products.filter((p) => sel.has(p.id)).map((p) => [p.id, p.name, p.category, p.size, p.sheets, p.price, statusOf(p)])]); show(`Exported ${selIds.length} products`); })}
              <div className="overflow-x-auto">
                <table className={tableCls}>
                  <thead><tr>
                    <Th><input type="checkbox" aria-label="Select all on page" className="size-4 accent-[#3f4fe0]" checked={allOnPage} onChange={() => togglePage(rows.map((r) => r.id), allOnPage)} /></Th>
                    <SortTh k="id" sort={sort} onSort={setSort}>Product ID</SortTh><SortTh k="name" sort={sort} onSort={setSort}>Product Name</SortTh>
                    {colOn("category") && <SortTh k="category" sort={sort} onSort={setSort}>Category</SortTh>}
                    {colOn("size") && <SortTh k="size" sort={sort} onSort={setSort}>Size</SortTh>}
                    {colOn("sheets") && <SortTh k="sheets" sort={sort} onSort={setSort}>No. of Sheets</SortTh>}
                    {colOn("price") && <SortTh k="price" sort={sort} onSort={setSort}>Price</SortTh>}
                    {colOn("status") && <SortTh k="status" sort={sort} onSort={setSort}>Status</SortTh>}
                    <Th>Actions</Th>
                  </tr></thead>
                  <tbody>
                    {rows.map((p, i) => (
                      <tr key={p.id} className={cx(trCls, sel.has(p.id) && "bg-brand-soft/60", p.archived && "opacity-60")}>
                        <Td><input type="checkbox" aria-label={`Select ${p.name}`} className="size-4 accent-[#3f4fe0]" checked={sel.has(p.id)} onChange={() => toggleSel(p.id)} /></Td>
                        <Td className="font-bold">{p.id}</Td>
                        <Td><span className="flex items-center gap-2.5">{p.image ? <img src={p.image} alt="" className="size-8 rounded-lg object-cover" /> : <Thumb seed={i} size={32} />}{p.name}</span></Td>
                        {colOn("category") && <Td>{p.category}</Td>}{colOn("size") && <Td>{p.size}</Td>}{colOn("sheets") && <Td>{p.sheets}</Td>}{colOn("price") && <Td>{inr(p.price)}</Td>}
                        {colOn("status") && <Td><Pill tone={statusTone(statusOf(p))} dot>{statusOf(p)}</Pill></Td>}
                        <Td><span className="flex items-center gap-2"><button onClick={() => openProduct(p)} aria-label={`Edit ${p.name}`} className="text-sub hover:text-brand"><Pencil className="size-4" /></button><Toggle on={p.active} onChange={() => { setProductActive([p.id], !p.active); show(`${p.name} ${p.active ? "deactivated" : "activated"}`); }} />
                          <RowMenu label={`Actions for ${p.name}`} items={[
                            { label: "Edit", icon: Pencil, onClick: () => openProduct(p) },
                            { label: "Duplicate", icon: Copy, onClick: () => dupProduct(p) },
                            { label: p.active ? "Deactivate" : "Activate", icon: Power, onClick: () => { setProductActive([p.id], !p.active); show(`${p.name} ${p.active ? "deactivated" : "activated"}`); } },
                            p.archived ? { label: "Restore", icon: ArchiveRestore, onClick: () => { setProductArchived([p.id], false); show(`${p.name} restored`); } } : { label: "Archive", icon: Archive, onClick: () => { setProductArchived([p.id], true); show(`${p.name} archived. Hidden from new orders, history kept`); } },
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
        <Panel title={tab === "Other Masters" ? otherKey : tab} subtitle="SRS 3.1 - configurable master values used in order capture, pricing and production">
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {tab === "Other Masters" && <Combobox className="w-48" options={OTHER.map((o) => ({ value: o, label: o }))} value={otherKey} onChange={(v) => { setOtherKey(v as (typeof OTHER)[number]); setSel(new Set()); setQ(""); setFStatus([]); setSort(null); }} />}
            <SearchInput className="w-60" value={q} onChange={setQ} placeholder={`Search ${tab === "Other Masters" ? otherKey : tab}...`} />
            <MultiSelect className="w-36" label="All Status" options={["Active", "Inactive", "Archived"]} value={fStatus} onChange={setFStatus} />
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <SavedViews<ItemView> storageKey={`masters-items`} current={{ q, fStatus, sort, hidden }} onApply={(v) => { setQ(v.q); setFStatus(v.fStatus); setSort(v.sort); setHidden(v.hidden); show("View applied"); }} />
              <ColumnsMenu columns={[{ key: "detail", label: "Description" }, ...(hasPrice ? [{ key: "price", label: "Add-on Price" }] : []), { key: "status", label: "Status" }]} hidden={hidden} onChange={setHidden} />
              {importBtn}
              <button onClick={exportItems} className={GHOST}><Download className="size-4" />Export</button>
            </div>
          </div>
          <FilterChips chips={chips} onClearAll={clearFilters} />
          {bar(selIds, (a) => setItemActive(selIds, a), () => setItemArchived(selIds, true), () => delItems(selIds, `${selIds.length} selected entr${selIds.length > 1 ? "ies" : "y"}`))}
          <p className="mb-2 text-xs text-sub">{canReorder ? "Drag the grip handle to reorder rows. The order is used in dropdowns across the app." : "Clear sorting to enable drag-and-drop reordering."}</p>
          <div className="overflow-x-auto">
            <table className={tableCls}>
              <thead><tr><Th className="w-6"> </Th><Th><input type="checkbox" aria-label="Select all" className="size-4 accent-[#3f4fe0]" checked={list.length > 0 && list.every((x) => sel.has(x.id))} onChange={() => togglePage(list.map((x) => x.id), list.every((x) => sel.has(x.id)))} /></Th><Th>#</Th>
                <SortTh k="name" sort={sort} onSort={setSort}>Name</SortTh>
                {colOn("detail") && <SortTh k="detail" sort={sort} onSort={setSort}>Description</SortTh>}
                {hasPrice && colOn("price") && <SortTh k="price" sort={sort} onSort={setSort}>Add-on Price</SortTh>}
                {colOn("status") && <SortTh k="status" sort={sort} onSort={setSort}>Status</SortTh>}
                <Th>Actions</Th></tr></thead>
              <tbody>
                {list.map((it, i) => (
                  <tr key={it.id} data-testid="master-row" draggable={canReorder}
                    onDragStart={(e) => { if (!canReorder) return; setDragId(it.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", it.id); }}
                    onDragOver={(e) => { if (!dragId) return; e.preventDefault(); if (overId !== it.id) setOverId(it.id); }}
                    onDrop={(e) => { e.preventDefault(); if (dragId) reorder(dragId, it.id); setDragId(null); setOverId(null); }}
                    onDragEnd={() => { setDragId(null); setOverId(null); }}
                    className={cx(trCls, sel.has(it.id) && "bg-brand-soft/60", it.archived && "opacity-60", dragId === it.id && "opacity-40", overId === it.id && dragId && dragId !== it.id && "!border-t-2 !border-t-brand")}>
                    <Td><GripVertical aria-label={`Drag ${it.name}`} className={cx("size-4", canReorder ? "cursor-grab text-sub" : "cursor-not-allowed text-slate-300")} /></Td>
                    <Td><input type="checkbox" aria-label={`Select ${it.name}`} className="size-4 accent-[#3f4fe0]" checked={sel.has(it.id)} onChange={() => toggleSel(it.id)} /></Td>
                    <Td>{i + 1}</Td><Td className="font-semibold">{it.name}</Td>
                    {colOn("detail") && <Td className="text-sub">{it.detail}</Td>}
                    {hasPrice && colOn("price") && <Td>{it.price !== undefined ? inr(it.price) : "-"}</Td>}
                    {colOn("status") && <Td><Pill tone={statusTone(statusOf(it))} dot>{statusOf(it)}</Pill></Td>}
                    <Td><span className="flex items-center gap-2">
                      <button onClick={() => openItem(it)} aria-label={`Edit ${it.name}`} className="text-sub hover:text-brand"><Pencil className="size-4" /></button>
                      <Toggle on={it.active} onChange={() => { setItemActive([it.id], !it.active); show(`${it.name} ${it.active ? "deactivated" : "activated"}`); }} />
                      <RowMenu label={`Actions for ${it.name}`} items={[
                        { label: "Edit", icon: Pencil, onClick: () => openItem(it) },
                        { label: "Duplicate", icon: Copy, onClick: () => dupItem(it) },
                        { label: it.active ? "Deactivate" : "Activate", icon: Power, onClick: () => { setItemActive([it.id], !it.active); show(`${it.name} ${it.active ? "deactivated" : "activated"}`); } },
                        it.archived ? { label: "Restore", icon: ArchiveRestore, onClick: () => { setItemArchived([it.id], false); show(`${it.name} restored`); } } : { label: "Archive", icon: Archive, onClick: () => { setItemArchived([it.id], true); show(`${it.name} archived`); } },
                        { label: "Delete", icon: Trash2, danger: true, onClick: () => delItems([it.id], it.name) },
                      ]} />
                    </span></Td>
                  </tr>
                ))}
                {list.length === 0 && <tr><td colSpan={8} className="py-10 text-center text-sub">Nothing here. Use Add to create an entry or clear the filters.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="mt-4 flex items-center gap-4"><button onClick={() => openItem()} className="inline-flex items-center gap-1.5 text-sm font-bold text-brand"><Plus className="size-4" />{addLabel}</button>
            {chips.length > 0 && <button onClick={clearFilters} className="inline-flex items-center gap-1 text-xs font-bold text-sub"><RotateCcw className="size-3.5" />Reset filters</button>}</div>
        </Panel>
      )}

      {/* ---- Add / edit ---- */}
      <SlideOver width={slide?.kind === "product" ? 500 : 440} open={!!slide} onClose={() => setSlide(null)} title={`${slide?.id ? "Edit" : "Add"} ${slide?.kind === "product" ? "Product" : noun}`} footer={<>
        <button onClick={() => setSlide(null)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <PrimaryButton icon={Check} onClick={save}>Save</PrimaryButton>
      </>}>
        {slide?.kind === "product" && (
          <div className="mb-4">
            <span className="mb-1.5 block text-[13px] font-semibold">Product image</span>
            <div data-testid="drop-zone" onDragOver={(e) => { e.preventDefault(); setDropOver(true); }} onDragLeave={() => setDropOver(false)} onDrop={onDropImg}
              className={cx("relative grid h-36 place-items-center overflow-hidden rounded-xl border-2 border-dashed text-center text-xs text-sub", dropOver ? "border-brand bg-brand-soft" : "border-line bg-slate-50")}>
              {f.image ? (<>
                <img data-testid="img-preview" src={f.image} alt="Product preview" className="h-full w-full object-cover" />
                <button type="button" aria-label="Remove image" onClick={() => setF({ ...f, image: "" })} className="absolute right-2 top-2 grid size-7 place-items-center rounded-full bg-ink/70 text-white"><X className="size-4" /></button>
              </>) : (
                <label className="cursor-pointer p-4"><ImagePlus className="mx-auto mb-1 size-8 text-slate-400" /><b className="text-ink">Drop an image here</b> or <span className="font-bold text-brand">browse</span><br />PNG, JPG, WebP up to 5 MB
                  <input type="file" accept="image/*" data-testid="img-input" className="hidden" onChange={(e) => { setImage(e.target.files?.[0]); e.target.value = ""; }} /></label>
              )}
            </div>
          </div>
        )}
        <Field label="Name" required><input className={inputCls} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />{errs.name && <span className={ERR}>{errs.name}</span>}</Field>
        {slide?.kind === "product" ? (<>
          <Field label="SKU / Product ID" required hint="Auto-generated; edit only if you need a specific code.">
            <div className="flex gap-2"><input className={inputCls} value={f.sku} onChange={(e) => setF({ ...f, sku: e.target.value.toUpperCase() })} aria-label="SKU" />
              <button type="button" onClick={() => setF({ ...f, sku: nextPid() })} className="h-10 shrink-0 rounded-lg border border-line px-3 text-xs font-bold text-brand hover:bg-brand-soft">Auto-generate</button></div>
            {errs.sku && <span className={ERR}>{errs.sku}</span>}
          </Field>
          <div className="mb-4"><span className="mb-1.5 block text-[13px] font-semibold">Category <span className="text-rose-500">*</span></span><Combobox options={CATS.map((c) => ({ value: c, label: c }))} value={f.category} onChange={(v) => setF({ ...f, category: v })} /></div>
          <div className="mb-4"><span className="mb-1.5 block text-[13px] font-semibold">Size <span className="text-rose-500">*</span></span>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Size">{SIZES.map((s) => <button key={s} type="button" role="radio" aria-checked={f.size === s} onClick={() => setF({ ...f, size: s })} className={cx("h-8 rounded-full border px-3 text-xs font-bold", f.size === s ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{s}</button>)}</div></div>
          <div className="mb-4"><span className="mb-1.5 block text-[13px] font-semibold">No. of sheets <span className="text-rose-500">*</span></span>
            <div className="flex flex-wrap items-center gap-1.5">{SHEETS.map((s) => <button key={s} type="button" aria-pressed={f.sheets === String(s)} onClick={() => setF({ ...f, sheets: String(s) })} className={cx("h-8 rounded-full border px-3 text-xs font-bold", f.sheets === String(s) ? "border-brand bg-brand text-white" : "border-line hover:bg-brand-soft")}>{s}</button>)}
              <input type="number" min={1} aria-label="Custom sheets" className="h-8 w-20 rounded-lg border border-line px-2 text-xs outline-none focus:border-brand" value={f.sheets} onChange={(e) => setF({ ...f, sheets: e.target.value })} /></div>
            {errs.sheets && <span className={ERR}>{errs.sheets}</span>}</div>
          <Field label="Base Price (INR, excl. GST)" required><input type="number" min={0} className={inputCls} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />{errs.price && <span className={ERR}>{errs.price}</span>}</Field>
          <div data-testid="gst-line" className="-mt-2 mb-4 rounded-lg bg-brand-soft px-3 py-2 text-xs font-semibold text-brand">{inr(priceNum >= 0 ? Math.round(priceNum) : 0)} + GST {Math.round(GST_RATE * 100)}% ({inr(priceNum >= 0 ? gstAmt : 0)}) = <b>{inr(priceNum >= 0 ? gross : 0)} incl. GST</b></div>
          <div className="mb-4 rounded-lg border border-line px-3 py-2 text-xs text-sub" data-testid="used-in">Used in <b className="text-ink">{usedIn({ size: f.size })} orders</b> with the {f.size} size. {slide.id ? "Archive instead of deleting to keep history." : "New products start unused."}</div>
        </>) : (<>
          <Field label="Description"><input className={inputCls} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
          {hasPrice && <Field label="Add-on Price (INR)"><input type="number" min={0} className={inputCls} value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />{errs.price && <span className={ERR}>{errs.price}</span>}</Field>}
          {usedInItem(tab, f.name) > 0 && <div className="mb-4 rounded-lg border border-line px-3 py-2 text-xs text-sub">Used in <b className="text-ink">{usedInItem(tab, f.name)} orders</b>.</div>}
        </>)}
        <div className="flex items-center justify-between rounded-lg border border-line px-3 py-2.5 text-sm font-semibold">Active <Toggle on={f.active} onChange={(v) => setF({ ...f, active: v })} /></div>
      </SlideOver>

      {/* ---- Import preview ---- */}
      <SlideOver width={760} open={!!imp} onClose={() => setImp(null)} title={`Import preview${imp ? ` - ${imp.fileName}` : ""}`} footer={<>
        <button onClick={downloadTemplate} className="mr-auto h-10 rounded-lg border border-line px-3 text-xs font-bold hover:bg-brand-soft">Download template</button>
        <button onClick={() => setImp(null)} className="h-11 px-5 text-sm font-bold">Cancel</button>
        <button disabled={!imp || imp.rows.length - bad === 0} onClick={commitImport} className="h-11 rounded-xl bg-brand px-5 text-sm font-bold text-white disabled:opacity-40">Import {imp ? imp.rows.length - bad : 0} valid row{imp && imp.rows.length - bad === 1 ? "" : "s"}</button>
      </>}>
        {imp && (<>
          <div className="mb-3 flex gap-3 text-sm" data-testid="import-summary"><Pill tone="green">{imp.rows.length - bad} valid</Pill><Pill tone={bad ? "red" : "slate"}>{bad} invalid</Pill><span className="text-sub">Invalid rows are skipped. Expected columns: {heads.join(", ")}.</span></div>
          <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full text-xs">
            <thead><tr className="bg-slate-50"><Th>Line</Th>{heads.map((h) => <Th key={h}>{h}</Th>)}<Th>Result</Th></tr></thead>
            <tbody>{imp.rows.map((r) => (
              <tr key={r.line} data-valid={!r.errors.length} className={cx("border-t border-line", r.errors.length ? "bg-rose-50/60" : "")}>
                <Td>{r.line}</Td>{heads.map((_, i) => <Td key={i}>{r.cells[i] ?? ""}</Td>)}
                <Td>{r.errors.length ? <span className="font-semibold text-rose-600">{r.errors.join("; ")}</span> : <span className="inline-flex items-center gap-1 font-semibold text-emerald-600"><Check className="size-3.5" />OK</span>}</Td>
              </tr>))}
              {imp.rows.length === 0 && <tr><td colSpan={heads.length + 2} className="py-6 text-center text-sub">No data rows found.</td></tr>}</tbody>
          </table></div>
        </>)}
      </SlideOver>
    </div>
  );
}

/* ───────────── SRS §3.2 Pricing Rules (persisted; read by lib/pricing.ts and the New Order wizard) ───────────── */
type MapKey = "albumTypes" | "paper" | "covers" | "lamination" | "boxes" | "finishes";
const MAP_SECTIONS: { key: MapKey; title: string; unit: string; hint: string }[] = [
  { key: "albumTypes", title: "Album types", unit: "per copy", hint: "Base price per album copy" },
  { key: "paper", title: "Paper (per sheet)", unit: "per sheet", hint: "Charged per sheet per copy" },
  { key: "covers", title: "Cover types", unit: "per copy", hint: "Add-on per copy" },
  { key: "lamination", title: "Lamination", unit: "per copy", hint: "Add-on per copy" },
  { key: "boxes", title: "Boxes", unit: "per copy", hint: "Add-on per copy" },
  { key: "finishes", title: "Finishes", unit: "per copy", hint: "Add-on per copy" },
];
const SCALARS: { key: "designCharge" | "gradingPerImage" | "gstPct" | "discountApprovalPct"; label: string; unit: string; max?: number; hint: string }[] = [
  { key: "designCharge", label: "Design charge", unit: "INR / order", hint: "Applied when the order includes design (ALB-FR-0033)" },
  { key: "gradingPerImage", label: "Colour grading", unit: "INR / image", hint: "Per image on designed orders (ALB-FR-0034)" },
  { key: "gstPct", label: "GST", unit: "%", max: 100, hint: "Applied on the discounted subtotal (ALB-FR-0037)" },
  { key: "discountApprovalPct", label: "Discount needing admin approval", unit: "%", max: 100, hint: "Discounts above this need approval (ALB-FR-0036)" },
];

function PricingRules({ show }: { show: (m: string) => void }) {
  const [saved, setSaved] = useState<PricingSnapshot>(() => snapshotPricing());
  const [d, setD] = useState<PricingSnapshot>(saved);
  const [adding, setAdding] = useState<Record<string, { name: string; price: string }>>({});
  const [errs, setErrs] = useState<Record<string, string>>({});
  const dirty = JSON.stringify(d) !== JSON.stringify(saved);

  const setPrice = (sec: MapKey, name: string, v: string) => setD((x) => ({ ...x, [sec]: { ...x[sec], [name]: v === "" ? ("" as unknown as number) : Number(v) } }));
  const remove = (sec: MapKey, name: string) => setD((x) => { const m = { ...x[sec] }; delete m[name]; return { ...x, [sec]: m }; });
  const add = (sec: MapKey) => {
    const a = adding[sec] ?? { name: "", price: "" };
    const name = a.name.trim();
    if (!name) { setErrs((e) => ({ ...e, [sec]: "Enter a name" })); return; }
    if (Object.keys(d[sec]).some((k) => k.toLowerCase() === name.toLowerCase())) { setErrs((e) => ({ ...e, [sec]: "That name already exists" })); return; }
    if (a.price === "" || !(Number(a.price) >= 0)) { setErrs((e) => ({ ...e, [sec]: "Enter a price of 0 or more" })); return; }
    setD((x) => ({ ...x, [sec]: { ...x[sec], [name]: Number(a.price) } }));
    setAdding((s) => ({ ...s, [sec]: { name: "", price: "" } })); setErrs((e) => ({ ...e, [sec]: "" }));
  };
  const validate = () => {
    const e: Record<string, string> = {};
    MAP_SECTIONS.forEach((s) => { if (Object.values(d[s.key]).some((v) => v === ("" as unknown) || !(Number(v) >= 0))) e[s.key] = "Every price must be a number of 0 or more"; });
    SCALARS.forEach((s) => { const v = d[s.key] as unknown; if (v === "" || !(Number(v) >= 0) || (s.max !== undefined && Number(v) > s.max)) e[s.key] = `Enter ${s.max !== undefined ? `0 to ${s.max}` : "0 or more"}`; });
    return e;
  };
  const save = () => {
    const e = validate(); setErrs(e);
    if (Object.keys(e).length) { show("Fix the highlighted prices before saving"); return; }
    const changes: [string, string, string][] = [];
    MAP_SECTIONS.forEach((s) => {
      const names = new Set([...Object.keys(saved[s.key]), ...Object.keys(d[s.key])]);
      names.forEach((n) => { const a = saved[s.key][n], b = d[s.key][n]; if (a !== b) changes.push([`${s.title}: ${n}`, a === undefined ? "(new)" : String(a), b === undefined ? "(removed)" : String(b)]); });
    });
    SCALARS.forEach((s) => { if (saved[s.key] !== d[s.key]) changes.push([s.label, String(saved[s.key]), String(d[s.key])]); });
    applyPricing(d);
    changes.slice(0, 40).forEach(([what, from, to]) => logAudit({ entity: "pricing", entityId: what, action: "price_change", from, to }));
    setSaved(d); show(`Pricing saved: ${changes.length} change${changes.length === 1 ? "" : "s"} now apply to new orders`);
  };
  const reset = () => { setD(pricingDefaults()); setErrs({}); show("Defaults loaded. Save to apply"); };

  return (
    <div data-testid="pricing-rules">
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-white p-4">
        <div className="min-w-0 flex-1"><h2 className="text-[17px] font-extrabold">Pricing Rules</h2><p className="text-xs text-sub">Used by the New Order wizard and quotations (SRS 3.2). Changes affect new orders only; existing order totals are unchanged.</p></div>
        {dirty && <span className="text-xs font-bold text-amber-600" data-testid="pricing-dirty">Unsaved changes</span>}
        <button onClick={reset} className={GHOST}><RotateCcw className="size-4" />Load defaults</button>
        <button onClick={() => { setD(saved); setErrs({}); }} disabled={!dirty} className={cx(GHOST, "disabled:opacity-40")}>Discard</button>
        <button onClick={save} disabled={!dirty} data-testid="pricing-save" className="inline-flex h-10 items-center gap-2 rounded-lg bg-brand px-4 text-[13px] font-bold text-white hover:bg-brand-dark disabled:opacity-40"><Check className="size-4" />Save pricing</button>
      </div>
      <div className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {SCALARS.map((s) => (
          <Panel key={s.key}>
            <label className="block"><span className="text-[13px] font-bold">{s.label}</span>
              <div className="mt-2 flex items-center gap-2"><input type="number" min={0} aria-label={s.label} value={d[s.key]} onChange={(e) => setD({ ...d, [s.key]: e.target.value === "" ? ("" as unknown as number) : Number(e.target.value) })} className={cx(inputCls, errs[s.key] && "!border-rose-400")} /><span className="shrink-0 text-xs text-sub">{s.unit}</span></div>
              <span className="mt-1 block text-[11px] text-sub">{s.hint}</span></label>
            {errs[s.key] && <span className={ERR}>{errs[s.key]}</span>}
          </Panel>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
        {MAP_SECTIONS.map((s) => {
          const a = adding[s.key] ?? { name: "", price: "" };
          return (
            <Panel key={s.key} title={s.title} subtitle={s.hint}>
              <ul className="space-y-2">
                {Object.entries(d[s.key]).map(([name, v]) => (
                  <li key={name} className="flex items-center gap-2">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{name}</span>
                    <span className="text-xs text-sub">₹</span>
                    <input type="number" min={0} aria-label={`${s.title}: ${name}`} value={v as number} onChange={(e) => setPrice(s.key, name, e.target.value)} className="h-9 w-24 rounded-lg border border-line px-2 text-right text-sm outline-none focus:border-brand" />
                    <span className="w-14 text-[11px] text-sub">{s.unit}</span>
                    <button aria-label={`Remove ${name}`} onClick={() => remove(s.key, name)} className="text-sub hover:text-rose-600"><Trash2 className="size-4" /></button>
                  </li>
                ))}
              </ul>
              <div className="mt-3 flex items-center gap-2 border-t border-line pt-3">
                <input aria-label={`New ${s.title} name`} placeholder="New name" value={a.name} onChange={(e) => setAdding({ ...adding, [s.key]: { ...a, name: e.target.value } })} className="h-9 min-w-0 flex-1 rounded-lg border border-line px-2 text-sm outline-none focus:border-brand" />
                <input type="number" min={0} aria-label={`New ${s.title} price`} placeholder="Price" value={a.price} onChange={(e) => setAdding({ ...adding, [s.key]: { ...a, price: e.target.value } })} className="h-9 w-20 rounded-lg border border-line px-2 text-right text-sm outline-none focus:border-brand" />
                <button onClick={() => add(s.key)} className="grid size-9 place-items-center rounded-lg border border-line text-brand hover:bg-brand-soft" aria-label={`Add ${s.title}`}><Plus className="size-4" /></button>
              </div>
              {errs[s.key] && <span className={ERR}>{errs[s.key]}</span>}
            </Panel>
          );
        })}
      </div>
    </div>
  );
}
