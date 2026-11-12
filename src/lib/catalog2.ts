import { persistArray } from "./persist";
import { backendOn } from "./supabase";
import { notify } from "./store";
import { logAudit } from "./audit";
import { PRODUCT_LIST } from "./productList";

// The order catalog: Category → Subcategory → Level 3 → Level 4 → Items, with configurable pricing (supabase/migrations/0036).
// Items can sit at any level; deeper levels are optional. Prices are never hardcoded: every item has a pricing method, an optional standard rate,
// and rate rules for requirement combinations (size / paper / finish). Demo mode keeps it in this browser; database mode loads it from the server.
export type PricingMethod = "fixed_per_album" | "per_sheet" | "per_unit" | "one_time_order";
export type OptionKind = "printing" | "design" | "cover" | "binding" | "box";
export interface Category { id: string; parentId: string | null; name: string; depth: number; sort: number; active: boolean; sample?: boolean }
export interface CItem { id: string; categoryId: string; name: string; code?: string; description?: string; method: PricingMethod; rate: number | null; unit: string; kind?: OptionKind; sort: number; active: boolean; sample?: boolean }
export interface Rate { id: string; itemId: string; size?: string; paper?: string; finish?: string; rate: number }
/** printingMode: "separate" = every album gets a printing line (printing rate card × sheets); "included" = no separate printing charge
 *  (the per-sheet paper / lamination prices already include printing). Older databases without the setting behave as "separate". */
export type PrintingMode = "included" | "separate";
/** showBusinessName: whether invoices show your company name by default; brandRoles: roles (besides admin) that may change it on an order. */
export interface PricingSettings { taxEnabled: boolean; taxLabel: string; taxRate: number; defaultDeliveryDays: number; printingMode?: PrintingMode; showBusinessName?: boolean; brandRoles?: string[] }

export const METHOD_LABEL: Record<PricingMethod, string> = { per_sheet: "Rate per sheet (per copy)", per_unit: "Rate per item / unit (per copy)", fixed_per_album: "Fixed amount per album", one_time_order: "One-time charge per order" };
export const SCOPE_LABEL = { copy: "Per copy", album: "Per album", order: "Per order" } as const;
export const KIND_LABEL: Record<OptionKind, string> = { printing: "Printing rate card", design: "Design rate card", cover: "Cover option", binding: "Binding option", box: "Box option" };
export const MAX_DEPTH = 4;

export const CATEGORIES: Category[] = persistArray<Category>("cat2_categories", []);
export const ITEMS: CItem[] = persistArray<CItem>("cat2_items", []);
export const RATES: Rate[] = persistArray<Rate>("cat2_rates", []);
const SETTINGS: PricingSettings[] = persistArray<PricingSettings>("cat2_settings", []);
export const DEFAULT_PRICING_SETTINGS: PricingSettings = { taxEnabled: false, taxLabel: "Tax", taxRate: 0, defaultDeliveryDays: 14, printingMode: "separate", showBusinessName: true, brandRoles: [] };
export const pricingSettings = (): PricingSettings => ({ ...DEFAULT_PRICING_SETTINGS, ...(SETTINGS[0] ?? {}) });

export function replaceCatalog(p: { categories?: Category[]; items?: CItem[]; rates?: Rate[]; settings?: PricingSettings }) {
  if (p.categories) CATEGORIES.splice(0, CATEGORIES.length, ...p.categories);
  if (p.items) ITEMS.splice(0, ITEMS.length, ...p.items);
  if (p.rates) RATES.splice(0, RATES.length, ...p.rates);
  if (p.settings) SETTINGS.splice(0, SETTINGS.length, p.settings);
  notify();
}

// ───────── tree helpers ─────────
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();
const bySort = <T extends { sort: number; name: string }>(a: T, b: T) => a.sort - b.sort || a.name.localeCompare(b.name);
export const categoryById = (id: string | null | undefined) => (id ? CATEGORIES.find((c) => c.id === id) : undefined);
export const childrenOf = (parentId: string | null, activeOnly = false) => CATEGORIES.filter((c) => c.parentId === parentId && (!activeOnly || c.active)).sort(bySort);
export function pathOf(id: string | null | undefined): Category[] {
  const out: Category[] = []; let c = categoryById(id); let guard = 0;
  while (c && guard++ < 10) { out.unshift(c); c = categoryById(c.parentId); }
  return out;
}
export const pathLabel = (id: string | null | undefined) => pathOf(id).map((c) => c.name).join(" ▸ ");
/** Active only when it and every parent are active (a deactivated parent hides its whole branch from new orders). */
export const isLive = (id: string | null | undefined) => { const p = pathOf(id); return p.length > 0 && p.every((c) => c.active); };
export function descendantsOf(id: string): string[] {
  const out: string[] = []; const walk = (p: string) => CATEGORIES.filter((c) => c.parentId === p).forEach((c) => { out.push(c.id); walk(c.id); }); walk(id); return out;
}
const heightOf = (id: string): number => { const kids = CATEGORIES.filter((c) => c.parentId === id); return kids.length ? 1 + Math.max(...kids.map((k) => heightOf(k.id))) : 0; };
export const itemsIn = (categoryId: string, activeOnly = false) => ITEMS.filter((i) => i.categoryId === categoryId && (!activeOnly || i.active)).sort(bySort);
export const itemById = (id: string) => ITEMS.find((i) => i.id === id);
/** Items an order can use now: the item and its whole category branch are active. */
export const usableItem = (i: CItem | undefined) => !!i && i.active && isLive(i.categoryId);
/** Does this branch hold anything usable for the given filter (so the picker never shows empty levels)? */
export function branchHas(categoryId: string, accept: (i: CItem) => boolean): boolean {
  if (!isLive(categoryId)) return false;
  if (ITEMS.some((i) => i.categoryId === categoryId && i.active && accept(i))) return true;
  return CATEGORIES.some((c) => c.parentId === categoryId && c.active && branchHas(c.id, accept));
}
export const optionItems = (kind: OptionKind) => ITEMS.filter((i) => i.kind === kind && usableItem(i)).sort(bySort);
export const rateCard = (kind: "printing" | "design") => ITEMS.find((i) => i.kind === kind && i.active);

// ───────── writes (validated here and again by the database) ─────────
type Backend = {
  saveCategory: (c: Omit<Category, "depth"> & { isNew: boolean }) => Promise<string | null>;
  saveItem: (i: CItem & { isNew: boolean }) => Promise<string | null>;
  saveRate: (r: Rate & { isNew: boolean }) => Promise<string | null>;
  removeRate: (id: string) => Promise<string | null>;
  saveSettings: (s: PricingSettings) => Promise<string | null>;
  importClassic: () => Promise<number | string>;
  importTree: (entries: TreeEntry[]) => Promise<number | string>;
  setPrices: (rows: PriceRow[]) => Promise<string | null>;
  deleteItem: (id: string) => Promise<string | null>;
  deleteCategory: (id: string) => Promise<string | null>;
  load: () => Promise<string | null>;
};
let backend: Backend | null = null;
export const registerCatalog2Backend = (b: Backend) => { backend = b; };
export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `id${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`);
const NOT_CONNECTED = "Not connected to the database";

export async function loadCatalog2(): Promise<string | null> { return backendOn ? (backend ? backend.load() : NOT_CONNECTED) : null; }

export function categoryError(d: { id?: string; parentId: string | null; name: string }): string | null {
  const name = d.name.trim().replace(/\s+/g, " ");
  if (!name) return "Enter a category name";
  if (name.length > 100) return "The name is too long (100 characters max)";
  if (d.parentId && !categoryById(d.parentId)) return "Choose a valid parent category";
  if (d.id && d.parentId && (d.parentId === d.id || descendantsOf(d.id).includes(d.parentId))) return "A category cannot be placed under itself or one of its own sub-categories";
  const depth = d.parentId ? (categoryById(d.parentId)!.depth + 1) : 1;
  if (depth + (d.id ? heightOf(d.id) : 0) > MAX_DEPTH) return `Categories can be at most ${MAX_DEPTH} levels deep`;
  if (CATEGORIES.some((c) => c.id !== d.id && c.parentId === d.parentId && norm(c.name) === norm(name))) return `“${name}” already exists here`;
  return null;
}

export async function saveCategory(d: { id?: string; parentId: string | null; name: string; sort?: number; active?: boolean; sample?: boolean }): Promise<{ id: string } | { error: string }> {
  const err = categoryError(d); if (err) return { error: err };
  const name = d.name.trim().replace(/\s+/g, " ");
  const prev = d.id ? categoryById(d.id) : undefined;
  const rec: Category = { id: d.id ?? newId(), parentId: d.parentId, name, depth: d.parentId ? categoryById(d.parentId)!.depth + 1 : 1, sort: d.sort ?? prev?.sort ?? childrenOf(d.parentId).length + 1, active: d.active ?? prev?.active ?? true, sample: d.sample ?? prev?.sample };
  if (backendOn) { if (!backend) return { error: NOT_CONNECTED }; const e = await backend.saveCategory({ ...rec, isNew: !prev }); if (e) return { error: e }; }
  if (prev) Object.assign(prev, rec); else CATEGORIES.push(rec);
  const relevel = (pid: string, depth: number) => CATEGORIES.filter((c) => c.parentId === pid).forEach((c) => { c.depth = depth + 1; relevel(c.id, c.depth); });
  relevel(rec.id, rec.depth);
  notify();
  if (!backendOn) logAudit({ entity: "catalog_category", entityId: rec.id, action: prev ? "update" : "create", detail: pathLabel(rec.id) + (rec.active ? "" : " (inactive)") });
  return { id: rec.id };
}

export function itemError(d: Partial<CItem> & { categoryId: string; name: string; method: PricingMethod }): string | null {
  const name = d.name.trim().replace(/\s+/g, " ");
  if (!categoryById(d.categoryId)) return "Choose the category this item belongs to";
  if (!name) return "Enter the item name";
  if (name.length > 150) return "The name is too long (150 characters max)";
  if (d.rate != null && (!Number.isFinite(d.rate) || d.rate < 0)) return "The rate must be 0 or more";
  if (d.rate != null && Math.round(d.rate * 100) !== d.rate * 100 && Math.abs(Math.round(d.rate * 100) - d.rate * 100) > 1e-6) return "Use at most 2 decimals for the rate";
  if (!(d.unit ?? "").trim()) return "Enter the unit (for example pcs, sheet, album)";
  if ((d.kind === "printing" || d.kind === "design") && d.method !== "per_sheet") return "Printing and design are priced per sheet";
  if ((d.kind === "cover" || d.kind === "binding" || d.kind === "box") && !(d.method === "per_unit" || d.method === "fixed_per_album")) return "Cover, binding and box options are priced per unit or per album";
  if ((d.kind === "printing" || d.kind === "design") && (d.active ?? true) && ITEMS.some((i) => i.id !== d.id && i.kind === d.kind && i.active)) return `There is already an active ${d.kind} rate card — deactivate it first`;
  if (ITEMS.some((i) => i.id !== d.id && i.categoryId === d.categoryId && norm(i.name) === norm(name))) return `“${name}” already exists in this category`;
  const code = (d.code ?? "").trim();
  if (code && ITEMS.some((i) => i.id !== d.id && (i.code ?? "").trim().toLowerCase() === code.toLowerCase())) return `The code “${code}” is already used`;
  return null;
}
export async function saveItem(d: Partial<CItem> & { categoryId: string; name: string; method: PricingMethod }): Promise<{ id: string } | { error: string }> {
  const err = itemError(d); if (err) return { error: err };
  const prev = d.id ? itemById(d.id) : undefined;
  const rec: CItem = {
    id: d.id ?? newId(), categoryId: d.categoryId, name: d.name.trim().replace(/\s+/g, " "), code: d.code?.trim() || undefined, description: d.description?.trim() || undefined, method: d.method,
    rate: d.rate == null || Number.isNaN(d.rate) ? null : Math.round(d.rate * 100) / 100, unit: (d.unit ?? "pcs").trim(), kind: d.kind || undefined, sort: d.sort ?? prev?.sort ?? itemsIn(d.categoryId).length + 1,
    active: d.active ?? prev?.active ?? true, sample: d.sample ?? prev?.sample,
  };
  if (backendOn) { if (!backend) return { error: NOT_CONNECTED }; const e = await backend.saveItem({ ...rec, isNew: !prev }); if (e) return { error: e }; }
  if (prev) Object.assign(prev, rec); else ITEMS.push(rec);
  notify();
  if (!backendOn) logAudit({ entity: "catalog_item", entityId: rec.id, action: prev ? "update" : "create", detail: `${pathLabel(rec.categoryId)} ▸ ${rec.name} · ${METHOD_LABEL[rec.method]} · ${rec.rate ?? "rules only"}` });
  return { id: rec.id };
}

const cond = (s?: string) => (s ?? "").trim() || undefined;
export function rateError(r: { id?: string; itemId: string; size?: string; paper?: string; finish?: string; rate: number }): string | null {
  if (!itemById(r.itemId)) return "Item not found";
  if (!cond(r.size) && !cond(r.paper) && !cond(r.finish)) return "Choose at least one requirement (size, paper or finish) — use the item's standard rate for “any”";
  if (!Number.isFinite(r.rate) || r.rate < 0) return "The rate must be 0 or more";
  const k = (x: { size?: string; paper?: string; finish?: string }) => [cond(x.size), cond(x.paper), cond(x.finish)].map((v) => (v ?? "").toLowerCase()).join("|");
  if (RATES.some((x) => x.id !== r.id && x.itemId === r.itemId && k(x) === k(r))) return "A rate for exactly this combination already exists";
  return null;
}
export async function saveRate(r: { id?: string; itemId: string; size?: string; paper?: string; finish?: string; rate: number }): Promise<string | null> {
  const err = rateError(r); if (err) return err;
  const prev = r.id ? RATES.find((x) => x.id === r.id) : undefined;
  const rec: Rate = { id: r.id ?? newId(), itemId: r.itemId, size: cond(r.size), paper: cond(r.paper), finish: cond(r.finish), rate: Math.round(r.rate * 100) / 100 };
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.saveRate({ ...rec, isNew: !prev }); if (e) return e; }
  if (prev) Object.assign(prev, rec); else RATES.push(rec);
  notify(); return null;
}
export async function removeRate(id: string): Promise<string | null> {
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.removeRate(id); if (e) return e; }
  const i = RATES.findIndex((x) => x.id === id); if (i >= 0) RATES.splice(i, 1);
  notify(); return null;
}
export async function savePricingSettings(s: PricingSettings): Promise<string | null> {
  if (!s.taxLabel.trim()) return "Enter the tax label (for example GST)";
  if (!(s.taxRate >= 0 && s.taxRate <= 100)) return "The tax rate must be between 0 and 100%";
  if (!(Number.isInteger(s.defaultDeliveryDays) && s.defaultDeliveryDays >= 0 && s.defaultDeliveryDays <= 365)) return "Default delivery days must be a whole number from 0 to 365";
  if (s.printingMode && s.printingMode !== "included" && s.printingMode !== "separate") return "Choose how printing is charged";
  const rec = { ...s, taxLabel: s.taxLabel.trim(), taxRate: Math.round(s.taxRate * 100) / 100 };
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.saveSettings(rec); if (e) return e; }
  SETTINGS.splice(0, SETTINGS.length, rec); notify(); return null;
}
/** Database mode: copy the classic product catalog into this hierarchy (the migration did it once; safe to repeat). */
export async function importClassic(): Promise<number | string> {
  if (!backendOn) return "The classic catalog is copied automatically in database mode";
  if (!backend) return NOT_CONNECTED;
  return backend.importClassic();
}

// ───────── sample catalog (clearly labelled demonstration prices) ─────────
/** Adds a small SAMPLE catalog with DEMONSTRATION prices, every entry flagged as a sample. Replace or deactivate them before real use. */
export async function loadSampleCatalog(): Promise<string | null> {
  const cat = async (name: string, parentId: string | null = null) => {
    const ex = CATEGORIES.find((c) => c.parentId === parentId && norm(c.name) === norm(name)); if (ex) return ex.id;
    const r = await saveCategory({ parentId, name, sample: true }); if ("error" in r) throw new Error(r.error); return r.id;
  };
  const item = async (categoryId: string, d: Omit<Partial<CItem>, "categoryId"> & { name: string; method: PricingMethod }) => {
    const ex = ITEMS.find((i) => i.categoryId === categoryId && norm(i.name) === norm(d.name)); if (ex) return ex.id;
    if ((d.kind === "printing" || d.kind === "design") && ITEMS.some((i) => i.kind === d.kind && i.active)) return null;          // keep the admin's own rate card
    const r = await saveItem({ ...d, categoryId, sample: true, unit: d.unit ?? "pcs" }); if ("error" in r) throw new Error(r.error); return r.id;
  };
  try {
    const printing = await cat("Sample — Printing"), design = await cat("Sample — Design");
    const covers = await cat("Sample — Covers"), binding = await cat("Sample — Binding"), boxes = await cat("Sample — Boxes");
    const extras = await cat("Sample — Extras"), premium = await cat("Premium", extras), keepsakes = await cat("Keepsakes", premium);
    const charges = await cat("Sample — Order charges");
    const prn = await item(printing, { name: "Album printing (sample rates)", code: "SAMPLE-PRN", method: "per_sheet", unit: "sheet", kind: "printing", rate: 90, description: "Demonstration rates — replace before use" });
    if (prn) for (const r of [{ size: "12x36", rate: 120 }, { size: "12x36", paper: "Metallic", rate: 150 }, { size: "12x30", rate: 110 }, { paper: "Silk", rate: 95 }]) await saveRate({ itemId: prn, ...r });
    await item(design, { name: "Album design (sample rate)", code: "SAMPLE-DSN", method: "per_sheet", unit: "sheet", kind: "design", rate: 40, description: "Demonstration rate — replace before use" });
    await item(covers, { name: "Leatherette cover (sample)", method: "per_unit", unit: "pcs", kind: "cover", rate: 600 });
    await item(covers, { name: "Acrylic cover (sample)", method: "per_unit", unit: "pcs", kind: "cover", rate: 1500 });
    await item(binding, { name: "Lay-flat binding (sample)", method: "per_unit", unit: "pcs", kind: "binding", rate: 300 });
    await item(boxes, { name: "Premium box (sample)", method: "per_unit", unit: "pcs", kind: "box", rate: 900 });
    await item(extras, { name: "Name foiling (sample)", method: "fixed_per_album", unit: "album", rate: 800 });
    await item(premium, { name: "UV spot finish (sample, per sheet)", method: "per_sheet", unit: "sheet", rate: 15 });
    await item(keepsakes, { name: "Mini book (sample)", method: "per_unit", unit: "pcs", rate: 450 });
    await item(charges, { name: "Courier packing (sample)", method: "one_time_order", unit: "order", rate: 250 });
    return null;
  } catch (e) { return (e as Error).message; }
}

/** Demo mode starts with the sample catalog so the order builder works out of the box (every entry is labelled as a sample). */
export function seedDemoCatalog() {
  if (backendOn || CATEGORIES.length) return;
  try { if (localStorage.getItem("albumpro.v1.cat2_seeded")) return; localStorage.setItem("albumpro.v1.cat2_seeded", "1"); } catch { /* private mode */ }
  void loadSampleCatalog();
}

// ───────── bulk tools: product list import, price grid, CSV ─────────
export interface TreeEntry { path: string[]; item: string; method: PricingMethod; unit: string }
export interface PriceRow { id: string; rate: number | null; method: PricingMethod; unit: string }

/** Paper and lamination are charged per sheet; everything else in the product list per piece. */
const GROUP_METHOD: Record<string, [PricingMethod, string]> = { Paper: ["per_sheet", "sheet"], Lamination: ["per_sheet", "sheet"] };
export const productListEntries = (): TreeEntry[] => PRODUCT_LIST.map((p) => {
  const [method, unit] = GROUP_METHOD[p[0]!] ?? ["per_unit", "pcs"];
  return { path: p.slice(0, -1), item: p[p.length - 1]!, method, unit };
});

/** Creates the missing categories and items of a hierarchy (existing ones and their prices are kept). Returns how many items were added. */
export async function importTree(entries: TreeEntry[]): Promise<number | string> {
  for (const [i, e] of entries.entries()) {
    if (e.path.length < 1 || e.path.length > MAX_DEPTH) return `Row ${i + 1}: between 1 and ${MAX_DEPTH} category levels are needed`;
    if (!e.item.trim() || e.path.some((x) => !x.trim())) return `Row ${i + 1}: a name is missing`;
    if (!(e.method in METHOD_LABEL)) return `Row ${i + 1}: unknown pricing method “${e.method}”`;
  }
  if (backendOn) { if (!backend) return NOT_CONNECTED; return backend.importTree(entries); }
  let added = 0;
  for (const e of entries) {
    let parent: string | null = null, depth = 0;
    for (const raw of e.path) {
      const name = raw.trim().replace(/\s+/g, " "); depth++;
      let c = CATEGORIES.find((x) => x.parentId === parent && norm(x.name) === norm(name));
      if (!c) { c = { id: newId(), parentId: parent, name, depth, sort: childrenOf(parent).length + 1, active: true }; CATEGORIES.push(c); }
      parent = c.id;
    }
    const name = e.item.trim().replace(/\s+/g, " ");
    if (ITEMS.some((i) => i.categoryId === parent && norm(i.name) === norm(name))) continue;
    ITEMS.push({ id: newId(), categoryId: parent!, name, method: e.method, rate: null, unit: e.unit || "pcs", sort: itemsIn(parent!).length + 1, active: true });
    added++;
  }
  notify();
  if (added) logAudit({ entity: "catalog_item", entityId: "import", action: "create", detail: `Imported ${added} item(s) into the catalog` });
  return added;
}
export const importProductList = () => importTree(productListEntries());

export function priceRowError(r: PriceRow): string | null {
  const i = itemById(r.id); if (!i) return "Item not found";
  if (r.rate != null && (!Number.isFinite(r.rate) || r.rate < 0)) return `${i.name}: the rate must be 0 or more`;
  if (r.rate != null && Math.abs(Math.round(r.rate * 100) - r.rate * 100) > 1e-6) return `${i.name}: use at most 2 decimals`;
  if (!r.unit.trim() || r.unit.trim().length > 20) return `${i.name}: enter a unit (20 characters max)`;
  if ((i.kind === "printing" || i.kind === "design") && r.method !== "per_sheet") return `${i.name}: printing and design are priced per sheet`;
  if ((i.kind === "cover" || i.kind === "binding" || i.kind === "box") && !(r.method === "per_unit" || r.method === "fixed_per_album")) return `${i.name}: cover, binding and box options are priced per unit or per album`;
  return null;
}
/** Saves many prices at once — all or nothing. */
export async function savePrices(rows: PriceRow[]): Promise<string | null> {
  if (!rows.length) return null;
  for (const r of rows) { const e = priceRowError(r); if (e) return e; }
  const clean = rows.map((r) => ({ ...r, unit: r.unit.trim(), rate: r.rate == null ? null : Math.round(r.rate * 100) / 100 }));
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.setPrices(clean); if (e) return e; }
  for (const r of clean) { const i = itemById(r.id); if (i) Object.assign(i, { rate: r.rate, method: r.method, unit: r.unit }); }
  notify();
  if (!backendOn) logAudit({ entity: "catalog_item", entityId: "prices", action: "update", detail: `Updated ${clean.length} price(s)` });
  return null;
}

// CSV: Path,Item,Method,Unit,Rate — the path uses " > " between levels. Rate blank = not priced.
const csvCell = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
export function pricesCsv(): string {
  const rows = [...ITEMS].sort((a, b) => pathLabel(a.categoryId).localeCompare(pathLabel(b.categoryId)) || a.sort - b.sort)
    .map((i) => [pathOf(i.categoryId).map((c) => c.name).join(" > "), i.name, i.method, i.unit, i.rate == null ? "" : String(i.rate)].map(csvCell).join(","));
  return ["Path,Item,Method,Unit,Rate", ...rows].join("\n") + "\n";
}
function parseCsv(text: string): string[][] {
  const out: string[][] = []; let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((c) => c.trim())) out.push(row); row = []; }
    else cell += ch;
  }
  row.push(cell); if (row.some((c) => c.trim())) out.push(row);
  return out;
}
const METHOD_ALIASES: Record<string, PricingMethod> = { per_sheet: "per_sheet", sheet: "per_sheet", per_unit: "per_unit", unit: "per_unit", pcs: "per_unit", fixed_per_album: "fixed_per_album", album: "fixed_per_album", one_time_order: "one_time_order", order: "one_time_order" };
/** Reads a prices CSV: creates any missing categories / items, then applies the rates. */
export async function importPricesCsv(text: string): Promise<{ added: number; priced: number } | { error: string }> {
  const rows = parseCsv(text.replace(/^\uFEFF/, ""));
  if (!rows.length) return { error: "The file is empty" };
  const head = rows[0]!.map((h) => h.trim().toLowerCase());
  const col = (n: string) => head.indexOf(n);
  const [cp, ci, cm, cu, cr] = [col("path"), col("item"), col("method"), col("unit"), col("rate")];
  if (cp < 0 || ci < 0 || cr < 0) return { error: "The first row must be the header: Path,Item,Method,Unit,Rate" };
  const parsed: { e: TreeEntry; rate: number | null; m?: PricingMethod }[] = [];
  for (const [n, r] of rows.slice(1).entries()) {
    const line = n + 2;
    const path = (r[cp] ?? "").split(">").map((x) => x.trim()).filter(Boolean), item = (r[ci] ?? "").trim();
    if (!path.length || !item) return { error: `Line ${line}: Path and Item are required` };
    const m = METHOD_ALIASES[(cm >= 0 ? r[cm] ?? "" : "").trim().toLowerCase()];
    if (cm >= 0 && (r[cm] ?? "").trim() && !m) return { error: `Line ${line}: unknown method “${r[cm]}” (use per_sheet, per_unit, fixed_per_album or one_time_order)` };
    const rawRate = (r[cr] ?? "").replace(/[₹,\s]/g, "");
    const rate = rawRate === "" ? null : Number(rawRate);
    if (rate != null && (!Number.isFinite(rate) || rate < 0)) return { error: `Line ${line}: “${r[cr]}” is not a valid rate` };
    parsed.push({ e: { path, item, method: m ?? "per_unit", unit: (cu >= 0 ? r[cu] ?? "" : "").trim() || "pcs" }, rate, m });
  }
  const added = await importTree(parsed.map((p) => p.e));
  if (typeof added === "string") return { error: added };
  const find = (e: TreeEntry) => {
    let parent: string | null = null;
    for (const nm of e.path) { const c = CATEGORIES.find((x) => x.parentId === parent && norm(x.name) === norm(nm)); if (!c) return undefined; parent = c.id; }
    return ITEMS.find((i) => i.categoryId === parent && norm(i.name) === norm(e.item));
  };
  const updates: PriceRow[] = [];
  for (const p of parsed) {
    const it = find(p.e); if (!it) continue;
    const method = p.m ?? it.method, unit = cu >= 0 && p.e.unit ? p.e.unit : it.unit;
    if (it.rate !== p.rate || it.method !== method || it.unit !== unit) updates.push({ id: it.id, rate: p.rate, method, unit });
  }
  const e = await savePrices(updates); if (e) return { error: e };
  return { added, priced: updates.length };
}

// ───────── delete ─────────
/** Demo mode: which item ids appear on finalized orders (registered by orders2 to avoid a circular import). The database checks this itself. */
let usedItems: () => Set<string> = () => new Set();
export const registerItemUsage = (f: () => Set<string>) => { usedItems = f; };
const USED_MSG = (name: string) => `“${name}” is used on existing orders, so it cannot be deleted — switch it off (Inactive) instead`;

/** What deleting a category removes: itself, its sub-categories, their items and rate rules. */
export function branchSummary(categoryId: string) {
  const cats = [categoryId, ...descendantsOf(categoryId)];
  const items = ITEMS.filter((i) => cats.includes(i.categoryId));
  const used = usedItems(); const usedCount = items.filter((i) => used.has(i.id)).length;
  return { categories: cats.length, items: items.length, used: usedCount };
}
export async function deleteItem(id: string): Promise<string | null> {
  const it = itemById(id); if (!it) return "Item not found";
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.deleteItem(id); if (e) return e; }
  else if (usedItems().has(id)) return USED_MSG(it.name);
  ITEMS.splice(ITEMS.indexOf(it), 1);
  for (let k = RATES.length - 1; k >= 0; k--) if (RATES[k]!.itemId === id) RATES.splice(k, 1);
  notify();
  if (!backendOn) logAudit({ entity: "catalog_item", entityId: id, action: "delete", detail: `${pathLabel(it.categoryId)} ▸ ${it.name}` });
  return null;
}
export async function deleteCategory(id: string): Promise<string | null> {
  const c = categoryById(id); if (!c) return "Category not found";
  const sum = branchSummary(id);
  if (backendOn) { if (!backend) return NOT_CONNECTED; const e = await backend.deleteCategory(id); if (e) return e; }
  else if (sum.used) return `“${c.name}” holds ${sum.used} item(s) used on existing orders, so it cannot be deleted — switch it off (Inactive) instead`;
  const label = pathLabel(id);
  const cats = new Set([id, ...descendantsOf(id)]);
  const gone = new Set(ITEMS.filter((i) => cats.has(i.categoryId)).map((i) => i.id));
  for (let k = RATES.length - 1; k >= 0; k--) if (gone.has(RATES[k]!.itemId)) RATES.splice(k, 1);
  for (let k = ITEMS.length - 1; k >= 0; k--) if (gone.has(ITEMS[k]!.id)) ITEMS.splice(k, 1);
  for (let k = CATEGORIES.length - 1; k >= 0; k--) if (cats.has(CATEGORIES[k]!.id)) CATEGORIES.splice(k, 1);
  notify();
  if (!backendOn) logAudit({ entity: "catalog_category", entityId: id, action: "delete", detail: `${label} (${sum.categories} categor${sum.categories === 1 ? "y" : "ies"}, ${sum.items} item(s))` });
  return null;
}

/** An item typed on an order that is not in the catalog yet: saved under "Manual items" for later orders (add_manual_item, 0070). */
export async function addManualItem(d: { name: string; method: PricingMethod; unit: string; rate: number | null }): Promise<{ id: string } | { error: string }> {
  const name = d.name.trim().replace(/\s+/g, " ");
  if (name.length < 2) return { error: "Enter the item name" };
  if (d.rate != null && (!Number.isFinite(d.rate) || d.rate < 0)) return { error: "Enter a rate of 0 or more" };
  if (backendOn) {
    const { sb } = await import("./db/core");
    const { data, error } = await sb().rpc("add_manual_item", { p_name: name, p_method: d.method, p_unit: d.unit.trim() || null, p_rate: d.rate });
    if (error) return { error: error.message };
    await loadCatalog2();
    return { id: data as string };
  }
  let cat = CATEGORIES.find((c) => c.parentId === null && c.name.toLowerCase() === "manual items");
  if (!cat) { const r = await saveCategory({ parentId: null, name: "Manual items", sort: 9999 }); if ("error" in r) return r; cat = CATEGORIES.find((c) => c.id === r.id)!; }
  const same = ITEMS.find((i) => i.categoryId === cat!.id && i.name.toLowerCase() === name.toLowerCase());
  return saveItem({ ...(same ?? {}), id: same?.id, categoryId: cat.id, name, method: d.method, unit: d.unit.trim() || (d.method === "per_sheet" ? "sheet" : "pcs"), rate: d.rate ?? same?.rate ?? null, active: true });
}
