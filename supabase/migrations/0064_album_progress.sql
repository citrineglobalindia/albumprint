-- Per-album progress: an order with several albums (e.g. Engagement, Haldi, Mehandi) keeps a count and status per album and department
-- (photos graded, sheets designed, printing / QC / delivery status). The order still moves through its stages as one.
-- job_progress.album: 0 = the whole order (as before), 1.. = the album at that position on the order.
alter table job_progress add column if not exists album int not null default 0 check (album >= 0);
alter table job_progress drop constraint if exists job_progress_pkey;
alter table job_progress add constraint job_progress_pkey primary key (order_id, album, dept);

-- Prepare invoice (0062): each album's sheets come from that album's "Sheets designed" when not entered yet;
-- a one-album order still falls back to the order's own count.
create or replace function prepare_order_invoice(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare op order_pricing; d uuid; pay jsonb; n int; k int; cnt int;
begin
  if current_app_role() is null or current_app_role() not in ('admin', 'reception') or not has_perm('order', 'write') then raise exception 'only reception or an admin prepares invoices' using errcode = '42501'; end if;
  select * into op from order_pricing where order_id = p_order for update;
  if not found or op.status <> 'invoice_pending' then raise exception 'this order has no invoice to prepare' using errcode = '23514'; end if;
  select id into d from order_drafts where result is null and payload->>'reopenOrder' = p_order::text order by updated_at desc limit 1;
  if d is not null then return d; end if;                                                -- already being prepared: continue it
  pay := op.payload - 'invoiceLater';
  n := jsonb_array_length(coalesce(pay->'albums', '[]'::jsonb));
  for k in 1..n loop
    if coalesce(pay->'albums'->(k-1)->>'sheets', '') ~ '^[1-9]\d*$' then continue; end if;
    select count into cnt from job_progress where order_id = p_order and dept = 'design' and album = k;
    if coalesce(cnt, 0) = 0 and n = 1 then select count into cnt from job_progress where order_id = p_order and dept = 'design' and album = 0; end if;
    if coalesce(cnt, 0) > 0 then pay := jsonb_set(pay, array['albums', (k-1)::text, 'sheets'], to_jsonb(cnt)); end if;
  end loop;
  insert into order_drafts(created_by, title, payload) values (auth.uid(), 'Invoice for ' || (select code from orders where id = p_order), pay || jsonb_build_object('reopenOrder', p_order)) returning id into d;
  return d;
end $$;
revoke execute on function prepare_order_invoice(uuid) from public, anon;
grant execute on function prepare_order_invoice(uuid) to authenticated;
