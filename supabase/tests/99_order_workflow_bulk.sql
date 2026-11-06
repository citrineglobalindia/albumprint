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

-- delete (0040)
select t.as('admin');
select t.err($$select cat_delete_item(t.id('i_leather'))$$, 'delete: an item used on an order is kept', 'used on existing orders');
select t.err($$select cat_delete_category(t.id('covers'))$$, 'delete: a category holding an item used on an order is kept', 'used on existing orders');
select t.eq($$select count(*)::text from cat_items where id = t.id('i_leather')$$, '1', 'delete: (still there)');
select t.ok($$select cat_delete_item((select id from cat_items where name = 'Sheet lam'))$$, 'delete: an unused item');
select t.eq($$select count(*)::text from cat_items where name = 'Sheet lam'$$, '0', 'delete: (gone)');
select t.eq($$select cat_delete_category((select id from cat_categories where name = 'Bulk Paper'))::text$$, '{"items": 3, "categories": 7}', 'delete: a whole branch (sub-categories and items)');
select t.eq($$select count(*)::text from cat_categories where name in ('Bulk Paper', '170 GSM', 'SINGLE SIDE', 'A3 PAPER')$$, '0', 'delete: (branch gone)');
select t.as('system');
select t.eq($$select count(*)::text from audit_log where entity in ('cat_items', 'cat_categories') and action = 'delete'$$, '11', 'delete: every deleted row is audited');
select t.as('reception');
select t.err($$select cat_delete_item((select id from cat_items where name = 'JUTE BAG'))$$, 'delete: only an administrator (item)', 'administrator');
select t.err($$select cat_delete_category((select id from cat_categories where name = 'Bulk Bag'))$$, 'delete: only an administrator (category)', 'administrator');
select t.as('system');

-- design charge typed on the order (0041)
create function t.dz(design jsonb, otype text default 'design_printing') returns jsonb language sql as $$
  select order_price(jsonb_build_object('orderType', otype, 'albums', jsonb_build_array(jsonb_build_object('id', 'x', 'name', 'A', 'sheets', 30, 'copies', 2, 'size', '', 'paper', '', 'finish', '', 'items', '[]'::jsonb, 'design', design)),
    'orderCharges', '[]'::jsonb, 'discount', jsonb_build_object('type', 'none', 'value', 0))) $$;
select t.eq($$select l->>'qty' || '/' || (l->>'rate')::numeric::text || '/' || (l->>'amount')::numeric::text || '/' || (l->>'scope') from jsonb_array_elements(t.dz('{"mode":"per_sheet","amount":"50"}')->'albums'->0->'lines') l where l->>'kind' = 'design'$$,
  '30/50/1500/album', 'design charge: per sheet = rate × sheets, once per album (not × 2 copies)');
select t.eq($$select (t.dz('{"mode":"per_sheet","amount":"50"}')->'albums'->0->>'perAlbum')::numeric::text$$, '1500', 'design charge: counted in the per-album charges');
select t.eq($$select l->>'qty' || '/' || (l->>'amount')::numeric::text from jsonb_array_elements(t.dz('{"mode":"fixed","amount":"4999.50"}')->'albums'->0->'lines') l where l->>'kind' = 'design'$$, '1/4999.50', 'design charge: a fixed amount');
select t.eq($$select string_agg(e->>'message', '|') from jsonb_array_elements(t.dz('{"mode":"fixed","amount":""}')->'errors') e where e->>'path' = 'album.1.design'$$, 'Album 1: enter the design charge (0 or more, up to 2 decimals)', 'design charge: required');
select t.eq($$select string_agg(e->>'message', '|') from jsonb_array_elements(t.dz('{"mode":"fixed","amount":"-5"}')->'errors') e where e->>'path' = 'album.1.design'$$, 'Album 1: enter the design charge (0 or more, up to 2 decimals)', 'design charge: no negatives');
select t.eq($$select string_agg(e->>'message', '|') from jsonb_array_elements(t.dz('{"mode":"weird","amount":"5"}')->'errors') e where e->>'path' = 'album.1.design'$$, 'Album 1: choose how design is charged', 'design charge: unknown mode refused');
select t.eq($$select count(*)::text from jsonb_array_elements(t.dz('{"mode":"fixed","amount":"500"}', 'printing_only')->'albums'->0->'lines') l where l->>'kind' = 'design'$$, '0', 'design charge: ignored for Album Printing Only');
select t.eq($$select count(*)::text from jsonb_array_elements(t.dz('{"mode":"card","amount":""}')->'albums'->0->'lines') l where l->>'kind' = 'design' and l->>'itemId' is not null$$, '1', 'design charge: "card" keeps the design rate card');
select t.as('reception');
insert into order_drafts(payload) select jsonb_set(t.payload(), '{albums,0,design}', '{"mode":"fixed","amount":"2500"}') || jsonb_build_object('customerId', t.id('cust'), 'event', jsonb_build_object('type', 'Wedding', 'name', 'Typed design', 'date', to_char(current_date + 30, 'YYYY-MM-DD')));
insert into t.p36 select 'draft_dz', id::text from order_drafts where payload->'event'->>'name' = 'Typed design';
select t.ok($$select finalize_order_v2(t.id('draft_dz'))$$, 'design charge: an order with a typed design charge finalizes');
select t.as('system');
select t.eq($$select l.qty::int || '/' || l.amount::text || '/' || coalesce(l.item_id::text, 'no item') || '/' || l.scope from order_charge_lines l join orders o on o.id = l.order_id
  where l.kind = 'design' and l.album_position = 1 and o.id = ((select result from order_drafts where id = t.id('draft_dz'))->>'orderId')::uuid$$, '1/2500.00/no item/album', 'design charge: stored on the order once for the album');
select t.eq($$select count(*)::text from invoice_lines il join invoices i on i.id = il.invoice_id where i.order_id = ((select result from order_drafts where id = t.id('draft_dz'))->>'orderId')::uuid and il.description like 'Album design%' and il.rate = 2500$$, '1', 'design charge: on the invoice');
select t.as('reception');
insert into order_drafts(payload) select t.payload() || jsonb_build_object('customerId', t.id('cust'), 'event', jsonb_build_object('name', 'No type given', 'date', to_char(current_date + 30, 'YYYY-MM-DD')));
insert into t.p36 select 'draft_nt', id::text from order_drafts where payload->'event'->>'name' = 'No type given';
select t.ok($$select finalize_order_v2(t.id('draft_nt'))$$, 'event type: not required to finalize (0042)');
select t.as('system');
select t.eq($$select coalesce(event_type, 'null') || '/' || event_name from orders where id = ((select result from order_drafts where id = t.id('draft_nt'))->>'orderId')::uuid$$, 'null/No type given', 'event type: stored empty, the event name is kept');

-- line price and line discount (0043)
create function t.lp(item jsonb) returns jsonb language sql as $$ select order_price(jsonb_set(t.payload(), '{albums,0,items,0}', (t.payload()->'albums'->0->'items'->0) || item)) $$;
create function t.leather(pr jsonb) returns jsonb language sql as $$ select l from jsonb_array_elements(pr->'albums'->0->'lines') l where l->>'itemId' = (select v from t.p36 where k = 'i_leather') $$;
select t.eq($$select concat_ws('/', t.leather(t.lp('{"price":"450"}'))->>'rate', t.leather(t.lp('{"price":"450"}'))->>'listRate', t.leather(t.lp('{"price":"450"}'))->>'unitAmount')$$, '450/500.00/450', 'line price: a typed price replaces the catalog rate');
select t.eq($$select concat_ws('/', t.leather(t.lp('{"disc":{"type":"percent","value":"10"}}'))->>'gross', t.leather(t.lp('{"disc":{"type":"percent","value":"10"}}'))->>'discount', t.leather(t.lp('{"disc":{"type":"percent","value":"10"}}'))->>'unitAmount')$$, '500.00/50.00/450.00', 'line discount: 10% off the line');
select t.eq($$select (t.lp('{"disc":{"type":"fixed","value":"100"}}')->'albums'->0->>'total')::numeric::text$$, '3260.00', 'line discount: ₹100 per copy × 2 copies off the album (3460 → 3260)');
select t.eq($$select concat_ws('/', p->>'lineDiscounts', p->>'listSubtotal', p->>'subtotal') from (select t.lp('{"disc":{"type":"fixed","value":"100"}}') p) x$$, '200/3940.00/3740.00', 'line discount: totals at catalog prices and after line discounts');
select t.eq($$select string_agg(e->>'message', '|') from jsonb_array_elements(t.lp('{"disc":{"type":"fixed","value":"501"}}')->'errors') e$$, 'Album 1: the discount on “Leatherette cover” is more than the line', 'line discount: not more than the line');
select t.eq($$select string_agg(e->>'message', '|') from jsonb_array_elements(t.lp('{"disc":{"type":"percent","value":"101"}}')->'errors') e$$, 'Album 1: the discount on “Leatherette cover” cannot be more than 100%', 'line discount: not more than 100%');
select t.eq($$select string_agg(e->>'message', '|') from jsonb_array_elements(t.lp('{"price":"-5"}')->'errors') e$$, 'Album 1: enter a valid price for “Leatherette cover” (0 or more, up to 2 decimals)', 'line price: must be valid');
select t.eq($$select (t.lp('{"price":"700"}')->>'reduction')::numeric::text$$, '434.00', 'reduction: a higher price is not a reduction (only the 10% order discount)');
select t.eq($$select (t.lp('{"price":"100"}')->>'reduction')::numeric::text$$, '1114.00', 'reduction: a lowered price counts (2 × 400) plus the 10% order discount on the new subtotal (314)');
-- an unpriced item can be priced on the line
select t.as('system');
insert into cat_items(category_id, name, pricing_method, unit) values (t.id('covers'), 'Unpriced cover', 'per_unit', 'pcs');
select t.eq($$select concat_ws('/', l->>'missing', l->>'unitAmount') from jsonb_array_elements(order_price(jsonb_set(t.payload(), '{albums,0,items}', ('[{"itemId":"' || (select id from cat_items where name = 'Unpriced cover') || '","qty":2,"price":"300"}]')::jsonb))->'albums'->0->'lines') l where l->>'name' = 'Unpriced cover'$$, 'false/600', 'line price: an item with no catalog price can be priced on the order');
-- finalize: line discounts go into the invoice discount; a large line discount needs an admin
select t.as('reception');
insert into order_drafts(payload) select jsonb_set(jsonb_set(t.payload(), '{albums,0,items,0}', (t.payload()->'albums'->0->'items'->0) || '{"disc":{"type":"fixed","value":"100"}}'), '{discount}', '{"type":"none","value":""}') || jsonb_build_object('customerId', t.id('cust'), 'event', jsonb_build_object('name', 'Line discount', 'date', to_char(current_date + 30, 'YYYY-MM-DD')));
insert into t.p36 select 'draft_ld', id::text from order_drafts where payload->'event'->>'name' = 'Line discount';
select t.eq($$select (finalize_order_v2(t.id('draft_ld')))->>'total'$$, '3740.00', 'finalize: a small line discount (5%) — reception can finalize; server total');
select t.as('system');
select t.eq($$select concat_ws('/', i.subtotal::text, i.discount_amount::text, i.total::text) from invoices i where i.order_id = ((select result from order_drafts where id = t.id('draft_ld'))->>'orderId')::uuid$$, '3940.00/200.00/3740.00', 'finalize: invoice lines at full price, the line discount in the invoice discount');
select t.eq($$select count(*)::text from invoice_lines il join invoices i on i.id = il.invoice_id where i.order_id = ((select result from order_drafts where id = t.id('draft_ld'))->>'orderId')::uuid and il.note like '%less discount ₹200%'$$, '1', 'finalize: the invoice line says how much was discounted');
select t.as('reception');
insert into order_drafts(payload) select jsonb_set(jsonb_set(t.payload(), '{albums,0,items,0}', (t.payload()->'albums'->0->'items'->0) || '{"price":"0"}'), '{discount}', '{"type":"percent","value":"5"}') || jsonb_build_object('customerId', t.id('cust'), 'event', jsonb_build_object('name', 'Big cut', 'date', to_char(current_date + 30, 'YYYY-MM-DD')));
insert into t.p36 select 'draft_bc', id::text from order_drafts where payload->'event'->>'name' = 'Big cut';
select t.err($$select finalize_order_v2(t.id('draft_bc'))$$, 'finalize: a price cut + order discount over the limit needs an admin', 'needs an admin');
select t.as('system');

-- printing charge setting (0044)
select t.as('system');
select t.eq($$select printing_mode from pricing_settings$$, 'separate', 'printing mode: separate by default (as before)');
select t.eq($$select count(*)::text from jsonb_array_elements(t.price(t.payload())->'albums'->0->'lines') l where l->>'kind' = 'printing'$$, '1', 'printing mode: separate — a printing line on the album');
update pricing_settings set printing_mode = 'included';
select t.eq($$select count(*)::text from jsonb_array_elements(t.price(t.payload())->'albums'->0->'lines') l where l->>'kind' = 'printing'$$, '0', 'printing mode: included — no printing line');
select t.eq($$select (t.price(t.payload())->'albums'->0->>'perCopy')::numeric::text$$, '870.00', 'printing mode: included — the album is priced from its items (1230 − printing 30 × 12)');
update cat_items set active = false where option_kind = 'printing';
select t.eq($$select count(*)::text from jsonb_array_elements(t.price(t.payload())->'errors') e where e->>'path' = 'catalog.printing'$$, '0', 'printing mode: included — no printing rate card needed');
update cat_items set active = true where option_kind = 'printing';
update pricing_settings set printing_mode = 'separate';
select t.err($$update pricing_settings set printing_mode = 'sometimes'$$, 'printing mode: only included or separate', 'check');
select t.as('reception');
do $$ begin begin update pricing_settings set printing_mode = 'included'; exception when others then null; end; end $$;
select t.as('system');
select t.eq($$select printing_mode from pricing_settings$$, 'separate', 'printing mode: a non-admin cannot change it');
select t.eq($$select 'ok'$$, 'ok', 'catalog bulk done');
\echo CATALOG BULK TESTS PASSED
