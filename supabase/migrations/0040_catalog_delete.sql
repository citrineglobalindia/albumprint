-- Catalog delete: an item, or a whole category branch (its sub-categories, items and rate rules).
-- Anything already used on an order is kept (order lines reference it) — deactivate it instead. Deletions are audited.

create trigger cat_categories_audit_del after delete on cat_categories for each row execute function audit_admin_row();
create trigger cat_items_audit_del      after delete on cat_items      for each row execute function audit_admin_row();

create or replace function cat_delete_item(p_item uuid) returns void language plpgsql security definer set search_path = public as $$
declare nm text;
begin
  if not is_system() and current_app_role() is distinct from 'admin' then raise exception 'only an administrator can delete catalog items' using errcode = '42501'; end if;
  select name into nm from cat_items where id = p_item;
  if nm is null then raise exception 'item not found' using errcode = 'P0002'; end if;
  if exists (select 1 from order_charge_lines where item_id = p_item) then
    raise exception '“%” is used on existing orders, so it cannot be deleted — switch it off (Inactive) instead', nm using errcode = '23503';
  end if;
  delete from cat_items where id = p_item;                                  -- its rate rules go with it (on delete cascade)
end $$;
revoke execute on function cat_delete_item(uuid) from public, anon;
grant execute on function cat_delete_item(uuid) to authenticated;

-- Returns {"categories": n, "items": n}.
create or replace function cat_delete_category(p_cat uuid) returns jsonb language plpgsql security definer set search_path = public as $$
declare nm text; used int; nc int; ni int;
begin
  if not is_system() and current_app_role() is distinct from 'admin' then raise exception 'only an administrator can delete catalog categories' using errcode = '42501'; end if;
  select name into nm from cat_categories where id = p_cat;
  if nm is null then raise exception 'category not found' using errcode = 'P0002'; end if;
  create temp table if not exists _cat_del(id uuid primary key, depth int) on commit drop;
  delete from _cat_del;
  insert into _cat_del
    with recursive d as (select id, depth from cat_categories where id = p_cat union all select c.id, c.depth from cat_categories c join d on c.parent_id = d.id)
    select id, depth from d;
  select count(distinct l.item_id) into used from order_charge_lines l join cat_items i on i.id = l.item_id where i.category_id in (select id from _cat_del);
  if used > 0 then
    raise exception '“%” holds % item(s) used on existing orders, so it cannot be deleted — switch it off (Inactive) instead', nm, used using errcode = '23503';
  end if;
  delete from cat_items where category_id in (select id from _cat_del);
  get diagnostics ni = row_count;
  delete from cat_categories c using _cat_del d where c.id = d.id and d.depth = 4;
  delete from cat_categories c using _cat_del d where c.id = d.id and d.depth = 3;
  delete from cat_categories c using _cat_del d where c.id = d.id and d.depth = 2;
  delete from cat_categories c using _cat_del d where c.id = d.id and d.depth = 1;
  select count(*) into nc from _cat_del;
  return jsonb_build_object('categories', nc, 'items', ni);
end $$;
revoke execute on function cat_delete_category(uuid) from public, anon;
grant execute on function cat_delete_category(uuid) to authenticated;
