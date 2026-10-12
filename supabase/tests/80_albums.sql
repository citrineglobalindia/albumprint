\set ON_ERROR_STOP on
\set QUIET on
-- Multiple albums per order (0024). Reuses the t.* harness.
reset role;
create table t.p80(k text primary key, v text);
grant select, insert on t.p80 to authenticated;
select t.as('system');
insert into customers(studio_name, mobile) values ('Album Studio', '9000000080');
insert into orders(customer_id, type, due_date, total, couple_name) select id, 'design_printing', current_date + 14, 30000, 'Asha & Ravi' from customers where studio_name = 'Album Studio';
insert into t.p80 select 'O', id::text from orders where couple_name = 'Asha & Ravi';

select t.as('reception');
select t.ok($$insert into order_albums(order_id, position, album_type, album_size, orientation, pages, copies, paper_type, cover_type, binding) select v::uuid, 1, 'Premium Album', '12x36', 'landscape', 30, 1, 'Matte', 'Leatherette', 'Lay-flat' from t.p80 where k='O'$$, 'albums: reception adds album 1');
select t.ok($$insert into order_albums(order_id, position, album_type, album_size, orientation, pages, copies, paper_type, cover_type, binding, finishes) select v::uuid, 2, 'Photobook', '8x12', 'portrait', 20, 2, 'Silk', 'Fabric', 'Standard', array['UV Printing'] from t.p80 where k='O'$$, 'albums: and a second, different album');
select t.err($$insert into order_albums(order_id, position, album_type, album_size, orientation, pages, copies, paper_type, cover_type, binding) select v::uuid, 2, 'X', '8x12', 'portrait', 20, 1, 'Silk', 'Fabric', 'Standard' from t.p80 where k='O'$$, 'albums: duplicate position refused', 'duplicate|unique');
select t.err($$insert into order_albums(order_id, position, album_type, album_size, orientation, pages, copies, paper_type, cover_type, binding) select v::uuid, 3, 'X', '8x12', 'portrait', 0, 1, 'Silk', 'Fabric', 'Standard' from t.p80 where k='O'$$, 'albums: zero pages refused', 'check');
select t.eq($$select count(*)::text from order_albums where order_id = (select v::uuid from t.p80 where k='O')$$, '2', 'albums: both stored');
select t.as('designer');
select t.err($$insert into order_albums(order_id, position, album_type, album_size, orientation, pages, copies, paper_type, cover_type, binding) select v::uuid, 3, 'X', '8x12', 'portrait', 10, 1, 'Silk', 'Fabric', 'Standard' from t.p80 where k='O'$$, 'albums: roles without print-spec write cannot add albums', 'row-level|permission|policy');
select t.as('system');
select t.eq($$select couple_name from orders where id = (select v::uuid from t.p80 where k='O')$$, 'Asha & Ravi', 'albums: couple name stored on the order');
\echo ALBUMS TESTS PASSED
