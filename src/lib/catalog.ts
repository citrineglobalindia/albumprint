import { persistArray } from "./persist";
import { backendOn } from "./supabase";
import { notify } from "./store";
import { logAudit } from "./audit";

// Product catalog (name path, SKU, unit, sell price, cost). The admin maintains it in Masters > Product Catalog;
// New Order prices items from it. In database mode the shared array is filled by lib/db/catalog.ts.
export interface CatalogItem { id: string; name: string; category: string; sku: string; unit: string; sell: number; cost?: number; active: boolean }
export type CatalogDraft = { id?: string; name: string; sku?: string; unit?: string; sell: number; cost?: number; active?: boolean };

/** "PAPER-NT-125 GSM-GLOSSY" → category "PAPER"; "KIDS - PK 01" → "KIDS". */
export const categoryOf = (name: string) => (name.split("-")[0] ?? name).trim().toUpperCase();
/** The part after the category, for the item picker. */
export const subNameOf = (name: string) => { const i = name.indexOf("-"); return i < 0 ? name.trim() : name.slice(i + 1).trim() || name.trim(); };
const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

const S = (name: string, sell: number, cost: number, sku = "", unit = "Nos"): CatalogItem => ({ id: `CP${name}`, name, category: categoryOf(name), sku, unit, sell, cost, active: true });
const seed = (): CatalogItem[] => [
  S("PAPER-NT LUSTER", 90, 85), S("PAPER-METALIC-NT METALIC-GLOSSY", 140, 135), S("PAPER-TRANSPARENT", 140, 130),
  S("PAPER-NT-125 GSM-HOLOGRAM-HOLOGRAM STAR", 110, 105), S("PAPER-NT-125 GSM-HOLOGRAM-HOLOGRAM LINE", 110, 105),
  S("PAPER-NT-125 GSM-EMBOZZING LAM>-FULL SHEET", 600, 550), S("PAPER-NT-125 GSM-3dD LAMINATION", 220, 170), S("PAPER-NT-125 GSM-TEXTURE LAM", 110, 105),
  S("PAPER-NT-125 GSM-GLITTERING", 220, 170), S("PAPER-NT-125 GSM-EMBOZZING LAM>-HALF SHEET", 300, 250), S("PAPER-NT-125 GSM-SILKY MATT", 80, 72),
  S("PAPER-NT-125 GSM-GLOSSY", 75, 68, "321", "1"), S("PAPER-NT-125 GSM-FEATHER TOUCH", 85, 78, "4234"), S("PAPER-NT-200 GSM-GLOSSY", 85, 78),
  S("KIDS - PK 01", 1000, 0, "PK 01"), S("KIDS - PK 02", 1100, 0, "PK 02"),
];
export const CATALOG: CatalogItem[] = persistArray("catalog", seed());
export const catalogCategories = () => [...new Set(CATALOG.filter((c) => c.active).map((c) => c.category))].sort();

type Writer = (items: (CatalogDraft & { category: string })[]) => Promise<string | null>;
let writer: Writer | null = null;
export const registerCatalogWriter = (w: Writer) => { writer = w; };

/** Add or update products. Items with an id (or the same name as an existing one) are updated; the rest are added. Returns an error text, or null on success. */
export async function saveCatalog(drafts: CatalogDraft[]): Promise<string | null> {
  const seen = new Set<string>();
  const prepared: (CatalogDraft & { id?: string; category: string })[] = [];
  for (const d of drafts) {
    const name = d.name.trim().replace(/\s+/g, " ");
    if (!name) return "Enter a product name";
    if (name.length > 200) return `“${name.slice(0, 30)}…” is too long (200 characters max)`;
    if (!Number.isFinite(d.sell) || d.sell < 0) return `“${name}”: enter a sell price of 0 or more`;
    if (d.cost !== undefined && (!Number.isFinite(d.cost) || d.cost < 0)) return `“${name}”: the cost must be 0 or more`;
    const key = norm(name);
    if (seen.has(key)) return `“${name}” appears twice`;
    seen.add(key);
    const byName = CATALOG.find((c) => norm(c.name) === key);
    const id = d.id ?? byName?.id;
    if (d.id && byName && byName.id !== d.id) return `Another product is already called “${name}”`;
    prepared.push({ ...d, id, name, category: categoryOf(name) });
  }
  if (backendOn) {
    if (!writer) return "Not connected to the database";
    return writer(prepared);
  }
  let added = 0, changed = 0;
  for (const p of prepared) {
    const next: CatalogItem = { id: p.id ?? `CP${Date.now().toString(36)}${CATALOG.length}`, name: p.name, category: p.category, sku: p.sku?.trim() ?? "", unit: p.unit?.trim() || "Nos", sell: p.sell, cost: p.cost, active: p.active ?? true };
    const i = CATALOG.findIndex((c) => c.id === next.id);
    if (i >= 0) { CATALOG[i] = next; changed++; } else { CATALOG.push(next); added++; }
  }
  logAudit({ entity: "catalog", entityId: prepared.length === 1 ? prepared[0]!.name : `${prepared.length} products`, action: added && !changed ? "create" : "update", detail: `${added} added, ${changed} updated` });
  notify();
  return null;
}
export function replaceCatalog(rows: CatalogItem[]) { CATALOG.splice(0, CATALOG.length, ...rows); notify(); }
