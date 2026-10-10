-- AlbumPro — business rules enforced in the database (SRS §1.3, §5, §7, §11, §15, §20, §23).
-- API and UI go through the same functions, so rules cannot be bypassed (ALB-FR-0493).

-- ───────── helpers ─────────
create or replace function current_app_role() returns app_role language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function is_system() returns boolean language sql stable as $$
  select auth.uid() is null and current_user in ('postgres','service_role','supabase_admin')
$$;

create or replace function next_code(p_kind text, p_prefix text, p_width int) returns text language plpgsql as $$
declare n bigint;
begin
  insert into counters(kind, next_value) values (p_kind, 2)
  on conflict (kind) do update set next_value = counters.next_value + 1
  returning next_value - 1 into n;
  return p_prefix || lpad(n::text, p_width, '0');
end $$;

create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
create trigger orders_touch before update on orders for each row execute function touch_updated_at();

-- ───────── human-readable IDs (server-generated; never trusted from clients) ─────────
create or replace function set_codes() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'orders'    then new.code := next_code('order', 'IDP', 5);
  elsif tg_table_name = 'customers' then new.code := next_code('customer', 'IDC', 6);
  elsif tg_table_name = 'payments'  then new.receipt_no := next_code('receipt-' || extract(year from now())::int, 'RCP' || extract(year from now())::int, 3);
  elsif tg_table_name = 'invoices'  then new.number := next_code('invoice-' || extract(year from now())::int, 'INV-' || extract(year from now())::int || '-', 4);
  end if;
  return new;
end $$;
create trigger orders_code    before insert on orders    for each row execute function set_codes();
create trigger customers_code before insert on customers for each row execute function set_codes();
create trigger payments_code  before insert on payments  for each row execute function set_codes();
create trigger invoices_code  before insert on invoices  for each row execute function set_codes();

-- ───────── audit (ALB-FR-0001, 0005, §20.2) ─────────
create or replace function audit_row() returns trigger language plpgsql security definer set search_path = public as $$
declare k text;
begin
  k := case when tg_op = 'DELETE' then to_jsonb(old)->>'id' else to_jsonb(new)->>'id' end;
  insert into audit_log(actor, actor_role, entity, entity_id, action, old_data, new_data, reason)
  values (auth.uid(), current_app_role(), tg_table_name, coalesce(k, to_jsonb(coalesce(new, old))->>'order_id'), lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end, case when tg_op <> 'DELETE' then to_jsonb(new) end,
          nullif(current_setting('app.reason', true), ''));
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array['orders','customers','order_files','payments','invoices','qc_inspections','deliveries','profiles','role_permissions','settings','masters','proofs','corrections','print_jobs'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', t || '_audit', t);
  end loop; end $$;

create or replace function audit_immutable() returns trigger language plpgsql as $$
begin raise exception 'audit_log is append-only'; end $$;
create trigger audit_no_change before update or delete on audit_log for each row execute function audit_immutable();

-- ───────── workflow transitions (§5, §22, §23.2) ─────────
insert into stage_transitions(order_type, from_stage, to_stage, allowed_roles, needs_reason) values
 -- Design + Printing
 ('design_printing','new_order','files_received','{admin,reception}',false),
 ('design_printing','files_received','colour_grading','{admin,reception}',false),
 ('design_printing','colour_grading','admin_approval','{admin,colour}',false),
 ('design_printing','admin_approval','designing','{admin}',false),
 ('design_printing','admin_approval','colour_grading','{admin}',true),
 ('design_printing','designing','design_review','{admin,designer}',false),
 ('design_printing','design_review','client_review','{admin,reception}',false),
 ('design_printing','design_review','designing','{admin}',true),
 ('design_printing','client_review','designing','{admin,designer}',true),
 ('design_printing','client_review','final_approval','{admin}',false),
 ('design_printing','final_approval','printing','{admin}',false),
 -- Printing Only (§5.2): grading/design skipped
 ('printing_only','new_order','files_received','{admin,reception}',false),
 ('printing_only','files_received','printing','{admin,reception}',false),
 ('printing_only','files_received','new_order','{admin,reception}',true);

-- common tail for both order types
insert into stage_transitions(order_type, from_stage, to_stage, allowed_roles, needs_reason)
select t, a, b, r, x from unnest(array['design_printing','printing_only']::order_type[]) t,
 (values ('printing'::stage_key,'qc'::stage_key,'{admin,printing}'::app_role[],false),
         ('qc','ready_for_delivery','{admin,qc}',false),
         ('qc','printing','{admin,qc}',true),                       -- rework loop
         ('ready_for_delivery','delivered','{admin,reception,printing,qc}',false),
         ('delivered','closed','{admin}',false),
         ('closed','delivered','{admin}',true)) as v(a,b,r,x);        -- reopen needs elevated role + reason

insert into stage_transitions(order_type, from_stage, to_stage, allowed_roles, needs_reason)
select t, s, 'cancelled', '{admin}', true from unnest(array['design_printing','printing_only']::order_type[]) t,
 unnest(enum_range(null::stage_key)) s where s not in ('closed','cancelled','delivered');
insert into stage_transitions select t, 'cancelled', 'new_order', '{admin}', true from unnest(array['design_printing','printing_only']::order_type[]) t;

insert into sla_rules(stage, hours, escalate_after_hours) values
 ('files_received',4,8),('colour_grading',24,36),('admin_approval',8,16),('designing',72,96),('design_review',8,16),
 ('client_review',72,120),('final_approval',8,16),('printing',72,96),('qc',8,16),('ready_for_delivery',24,48);

-- The one entry point for moving an order. Enforces role, valid transition, reasons, gates, hold, audit.
create or replace function advance_order(p_order uuid, p_to stage_key, p_reason text default null, p_override boolean default false)
returns orders language plpgsql security definer set search_path = public as $$
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
    if not sysc and not (r = any(t.allowed_roles)) then raise exception 'role % may not move % -> %', r, o.stage, p_to using errcode = '42501'; end if;
    if t.needs_reason and coalesce(p_reason,'') = '' then raise exception 'a reason is required for % -> %', o.stage, p_to; end if;
  end if;

  -- gates
  if p_to = 'printing' and o.stage = 'final_approval' and o.type = 'design_printing' and not p_override
     and not exists (select 1 from proofs where order_id = o.id and status = 'approved') then
    raise exception 'final client approval is required before release to printing';      -- ALB-FR-0495
  end if;
  if p_to = 'printing' and o.stage = 'files_received' and o.type = 'printing_only' and not p_override
     and not exists (select 1 from order_files where order_id = o.id and category = 'final_print' and not archived) then
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
end $$;

-- Printing-Only orders have no grading/design work (ALB-FR-0079: shown "Not Required")
create or replace function init_order() returns trigger language plpgsql as $$
begin
  if new.type = 'printing_only' then new.grading_status := 'not_required'; new.design_status := 'not_required'; end if;
  return new;
end $$;
create trigger orders_init before insert on orders for each row execute function init_order();

-- Closed orders are read-only (ALB-FR-0497); reopen only through advance_order.
create or replace function guard_closed() returns trigger language plpgsql as $$
begin
  if old.stage = 'closed' and coalesce(current_setting('app.allow_closed', true), '') <> '1' then
    raise exception 'order % is closed and read-only', old.code using errcode = '23514';
  end if;
  return new;
end $$;
create trigger orders_closed before update on orders for each row execute function guard_closed();

create or replace function guard_child_of_closed() returns trigger language plpgsql as $$
declare s stage_key; oid uuid := (to_jsonb(coalesce(new, old))->>'order_id')::uuid;
begin
  select stage into s from orders where id = oid;
  if s = 'closed' then raise exception 'order is closed; % blocked', tg_op using errcode = '23514'; end if;
  return coalesce(new, old);
end $$;
create trigger files_closed before insert or update or delete on order_files for each row execute function guard_child_of_closed();
create trigger tasks_closed before insert or update or delete on tasks for each row execute function guard_child_of_closed();

-- ───────── files: versioning & locking (§7) ─────────
create or replace function file_version() returns trigger language plpgsql as $$
begin
  select coalesce(max(version), 0) + 1 into new.version from order_files
   where order_id = new.order_id and category = new.category and file_name = new.file_name;   -- never overwrite silently (ALB-FR-0119)
  return new;
end $$;
create trigger files_version before insert on order_files for each row execute function file_version();

create or replace function file_lock_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.state = 'locked' then raise exception 'locked file cannot be deleted; archive it instead'; end if;
    return old;
  end if;
  if old.state = 'locked' and (new.state <> 'locked' or new.storage_path <> old.storage_path or new.checksum is distinct from old.checksum
        or new.file_name <> old.file_name or new.size_bytes <> old.size_bytes) then
    raise exception 'locked file is immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger files_lock before update or delete on order_files for each row execute function file_lock_guard();

-- Admin locks the final print file after final client approval (ALB-FR-0120)
create or replace function lock_final_print_file(p_file uuid) returns order_files language plpgsql security definer set search_path = public as $$
declare f order_files;
begin
  if current_app_role() <> 'admin' and not is_system() then raise exception 'admin only' using errcode = '42501'; end if;
  select * into f from order_files where id = p_file;
  if not found or f.category <> 'final_print' then raise exception 'not a final print file'; end if;
  if not exists (select 1 from proofs where order_id = f.order_id and status = 'approved') then raise exception 'final client approval required before locking'; end if;
  update order_files set state = 'locked' where id = p_file returning * into f;
  return f;
end $$;

-- ───────── money (§15) ─────────
create or replace function recompute_payment_state(p_order uuid) returns void language plpgsql security definer set search_path = public as $$
declare pay numeric; ref numeric; tot numeric;
begin
  select coalesce(sum(amount) filter (where kind = 'payment'), 0), coalesce(sum(amount) filter (where kind = 'refund'), 0)
    into pay, ref from payments where order_id = p_order;
  select total into tot from orders where id = p_order;
  perform set_config('app.allow_closed', '1', true);
  perform set_config('app.via_fn', '1', true);
  update orders set paid = pay - ref, pay_status = case
      when pay > 0 and pay - ref = 0 and ref > 0 then 'refunded'
      when pay - ref <= 0 then 'unpaid'
      when pay - ref < tot then 'partially_paid'
      when pay - ref = tot then 'paid' else 'overpaid' end::pay_status
  where id = p_order;
  perform set_config('app.allow_closed', '', true);
  perform set_config('app.via_fn', '', true);
end $$;

create or replace function payments_after() returns trigger language plpgsql security definer set search_path = public as $$
begin perform recompute_payment_state(coalesce(new.order_id, old.order_id)); return coalesce(new, old); end $$;
create trigger payments_recompute after insert or update or delete on payments for each row execute function payments_after();

create or replace function payments_guard() returns trigger language plpgsql as $$
declare net numeric;
begin
  if tg_op in ('UPDATE','DELETE') then raise exception 'payments are immutable; record a refund instead'; end if;   -- financial integrity
  if new.kind = 'refund' then
    select coalesce(sum(amount) filter (where kind='payment'),0) - coalesce(sum(amount) filter (where kind='refund'),0) into net from payments where order_id = new.order_id;
    if new.amount > net then raise exception 'refund % exceeds amount paid %', new.amount, net; end if;
  end if;
  return new;
end $$;
create trigger payments_guard_t before insert or update or delete on payments for each row execute function payments_guard();

create or replace function invoice_recompute(p_invoice uuid) returns void language plpgsql as $$
declare sub numeric; d numeric; tx numeric; i invoices;
begin
  select * into i from invoices where id = p_invoice;
  select coalesce(sum(qty * rate), 0) into sub from invoice_lines where invoice_id = p_invoice;
  d := round(sub * i.discount_pct / 100, 2);
  tx := round((sub - d) * i.gst_rate / 100, 2);
  update invoices set subtotal = sub, tax = tx, total = sub - d + tx where id = p_invoice;
end $$;
create or replace function invoice_lines_after() returns trigger language plpgsql as $$
begin perform invoice_recompute(coalesce(new.invoice_id, old.invoice_id)); return coalesce(new, old); end $$;
create trigger invoice_lines_recompute after insert or update or delete on invoice_lines for each row execute function invoice_lines_after();

-- Discounts above the threshold need admin approval before an invoice leaves draft (ALB-FR-0036)
create or replace function invoice_discount_guard() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.discount_pct > coalesce((select (value->>'discount_approval_pct')::numeric from settings where key = 'pricing'), 10)
     and new.status <> 'draft' and new.discount_approved_by is null then
    raise exception 'discount of % %% needs admin approval', new.discount_pct;
  end if;
  return new;
end $$;
create trigger invoices_discount before insert or update on invoices for each row execute function invoice_discount_guard();

-- Order delivery requires dues cleared unless the setting allows it (Settings → Allow Delivery Without Full Payment)
create or replace function delivery_payment_gate() returns trigger language plpgsql security definer set search_path = public as $$
declare o orders; allow boolean;
begin
  if new.status in ('dispatched','delivered') and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    select * into o from orders where id = new.order_id;
    select coalesce((value->>'allow_delivery_without_full_payment')::boolean, false) into allow from settings where key = 'workflow';
    if o.paid < o.total and not coalesce(allow, false) then raise exception 'payment hold: % outstanding', o.total - o.paid; end if;
  end if;
  return new;
end $$;
create trigger deliveries_gate before insert or update on deliveries for each row execute function delivery_payment_gate();
