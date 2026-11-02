-- Order workflow v2: a hierarchical catalog (Category → Sub → Level 3 → Level 4 → Items), configurable pricing (rate rules by size / paper / finish),
-- server-priced orders with several albums, drafts, invoices from a snapshot, and an authorized reopen. The classic catalog (catalog_items) and the
-- classic album costing (order_costing / album_lines) are untouched: orders that already use them keep working exactly as before.
--
-- Calculation (the same rules run in the app for live totals and here, which is the authority):
--   per album:   printing = sheets × printing rate (per copy);  design = sheets × design rate (per copy, Design + Printing only)
--                per-sheet items = sheets × rate; per-unit items (cover, binding, box, extras) = whole quantity × rate  (all per copy)
--                album total = per-copy subtotal × copies + fixed-per-album charges (once per album)
--   order:       subtotal = Σ album totals + one-time order charges;  discount (fixed or %) ≤ subtotal
--                tax (optional, configured) = (subtotal − discount) × tax rate;  final = subtotal − discount + tax;  balance = final − payments
--   money is rounded half-up to 2 decimals where a percentage is involved; every line is an exact whole-quantity × 2-decimal rate.

-- ───────── settings ─────────
create table pricing_settings (
  id boolean primary key default true check (id),
  tax_enabled boolean not null default false,
  tax_label text not null default 'Tax' check (char_length(btrim(tax_label)) between 1 and 30),
  tax_rate numeric(5,2) not null default 0 check (tax_rate between 0 and 100),
  default_delivery_days int not null default 14 check (default_delivery_days between 0 and 365),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) default auth.uid()
);
insert into pricing_settings default values;
alter table pricing_settings enable row level security;
revoke all on pricing_settings from anon;
grant select, update on pricing_settings to authenticated;
create policy psettings_read  on pricing_settings for select to authenticated using (current_app_role() is not null);
create policy psettings_write on pricing_settings for update to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create trigger pricing_settings_audit after update on pricing_settings for each row execute function audit_admin_row();

-- ───────── catalog hierarchy ─────────
create table cat_categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references cat_categories(id),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  depth int not null default 1 check (depth between 1 and 4),
  sort_order int not null default 0,
  active boolean not null default true,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index cat_categories_name_key on cat_categories (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)));
create index cat_categories_parent on cat_categories (parent_id, sort_order);

create or replace function cat_categories_guard() returns trigger language plpgsql set search_path = public as $$
declare pd int; h int;
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g');
  new.updated_at := now();
  if new.parent_id is null then
    new.depth := 1;
  else
    if tg_op = 'UPDATE' and new.parent_id = new.id then raise exception 'a category cannot be its own parent' using errcode = '23514'; end if;
    if tg_op = 'UPDATE' and exists (
      with recursive d as (select id from cat_categories where parent_id = new.id union all select c.id from cat_categories c join d on c.parent_id = d.id)
      select 1 from d where id = new.parent_id) then
      raise exception 'a category cannot be moved under one of its own sub-categories' using errcode = '23514';
    end if;
    select depth into pd from cat_categories where id = new.parent_id;
    if not found then raise exception 'the parent category does not exist' using errcode = '23503'; end if;
    new.depth := pd + 1;
  end if;
  if tg_op = 'UPDATE' then
    with recursive d as (select id, 1 as h from cat_categories where parent_id = new.id union all select c.id, d.h + 1 from cat_categories c join d on c.parent_id = d.id)
    select coalesce(max(d.h), 0) into h from d;
    if new.depth + h > 4 then raise exception 'categories can be at most 4 levels deep' using errcode = '23514'; end if;
  end if;
  if new.depth > 4 then raise exception 'categories can be at most 4 levels deep' using errcode = '23514'; end if;
  return new;
end $$;
create trigger cat_categories_guard_t before insert or update on cat_categories for each row execute function cat_categories_guard();
create or replace function cat_categories_after() returns trigger language plpgsql set search_path = public as $$
begin
  if old.depth is distinct from new.depth then update cat_categories set parent_id = parent_id where parent_id = new.id; end if;   -- re-levels the whole sub-tree
  return new;
end $$;
create trigger cat_categories_after_t after update on cat_categories for each row execute function cat_categories_after();
revoke execute on function cat_categories_guard(), cat_categories_after() from public, anon, authenticated;

create table cat_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references cat_categories(id),
  name text not null check (char_length(btrim(name)) between 1 and 150),
  code text check (code is null or char_length(btrim(code)) between 1 and 40),
  description text check (description is null or char_length(description) <= 500),
  pricing_method text not null default 'per_unit' check (pricing_method in ('fixed_per_album', 'per_sheet', 'per_unit', 'one_time_order')),
  rate numeric(12,2) check (rate is null or rate >= 0),                      -- standard rate; null = priced only by rate rules
  unit text not null default 'pcs' check (char_length(btrim(unit)) between 1 and 20),
  option_kind text check (option_kind in ('printing', 'design', 'cover', 'binding', 'box')),
  sort_order int not null default 0,
  active boolean not null default true,
  is_sample boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (option_kind is null or option_kind not in ('printing', 'design') or pricing_method = 'per_sheet'),
  check (option_kind is null or option_kind not in ('cover', 'binding', 'box') or pricing_method in ('per_unit', 'fixed_per_album'))
);
create unique index cat_items_name_key on cat_items (category_id, lower(btrim(name)));
create unique index cat_items_code_key on cat_items (lower(btrim(code))) where code is not null;
create unique index cat_items_one_printing on cat_items (option_kind) where option_kind in ('printing', 'design') and active;   -- one active printing and one design rate card
create index cat_items_category on cat_items (category_id, sort_order);
create or replace function cat_items_guard() returns trigger language plpgsql set search_path = public as $$
begin
  new.name := regexp_replace(btrim(new.name), '\s+', ' ', 'g'); new.updated_at := now();
  new.code := nullif(btrim(coalesce(new.code, '')), '');
  return new;
end $$;
create trigger cat_items_guard_t before insert or update on cat_items for each row execute function cat_items_guard();
revoke execute on function cat_items_guard() from public, anon, authenticated;

-- one rate per requirement combination: size / paper type / finish (any of them may be left open = "any")
create table cat_rates (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references cat_items(id) on delete cascade,
  size text check (size is null or char_length(btrim(size)) between 1 and 60),
  paper text check (paper is null or char_length(btrim(paper)) between 1 and 60),
  finish text check (finish is null or char_length(btrim(finish)) between 1 and 60),
  rate numeric(12,2) not null check (rate >= 0),
  created_at timestamptz not null default now(),
  check (size is not null or paper is not null or finish is not null)
);
create unique index cat_rates_key on cat_rates (item_id, coalesce(lower(size), ''), coalesce(lower(paper), ''), coalesce(lower(finish), ''));

alter table cat_categories enable row level security; alter table cat_items enable row level security; alter table cat_rates enable row level security;
revoke all on cat_categories, cat_items, cat_rates from anon;
grant select, insert, update on cat_categories, cat_items to authenticated;
grant select, insert, update, delete on cat_rates to authenticated;
create policy cat_categories_read  on cat_categories for select to authenticated using (current_app_role() is not null);
create policy cat_categories_write on cat_categories for insert to authenticated with check (current_app_role() = 'admin');
create policy cat_categories_upd   on cat_categories for update to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create policy cat_items_read  on cat_items for select to authenticated using (current_app_role() is not null);
create policy cat_items_write on cat_items for insert to authenticated with check (current_app_role() = 'admin');
create policy cat_items_upd   on cat_items for update to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create policy cat_rates_read  on cat_rates for select to authenticated using (current_app_role() is not null);
create policy cat_rates_write on cat_rates for all    to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create trigger cat_categories_audit after insert or update on cat_categories for each row execute function audit_admin_row();
create trigger cat_items_audit      after insert or update on cat_items      for each row execute function audit_admin_row();
create trigger cat_rates_audit      after insert or update or delete on cat_rates for each row execute function audit_admin_row();

-- ───────── invoices: new columns (the classic invoice mechanics are unchanged) ─────────
alter table invoices
  add column if not exists calc_mode text not null default 'legacy' check (calc_mode in ('legacy', 'v2')),
  add column if not exists discount_type text check (discount_type is null or discount_type in ('fixed', 'percent')),
  add column if not exists discount_value numeric(12,2),
  add column if not exists discount_amount numeric(12,2),
  add column if not exists tax_label text,
  add column if not exists tax_rate numeric(5,2),
  add column if not exists tax_amount numeric(12,2),
  add column if not exists pricing_revision int,
  add column if not exists snapshot jsonb;
alter table invoice_lines
  add column if not exists section text,
  add column if not exists scope text check (scope is null or scope in ('copy', 'album', 'order')),
  add column if not exists note text,
  add column if not exists line_no int;

create or replace function invoice_recompute(p_invoice uuid) returns void language plpgsql set search_path = public as $$
declare sub numeric; d numeric; tx numeric; i invoices;
begin
  select * into i from invoices where id = p_invoice;
  select coalesce(sum(qty * rate), 0) into sub from invoice_lines where invoice_id = p_invoice;
  if i.calc_mode = 'v2' then
    update invoices set subtotal = sub, tax = coalesce(i.tax_amount, 0), total = sub - coalesce(i.discount_amount, 0) + coalesce(i.tax_amount, 0) where id = p_invoice;
    return;
  end if;
  d := round(sub * i.discount_pct / 100, 2);
  tx := round((sub - d) * i.gst_rate / 100, 2);
  update invoices set subtotal = sub, tax = tx, total = coalesce(i.amount, sub - d + tx) where id = p_invoice;
end $$;

-- ───────── drafts, pricing snapshot, charge lines ─────────
create table order_drafts (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null default auth.uid() references profiles(id),
  title text,
  payload jsonb not null default '{}',
  result jsonb,                                  -- set once finalized: the same answer is returned if the request is repeated
  order_id uuid references orders(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index order_drafts_owner on order_drafts (created_by, updated_at desc);
alter table order_drafts enable row level security;
revoke all on order_drafts from anon;
grant select, insert, update, delete on order_drafts to authenticated;
create policy drafts_own on order_drafts for all to authenticated
  using (current_app_role() is not null and (created_by = auth.uid() or current_app_role() = 'admin'))
  with check (has_perm('order', 'write') and (created_by = auth.uid() or current_app_role() = 'admin'));
create or replace function order_drafts_guard() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.result is not null and (new.payload is distinct from old.payload) then raise exception 'this draft is already finalized' using errcode = '23514'; end if;
  if tg_op = 'DELETE' then
    if old.result is not null then raise exception 'a finalized draft is part of the order record' using errcode = '23514'; end if;
    return old;
  end if;
  return new;
end $$;
create trigger order_drafts_guard_t before update or delete on order_drafts for each row execute function order_drafts_guard();
revoke execute on function order_drafts_guard() from public, anon, authenticated;

create table order_pricing (
  order_id uuid primary key references orders(id) on delete cascade,
  revision int not null default 1 check (revision >= 1),
  status text not null default 'finalized' check (status in ('finalized', 'reopened')),
  order_type text not null check (order_type in ('design_printing', 'printing_only')),
  subtotal numeric(12,2) not null check (subtotal >= 0),
  discount_type text check (discount_type is null or discount_type in ('fixed', 'percent')),
  discount_value numeric(12,2) not null default 0 check (discount_value >= 0),
  discount_amount numeric(12,2) not null default 0 check (discount_amount >= 0),
  tax_enabled boolean not null default false,
  tax_label text,
  tax_rate numeric(5,2) not null default 0,
  taxable numeric(12,2) not null check (taxable >= 0),
  tax_amount numeric(12,2) not null default 0 check (tax_amount >= 0),
  total numeric(12,2) not null check (total >= 0),
  payload jsonb not null,                        -- the selections, so an authorized reopen can edit them again
  snapshot jsonb not null,                       -- the priced breakdown with names, requirements, rates and business details as they were
  invoice_id uuid references invoices(id),
  finalized_at timestamptz not null default now(),
  finalized_by uuid references profiles(id) default auth.uid(),
  reopened_at timestamptz, reopened_by uuid references profiles(id), reopen_reason text,
  updated_at timestamptz not null default now()
);
create table order_charge_lines (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  revision int not null default 1,
  album_position int,                            -- null = a charge on the whole order
  position int not null check (position >= 1),
  kind text not null check (kind in ('printing', 'design', 'item')),
  item_id uuid references cat_items(id),
  name text not null,
  unit text,
  method text not null check (method in ('fixed_per_album', 'per_sheet', 'per_unit', 'one_time_order')),
  scope text not null check (scope in ('copy', 'album', 'order')),
  qty numeric(10,2) not null check (qty > 0),
  copies int not null default 1 check (copies >= 1),
  rate numeric(12,2) not null check (rate >= 0),
  rate_basis text,
  amount numeric(12,2) not null check (amount >= 0),
  note text,
  unique (order_id, revision, album_position, position)
);
create index order_charge_lines_order on order_charge_lines (order_id, revision);
alter table order_pricing enable row level security; alter table order_charge_lines enable row level security;
revoke all on order_pricing, order_charge_lines from anon;
grant select on order_pricing, order_charge_lines to authenticated;                    -- written only by finalize_order_v2 / reopen_order_pricing
create policy opricing_read on order_pricing for select to authenticated using (has_perm('invoices', 'view'));
create policy olines_read   on order_charge_lines for select to authenticated using (has_perm('invoices', 'view'));
create trigger order_pricing_audit after insert or update on order_pricing for each row execute function audit_row();

-- a finalized price cannot be edited, even by an admin, except through reopen_order_pricing / finalize_order_v2
create or replace function order_pricing_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if coalesce(current_setting('app.pricing_fn', true), '') <> '1' and not is_system() then raise exception 'finalized pricing can only change through an authorized reopen' using errcode = '42501'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger order_pricing_guard_t before insert or update on order_pricing for each row execute function order_pricing_guard();
revoke execute on function order_pricing_guard() from public, anon, authenticated;

-- ───────── the pricing engine ─────────
-- The rate for one item and one set of requirements: the most specific matching rule wins (size, then paper, then finish break a tie);
-- otherwise the item's standard rate; otherwise none ("Price not configured").
create or replace function cat_resolve_rate(p_item uuid, p_size text, p_paper text, p_finish text, out o_rate numeric, out o_basis text)
language plpgsql stable set search_path = public as $$
declare r cat_rates; i cat_items;
begin
  select * into r from cat_rates
   where item_id = p_item
     and (size is null or lower(size) = lower(coalesce(p_size, '')))
     and (paper is null or lower(paper) = lower(coalesce(p_paper, '')))
     and (finish is null or lower(finish) = lower(coalesce(p_finish, '')))
   order by ((size is not null)::int + (paper is not null)::int + (finish is not null)::int) desc, (size is not null) desc, (paper is not null) desc, (finish is not null) desc, id
   limit 1;
  if found then
    o_rate := r.rate;
    o_basis := concat_ws(' · ', case when r.size is not null then 'size ' || r.size end, case when r.paper is not null then 'paper ' || r.paper end, case when r.finish is not null then 'finish ' || r.finish end);
    return;
  end if;
  select * into i from cat_items where id = p_item;
  if i.rate is not null then o_rate := i.rate; o_basis := 'standard rate'; end if;
end $$;

create or replace function cat_price_line(p_item cat_items, p_qty numeric, p_sheets int, p_size text, p_paper text, p_finish text, p_kind text) returns jsonb
language plpgsql stable set search_path = public as $$
declare scope text; qty numeric; rr record; missing boolean;
begin
  scope := case p_item.pricing_method when 'per_sheet' then 'copy' when 'per_unit' then 'copy' when 'fixed_per_album' then 'album' else 'order' end;
  qty := case p_item.pricing_method when 'per_sheet' then p_sheets when 'per_unit' then p_qty else 1 end;
  select * into rr from cat_resolve_rate(p_item.id, p_size, p_paper, p_finish);
  missing := rr.o_rate is null;
  return jsonb_build_object('kind', p_kind, 'itemId', p_item.id, 'name', p_item.name, 'unit', p_item.unit, 'method', p_item.pricing_method, 'scope', scope, 'qty', qty,
    'rate', rr.o_rate, 'rule', rr.o_basis, 'missing', missing, 'unitAmount', case when missing then 0 else qty * rr.o_rate end, 'optionKind', p_item.option_kind);
end $$;

create or replace function order_price(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  otype text := coalesce(p->>'orderType', ''); designed boolean := (otype = 'design_printing');
  st pricing_settings; prn cat_items; dsn cat_items; ci cat_items;
  a jsonb; it jsonb; ln jsonb; seen text[]; kinds text[];
  errs jsonb := '[]'::jsonb; albums jsonb := '[]'::jsonb; olines jsonb := '[]'::jsonb; alines jsonb;
  ai int := 0; sheets int; copies int; qty numeric; per_copy numeric; per_album numeric; atotal numeric; sub numeric := 0; any_missing boolean := false;
  size text; paper text; finish text;
  dtype text; dval numeric; disc numeric := 0; taxable numeric; tax numeric := 0; apply_tax boolean; total numeric; pos int;
begin
  if otype not in ('design_printing', 'printing_only') then errs := errs || jsonb_build_array(jsonb_build_object('path', 'orderType', 'message', 'Choose the order type')); end if;
  select * into st from pricing_settings;
  select * into prn from cat_items where option_kind = 'printing' and active limit 1;
  select * into dsn from cat_items where option_kind = 'design' and active limit 1;
  if jsonb_typeof(p->'albums') is distinct from 'array' or jsonb_array_length(p->'albums') = 0 then
    errs := errs || jsonb_build_array(jsonb_build_object('path', 'albums', 'message', 'Add at least one album'));
  end if;

  for a in select value from jsonb_array_elements(case when jsonb_typeof(p->'albums') = 'array' then p->'albums' else '[]'::jsonb end) loop
    ai := ai + 1; alines := '[]'::jsonb; per_copy := 0; per_album := 0; pos := 0; seen := '{}'; kinds := '{}';
    sheets := case when coalesce(a->>'sheets', '') ~ '^[0-9]{1,6}$' then (a->>'sheets')::int else 0 end;
    copies := case when coalesce(a->>'copies', '') ~ '^[0-9]{1,4}$' then (a->>'copies')::int else 0 end;
    size := nullif(btrim(coalesce(a->>'size', '')), ''); paper := nullif(btrim(coalesce(a->>'paper', '')), ''); finish := nullif(btrim(coalesce(a->>'finish', '')), '');
    if sheets < 1 then errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.sheets', 'message', 'Album ' || ai || ': sheets must be a positive whole number')); end if;
    if copies < 1 then errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.copies', 'message', 'Album ' || ai || ': copies must be a positive whole number')); end if;
    if nullif(btrim(coalesce(a->>'name', '')), '') is null then errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.name', 'message', 'Album ' || ai || ': enter an album name or reference')); end if;

    -- printing (always) and design (Design + Printing only): sheets × rate, per copy
    if prn.id is null then
      errs := errs || jsonb_build_array(jsonb_build_object('path', 'catalog.printing', 'message', 'Printing rate card is not set up. Ask an admin to add it in Catalog.'));
      any_missing := true;
    else
      ln := cat_price_line(prn, 1, sheets, size, paper, finish, 'printing'); pos := pos + 1;
      alines := alines || jsonb_build_array(ln || jsonb_build_object('position', pos));
      if (ln->>'missing')::boolean then any_missing := true; errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.printing', 'message', 'Album ' || ai || ': printing price not configured for this size / paper / finish')); end if;
    end if;
    if designed then
      if dsn.id is null then
        errs := errs || jsonb_build_array(jsonb_build_object('path', 'catalog.design', 'message', 'Design rate card is not set up. Ask an admin to add it in Catalog.'));
        any_missing := true;
      else
        ln := cat_price_line(dsn, 1, sheets, size, paper, finish, 'design'); pos := pos + 1;
        alines := alines || jsonb_build_array(ln || jsonb_build_object('position', pos));
        if (ln->>'missing')::boolean then any_missing := true; errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.design', 'message', 'Album ' || ai || ': design price not configured for this size / paper / finish')); end if;
      end if;
    end if;

    -- selected items
    for it in select value from jsonb_array_elements(case when jsonb_typeof(a->'items') = 'array' then a->'items' else '[]'::jsonb end) loop
      select * into ci from cat_items where id = nullif(it->>'itemId', '')::uuid;
      if not found then errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': a selected item no longer exists')); continue; end if;
      if not ci.active then errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': “' || ci.name || '” is no longer available')); continue; end if;
      if ci.pricing_method = 'one_time_order' then errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': “' || ci.name || '” is an order-level charge')); continue; end if;
      if ci.option_kind in ('printing', 'design') then errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': printing and design are added automatically')); continue; end if;
      if ci.id::text = any (seen) then errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': “' || ci.name || '” is added twice — change its quantity instead')); continue; end if;
      seen := seen || ci.id::text;
      if ci.option_kind is not null then
        if ci.option_kind = any (kinds) then errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': choose only one ' || ci.option_kind)); continue; end if;
        kinds := kinds || ci.option_kind;
      end if;
      if ci.pricing_method = 'per_unit' then
        if coalesce(it->>'qty', '') !~ '^[0-9]{1,5}$' or (it->>'qty')::numeric < 1 then
          errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': “' || ci.name || '” needs a quantity of 1 or more (whole number)')); continue;
        end if;
        qty := (it->>'qty')::numeric;
      else qty := 1; end if;
      ln := cat_price_line(ci, qty, sheets, size, paper, finish, 'item'); pos := pos + 1;
      alines := alines || jsonb_build_array(ln || jsonb_build_object('position', pos, 'note', nullif(btrim(coalesce(it->>'note', '')), '')));
      if (ln->>'missing')::boolean then any_missing := true; errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': price not configured for “' || ci.name || '” with these requirements')); end if;
    end loop;

    -- album total = per-copy subtotal × copies + fixed per-album charges; each line gets its extended amount
    alines := (select coalesce(jsonb_agg(
        l || jsonb_build_object('amount', case l->>'scope' when 'copy' then (l->>'unitAmount')::numeric * greatest(copies, 0) else (l->>'unitAmount')::numeric end,
                                'perCopy', case l->>'scope' when 'copy' then (l->>'unitAmount')::numeric end) order by (l->>'position')::int), '[]'::jsonb)
      from jsonb_array_elements(alines) l);
    select coalesce(sum((l->>'perCopy')::numeric), 0), coalesce(sum(case when l->>'scope' = 'album' then (l->>'amount')::numeric end), 0) into per_copy, per_album from jsonb_array_elements(alines) l;
    atotal := per_copy * greatest(copies, 0) + per_album; sub := sub + atotal;
    albums := albums || jsonb_build_array(jsonb_build_object('index', ai, 'id', a->>'id', 'name', coalesce(nullif(btrim(coalesce(a->>'name', '')), ''), 'Album ' || ai), 'sheets', sheets, 'copies', copies,
      'size', size, 'paper', paper, 'finish', finish, 'notes', nullif(btrim(coalesce(a->>'notes', '')), ''), 'lines', alines, 'perCopy', per_copy, 'perAlbum', per_album, 'total', atotal));
  end loop;

  -- one-time order charges
  seen := '{}'; pos := 0;
  for it in select value from jsonb_array_elements(case when jsonb_typeof(p->'orderCharges') = 'array' then p->'orderCharges' else '[]'::jsonb end) loop
    select * into ci from cat_items where id = nullif(it->>'itemId', '')::uuid;
    if not found or not ci.active then errs := errs || jsonb_build_array(jsonb_build_object('path', 'orderCharges', 'message', 'An order charge is no longer available')); continue; end if;
    if ci.pricing_method <> 'one_time_order' then errs := errs || jsonb_build_array(jsonb_build_object('path', 'orderCharges', 'message', '“' || ci.name || '” is not a one-time order charge')); continue; end if;
    if ci.id::text = any (seen) then errs := errs || jsonb_build_array(jsonb_build_object('path', 'orderCharges', 'message', '“' || ci.name || '” is added twice')); continue; end if;
    seen := seen || ci.id::text; pos := pos + 1;
    ln := cat_price_line(ci, 1, 1, null, null, null, 'item');
    ln := ln || jsonb_build_object('position', pos, 'amount', (ln->>'unitAmount')::numeric, 'perCopy', null);
    olines := olines || jsonb_build_array(ln);
    if (ln->>'missing')::boolean then any_missing := true; errs := errs || jsonb_build_array(jsonb_build_object('path', 'orderCharges', 'message', 'Price not configured for “' || ci.name || '”')); else sub := sub + (ln->>'amount')::numeric; end if;
  end loop;

  -- discount (fixed or percentage), never more than the amount it applies to
  dtype := nullif(p->'discount'->>'type', ''); dval := case when coalesce(p->'discount'->>'value', '') ~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then (p->'discount'->>'value')::numeric else 0 end;
  if dtype is not null and dtype not in ('fixed', 'percent', 'none') then errs := errs || jsonb_build_array(jsonb_build_object('path', 'discount', 'message', 'Choose a fixed or percentage discount')); dtype := null; end if;
  if dtype = 'none' then dtype := null; dval := 0; end if;
  if coalesce(p->'discount'->>'value', '') <> '' and coalesce(p->'discount'->>'value', '') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then errs := errs || jsonb_build_array(jsonb_build_object('path', 'discount', 'message', 'Enter a valid discount (0 or more, up to 2 decimals)')); dval := 0; end if;
  if dtype = 'percent' then
    if dval > 100 then errs := errs || jsonb_build_array(jsonb_build_object('path', 'discount', 'message', 'A percentage discount cannot be more than 100%')); dval := 0; end if;
    disc := round(sub * dval / 100, 2);
  elsif dtype = 'fixed' then
    if dval > sub then errs := errs || jsonb_build_array(jsonb_build_object('path', 'discount', 'message', 'The discount cannot be more than the order subtotal')); dval := 0; end if;
    disc := dval;
  end if;
  taxable := sub - disc;
  apply_tax := st.tax_enabled and coalesce((p->>'applyTax')::boolean, true);
  if apply_tax then tax := round(taxable * st.tax_rate / 100, 2); end if;
  total := taxable + tax;
  return jsonb_build_object('orderType', otype, 'albums', albums, 'orderLines', olines, 'subtotal', sub,
    'discountType', dtype, 'discountValue', dval, 'discountAmount', disc, 'taxEnabled', apply_tax, 'taxLabel', st.tax_label, 'taxRate', case when apply_tax then st.tax_rate else 0 end,
    'taxable', taxable, 'tax', tax, 'total', total, 'errors', errs, 'hasMissingPrice', any_missing, 'canFinalize', (jsonb_array_length(errs) = 0 and not any_missing and jsonb_array_length(albums) > 0));
end $$;
grant execute on function order_price(jsonb) to authenticated;
revoke execute on function order_price(jsonb) from public, anon;
revoke execute on function cat_resolve_rate(uuid, text, text, text), cat_price_line(cat_items, numeric, int, text, text, text, text) from public, anon, authenticated;

-- ───────── business details for the invoice (settings are admin-only, the invoice needs them for everyone who creates orders) ─────────
create or replace function business_profile() returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce((select jsonb_strip_nulls(jsonb_build_object('name', value->>'name', 'legal', value->>'legal', 'address', coalesce(value->>'caddr', value->>'address'), 'phone', value->>'phone', 'email', value->>'email',
    'website', value->>'website', 'gstin', value->>'gstin', 'pan', value->>'pan', 'state', value->>'state')) from settings where key = 'company'), '{}'::jsonb)
  where current_app_role() is not null $$;
revoke execute on function business_profile() from public, anon;
grant execute on function business_profile() to authenticated;

-- ───────── finalize ─────────
-- Writes the order, its albums, the priced lines, the pricing snapshot and the invoice in one transaction. The draft row is locked first, so a double click
-- or a retry returns the same order and invoice instead of creating a second one. A reopened order (reopen_order_pricing) is re-finalized as a new revision.
create or replace function finalize_order_v2(p_draft uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  d order_drafts; pay jsonb; pr jsonb; ev jsonb; nc jsonb; cust customers; o orders; op order_pricing; inv invoices; biz jsonb; snap jsonb;
  rev int := 1; lno int := 0; reopen uuid; a jsonb; ln jsonb; k int; pos int; designed boolean; due date; odate date := current_date; ptype text; thr numeric; pct numeric;
  cover text; binding text; box text; res jsonb; st pricing_settings; prio priority_level;
begin
  if current_app_role() is null or not has_perm('order', 'write') then raise exception 'you cannot create orders' using errcode = '42501'; end if;
  select * into d from order_drafts where id = p_draft for update;
  if not found then raise exception 'draft not found'; end if;
  if d.created_by <> auth.uid() and current_app_role() <> 'admin' then raise exception 'this draft belongs to someone else' using errcode = '42501'; end if;
  if d.result is not null then return d.result; end if;                                   -- already finalized: same answer

  pay := d.payload; pr := order_price(pay); designed := (pay->>'orderType') = 'design_printing';
  if not (pr->>'canFinalize')::boolean then raise exception 'cannot finalize: %', coalesce(pr->'errors'->0->>'message', 'a price is not configured') using errcode = '23514'; end if;
  ev := coalesce(pay->'event', '{}'::jsonb);
  if nullif(btrim(coalesce(ev->>'type', '')), '') is null then raise exception 'choose the event type' using errcode = '23514'; end if;
  if coalesce(ev->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'enter the event date' using errcode = '23514'; end if;
  if coalesce(ev->>'delivery', '') <> '' and coalesce(ev->>'delivery', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'the delivery date is not valid' using errcode = '23514'; end if;
  select * into st from pricing_settings;
  due := coalesce(nullif(ev->>'delivery', '')::date, odate + st.default_delivery_days);
  if due < odate then raise exception 'the delivery date cannot be before the order date' using errcode = '23514'; end if;

  -- discounts above the approval threshold need an admin (the existing rule)
  thr := coalesce((select (value->>'discount_approval_pct')::numeric from settings where key = 'pricing'), 10);
  pct := case when (pr->>'subtotal')::numeric > 0 then (pr->>'discountAmount')::numeric * 100 / (pr->>'subtotal')::numeric else 0 end;
  if pct > thr and current_app_role() <> 'admin' then raise exception 'a discount above % % needs an admin to finalize', thr, '%' using errcode = '42501'; end if;

  -- customer
  if nullif(pay->>'customerId', '') is not null then
    select * into cust from customers where id = (pay->>'customerId')::uuid;
    if not found then raise exception 'the selected customer was not found'; end if;
  else
    nc := coalesce(pay->'newCustomer', '{}'::jsonb);
    if char_length(btrim(coalesce(nc->>'name', ''))) < 2 then raise exception 'enter the customer name' using errcode = '23514'; end if;
    if coalesce(nc->>'phone', '') !~ '^[6-9][0-9]{9}$' then raise exception 'enter a 10-digit phone number starting with 6, 7, 8 or 9' using errcode = '23514'; end if;
    insert into customers(studio_name, contact_person, mobile, email, address, code)
      values (btrim(nc->>'name'), btrim(nc->>'name'), nc->>'phone', nullif(btrim(coalesce(nc->>'email', '')), ''), nullif(btrim(coalesce(nc->>'address', '')), ''), 'pending') returning * into cust;
  end if;

  prio := case lower(coalesce(ev->>'priority', '')) when 'low' then 'low' when 'high' then 'high' when 'urgent' then 'urgent' when 'vip' then 'vip' else 'normal' end::priority_level;
  reopen := nullif(pay->>'reopenOrder', '')::uuid;
  ptype := case when designed then 'design_printing' else 'printing_only' end;
  if reopen is not null then
    select * into op from order_pricing where order_id = reopen for update;
    if not found or op.status <> 'reopened' then raise exception 'this order is not open for editing' using errcode = '23514'; end if;
    perform set_config('app.pricing_fn', '1', true);
    rev := op.revision + 1;
    update orders set customer_id = cust.id, type = ptype::order_type, event_name = nullif(btrim(coalesce(ev->>'name', '')), ''), event_type = ev->>'type', event_date = (ev->>'date')::date, due_date = due,
      work_group = nullif(btrim(coalesce(ev->>'workGroup', '')), ''), priority = prio,
      special_instructions = nullif(btrim(coalesce(ev->>'notes', '')), ''), total = (pr->>'total')::numeric where id = reopen returning * into o;
  else
    insert into orders(customer_id, type, event_name, event_type, event_date, order_date, due_date, special_instructions, total, work_group, priority, code)
      values (cust.id, ptype::order_type, nullif(btrim(coalesce(ev->>'name', '')), ''), ev->>'type', (ev->>'date')::date, odate, due, nullif(btrim(coalesce(ev->>'notes', '')), ''), (pr->>'total')::numeric,
              nullif(btrim(coalesce(ev->>'workGroup', '')), ''), prio, 'pending') returning * into o;
  end if;
  perform set_config('app.pricing_fn', '1', true);

  -- albums (replace by position so other modules keep their links) and the album-1 specification the production screens read
  k := 0;
  for a in select value from jsonb_array_elements(pr->'albums') loop
    k := k + 1; cover := null; binding := null; box := null;
    for ln in select value from jsonb_array_elements(a->'lines') loop
      if ln->>'optionKind' = 'cover' then cover := ln->>'name'; elsif ln->>'optionKind' = 'binding' then binding := ln->>'name'; elsif ln->>'optionKind' = 'box' then box := ln->>'name'; end if;
    end loop;
    insert into order_albums(order_id, position, title, album_type, album_size, orientation, pages, copies, paper_type, cover_type, lamination, binding, box_type)
      values (o.id, k, a->>'name', 'Album', coalesce(a->>'size', '—'), lower(coalesce(nullif((pay->'albums'->(k-1))->>'orientation', ''), 'landscape')), (a->>'sheets')::int, (a->>'copies')::int, coalesce(a->>'paper', '—'), coalesce(cover, '—'), a->>'finish', coalesce(binding, '—'), box)
      on conflict (order_id, position) do update set title = excluded.title, album_size = excluded.album_size, orientation = excluded.orientation, pages = excluded.pages, copies = excluded.copies,
        paper_type = excluded.paper_type, cover_type = excluded.cover_type, lamination = excluded.lamination, binding = excluded.binding, box_type = excluded.box_type;
    if k = 1 then
      insert into order_specs(order_id, album_type, album_size, orientation, pages, copies, paper_type, cover_type, lamination, binding, box_required, box_type)
        values (o.id, 'Album', coalesce(a->>'size', '—'), lower(coalesce(nullif((pay->'albums'->0)->>'orientation', ''), 'landscape')), (a->>'sheets')::int, (a->>'copies')::int, coalesce(a->>'paper', '—'), coalesce(cover, '—'), a->>'finish', coalesce(binding, '—'), box is not null, box)
        on conflict (order_id) do update set album_size = excluded.album_size, orientation = excluded.orientation, pages = excluded.pages, copies = excluded.copies, paper_type = excluded.paper_type, cover_type = excluded.cover_type,
          lamination = excluded.lamination, binding = excluded.binding, box_required = excluded.box_required, box_type = excluded.box_type;
    end if;
  end loop;
  delete from order_albums where order_id = o.id and position > k;

  -- the invoice (draft while its lines are written, then sent), numbered by the server
  insert into invoices(number, order_id, customer_id, due_date, status, calc_mode, discount_pct, gst_rate, igst, discount_type, discount_value, discount_amount, tax_label, tax_rate, tax_amount, pricing_revision, notes, discount_approved_by)
    values ('pending', o.id, cust.id, due, 'draft', 'v2', 0, 0, false, pr->>'discountType', (pr->>'discountValue')::numeric, (pr->>'discountAmount')::numeric,
            case when (pr->>'taxEnabled')::boolean then pr->>'taxLabel' end, (pr->>'taxRate')::numeric, (pr->>'tax')::numeric, rev, nullif(btrim(coalesce(ev->>'notes', '')), ''),
            case when pct > thr and current_app_role() = 'admin' then auth.uid() end) returning * into inv;

  k := 0;
  for a in select value from jsonb_array_elements(pr->'albums') loop
    k := k + 1; pos := 0;
    for ln in select value from jsonb_array_elements(a->'lines') loop
      pos := pos + 1;
      insert into order_charge_lines(order_id, revision, album_position, position, kind, item_id, name, unit, method, scope, qty, copies, rate, rate_basis, amount, note)
        values (o.id, rev, k, pos, ln->>'kind', (ln->>'itemId')::uuid, ln->>'name', ln->>'unit', ln->>'method', ln->>'scope', (ln->>'qty')::numeric, (a->>'copies')::int, (ln->>'rate')::numeric, ln->>'rule', (ln->>'amount')::numeric, ln->>'note');
      lno := lno + 1;
      insert into invoice_lines(invoice_id, line_no, description, qty, rate, section, scope, note)
        values (inv.id, lno, ln->>'name' || case ln->>'scope' when 'copy' then ' — ' || case when ln->>'method' = 'per_sheet' then (ln->>'qty')::numeric::int || ' sheets' else (ln->>'qty')::numeric::int || ' ' || coalesce(ln->>'unit', 'pcs') end || case when (a->>'copies')::int > 1 then ' × ' || (a->>'copies') || ' copies' else '' end
                                          when 'album' then ' — per album' else '' end,
                case ln->>'scope' when 'copy' then (ln->>'qty')::numeric * (a->>'copies')::int else 1 end, (ln->>'rate')::numeric, a->>'name', ln->>'scope', ln->>'rule');
    end loop;
  end loop;
  pos := 0;
  for ln in select value from jsonb_array_elements(pr->'orderLines') loop
    pos := pos + 1;
    insert into order_charge_lines(order_id, revision, album_position, position, kind, item_id, name, unit, method, scope, qty, copies, rate, rate_basis, amount, note)
      values (o.id, rev, null, pos, 'item', (ln->>'itemId')::uuid, ln->>'name', ln->>'unit', ln->>'method', 'order', 1, 1, (ln->>'rate')::numeric, ln->>'rule', (ln->>'amount')::numeric, null);
    lno := lno + 1;
    insert into invoice_lines(invoice_id, line_no, description, qty, rate, section, scope, note) values (inv.id, lno, ln->>'name' || ' — one-time order charge', 1, (ln->>'rate')::numeric, 'Order charges', 'order', ln->>'rule');
  end loop;
  perform invoice_recompute(inv.id);
  if (select total from invoices where id = inv.id) <> (pr->>'total')::numeric then raise exception 'internal check failed: the invoice total does not match the priced order'; end if;
  update invoices set status = 'sent', sent_at = now() where id = inv.id returning * into inv;

  biz := business_profile();
  snap := pr || jsonb_build_object('business', biz, 'customer', jsonb_strip_nulls(jsonb_build_object('id', cust.id, 'code', cust.code, 'name', cust.studio_name, 'phone', cust.mobile, 'email', cust.email, 'address', cust.address)),
    'event', ev, 'orderCode', o.code, 'orderDate', odate, 'dueDate', due, 'invoiceNumber', inv.number, 'invoiceDate', inv.issue_date, 'revision', rev, 'pricingSettings', to_jsonb(st) - 'updated_by' - 'updated_at');
  update invoices set snapshot = snap where id = inv.id;

  if reopen is not null then
    update order_pricing set revision = rev, status = 'finalized', order_type = ptype, subtotal = (pr->>'subtotal')::numeric, discount_type = pr->>'discountType', discount_value = (pr->>'discountValue')::numeric,
      discount_amount = (pr->>'discountAmount')::numeric, tax_enabled = (pr->>'taxEnabled')::boolean, tax_label = pr->>'taxLabel', tax_rate = (pr->>'taxRate')::numeric, taxable = (pr->>'taxable')::numeric,
      tax_amount = (pr->>'tax')::numeric, total = (pr->>'total')::numeric, payload = pay - 'reopenOrder', snapshot = snap, invoice_id = inv.id, finalized_at = now(), finalized_by = auth.uid() where order_id = o.id;
  else
    insert into order_pricing(order_id, revision, status, order_type, subtotal, discount_type, discount_value, discount_amount, tax_enabled, tax_label, tax_rate, taxable, tax_amount, total, payload, snapshot, invoice_id)
      values (o.id, 1, 'finalized', ptype, (pr->>'subtotal')::numeric, pr->>'discountType', (pr->>'discountValue')::numeric, (pr->>'discountAmount')::numeric, (pr->>'taxEnabled')::boolean, pr->>'taxLabel', (pr->>'taxRate')::numeric,
              (pr->>'taxable')::numeric, (pr->>'tax')::numeric, (pr->>'total')::numeric, pay, snap, inv.id);
  end if;
  perform set_config('app.pricing_fn', '', true);

  res := jsonb_build_object('orderId', o.id, 'code', o.code, 'invoiceId', inv.id, 'invoiceNumber', inv.number, 'total', (pr->>'total')::numeric, 'revision', rev);
  update order_drafts set result = res, order_id = o.id where id = p_draft;
  return res;
end $$;
revoke execute on function finalize_order_v2(uuid) from public, anon;
grant execute on function finalize_order_v2(uuid) to authenticated;

-- ───────── explicit, authorized edit of a finalized order ─────────
-- Admin only, with a reason. The current invoice is voided (and kept), the selections come back as a draft, and finalizing again issues a new invoice revision.
create or replace function reopen_order_pricing(p_order uuid, p_reason text) returns uuid language plpgsql security definer set search_path = public as $$
declare op order_pricing; d uuid;
begin
  if current_app_role() <> 'admin' then raise exception 'only an administrator can reopen a finalized order' using errcode = '42501'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'give a reason for reopening the order' using errcode = '23514'; end if;
  select * into op from order_pricing where order_id = p_order for update;
  if not found then raise exception 'this order has no finalized pricing' using errcode = '23514'; end if;
  if op.status <> 'finalized' then raise exception 'this order is already open for editing' using errcode = '23514'; end if;
  if exists (select 1 from orders where id = p_order and (stage in ('closed', 'cancelled') or main_status in ('closed', 'cancelled'))) then raise exception 'a closed or cancelled order cannot be reopened' using errcode = '23514'; end if;
  perform set_config('app.pricing_fn', '1', true);
  update invoices set status = 'void', notes = coalesce(notes || E'\n', '') || 'Voided: order reopened (' || btrim(p_reason) || ')' where id = op.invoice_id;
  update order_pricing set status = 'reopened', reopened_at = now(), reopened_by = auth.uid(), reopen_reason = btrim(p_reason) where order_id = p_order;
  perform set_config('app.pricing_fn', '', true);
  insert into order_drafts(created_by, title, payload) values (auth.uid(), 'Editing ' || (select code from orders where id = p_order), op.payload || jsonb_build_object('reopenOrder', p_order)) returning id into d;
  return d;
end $$;
-- changed their mind: put the order back exactly as it was finalized
create or replace function cancel_reopen_pricing(p_order uuid) returns void language plpgsql security definer set search_path = public as $$
declare op order_pricing;
begin
  if current_app_role() <> 'admin' then raise exception 'only an administrator can do this' using errcode = '42501'; end if;
  select * into op from order_pricing where order_id = p_order for update;
  if not found or op.status <> 'reopened' then raise exception 'this order is not open for editing' using errcode = '23514'; end if;
  perform set_config('app.pricing_fn', '1', true);
  update invoices set status = 'sent' where id = op.invoice_id;
  update order_pricing set status = 'finalized' where order_id = p_order;
  perform set_config('app.pricing_fn', '', true);
  delete from order_drafts where created_by is not null and result is null and (payload->>'reopenOrder')::uuid = p_order;
end $$;
revoke execute on function reopen_order_pricing(uuid, text), cancel_reopen_pricing(uuid) from public, anon;
grant execute on function reopen_order_pricing(uuid, text), cancel_reopen_pricing(uuid) to authenticated;

-- ───────── bring the classic catalog across: "PAPER-NT-125 GSM-GLOSSY" → PAPER ▸ NT ▸ 125 GSM ▸ item GLOSSY ─────────
-- The classic catalog stays as it is (old orders use it); this copies its items into the new hierarchy as "rate per unit" items. Safe to run again.
create or replace function cat_import_classic() returns int language plpgsql security definer set search_path = public as $$
declare r record; parts text[]; n int; cats int; parent uuid; cid uuid; nm text; k int; item_name text; added int := 0; got int;
begin
  if not is_system() and current_app_role() <> 'admin' then raise exception 'only an administrator can import the classic catalog' using errcode = '42501'; end if;
  for r in select * from catalog_items order by name loop
    parts := (select array_agg(btrim(x)) from unnest(string_to_array(r.name, '-')) x where btrim(x) <> '');
    if parts is null then continue; end if;
    n := array_length(parts, 1);
    cats := least(greatest(n - 1, 1), 4);
    parent := null;
    for k in 1..cats loop
      nm := regexp_replace(parts[k], '\s+', ' ', 'g'); cid := null;
      select id into cid from cat_categories where coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(parent, '00000000-0000-0000-0000-000000000000'::uuid) and lower(name) = lower(nm);
      if cid is null then insert into cat_categories(parent_id, name, sort_order) values (parent, nm, k) returning id into cid; end if;
      parent := cid;
    end loop;
    item_name := case when n = 1 then parts[1] when n - 1 <= 4 then parts[n] else array_to_string(parts[5:n], '-') end;
    insert into cat_items(category_id, name, code, pricing_method, rate, unit, active)
      values (parent, item_name, nullif(btrim(coalesce(r.sku, '')), ''), 'per_unit', r.sell_price, r.unit, r.active) on conflict do nothing;
    get diagnostics got = row_count; added := added + got;
  end loop;
  return added;
end $$;
revoke execute on function cat_import_classic() from public, anon;
grant execute on function cat_import_classic() to authenticated;
select cat_import_classic();
