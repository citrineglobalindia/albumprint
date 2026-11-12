-- Manual items: while taking an order, reception or an admin can add an item that is not in the catalog yet (name, how it is charged,
-- unit, rate). It is saved in the catalog under "Manual items" so it can be picked on later orders (the admin can move or edit it later).
-- An item with the same name already in "Manual items" is reused (its rate is updated when a new one is given).
create or replace function add_manual_item(p_name text, p_method text, p_unit text, p_rate numeric) returns uuid
language plpgsql security definer set search_path = public as $$
declare cat uuid; it uuid; nm text := regexp_replace(btrim(coalesce(p_name, '')), '\s+', ' ', 'g');
begin
  if current_app_role() is null or not (current_app_role() = 'admin' or has_perm('order', 'write')) then raise exception 'you cannot add items' using errcode = '42501'; end if;
  if char_length(nm) < 2 then raise exception 'enter the item name' using errcode = '22023'; end if;
  if p_method not in ('per_unit', 'per_sheet', 'fixed_per_album', 'one_time_order') then raise exception 'choose how the item is charged' using errcode = '22023'; end if;
  if p_rate is not null and p_rate < 0 then raise exception 'the rate cannot be negative' using errcode = '22023'; end if;
  select id into cat from cat_categories where parent_id is null and lower(name) = 'manual items' limit 1;
  if cat is null then
    insert into cat_categories(parent_id, name, depth, sort_order) values (null, 'Manual items', 1, 9999) returning id into cat;
  end if;
  select id into it from cat_items where category_id = cat and lower(name) = lower(nm) limit 1;
  if it is null then
    insert into cat_items(category_id, name, pricing_method, rate, unit, sort_order)
      values (cat, nm, p_method, round(p_rate, 2), coalesce(nullif(btrim(coalesce(p_unit, '')), ''), case when p_method = 'per_sheet' then 'sheet' else 'pcs' end),
              coalesce((select max(sort_order) + 1 from cat_items where category_id = cat), 0)) returning id into it;
  else
    update cat_items set active = true, pricing_method = p_method, rate = coalesce(round(p_rate, 2), rate), unit = coalesce(nullif(btrim(coalesce(p_unit, '')), ''), unit) where id = it;
  end if;
  return it;
end $$;
revoke execute on function add_manual_item(text, text, text, numeric) from public, anon;
grant execute on function add_manual_item(text, text, text, numeric) to authenticated;
