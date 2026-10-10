-- Finance workflow: credit notes, invoice sending, atomic create/refund/approve functions, reception overpayment rule.

-- ───────── columns ─────────
alter table invoices
  add column kind text not null default 'invoice' check (kind in ('invoice','credit_note')),
  add column ref_invoice_id uuid references invoices(id),
  add column igst boolean not null default false,
  add column amount numeric(12,2),                 -- credit notes: the refunded amount (overrides the computed total)
  add column sent_at timestamptz;
alter table payments add column credit_note_id uuid references invoices(id);
create index if not exists invoices_order_idx on invoices(order_id);
create index if not exists payments_order_idx on payments(order_id);

-- ───────── numbering: credit notes get their own CN-yyyy-#### series ─────────
create or replace function set_codes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'orders'    then new.code := next_code('order', 'IDP', 5);
  elsif tg_table_name = 'customers' then new.code := next_code('customer', 'IDC', 6);
  elsif tg_table_name = 'payments'  then new.receipt_no := next_code('receipt-' || extract(year from now())::int, 'RCP' || extract(year from now())::int, 3);
  elsif tg_table_name = 'invoices'  then
    if new.kind = 'credit_note' then new.number := next_code('creditnote-' || extract(year from now())::int, 'CN-' || extract(year from now())::int || '-', 4);
    else new.number := next_code('invoice-' || extract(year from now())::int, 'INV-' || extract(year from now())::int || '-', 4); end if;
  end if;
  return new;
end $$;

-- ───────── totals: credit notes keep their stated amount ─────────
create or replace function invoice_recompute(p_invoice uuid) returns void language plpgsql set search_path = public as $$
declare sub numeric; d numeric; tx numeric; i invoices;
begin
  select * into i from invoices where id = p_invoice;
  select coalesce(sum(qty * rate), 0) into sub from invoice_lines where invoice_id = p_invoice;
  d := round(sub * i.discount_pct / 100, 2);
  tx := round((sub - d) * i.gst_rate / 100, 2);
  update invoices set subtotal = sub, tax = tx, total = coalesce(i.amount, sub - d + tx) where id = p_invoice;
end $$;

-- ───────── invoice guards ─────────
-- approval is stamped only by an admin (moved from the RLS check so Accounts can still send an already-approved invoice)
alter policy inv_write on invoices with check (has_perm('invoices','write'));

create or replace function invoices_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if ((tg_op = 'INSERT' and new.discount_approved_by is not null) or (tg_op = 'UPDATE' and new.discount_approved_by is distinct from old.discount_approved_by and new.discount_approved_by is not null))
     and not is_system() and current_app_role() <> 'admin' then
    raise exception 'only an admin can approve a discount above the threshold' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.kind <> new.kind or old.order_id <> new.order_id then raise exception 'invoice kind and order cannot change'; end if;
    if old.status <> 'draft' and new.status = 'draft' then raise exception 'a sent invoice cannot go back to draft'; end if;
    if old.status <> 'draft' and old.kind = 'invoice' and (new.discount_pct <> old.discount_pct or new.gst_rate <> old.gst_rate or new.igst <> old.igst) then
      raise exception 'only draft invoices can be edited'; end if;
    -- raising the discount withdraws any earlier approval
    if new.discount_pct > old.discount_pct and new.discount_approved_by is not distinct from old.discount_approved_by then new.discount_approved_by := null; end if;
    if new.status = 'sent' and old.status = 'draft' and new.sent_at is null then new.sent_at := now(); end if;
  end if;
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  return new;
end $$;
create trigger invoices_guard_t before insert or update on invoices for each row execute function invoices_guard();

create or replace function invoices_after() returns trigger language plpgsql set search_path = public as $$
begin
  if new.discount_pct <> old.discount_pct or new.gst_rate <> old.gst_rate then perform invoice_recompute(new.id); end if;
  return new;
end $$;
create trigger invoices_after_t after update on invoices for each row execute function invoices_after();

create or replace function invoice_lines_guard() returns trigger language plpgsql set search_path = public as $$
declare s text; k text;
begin
  select status, kind into s, k from invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if k = 'invoice' and s <> 'draft' then raise exception 'lines can only change while the invoice is a draft'; end if;
  return coalesce(new, old);
end $$;
create trigger invoice_lines_guard_t before insert or update or delete on invoice_lines for each row execute function invoice_lines_guard();

-- ───────── payments: recorded_by is the signed-in user; reception cannot take more than the balance ─────────
create or replace function payments_guard() returns trigger language plpgsql set search_path = public as $$
declare net numeric; tot numeric;
begin
  if tg_op in ('UPDATE','DELETE') then raise exception 'payments are immutable; record a refund instead'; end if;   -- financial integrity
  select coalesce(sum(amount) filter (where kind='payment'),0) - coalesce(sum(amount) filter (where kind='refund'),0) into net from payments where order_id = new.order_id;
  if new.kind = 'refund' then
    if new.amount > net then raise exception 'refund % exceeds amount paid %', new.amount, net; end if;
  elsif not is_system() and not has_perm('payments', 'approve') then
    select total into tot from orders where id = new.order_id;
    if net + new.amount > tot then raise exception 'amount % exceeds the balance of % - reception can only receive up to the balance', new.amount, greatest(tot - net, 0); end if;
  end if;
  if auth.uid() is not null then new.recorded_by := auth.uid(); end if;
  return new;
end $$;

-- ───────── RPCs (security invoker: RLS still applies) ─────────
-- Create an invoice and its lines atomically; returns {id, number, ...}. p_lines: [{desc, qty, price}]
create or replace function create_invoice(p_order uuid, p_due date, p_discount numeric, p_gst numeric, p_igst boolean, p_notes text, p_lines jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare o orders; inv invoices; l jsonb;
begin
  if not has_perm('invoices', 'write') then raise exception 'only Accounts and Admin can create invoices' using errcode = '42501'; end if;
  select * into o from orders where id = p_order;
  if not found then raise exception 'order not found'; end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then raise exception 'an invoice needs at least one line'; end if;
  insert into invoices(number, order_id, customer_id, due_date, discount_pct, gst_rate, igst, notes)
    values ('pending', o.id, o.customer_id, p_due, coalesce(p_discount, 0), coalesce(p_gst, 18), coalesce(p_igst, false), nullif(p_notes, '')) returning * into inv;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into invoice_lines(invoice_id, description, qty, rate) values (inv.id, l->>'desc', (l->>'qty')::numeric, (l->>'price')::numeric);
  end loop;
  select * into inv from invoices where id = inv.id;
  return jsonb_build_object('id', inv.id, 'number', inv.number, 'total', inv.total, 'issue_date', inv.issue_date, 'due_date', inv.due_date);
end $$;

-- Refund = credit note + refund payment in one transaction (the refund cap is enforced by payments_guard).
create or replace function issue_refund(p_order uuid, p_amount numeric, p_mode pay_mode, p_reason text, p_date date default current_date)
returns jsonb language plpgsql set search_path = public as $$
declare o orders; cn invoices; pay payments; ref uuid;
begin
  if not has_perm('invoices', 'write') then raise exception 'only Accounts and Admin can issue refunds' using errcode = '42501'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'a refund reason is required'; end if;
  select * into o from orders where id = p_order;
  if not found then raise exception 'order not found'; end if;
  select id into ref from invoices where order_id = p_order and kind = 'invoice' order by created_at desc limit 1;
  insert into invoices(number, kind, order_id, customer_id, due_date, issue_date, status, sent_at, gst_rate, amount, notes, ref_invoice_id)
    values ('pending', 'credit_note', o.id, o.customer_id, p_date, p_date, 'sent', now(), 18, p_amount, 'Refund of ' || p_amount, ref) returning * into cn;
  insert into invoice_lines(invoice_id, description, qty, rate) values (cn.id, 'Refund: ' || trim(p_reason), 1, round(p_amount / 1.18, 2));
  insert into payments(receipt_no, order_id, kind, amount, mode, paid_on, notes, credit_note_id)
    values ('pending', o.id, 'refund', p_amount, p_mode, p_date, trim(p_reason), cn.id) returning * into pay;
  return jsonb_build_object('payment_id', pay.id, 'receipt_no', pay.receipt_no, 'credit_note_id', cn.id, 'credit_note', cn.number, 'ref_invoice_id', ref);
end $$;

-- Admin approves an above-threshold discount.
create or replace function approve_discount(p_invoice uuid) returns void language plpgsql set search_path = public as $$
declare i invoices;
begin
  if current_app_role() <> 'admin' and not is_system() then raise exception 'only an admin can approve a discount above the threshold' using errcode = '42501'; end if;
  select * into i from invoices where id = p_invoice;
  if not found then raise exception 'invoice not found'; end if;
  update invoices set discount_approved_by = auth.uid() where id = p_invoice;
end $$;

revoke execute on function invoices_guard(), invoices_after(), invoice_lines_guard() from authenticated, public, anon;
revoke execute on function create_invoice(uuid, date, numeric, numeric, boolean, text, jsonb), issue_refund(uuid, numeric, pay_mode, text, date), approve_discount(uuid) from public, anon;
grant execute on function create_invoice(uuid, date, numeric, numeric, boolean, text, jsonb), issue_refund(uuid, numeric, pay_mode, text, date), approve_discount(uuid) to authenticated;
