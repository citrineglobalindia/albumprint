-- Old balance (opening balance): money a customer already owed before AlbumPro, kept in another system until now.
-- Accounts / admin enter the amount once on the customer; it then counts in the customer's dues, the pending-payments
-- list and WhatsApp reminders, and payments are received against it (with a normal receipt number) until it is cleared.
-- It is not an order: no order, invoice or stage is created.

alter table customers
  add column if not exists opening_balance numeric(12,2) not null default 0 check (opening_balance >= 0),
  add column if not exists opening_note text,
  add column if not exists opening_on date;

create table if not exists opening_payments (
  id uuid primary key default gen_random_uuid(),
  receipt_no text unique not null,
  customer_id uuid not null references customers(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  mode pay_mode not null,
  reference text, paid_on date not null default current_date, notes text,
  recorded_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists opening_payments_customer_idx on opening_payments(customer_id);

-- receipt numbers come from the same series as order payments, so a receipt number is never used twice
create or replace function opening_payments_before() returns trigger language plpgsql security definer set search_path = public as $$
declare bal numeric; paid numeric;
begin
  select opening_balance into bal from customers where id = new.customer_id for update;
  if not found then raise exception 'customer not found'; end if;
  select coalesce(sum(amount), 0) into paid from opening_payments where customer_id = new.customer_id;
  if new.amount > bal - paid then
    raise exception 'amount is more than the old balance still due (Rs. %)', greatest(bal - paid, 0) using errcode = '23514';
  end if;
  if new.mode <> 'cash' and coalesce(btrim(new.reference), '') = '' then
    raise exception 'a reference (UTR / cheque no.) is required for non-cash payments' using errcode = '23514';
  end if;
  new.receipt_no := next_code('receipt-' || extract(year from now())::int, 'RCP' || extract(year from now())::int, 3);
  new.recorded_by := coalesce(auth.uid(), new.recorded_by);
  return new;
end $$;
drop trigger if exists opening_payments_before_t on opening_payments;
create trigger opening_payments_before_t before insert on opening_payments for each row execute function opening_payments_before();
drop trigger if exists opening_payments_audit on opening_payments;
create trigger opening_payments_audit after insert or update or delete on opening_payments for each row execute function audit_row();

alter table opening_payments enable row level security;
drop policy if exists op_read on opening_payments;
drop policy if exists op_ins on opening_payments;
create policy op_read on opening_payments for select to authenticated using (has_perm('payments', 'view'));
create policy op_ins  on opening_payments for insert to authenticated with check (has_perm('payments', 'write'));
-- no update / delete: a wrong entry is corrected by changing the old balance, the receipts stay as they were

-- set (or correct) a customer's old balance: accounts and admin only; never below what has already been received
create or replace function set_opening_balance(p_customer uuid, p_amount numeric, p_note text default null, p_on date default null) returns jsonb
language plpgsql security definer set search_path = public as $$
declare paid numeric; c customers;
begin
  if not has_perm('invoices', 'write') then raise exception 'only accounts or an admin can set an old balance' using errcode = '42501'; end if;
  if p_amount is null or p_amount < 0 then raise exception 'enter an amount of zero or more' using errcode = '23514'; end if;
  select coalesce(sum(amount), 0) into paid from opening_payments where customer_id = p_customer;
  if p_amount < paid then raise exception 'Rs. % has already been received against the old balance; the balance cannot be less than that', paid using errcode = '23514'; end if;
  update customers set opening_balance = round(p_amount, 2), opening_note = nullif(btrim(p_note), ''), opening_on = coalesce(p_on, opening_on, current_date)
   where id = p_customer returning * into c;
  if not found then raise exception 'customer not found'; end if;
  return jsonb_build_object('customer', c.code, 'opening_balance', c.opening_balance, 'received', paid);
end $$;
revoke execute on function set_opening_balance(uuid, numeric, text, date) from public, anon;
grant execute on function set_opening_balance(uuid, numeric, text, date) to authenticated;

-- the customer directory now carries the old balance and what has been received against it
drop function if exists list_customers();
create function list_customers() returns table (
  id uuid, code text, studio_name text, contact_person text, segment text, active boolean, city text, state text, created_at timestamptz,
  mobile text, whatsapp text, email text, gstin text, opening_balance numeric, opening_paid numeric, opening_note text, opening_on date)
language sql stable security definer set search_path = public as $$
  select c.id, c.code, c.studio_name, c.contact_person, c.segment, c.active, c.city, c.state, c.created_at,
         case when has_perm('pii','view') then c.mobile   else mask_text(c.mobile, 3) end,
         case when has_perm('pii','view') then c.whatsapp else mask_text(c.whatsapp, 3) end,
         case when has_perm('pii','view') then c.email    else mask_text(c.email, 2) end,
         case when has_perm('pii','view') then c.gstin    else mask_text(c.gstin, 2) end,
         c.opening_balance, coalesce((select sum(p.amount) from opening_payments p where p.customer_id = c.id), 0), c.opening_note, c.opening_on
  from customers c where current_app_role() is not null
$$;
revoke execute on function list_customers() from public, anon;
grant  execute on function list_customers() to authenticated;

-- merging duplicates also adds up their old balances and moves the payments received against them
create or replace function merge_customers(p_keep uuid, p_merge uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare keep customers; d customers; n_orders int := 0; n_inv int := 0; c int; merged int := 0;
begin
  if current_app_role() is distinct from 'admin' then raise exception 'only an admin merges customers' using errcode = '42501'; end if;
  select * into keep from customers where id = p_keep for update;
  if not found then raise exception 'the customer to keep was not found'; end if;
  perform set_config('app.allow_closed', '1', true);
  for d in select * from customers where id = any(p_merge) and id <> p_keep for update loop
    update orders set customer_id = p_keep where customer_id = d.id; get diagnostics c = row_count; n_orders := n_orders + c;
    update invoices set customer_id = p_keep where customer_id = d.id; get diagnostics c = row_count; n_inv := n_inv + c;
    update comm_log set customer_id = p_keep where customer_id = d.id;
    update customers set
      email = coalesce(keep.email, d.email), address = coalesce(keep.address, d.address), contact_person = coalesce(keep.contact_person, d.contact_person),
      whatsapp = coalesce(keep.whatsapp, d.whatsapp), city = coalesce(keep.city, d.city), state = coalesce(keep.state, d.state), gstin = coalesce(keep.gstin, d.gstin),
      opening_balance = keep.opening_balance + d.opening_balance,
      opening_note = coalesce(keep.opening_note, d.opening_note), opening_on = least(keep.opening_on, d.opening_on)
    where id = p_keep returning * into keep;
    update opening_payments set customer_id = p_keep where customer_id = d.id;   -- the receipt check runs on new payments only
    delete from customers where id = d.id;
    merged := merged + 1;
  end loop;
  perform set_config('app.allow_closed', '', true);
  return jsonb_build_object('kept', keep.code, 'merged', merged, 'orders', n_orders, 'invoices', n_inv);
end $$;
revoke execute on function merge_customers(uuid, uuid[]) from public, anon;
grant execute on function merge_customers(uuid, uuid[]) to authenticated;

notify pgrst, 'reload schema';
