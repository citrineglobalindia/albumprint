-- Two-step login (TOTP) that cannot be bypassed: once a user has a VERIFIED authenticator factor, a password-only session (aal1) is treated as
-- having no role at all, so every row-level-security policy (they all start from current_app_role / has_perm) refuses it until the code is entered (aal2).
create or replace function current_app_role() returns app_role language sql stable security definer set search_path = public as $$
  select p.role from profiles p
  where p.id = auth.uid() and p.active
    and (coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
         or not exists (select 1 from auth.mfa_factors f where f.user_id = p.id and f.status = 'verified'))
$$;

-- An admin can switch off a locked-out user's second step (lost phone). The factor is kept but made unverified; the user enrols again at next sign-in.
create or replace function admin_reset_mfa(p_user uuid) returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if current_app_role() <> 'admin' then raise exception 'only an admin can reset two-step login' using errcode = '42501'; end if;
  update auth.mfa_factors set status = 'unverified' where user_id = p_user and status = 'verified';
  get diagnostics n = row_count;
  insert into audit_log(actor, actor_role, entity, entity_id, action, reason, new_data)
    values (auth.uid(), 'admin', 'mfa', p_user::text, 'reset', 'two-step login reset by an admin', jsonb_build_object('factors_reset', n));
  return n;
end $$;
revoke execute on function admin_reset_mfa(uuid) from public, anon;
grant execute on function admin_reset_mfa(uuid) to authenticated;
