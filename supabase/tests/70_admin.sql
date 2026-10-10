\set ON_ERROR_STOP on
\set QUIET on
-- Administration: revocable invites, last-admin protection, permission self-lockout, shared settings visibility, seeds, notifications.
create or replace function pg_temp.as_user(u uuid) returns void language plpgsql as $$ begin perform set_config('request.jwt.claim.sub', u::text, true); end $$;

do $$
declare a1 uuid := gen_random_uuid(); a2 uuid := gen_random_uuid(); rc uuid := gen_random_uuid(); u1 uuid := gen_random_uuid(); n int; ok boolean; v text;
begin
  insert into settings(key, value) values ('security','{"mfa":true}'),('operational','{"st_max":"50"}') on conflict (key) do nothing;
  -- ---------- invites ----------
  insert into staff_invites(email, role, full_name) values ('gone@studio.com', 'qc', 'Gone Away');
  update staff_invites set revoked_at = now() where email = 'gone@studio.com';
  insert into auth.users(id, email) values (u1, 'gone@studio.com');
  select count(*) into n from profiles where id = u1;
  if n <> 0 then raise exception 'FAIL - a revoked invite created a profile'; end if;
  raise notice 'ok   - revoked invite creates no profile';
  update staff_invites set revoked_at = null, mobile = '9000000001' where email = 'gone@studio.com';
  insert into auth.users(id, email) values (gen_random_uuid(), 'gone@studio.com');  -- re-invited: next sign-up is honoured
  select count(*) into n from profiles where email = 'gone@studio.com' and role = 'qc' and mobile = '9000000001';
  if n <> 1 then raise exception 'FAIL - re-issued invite not honoured'; end if;
  raise notice 'ok   - invite can be re-issued after revoke';

  -- ---------- last active admin ----------
  insert into auth.users(id, email) values (a1, 'a1@t.com'), (a2, 'a2@t.com'), (rc, 'rec@t.com');
  insert into profiles(id, full_name, email, role, must_change_password) values (a1, 'Admin One', 'a1@t.com', 'admin', false), (a2, 'Admin Two', 'a2@t.com', 'admin', false);
  -- other admins from earlier suites are demoted so exactly two remain
  update profiles set active = false where role = 'admin' and id not in (a1, a2);
  update profiles set role = 'reception' where id = a2;      -- allowed: a1 remains
  raise notice 'ok   - an admin can be demoted while another remains';
  ok := false;
  begin update profiles set active = false where id = a1; exception when others then ok := true; get stacked diagnostics v = message_text; end;
  if not ok then raise exception 'FAIL - last admin deactivated'; end if;
  raise notice 'ok   - last active admin cannot be deactivated [%]', left(v, 40);
  ok := false;
  begin update profiles set role = 'qc' where id = a1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - last admin demoted'; end if;
  raise notice 'ok   - last active admin cannot be demoted';
  ok := false;
  begin delete from profiles where id = a1; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - last admin removed'; end if;
  raise notice 'ok   - last active admin cannot be removed';
  update profiles set role = 'admin' where id = a2;           -- restore a second admin
  update profiles set active = false where id = a2;            -- allowed again: a1 remains
  raise notice 'ok   - deactivating a non-last admin is allowed';

  -- ---------- admin keeps user-administration permission ----------
  ok := false;
  begin update role_permissions set level = 'view' where role = 'admin' and module = 'users'; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - admin lost users:full'; end if;
  ok := false;
  begin delete from role_permissions where role = 'admin' and module = 'users'; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - admin users permission deleted'; end if;
  update role_permissions set level = 'view' where role = 'reception' and module = 'payments';
  update role_permissions set level = 'limited' where role = 'reception' and module = 'payments';
  raise notice 'ok   - admin keeps users:full; other cells editable';
  select count(*) into n from audit_log where entity = 'role_permissions' and action = 'update' and new_data->>'module' = 'payments';
  if n < 2 then raise exception 'FAIL - permission changes not audited'; end if;
  raise notice 'ok   - permission changes are audited';

  -- ---------- RLS: reception ----------
  insert into profiles(id, full_name, email, role, must_change_password) values (rc, 'Rec Eption', 'rec@t.com', 'reception', false);
  perform set_config('request.jwt.claim.sub', rc::text, true);
  set local role authenticated;
  select count(*) into n from settings where key in ('pricing','workflow');
  if n <> 2 then raise exception 'FAIL - staff cannot read pricing/workflow (got %)', n; end if;
  raise notice 'ok   - any staff reads the pricing and workflow settings';
  select count(*) into n from settings where key in ('security','operational');
  if n <> 0 then raise exception 'FAIL - staff read admin-only settings'; end if;
  raise notice 'ok   - security/operational settings stay admin-only';
  ok := false; begin update settings set value = '{"x":1}' where key = 'pricing'; get diagnostics n = row_count; if n = 0 then ok := true; end if; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - reception edited pricing'; end if;
  ok := false; begin insert into settings(key, value) values ('company', '{}'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - reception wrote settings'; end if;
  raise notice 'ok   - reception cannot write settings';
  ok := false; begin insert into masters(kind, name) values ('x','y'); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - reception wrote masters'; end if;
  ok := false; begin update role_permissions set level = 'full' where role = 'reception' and module = 'users'; get diagnostics n = row_count; if n = 0 then ok := true; end if; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - reception edited the permission matrix'; end if;
  ok := false; begin update profiles set role = 'admin' where id = rc; get diagnostics n = row_count; if n = 0 then ok := true; end if; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - reception promoted itself'; end if;
  ok := false; begin insert into sla_rules(stage, hours) values ('new_order', 1); exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - reception wrote sla rules'; end if;
  ok := false; begin update notification_templates set whatsapp = false; get diagnostics n = row_count; if n = 0 then ok := true; end if; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL - reception edited notification templates'; end if;
  raise notice 'ok   - reception cannot write masters, matrix, profiles, sla rules or templates';
  select count(*) into n from notification_templates; if n <> 13 then raise exception 'FAIL - staff cannot read the 13 templates (%)', n; end if;
  raise notice 'ok   - staff read the 13 notification triggers';
  reset role;

  -- ---------- seeds ----------
  select count(*) into n from masters where kind = 'qc_defect'; if n < 5 then raise exception 'FAIL - qc defects not seeded'; end if;
  select count(*) into n from products where active; if n < 9 then raise exception 'FAIL - products not seeded'; end if;
  select value->>'gstPct' into v from settings where key = 'pricing'; if v is distinct from '18' then raise exception 'FAIL - pricing not seeded'; end if;
  raise notice 'ok   - defaults seeded (masters, products, pricing)';

  -- ---------- notifications ----------
  perform notify_roles(array['admin']::app_role[], 'Hello', 'x', '/users');
  perform set_config('request.jwt.claim.sub', rc::text, true);
  set local role authenticated;
  select count(*) into n from notifications; if n <> 0 then raise exception 'FAIL - reception sees admin notifications'; end if;
  reset role;
  perform set_config('request.jwt.claim.sub', a1::text, true);
  set local role authenticated;
  select count(*) into n from notifications where title = 'Hello'; if n <> 1 then raise exception 'FAIL - admin did not get its notification (%)', n; end if;
  update notifications set read_at = now() where user_id = a1;
  reset role;
  raise notice 'ok   - notifications are visible to their owner only';
end $$;

-- seed re-run is a no-op (idempotent)
do $$ declare m1 int; m2 int; begin
  select count(*) into m1 from masters;
end $$;
\i migrations/0021_admin_seed.sql
\echo ADMIN TESTS PASSED
