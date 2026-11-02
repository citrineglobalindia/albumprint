-- Per-sheet items in an album can carry their own sheet quantity (items[].sheetQty). Left out, it follows the album's sheet count (as before).
-- Same function as 0036 otherwise; the browser engine (src/lib/orderPricing.ts) mirrors it.
create or replace function order_price(p jsonb) returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  item_sheets int;
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
      item_sheets := sheets;                                               -- a per-sheet item follows the album's sheets unless a sheet quantity is given
      if ci.pricing_method = 'per_sheet' and coalesce(it->>'sheetQty', '') <> '' then
        if (it->>'sheetQty') !~ '^[0-9]{1,5}$' or (it->>'sheetQty')::numeric < 1 then
          errs := errs || jsonb_build_array(jsonb_build_object('path', 'album.' || ai || '.items', 'message', 'Album ' || ai || ': “' || ci.name || '” needs a sheet quantity of 1 or more (whole number)')); continue;
        end if;
        item_sheets := (it->>'sheetQty')::int;
      end if;
      ln := cat_price_line(ci, qty, item_sheets, size, paper, finish, 'item'); pos := pos + 1;
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

revoke execute on function order_price(jsonb) from public, anon;
grant execute on function order_price(jsonb) to authenticated;
