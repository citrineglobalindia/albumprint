-- Items carry their full name on orders and invoices: the categories, then the item — "Paper NT 125 GSM - Glossy".
-- Printing / design charge lines keep their own names. Mirrored in src/lib/orderPricing.ts (itemLabel).
create or replace function cat_item_label(p_item cat_items) returns text language sql stable set search_path = public as $$
  with recursive up as (
    select id, parent_id, name, 1 as lvl from cat_categories where id = p_item.category_id
    union all
    select c.id, c.parent_id, c.name, up.lvl + 1 from cat_categories c join up on c.id = up.parent_id where up.lvl < 6
  )
  select coalesce((select string_agg(name, ' ' order by lvl desc) from up) || ' - ', '') || p_item.name
$$;
revoke execute on function cat_item_label(cat_items) from public, anon, authenticated;

create or replace function cat_price_line(p_item cat_items, p_qty numeric, p_sheets int, p_size text, p_paper text, p_finish text, p_kind text) returns jsonb
language plpgsql stable set search_path = public as $$
declare scope text; qty numeric; rr record; missing boolean;
begin
  scope := case p_item.pricing_method when 'per_sheet' then 'copy' when 'per_unit' then 'copy' when 'fixed_per_album' then 'album' else 'order' end;
  qty := case p_item.pricing_method when 'per_sheet' then p_sheets when 'per_unit' then p_qty else 1 end;
  select * into rr from cat_resolve_rate(p_item.id, p_size, p_paper, p_finish);
  missing := rr.o_rate is null;
  return jsonb_build_object('kind', p_kind, 'itemId', p_item.id, 'name', case when p_kind = 'item' then cat_item_label(p_item) else p_item.name end,
    'unit', p_item.unit, 'method', p_item.pricing_method, 'scope', scope, 'qty', qty,
    'rate', rr.o_rate, 'rule', rr.o_basis, 'missing', missing, 'unitAmount', case when missing then 0 else qty * rr.o_rate end, 'optionKind', p_item.option_kind);
end $$;
revoke execute on function cat_price_line(cat_items, numeric, int, text, text, text, text) from public, anon, authenticated;
