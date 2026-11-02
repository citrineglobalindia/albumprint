import { persistArray } from "./persist";
import { backendOn } from "./supabase";
import { notify } from "./store";
import { logAudit } from "./audit";

// The order catalog: Category → Subcategory → Level 3 → Level 4 → Items, with configurable pricing (supabase/migrations/0036).
// Items can sit at any level; deeper levels are optional. Prices are never hardcoded: every item has a pricing method, an optional standard rate,
// and rate rules for requirement combinations (size / paper / finish). Demo mode keeps it in this browser; database mode loads it from the server.
export type PricingMethod = "fixed_per_album" | "per_sheet" | "per_unit" | "one_time_order";
export type OptionKind = "printing" | "design" | "cover" | "binding" | "box";
export interface Category { id: string; parentId: string | null; name: string; depth: number; sort: number; active: boolean; sample?: boolean }
export interface CItem { id: string; categoryId: string; name: string; code?: string; description?: string; method: PricingMethod; rate: number | null; unit: string; kind?: OptionKind; sort: number; active: boolean; sample?: boolean }
export interface Rate { id: string; itemId: string; size?: string; paper?: string; finish?: string; rate: number }
export interface PricingSettings { taxEnabled: boolean; taxLabel: string; taxRate: number; defaultDeliveryDays: number }

export const METHOD_LABEL: Record<PricingMethod, string> = { per_sheet: "Rate per sheet (per copy)", per_unit: "Rate per item / unit (per copy)", fixed_per_album: "Fixed amount per album", one_time_order: "One-time charge per order" };
export const SCOPE_LABEL = { copy: "Per copy", album: "Per album", order: "Per order" } as const;
export const KIND_LABEL: Record<OptionKind, string> = { printing: "Printing rate card", design: "Design rate card", cover: "Cover option", binding: "Binding option", box: "Box option" };
export const MAX_DEPTH = 4;

export const CATEGORIES: Category[] = persistArray<Category>("cat2_categories", []);
export const ITEMS: CItem[] = persistArray<CItem>("cat2_items", []);
export const RATES: Rate[] = persistArray<Rate>("cat2_rates", []);
const SETTINGS: PricingSettings[] = persistArray<PricingSettings>("cat2_settings", []);
export const DEFAULT_PRICING_SETTINGS: PricingSettings = { taxEnabled: false, taxLabel: "Tax", taxRate: 0, defaultDeliveryDays: 14 };
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
