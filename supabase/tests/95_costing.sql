\set ON_ERROR_STOP on
\set QUIET on
-- Album costing (0028). Reuses the t.* harness.
reset role;
create table t.p95(k text primary key, v text);
grant select, insert on t.p95 to authenticated;
select t.as('system');
update profiles set active = true where id = (select id from t.users where role = 'admin');
insert into customers(studio_name, mobile) values ('Cost Studio', '9000000095');
insert into orders(customer_id, type, due_date, total) select id, 'design_printing', current_date + 14, 0 from customers where studio_name = 'Cost Studio';
insert into t.p95 select 'O', id::text from orders where customer_id = (select id from customers where studio_name = 'Cost Studio');
insert into order_albums(order_id, position, album_type, album_size, orientation, pages, copies, paper_type, cover_type, binding)
  select v::uuid, 1, 'Premium Album', '12x36', 'landscape', 30, 1, 'Matte', 'Leatherette', 'Lay-flat' from t.p95 where k = 'O';
insert into t.p95 select 'A', id::text from order_albums where order_id = (select v::uuid from t.p95 where k = 'O');

select t.as('reception');
select t.err($$insert into album_lines(order_id, album_id, position, name, qty, sell_price) select (select v::uuid from t.p95 where k='O'), (select v::uuid from t.p95 where k='A'), 1, 'X', 1, 1$$, 'costing: reception cannot add lines', 'row-level');
select t.as('admin');
select t.ok($$insert into order_costing(order_id, design_charge, grading_images, grading_rate, discount_pct, gst_pct) select v::uuid, 4000, 300, 4, 10, 18 from t.p95 where k='O'$$, 'costing: admin saves the extras');
select t.ok($$insert into album_lines(order_id, album_id, position, name, qty, sell_price) select (select v::uuid from t.p95 where k='O'), (select v::uuid from t.p95 where k='A'), 1, 'COVER-PIXEL BUDGET COVER-PL 06', 1, 900$$, 'costing: admin adds the cover line');
select t.ok($$insert into album_lines(order_id, album_id, position, name, qty, sell_price, dimension, remarks) select (select v::uuid from t.p95 where k='O'), (select v::uuid from t.p95 where k='A'), 2, 'PAPER-NT-125 GSM-GLOSSY', 29, 75, '12x36', 'inside sheets' from t.p95 where k='O'$$, 'costing: and the inside sheets');
select t.ok($$insert into album_line_costs(line_id, cost_price) select id, 68 from album_lines where position = 2 and order_id = (select v::uuid from t.p95 where k='O')$$, 'costing: admin records a purchase price');
select t.err($$insert into album_lines(order_id, album_id, position, name, qty, sell_price) select (select v::uuid from t.p95 where k='O'), (select v::uuid from t.p95 where k='A'), 3, 'Y', 0, 1$$, 'costing: zero quantity refused', 'check');
select t.as('reception');
select t.eq($$select count(*)::text from album_lines where order_id = (select v::uuid from t.p95 where k='O')$$, '2', 'costing: reception can read the lines');
select t.eq($$select count(*)::text from album_line_costs$$, '0', 'costing: reception cannot see purchase prices');
select t.err($$select finalize_costing((select v::uuid from t.p95 where k='O'))$$, 'costing: reception cannot finalize', 'only an admin');
select t.as('admin');
-- sub = 900 + 29*75 + 4000 + 300*4 = 8275; discount 10% = 828 (round half up of 827.5); tax 18% of 7447 = 1340; total 8787
select t.eq($$select ((finalize_costing((select v::uuid from t.p95 where k='O')))->>'total')::numeric::int::text$$, '8787', 'costing: the server computes the total (lines + design + grading − discount + GST)');
select t.eq($$select total::text from orders where id = (select v::uuid from t.p95 where k='O')$$, '8787.00', 'costing: the order total is set');
select t.err($$update album_lines set qty = 2 where position = 1 and order_id = (select v::uuid from t.p95 where k='O')$$, 'costing: finalized lines are locked', 'finalized');
select t.err($$update order_costing set discount_pct = 50 where order_id = (select v::uuid from t.p95 where k='O')$$, 'costing: finalized extras are locked', 'finalized');
select t.err($$update order_costing set finalized_at = null where order_id = (select v::uuid from t.p95 where k='O')$$, 'costing: it cannot be unlocked by a plain update', 'finalize_costing|reopen');
select t.ok($$select reopen_costing((select v::uuid from t.p95 where k='O'))$$, 'costing: admin reopens it');
select t.ok($$update album_lines set qty = 28 where position = 2 and order_id = (select v::uuid from t.p95 where k='O')$$, 'costing: lines can be edited again');
\echo COSTING TESTS PASSED
