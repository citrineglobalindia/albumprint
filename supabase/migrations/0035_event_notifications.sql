-- Event notifications (SRS §17.1). The templates in Settings → Notifications existed, but nothing created the bell notifications for them.
-- Now the database does it, whoever makes the change: new orders, every stage hand-over, rework, assignments, holds, payments, QC failures,
-- discount approvals, dispatches, and a daily overdue-payment reminder. The person who made the change is not notified of their own action,
-- and a template switched off (or with "in-app" off) in Settings is respected.
create or replace function notify_event(p_key text, p_roles app_role[], p_title text, p_body text, p_link text, p_users uuid[] default '{}') returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if p_key is not null and not exists (select 1 from notification_templates where key = p_key and active and in_app) then return 0; end if;
  insert into notifications(user_id, title, body, link)
    select p.id, p_title, p_body, p_link from profiles p
    where p.active and (p.role = any (p_roles) or p.id = any (p_users)) and p.id is distinct from auth.uid();
  get diagnostics n = row_count;
  return n;
end $$;
revoke execute on function notify_event(text, app_role[], text, text, text, uuid[]) from public, anon, authenticated;

create or replace function stage_pos(s stage_key) returns int language sql immutable set search_path = public as $$ select array_position(enum_range(null::stage_key), s) $$;
revoke execute on function stage_pos(stage_key) from public, anon, authenticated;

-- Where a notification should open: a page the receiving department can actually use.
create or replace function stage_link(p_code text, p_stage stage_key) returns text language sql immutable set search_path = public as $$
  select case p_stage when 'colour_grading' then '/colour-grading' when 'designing' then '/designing/' || p_code when 'design_review' then '/designing/' || p_code
    when 'printing' then '/printing' when 'qc' then '/qc' else '/orders/' || p_code end $$;
create or replace function role_link(p_code text, p_role app_role) returns text language sql immutable set search_path = public as $$
  select case p_role when 'colour' then '/colour-grading' when 'designer' then '/designing/' || p_code when 'printing' then '/printing' when 'qc' then '/qc' when 'accounts' then '/payments' else '/orders/' || p_code end $$;
revoke execute on function stage_link(text, stage_key), role_link(text, app_role) from public, anon, authenticated;

create or replace function orders_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare cust text; link text := '/orders/' || new.code; what text := new.code; o int; v int; arole app_role;
begin
  select studio_name into cust from customers where id = new.customer_id;
  what := new.code || ' · ' || coalesce(cust, 'customer');
  select role into arole from profiles where id = new.assignee;
  if tg_op = 'INSERT' then
    perform notify_event('order_created', array['admin', 'reception']::app_role[], 'Order created', what || coalesce(' · ' || new.event_type, ''), link);
    if new.assignee is not null then perform notify_event(null, '{}', 'Job assigned to you', what, role_link(new.code, arole), array[new.assignee]); end if;
    return new;
  end if;

  if new.stage is distinct from old.stage then
    o := stage_pos(old.stage); v := stage_pos(new.stage); link := stage_link(new.code, new.stage);
    if old.stage in ('client_review', 'design_review') and new.stage = 'designing' then
      perform notify_event('correction_received', array['admin', 'designer']::app_role[], 'Corrections requested', what, link);
    elsif old.stage = 'client_review' and new.stage = 'final_approval' then
      perform notify_event('final_approval', array['admin']::app_role[], 'Client approved the proof — final approval needed', what, link);
    elsif v < o and new.stage not in ('closed', 'cancelled') then
      perform notify_event(null, array['admin', case new.stage when 'colour_grading' then 'colour' when 'designing' then 'designer' when 'printing' then 'printing' when 'qc' then 'qc' else 'reception' end]::app_role[],
        'Sent back to ' || initcap(replace(new.stage::text, '_', ' ')), what, link);
    else
      case new.stage
        when 'colour_grading'     then perform notify_event('colour_grading_assigned', array['colour']::app_role[], 'Colour grading assigned', what, link);
        when 'admin_approval'     then perform notify_event('grading_submitted', array['admin']::app_role[], 'Grading submitted — approval needed', what, link);
        when 'designing'          then perform notify_event('design_assigned', array['designer']::app_role[], 'Design assigned', what, link);
        when 'design_review'      then perform notify_event('design_submitted', array['admin']::app_role[], 'Design submitted — review needed', what, link);
        when 'client_review'      then perform notify_event('proof_ready', array['admin', 'reception']::app_role[], 'Proof ready to send to the client', what, link);
        when 'final_approval'     then perform notify_event('final_approval', array['admin']::app_role[], 'Final approval needed', what, link);
        when 'printing'           then perform notify_event('final_approval', array['printing']::app_role[], 'Released to printing', what, link);
        when 'qc'                 then perform notify_event('printing_completed', array['qc']::app_role[], 'Printing completed — QC needed', what, link);
        when 'ready_for_delivery' then perform notify_event('qc_passed', array['admin', 'reception']::app_role[], 'QC passed — ready for delivery', what, link);
        when 'delivered'          then perform notify_event('delivered', array['admin', 'reception']::app_role[], 'Delivered', what, link);
        else null;
      end case;
    end if;
  end if;

  if new.assignee is distinct from old.assignee and new.assignee is not null then
    perform notify_event(null, '{}', 'Job assigned to you', what, role_link(new.code, arole), array[new.assignee]);
  end if;
  link := '/orders/' || new.code;
  if new.on_hold and not old.on_hold then
    perform notify_event(null, array['admin', 'reception']::app_role[], 'Order put on hold', what || coalesce(' — ' || new.hold_reason, ''), link);
  elsif old.on_hold and not new.on_hold then
    perform notify_event(null, array['admin', 'reception']::app_role[], 'Order resumed', what, link);
  end if;
  if new.cancel_reason is not null and old.cancel_reason is null then
    perform notify_event(null, array['admin', 'reception']::app_role[], 'Order cancelled', what || ' — ' || new.cancel_reason, link);
  end if;
  if new.priority is distinct from old.priority and new.priority in ('urgent', 'vip') then
    perform notify_event(null, array['admin']::app_role[], 'Priority raised to ' || new.priority::text, what, link);
  end if;
  return new;
end $$;
create trigger orders_notify_t after insert or update on orders for each row execute function orders_notify();

create or replace function payments_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text; cust text;
begin
  select o.code, c.studio_name into v_code, cust from orders o join customers c on c.id = o.customer_id where o.id = new.order_id;
  perform notify_event(null, array['admin', 'accounts']::app_role[], case when new.kind = 'refund' then 'Refund issued' else 'Payment received' end,
    '₹' || to_char(new.amount, 'FM99,99,99,990') || ' · ' || v_code || ' · ' || coalesce(cust, '') || ' (' || new.mode::text || ')', '/payments');
  return new;
end $$;
create trigger payments_notify_t after insert on payments for each row execute function payments_notify();

create or replace function qc_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if new.decision in ('failed', 'rework') and (tg_op = 'INSERT' or old.decision is distinct from new.decision) then
    select o.code into v_code from orders o where o.id = new.order_id;
    perform notify_event(null, array['admin', 'printing']::app_role[], 'QC failed', v_code || ' · ' || array_to_string(new.defect_codes, ', '), '/qc');
  end if;
  return new;
end $$;
create trigger qc_notify_t after insert or update of decision on qc_inspections for each row execute function qc_notify();

create or replace function invoice_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare lim numeric := coalesce((select (value ->> 'discount_approval_pct')::numeric from settings where key = 'pricing'), 10);
begin
  if new.kind = 'invoice' and new.discount_pct > lim and new.discount_approved_by is null and (tg_op = 'INSERT' or old.discount_pct is distinct from new.discount_pct) then
    perform notify_event(null, array['admin']::app_role[], 'Discount approval needed', new.number || ' · ' || new.discount_pct || '% discount', '/invoices');
  end if;
  return new;
end $$;
create trigger invoice_notify_t after insert or update of discount_pct on invoices for each row execute function invoice_notify();

create or replace function delivery_notify() returns trigger language plpgsql security definer set search_path = public as $$
declare v_code text;
begin
  if new.status = 'dispatched' and (tg_op = 'INSERT' or old.status is distinct from 'dispatched') then
    select o.code into v_code from orders o where o.id = new.order_id;
    perform notify_event('dispatched', array['admin', 'reception']::app_role[], 'Dispatched', v_code || coalesce(' · ' || new.courier, '') || coalesce(' · ' || new.tracking_no, ''), '/delivery');
  end if;
  return new;
end $$;
create trigger delivery_notify_t after insert or update of status on deliveries for each row execute function delivery_notify();

-- Daily reminder: unpaid invoices past their due date reach Admin and Accounts once a day.
create or replace function run_payment_reminders() returns int language plpgsql security definer set search_path = public as $$
declare i record; n int := 0; k int; t text;
begin
  if not exists (select 1 from notification_templates where key = 'payment_due' and active and in_app) then return 0; end if;
  for i in
    select v.number, v.due_date, c.studio_name, o.code, o.total - o.paid as balance
    from invoices v join orders o on o.id = v.order_id join customers c on c.id = v.customer_id
    where v.kind = 'invoice' and v.status in ('sent', 'overdue', 'partially_paid') and v.due_date < current_date and o.total - o.paid > 0 and o.cancel_reason is null
  loop
    t := 'Payment overdue: ' || i.number;
    insert into notifications(user_id, title, body, link)
      select p.id, t, (current_date - i.due_date) || ' days overdue · ' || i.studio_name || ' · ' || i.code || ' · ₹' || to_char(i.balance, 'FM99,99,99,990'), '/invoices'
      from profiles p where p.active and p.role in ('admin', 'accounts')
        and not exists (select 1 from notifications x where x.user_id = p.id and x.title = t and x.created_at::date = current_date);
    get diagnostics k = row_count;
    n := n + k;
  end loop;
  return n;
end $$;
revoke execute on function run_payment_reminders() from public, anon, authenticated;

-- A nudge for the person holding an order (used by the Control Center); admin only.
create or replace function notify_assignee(p_order uuid, p_title text, p_body text) returns int
language plpgsql security definer set search_path = public as $$
declare a uuid; v_code text;
begin
  if current_app_role() <> 'admin' then raise exception 'Only an administrator can send nudges'; end if;
  select o.assignee, o.code into a, v_code from orders o where o.id = p_order;
  if a is null then raise exception 'This order has no assignee'; end if;
  return notify_event(null, '{}', p_title, coalesce(p_body, v_code), role_link(v_code, (select role from profiles where id = a)), array[a]);
end $$;
revoke execute on function notify_assignee(uuid, text, text) from public, anon;
grant execute on function notify_assignee(uuid, text, text) to authenticated;

do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('albumpro-payment-reminders', '30 3 * * *', 'select public.run_payment_reminders()');   -- 09:00 IST
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;
