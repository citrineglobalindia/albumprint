-- Staff onboarding: an admin invites an email + role; when that person signs up (or is added in Supabase Auth),
-- a profile with that role is created automatically. Nobody gets a profile — and therefore no access — without an invite.
create table staff_invites (
  email text primary key check (email = lower(email)),
  role app_role not null,
  full_name text,
  department text,
  invited_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  used_at timestamptz                               -- set when the invited person signs up; kept for history
);
alter table staff_invites enable row level security;
revoke all on staff_invites from anon, public;
grant select, insert, update, delete on staff_invites to authenticated;
create policy invites_admin on staff_invites for all to authenticated
  using (has_perm('users','write')) with check (has_perm('users','write'));

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare i staff_invites;
begin
  select * into i from staff_invites where email = lower(new.email) and used_at is null;
  if found then
    insert into profiles(id, full_name, email, role, department, must_change_password)
    values (new.id, coalesce(nullif(i.full_name, ''), split_part(new.email, '@', 1)), lower(new.email), i.role, i.department, false)
    on conflict (id) do nothing;
    update staff_invites set used_at = now() where email = i.email;
  end if;
  return new;
end $$;
revoke execute on function handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users for each row execute function handle_new_user();
