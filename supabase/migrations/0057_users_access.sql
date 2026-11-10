-- Users: the admin creates a login with a password (ready to use, no e-mail confirmation), resets passwords,
-- and gives a user extra modules on top of their role (e.g. a designer who also handles Printing and Delivery).
-- Extra modules grant view + work access (not approvals); the database honours them everywhere has_perm is checked.

create table if not exists user_modules (
  user_id uuid not null references profiles(id) on delete cascade,
  module text not null check (module in ('order', 'customer', 'grading', 'design', 'printing', 'qc', 'delivery', 'payments', 'invoices', 'reports')),
  granted_by uuid references profiles(id) default auth.uid(),
  granted_at timestamptz not null default now(),
  primary key (user_id, module)
);
alter table user_modules enable row level security;
drop policy if exists user_modules_read on user_modules; drop policy if exists user_modules_write on user_modules;
create policy user_modules_read on user_modules for select to authenticated using (user_id = auth.uid() or current_app_role() = 'admin');
create policy user_modules_write on user_modules for all to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
grant select, insert, update, delete on user_modules to authenticated;
drop trigger if exists user_modules_audit on user_modules;
create trigger user_modules_audit after insert or update or delete on user_modules for each row execute function audit_row();

-- role permissions, plus the user's own extra modules (view and write; approvals stay with the role)
create or replace function has_perm(p_module text, p_need text default 'view') returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_need
      when 'view'    then rp.level <> 'none'
      when 'write'   then rp.level in ('limited','update','work','create_edit','full')
      when 'approve' then rp.level in ('approve','full')
      else false end
    from role_permissions rp where rp.role = current_app_role() and rp.module = p_module), false)
  or (p_need in ('view', 'write') and exists (
    select 1 from user_modules um join profiles p on p.id = um.user_id and p.active
    where um.user_id = auth.uid() and (um.module = p_module or (um.module = 'customer' and p_module = 'pii' and p_need = 'view'))))
$$;

-- the admin creates a ready-to-use login
create or replace function admin_create_user(p_email text, p_password text, p_name text, p_role app_role, p_department text default null, p_mobile text default null, p_must_change boolean default true)
returns uuid language plpgsql security definer set search_path = public, extensions, auth as $$
declare uid uuid := gen_random_uuid(); em text := lower(btrim(coalesce(p_email, ''))); c text;
begin
  if current_app_role() is distinct from 'admin' then raise exception 'only an admin creates users' using errcode = '42501'; end if;
  if em !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'enter a valid email' using errcode = '22023'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'the password must be at least 8 characters' using errcode = '22023'; end if;
  if char_length(btrim(coalesce(p_name, ''))) < 2 then raise exception 'enter the full name' using errcode = '22023'; end if;
  if exists (select 1 from auth.users where lower(email) = em) then raise exception 'a login with this email already exists' using errcode = '23505'; end if;
  -- the invite row tells handle_new_user which role and name to give the profile
  insert into staff_invites(email, role, full_name, department, mobile, invited_by)
    values (em, p_role, btrim(p_name), nullif(btrim(coalesce(p_department, '')), ''), nullif(btrim(coalesce(p_mobile, '')), ''), auth.uid())
    on conflict (email) do update set role = excluded.role, full_name = excluded.full_name, department = excluded.department, mobile = excluded.mobile,
      invited_by = excluded.invited_by, used_at = null, revoked_at = null, created_at = now();
  execute 'insert into auth.users(id, email, encrypted_password) values ($1, $2, crypt($3, gen_salt(''bf'')))' using uid, em, p_password;
  -- what Supabase Auth needs to accept the login (only the columns this database has)
  foreach c in array array['instance_id', 'aud', 'role', 'email_confirmed_at', 'raw_app_meta_data', 'raw_user_meta_data', 'created_at', 'updated_at',
                           'confirmation_token', 'recovery_token', 'email_change_token_new', 'email_change', 'email_change_token_current', 'phone_change', 'phone_change_token', 'reauthentication_token'] loop
    if exists (select 1 from information_schema.columns where table_schema = 'auth' and table_name = 'users' and column_name = c) then
      execute format('update auth.users set %I = %s where id = $1', c, case c
        when 'instance_id' then '''00000000-0000-0000-0000-000000000000''::uuid'
        when 'aud' then '''authenticated''' when 'role' then '''authenticated'''
        when 'email_confirmed_at' then 'now()' when 'updated_at' then 'now()' when 'created_at' then 'now()'
        when 'raw_app_meta_data' then '''{"provider":"email","providers":["email"]}''::jsonb'
        when 'raw_user_meta_data' then 'jsonb_build_object(''full_name'', ' || quote_literal(btrim(p_name)) || ')'
        else '''''' end) using uid;
    end if;
  end loop;
  if to_regclass('auth.identities') is not null then
    execute 'insert into auth.identities(user_id, provider, provider_id, identity_data, created_at, updated_at) values ($1, ''email'', $1::text, jsonb_build_object(''sub'', $1::text, ''email'', $2, ''email_verified'', true), now(), now())' using uid, em;
  end if;
  update profiles set must_change_password = coalesce(p_must_change, true) where id = uid;
  if not found then raise exception 'the profile was not created' using errcode = 'P0001'; end if;
  return uid;
end $$;
revoke execute on function admin_create_user(text, text, text, app_role, text, text, boolean) from public, anon;
grant execute on function admin_create_user(text, text, text, app_role, text, text, boolean) to authenticated;

-- the admin sets a new password (the user is asked to change it at the next sign-in when p_must_change)
create or replace function admin_set_password(p_user uuid, p_password text, p_must_change boolean default true) returns void
language plpgsql security definer set search_path = public, extensions, auth as $$
begin
  if current_app_role() is distinct from 'admin' then raise exception 'only an admin sets passwords' using errcode = '42501'; end if;
  if length(coalesce(p_password, '')) < 8 then raise exception 'the password must be at least 8 characters' using errcode = '22023'; end if;
  update auth.users set encrypted_password = crypt(p_password, gen_salt('bf')) where id = p_user;
  if not found then raise exception 'user not found' using errcode = 'P0002'; end if;
  update profiles set must_change_password = coalesce(p_must_change, true) where id = p_user;
end $$;
revoke execute on function admin_set_password(uuid, text, boolean) from public, anon;
grant execute on function admin_set_password(uuid, text, boolean) to authenticated;
