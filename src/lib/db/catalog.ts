import { CATALOG, registerCatalogWriter, replaceCatalog, categoryOf, type CatalogItem } from "../catalog";
import { backendOn, sb, q, registerHydrator } from "./core";

type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function hydrate() {
  const [items, costs] = await Promise.all([
    q<Row[]>("Loading products", sb().from("catalog_items").select("*").order("name") as never),
    q<Row[]>("Loading product costs", sb().from("catalog_costs").select("*") as never),     // admin only: other roles get no rows
  ]);
  const cost = new Map((costs ?? []).map((c) => [c.item_id as string, Number(c.cost_price)]));
  replaceCatalog((items ?? []).map((r): CatalogItem => ({ id: r.id, name: r.name, category: r.category ?? categoryOf(r.name), sku: r.sku ?? "", unit: r.unit, sell: Number(r.sell_price), cost: cost.get(r.id), active: r.active })));
}

registerCatalogWriter(async (items) => {
  const row = (i: (typeof items)[number]) => ({ name: i.name, category: i.category, sku: i.sku?.trim() || null, unit: i.unit?.trim() || "Nos", sell_price: i.sell, active: i.active ?? true });
  const withId = items.filter((i) => i.id && CATALOG.some((c) => c.id === i.id));
  const fresh = items.filter((i) => !withId.includes(i));
  const costRows: { item_id: string; cost_price: number }[] = [];
  if (withId.length) {
    const { error } = await sb().from("catalog_items").upsert(withId.map((i) => ({ id: i.id, ...row(i) })), { onConflict: "id" });
    if (error) return error.message;
    withId.forEach((i) => i.cost !== undefined && costRows.push({ item_id: i.id!, cost_price: i.cost }));
  }
  if (fresh.length) {
    const { data, error } = await sb().from("catalog_items").insert(fresh.map(row)).select("id,name");
    if (error) return error.message;
    const idByName = new Map((data ?? []).map((r: Row) => [String(r.name).toLowerCase(), r.id as string]));
    fresh.forEach((i) => { const id = idByName.get(i.name.toLowerCase()); if (id && i.cost !== undefined) costRows.push({ item_id: id, cost_price: i.cost }); });
  }
  if (costRows.length) { const { error } = await sb().from("catalog_costs").upsert(costRows, { onConflict: "item_id" }); if (error) return error.message; }
  await hydrate();
  return null;
});

if (backendOn) registerHydrator("product catalog", hydrate);
