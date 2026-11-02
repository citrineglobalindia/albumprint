-- Order lines like an invoice table: a price typed on a line (items[].price) replaces the catalog rate, and a line discount
-- (items[].disc = {type: fixed|percent, value}) comes off the line. Line discounts go into the invoice discount; everything charged
-- below catalog prices counts toward the discount-approval limit. Mirrored in src/lib/orderPricing.ts.
create or replace function order_price(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  item_sheets int; dmode text; drate numeric; dqty int;
  ov text; lrate numeric; lq numeric; erate numeric; emiss boolean; gross numeric; ldisc numeric; dv text; dt text; list_sub numeric := 0; line_disc numeric := 0; reduction numeric := 0;
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
    dmode := coalesce(nullif(a->'design'->>'mode', ''), case when dsn.id is null then 'per_sheet' else 'card' end);
    if designed and dmode in ('per_sheet', 'fixed') then              -- design charge typed on the order: once per album
      if coalesce(a->'design'->>'amount', '') !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
        errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.design', 'message', 'Album ' || ai || ': enter the design charge (0 or more, up to 2 decimals)'));
      else
        drate := (a->'design'->>'amount')::numeric; dqty := case when dmode = 'per_sheet' then sheets else 1 end; pos := pos + 1;
        alines := alines || jsonb_build_array(jsonb_build_object('kind', 'design', 'itemId', null, 'name', 'Album design', 'unit', case when dmode = 'per_sheet' then 'sheet' else 'album' end,
          'method', case when dmode = 'per_sheet' then 'per_sheet' else 'fixed_per_album' end, 'scope', 'album', 'qty', dqty, 'rate', drate,
          'rule', case when dmode = 'per_sheet' then 'design rate entered on the order' else 'design charge entered on the order' end, 'missing', false, 'unitAmount', dqty * drate, 'optionKind', null, 'position', pos));
      end if;
    elsif designed and dmode <> 'card' then
      errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.design', 'message', 'Album ' || ai || ': choose how design is charged'));
    elsif designed then
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
      item_sheets := sheets;                                               -- a per-sheet item follows the album's sheets unless a sheet quantity is given
      if ci.pricing_method = 'per_sheet' and coalesce(it->>'sheetQty', '') <> '' then
        if (it->>'sheetQty') !~ '^[0-9]{1,5}$' or (it->>'sheetQty')::numeric < 1 then
          errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': “' || ci.name || '” needs a sheet quantity of 1 or more (whole number)')); continue;
        end if;
        item_sheets := (it->>'sheetQty')::int;
      end if;
      ln := cat_price_line(ci, qty, item_sheets, size, paper, finish, 'item');
      -- a price typed on the line replaces the catalog rate; a line discount (₹ or %) comes off the line
      ov := btrim(coalesce(it->>'price', ''));
      if ov <> '' and ov !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
        errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': enter a valid price for “' || ci.name || '” (0 or more, up to 2 decimals)')); continue;
      end if;
      lrate := (ln->>'rate')::numeric; lq := (ln->>'qty')::numeric;
      if ov <> '' then erate := ov::numeric; emiss := false; else erate := lrate; emiss := (ln->>'missing')::boolean; end if;
      gross := case when emiss then 0 else lq * erate end;
      ldisc := 0; dv := btrim(coalesce(it->'disc'->>'value', '')); dt := it->'disc'->>'type';
      if dv <> '' and dt is not null then
        if dt not in ('fixed', 'percent') or dv !~ '^[0-9]{1,10}(\.[0-9]{1,2})?$' then
          errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': enter a valid discount for “' || ci.name || '”')); continue;
        end if;
        if dt = 'percent' then
          if dv::numeric > 100 then errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': the discount on “' || ci.name || '” cannot be more than 100%')); continue; end if;
          ldisc := round(gross * dv::numeric / 100, 2);
        else
          ldisc := dv::numeric;
          if ldisc > gross then errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': the discount on “' || ci.name || '” is more than the line')); continue; end if;
        end if;
      else dt := null; end if;
      pos := pos + 1;
      ln := ln || jsonb_build_object('rate', erate, 'missing', emiss, 'listRate', lrate, 'priceEdited', ov <> '', 'gross', gross, 'discount', ldisc, 'discountType', dt,
        'discountValue', case when dt is null then 0 else dv::numeric end, 'unitAmount', gross - ldisc, 'listAmount', case when lrate is null then gross else lq * lrate end);
      alines := alines || jsonb_build_array(ln || jsonb_build_object('position', pos, 'note', nullif(btrim(coalesce(it->>'note', '')), '')));
      if emiss then any_missing := true; errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': price not configured for “' || ci.name || '” — set it in Catalog & Pricing or type a price on the line')); end if;
    end loop;

    -- album total = per-copy subtotal × copies + fixed per-album charges; each line gets its extended amount
    alines := (select coalesce(jsonb_agg(
        l || jsonb_build_object('amount', case l->>'scope' when 'copy' then (l->>'unitAmount')::numeric * greatest(copies, 0) else (l->>'unitAmount')::numeric end,
                                'perCopy', case l->>'scope' when 'copy' then (l->>'unitAmount')::numeric end) order by (l->>'position')::int), '[]'::jsonb)
      from jsonb_array_elements(alines) l);
    select coalesce(sum((l->>'perCopy')::numeric), 0), coalesce(sum(case when l->>'scope' = 'album' then (l->>'amount')::numeric end), 0) into per_copy, per_album from jsonb_array_elements(alines) l;
    atotal := per_copy * greatest(copies, 0) + per_album; sub := sub + atotal;
    select list_sub + coalesce(sum(coalesce((l->>'listAmount')::numeric, (l->>'unitAmount')::numeric) * case when l->>'scope' = 'copy' then greatest(copies, 0) else 1 end), 0),
           line_disc + coalesce(sum(coalesce((l->>'discount')::numeric, 0) * case when l->>'scope' = 'copy' then greatest(copies, 0) else 1 end), 0),
           reduction + coalesce(sum(greatest(0, coalesce((l->>'listAmount')::numeric, (l->>'unitAmount')::numeric) * case when l->>'scope' = 'copy' then greatest(copies, 0) else 1 end - (l->>'amount')::numeric)), 0)
      into list_sub, line_disc, reduction from jsonb_array_elements(alines) l;
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
    if (ln->>'missing')::boolean then any_missing := true; errs := errs || jsonb_build_array(jsonb_build_object('path', 'orderCharges', 'message', 'Price not configured for “' || ci.name || '”')); else sub := sub + (ln->>'amount')::numeric; list_sub := list_sub + (ln->>'amount')::numeric; end if;
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
    'taxable', taxable, 'tax', tax, 'total', total, 'listSubtotal', list_sub, 'lineDiscounts', line_disc, 'reduction', reduction + disc, 'errors', errs, 'hasMissingPrice', any_missing, 'canFinalize', (jsonb_array_length(errs) = 0 and not any_missing and jsonb_array_length(albums) > 0));
end $$;

revoke execute on function order_price(jsonb) from public, anon;
grant execute on function order_price(jsonb) to authenticated;

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
  if coalesce(ev->>'date', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'enter the event date' using errcode = '23514'; end if;
  if coalesce(ev->>'delivery', '') <> '' and coalesce(ev->>'delivery', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'the delivery date is not valid' using errcode = '23514'; end if;
  select * into st from pricing_settings;
  due := coalesce(nullif(ev->>'delivery', '')::date, odate + st.default_delivery_days);
  if due < odate then raise exception 'the delivery date cannot be before the order date' using errcode = '23514'; end if;

  -- discounts above the approval threshold need an admin (the existing rule)
  thr := coalesce((select (value->>'discount_approval_pct')::numeric from settings where key = 'pricing'), 10);
  -- everything below catalog prices (line discounts, lowered prices, the order discount) as a share of the order at catalog prices
  pct := case when coalesce((pr->>'listSubtotal')::numeric, 0) > 0 then (pr->>'reduction')::numeric * 100 / (pr->>'listSubtotal')::numeric else 0 end;
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
    update orders set customer_id = cust.id, type = ptype::order_type, event_name = nullif(btrim(coalesce(ev->>'name', '')), ''), event_type = nullif(btrim(coalesce(ev->>'type', '')), ''), event_date = (ev->>'date')::date, due_date = due,
      work_group = nullif(btrim(coalesce(ev->>'workGroup', '')), ''), priority = prio,
      special_instructions = nullif(btrim(coalesce(ev->>'notes', '')), ''), total = (pr->>'total')::numeric where id = reopen returning * into o;
  else
    insert into orders(customer_id, type, event_name, event_type, event_date, order_date, due_date, special_instructions, total, work_group, priority, code)
      values (cust.id, ptype::order_type, nullif(btrim(coalesce(ev->>'name', '')), ''), nullif(btrim(coalesce(ev->>'type', '')), ''), (ev->>'date')::date, odate, due, nullif(btrim(coalesce(ev->>'notes', '')), ''), (pr->>'total')::numeric,
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
    values ('pending', o.id, cust.id, due, 'draft', 'v2', 0, 0, false, pr->>'discountType', (pr->>'discountValue')::numeric, (pr->>'discountAmount')::numeric + coalesce((pr->>'lineDiscounts')::numeric, 0),
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
                case ln->>'scope' when 'copy' then (ln->>'qty')::numeric * (a->>'copies')::int else 1 end, (ln->>'rate')::numeric, a->>'name', ln->>'scope',
                nullif(concat_ws(' · ', case when (ln->>'priceEdited')::boolean then 'price set on the order' else ln->>'rule' end,
                  case when coalesce((ln->>'discount')::numeric, 0) > 0 then 'less discount ₹' || ((ln->>'discount')::numeric * case when ln->>'scope' = 'copy' then (a->>'copies')::int else 1 end)::text end), ''));
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
