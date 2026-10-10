-- AlbumPro — administration: invites that can be revoked, last-admin / self-lockout protection, shared settings readable by staff,
-- stable references for masters so the Masters screen can sync rows. Re-runnable (IF NOT EXISTS / OR REPLACE); no destructive statements.

-- ───────── staff invites: soft revoke + resend tracking ─────────
alter table staff_invites add column if not exists revoked_at timestamptz;          -- set by an admin; a revoked invite never creates a profile
alter table staff_invites add column if not exists last_sent_at timestamptz not null default now();
alter table staff_invites add column if not exists resend_count int not null default 0;
alter table staff_invites add column if not exists mobile text;

create or replace function handle_new_user() returns trigger language plpgsql security definer set search_path = public as $$
declare i staff_invites;
begin
  select * into i from staff_invites where email = lower(new.email) and used_at is null and revoked_at is null;
  if found then
    insert into profiles(id, full_name, email, role, department, mobile, must_change_password)
    values (new.id, coalesce(nullif(i.full_name, ''), split_part(new.email, '@', 1)), lower(new.email), i.role, i.department, i.mobile, false)
    on conflict (id) do nothing;
    update staff_invites set used_at = now() where email = i.email;
  end if;
  return new;
end $$;
revoke execute on function handle_new_user() from public, anon, authenticated;

-- ───────── never lose the last active admin ─────────
create or replace function profiles_keep_an_admin() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.role = 'admin' and old.active and (tg_op = 'DELETE' or new.role <> 'admin' or not new.active) then
    perform pg_advisory_xact_lock(7020);                                                -- serialise concurrent demotions
    if not exists (select 1 from profiles where role = 'admin' and active and id <> old.id) then
      raise exception 'at least one active admin must remain: the last admin cannot be deactivated, demoted or removed' using errcode = 'P0001';
    end if;
  end if;
  return coalesce(new, old);
end $$;
create trigger profiles_keep_an_admin_t before update or delete on profiles for each row execute function profiles_keep_an_admin();

-- the admin role can always administer users (otherwise nobody could ever fix the matrix again)
create or replace function perms_keep_admin_access() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.role = 'admin' and old.module = 'users' then raise exception 'the admin role must keep full access to user administration' using errcode = 'P0001'; end if;
    return old;
  end if;
  if new.role = 'admin' and new.module = 'users' and new.level <> 'full' then raise exception 'the admin role must keep full access to user administration' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger perms_keep_admin_access_t before insert or update or delete on role_permissions for each row execute function perms_keep_admin_access();

-- ───────── masters / products: stable client references + soft archive ─────────
alter table masters  add column if not exists ref text;
alter table masters  add column if not exists archived boolean not null default false;
alter table products add column if not exists archived boolean not null default false;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'masters_kind_ref_key') then alter table masters add constraint masters_kind_ref_key unique (kind, ref); end if;
end $$;

-- ───────── settings: stamp the editor; staff can read the non-secret operational sections ─────────
create or replace function settings_stamp() returns trigger language plpgsql as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
create trigger settings_stamp_t before insert or update on settings for each row execute function settings_stamp();

-- pricing/workflow drive the order wizard, invoices and the SLA clock for every role; company/invoice/payment/notification hold no secrets.
-- 'security' and 'operational' stay admin-only (policy settings_read needs users:view).
create policy settings_read_staff on settings for select to authenticated
  using (current_app_role() is not null and key in ('pricing','workflow','company','invoice','payment','notification'));

-- audit the admin tables with a readable key (audit_row only knew `id`)
create or replace function audit_admin_row() returns trigger language plpgsql security definer set search_path = public as $$
declare j jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log(actor, actor_role, entity, entity_id, action, old_data, new_data, reason)
  values (auth.uid(), current_app_role(), tg_table_name,
          coalesce(j->>'id', j->>'key', j->>'stage', j->>'email', j->>'sku', (j->>'role') || '/' || (j->>'module')), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end, nullif(current_setting('app.reason', true), ''));
  return coalesce(new, old);
end $$;
create trigger staff_invites_audit after insert or update or delete on staff_invites for each row execute function audit_admin_row();
create trigger sla_rules_audit     after  insert or update or delete on sla_rules     for each row execute function audit_admin_row();
create trigger products_audit      after  insert or update or delete on products      for each row execute function audit_admin_row();
