-- Delete an order permanently (admin only). For test or mistaken orders; a real order is normally cancelled, which keeps its history.
-- Refused when payments are recorded (payments are immutable: record a refund and cancel instead).
-- Everything that belongs to the order goes with it: albums, items, pricing, jobs, proofs, files, invoices, deliveries, QC.
-- The audit log keeps a snapshot of every deleted row (audit_row triggers), with the reason.

create or replace function deleting_order() returns boolean language sql stable as $$ select coalesce(current_setting('app.deleting_order', true), '') = '1' $$;

-- the guards that protect an order's records step aside only while delete_order runs
CREATE OR REPLACE FUNCTION public.album_line_costs_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare oid uuid;
begin
  if tg_op = 'DELETE' and deleting_order() then return old; end if;   -- delete_order (0051) removes the whole order
  select order_id into oid from album_lines where id = coalesce(new.line_id, old.line_id);
  if oid is not null and costing_locked(oid) then raise exception 'the costing is finalized: reopen it to change the lines' using errcode = '23514'; end if;
  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION public.album_lines_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare oid uuid := coalesce(new.order_id, old.order_id);
begin
  if tg_op = 'DELETE' and deleting_order() then return old; end if;   -- delete_order (0051) removes the whole order
  if costing_locked(oid) then raise exception 'the costing is finalized: reopen it to change the lines' using errcode = '23514'; end if;
  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION public.invoice_lines_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare s text; k text;
begin
  if tg_op = 'DELETE' and deleting_order() then return old; end if;   -- delete_order (0051) removes the whole order
  select status, kind into s, k from invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if k = 'invoice' and s <> 'draft' then raise exception 'lines can only change while the invoice is a draft'; end if;
  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION public.order_drafts_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' and deleting_order() then return old; end if;   -- delete_order (0051) removes the whole order
  new.updated_at := now();
  if tg_op = 'UPDATE' and old.result is not null and (new.payload is distinct from old.payload) then raise exception 'this draft is already finalized' using errcode = '23514'; end if;
  if tg_op = 'DELETE' then
    if old.result is not null then raise exception 'a finalized draft is part of the order record' using errcode = '23514'; end if;
    return old;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.guard_child_of_closed()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare s stage_key; oid uuid := (to_jsonb(coalesce(new, old))->>'order_id')::uuid;
begin
  if tg_op = 'DELETE' and deleting_order() then return old; end if;   -- delete_order (0051) removes the whole order
  select stage into s from orders where id = oid;
  if s = 'closed' then raise exception 'order is closed; % blocked', tg_op using errcode = '23514'; end if;
  return coalesce(new, old);
end $function$;

CREATE OR REPLACE FUNCTION public.file_lock_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
  if tg_op = 'DELETE' and deleting_order() then return old; end if;   -- delete_order (0051) removes the whole order
  if tg_op = 'DELETE' then
    if old.state = 'locked' then raise exception 'locked file cannot be deleted; archive it instead'; end if;
    return old;
  end if;
  if old.state = 'locked' and (new.state <> 'locked' or new.storage_path <> old.storage_path or new.checksum is distinct from old.checksum
        or new.file_name <> old.file_name or new.size_bytes <> old.size_bytes) then
    raise exception 'locked file is immutable' using errcode = '23514';
  end if;
  return new;
end $function$;

create or replace function delete_order(p_order uuid, p_reason text) returns table(storage_path text)
language plpgsql security definer set search_path = public as $$
declare o orders; paths text[];
begin
  if current_app_role() is distinct from 'admin' then raise exception 'only an admin can delete an order' using errcode = '42501'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'a reason is required to delete an order' using errcode = '23514'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if exists (select 1 from payments where order_id = o.id or invoice_id in (select id from invoices where order_id = o.id)) then
    raise exception '% has recorded payments and cannot be deleted: record a refund and cancel the order instead', o.code using errcode = '23514';
  end if;
  select coalesce(array_agg(f.storage_path) filter (where f.storage_path is not null), '{}') into paths from order_files f where f.order_id = o.id;

  perform set_config('app.reason', 'Order deleted: ' || btrim(p_reason), true);
  perform set_config('app.deleting_order', '1', true);
  perform set_config('app.via_fn', '1', true);
  delete from proof_comments where proof_id in (select id from proofs where order_id = o.id);
  delete from proofs where order_id = o.id;
  delete from design_corrections where order_id = o.id;
  delete from design_docs where order_id = o.id;
  delete from corrections where order_id = o.id;
  delete from comm_log where order_id = o.id;
  delete from deliveries where order_id = o.id;
  delete from print_exceptions where order_id = o.id;
  delete from print_stage_log where order_id = o.id;
  delete from print_vendor_jobs where order_id = o.id;
  delete from print_jobs where order_id = o.id;
  delete from qc_inspections where order_id = o.id;
  delete from rework_tasks where order_id = o.id;
  delete from production_events where order_id = o.id;
  delete from tasks where order_id = o.id;
  delete from order_files where order_id = o.id;
  delete from order_drafts where order_id = o.id;
  update order_pricing set invoice_id = null where order_id = o.id;
  delete from invoices where ref_invoice_id in (select id from invoices where order_id = o.id);   -- credit notes against its invoices
  delete from invoices where order_id = o.id;
  delete from orders where id = o.id;                                    -- albums, items, specs, pricing, costing cascade
  perform set_config('app.deleting_order', '', true);
  perform set_config('app.via_fn', '', true);
  return query select unnest(paths);
end $$;
revoke execute on function delete_order(uuid, text) from public, anon;
grant execute on function delete_order(uuid, text) to authenticated;
revoke execute on function deleting_order() from public, anon;
grant execute on function deleting_order() to authenticated;

-- the stored files of a deleted order: an admin may remove them from Storage
drop policy if exists order_files_delete on storage.objects;
create policy order_files_delete on storage.objects for delete to authenticated using (bucket_id = 'order-files' and current_app_role() = 'admin');
