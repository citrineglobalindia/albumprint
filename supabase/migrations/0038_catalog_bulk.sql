-- Catalog bulk tools: import a whole product hierarchy in one transaction, and save many prices at once.

-- p = [{ "path": ["Paper", "NT", "125 GSM"], "item": "ALL LAMINATION", "method": "per_sheet", "unit": "sheet" }, …]
-- Categories and items that already exist (same name under the same parent, any case) are kept untouched, prices included.
-- New items get no rate, so the order builder shows "Price not configured" until a price is entered.
create or replace function cat_import_tree(p jsonb) returns int language plpgsql security definer set search_path = public as $$
declare e jsonb; ord bigint; k int; nm text; parent uuid; cid uuid; added int := 0; got int; item_name text; meth text; un text; nparts int;
begin
  if not is_system() and current_app_role() is distinct from 'admin' then raise exception 'only an administrator can import the catalog' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'expected a list of entries' using errcode = '22023'; end if;
  if jsonb_array_length(p) > 2000 then raise exception 'too many entries (2000 max per import)' using errcode = '22023'; end if;
  for e, ord in select value, ordinality from jsonb_array_elements(p) with ordinality loop
    nparts := coalesce(jsonb_array_length(e->'path'), 0);
    if nparts < 1 or nparts > 4 then raise exception 'entry %: between 1 and 4 category levels are needed', ord using errcode = '22023'; end if;
    item_name := regexp_replace(btrim(coalesce(e->>'item', '')), '\s+', ' ', 'g');
    if item_name = '' then raise exception 'entry %: the item name is missing', ord using errcode = '22023'; end if;
    meth := coalesce(nullif(e->>'method', ''), 'per_unit');
    un := coalesce(nullif(btrim(e->>'unit'), ''), 'pcs');
    parent := null;
    for k in 0..nparts - 1 loop
      nm := regexp_replace(btrim(coalesce(e->'path'->>k, '')), '\s+', ' ', 'g');
      if nm = '' then raise exception 'entry %: an empty category name', ord using errcode = '22023'; end if;
      cid := null;
      select id into cid from cat_categories
        where coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(parent, '00000000-0000-0000-0000-000000000000'::uuid) and lower(btrim(name)) = lower(nm);
      if cid is null then
        insert into cat_categories(parent_id, name, sort_order)
          values (parent, nm, (select count(*) + 1 from cat_categories where parent_id is not distinct from parent)) returning id into cid;
      end if;
      parent := cid;
    end loop;
    insert into cat_items(category_id, name, pricing_method, rate, unit, sort_order)
      values (parent, item_name, meth, null, un, (select count(*) + 1 from cat_items where category_id = parent))
      on conflict do nothing;
    get diagnostics got = row_count; added := added + got;
  end loop;
  return added;
end $$;
revoke execute on function cat_import_tree(jsonb) from public, anon;
grant execute on function cat_import_tree(jsonb) to authenticated;

-- p = [{ "id": "<item uuid>", "rate": 12.5 | null, "method": "per_sheet", "unit": "sheet" }, …] — all or nothing.
create or replace function cat_set_prices(p jsonb) returns int language plpgsql security definer set search_path = public as $$
declare e jsonb; ord bigint; n int := 0; r numeric; got int;
begin
  if not is_system() and current_app_role() is distinct from 'admin' then raise exception 'only an administrator can change prices' using errcode = '42501'; end if;
  if jsonb_typeof(p) is distinct from 'array' then raise exception 'expected a list of prices' using errcode = '22023'; end if;
  for e, ord in select value, ordinality from jsonb_array_elements(p) with ordinality loop
    r := case when e->'rate' is null or jsonb_typeof(e->'rate') = 'null' then null else (e->>'rate')::numeric end;
    if r is not null and (r < 0 or r <> round(r, 2)) then raise exception 'row %: the rate must be 0 or more with at most 2 decimals', ord using errcode = '22023'; end if;
    update cat_items set rate = r,
      pricing_method = coalesce(nullif(e->>'method', ''), pricing_method),
      unit = coalesce(nullif(btrim(e->>'unit'), ''), unit),
      updated_at = now()
      where id = (e->>'id')::uuid;
    get diagnostics got = row_count;
    if got = 0 then raise exception 'row %: item not found', ord using errcode = 'P0002'; end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke execute on function cat_set_prices(jsonb) from public, anon;
grant execute on function cat_set_prices(jsonb) to authenticated;
