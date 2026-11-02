# Order workflow v2 — catalog, pricing, multi-album orders, invoices

## What it does

**Order builder** (`/orders/new`; every "New order" / "Create Order" button opens it):

1. **Order type** — *Design + Printing* or *Album Printing Only*.
2. **Customer** — search an existing customer, or add a new one (name, phone, optional email, address).
3. **Event & dates** — event type and name, event date, optional delivery date (default: *N* days after the order, set in Catalog › Tax & defaults), work group, priority, notes.
4. **Albums & items** — any number of albums (tabs, **Add another album**, **Duplicate**, **Remove**). Each album has its own name, sheets, copies, orientation, size, paper, finish, cover / binding / box, extra items picked through dependent category dropdowns, and notes. One-time order charges are added below the albums.
5. **Invoice** — fixed or percentage discount, optional tax, and a full invoice preview (screen + PDF). In database mode the server re-prices the order and shows "Verified by the server".
6. **Finalize** — creates the order, its albums, the priced lines and the invoice with its final number in one step.

You can move between steps freely without losing anything. **Save draft** keeps an unfinished order; the steps also save it automatically. Resume a draft from **Orders › Drafts**.

**Catalog & Pricing** (`/catalog`, admin only):
- The hierarchy is Category → Subcategory → Level 3 → Level 4. Deeper levels are optional and items can sit at any level.
- **Categories:** create and edit, choose the parent, activate or deactivate, and set the display order (↑ ↓).
- **Items:** name, code, description, pricing method, standard rate, unit, "use as" (printing rate card, design rate card, cover, binding, box, or extra), display order, and active.
- **Rate rules:** a rate for a requirement combination (size / paper / finish, any of them).
- **Tax & defaults:** tax on/off, label, rate, and the default delivery days.
- **Add sample catalog:** a small, clearly labelled set of *demonstration prices*.
- **Import classic catalog:** copies the old flat product list into the hierarchy. Safe to repeat.

## Pricing rules

| Pricing method | Charged | Amount |
|---|---|---|
| Rate per sheet | per copy | sheets × rate |
| Rate per item / unit | per copy | whole quantity × rate |
| Fixed amount per album | once per album | rate |
| One-time charge per order | once per order | rate |

- **Printing** is added to every album automatically: sheets × the printing rate card's rate.
- **Design** is added the same way, for *Design + Printing* orders only.
- **Album total** = per-copy subtotal × copies + fixed per-album charges.
- **Order subtotal** = Σ album totals + one-time order charges.
- **Discount** is fixed (₹) or a percentage. It can never exceed the subtotal. Above the approval threshold (Masters › Pricing Rules, 10%) only an admin can finalize.
- **Tax** is optional and configured, never assumed. Taxable amount = subtotal − discount. Final = taxable + tax.
- **Balance** = final − payments received.
- **Which rate applies:** the most specific matching rate rule wins. A tie goes size → paper → finish. With no matching rule the item's standard rate applies. With no rate at all the line shows **"Price not configured"** and the order cannot be finalized; it is never treated as free.
- **Rounding:** every line is a whole quantity × a 2-decimal rate, so lines are exact. Percentage discount and tax are rounded half-up to the paisa.
- **One engine, checked twice:** the same rules run in the browser for live totals (`src/lib/orderPricing.ts`) and in the database (`order_price` in `supabase/migrations/0036_order_workflow_v2.sql`). The database is the authority at finalize.

## History and changes after finalizing

- **Frozen at finalize:** the order stores a snapshot of item names, requirements, rates, the rule used, discount, tax settings, and the business and customer details (`order_pricing.snapshot`, `invoices.snapshot`), plus itemized rows (`order_charge_lines`). Later catalog changes or deactivations never change a finalized order or invoice. The PDF is always drawn from the snapshot.
- **Double clicks and retries:** finalizing locks the draft row. A double click or a retry returns the same order and invoice.
- **Editing a finalized order:** only an admin can do it, through **Edit (reopen)** on the order, with a reason.
  - The current invoice is voided and kept.
  - The selections come back as a draft.
  - Finalizing again issues a new invoice revision.
  - Payments stay with the order.
  - **Cancel edit** restores the order exactly as it was.

## Database objects (migration `0036_order_workflow_v2.sql`)

**Tables**

| Table | Holds |
|---|---|
| `cat_categories` | The category hierarchy (depth 1–4). A sibling's name must be unique within its parent (case-insensitive). The database refuses circular parents and anything deeper than 4 levels. |
| `cat_items` | Items, with pricing method, standard rate, unit and option kind. Only one active printing and one active design rate card are allowed. |
| `cat_rates` | Rate rules: one rate per size / paper / finish combination. |
| `pricing_settings` | Tax on/off, label and rate, and the default delivery days. |
| `order_drafts` | Unfinished orders, each visible to its creator and to admins. Locked once finalized. |
| `order_pricing` | One row per order: totals, the snapshot, the editable selections and the revision. It can only change through the functions below. |
| `order_charge_lines` | Every priced line, for every revision. |
| `invoices` / `invoice_lines` | New columns: `calc_mode='v2'`, discount type/value/amount, tax label/rate/amount, revision, snapshot, line section, scope and order. |

**Functions**

| Function | Who | Does |
|---|---|---|
| `order_price(payload)` | Any staff | The pricing engine. |
| `finalize_order_v2(draft)` | Reception and admin | Finalizes the order. Idempotent. |
| `reopen_order_pricing(order, reason)` | Admin | Reopens a finalized order for editing. |
| `cancel_reopen_pricing(order)` | Admin | Cancels the edit and restores the order. |
| `business_profile()` | Any staff | Returns the invoice header details. |
| `cat_import_classic()` | Admin | Copies the classic catalog into the hierarchy. |

The classic catalog (`catalog_items`) and the classic album costing (`order_costing`, `album_lines`) are unchanged. Orders that already use them keep that screen.

## Setup

1. **Apply the migration.** It is already applied on the live project. For another project run `supabase/migrations/0036_order_workflow_v2.sql` (and the earlier ones) in order. The migration copies the classic product catalog into the new hierarchy.
2. **Set up the catalog in Catalog & Pricing (admin):**
   - Add a **printing rate card**: an item "used as Printing rate card", per sheet, with a standard rate and/or rules by size, paper and finish.
   - For Design + Printing orders, add a **design rate card** the same way.
   - Add cover, binding and box options, extras, and one-time order charges.
   - Or use **Add sample catalog** to try it. Every sample entry is marked **Sample**, and its prices are demonstration values only: deactivate or replace them before real use.
3. **Optional:** in Catalog & Pricing › Tax & defaults, set the tax and the default delivery days.
4. **Business details on invoices:** Settings › Company (name, address, phone, email, GSTIN).

**Local development:** see `supabase/local/start.sh` and run the tests with:
- **SQL tests:** `PGHOST=/var/tmp PGPORT=5433 PGUSER=postgres supabase/tests/run.sh`
- **Demo end-to-end:** `npm run test:e2e`
- **Database end-to-end:** `API_PORT=54322 LOCAL_DB=ap_b E2E_PORT=5190 npx playwright test -c playwright.db.config.ts`

## Verification

| Suite | What it covers |
|---|---|
| `supabase/tests/99_order_workflow.sql` (≈110 checks) | Hierarchy rules (depth, duplicates, cycles, moves); item rules; rate-rule resolution; every pricing scope; both order types; copies; fixed and % discounts with limits; optional tax; missing prices; input validation; drafts; idempotent finalize; snapshots kept after catalog changes; approval threshold; new customer; reopen → revision 2 with the old invoice void and payments kept; cancel reopen; permissions; classic import. |
| `tests/e2e/order-builder.spec.ts` (demo) | The full flow with independent albums; dependent dropdowns, including clearing; items at levels 1–3; per copy, per album and per order charges; duplicate and remove; discount validation; a double-click finalize giving one invoice; the PDF; a rate change not altering the order; reopen → new invoice with the old one void; Printing Only; the reception discount limit; missing price; drafts; catalog admin rules; tax. |
| `tests/e2e-db/order-builder.spec.ts` (database) | The same against the real server, with database checks on every row written, server price verification, payments and balance, history after a rate change, reopen and revision, the admin catalog, and missing prices. |
