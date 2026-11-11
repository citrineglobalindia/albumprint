-- Design + Printing process, album-wise:
--   order → colour grading (per album) → admin approves → designing (per album) → the designer records the client's approval
--   (taken manually, e.g. on WhatsApp) → admin's final approval → lab (albums with a lab are marked 'sent') → received → QC → delivery.
-- 1. A design status 'client_approved' (job_progress); designers may move Client Review → Final Approval.
-- 2. Final approval → Printing accepts the client's approval recorded by the designer instead of an approved proof link.
-- 3. When an order moves to Printing, every album with a lab chosen and not yet sent is marked 'sent' (who and when, server clock).
alter table job_progress drop constraint if exists job_progress_status_check;
alter table job_progress add constraint job_progress_status_check check (status is null or status in ('not_started', 'working', 'waiting_files', 'waiting_client', 'paused', 'done', 'client_approved'));
update stage_transitions set allowed_roles = array(select distinct unnest(allowed_roles || array['designer']::app_role[]))
  where order_type = 'design_printing' and from_stage = 'client_review' and to_stage = 'final_approval';

-- the client's approval recorded by the designer: on the order's own design row, or on every album's design row
create or replace function client_approved_manually(p_order uuid) returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from job_progress where order_id = p_order and dept = 'design' and album = 0 and status = 'client_approved')
      or (exists (select 1 from order_albums where order_id = p_order)
          and not exists (select 1 from order_albums oa where oa.order_id = p_order
                            and not exists (select 1 from job_progress jp where jp.order_id = p_order and jp.dept = 'design' and jp.album = oa.position and jp.status = 'client_approved')))
$$;
revoke execute on function client_approved_manually(uuid) from public, anon;
grant execute on function client_approved_manually(uuid) to authenticated;

-- stage moves (0062) with the manual client approval accepted at final approval
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
     and not exists (select 1 from proofs where order_id = o.id and status = 'approved')
     and not client_approved_manually(o.id) then
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

-- on the way to the lab: albums with a lab chosen are marked sent when the order moves to Printing
create or replace function orders_send_albums_to_lab() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.stage = 'printing' and old.stage is distinct from 'printing' and old.stage <> 'qc' then
    update album_labs set status = 'sent' where order_id = new.id and lab_id is not null and status = 'not_sent';
  end if;
  return new;
end $$;
drop trigger if exists orders_send_albums_to_lab_t on orders;
create trigger orders_send_albums_to_lab_t after update of stage on orders for each row execute function orders_send_albums_to_lab();
