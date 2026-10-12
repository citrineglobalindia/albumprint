\set ON_ERROR_STOP on
\set QUIET on
-- Two-step login enforcement (0032). Reuses the t.* harness.
reset role;
create function t.as_aal(r text, aal text) returns void language plpgsql as $$
declare uid text;
begin
  reset role;
  select id::text into uid from t.users where role = r::app_role;
  perform set_config('request.jwt.claim.sub', uid, false);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'aal', aal)::text, false);
  set role authenticated;
end $$;
grant execute on function t.as_aal(text, text) to authenticated;
select t.as('system');
update profiles set active = true where id = (select id from t.users where role = 'admin');
select t.eq($$select coalesce(current_app_role()::text, 'none')$$, 'none', 'mfa: no session context means no role');
select t.as_aal('reception', 'aal1');
select t.eq($$select current_app_role()::text$$, 'reception', 'mfa: a user without a factor works at aal1');
select t.as('system');
insert into auth.mfa_factors(user_id, status, friendly_name) select id, 'verified', 'phone' from t.users where role = 'reception';
select t.as_aal('reception', 'aal1');
select t.eq($$select coalesce(current_app_role()::text, 'none')$$, 'none', 'mfa: a verified factor + password-only session = no role');
select t.eq($$select count(*)::text from customers$$, '0', 'mfa: so the data is closed too');
select t.as_aal('reception', 'aal2');
select t.eq($$select current_app_role()::text$$, 'reception', 'mfa: after the code (aal2) the role is back');
select t.as('system');
insert into auth.mfa_factors(user_id, status, friendly_name) select id, 'unverified', 'half-finished enrolment' from t.users where role = 'designer';
select t.as_aal('designer', 'aal1');
select t.eq($$select current_app_role()::text$$, 'designer', 'mfa: an unverified (abandoned) enrolment does not lock anyone out');
select t.as_aal('reception', 'aal2');
select t.err($$select admin_reset_mfa((select id from t.users where role = 'reception'))$$, 'mfa: reception cannot reset two-step login', 'only an admin');
select t.as_aal('admin', 'aal1');
select t.eq($$select admin_reset_mfa((select id from t.users where role = 'reception'))::text$$, '1', 'mfa: admin resets the locked-out user');
select t.as_aal('reception', 'aal1');
select t.eq($$select current_app_role()::text$$, 'reception', 'mfa: the user can sign in again and re-enrol');
select t.as('system');
select t.eq($$select count(*)::text from audit_log where entity = 'mfa' and action = 'reset'$$, '1', 'mfa: the reset is audited');
\echo MFA TESTS PASSED
