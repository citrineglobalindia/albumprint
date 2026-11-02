import type { CItem, PricingMethod, PricingSettings, Rate } from "./catalog2";

// The order pricing engine. The same rules run in the database (order_price in supabase/migrations/0036), which is the authority when an order is
// finalized; this copy gives live totals while the user types. Money is handled in paise (integers) so nothing drifts:
//   every line = whole quantity × 2-decimal rate (exact); percentages are rounded half-up to the paisa.
export type OrderType = "design_printing" | "printing_only";
export type Scope = "copy" | "album" | "order";
export interface DraftItem { itemId: string; qty: number; note?: string }
export interface DraftAlbum { id: string; name: string; sheets: number; copies: number; size: string; paper: string; finish: string; orientation: string; notes: string; items: DraftItem[] }
export interface NewCustomerDraft { name: string; phone: string; email: string; address: string }
export interface OrderDraft {
  orderType: OrderType | "";
  customerId: string;                       // database id (uuid) in database mode, customer code in demo mode
  newCustomer: NewCustomerDraft | null;
  event: { type: string; name: string; date: string; delivery: string; notes: string; workGroup?: string; priority?: string };
  albums: DraftAlbum[];
  orderCharges: { itemId: string }[];
  discount: { type: "none" | "fixed" | "percent"; value: number | string };
  applyTax: boolean;
  reopenOrder?: string;
}
export interface PricedLine {
  position: number; kind: "printing" | "design" | "item"; itemId: string; name: string; unit: string; method: PricingMethod; scope: Scope; optionKind?: string | null;
  qty: number; rate: number | null; rule: string | null; missing: boolean; unitAmount: number; amount: number; perCopy: number | null; note?: string | null;
}
export interface PricedAlbum { index: number; id: string; name: string; sheets: number; copies: number; size: string | null; paper: string | null; finish: string | null; notes: string | null; lines: PricedLine[]; perCopy: number; perAlbum: number; total: number }
export interface PriceError { path: string; message: string }
export interface PricedOrder {
  orderType: string; albums: PricedAlbum[]; orderLines: PricedLine[]; subtotal: number;
  discountType: "fixed" | "percent" | null; discountValue: number; discountAmount: number;
  taxEnabled: boolean; taxLabel: string; taxRate: number; taxable: number; tax: number; total: number;
  errors: PriceError[]; hasMissingPrice: boolean; canFinalize: boolean;
}

const P = (rupees: number) => Math.round(rupees * 100);            // rupees → paise
const R = (paise: number) => Math.round(paise) / 100;               // paise → rupees
const halfUp = (num: number, den: number) => Math.floor((num * 2 + den) / (2 * den));     // non-negative integers, rounded half-up
const clean = (s: string | undefined | null) => { const t = (s ?? "").trim(); return t ? t : null; };
const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const isWhole = (v: unknown, max: number) => typeof v === "number" ? Number.isInteger(v) && v >= 0 && v < max : typeof v === "string" && /^[0-9]{1,6}$/.test(v) && Number(v) < max;

/** The rate for an item and a set of requirements: the most specific matching rule (size, then paper, then finish break a tie), else the standard rate. */
export function resolveRate(item: CItem, rates: Rate[], size: string | null, paper: string | null, finish: string | null): { rate: number | null; rule: string | null } {
  const match = rates.filter((r) => r.itemId === item.id && (!r.size || low(r.size) === low(size)) && (!r.paper || low(r.paper) === low(paper)) && (!r.finish || low(r.finish) === low(finish)));
  const n = (r: Rate) => (r.size ? 1 : 0) + (r.paper ? 1 : 0) + (r.finish ? 1 : 0);
  match.sort((a, b) => n(b) - n(a) || Number(!!b.size) - Number(!!a.size) || Number(!!b.paper) - Number(!!a.paper) || Number(!!b.finish) - Number(!!a.finish) || a.id.localeCompare(b.id));
  const r = match[0];
  if (r) return { rate: r.rate, rule: [r.size && `size ${r.size}`, r.paper && `paper ${r.paper}`, r.finish && `finish ${r.finish}`].filter(Boolean).join(" · ") };
  return item.rate != null ? { rate: item.rate, rule: "standard rate" } : { rate: null, rule: null };
}

export const scopeOf = (m: PricingMethod): Scope => (m === "per_sheet" || m === "per_unit" ? "copy" : m === "fixed_per_album" ? "album" : "order");

function priceLine(item: CItem, qty: number, sheets: number, size: string | null, paper: string | null, finish: string | null, kind: PricedLine["kind"], rates: Rate[]) {
  const q = item.method === "per_sheet" ? sheets : item.method === "per_unit" ? qty : 1;
  const { rate, rule } = resolveRate(item, rates, size, paper, finish);
  const missing = rate == null;
  return { kind, itemId: item.id, name: item.name, unit: item.unit, method: item.method, scope: scopeOf(item.method), optionKind: item.kind ?? null, qty: q, rate, rule, missing, unitAmountP: missing ? 0 : q * P(rate!) };
}

export function priceOrder(d: OrderDraft, catalog: { items: CItem[]; rates: Rate[] }, settings: PricingSettings): PricedOrder {
  const errs: PriceError[] = []; const err = (path: string, message: string) => errs.push({ path, message });
  const otype = d.orderType, designed = otype === "design_printing";
  if (otype !== "design_printing" && otype !== "printing_only") err("orderType", "Choose the order type");
  const items = new Map(catalog.items.map((i) => [i.id, i]));
  const prn = catalog.items.find((i) => i.kind === "printing" && i.active), dsn = catalog.items.find((i) => i.kind === "design" && i.active);
  if (!d.albums.length) err("albums", "Add at least one album");
  let anyMissing = false, subP = 0;
  const albums: PricedAlbum[] = d.albums.map((a, k) => {
    const ai = k + 1;
    const sheets = isWhole(a.sheets, 1e6) ? Number(a.sheets) : 0, copies = isWhole(a.copies, 1e4) ? Number(a.copies) : 0;
    const size = clean(a.size), paper = clean(a.paper), finish = clean(a.finish);
    if (sheets < 1) err(`album.${ai}.sheets`, `Album ${ai}: sheets must be a positive whole number`);
    if (copies < 1) err(`album.${ai}.copies`, `Album ${ai}: copies must be a positive whole number`);
    if (!clean(a.name)) err(`album.${ai}.name`, `Album ${ai}: enter an album name or reference`);
    const raw: (ReturnType<typeof priceLine> & { note?: string | null })[] = [];
    if (!prn) { err("catalog.printing", "Printing rate card is not set up. Ask an admin to add it in Catalog."); anyMissing = true; }
    else { const l = priceLine(prn, 1, sheets, size, paper, finish, "printing", catalog.rates); raw.push(l); if (l.missing) { anyMissing = true; err(`album.${ai}.printing`, `Album ${ai}: printing price not configured for this size / paper / finish`); } }
    if (designed) {
      if (!dsn) { err("catalog.design", "Design rate card is not set up. Ask an admin to add it in Catalog."); anyMissing = true; }
      else { const l = priceLine(dsn, 1, sheets, size, paper, finish, "design", catalog.rates); raw.push(l); if (l.missing) { anyMissing = true; err(`album.${ai}.design`, `Album ${ai}: design price not configured for this size / paper / finish`); } }
    }
    const seen = new Set<string>(), kinds = new Set<string>();
    for (const it of a.items) {
      const ci = items.get(it.itemId);
      if (!ci) { err(`album.${ai}.items`, `Album ${ai}: a selected item no longer exists`); continue; }
      if (!ci.active) { err(`album.${ai}.items`, `Album ${ai}: “${ci.name}” is no longer available`); continue; }
      if (ci.method === "one_time_order") { err(`album.${ai}.items`, `Album ${ai}: “${ci.name}” is an order-level charge`); continue; }
      if (ci.kind === "printing" || ci.kind === "design") { err(`album.${ai}.items`, `Album ${ai}: printing and design are added automatically`); continue; }
      if (seen.has(ci.id)) { err(`album.${ai}.items`, `Album ${ai}: “${ci.name}” is added twice — change its quantity instead`); continue; }
      seen.add(ci.id);
      if (ci.kind) { if (kinds.has(ci.kind)) { err(`album.${ai}.items`, `Album ${ai}: choose only one ${ci.kind}`); continue; } kinds.add(ci.kind); }
      let qty = 1;
      if (ci.method === "per_unit") {
        if (!isWhole(it.qty, 1e5) || Number(it.qty) < 1) { err(`album.${ai}.items`, `Album ${ai}: “${ci.name}” needs a quantity of 1 or more (whole number)`); continue; }
        qty = Number(it.qty);
      }
      const l = priceLine(ci, qty, sheets, size, paper, finish, "item", catalog.rates);
      raw.push({ ...l, note: clean(it.note) });
      if (l.missing) { anyMissing = true; err(`album.${ai}.items`, `Album ${ai}: price not configured for “${ci.name}” with these requirements`); }
    }
    let perCopyP = 0, perAlbumP = 0;
    const lines: PricedLine[] = raw.map((l, i) => {
      const amountP = l.scope === "copy" ? l.unitAmountP * copies : l.unitAmountP;
      if (l.scope === "copy") perCopyP += l.unitAmountP; else perAlbumP += amountP;
      return { position: i + 1, kind: l.kind, itemId: l.itemId, name: l.name, unit: l.unit, method: l.method, scope: l.scope, optionKind: l.optionKind, qty: l.qty, rate: l.rate, rule: l.rule, missing: l.missing,
        unitAmount: R(l.unitAmountP), amount: R(amountP), perCopy: l.scope === "copy" ? R(l.unitAmountP) : null, note: l.note ?? null };
    });
    const totalP = perCopyP * copies + perAlbumP; subP += totalP;
    return { index: ai, id: a.id, name: clean(a.name) ?? `Album ${ai}`, sheets, copies, size, paper, finish, notes: clean(a.notes), lines, perCopy: R(perCopyP), perAlbum: R(perAlbumP), total: R(totalP) };
  });

  const seen = new Set<string>(); const orderLines: PricedLine[] = [];
  for (const oc of d.orderCharges) {
    const ci = items.get(oc.itemId);
    if (!ci || !ci.active) { err("orderCharges", "An order charge is no longer available"); continue; }
    if (ci.method !== "one_time_order") { err("orderCharges", `“${ci.name}” is not a one-time order charge`); continue; }
    if (seen.has(ci.id)) { err("orderCharges", `“${ci.name}” is added twice`); continue; }
    seen.add(ci.id);
    const l = priceLine(ci, 1, 1, null, null, null, "item", catalog.rates);
    orderLines.push({ position: orderLines.length + 1, kind: "item", itemId: l.itemId, name: l.name, unit: l.unit, method: l.method, scope: "order", optionKind: l.optionKind, qty: l.qty, rate: l.rate, rule: l.rule, missing: l.missing,
      unitAmount: R(l.unitAmountP), amount: R(l.unitAmountP), perCopy: null });
    if (l.missing) { anyMissing = true; err("orderCharges", `Price not configured for “${ci.name}”`); } else subP += l.unitAmountP;
  }

  let dtype: "fixed" | "percent" | null = d.discount.type === "none" ? null : d.discount.type;
  const rawV = String(d.discount.value ?? "").trim();
  let dval = 0, discP = 0;
  if (rawV !== "" && dtype) {
    if (!/^[0-9]{1,10}(\.[0-9]{1,2})?$/.test(rawV)) err("discount", "Enter a valid discount (0 or more, up to 2 decimals)");
    else dval = Number(rawV);
  }
  if (dtype === "percent") {
    if (dval > 100) { err("discount", "A percentage discount cannot be more than 100%"); dval = 0; }
    discP = halfUp(subP * P(dval), 10000);
  } else if (dtype === "fixed") {
    if (P(dval) > subP) { err("discount", "The discount cannot be more than the order subtotal"); dval = 0; }
    discP = P(dval);
  } else dtype = null;
  const taxableP = subP - discP;
  const applyTax = settings.taxEnabled && d.applyTax !== false;
  const taxP = applyTax ? halfUp(taxableP * P(settings.taxRate), 10000) : 0;
  return {
    orderType: otype, albums, orderLines, subtotal: R(subP), discountType: dtype, discountValue: dval, discountAmount: R(discP),
    taxEnabled: applyTax, taxLabel: settings.taxLabel, taxRate: applyTax ? settings.taxRate : 0, taxable: R(taxableP), tax: R(taxP), total: R(taxableP + taxP),
    errors: errs, hasMissingPrice: anyMissing, canFinalize: errs.length === 0 && !anyMissing && albums.length > 0,
  };
}

/** ₹ with paise only when needed: ₹3,546 / ₹3,723.30 */
export const money = (n: number) => `₹${n.toLocaleString("en-IN", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
