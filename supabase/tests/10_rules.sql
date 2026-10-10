\set ON_ERROR_STOP on
\set QUIET on
-- ───── harness ─────
create schema t; grant usage on schema t to authenticated;
create table t.users(role app_role primary key, id uuid);
create table t.ctx(k text primary key, v text);
grant select, insert, update on t.ctx to authenticated; grant select on t.users to authenticated;
create function t.as(r text) returns void language plpgsql as $$
begin
  reset role;
  if r = 'system' then perform set_config('request.jwt.claim.sub','',false); return; end if;
  perform set_config('request.jwt.claim.sub', (select id::text from t.users where role = r::app_role), false);
  set role authenticated;
end $$;
create function t.ok(q text, label text) returns void language plpgsql as $$
begin execute q; raise notice 'ok   - %', label;
exception when others then raise exception 'FAIL - % (unexpected error: %)', label, sqlerrm; end $$;
create function t.err(q text, label text, pat text default null) returns void language plpgsql as $$
declare e text; begin
  begin execute q; exception when others then e := sqlerrm; end;
  if e is null then raise exception 'FAIL - % (expected an error, none raised)', label; end if;
  if pat is not null and e !~* pat then raise exception 'FAIL - % (wrong error: %)', label, e; end if;
  raise notice 'ok   - % [%]', label, left(e, 60);
end $$;
create function t.eq(q text, expected text, label text) returns void language plpgsql as $$
declare v text; begin execute q into v;
  if v is distinct from expected then raise exception 'FAIL - % (got %, want %)', label, v, expected; end if;
  raise notice 'ok   - %', label; end $$;
create function t.set(k text, v text) returns void language sql as $$ insert into t.ctx values (k, v) on conflict (k) do update set v = excluded.v $$;
create function t.get(k text) returns text language sql as $$ select v from t.ctx where k = k $$;
grant execute on all functions in schema t to authenticated;

insert into auth.users(id) select gen_random_uuid() from generate_series(1,7);
insert into profiles(id, full_name, email, role, must_change_password)
select u.id, r::text || ' user', r::text || '@t.com', r, false
from (select id, row_number() over () n from auth.users) u join (select r, row_number() over () n from unnest(enum_range(null::app_role)) r) x on x.n = u.n;
insert into t.users select role, id from profiles;

-- ───── IDs, masking, permissions ─────
select t.as('reception');
select t.ok($$insert into customers(studio_name, mobile, email, city) values ('Sharma Studio','9876543210','rahul@sharma.in','Mumbai')$$, 'reception creates customer');
select t.eq($$select code from customers$$, 'IDC000001', 'customer code is server-generated');
select t.eq($$select mobile from list_customers()$$, '9876543210', 'reception sees unmasked mobile');
select t.as('colour');
select t.eq($$select count(*)::text from customers$$, '0', 'colour grader cannot read raw customer rows');
select t.eq($$select mobile from list_customers()$$, '987•••••10', 'colour grader sees masked mobile');
select t.err($$insert into customers(studio_name, mobile) values ('Hack Studio','1112223334')$$, 'colour grader cannot create customer');

-- ───── Design + Printing: full lifecycle ─────
select t.as('reception');
select t.ok($$insert into orders(customer_id, type, due_date, total) select id, 'design_printing', current_date + 14, 20000 from customers$$, 'reception creates order');
select t.ok($$insert into order_specs(order_id, album_type, album_size, orientation, pages, paper_type, cover_type, binding) select id, 'Premium Album','12x36','landscape',36,'Matte','Leatherette','Lay-flat' from orders$$, 'order spec saved');
select t.eq($$select code from orders$$, 'IDP00001', 'order code is server-generated');
select t.err($$update orders set stage = 'printing'$$, 'direct stage edit is blocked', 'advance_order');
select t.err($$update orders set paid = 20000$$, 'direct paid edit is blocked', 'advance_order|payments');
select t.err($$select advance_order((select id from orders), 'colour_grading')$$, 'cannot skip files_received', 'not allowed');
select t.ok($$select advance_order((select id from orders), 'files_received')$$, 'new → files received');
select t.ok($$select advance_order((select id from orders), 'colour_grading')$$, 'files → colour grading');
select t.as('colour');
select t.ok($$select advance_order((select id from orders), 'admin_approval')$$, 'grader submits to admin');
select t.err($$select advance_order((select id from orders), 'designing')$$, 'grader cannot approve own grading', 'may not move');
select t.as('reception');
select t.err($$select advance_order((select id from orders), 'designing')$$, 'reception cannot approve grading', 'may not move');
select t.as('admin');
select t.err($$select advance_order((select id from orders), 'colour_grading')$$, 'rejection needs a reason', 'reason is required');
select t.ok($$select advance_order((select id from orders), 'designing')$$, 'admin approves grading');
select t.as('designer');
select t.ok($$select advance_order((select id from orders), 'design_review')$$, 'designer submits draft');
select t.err($$select advance_order((select id from orders), 'client_review')$$, 'designer cannot self-approve design', 'may not move');
select t.as('admin');
select t.ok($$select advance_order((select id from orders), 'client_review')$$, 'admin approves design → client review');
select t.ok($$select advance_order((select id from orders), 'final_approval')$$, 'client review → final approval');
select t.err($$select advance_order((select id from orders), 'printing')$$, 'release blocked without client approval', 'final client approval');
select t.as('system');   -- client approval is recorded by the portal function (system context); staff cannot insert an approved proof (see 60_proofs_audit.sql)
select t.ok($$insert into proofs(order_id, version, token_hash, expires_at, status) select id, 1, repeat('a', 64), now() + interval '7 days', 'approved' from orders$$, 'client approval recorded');
select t.as('admin');
select t.ok($$insert into order_files(order_id, category, file_name, ext, size_bytes, storage_path) select id, 'final_print', 'album.pdf', 'pdf', 190000000, 'o/1/album.pdf' from orders$$, 'final print file uploaded');
select t.eq($$select version::text from order_files$$, '1', 'file starts at v1');
select t.ok($$insert into order_files(order_id, category, file_name, ext, size_bytes, storage_path) select id, 'final_print', 'album.pdf', 'pdf', 191000000, 'o/1/album-v2.pdf' from orders$$, 'same name uploads as new version');
select t.eq($$select max(version)::text from order_files$$, '2', 'version auto-increments');
select t.ok($$select lock_final_print_file((select id from order_files where version = 2))$$, 'admin locks final print file after approval');
select t.err($$update order_files set storage_path = 'x' where version = 2$$, 'locked file is immutable', 'immutable');
select t.ok($$delete from order_files where version = 2$$, 'staff delete is a no-op (no delete policy)');
select t.eq($$select count(*)::text from order_files$$, '2', 'locked file still present after delete attempt');
select t.as('system');
select t.err($$delete from order_files where version = 2$$, 'even service role cannot delete a locked file', 'locked');
select t.as('admin');
select t.ok($$select advance_order((select id from orders), 'printing')$$, 'admin releases to printing');
select t.as('printing');
select t.ok($$select advance_order((select id from orders), 'qc')$$, 'printing hands to QC');
select t.as('qc');
select t.err($$insert into qc_inspections(order_id, decision) select id, 'failed' from orders$$, 'fail needs a defect reason', 'check');
select t.ok($$insert into qc_inspections(order_id, decision, defect_codes, notes) select id, 'rework', '{scratch}', 'back cover scratch' from orders$$, 'QC marks rework with defect');
select t.eq($$select qc_status::text from orders$$, 'rework', 'QC decision syncs to order');
select t.err($$select advance_order((select id from orders), 'ready_for_delivery')$$, 'cannot deliver before QC pass', 'QC must pass');
select t.err($$select advance_order((select id from orders), 'printing')$$, 'rework loop needs a reason', 'reason is required');
select t.ok($$select advance_order((select id from orders), 'printing', 'scratch on back cover')$$, 'QC sends back to printing');
select t.as('printing');
select t.ok($$select advance_order((select id from orders), 'qc')$$, 'reprinted → QC again');
select t.as('qc');
select t.ok($$insert into qc_inspections(order_id, round, decision) select id, 2, 'passed' from orders$$, 'QC passes round 2');
select t.ok($$select advance_order((select id from orders), 'ready_for_delivery')$$, 'order ready for delivery');
select t.ok($$insert into deliveries(order_id, mode, address, status) select id, 'courier', 'Mumbai', 'ready' from orders$$, 'delivery created');
select t.err($$update deliveries set status = 'dispatched', courier = 'DTDC', tracking_no = 'D1'$$, 'payment hold blocks dispatch', 'payment hold');

-- ───── payments ─────
select t.as('colour');
select t.eq($$select count(*)::text from payments$$, '0', 'colour grader sees no payments');
select t.err($$insert into payments(order_id, amount, mode) select id, 100, 'cash' from orders$$, 'colour grader cannot record payment', 'row-level security');
select t.as('reception');
select t.ok($$insert into payments(order_id, amount, mode, reference) select id, 5000, 'upi', 'UTR1' from orders$$, 'reception receives advance');
select t.eq($$select pay_status::text from orders$$, 'partially_paid', 'status → partially paid');
select t.eq($$select receipt_no from payments$$, 'RCP2026001', 'receipt number is server-generated');
select t.err($$insert into payments(order_id, amount, mode, kind) select id, 100, 'cash', 'refund' from orders$$, 'reception cannot refund', 'row-level security');
select t.as('accounts');
select t.ok($$insert into payments(order_id, amount, mode) select id, 15000, 'bank_transfer' from orders$$, 'accounts records balance');
select t.eq($$select pay_status::text || ':' || paid::text from orders$$, 'paid:20000.00', 'order is paid, paid = total');
select t.ok($$update payments set amount = 1$$, 'staff payment edit is a no-op (no update policy)');
select t.ok($$delete from payments$$, 'staff payment delete is a no-op');
select t.eq($$select sum(amount)::text from payments$$, '20000.00', 'payments unchanged');
select t.as('system');
select t.err($$update payments set amount = 1$$, 'even service role cannot edit a payment', 'immutable');
select t.err($$delete from payments$$, 'even service role cannot delete a payment', 'immutable');
select t.as('accounts');
select t.err($$insert into payments(order_id, amount, mode, kind) select id, 99999, 'cash', 'refund' from orders$$, 'refund cannot exceed amount paid', 'exceeds');
select t.ok($$insert into payments(order_id, amount, mode, kind) select id, 1000, 'cash', 'refund' from orders$$, 'accounts refunds 1000');
select t.eq($$select pay_status::text from orders$$, 'partially_paid', 'refund reduces to partially paid');
select t.ok($$insert into payments(order_id, amount, mode) select id, 1000, 'cash' from orders$$, 'balance paid again');

-- ───── delivery → close → read-only → reopen ─────
select t.as('qc');
select t.ok($$update deliveries set status = 'dispatched', courier = 'DTDC', tracking_no = 'D1'$$, 'dispatch allowed once paid');
select t.ok($$select advance_order((select id from orders), 'delivered')$$, 'delivered');
select t.as('reception');
select t.err($$select advance_order((select id from orders), 'closed')$$, 'reception cannot close order', 'may not move');
select t.as('admin');
select t.ok($$select advance_order((select id from orders), 'closed')$$, 'admin closes order');
select t.err($$update orders set special_instructions = 'late edit'$$, 'closed order is read-only', 'closed');
select t.err($$insert into order_files(order_id, category, file_name, ext, size_bytes, storage_path) select id, 'other', 'x.pdf', 'pdf', 1, 'p' from orders$$, 'no uploads to closed order', 'closed');
select t.err($$select advance_order((select id from orders), 'delivered')$$, 'reopen needs a reason', 'reason');
select t.ok($$select advance_order((select id from orders), 'delivered', 'customer reported missing page')$$, 'admin reopens with reason');

-- ───── Printing Only ─────
select t.as('reception');
select t.ok($$insert into orders(customer_id, type, due_date, total) select id, 'printing_only', current_date + 7, 8000 from customers$$, 'printing-only order created');
select t.eq($$select grading_status::text || '/' || design_status::text from orders where type = 'printing_only'$$, 'not_required/not_required', 'skipped stages are Not Required');
select t.ok($$select advance_order((select id from orders where type='printing_only'), 'files_received')$$, 'printing-only → files received');
select t.err($$select advance_order((select id from orders where type='printing_only'), 'colour_grading')$$, 'cannot enter grading', 'not allowed');
select t.err($$select advance_order((select id from orders where type='printing_only'), 'printing')$$, 'print-ready file required', 'print-ready');
select t.ok($$insert into order_files(order_id, category, file_name, ext, size_bytes, storage_path) select id, 'final_print', 'p.pdf', 'pdf', 1000, 'p' from orders where type='printing_only'$$, 'customer print file added');
select t.ok($$select advance_order((select id from orders where type='printing_only'), 'printing')$$, 'printing-only goes straight to printing');

-- ───── invoices ─────
select t.as('accounts');
select t.ok($$insert into invoices(order_id, customer_id, due_date, discount_pct) select id, customer_id, current_date + 9, 5 from orders where type='printing_only'$$, 'invoice drafted');
select t.eq($$select number from invoices$$, 'INV-2026-0001', 'invoice number is server-generated');
select t.ok($$insert into invoice_lines(invoice_id, description, qty, rate) select id, 'Premium album', 1, 16000 from invoices$$, 'line 1');
select t.ok($$insert into invoice_lines(invoice_id, description, qty, rate) select id, 'Lamination', 2, 500 from invoices$$, 'line 2');
select t.eq($$select subtotal::text || '/' || tax::text || '/' || total::text from invoices$$, '17000.00/2907.00/19057.00', '5% discount + 18% GST computed');
select t.ok($$update invoices set discount_pct = 15$$, 'draft may carry any discount');
select t.err($$update invoices set status = 'sent'$$, '15% discount needs admin approval to send', 'needs admin approval');
select t.ok($$update invoices set discount_pct = 8, status = 'sent'$$, 'within threshold can be sent');

-- ───── cancel, override, audit ─────
select t.as('admin');
select t.err($$select advance_order((select id from orders where type='printing_only'), 'cancelled')$$, 'cancellation needs a reason', 'reason');
select t.ok($$select advance_order((select id from orders where type='printing_only'), 'cancelled', 'customer withdrew')$$, 'order cancelled with reason');
select t.eq($$select count(*)::text from payments$$, '4', 'cancellation preserves history');
select t.as('reception');
select t.ok($$insert into orders(customer_id, type, due_date) select id, 'printing_only', current_date + 3 from customers$$, 'another order');
select t.err($$select advance_order((select id from orders where code = 'IDP00003'), 'qc', 'forcing', true)$$, 'reception cannot override', 'not allowed');
select t.as('admin');
select t.err($$select advance_order((select id from orders where code = 'IDP00003'), 'qc', null, true)$$, 'override needs a reason', 'not allowed');
select t.ok($$select advance_order((select id from orders where code = 'IDP00003'), 'qc', 'urgent, customer supplied reprint', true)$$, 'admin override with reason');
select t.eq($$select reason from audit_log where entity='orders' and new_data->>'code'='IDP00003' and action='update' order by id desc limit 1$$, 'urgent, customer supplied reprint', 'override reason is audited');
select t.err($$update audit_log set action = 'x'$$, 'audit log cannot be edited', 'permission denied|append-only');
select t.err($$delete from audit_log$$, 'audit log cannot be deleted', 'permission denied|append-only');
select t.as('colour');
select t.eq($$select count(*)::text from audit_log$$, '0', 'non-admin cannot read audit log');
select t.as('admin');
select t.eq($$select (count(*) > 40)::text from audit_log$$, 'true', 'audit captured the lifecycle');
select t.eq($$select count(*)::text from audit_log where actor is null and entity in ('orders','customers','payments','invoices','order_files','qc_inspections','deliveries')$$, '0', 'every operational audit row has an actor');
select t.as('colour');
select t.err($$insert into role_permissions values ('colour','new_module','full')$$, 'colour cannot grant itself permissions', 'row-level security');
select t.ok($$update role_permissions set level = 'full' where role = 'colour' and module = 'payments'$$, 'permission self-edit is a no-op');
select t.as('system');
select t.eq($$select level::text from role_permissions where role = 'colour' and module = 'payments'$$, 'none', 'colour permissions unchanged');
-- ───── anonymous access is closed ─────
reset role; grant usage on schema t to anon; grant execute on all functions in schema t to anon; set role anon;
select t.err($$select count(*) from orders$$, 'anon cannot read orders', 'permission denied');
select t.err($$select count(*) from list_customers()$$, 'anon cannot list customers', 'permission denied');
select t.err($$select advance_order(gen_random_uuid(), 'files_received')$$, 'anon cannot call advance_order', 'permission denied');
reset role; set role authenticated;
select t.err($$select recompute_payment_state(gen_random_uuid())$$, 'signed-in users cannot call internal functions', 'permission denied');
select t.err($$select audit_row()$$, 'signed-in users cannot call trigger functions', 'permission denied');
reset role;
\echo ALL TESTS PASSED
