\set ON_ERROR_STOP on
\set QUIET on
-- Catalog bulk tools (0038): import a product hierarchy in one call, save many prices at once. Reuses the t.* harness.
reset role;
create function t.tree(p jsonb) returns int language sql as $$ select cat_import_tree(p) $$;
create function t.prices(p jsonb) returns int language sql as $$ select cat_set_prices(p) $$;
grant execute on function t.tree(jsonb), t.prices(jsonb) to authenticated;

select t.as('admin');
select t.eq($$select t.tree('[{"path":["Bulk Paper","NT","125 GSM"],"item":"ALL LAMINATION","method":"per_sheet","unit":"sheet"},
  {"path":["Bulk Paper","NT","200 GSM"],"item":"ALL LAMINATION","method":"per_sheet","unit":"sheet"},
  {"path":["Bulk Paper","A3 PAPER","SINGLE SIDE","170 GSM"],"item":"ALL LAMINATION","method":"per_sheet","unit":"sheet"},
  {"path":["Bulk Bag"],"item":"JUTE BAG","method":"per_unit","unit":"pcs"}]')::text$$, '4', 'bulk import: four items created');
select t.eq($$with recursive d as (select id, name, depth from cat_categories where name = 'Bulk Paper' and parent_id is null union all select c.id, c.name, c.depth from cat_categories c join d on c.parent_id = d.id)
  select string_agg(name || ':' || depth, ',' order by depth, name) from d$$,
  'Bulk Paper:1,A3 PAPER:2,NT:2,125 GSM:3,200 GSM:3,SINGLE SIDE:3,170 GSM:4', 'bulk import: categories created at the right levels, shared parents reused');
select t.eq($$select count(*)::text from cat_items i where i.name = 'ALL LAMINATION' and i.created_at > now() - interval '1 hour' and i.rate is null and i.pricing_method = 'per_sheet'$$, '3', 'bulk import: new items have no price yet');
select t.eq($$select t.tree('[{"path":["bulk paper","nt","125 gsm"],"item":"all lamination","method":"per_unit","unit":"pcs"}]')::text$$, '0', 'bulk import: running it again adds nothing (case-insensitive match)');
select t.err($$select t.tree('[{"path":["A","B","C","D","E"],"item":"X"}]')$$, 'bulk import: more than 4 category levels refused', 'between 1 and 4');
select t.err($$select t.tree('[{"path":["A"],"item":"  "}]')$$, 'bulk import: an empty item name refused', 'item name');
select t.err($$select t.tree('[{"path":["Bulk Odd"],"item":"X","method":"per_kg"}]')$$, 'bulk import: unknown pricing method refused', 'check');
select t.eq($$select count(*)::text from cat_categories where name = 'Bulk Odd'$$, '0', 'bulk import: a failed import leaves nothing behind');

-- prices
select t.eq($$select t.prices(jsonb_build_array(
  jsonb_build_object('id', (select i.id from cat_items i join cat_categories c on c.id = i.category_id join cat_categories n on n.id = c.parent_id join cat_categories b on b.id = n.parent_id where c.name = '125 GSM' and b.name = 'Bulk Paper'), 'rate', 12.5, 'method', 'per_sheet', 'unit', 'sheet'),
  jsonb_build_object('id', (select id from cat_items where name = 'JUTE BAG'), 'rate', 150, 'method', 'fixed_per_album', 'unit', 'album')))::text$$, '2', 'prices: two saved in one call');
select t.eq($$select rate::text || '/' || pricing_method || '/' || unit from cat_items where name = 'JUTE BAG'$$, '150.00/fixed_per_album/album', 'prices: rate, method and unit stored');
select t.err($$select t.prices(jsonb_build_array(
  jsonb_build_object('id', (select id from cat_items where name = 'JUTE BAG'), 'rate', 99),
  jsonb_build_object('id', (select id from cat_items where name = 'JUTE BAG'), 'rate', -1)))$$, 'prices: a negative rate refused', '0 or more');
select t.eq($$select rate::text from cat_items where name = 'JUTE BAG'$$, '150.00', 'prices: all or nothing (the first row of the failed call was not kept)');
select t.err($$select t.prices(jsonb_build_array(jsonb_build_object('id', (select id from cat_items where name = 'JUTE BAG'), 'rate', 1.005)))$$, 'prices: more than 2 decimals refused', '2 decimals');
select t.err($$select t.prices('[{"id":"00000000-0000-0000-0000-000000000001","rate":1}]')$$, 'prices: unknown item refused', 'not found');
select t.ok($$select t.prices(jsonb_build_array(jsonb_build_object('id', (select id from cat_items where name = 'JUTE BAG'), 'rate', null)))$$, 'prices: a rate can be cleared');
select t.eq($$select coalesce(rate::text, 'null') from cat_items where name = 'JUTE BAG'$$, 'null', 'prices: (cleared)');

select t.as('reception');
select t.err($$select t.tree('[{"path":["Staff"],"item":"X"}]')$$, 'bulk import: only an administrator', 'administrator');
select t.err($$select t.prices(jsonb_build_array(jsonb_build_object('id', (select id from cat_items where name = 'JUTE BAG'), 'rate', 1)))$$, 'prices: only an administrator', 'administrator');
select t.as('system');

-- per-sheet item quantity (0039): follows the album's sheets unless items[].sheetQty is given
select t.as('system');
insert into cat_items(category_id, name, pricing_method, unit, rate) select id, 'Sheet lam', 'per_sheet', 'sheet', 3 from cat_categories where name = 'Bulk Bag';
create function t.sq(extra text) returns jsonb language sql as $$
  select order_price(jsonb_build_object('orderType', 'printing_only', 'albums', jsonb_build_array(jsonb_build_object('id', 'x', 'name', 'A', 'sheets', 30, 'copies', 2, 'size', '', 'paper', '', 'finish', '',
    'items', jsonb_build_array(jsonb_build_object('itemId', (select id from cat_items where name = 'Sheet lam'), 'qty', 1) || coalesce(extra, '{}')::jsonb))), 'orderCharges', '[]'::jsonb, 'discount', jsonb_build_object('type', 'none', 'value', 0))) $$;
select t.eq($$select l->>'qty' || '/' || (l->>'unitAmount')::numeric::text from jsonb_array_elements(t.sq(null)->'albums'->0->'lines') l where l->>'name' = 'Sheet lam'$$, '30/90.00', 'sheet qty: a per-sheet item follows the album sheets (30 × ₹3)');
select t.eq($$select l->>'qty' || '/' || (l->>'unitAmount')::numeric::text || '/' || (l->>'amount')::numeric::text from jsonb_array_elements(t.sq('{"sheetQty": 12}')->'albums'->0->'lines') l where l->>'name' = 'Sheet lam'$$, '12/36.00/72.00', 'sheet qty: an explicit sheet quantity (12 × ₹3, × 2 copies)');
select t.eq($$select l->>'qty' from jsonb_array_elements(t.sq('{"sheetQty": ""}')->'albums'->0->'lines') l where l->>'name' = 'Sheet lam'$$, '30', 'sheet qty: blank means auto');
select t.eq($$select string_agg(e->>'message', '|') from jsonb_array_elements(t.sq('{"sheetQty": "2.5"}')->'errors') e where e->>'message' like '%Sheet lam%'$$, 'Album 1: “Sheet lam” needs a sheet quantity of 1 or more (whole number)', 'sheet qty: a fraction is refused');
select t.eq($$select string_agg(e->>'message', '|') from jsonb_array_elements(t.sq('{"sheetQty": 0}')->'errors') e where e->>'message' like '%Sheet lam%'$$, 'Album 1: “Sheet lam” needs a sheet quantity of 1 or more (whole number)', 'sheet qty: zero is refused');
select t.eq($$select 'ok'$$, 'ok', 'catalog bulk done');
\echo CATALOG BULK TESTS PASSED
