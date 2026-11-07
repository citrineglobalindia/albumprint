\set ON_ERROR_STOP on
\set QUIET on
-- Auto-assign (0047). Reuses the t.* harness.
reset role;
select t.as('system');
update profiles set active = true where id in (select id from t.users);
insert into customers(studio_name, mobile) values ('Assign Customer', '9000000047');
create table if not exists t.aa(k text primary key, v uuid);
grant select on t.aa to authenticated;
insert into t.aa select 'colour', id from t.users where role = 'colour';
insert into t.aa select 'designer', id from t.users where role = 'designer';
-- a second colour grader who is busier
insert into t.aa select 'cust', id from customers where studio_name = 'Assign Customer';
create function t.neworder(p_stage stage_key) returns uuid language plpgsql as $$
declare o uuid;
begin
  insert into orders(customer_id, type, event_date, order_date, due_date, total) values ((select v from t.aa where k = 'cust'), 'design_printing', current_date + 30, current_date, current_date + 14, 1000) returning id into o;
  perform set_config('app.via_fn', '1', true); update orders set stage = p_stage where id = o; perform set_config('app.via_fn', '', true);
  return o;
end $$;

-- off (default): nothing changes
select t.eq($$select coalesce((select assignee::text from orders where id = t.neworder('colour_grading')), 'none')$$, 'none', 'auto-assign: off by default');

-- least busy: the colour grader is picked when the order reaches Colour Grading, and the grading job is assigned too
update settings set value = '{"colour_grading": {"mode": "least_busy"}}' where key = 'auto_assign';
insert into t.aa select 'o1', t.neworder('colour_grading');
select t.eq($$select (assignee = (select v from t.aa where k = 'colour'))::text from orders where id = (select v from t.aa where k = 'o1')$$, 'true', 'auto-assign: least busy picks the colour grader');
select t.eq($$select (assignee = (select v from t.aa where k = 'colour'))::text || '/' || status::text from tasks where order_id = (select v from t.aa where k = 'o1') and kind = 'grading'$$, 'true/pending', 'auto-assign: the grading job is assigned to the same person');
select t.eq($$select count(*)::text from notifications where user_id = (select v from t.aa where k = 'colour') and title = 'Job assigned to you'$$, '1', 'auto-assign: the person is notified');

-- a stage without a rule keeps the assignee as it was
insert into t.aa select 'o2', t.neworder('colour_grading');
do $$ begin perform set_config('app.via_fn', '1', true); update orders set stage = 'admin_approval' where id = (select v from t.aa where k = 'o2'); perform set_config('app.via_fn', '', true); end $$;
select t.eq($$select (assignee = (select v from t.aa where k = 'colour'))::text from orders where id = (select v from t.aa where k = 'o2')$$, 'true', 'auto-assign: no rule for this stage — the assignee stays');

-- a specific person for Designing; a person from another department is ignored
update settings set value = jsonb_build_object('designing', jsonb_build_object('mode', 'person', 'person', (select v from t.aa where k = 'designer'))) where key = 'auto_assign';
do $$ begin perform set_config('app.via_fn', '1', true); update orders set stage = 'designing' where id = (select v from t.aa where k = 'o2'); perform set_config('app.via_fn', '', true); end $$;
select t.eq($$select (assignee = (select v from t.aa where k = 'designer'))::text from orders where id = (select v from t.aa where k = 'o2')$$, 'true', 'auto-assign: a specific person for Designing');
update settings set value = jsonb_build_object('designing', jsonb_build_object('mode', 'person', 'person', (select v from t.aa where k = 'colour'))) where key = 'auto_assign';
select t.eq($$select coalesce(auto_assign_pick('designing')::text, 'none')$$, 'none', 'auto-assign: a person outside the department is not picked');
update profiles set active = false where id = (select v from t.aa where k = 'designer');
update settings set value = jsonb_build_object('designing', jsonb_build_object('mode', 'person', 'person', (select v from t.aa where k = 'designer'))) where key = 'auto_assign';
select t.eq($$select coalesce(auto_assign_pick('designing')::text, 'none')$$, 'none', 'auto-assign: an inactive person is not picked');
update profiles set active = true where id = (select v from t.aa where k = 'designer');

-- a non-admin moving the order still gets the auto-assignment (the rule runs on the server)
update settings set value = '{"colour_grading": {"mode": "least_busy"}}' where key = 'auto_assign';
select t.as('reception');
select set_config('t.rec_order', t.neworder('colour_grading')::text, false);
select t.as('system');
select t.eq($$select (assignee = (select v from t.aa where k = 'colour'))::text from orders where id = current_setting('t.rec_order')::uuid$$, 'true', 'auto-assign: works whoever moves the order');
update settings set value = '{}' where key = 'auto_assign';

-- stage history for the process tracker (0048)
select t.as('designer');
select t.eq($$select string_agg(stage, '>' order by at) from order_stage_history((select v from t.aa where k = 'o2'))$$, 'new_order>colour_grading>admin_approval>designing', 'history: any staff member sees an order''s stage moves');
select t.as('system');
select set_config('t.any_order', (select id::text from orders limit 1), false);
reset role; set role anon;
do $$ begin perform order_stage_history(current_setting('t.any_order')::uuid); raise exception 'FAIL history: anon could read the stage history';
  exception when insufficient_privilege then raise notice 'ok - history: nothing without signing in'; end $$;
reset role;

-- uploads are optional unless the admin requires them (0050)
reset role;
update settings set value = value || '{"wf_require_uploads": false}' where key = 'workflow';
select set_config('t.up_order', t.neworder('colour_grading')::text, false);
insert into tasks(order_id, kind, assignee) values (current_setting('t.up_order')::uuid, 'grading', (select v from t.aa where k = 'colour'))
  on conflict do nothing;
update tasks set assignee = (select v from t.aa where k = 'colour') where order_id = current_setting('t.up_order')::uuid and kind = 'grading';
select t.as('colour');
select t.ok($$update tasks set status = 'in_progress' where kind = 'grading' and order_id = current_setting('t.up_order')::uuid$$, 'uploads optional: grader starts');
select t.ok($$update tasks set status = 'submitted' where kind = 'grading' and order_id = current_setting('t.up_order')::uuid$$, 'uploads optional: grader submits without a graded file');
reset role;
update settings set value = value || '{"wf_require_uploads": true}' where key = 'workflow';
select t.eq($$select uploads_required()::text$$, 'true', 'uploads required: the switch is read');
update settings set value = value || '{"wf_require_uploads": false}' where key = 'workflow';

-- deleting an order (0051)
select t.as('system');
select set_config('t.del', t.neworder('colour_grading')::text, false);
insert into tasks(order_id, kind, assignee) values (current_setting('t.del')::uuid, 'grading', (select v from t.aa where k = 'colour')) on conflict do nothing;
insert into production_events(order_id, area, text) values (current_setting('t.del')::uuid, 'grading', 'Grading started');
insert into order_files(order_id, category, file_name, ext, size_bytes, storage_path) select id, 'graded', 'g.zip', 'zip', 10, code || '/graded/g.zip-v1' from orders where id = current_setting('t.del')::uuid;
insert into proofs(order_id, version, token_hash, expires_at, status) values (current_setting('t.del')::uuid, 1, repeat('b', 64), now() + interval '7 days', 'sent');
insert into invoices(order_id, customer_id, kind, due_date, number) select id, customer_id, 'invoice', current_date + 7, 'INV-DEL-T' from orders where id = current_setting('t.del')::uuid;
update invoices set status = 'sent' where order_id = current_setting('t.del')::uuid;
insert into proof_comments(proof_id, page, text) select id, 1, 'nice' from proofs where order_id = current_setting('t.del')::uuid;
select set_config('t.delcode', (select code from orders where id = current_setting('t.del')::uuid), false);
select t.as('reception');
select t.err($$select delete_order(current_setting('t.del')::uuid, 'test order')$$, 'delete: only an admin', 'only an admin');
select t.as('admin');
select t.err($$select delete_order(current_setting('t.del')::uuid, ' ')$$, 'delete: a reason is required', 'reason is required');
select t.eq($$select string_agg(p, ',') from delete_order(current_setting('t.del')::uuid, 'created by mistake') p$$, current_setting('t.delcode') || '/graded/g.zip-v1', 'delete: returns the stored files to remove');
reset role;
select t.eq($$select (select count(*) from orders where id = current_setting('t.del')::uuid) + (select count(*) from tasks where order_id = current_setting('t.del')::uuid)
  + (select count(*) from order_files where order_id = current_setting('t.del')::uuid) + (select count(*) from proofs where order_id = current_setting('t.del')::uuid)
  + (select count(*) from production_events where order_id = current_setting('t.del')::uuid)$$, '0', 'delete: the order and everything under it is gone');
select t.eq($$select reason from audit_log where entity = 'orders' and entity_id = current_setting('t.del') and action = 'delete'$$, 'Order deleted: created by mistake', 'delete: the audit log keeps the snapshot and the reason');
select t.as('system');
-- an order with a payment is refused
select set_config('t.del2', t.neworder('files_received')::text, false);
insert into payments(order_id, amount, mode, reference) values (current_setting('t.del2')::uuid, 100, 'upi', 'UTRDEL');
select t.as('admin');
select t.err($$select delete_order(current_setting('t.del2')::uuid, 'test')$$, 'delete: refused when payments are recorded', 'recorded payments');
select t.as('system');
select t.eq($$select count(*)::text from orders where id = current_setting('t.del2')::uuid$$, '1', 'delete: the paid order is still there');
-- the guards still protect records outside delete_order
select t.eq($$select deleting_order()::text$$, 'false', 'delete: the bypass flag is off afterwards');

-- check in before working (0052)
select t.as('system');
update settings set value = value || '{"wf_require_checkin": true}' where key = 'workflow';
select set_config('t.duty', t.neworder('colour_grading')::text, false);
insert into tasks(order_id, kind, assignee) values (current_setting('t.duty')::uuid, 'grading', (select v from t.aa where k = 'colour')) on conflict do nothing;
update tasks set assignee = (select v from t.aa where k = 'colour') where order_id = current_setting('t.duty')::uuid and kind = 'grading';
delete from attendance_events where user_id = (select v from t.aa where k = 'colour');
select t.as('colour');
select t.eq($$select on_duty()::text$$, 'false', 'duty: not checked in yet');
select t.err($$update tasks set status = 'in_progress' where kind = 'grading' and order_id = current_setting('t.duty')::uuid$$, 'duty: a grader who has not checked in cannot start a job', 'check in first');
select t.ok($$select attendance_punch('check_in')$$, 'duty: the grader checks in');
select t.ok($$update tasks set status = 'in_progress' where kind = 'grading' and order_id = current_setting('t.duty')::uuid$$, 'duty: checked in, the job starts');
select t.ok($$select attendance_punch('break_start')$$, 'duty: break');
select t.err($$update tasks set internal_note = 'x' where kind = 'grading' and order_id = current_setting('t.duty')::uuid$$, 'duty: on a break, work is paused', 'on a break');
select t.ok($$select attendance_punch('break_end')$$, 'duty: back from the break');
select t.ok($$update tasks set internal_note = 'y' where kind = 'grading' and order_id = current_setting('t.duty')::uuid$$, 'duty: working again');
select t.ok($$select attendance_punch('check_out')$$, 'duty: checks out');
select t.err($$update tasks set internal_note = 'z' where kind = 'grading' and order_id = current_setting('t.duty')::uuid$$, 'duty: checked out, no more work', 'checked out for today');
select t.as('admin');
select t.eq($$select on_duty()::text$$, 'true', 'duty: admins are never blocked');
select t.as('system');
update settings set value = value || '{"wf_require_checkin": false}' where key = 'workflow';
select t.as('colour');
select t.ok($$update tasks set internal_note = 'off' where kind = 'grading' and order_id = current_setting('t.duty')::uuid$$, 'duty: with the rule off, anyone can work');
select t.as('system');
select t.eq($$select 'ok'$$, 'ok', 'auto-assign done');
\echo AUTO ASSIGN TESTS PASSED
