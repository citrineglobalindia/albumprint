\set ON_ERROR_STOP on
\set QUIET on
-- Order workflow v2 (0036): catalog hierarchy, rate rules, the pricing engine, drafts, finalize (idempotent), snapshots, reopen. Reuses the t.* harness.
reset role;
create table t.p36(k text primary key, v text);
grant select, insert, update on t.p36 to authenticated;
create function t.id(k text) returns uuid language sql as $$ select v::uuid from t.p36 where p36.k = $1 $$;
create function t.price(payload jsonb) returns jsonb language sql as $$ select order_price(payload) $$;
grant execute on function t.id(text), t.price(jsonb) to authenticated;
select t.as('system');
update profiles set active = true where id in (select id from t.users);
delete from notifications;

-- ───── catalog fixtures: Category → Sub → Level 3 → Level 4 → Items ─────
insert into cat_categories(name) values ('Printing'), ('Design'), ('Covers'), ('Extras'), ('Charges');
insert into cat_categories(parent_id, name) select id, 'Boxes' from cat_categories where name = 'Extras' and parent_id is null;
insert into cat_categories(parent_id, name) select id, 'Premium' from cat_categories where name = 'Boxes';
insert into cat_categories(parent_id, name) select id, 'Wooden' from cat_categories where name = 'Premium';
insert into t.p36 select 'printing', id::text from cat_categories where name = 'Printing';
insert into t.p36 select 'design', id::text from cat_categories where name = 'Design';
insert into t.p36 select 'covers', id::text from cat_categories where name = 'Covers';
insert into t.p36 select 'extras', id::text from cat_categories where name = 'Extras';
insert into t.p36 select 'charges', id::text from cat_categories where name = 'Charges';
insert into t.p36 select 'boxes', id::text from cat_categories where name = 'Boxes';
insert into t.p36 select 'wooden', id::text from cat_categories where name = 'Wooden';
select t.eq($$select string_agg(name || ':' || depth, ',' order by depth, name) from cat_categories where name in ('Extras', 'Boxes', 'Premium', 'Wooden')$$, 'Extras:1,Boxes:2,Premium:3,Wooden:4', 'catalog: four levels, the depth is worked out from the parent');
select t.err($$insert into cat_categories(parent_id, name) values (t.id('wooden'), 'Too deep')$$, 'catalog: a fifth level is refused', 'at most 4');
select t.err($$insert into cat_categories(name) values ('  printing ')$$, 'catalog: a duplicate top-level name is refused (case and spaces ignored)', 'duplicate|unique');
select t.err($$insert into cat_categories(parent_id, name) values (t.id('extras'), 'BOXES')$$, 'catalog: a duplicate name under the same parent is refused', 'duplicate|unique');
select t.ok($$insert into cat_categories(parent_id, name) values (t.id('covers'), 'Boxes')$$, 'catalog: the same name under a different parent is fine');
select t.err($$update cat_categories set parent_id = id where id = t.id('extras')$$, 'catalog: a category cannot be its own parent', 'own parent');
select t.err($$update cat_categories set parent_id = t.id('wooden') where id = t.id('extras')$$, 'catalog: no circular parent (moving under its own descendant)', 'own sub-categories');
select t.err($$update cat_categories set parent_id = t.id('wooden') where id = t.id('covers')$$, 'catalog: a move that would push the sub-tree past 4 levels is refused', 'at most 4');
select t.eq($$select count(*)::text from cat_categories where parent_id = t.id('covers')$$, '1', 'catalog: (that move changed nothing)');
select t.ok($$update cat_categories set parent_id = t.id('printing') where id = (select id from cat_categories where parent_id = t.id('covers'))$$, 'catalog: a valid move under another parent');
select t.eq($$select depth::text from cat_categories where parent_id = t.id('printing')$$, '2', 'catalog: and the depth follows');

-- items: any level; pricing method, rate, unit, kind
insert into cat_items(category_id, name, code, pricing_method, unit, option_kind) select t.id('printing'), 'Album printing', 'PRN', 'per_sheet', 'sheet', 'printing';
insert into cat_items(category_id, name, code, pricing_method, unit, option_kind, rate) select t.id('design'), 'Album design', 'DSN', 'per_sheet', 'sheet', 'design', 4;
insert into cat_items(category_id, name, pricing_method, unit, option_kind, rate) select t.id('covers'), 'Leatherette cover', 'per_unit', 'pcs', 'cover', 500;
insert into cat_items(category_id, name, pricing_method, unit, option_kind, rate) select t.id('covers'), 'Fabric cover', 'per_unit', 'pcs', 'cover', 300;
insert into cat_items(category_id, name, pricing_method, unit, option_kind, rate) select t.id('wooden'), 'Wooden gift box', 'per_unit', 'pcs', 'box', 250;      -- an item at level 4
insert into cat_items(category_id, name, pricing_method, unit, rate) select t.id('extras'), 'Foiling', 'fixed_per_album', 'album', 1000;                           -- an item at level 1
insert into cat_items(category_id, name, pricing_method, unit, rate) select t.id('extras'), 'Mini book', 'per_unit', 'pcs', 150;
insert into cat_items(category_id, name, pricing_method, unit, rate) select t.id('charges'), 'Courier packing', 'one_time_order', 'order', 200;
insert into cat_items(category_id, name, pricing_method, unit, rate, active) select t.id('extras'), 'Retired extra', 'per_unit', 'pcs', 99, false;
insert into cat_items(category_id, name, pricing_method, unit) select t.id('extras'), 'Unpriced extra', 'per_unit', 'pcs';
insert into t.p36 select 'i_' || code, id::text from cat_items where code in ('PRN', 'DSN');
insert into t.p36 select 'i_leather', id::text from cat_items where name = 'Leatherette cover';
insert into t.p36 select 'i_fabric', id::text from cat_items where name = 'Fabric cover';
insert into t.p36 select 'i_box', id::text from cat_items where name = 'Wooden gift box';
insert into t.p36 select 'i_foil', id::text from cat_items where name = 'Foiling';
insert into t.p36 select 'i_mini', id::text from cat_items where name = 'Mini book';
insert into t.p36 select 'i_courier', id::text from cat_items where name = 'Courier packing';
insert into t.p36 select 'i_retired', id::text from cat_items where name = 'Retired extra';
insert into t.p36 select 'i_unpriced', id::text from cat_items where name = 'Unpriced extra';
select t.err($$insert into cat_items(category_id, name, pricing_method, option_kind, rate) select t.id('printing'), 'Second printing', 'per_sheet', 'printing', 5$$, 'catalog: only one active printing rate card', 'duplicate|unique');
select t.err($$insert into cat_items(category_id, name, pricing_method, option_kind, rate) select t.id('printing'), 'Printing per unit', 'per_unit', 'printing', 5$$, 'catalog: printing must be priced per sheet', 'check');
select t.err($$insert into cat_items(category_id, name, pricing_method, rate) select t.id('extras'), 'Bad rate', 'per_unit', -1$$, 'catalog: a negative rate is refused', 'check');
select t.err($$insert into cat_items(category_id, name, pricing_method, rate) select t.id('extras'), 'FOILING', 'per_unit', 1$$, 'catalog: a duplicate item name in the same category is refused', 'duplicate|unique');
select t.err($$insert into cat_items(category_id, name, code, pricing_method, rate) select t.id('covers'), 'Another', 'prn', 'per_unit', 1$$, 'catalog: item codes are unique', 'duplicate|unique');
select t.err($$insert into cat_items(category_id, name, pricing_method) select t.id('covers'), 'Odd', 'monthly'$$, 'catalog: unknown pricing method refused', 'check');

-- rate rules by size / paper / finish
insert into cat_rates(item_id, size, rate) values (t.id('i_PRN'), '12x36', 10);
insert into cat_rates(item_id, size, paper, rate) values (t.id('i_PRN'), '12x36', 'Matte', 12);
insert into cat_rates(item_id, paper, rate) values (t.id('i_PRN'), 'Silk', 11);
insert into cat_rates(item_id, size, paper, finish, rate) values (t.id('i_PRN'), '12x36', 'Matte', 'Gloss', 13);
select t.err($$insert into cat_rates(item_id, size, paper, rate) values (t.id('i_PRN'), '12X36', 'matte', 99)$$, 'rates: the same combination twice is refused (case ignored)', 'duplicate|unique');
select t.err($$insert into cat_rates(item_id, rate) values (t.id('i_PRN'), 9)$$, 'rates: a rule needs at least one requirement', 'check');
select t.err($$insert into cat_rates(item_id, size, rate) values (t.id('i_PRN'), '8x8', -2)$$, 'rates: a negative rate is refused', 'check');
select t.eq($$select o_rate::text || ' | ' || o_basis from cat_resolve_rate(t.id('i_PRN'), '12x36', 'Matte', 'Gloss')$$, '13.00 | size 12x36 · paper Matte · finish Gloss', 'rates: the most specific rule wins (3 requirements)');
select t.eq($$select o_rate::text from cat_resolve_rate(t.id('i_PRN'), '12x36', 'Matte', 'Satin')$$, '12.00', 'rates: size + paper rule when the finish does not match');
select t.eq($$select o_rate::text from cat_resolve_rate(t.id('i_PRN'), '12x36', 'Glossy', null)$$, '10.00', 'rates: size-only rule');
select t.eq($$select o_rate::text from cat_resolve_rate(t.id('i_PRN'), '8x8', 'Silk', null)$$, '11.00', 'rates: paper-only rule');
select t.eq($$select coalesce(o_rate::text, 'none') from cat_resolve_rate(t.id('i_PRN'), '8x8', 'Glossy', null)$$, 'none', 'rates: no rule and no standard rate = not configured');
select t.eq($$select o_rate::text from cat_resolve_rate(t.id('i_leather'), '8x8', null, null)$$, '500.00', 'rates: the standard rate is the fallback');

-- ───── the engine ─────
-- album 1: 30 sheets × 2 copies, 12x36 Matte; album 2: 20 sheets × 1 copy, 12x36 Glossy; one order charge
insert into t.p36 values ('payload', $j${
  "orderType": "design_printing",
  "albums": [
    {"id": "a1", "name": "Wedding album", "sheets": 30, "copies": 2, "size": "12x36", "paper": "Matte", "finish": "", "orientation": "Landscape",
     "items": [{"itemId": "%LEATHER%", "qty": 1}, {"itemId": "%BOX%", "qty": 1}, {"itemId": "%FOIL%", "qty": 1}]},
    {"id": "a2", "name": "Engagement album", "sheets": 20, "copies": 1, "size": "12x36", "paper": "Glossy", "items": []}
  ],
  "orderCharges": [{"itemId": "%COURIER%"}],
  "discount": {"type": "percent", "value": 10}
}$j$);
update t.p36 set v = replace(replace(replace(replace(v, '%LEATHER%', (select v from t.p36 where k = 'i_leather')), '%BOX%', (select v from t.p36 where k = 'i_box')), '%FOIL%', (select v from t.p36 where k = 'i_foil')), '%COURIER%', (select v from t.p36 where k = 'i_courier')) where k = 'payload';
create function t.payload() returns jsonb language sql as $$ select v::jsonb from t.p36 where k = 'payload' $$;
grant execute on function t.payload() to authenticated;
select t.eq($$select (t.price(t.payload())->'albums'->0->>'perCopy')$$, '1230.00', 'price: per-copy = printing 30×12 + design 30×4 + cover 500 + box 250');
select t.eq($$select (t.price(t.payload())->'albums'->0->>'perAlbum')$$, '1000.00', 'price: the fixed per-album charge is counted once per album');
select t.eq($$select (t.price(t.payload())->'albums'->0->>'total')$$, '3460.00', 'price: album total = per-copy × copies + per-album charges');
select t.eq($$select (t.price(t.payload())->'albums'->1->>'total')$$, '280.00', 'price: the second album is independent (printing 20×10 + design 20×4)');
select t.eq($$select (t.price(t.payload())->>'subtotal')$$, '3940.00', 'price: order subtotal = albums + one-time charges (200)');
select t.eq($$select (t.price(t.payload())->>'discountAmount')$$, '394.00', 'price: 10% discount');
select t.eq($$select (t.price(t.payload())->>'total')$$, '3546.00', 'price: final amount with tax disabled (no tax assumed)');
select t.eq($$select (t.price(t.payload())->>'canFinalize')$$, 'true', 'price: a complete order can be finalized');
select t.eq($$select jsonb_array_length(t.price(t.payload())->'orderLines')::text$$, '1', 'price: the one-time charge is an order-level line');
select t.eq($$select string_agg(l->>'scope', ',' order by (l->>'position')::int) from jsonb_array_elements(t.price(t.payload())->'albums'->0->'lines') l$$, 'copy,copy,copy,copy,album', 'price: scopes are explicit (per copy ×4, per album ×1)');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{orderType}', '"printing_only"'))->'albums'->0->>'perCopy')$$, '1110.00', 'price: Printing Only has no design charge (1230 − 120)');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{discount}', '{"type":"fixed","value":500}'))->>'total')$$, '3440.00', 'price: a fixed discount');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{discount}', '{"type":"fixed","value":5000}'))->'errors'->0->>'message')$$, 'The discount cannot be more than the order subtotal', 'price: a fixed discount above the subtotal is refused');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{discount}', '{"type":"percent","value":101}'))->>'canFinalize')$$, 'false', 'price: a percentage above 100 is refused');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{discount}', '{"type":"fixed","value":-5}'))->>'canFinalize')$$, 'false', 'price: a negative discount is refused');
select t.eq($$select (t.price(jsonb_set(jsonb_set(t.payload(), '{albums,0,copies}', '3'), '{albums,0,sheets}', '40'))->'albums'->0->>'total')$$, '5170.00', 'price: sheets and copies change the total (40×12+40×4+750 = 1390 × 3 + 1000)');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,items,1,qty}', '2'))->'albums'->0->>'perCopy')$$, '1480.00', 'price: a quantity of 2 on the box adds 250 per copy');
-- requirement combinations pick different rates
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,finish}', '"Gloss"'))->'albums'->0->'lines'->0->>'rate')$$, '13.00', 'price: size + paper + finish picks the 13.00 rule');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,1,paper}', '"Silk"'))->'albums'->1->'lines'->0->>'rate')$$, '10.00', 'price: size beats paper when both match once (size 12x36 and paper Silk)');
-- tax is optional and configurable
update pricing_settings set tax_enabled = true, tax_label = 'GST', tax_rate = 5;
select t.eq($$select (t.price(t.payload())->>'tax') || ' | ' || (t.price(t.payload())->>'total')$$, '177.30 | 3723.30', 'tax: (subtotal − discount) × rate, rounded to 2 decimals');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{applyTax}', 'false'))->>'total')$$, '3546.00', 'tax: can be switched off for an order');
update pricing_settings set tax_enabled = false, tax_label = 'Tax', tax_rate = 0;
-- missing prices and invalid input never become "free"
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,1,size}', '"8x8"'))->>'canFinalize') || ' | ' || (t.price(jsonb_set(t.payload(), '{albums,1,size}', '"8x8"'))->>'hasMissingPrice')$$, 'false | true', 'missing: no printing rate for the combination blocks finalizing');
select t.ok($$select 1 where (t.price(jsonb_set(t.payload(), '{albums,1,size}', '"8x8"'))->'errors'->0->>'message') like '%printing price not configured%'$$, 'missing: and says so');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,items}', jsonb_build_array(jsonb_build_object('itemId', t.id('i_unpriced'), 'qty', 1))))->>'canFinalize')$$, 'false', 'missing: an item without any rate blocks finalizing');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,sheets}', '0'))->>'canFinalize')$$, 'false', 'validate: zero sheets refused');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,sheets}', '12.5'))->>'canFinalize')$$, 'false', 'validate: fractional sheets refused');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,copies}', '0'))->>'canFinalize')$$, 'false', 'validate: zero copies refused');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,name}', '""'))->>'canFinalize')$$, 'false', 'validate: an album needs a name');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,items,1,qty}', '0'))->>'canFinalize')$$, 'false', 'validate: a per-unit quantity of 0 is refused');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,items,1,qty}', '1.5'))->>'canFinalize')$$, 'false', 'validate: a fractional quantity is refused');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,items}', (t.payload()->'albums'->0->'items') || jsonb_build_array(jsonb_build_object('itemId', t.id('i_fabric'), 'qty', 1))))->>'canFinalize')$$, 'false', 'validate: two covers on one album are refused');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,items}', (t.payload()->'albums'->0->'items') || jsonb_build_array(jsonb_build_object('itemId', t.id('i_box'), 'qty', 1))))->>'canFinalize')$$, 'false', 'validate: the same item twice is refused (no double charging)');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,items}', jsonb_build_array(jsonb_build_object('itemId', t.id('i_courier'), 'qty', 1))))->>'canFinalize')$$, 'false', 'validate: an order-level charge cannot sit on an album');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums,0,items}', jsonb_build_array(jsonb_build_object('itemId', t.id('i_retired'), 'qty', 1))))->>'canFinalize')$$, 'false', 'validate: an inactive item cannot be used');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{orderCharges}', jsonb_build_array(jsonb_build_object('itemId', t.id('i_mini')))))->>'canFinalize')$$, 'false', 'validate: only one-time charges can be order charges');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{albums}', '[]'))->>'canFinalize')$$, 'false', 'validate: at least one album');
select t.eq($$select (t.price(jsonb_set(t.payload(), '{orderType}', '"x"'))->>'canFinalize')$$, 'false', 'validate: the order type is required');

-- ───── drafts, finalize, snapshots ─────
update settings set value = jsonb_build_object('name', 'Test Studio Pvt Ltd', 'address', '12 MG Road', 'phone', '9000000000', 'gstin', '29ABCDE1234F1Z5') where key = 'company';
insert into settings(key, value) select 'company', jsonb_build_object('name', 'Test Studio Pvt Ltd', 'address', '12 MG Road', 'phone', '9000000000', 'gstin', '29ABCDE1234F1Z5') where not exists (select 1 from settings where key = 'company');
insert into customers(studio_name, mobile) values ('Pricing Customer', '9000000036');
insert into t.p36 select 'cust', id::text from customers where studio_name = 'Pricing Customer';
select t.as('reception');
select t.ok($$insert into order_drafts(payload) select t.payload() || jsonb_build_object('customerId', t.id('cust'), 'event', jsonb_build_object('type', 'Wedding', 'name', 'Asha & Ravi', 'date', to_char(current_date + 30, 'YYYY-MM-DD'), 'delivery', to_char(current_date + 20, 'YYYY-MM-DD'), 'notes', 'rush'))$$, 'draft: reception saves an unfinished order');
insert into t.p36 select 'draft', id::text from order_drafts where created_by = auth.uid() limit 1;
select t.as('colour');
select t.eq($$select count(*)::text from order_drafts$$, '0', 'draft: another role cannot see it');
select t.err($$select finalize_order_v2(t.id('draft'))$$, 'finalize: a role without order rights cannot finalize', 'cannot create orders|not allowed');
select t.as('designer');
select t.eq($$select count(*)::text from order_pricing$$, '0', 'rls: production roles see no pricing');
select t.as('reception');
select t.eq($$select (finalize_order_v2(t.id('draft')))->>'total'$$, '3546.00', 'finalize: reception finalizes; the server recomputed the total');
select t.eq($$select (finalize_order_v2(t.id('draft')))->>'code' = (select code from orders order by created_at desc limit 1)$$, 'true', 'finalize: a second click / retry returns the same order');
select t.eq($$select count(*)::text from orders where customer_id = t.id('cust')$$, '1', 'finalize: no duplicate order');
select t.eq($$select count(*)::text from invoices where order_id = (select id from orders where customer_id = t.id('cust'))$$, '1', 'finalize: no duplicate invoice');
select t.eq($$select number ~ '^INV-[0-9]{4}-[0-9]{4}$' from invoices where order_id = (select id from orders where customer_id = t.id('cust'))$$, 'true', 'finalize: the invoice gets its final number');
select t.eq($$select total::text || '/' || subtotal::text || '/' || coalesce(discount_amount, 0)::text from invoices where order_id = (select id from orders where customer_id = t.id('cust'))$$, '3546.00/3940.00/394.00', 'finalize: invoice total = priced total');
select t.eq($$select total::text from orders where customer_id = t.id('cust')$$, '3546.00', 'finalize: the order total is the final amount');
select t.eq($$select count(*)::text from order_albums where order_id = (select id from orders where customer_id = t.id('cust'))$$, '2', 'finalize: both albums are stored');
select t.eq($$select string_agg(title || ':' || copies || ':' || pages, ',' order by position) from order_albums where order_id = (select id from orders where customer_id = t.id('cust'))$$, 'Wedding album:2:30,Engagement album:1:20', 'finalize: each album keeps its own name, copies and sheets');
select t.eq($$select count(*)::text from order_charge_lines where order_id = (select id from orders where customer_id = t.id('cust'))$$, '8', 'finalize: every priced line is stored (5 + 2 + 1)');
select t.eq($$select status || ':' || revision from order_pricing where order_id = (select id from orders where customer_id = t.id('cust'))$$, 'finalized:1', 'finalize: the pricing is recorded as finalized');
select t.eq($$select snapshot->'business'->>'name' || ' | ' || (snapshot->'customer'->>'name') from invoices where order_id = (select id from orders where customer_id = t.id('cust'))$$, 'Test Studio Pvt Ltd | Pricing Customer', 'finalize: business and customer details are in the invoice snapshot');
select t.eq($$select count(*)::text from invoice_lines where invoice_id = (select id from invoices where order_id = (select id from orders where customer_id = t.id('cust'))) and section = 'Wedding album'$$, '5', 'finalize: invoice lines are grouped by album');
select t.err($$update order_drafts set payload = '{}' where id = t.id('draft')$$, 'finalize: the finalized draft cannot be edited', 'already finalized');
select t.err($$update order_pricing set total = 1$$, 'finalize: finalized pricing cannot be edited', 'permission denied');
select t.eq($$select count(*)::text from notifications where title = 'Order created' and body like '%Pricing Customer%'$$, '0', 'finalize: (reception sees only their own notifications)');
-- a later catalog change does not alter history
select t.as('system');
update cat_rates set rate = 99 where item_id = t.id('i_PRN') and size = '12x36' and paper = 'Matte' and finish is null;
update cat_items set rate = 9999, active = false where id = t.id('i_leather');
select t.eq($$select total::text from order_pricing where order_id = (select id from orders where customer_id = t.id('cust'))$$, '3546.00', 'history: the finalized total is unchanged after the catalog changed');
select t.eq($$select (snapshot->'albums'->0->'lines'->0->>'rate') from order_pricing where order_id = (select id from orders where customer_id = t.id('cust'))$$, '12.00', 'history: the snapshot keeps the old rate');
select t.eq($$select name || ' @ ' || rate::text from order_charge_lines where order_id = (select id from orders where customer_id = t.id('cust')) and album_position = 1 and name like '%Leatherette%'$$, 'Covers - Leatherette cover @ 500.00', 'history: the stored line keeps the old item name and rate');
select t.ok($$select 1 where (t.price(t.payload())->>'canFinalize') = 'false'$$, 'history: the same selections now price differently / cannot use the deactivated item');
update cat_rates set rate = 12 where item_id = t.id('i_PRN') and size = '12x36' and paper = 'Matte' and finish is null;
update cat_items set rate = 500, active = true where id = t.id('i_leather');
-- discounts above the approval threshold need an admin
select t.as('reception');
insert into order_drafts(payload) select jsonb_set(t.payload(), '{discount}', '{"type":"percent","value":15}') || jsonb_build_object('customerId', t.id('cust'), 'event', jsonb_build_object('type', 'Wedding', 'date', to_char(current_date + 30, 'YYYY-MM-DD')));
insert into t.p36 select 'draft15', id::text from order_drafts where payload->'discount'->>'value' = '15' and created_by = auth.uid();
select t.err($$select finalize_order_v2(t.id('draft15'))$$, 'finalize: a 15% discount needs an admin', 'needs an admin');
-- missing price blocks finalizing
insert into order_drafts(payload) select jsonb_set(t.payload(), '{albums,1,size}', '"8x8"') || jsonb_build_object('customerId', t.id('cust'), 'event', jsonb_build_object('type', 'Wedding', 'date', to_char(current_date + 30, 'YYYY-MM-DD')));
insert into t.p36 select 'draftmiss', id::text from order_drafts where payload->'albums'->1->>'size' = '8x8';
select t.err($$select finalize_order_v2(t.id('draftmiss'))$$, 'finalize: "price not configured" blocks it', 'not configured');
-- a new customer is created with the order; phone is validated
insert into order_drafts(payload) select t.payload() || jsonb_build_object('newCustomer', jsonb_build_object('name', 'Walk In', 'phone', '5123456789'), 'event', jsonb_build_object('type', 'Wedding', 'date', to_char(current_date + 30, 'YYYY-MM-DD')));
insert into t.p36 select 'draftnew', id::text from order_drafts where payload->'newCustomer'->>'name' = 'Walk In';
select t.err($$select finalize_order_v2(t.id('draftnew'))$$, 'finalize: a phone starting with 5 is refused', '10-digit');
update order_drafts set payload = jsonb_set(payload, '{newCustomer,phone}', '"9876543210"') where id = t.id('draftnew');
select t.eq($$select (finalize_order_v2(t.id('draftnew')))->>'total'$$, '3546.00', 'finalize: a new customer is created together with the order');
select t.eq($$select count(*)::text from customers where studio_name = 'Walk In' and mobile = '9876543210'$$, '1', 'finalize: the new customer exists');
-- Printing Only
insert into order_drafts(payload) select jsonb_set(t.payload(), '{orderType}', '"printing_only"') || jsonb_build_object('customerId', t.id('cust'), 'event', jsonb_build_object('type', 'Birthday', 'date', to_char(current_date + 5, 'YYYY-MM-DD')));
insert into t.p36 select 'draftpo', id::text from order_drafts where payload->>'orderType' = 'printing_only' and created_by = auth.uid();
select t.eq($$select (finalize_order_v2(t.id('draftpo')))->>'total'$$, '3258.00', 'finalize: Printing Only has no design charge ((3220 + 200 + 200) − 10%)');
select t.eq($$select count(*)::text from order_charge_lines l join orders o on o.id = l.order_id where l.kind = 'design' and o.type = 'printing_only'$$, '0', 'finalize: no design lines on a Printing Only order');

-- ───── authorized edit: reopen → edit → re-finalize ─────
select t.as('system');
insert into payments(receipt_no, order_id, amount, mode) select 'RCP-WF-1', id, 1000, 'cash' from orders where customer_id = t.id('cust') order by created_at limit 1;
insert into t.p36 select 'ord1', id::text from orders where customer_id = t.id('cust') order by created_at limit 1;
select t.as('reception');
select t.err($$select reopen_order_pricing(t.id('ord1'), 'customer asked for a change')$$, 'reopen: reception cannot', 'administrator');
select t.as('admin');
select t.err($$select reopen_order_pricing(t.id('ord1'), '')$$, 'reopen: a reason is required', 'reason');
select t.ok($$select reopen_order_pricing(t.id('ord1'), 'customer asked for a change')$$, 'reopen: admin reopens with a reason');
select t.eq($$select status from order_pricing where order_id = t.id('ord1')$$, 'reopened', 'reopen: the pricing is open for editing');
select t.eq($$select status from invoices where order_id = t.id('ord1') and kind = 'invoice'$$, 'void', 'reopen: the old invoice is voided (and kept)');
select t.err($$select reopen_order_pricing(t.id('ord1'), 'again')$$, 'reopen: cannot reopen twice', 'already open');
insert into t.p36 select 'draftre', id::text from order_drafts where payload->>'reopenOrder' = t.id('ord1')::text;
update order_drafts set payload = jsonb_set(jsonb_set(payload, '{albums,1,sheets}', '24'), '{albums,0,copies}', '1') where id = t.id('draftre');
select t.eq($$select (finalize_order_v2(t.id('draftre')))->>'revision'$$, '2', 'reopen: re-finalizing makes revision 2');
select t.eq($$select count(*)::text from invoices where order_id = t.id('ord1') and kind = 'invoice'$$, '2', 'reopen: the voided invoice is kept next to the new one');
select t.eq($$select count(*)::text from invoices where order_id = t.id('ord1') and status = 'sent'$$, '1', 'reopen: exactly one live invoice');
select t.eq($$select total::text from orders where id = t.id('ord1')$$, (select (t.price((select payload from order_pricing where order_id = t.id('ord1'))))->>'total'), 'reopen: the order total follows the new pricing');
select t.eq($$select status || ':' || revision from order_pricing where order_id = t.id('ord1')$$, 'finalized:2', 'reopen: finalized again');
select t.eq($$select count(*)::text from payments where order_id = t.id('ord1')$$, '1', 'reopen: payments received are kept');
select t.eq($$select count(*)::text from order_charge_lines where order_id = t.id('ord1') and revision = 1$$, '8', 'reopen: the first revision lines are kept for the record');
select t.ok($$select reopen_order_pricing(t.id('ord1'), 'second look')$$, 'reopen: can be reopened again');
select t.ok($$select cancel_reopen_pricing(t.id('ord1'))$$, 'reopen: or cancelled');
select t.eq($$select (select status from order_pricing where order_id = t.id('ord1')) || ':' || (select count(*) from invoices where order_id = t.id('ord1') and status = 'sent')$$, 'finalized:1', 'reopen: cancelling restores the finalized order and its invoice');

-- ───── catalog permissions, business profile, import ─────
select t.as('reception');
select t.err($$insert into cat_categories(name) values ('Hacked')$$, 'rls: reception cannot edit the catalog', 'row-level');
select t.eq($$select count(*) > 0 from cat_items$$, 'true', 'rls: but reads it');
select t.eq($$select business_profile()->>'name'$$, 'Test Studio Pvt Ltd', 'business: any staff can read the invoice header details');
select t.as('admin');
select t.ok($$update cat_items set rate = 11 where id = t.id('i_mini')$$, 'rls: admin edits catalog items');
select t.eq($$select count(*)::text from cat_items where id = t.id('i_retired') and active = false$$, '1', 'catalog: deactivation is a flag, nothing is deleted');
select t.as('system');
select cat_import_classic();    -- bring in whatever the other suites left in the classic catalog
insert into t.p36 select 'legacy_n', count(*)::text from catalog_items;
insert into catalog_items(name, category, sku, unit, sell_price) values ('ZZIMP-NT-125 GSM-GLOSSY', 'ZZIMP', 'ZZ321', 'Nos', 75), ('ZZIMP-TRANSPARENT', 'ZZIMP', null, 'Nos', 140), ('ZZKIDS - PK 01', 'ZZKIDS', 'ZZPK 01', 'Nos', 1000), ('ZZSOLO', 'ZZSOLO', null, 'Nos', 10),
  ('ZZA-B-C-D-E-F', 'ZZA', null, 'Nos', 5);
select t.eq($$select cat_import_classic()::text$$, '5', 'import: the classic catalog items are copied');
select t.eq($$select i.name || ' @ ' || i.rate::text from cat_items i join cat_categories c on c.id = i.category_id where i.code = 'ZZ321' and c.name = '125 GSM' and c.depth = 3$$, 'GLOSSY @ 75.00', 'import: ZZIMP ▸ NT ▸ 125 GSM ▸ GLOSSY keeps its price');
select t.eq($$select c.name || ':' || c.depth from cat_items i join cat_categories c on c.id = i.category_id where i.name = 'TRANSPARENT' and c.name = 'ZZIMP'$$, 'ZZIMP:1', 'import: an item can sit directly under a top-level category');
select t.eq($$select i.name from cat_items i join cat_categories c on c.id = i.category_id where c.name = 'D' and c.depth = 4 and i.name like 'E-%'$$, 'E-F', 'import: names deeper than 4 levels collapse into the item name');
select t.eq($$select cat_import_classic()::text$$, '0', 'import: running it again adds nothing');
select t.eq($$select (count(*) - 5)::text = (select v from t.p36 where k = 'legacy_n') from catalog_items$$, 'true', 'import: the classic catalog itself is untouched');
\echo ORDER WORKFLOW TESTS PASSED
