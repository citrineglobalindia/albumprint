\set ON_ERROR_STOP on
\set QUIET on
-- Product catalog and order items (0027). Reuses the t.* harness.
reset role;
create table t.p90(k text primary key, v text);
grant select, insert on t.p90 to authenticated;
select t.as('system');
update profiles set active = true where id = (select id from t.users where role = 'admin');      -- an earlier suite leaves the fixture admin inactive
select t.as('admin');
select t.ok($$insert into catalog_items(name, category, sku, unit, sell_price) values ('PAPER-NT LUSTER', 'PAPER', 'S1', 'Nos', 90)$$, 'catalog: admin adds a product');
select t.ok($$insert into catalog_costs(item_id, cost_price) select id, 85 from catalog_items where name = 'PAPER-NT LUSTER'$$, 'catalog: admin records its cost');
select t.err($$insert into catalog_items(name, category, sell_price) values ('paper-nt luster ', 'PAPER', 1)$$, 'catalog: duplicate name (case/space-insensitive) refused', 'duplicate|unique');
select t.err($$insert into catalog_items(name, category, sell_price) values ('X', 'PAPER', -1)$$, 'catalog: negative price refused', 'check');
select t.as('system');
insert into customers(studio_name, mobile) values ('Cat Studio', '9000000090');
insert into orders(customer_id, type, due_date, total) select id, 'design_printing', current_date + 14, 1000 from customers where studio_name = 'Cat Studio';
insert into t.p90 select 'O', id::text from orders where customer_id = (select id from customers where studio_name = 'Cat Studio');
insert into t.p90 select 'I', id::text from catalog_items where name = 'PAPER-NT LUSTER';
select t.as('reception');
select t.eq($$select count(*)::text from catalog_items$$, '1', 'catalog: reception can read the catalog');
select t.eq($$select count(*)::text from catalog_costs$$, '0', 'catalog: reception cannot see costs');
select t.err($$insert into catalog_items(name, category, sell_price) values ('NEW', 'PAPER', 5)$$, 'catalog: reception cannot add products', 'row-level');
select t.ok($$insert into order_items(order_id, position, item_id, name, qty, sell_price) select (select v::uuid from t.p90 where k='O'), 1, (select v::uuid from t.p90 where k='I'), 'tampered', 3, 1$$, 'order items: reception adds a catalog item');
select t.eq($$select name || ':' || sell_price::text || ':' || unit from order_items where position = 1 and order_id = (select v::uuid from t.p90 where k='O')$$, 'PAPER-NT LUSTER:90.00:Nos', 'order items: name and price come from the catalog, not the client');
select t.ok($$insert into order_items(order_id, position, name, qty, sell_price) select v::uuid, 2, 'Custom frame', 2, 450 from t.p90 where k='O'$$, 'order items: a custom item keeps its typed price');
select t.err($$insert into order_items(order_id, position, name, qty, sell_price) select v::uuid, 3, 'Bad', 0, 10 from t.p90 where k='O'$$, 'order items: zero quantity refused', 'check');
select t.as('system');
update catalog_items set active = false where name = 'PAPER-NT LUSTER';
select t.as('reception');
select t.err($$insert into order_items(order_id, position, item_id, name, qty) select (select v::uuid from t.p90 where k='O'), 4, (select v::uuid from t.p90 where k='I'), 'x', 1$$, 'order items: an inactive product cannot be ordered', 'not available');
select t.as('designer');
select t.err($$insert into order_items(order_id, position, name, qty, sell_price) select v::uuid, 5, 'Nope', 1, 1 from t.p90 where k='O'$$, 'order items: roles without order write cannot add items', 'row-level');
\echo CATALOG TESTS PASSED
