\set ON_ERROR_STOP on
\set QUIET on
-- Event notifications (0035). Reuses the t.* harness.
reset role;
create table t.p99n(k text primary key, v text);
grant select, insert, update on t.p99n to authenticated;
create function t.cnt(title_pat text, uid_role text default null) returns text language sql as $$
  select count(*)::text from notifications n where n.title like title_pat and (uid_role is null or n.user_id = (select id from t.users where role = uid_role::app_role)) $$;
grant execute on function t.cnt(text, text) to authenticated;
select t.as('system');
update profiles set active = true where id in (select id from t.users);
update profiles set active = false where id not in (select id from t.users);   -- other suites added extra staff; keep the recipients predictable
delete from notifications;
insert into customers(studio_name, mobile) values ('Notify Studio', '9000000099');
insert into orders(customer_id, type, due_date, total, event_type) select id, 'design_printing', current_date + 14, 30000, 'Wedding' from customers where studio_name = 'Notify Studio';
insert into t.p99n select 'O', id::text from orders where customer_id = (select id from customers where studio_name = 'Notify Studio');

select t.eq($$select t.cnt('Order created')$$, '2', 'notify: a new order reaches Admin and Reception');
select t.eq($$select t.cnt('Order created', 'designer')$$, '0', 'notify: and nobody else');
select t.eq($$select body like '%Notify Studio%' from notifications where title = 'Order created' limit 1$$, 'true', 'notify: it names the order and the customer');

-- every hand-over tells the department that is next
update orders set stage = 'files_received' where id = (select v::uuid from t.p99n where k = 'O');
update orders set stage = 'colour_grading' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Colour grading assigned', 'colour')$$, '1', 'notify: colour grading is told');
update orders set stage = 'admin_approval' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Grading submitted%', 'admin')$$, '1', 'notify: admin is asked to approve the grading');
update orders set stage = 'designing' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Design assigned', 'designer')$$, '1', 'notify: the designer is told');
update orders set stage = 'design_review' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Design submitted%', 'admin')$$, '1', 'notify: admin is asked to review the design');
update orders set stage = 'client_review' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Proof ready%')$$, '2', 'notify: admin and reception are told the proof is ready');
update orders set stage = 'designing' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Corrections requested')$$, '2', 'notify: corrections reach admin and the designer');
update orders set stage = 'design_review' where id = (select v::uuid from t.p99n where k = 'O');
update orders set stage = 'client_review' where id = (select v::uuid from t.p99n where k = 'O');
update orders set stage = 'final_approval' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Client approved the proof%', 'admin')$$, '1', 'notify: admin is told the client approved');
update orders set stage = 'printing' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Released to printing', 'printing')$$, '1', 'notify: printing is told the job is released');
update orders set stage = 'qc' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Printing completed%', 'qc')$$, '1', 'notify: QC is told');
update orders set stage = 'printing' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Sent back to Printing')$$, '2', 'notify: a rework move tells admin and printing');
update orders set stage = 'qc' where id = (select v::uuid from t.p99n where k = 'O');
update orders set stage = 'ready_for_delivery' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('QC passed%')$$, '2', 'notify: admin and reception are told the order is ready');
update orders set stage = 'delivered' where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Delivered')$$, '2', 'notify: delivery is announced');

-- each notification opens a page its department can use
select t.eq($$select link like '/designing/IDP%' from notifications where title = 'Design assigned'$$, 'true', 'links: the designer is sent to Album Designing');
select t.eq($$select link from notifications where title = 'Colour grading assigned'$$, '/colour-grading', 'links: colour grading is sent to Colour Grading');
select t.eq($$select link from notifications where title = 'Released to printing'$$, '/printing', 'links: printing is sent to Printing');
select t.eq($$select link from notifications where title = 'Printing completed — QC needed'$$, '/qc', 'links: QC is sent to Quality Control');
select t.eq($$select link like '/orders/IDP%' from notifications where title = 'Order created' limit 1$$, 'true', 'links: admin and reception open the order');

-- other events
update orders set assignee = (select id from t.users where role = 'designer') where id = (select v::uuid from t.p99n where k = 'O');
select t.eq($$select t.cnt('Job assigned to you', 'designer')$$, '1', 'notify: a new assignee is told');
select t.eq($$select link like '/designing/IDP%' from notifications where title = 'Job assigned to you'$$, 'true', 'links: an assignment opens the page for the assignee''s role');
insert into payments(receipt_no, order_id, amount, mode) select 'RCP-N-1', v::uuid, 100, (enum_range(null::pay_mode))[1] from t.p99n where k = 'O';
select t.eq($$select t.cnt('Payment received')$$, '2', 'notify: payments reach admin and accounts');
insert into orders(customer_id, type, due_date, total, stage) select id, 'design_printing', current_date + 14, 1000, 'qc' from customers where studio_name = 'Notify Studio';
insert into qc_inspections(order_id, decision, defect_codes) select id, 'failed', array['Colour'] from orders where stage = 'qc' and total = 1000 limit 1;
select t.eq($$select t.cnt('QC failed')$$, '2', 'notify: a failed QC reaches admin and printing');
select t.ok($$insert into invoices(number, order_id, customer_id, due_date, discount_pct, status) select 'INV-N-0', o.id, o.customer_id, current_date + 3, 20, 'draft' from orders o where o.id = (select v::uuid from t.p99n where k = 'O')$$, 'notify: a draft invoice with a 20% discount');
select t.eq($$select t.cnt('Discount approval needed', 'admin')$$, '1', 'notify: a discount above the limit needs the admin');
select t.ok($$insert into invoices(number, order_id, customer_id, due_date, discount_pct, status) select 'INV-N-1', o.id, o.customer_id, current_date - 3, 0, 'sent' from orders o where o.id = (select v::uuid from t.p99n where k = 'O')$$, 'notify: an overdue sent invoice');
insert into orders(customer_id, type, due_date, total, stage) select id, 'design_printing', current_date + 14, 0, 'ready_for_delivery' from customers where studio_name = 'Notify Studio';
insert into deliveries(order_id, mode, status) select id, (enum_range(null::delivery_mode))[1], 'ready' from orders where total = 0 and stage = 'ready_for_delivery';
update deliveries set status = 'dispatched', courier = 'BlueDart', tracking_no = 'BD123', dispatched_at = now() where order_id = (select id from orders where total = 0 and stage = 'ready_for_delivery');
select t.eq($$select t.cnt('Dispatched')$$, '2', 'notify: a dispatch reaches admin and reception');

-- the person making a change is not told about their own action
select t.as('admin');
select t.ok($$update orders set on_hold = true, hold_reason = 'waiting for files' where id = (select v::uuid from t.p99n where k = 'O')$$, 'notify: admin puts the order on hold');
select t.as('system');
select t.eq($$select t.cnt('Order put on hold')$$, '1', 'notify: only reception is told (not the admin who did it)');
select t.eq($$select t.cnt('Order put on hold', 'admin')$$, '0', 'notify: the actor is excluded');

-- switched-off templates stay quiet
select t.as('system');
update notification_templates set in_app = false where key = 'order_created';
delete from notifications where title = 'Order created';
insert into orders(customer_id, type, due_date, total) select id, 'design_printing', current_date + 14, 1000 from customers where studio_name = 'Notify Studio';
select t.eq($$select t.cnt('Order created')$$, '0', 'notify: a template with in-app switched off sends nothing');
update notification_templates set in_app = true where key = 'order_created';

-- overdue reminders: once a day per invoice
select t.eq($$select run_payment_reminders()::text$$, '2', 'reminder: admin and accounts get an overdue-payment reminder');
select t.eq($$select count(*)::text from notifications where title like 'Payment overdue: INV-%' and body like '%3 days overdue%'$$, '2', 'reminder: it says how late it is');
select t.eq($$select run_payment_reminders()::text$$, '0', 'reminder: not repeated the same day');

-- nudges
select t.as('reception');
select t.err($$select notify_assignee((select v::uuid from t.p99n where k = 'O'), 'Nudge', 'please hurry')$$, 'nudge: reception cannot send nudges', 'administrator');
select t.as('admin');
select t.eq($$select notify_assignee((select v::uuid from t.p99n where k = 'O'), 'Nudge', 'please hurry')::text$$, '1', 'nudge: admin nudges the assignee');
select t.as('designer');
select t.eq($$select count(*)::text from notifications where title = 'Nudge' and user_id = auth.uid()$$, '1', 'nudge: the assignee sees it');
select t.eq($$select count(*)::text from notifications where title = 'Order created' or user_id <> auth.uid()$$, '0', 'notify: a user only ever reads their own notifications');
\echo NOTIFICATION TESTS PASSED
