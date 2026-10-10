-- Masked customer directory as a function (the SECURITY DEFINER view was flagged by Supabase's linter).
-- The old view is kept but switched to security_invoker and closed to every API role: DROP VIEW hangs on the hosted
-- project (its event triggers), so it is retired rather than dropped. Safe to `drop view customers_safe` later.
create or replace function list_customers() returns table (
  id uuid, code text, studio_name text, contact_person text, segment text, active boolean, city text, state text, created_at timestamptz,
  mobile text, whatsapp text, email text, gstin text)
language sql stable security definer set search_path = public as $$
  select c.id, c.code, c.studio_name, c.contact_person, c.segment, c.active, c.city, c.state, c.created_at,
         case when has_perm('pii','view') then c.mobile   else mask_text(c.mobile, 3) end,
         case when has_perm('pii','view') then c.whatsapp else mask_text(c.whatsapp, 3) end,
         case when has_perm('pii','view') then c.email    else mask_text(c.email, 2) end,
         case when has_perm('pii','view') then c.gstin    else mask_text(c.gstin, 2) end
  from customers c where current_app_role() is not null
$$;
revoke execute on function list_customers() from public, anon;
grant  execute on function list_customers() to authenticated;

alter view customers_safe set (security_invoker = true);
revoke all on customers_safe from authenticated, anon, public;
