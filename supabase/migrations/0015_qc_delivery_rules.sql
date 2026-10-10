-- AlbumPro — production rules, part 2: quality control (§13) and delivery (§14) enforced in the database.

-- ───────── quality control ─────────
alter table qc_inspections alter column inspector set default auth.uid();

create or replace function qc_inspections_rules() returns trigger language plpgsql set search_path = public as $$
declare ord orders; k text; keys text[] := array['print','colour','align','binding','cover','spec','pack'];
begin
  select * into ord from orders where id = new.order_id;
  if tg_op = 'INSERT' then
    if ord.stage <> 'qc' then raise exception 'only orders at the QC stage can be inspected' using errcode = '23514'; end if;
    if ord.on_hold then raise exception 'order is on hold' using errcode = '23514'; end if;
    if exists (select 1 from qc_inspections where order_id = new.order_id and decision in ('pending', 'in_progress')) then
      raise exception 'an inspection is already open for this order' using errcode = '23514';
    end if;
    if exists (select 1 from rework_tasks where order_id = new.order_id and status = 'open') then
      raise exception 'a rework task is waiting for admin: inspection resumes after the return' using errcode = '23514';
    end if;
    new.round := coalesce((select max(round) from qc_inspections where order_id = new.order_id), 0) + 1;     -- rounds are server-numbered
    return new;
  end if;

  if old.decision not in ('pending', 'in_progress') then        -- decided rounds are history: only the admin-task flag may flip
    if (to_jsonb(new) - 'pending_admin') <> (to_jsonb(old) - 'pending_admin') then
      raise exception 'a decided inspection is immutable' using errcode = '23514';
    end if;
    return new;
  end if;
  if new.decision = 'passed' then
    foreach k in array keys loop
      if new.checklist ->> k = 'fail' then raise exception 'a checklist item is marked Fail: choose Rework / Fail instead' using errcode = '23514'; end if;
    end loop;
    if new.checklist <> '{}'::jsonb then
      foreach k in array keys loop
        if coalesce(new.checklist ->> k, '') not in ('pass', 'na') then raise exception 'complete every checklist item before passing' using errcode = '23514'; end if;
      end loop;
    end if;
  elsif new.decision in ('failed', 'rework') then
    if cardinality(new.defect_codes) = 0 then raise exception 'select at least one defect code' using errcode = '23514'; end if;
    if btrim(coalesce(new.reason, '')) = '' then raise exception 'a reason is required' using errcode = '23514'; end if;
    if new.return_to is null then raise exception 'choose the department to return the order to' using errcode = '23514'; end if;
  end if;
  return new;
end $$;
create trigger qc_inspections_rules_t before insert or update on qc_inspections for each row execute function qc_inspections_rules();
-- A QC verdict that sends the album back to Printing re-opens the print job (reprint #n at the Printing stage) — done here, with definer rights,
-- because QC staff may view but not edit print jobs.
create or replace function qc_inspections_return() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.decision in ('failed', 'rework') and new.return_to = 'printing' and old.decision in ('pending', 'in_progress') and exists (select 1 from print_jobs where order_id = new.order_id) then
    update print_jobs set reprints = reprints + 1, stage = 'printing' where order_id = new.order_id;
    insert into print_exceptions(order_id, kind, note, resolved, resolved_at, raised_by, resolved_by)
      values (new.order_id, 'reprint', 'QC ' || new.decision || ' (round ' || new.round || '): ' || new.reason, true, now(), auth.uid(), auth.uid());
    insert into production_events(order_id, area, text, actor, actor_name)
      values (new.order_id, 'printing', 'Returned from QC: ' || new.reason, auth.uid(), (select full_name from profiles where id = auth.uid()));
  end if;
  return new;
end $$;
create trigger qc_inspections_return_t after update on qc_inspections for each row execute function qc_inspections_return();
revoke execute on function qc_inspections_return() from public, anon, authenticated;

create trigger qc_inspections_closed before insert or update on qc_inspections for each row execute function guard_child_of_closed();

-- advance_order() resets qc_status to 'rework' when an order goes QC → Printing; a Failed round must stay Failed.
create or replace function orders_keep_qc_failed() returns trigger language plpgsql set search_path = public as $$
begin
  if old.stage = 'qc' and new.stage = 'printing' and new.qc_status = 'rework'
     and (select decision from qc_inspections where order_id = new.id order by round desc limit 1) = 'failed' then
    new.qc_status := 'failed';
  end if;
  return new;
end $$;
create trigger orders_keep_qc_failed_t before update on orders for each row execute function orders_keep_qc_failed();

create or replace function rework_tasks_rules() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.status := 'open'; new.created_by := coalesce(new.created_by, auth.uid()); return new; end if;
  if new.order_id is distinct from old.order_id or new.dept is distinct from old.dept or new.reason is distinct from old.reason or new.created_at is distinct from old.created_at then
    raise exception 'rework tasks cannot be edited' using errcode = '23514';
  end if;
  if old.status = 'done' then raise exception 'rework task is already done' using errcode = '23514'; end if;
  if new.status = 'done' then new.done_by := auth.uid(); new.done_at := now(); end if;
  return new;
end $$;
create trigger rework_tasks_rules_t before insert or update on rework_tasks for each row execute function rework_tasks_rules();
revoke execute on function qc_inspections_rules(), orders_keep_qc_failed(), rework_tasks_rules() from public, anon, authenticated;

-- ───────── delivery ─────────
-- Payment gate (replaces 0002): an admin may dispatch with dues outstanding by recording an override reason (logged by the audit trigger).
create or replace function delivery_payment_gate() returns trigger language plpgsql security definer set search_path = public as $$
declare o orders; allow boolean;
begin
  -- the hold applies when an order leaves the shop (dispatch); handing a dispatched parcel over is not blocked again
  if new.status in ('dispatched', 'delivered') and (tg_op = 'INSERT' or old.status is distinct from new.status)
     and not (tg_op = 'UPDATE' and old.status = 'dispatched' and new.status = 'delivered') then
    select * into o from orders where id = new.order_id;
    select coalesce((value ->> 'allow_delivery_without_full_payment')::boolean, false) into allow from settings where key = 'workflow';
    if o.paid < o.total and not coalesce(allow, false) then
      if not (btrim(coalesce(new.override_reason, '')) <> '' and (current_app_role() = 'admin' or is_system())) then
        raise exception 'payment hold: % outstanding', o.total - o.paid;
      end if;
    end if;
  end if;
  return new;
end $$;

create or replace function deliveries_rules() returns trigger language plpgsql set search_path = public as $$
declare o orders;
begin
  select * into o from orders where id = new.order_id;
  if tg_op = 'UPDATE' then
    if old.status = 'delivered' then raise exception 'delivery is already complete' using errcode = '23514'; end if;
    if old.status = 'dispatched' and new.status = 'dispatched'
       and (new.mode is distinct from old.mode or new.courier is distinct from old.courier or new.tracking_no is distinct from old.tracking_no) then
      raise exception 'dispatch details are locked once dispatched' using errcode = '23514';
    end if;
  end if;
  if new.status is distinct from (case when tg_op = 'UPDATE' then old.status end) then
    if tg_op = 'UPDATE' and not (
          (old.status = 'not_ready' and new.status = 'ready')
       or (old.status = 'ready' and new.status = 'dispatched')
       or (old.status = 'dispatched' and new.status in ('delivered', 'failed', 'returned'))
       or (old.status in ('failed', 'returned') and new.status = 'ready')) then
      raise exception 'delivery cannot go from % to %', old.status, new.status using errcode = '23514';
    end if;
    if new.status = 'dispatched' then
      if o.stage <> 'ready_for_delivery' then raise exception 'only orders that are Ready for Delivery can be dispatched' using errcode = '23514'; end if;
      if o.on_hold then raise exception 'order is on hold' using errcode = '23514'; end if;
      if new.mode in ('courier', 'third_party') and (btrim(coalesce(new.courier, '')) = '' or btrim(coalesce(new.tracking_no, '')) = '') then
        raise exception 'enter the courier / carrier name and the tracking number' using errcode = '23514';
      end if;
      new.dispatched_at := coalesce(new.dispatched_at, now());
    elsif new.status = 'delivered' then
      if btrim(coalesce(new.received_by, '')) = '' then raise exception 'enter who received the album' using errcode = '23514'; end if;
      if btrim(coalesce(new.proof_path, '')) = '' then raise exception 'proof of delivery is required (signature or photo)' using errcode = '23514'; end if;
      new.delivered_at := coalesce(new.delivered_at, now());
    end if;
  end if;
  return new;
end $$;
create trigger deliveries_rules_t before insert or update on deliveries for each row execute function deliveries_rules();
create trigger deliveries_closed before insert or update on deliveries for each row execute function guard_child_of_closed();

create or replace function deliveries_after() returns trigger language plpgsql security definer set search_path = public as $$
declare prev text := coalesce(current_setting('app.via_fn', true), '');
begin
  if new.status = 'dispatched' and (tg_op = 'INSERT' or old.status is distinct from new.status) then
    perform set_config('app.via_fn', '1', true);
    update orders set delivery_status = 'dispatched' where id = new.order_id and stage <> 'closed' and delivery_status <> 'delivered';
    perform set_config('app.via_fn', prev, true);
  end if;
  return new;
end $$;
create trigger deliveries_after_t after insert or update on deliveries for each row execute function deliveries_after();
revoke execute on function deliveries_rules(), deliveries_after(), delivery_payment_gate() from public, anon, authenticated;
