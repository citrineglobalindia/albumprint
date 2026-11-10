-- delete_order (0051) on an order with finalized pricing: the pricing record is cleared with the order, so its guard (only an authorized
-- reopen may change finalized pricing) steps aside while delete_order runs.
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
  perform set_config('app.pricing_fn', '1', true);                       -- the finalized pricing goes with the order (its guard steps aside)
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
  perform set_config('app.pricing_fn', '', true);
  return query select unnest(paths);
end $$;
