-- New order: the couple's name (optional, e.g. "Asha & Ravi") is saved on the order (orders.couple_name) when it is finalized.
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
    if not found or op.status <> 'reopened' then raise exception 'this order is not open for editing' using errcode = '23514'; end if;
    perform set_config('app.pricing_fn', '1', true);
    rev := op.revision + 1;
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
      tax_amount = (pr->>'tax')::numeric, total = (pr->>'total')::numeric, payload = pay - 'reopenOrder', snapshot = snap, invoice_id = inv.id, finalized_at = now(), finalized_by = auth.uid() where order_id = o.id;
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
