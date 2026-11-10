-- Extra modules (0057) also count when an order moves to the next stage: a Reception user with the Designing module may send a design to
-- the client, one with Printing may send printing to QC, one with QC may pass QC. Module → the role it stands in for:
--   grading → colour, design → designer, printing → printing, qc → qc, delivery → reception.
create or replace function acts_as(p_role app_role) returns boolean language sql stable security definer set search_path = public as $$
  select current_app_role() = p_role or exists (
    select 1 from user_modules um join profiles p on p.id = um.user_id and p.active
    where um.user_id = auth.uid() and um.module = case p_role when 'colour' then 'grading' when 'designer' then 'design' when 'printing' then 'printing' when 'qc' then 'qc' when 'reception' then 'delivery' else '-' end)
$$;
revoke execute on function acts_as(app_role) from public, anon;
grant execute on function acts_as(app_role) to authenticated;

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
