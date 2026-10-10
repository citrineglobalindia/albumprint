\set ON_ERROR_STOP on
\set QUIET on
-- Invites: only invited emails become staff.
create schema if not exists t2;
insert into profiles(id, full_name, email, role, must_change_password) select gen_random_uuid(), 'x', 'inv-admin@t.com', 'admin', false from (select 1) s where false;
do $$
declare u1 uuid := gen_random_uuid(); u2 uuid := gen_random_uuid(); n int; r text;
begin
  insert into staff_invites(email, role, full_name, department) values ('boss@studio.com', 'admin', 'The Boss', 'Head Office');
  -- invited email becomes an admin profile
  insert into auth.users(id, email) values (u1, 'Boss@Studio.com');
  select role::text into r from profiles where id = u1;
  if r is distinct from 'admin' then raise exception 'FAIL - invited user did not get admin profile (got %)', r; end if;
  raise notice 'ok   - invited email gets its profile with the invited role';
  select count(*) into n from staff_invites where email = 'boss@studio.com';
  if n <> 0 then raise exception 'FAIL - invite not consumed'; end if;
  raise notice 'ok   - invite is consumed';
  -- uninvited email gets nothing
  insert into auth.users(id, email) values (u2, 'stranger@evil.com');
  select count(*) into n from profiles where id = u2;
  if n <> 0 then raise exception 'FAIL - uninvited user received a profile'; end if;
  raise notice 'ok   - uninvited email gets no profile (no access)';
end $$;
-- A non-admin cannot create invites
do $$
declare w uuid := gen_random_uuid(); ok boolean := false;
begin
  insert into auth.users(id, email) values (w, 'w@x.com'); insert into profiles(id, full_name, email, role, must_change_password) values (w, 'Worker', 'w@x.com', 'colour', false);
  perform set_config('request.jwt.claim.sub', w::text, true); set local role authenticated;
  begin insert into staff_invites(email, role) values ('mine@x.com', 'admin'); exception when others then ok := true; end;
  reset role;
  if not ok then raise exception 'FAIL - non-admin created an invite'; end if;
  raise notice 'ok   - non-admin cannot invite';
end $$;
\echo INVITE TESTS PASSED
