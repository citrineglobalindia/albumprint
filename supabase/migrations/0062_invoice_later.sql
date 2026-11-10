-- Design + Printing orders: create the order now, prepare the invoice later.
-- The design is done first; the sheets designed decide the bill. So reception can take the order (customer, events, couple, dates, album names)
-- without prices: order_pricing.status = 'invoice_pending', total 0, no invoice. Advances may be received meanwhile.
-- "Prepare invoice" on the order opens the builder with the order's selections (sheets pre-filled from the designer's "Sheets designed" count);
-- finalizing then issues the numbered invoice (revision 1) and sets the order total. The order cannot go to Printing until the invoice is done
-- (an admin can override with a reason).

alter table order_pricing drop constraint if exists order_pricing_status_check;
alter table order_pricing add constraint order_pricing_status_check check (status in ('finalized', 'reopened', 'invoice_pending'));
-- the sheet count may be unknown until the design is done (0 = to be confirmed)
alter table order_albums drop constraint if exists order_albums_pages_check;
alter table order_albums add constraint order_albums_pages_check check (pages >= 0);
alter table order_specs drop constraint if exists order_specs_pages_check;
alter table order_specs add constraint order_specs_pages_check check (pages >= 0);

create or replace function create_order_invoice_later(p_draft uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  d order_drafts; pay jsonb; ev jsonb; nc jsonb; cust customers; o orders; a jsonb; k int := 0; sheets int; copies int; due date; odate date := current_date;
  st pricing_settings; prio priority_level; res jsonb; snap jsonb;
begin
  if current_app_role() is null or not has_perm('order', 'write') then raise exception 'you cannot create orders' using errcode = '42501'; end if;
  select * into d from order_drafts where id = p_draft for update;
  if not found then raise exception 'draft not found'; end if;
  if d.created_by <> auth.uid() and current_app_role() <> 'admin' then raise exception 'this draft belongs to someone else' using errcode = '42501'; end if;
  if d.result is not null then return d.result; end if;                                   -- already created: same answer
  pay := d.payload;
  if (pay->>'orderType') is distinct from 'design_printing' then raise exception 'only a Design + Printing order can be invoiced later' using errcode = '23514'; end if;
  if nullif(pay->>'reopenOrder', '') is not null then raise exception 'this draft edits an existing order' using errcode = '23514'; end if;
  if jsonb_array_length(coalesce(pay->'albums', '[]'::jsonb)) = 0 then raise exception 'add at least one album' using errcode = '23514'; end if;

  ev := coalesce(pay->'event', '{}'::jsonb);
  if coalesce(ev->>'orderDate', '') <> '' then
    if ev->>'orderDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'the order date is not valid' using errcode = '23514'; end if;
    odate := (ev->>'orderDate')::date;
    if odate > current_date then raise exception 'the order date cannot be in the future' using errcode = '23514'; end if;
  end if;
  if coalesce(ev->>'date', '') <> '' and ev->>'date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'the event date is not valid' using errcode = '23514'; end if;
  if coalesce(ev->>'delivery', '') <> '' and ev->>'delivery' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'the delivery date is not valid' using errcode = '23514'; end if;
  select * into st from pricing_settings;
  due := coalesce(nullif(ev->>'delivery', '')::date, odate + st.default_delivery_days);
  if due < odate then raise exception 'the delivery date cannot be before the order date' using errcode = '23514'; end if;

  if nullif(pay->>'customerId', '') is not null then
    select * into cust from customers where id = (pay->>'customerId')::uuid;
    if not found then raise exception 'the selected customer was not found'; end if;
  else
    nc := coalesce(pay->'newCustomer', '{}'::jsonb);
    if char_length(btrim(coalesce(nc->>'name', ''))) < 2 then raise exception 'enter the customer name' using errcode = '23514'; end if;
    if coalesce(nc->>'phone', '') !~ '^[6-9][0-9]{9}$' then raise exception 'enter a 10-digit phone number starting with 6, 7, 8 or 9' using errcode = '23514'; end if;
    insert into customers(studio_name, contact_person, mobile, email, address, code)
      values (btrim(nc->>'name'), btrim(nc->>'name'), nc->>'phone', nullif(btrim(coalesce(nc->>'email', '')), ''), nullif(btrim(coalesce(nc->>'address', '')), ''), 'pending') returning * into cust;
  end if;
  prio := case lower(coalesce(ev->>'priority', '')) when 'low' then 'low' when 'high' then 'high' when 'urgent' then 'urgent' when 'vip' then 'vip' else 'normal' end::priority_level;

  insert into orders(customer_id, type, event_name, event_type, event_date, order_date, due_date, special_instructions, total, work_group, priority, code, couple_name)
    values (cust.id, 'design_printing', nullif(btrim(coalesce(ev->>'name', '')), ''), nullif(btrim(coalesce(ev->>'type', '')), ''), nullif(ev->>'date', '')::date, odate, due, nullif(btrim(coalesce(ev->>'notes', '')), ''), 0,
            nullif(btrim(coalesce(ev->>'workGroup', '')), ''), prio, 'pending', nullif(btrim(coalesce(ev->>'couple', '')), '')) returning * into o;
  perform set_config('app.pricing_fn', '1', true);

  -- albums as far as they are known (sheets 0 = to be confirmed by the design)
  for a in select value from jsonb_array_elements(pay->'albums') loop
    k := k + 1;
    sheets := case when coalesce(a->>'sheets', '') ~ '^\d+$' then (a->>'sheets')::int else 0 end;
    copies := case when coalesce(a->>'copies', '') ~ '^\d+$' and (a->>'copies')::int >= 1 then (a->>'copies')::int else 1 end;
    if coalesce(a->>'eventDate', '') <> '' and a->>'eventDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'album %: the event date is not valid', k using errcode = '23514'; end if;
    insert into order_albums(order_id, position, title, album_type, album_size, orientation, pages, copies, paper_type, cover_type, lamination, binding, box_type, event_date)
      values (o.id, k, coalesce(nullif(btrim(coalesce(a->>'name', '')), ''), 'Album ' || k), 'Album', coalesce(nullif(a->>'size', ''), '—'), lower(coalesce(nullif(a->>'orientation', ''), 'landscape')), sheets, copies,
              coalesce(nullif(a->>'paper', ''), '—'), '—', nullif(a->>'finish', ''), '—', null, nullif(a->>'eventDate', '')::date);
    if k = 1 then
      insert into order_specs(order_id, album_type, album_size, orientation, pages, copies, paper_type, cover_type, lamination, binding, box_required, box_type)
        values (o.id, 'Album', coalesce(nullif(a->>'size', ''), '—'), lower(coalesce(nullif(a->>'orientation', ''), 'landscape')), sheets, copies, coalesce(nullif(a->>'paper', ''), '—'), '—', nullif(a->>'finish', ''), '—', false, null)
        on conflict (order_id) do nothing;
    end if;
  end loop;

  snap := jsonb_build_object('albums', '[]'::jsonb, 'orderLines', '[]'::jsonb, 'total', 0, 'event', ev, 'orderCode', o.code, 'orderDate', odate, 'dueDate', due, 'invoicePending', true,
    'customer', jsonb_strip_nulls(jsonb_build_object('id', cust.id, 'code', cust.code, 'name', cust.studio_name, 'phone', cust.mobile, 'email', cust.email, 'address', cust.address)));
  insert into order_pricing(order_id, revision, status, order_type, subtotal, taxable, total, payload, snapshot, invoice_id)
    values (o.id, 1, 'invoice_pending', 'design_printing', 0, 0, 0, pay - 'invoiceLater', snap, null);
  perform set_config('app.pricing_fn', '', true);

  res := jsonb_build_object('orderId', o.id, 'code', o.code, 'invoiceNumber', '', 'total', 0, 'revision', 0, 'invoicePending', true);
  update order_drafts set result = res, order_id = o.id where id = p_draft;
  return res;
end $$;
revoke execute on function create_order_invoice_later(uuid) from public, anon;
grant execute on function create_order_invoice_later(uuid) to authenticated;

-- Prepare the invoice of an invoice-later order: its selections come back as a draft to price and finalize (finalize_order_v2 issues the invoice).
-- A one-album order gets the designer's "Sheets designed" count (job progress) when its sheets are not entered yet.
create or replace function prepare_order_invoice(p_order uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare op order_pricing; d uuid; pay jsonb; n int;
begin
  if current_app_role() is null or current_app_role() not in ('admin', 'reception') or not has_perm('order', 'write') then raise exception 'only reception or an admin prepares invoices' using errcode = '42501'; end if;
  select * into op from order_pricing where order_id = p_order for update;
  if not found or op.status <> 'invoice_pending' then raise exception 'this order has no invoice to prepare' using errcode = '23514'; end if;
  select id into d from order_drafts where result is null and payload->>'reopenOrder' = p_order::text order by updated_at desc limit 1;
  if d is not null then return d; end if;                                                -- already being prepared: continue it
  pay := op.payload - 'invoiceLater';
  select count into n from job_progress where order_id = p_order and dept = 'design';
  if coalesce(n, 0) > 0 and jsonb_array_length(coalesce(pay->'albums', '[]'::jsonb)) = 1 and coalesce(pay->'albums'->0->>'sheets', '') !~ '^[1-9]\d*$' then
    pay := jsonb_set(pay, '{albums,0,sheets}', to_jsonb(n));
  end if;
  insert into order_drafts(created_by, title, payload) values (auth.uid(), 'Invoice for ' || (select code from orders where id = p_order), pay || jsonb_build_object('reopenOrder', p_order)) returning id into d;
  return d;
end $$;
revoke execute on function prepare_order_invoice(uuid) from public, anon;
grant execute on function prepare_order_invoice(uuid) to authenticated;

-- payments: an advance may be received before the invoice (the order total is 0 until then)
CREATE OR REPLACE FUNCTION public.payments_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare net numeric; tot numeric;
begin
  if tg_op in ('UPDATE','DELETE') then raise exception 'payments are immutable; record a refund instead'; end if;
  select coalesce(sum(amount) filter (where kind='payment'),0) - coalesce(sum(amount) filter (where kind='refund'),0) into net from payments where order_id = new.order_id;
  if new.kind = 'refund' then
    if new.amount > net then raise exception 'refund % exceeds amount paid %', new.amount, net; end if;
  elsif not is_system() and not has_perm('payments', 'approve')
        and not exists (select 1 from order_pricing where order_id = new.order_id and status = 'invoice_pending') then
    select total into tot from orders where id = new.order_id;
    if net + new.amount > tot then raise exception 'amount % exceeds the balance of % - reception can only receive up to the balance', new.amount, greatest(tot - net, 0); end if;
  end if;
  if auth.uid() is not null then new.recorded_by := auth.uid(); end if;
  return new;
end $function$;

-- stage moves: no printing before the invoice of an invoice-later order (an admin may override with a reason)
CREATE OR REPLACE FUNCTION public.advance_order(p_order uuid, p_to stage_key, p_reason text DEFAULT NULL::text, p_override boolean DEFAULT false)
 RETURNS orders
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare o orders; t stage_transitions; r app_role := current_app_role(); sysc boolean := is_system();
begin
  if r is null and not sysc then raise exception 'not authorised' using errcode = '42501'; end if;
  select * into o from orders where id = p_order for update;
  if not found then raise exception 'order not found'; end if;
  if o.on_hold and not (p_override and r = 'admin') then raise exception 'order is on hold'; end if;

  select * into t from stage_transitions where order_type = o.type and from_stage = o.stage and to_stage = p_to;
  if not found then
    -- ALB-FR-0494: skipping/forcing a transition is an admin-only override with a reason
    if not (p_override and (r = 'admin' or sysc) and coalesce(p_reason,'') <> '') then
      raise exception 'transition % -> % is not allowed for % orders', o.stage, p_to, o.type using errcode = '23514';
    end if;
  else
    if not sysc and not (r = any(t.allowed_roles) or exists (select 1 from unnest(t.allowed_roles) ar where acts_as(ar))) then raise exception 'role % may not move % -> %', r, o.stage, p_to using errcode = '42501'; end if;
    if t.needs_reason and coalesce(p_reason,'') = '' then raise exception 'a reason is required for % -> %', o.stage, p_to; end if;
  end if;

  -- gates
  if p_to = 'printing' and o.stage = 'final_approval' and o.type = 'design_printing' and not p_override
     and not exists (select 1 from proofs where order_id = o.id and status = 'approved') then
    raise exception 'final client approval is required before release to printing';      -- ALB-FR-0495
  end if;
  if p_to = 'printing' and o.type = 'design_printing' and not (p_override and r = 'admin')
     and exists (select 1 from order_pricing where order_id = o.id and status = 'invoice_pending') then
    raise exception 'prepare the invoice before printing: open the order and use Prepare invoice';
  end if;
  if p_to = 'printing' and o.stage = 'files_received' and o.type = 'printing_only' and not p_override
     and uploads_required() and not exists (select 1 from order_files where order_id = o.id and category = 'final_print' and not archived) then
    raise exception 'a print-ready file is required before printing';                      -- ALB-FR-0077
  end if;
  if p_to = 'ready_for_delivery' and o.qc_status <> 'passed' and not (p_override and r = 'admin') then
    raise exception 'QC must pass before Ready for Delivery';                              -- ALB-FR-0496
  end if;
  if p_to = 'cancelled' and coalesce(p_reason,'') = '' then raise exception 'cancellation reason required'; end if;

  perform set_config('app.reason', coalesce(p_reason, ''), true);
  perform set_config('app.via_fn', '1', true);
  perform set_config('app.allow_closed', case when o.stage = 'closed' then '1' else '' end, true);

  update orders set
    stage = p_to,
    cancel_reason = case when p_to = 'cancelled' then p_reason else cancel_reason end,
    main_status = case p_to when 'new_order' then 'new' when 'files_received' then 'new' when 'colour_grading' then 'active_production'
       when 'admin_approval' then 'active_production' when 'designing' then 'active_production' when 'design_review' then 'active_production'
       when 'client_review' then 'awaiting_client' when 'final_approval' then 'awaiting_client' when 'printing' then 'printing' when 'qc' then 'qc'
       when 'ready_for_delivery' then 'ready' when 'delivered' then 'delivered' when 'closed' then 'closed' else 'cancelled' end::main_status,
    grading_status = case p_to when 'colour_grading' then 'in_progress' when 'admin_approval' then 'submitted' when 'designing' then 'approved' else grading_status end::work_status,
    design_status = case p_to when 'designing' then 'in_progress' when 'design_review' then 'submitted' when 'client_review' then 'submitted' when 'final_approval' then 'approved' else design_status end::work_status,
    print_status = case p_to when 'printing' then 'printing' when 'qc' then 'sent_to_qc' else print_status end::print_stage,
    qc_status = case when p_to = 'printing' and o.stage = 'qc' then 'rework' else qc_status end::qc_decision,
    delivery_status = case p_to when 'ready_for_delivery' then 'ready' when 'delivered' then 'delivered' else delivery_status end::delivery_status,
    closure_status = case p_to when 'delivered' then 'operationally_complete' when 'closed' then 'closed' else closure_status end::closure_status
  where id = o.id returning * into o;
  perform set_config('app.via_fn', '', true);
  return o;
end $function$;

-- finalize_order_v2 (0061) also issues the first invoice of an invoice-later order
CREATE OR REPLACE FUNCTION public.finalize_order_v2(p_draft uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  d order_drafts; pay jsonb; pr jsonb; ev jsonb; nc jsonb; cust customers; o orders; op order_pricing; inv invoices; biz jsonb; snap jsonb;
  rev int := 1; lno int := 0; reopen uuid; a jsonb; ln jsonb; k int; pos int; designed boolean; due date; odate date := current_date; ptype text; thr numeric; pct numeric;
  cover text; binding text; box text; res jsonb; st pricing_settings; prio priority_level; show_name boolean;
begin
  if current_app_role() is null or not has_perm('order', 'write') then raise exception 'you cannot create orders' using errcode = '42501'; end if;
  select * into d from order_drafts where id = p_draft for update;
  if not found then raise exception 'draft not found'; end if;
  if d.created_by <> auth.uid() and current_app_role() <> 'admin' then raise exception 'this draft belongs to someone else' using errcode = '42501'; end if;
  if d.result is not null then return d.result; end if;                                   -- already finalized: same answer

  pay := d.payload; pr := order_price(pay); designed := (pay->>'orderType') = 'design_printing';
  if not (pr->>'canFinalize')::boolean then raise exception 'cannot finalize: %', coalesce(pr->'errors'->0->>'message', 'a price is not configured') using errcode = '23514'; end if;
  ev := coalesce(pay->'event', '{}'::jsonb);
  -- the order date: the day the order was taken (today unless an earlier day is given); the event date is optional (0054)
  if coalesce(ev->>'orderDate', '') <> '' then
    if ev->>'orderDate' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'the order date is not valid' using errcode = '23514'; end if;
    odate := (ev->>'orderDate')::date;
    if odate > current_date then raise exception 'the order date cannot be in the future' using errcode = '23514'; end if;
  end if;
  if coalesce(ev->>'date', '') <> '' and ev->>'date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'the event date is not valid' using errcode = '23514'; end if;
  if coalesce(ev->>'delivery', '') <> '' and coalesce(ev->>'delivery', '') !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'the delivery date is not valid' using errcode = '23514'; end if;
  select * into st from pricing_settings;
  due := coalesce(nullif(ev->>'delivery', '')::date, odate + st.default_delivery_days);
  if due < odate then raise exception 'the delivery date cannot be before the order date' using errcode = '23514'; end if;

  -- discounts above the approval threshold need an admin (the existing rule)
  thr := coalesce((select (value->>'discount_approval_pct')::numeric from settings where key = 'pricing'), 10);
  -- everything below catalog prices (line discounts, lowered prices, the order discount) as a share of the order at catalog prices
  pct := case when coalesce((pr->>'listSubtotal')::numeric, 0) > 0 then (pr->>'reduction')::numeric * 100 / (pr->>'listSubtotal')::numeric else 0 end;
  if pct > thr and current_app_role() <> 'admin' then raise exception 'a discount above % % needs an admin to finalize', thr, '%' using errcode = '42501'; end if;

  -- customer
  if nullif(pay->>'customerId', '') is not null then
    select * into cust from customers where id = (pay->>'customerId')::uuid;
    if not found then raise exception 'the selected customer was not found'; end if;
  else
    nc := coalesce(pay->'newCustomer', '{}'::jsonb);
    if char_length(btrim(coalesce(nc->>'name', ''))) < 2 then raise exception 'enter the customer name' using errcode = '23514'; end if;
    if coalesce(nc->>'phone', '') !~ '^[6-9][0-9]{9}$' then raise exception 'enter a 10-digit phone number starting with 6, 7, 8 or 9' using errcode = '23514'; end if;
    insert into customers(studio_name, contact_person, mobile, email, address, code)
      values (btrim(nc->>'name'), btrim(nc->>'name'), nc->>'phone', nullif(btrim(coalesce(nc->>'email', '')), ''), nullif(btrim(coalesce(nc->>'address', '')), ''), 'pending') returning * into cust;
  end if;

  prio := case lower(coalesce(ev->>'priority', '')) when 'low' then 'low' when 'high' then 'high' when 'urgent' then 'urgent' when 'vip' then 'vip' else 'normal' end::priority_level;
  reopen := nullif(pay->>'reopenOrder', '')::uuid;
  ptype := case when designed then 'design_printing' else 'printing_only' end;
  if reopen is not null then
    select * into op from order_pricing where order_id = reopen for update;
    if not found or op.status not in ('reopened', 'invoice_pending') then raise exception 'this order is not open for editing' using errcode = '23514'; end if;
    perform set_config('app.pricing_fn', '1', true);
    rev := case when op.status = 'invoice_pending' then 1 else op.revision + 1 end;      -- the first invoice of an invoice-later order is revision 1
    update orders set customer_id = cust.id, type = ptype::order_type, event_name = nullif(btrim(coalesce(ev->>'name', '')), ''), event_type = nullif(btrim(coalesce(ev->>'type', '')), ''), event_date = nullif(ev->>'date', '')::date, order_date = odate, due_date = due, couple_name = nullif(btrim(coalesce(ev->>'couple', '')), ''),
      work_group = nullif(btrim(coalesce(ev->>'workGroup', '')), ''), priority = prio,
      special_instructions = nullif(btrim(coalesce(ev->>'notes', '')), ''), total = (pr->>'total')::numeric where id = reopen returning * into o;
  else
    insert into orders(customer_id, type, event_name, event_type, event_date, order_date, due_date, special_instructions, total, work_group, priority, code, couple_name)
      values (cust.id, ptype::order_type, nullif(btrim(coalesce(ev->>'name', '')), ''), nullif(btrim(coalesce(ev->>'type', '')), ''), nullif(ev->>'date', '')::date, odate, due, nullif(btrim(coalesce(ev->>'notes', '')), ''), (pr->>'total')::numeric,
              nullif(btrim(coalesce(ev->>'workGroup', '')), ''), prio, 'pending', nullif(btrim(coalesce(ev->>'couple', '')), '')) returning * into o;
  end if;
  perform set_config('app.pricing_fn', '1', true);

  -- albums (replace by position so other modules keep their links) and the album-1 specification the production screens read
  k := 0;
  for a in select value from jsonb_array_elements(pr->'albums') loop
    k := k + 1; cover := null; binding := null; box := null;
    for ln in select value from jsonb_array_elements(a->'lines') loop
      if ln->>'optionKind' = 'cover' then cover := ln->>'name'; elsif ln->>'optionKind' = 'binding' then binding := ln->>'name'; elsif ln->>'optionKind' = 'box' then box := ln->>'name'; end if;
    end loop;
    if coalesce((pay->'albums'->(k-1))->>'eventDate', '') <> '' and (pay->'albums'->(k-1))->>'eventDate' !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'album %: the event date is not valid', k using errcode = '23514'; end if;
    insert into order_albums(order_id, position, title, album_type, album_size, orientation, pages, copies, paper_type, cover_type, lamination, binding, box_type, event_date)
      values (o.id, k, a->>'name', 'Album', coalesce(a->>'size', '—'), lower(coalesce(nullif((pay->'albums'->(k-1))->>'orientation', ''), 'landscape')), (a->>'sheets')::int, (a->>'copies')::int, coalesce(a->>'paper', '—'), coalesce(cover, '—'), a->>'finish', coalesce(binding, '—'), box,
              nullif((pay->'albums'->(k-1))->>'eventDate', '')::date)
      on conflict (order_id, position) do update set title = excluded.title, album_size = excluded.album_size, orientation = excluded.orientation, pages = excluded.pages, copies = excluded.copies, event_date = excluded.event_date,
        paper_type = excluded.paper_type, cover_type = excluded.cover_type, lamination = excluded.lamination, binding = excluded.binding, box_type = excluded.box_type;
    if k = 1 then
      insert into order_specs(order_id, album_type, album_size, orientation, pages, copies, paper_type, cover_type, lamination, binding, box_required, box_type)
        values (o.id, 'Album', coalesce(a->>'size', '—'), lower(coalesce(nullif((pay->'albums'->0)->>'orientation', ''), 'landscape')), (a->>'sheets')::int, (a->>'copies')::int, coalesce(a->>'paper', '—'), coalesce(cover, '—'), a->>'finish', coalesce(binding, '—'), box is not null, box)
        on conflict (order_id) do update set album_size = excluded.album_size, orientation = excluded.orientation, pages = excluded.pages, copies = excluded.copies, paper_type = excluded.paper_type, cover_type = excluded.cover_type,
          lamination = excluded.lamination, binding = excluded.binding, box_required = excluded.box_required, box_type = excluded.box_type;
    end if;
  end loop;
  delete from order_albums where order_id = o.id and position > k;

  -- the invoice (draft while its lines are written, then sent), numbered by the server
  insert into invoices(number, order_id, customer_id, due_date, status, calc_mode, discount_pct, gst_rate, igst, discount_type, discount_value, discount_amount, tax_label, tax_rate, tax_amount, pricing_revision, notes, discount_approved_by)
    values ('pending', o.id, cust.id, due, 'draft', 'v2', 0, 0, false, pr->>'discountType', (pr->>'discountValue')::numeric, (pr->>'discountAmount')::numeric + coalesce((pr->>'lineDiscounts')::numeric, 0),
            case when (pr->>'taxEnabled')::boolean then pr->>'taxLabel' end, (pr->>'taxRate')::numeric, (pr->>'tax')::numeric, rev, nullif(btrim(coalesce(ev->>'notes', '')), ''),
            case when pct > thr and current_app_role() = 'admin' then auth.uid() end) returning * into inv;

  k := 0;
  for a in select value from jsonb_array_elements(pr->'albums') loop
    k := k + 1; pos := 0;
    for ln in select value from jsonb_array_elements(a->'lines') loop
      pos := pos + 1;
      insert into order_charge_lines(order_id, revision, album_position, position, kind, item_id, name, unit, method, scope, qty, copies, rate, rate_basis, amount, note)
        values (o.id, rev, k, pos, ln->>'kind', (ln->>'itemId')::uuid, ln->>'name', ln->>'unit', ln->>'method', ln->>'scope', (ln->>'qty')::numeric, (a->>'copies')::int, (ln->>'rate')::numeric, ln->>'rule', (ln->>'amount')::numeric, ln->>'note');
      lno := lno + 1;
      insert into invoice_lines(invoice_id, line_no, description, qty, rate, section, scope, note)
        values (inv.id, lno, ln->>'name' || case ln->>'scope' when 'copy' then ' — ' || case when ln->>'method' = 'per_sheet' then (ln->>'qty')::numeric::int || ' sheets' else (ln->>'qty')::numeric::int || ' ' || coalesce(ln->>'unit', 'pcs') end || case when (a->>'copies')::int > 1 then ' × ' || (a->>'copies') || ' copies' else '' end
                                          when 'album' then ' — per album' else '' end,
                case ln->>'scope' when 'copy' then (ln->>'qty')::numeric * (a->>'copies')::int else 1 end, (ln->>'rate')::numeric, a->>'name', ln->>'scope',
                nullif(concat_ws(' · ', case when (ln->>'priceEdited')::boolean then 'price set on the order' else ln->>'rule' end,
                  case when coalesce((ln->>'discount')::numeric, 0) > 0 then 'less discount ₹' || ((ln->>'discount')::numeric * case when ln->>'scope' = 'copy' then (a->>'copies')::int else 1 end)::text end), ''));
    end loop;
  end loop;
  pos := 0;
  for ln in select value from jsonb_array_elements(pr->'orderLines') loop
    pos := pos + 1;
    insert into order_charge_lines(order_id, revision, album_position, position, kind, item_id, name, unit, method, scope, qty, copies, rate, rate_basis, amount, note)
      values (o.id, rev, null, pos, 'item', (ln->>'itemId')::uuid, ln->>'name', ln->>'unit', ln->>'method', 'order', 1, 1, (ln->>'rate')::numeric, ln->>'rule', (ln->>'amount')::numeric, null);
    lno := lno + 1;
    insert into invoice_lines(invoice_id, line_no, description, qty, rate, section, scope, note) values (inv.id, lno, ln->>'name' || ' — one-time order charge', 1, (ln->>'rate')::numeric, 'Order charges', 'order', ln->>'rule');
  end loop;
  perform invoice_recompute(inv.id);
  if (select total from invoices where id = inv.id) <> (pr->>'total')::numeric then raise exception 'internal check failed: the invoice total does not match the priced order'; end if;
  update invoices set status = 'sent', sent_at = now() where id = inv.id returning * into inv;

  biz := business_profile();
  -- the company name on the invoice: the order's choice if this user may make it (admin, or a role the admin allows), else the default
  show_name := case when current_app_role() = 'admin' or current_app_role()::text = any (coalesce(st.brand_roles, '{}'))
                    then coalesce((pay->>'showBusinessName')::boolean, st.show_business_name) else st.show_business_name end;
  if not coalesce(show_name, true) then biz := biz - 'name'; end if;
  snap := pr || jsonb_build_object('business', biz, 'customer', jsonb_strip_nulls(jsonb_build_object('id', cust.id, 'code', cust.code, 'name', cust.studio_name, 'phone', cust.mobile, 'email', cust.email, 'address', cust.address)),
    'event', ev, 'orderCode', o.code, 'orderDate', odate, 'dueDate', due, 'invoiceNumber', inv.number, 'invoiceDate', inv.issue_date, 'revision', rev, 'showBusinessName', coalesce(show_name, true), 'pricingSettings', to_jsonb(st) - 'updated_by' - 'updated_at');
  update invoices set snapshot = snap where id = inv.id;

  if reopen is not null then
    update order_pricing set revision = rev, status = 'finalized', order_type = ptype, subtotal = (pr->>'subtotal')::numeric, discount_type = pr->>'discountType', discount_value = (pr->>'discountValue')::numeric,
      discount_amount = (pr->>'discountAmount')::numeric, tax_enabled = (pr->>'taxEnabled')::boolean, tax_label = pr->>'taxLabel', tax_rate = (pr->>'taxRate')::numeric, taxable = (pr->>'taxable')::numeric,
      tax_amount = (pr->>'tax')::numeric, total = (pr->>'total')::numeric, payload = pay - 'reopenOrder' - 'invoiceLater', snapshot = snap, invoice_id = inv.id, finalized_at = now(), finalized_by = auth.uid() where order_id = o.id;
  else
    insert into order_pricing(order_id, revision, status, order_type, subtotal, discount_type, discount_value, discount_amount, tax_enabled, tax_label, tax_rate, taxable, tax_amount, total, payload, snapshot, invoice_id)
      values (o.id, 1, 'finalized', ptype, (pr->>'subtotal')::numeric, pr->>'discountType', (pr->>'discountValue')::numeric, (pr->>'discountAmount')::numeric, (pr->>'taxEnabled')::boolean, pr->>'taxLabel', (pr->>'taxRate')::numeric,
              (pr->>'taxable')::numeric, (pr->>'tax')::numeric, (pr->>'total')::numeric, pay, snap, inv.id);
  end if;
  perform set_config('app.pricing_fn', '', true);

  res := jsonb_build_object('orderId', o.id, 'code', o.code, 'invoiceId', inv.id, 'invoiceNumber', inv.number, 'total', (pr->>'total')::numeric, 'revision', rev);
  update order_drafts set result = res, order_id = o.id where id = p_draft;
  return res;
end $function$;
