import { registerCatalog2Backend, replaceCatalog, type CItem, type Category, type PricingSettings, type Rate } from "../catalog2";
import { PRICING, registerOrders2Backend, type Business, type FinalizeResult, type PricingRecord, type StoredDraft } from "../orders2";
import type { OrderDraft, PricedOrder } from "../orderPricing";
import { ORDERS } from "../data";
import { notify } from "../store";
import { backendOn, sb, registerHydrator, rehydrate } from "./core";

// Database side of the order builder and its catalog (supabase/migrations/0036).
type Row = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const msg = (e: { message: string } | null) => (e ? e.message : null);
const n = (v: unknown) => (v == null ? null : Number(v));

const catFrom = (r: Row): Category => ({ id: r.id, parentId: r.parent_id, name: r.name, depth: r.depth, sort: r.sort_order, active: r.active, sample: r.is_sample || undefined });
const itemFrom = (r: Row): CItem => ({ id: r.id, categoryId: r.category_id, name: r.name, code: r.code ?? undefined, description: r.description ?? undefined, method: r.pricing_method, rate: n(r.rate), unit: r.unit, kind: r.option_kind ?? undefined, sort: r.sort_order, active: r.active, sample: r.is_sample || undefined });
const rateFrom = (r: Row): Rate => ({ id: r.id, itemId: r.item_id, size: r.size ?? undefined, paper: r.paper ?? undefined, finish: r.finish ?? undefined, rate: Number(r.rate) });
const settingsFrom = (r: Row): PricingSettings => ({ taxEnabled: r.tax_enabled, taxLabel: r.tax_label, taxRate: Number(r.tax_rate), defaultDeliveryDays: r.default_delivery_days,
  printingMode: r.printing_mode === "included" ? "included" : "separate", showBusinessName: r.show_business_name !== false, brandRoles: Array.isArray(r.brand_roles) ? r.brand_roles : [] });       // a database without the setting (before migration 0044) charges printing separately

async function loadCatalog(): Promise<string | null> {
  const [c, i, r, s] = await Promise.all([
    sb().from("cat_categories").select("*").order("depth").order("sort_order"), sb().from("cat_items").select("*").order("sort_order"),
    sb().from("cat_rates").select("*"), sb().from("pricing_settings").select("*").maybeSingle(),
  ]);
  const e = c.error ?? i.error ?? r.error ?? s.error; if (e) return e.message;
  replaceCatalog({ categories: (c.data ?? []).map(catFrom), items: (i.data ?? []).map(itemFrom), rates: (r.data ?? []).map(rateFrom), settings: s.data ? settingsFrom(s.data) : undefined });
  return null;
}

registerCatalog2Backend({
  load: loadCatalog,
  async saveCategory(c) {
    const row = { id: c.id, parent_id: c.parentId, name: c.name, sort_order: c.sort, active: c.active, is_sample: !!c.sample };
    const { error } = c.isNew ? await sb().from("cat_categories").insert(row) : await sb().from("cat_categories").update(row).eq("id", c.id);
    return msg(error);
  },
  async saveItem(i) {
    const row = { id: i.id, category_id: i.categoryId, name: i.name, code: i.code ?? null, description: i.description ?? null, pricing_method: i.method, rate: i.rate, unit: i.unit, option_kind: i.kind ?? null, sort_order: i.sort, active: i.active, is_sample: !!i.sample };
    const { error } = i.isNew ? await sb().from("cat_items").insert(row) : await sb().from("cat_items").update(row).eq("id", i.id);
    return msg(error);
  },
  async saveRate(r) {
    const row = { id: r.id, item_id: r.itemId, size: r.size ?? null, paper: r.paper ?? null, finish: r.finish ?? null, rate: r.rate };
    const { error } = r.isNew ? await sb().from("cat_rates").insert(row) : await sb().from("cat_rates").update(row).eq("id", r.id);
    return msg(error);
  },
  async removeRate(id) { const { error } = await sb().from("cat_rates").delete().eq("id", id); return msg(error); },
  async saveSettings(s) {
    const row = { tax_enabled: s.taxEnabled, tax_label: s.taxLabel, tax_rate: s.taxRate, default_delivery_days: s.defaultDeliveryDays, updated_at: new Date().toISOString() };
    const { error } = await sb().from("pricing_settings").update({ ...row, printing_mode: s.printingMode ?? "separate", show_business_name: s.showBusinessName !== false, brand_roles: s.brandRoles ?? [] }).eq("id", true);
    if (error && /printing_mode|show_business_name|brand_roles/.test(error.message)) {                              // the database has not had migration 0044 yet: save the rest
      const r2 = await sb().from("pricing_settings").update(row).eq("id", true);
      return r2.error ? msg(r2.error) : "Saved — but the newest invoice settings need a database update (migrations 0044 / 0046) before they can be changed";
    }
    return msg(error);
  },
  async importClassic() {
    const { data, error } = await sb().rpc("cat_import_classic"); if (error) return error.message;
    await loadCatalog(); return Number(data ?? 0);
  },
  async importTree(entries) {
    const { data, error } = await sb().rpc("cat_import_tree", { p: entries }); if (error) return error.message;
    const e = await loadCatalog(); if (e) return e; return Number(data ?? 0);
  },
  async deleteItem(id) { const { error } = await sb().rpc("cat_delete_item", { p_item: id }); return msg(error); },
  async deleteCategory(id) { const { error } = await sb().rpc("cat_delete_category", { p_cat: id }); return msg(error); },
  async setPrices(rows) { const { error } = await sb().rpc("cat_set_prices", { p: rows }); return msg(error); },
});

const draftFrom = (r: Row, me: string | undefined): StoredDraft => ({ id: r.id, title: r.title ?? "Draft", payload: r.payload as OrderDraft, updatedAt: r.updated_at, result: r.result ?? undefined, mine: r.created_by === me });

async function hydratePricing() {
  const { data, error } = await sb().from("order_pricing").select("order_id,revision,status,payload,snapshot,invoice_id,finalized_at,reopen_reason,invoices(number)");
  if (error) return;                                                             // no money access for this role: nothing to show
  const code = new Map(ORDERS.filter((o) => o.uid).map((o) => [o.uid!, o.id]));
  const recs: PricingRecord[] = (data ?? []).map((r: Row): PricingRecord | null => {
    const id = code.get(r.order_id); if (!id) return null;
    const payload = { ...(r.payload as OrderDraft) }; delete payload.reopenOrder;
    return { orderId: id, revision: r.revision, status: r.status, payload, snapshot: r.snapshot, invoiceNo: r.invoices?.number ?? r.snapshot?.invoiceNumber, invoiceUid: r.invoice_id ?? undefined, finalizedAt: r.finalized_at, reopenReason: r.reopen_reason ?? undefined };
  }).filter((x: PricingRecord | null): x is PricingRecord => !!x);
  PRICING.splice(0, PRICING.length, ...recs); notify();
}
if (backendOn) registerHydrator("order pricing", hydratePricing);

registerOrders2Backend({
  async listDrafts() {
    const [{ data, error }, me] = await Promise.all([sb().from("order_drafts").select("*").order("updated_at", { ascending: false }).limit(200), sb().auth.getUser()]);
    if (error) return error.message;
    return (data ?? []).map((r: Row) => draftFrom(r, me.data.user?.id));
  },
  async saveDraft(id, payload, title) {
    if (id) {
      const { data, error } = await sb().from("order_drafts").update({ payload, title }).eq("id", id).select("id");
      if (error) return { error: error.message };
      if (data && data.length) return { id };
    }
    const { data, error } = await sb().from("order_drafts").insert({ ...(id ? { id } : {}), payload, title }).select("id").single();
    return error || !data ? { error: error?.message ?? "Could not save the draft" } : { id: data.id as string };
  },
  async deleteDraft(id) { const { error } = await sb().from("order_drafts").delete().eq("id", id); return msg(error); },
  async finalize(id) {
    const { data, error } = await sb().rpc("finalize_order_v2", { p_draft: id });
    return error || !data ? { error: error?.message ?? "Could not finalize the order" } : (data as FinalizeResult);
  },
  async finalizeLater(id) {
    const { data, error } = await sb().rpc("create_order_invoice_later", { p_draft: id });
    return error || !data ? { error: error?.message ?? "Could not create the order" } : (data as FinalizeResult);
  },
  async prepareInvoice(orderUid) {
    const { data, error } = await sb().rpc("prepare_order_invoice", { p_order: orderUid });
    return error || !data ? { error: error?.message ?? "Could not prepare the invoice" } : { draftId: data as string };
  },
  async reopen(orderUid, reason) {
    const { data, error } = await sb().rpc("reopen_order_pricing", { p_order: orderUid, p_reason: reason });
    return error || !data ? { error: error?.message ?? "Could not reopen the order" } : { draftId: data as string };
  },
  async cancelReopen(orderUid) { const { error } = await sb().rpc("cancel_reopen_pricing", { p_order: orderUid }); return msg(error); },
  async serverPrice(payload) {
    const { data, error } = await sb().rpc("order_price", { p: payload });
    return error || !data ? { error: error?.message ?? "Could not price the order" } : (data as PricedOrder);
  },
  async business() { const { data } = await sb().rpc("business_profile"); return (data ?? {}) as Business; },
  async refresh() { await rehydrate(["customers and orders", "payments and invoices", "order pricing"]); },
});
