-- File uploads are optional unless the admin turns on Settings › Workflow › "Require file uploads" (settings 'workflow'.wf_require_uploads).
-- Many studios hand over big TIFFs by drive link or disk, so a grader can submit, and a printing-only order can go to Printing, without an upload.
create or replace function uploads_required() returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (value->>'wf_require_uploads')::boolean from settings where key = 'workflow'), false)
$$;
revoke execute on function uploads_required() from public, anon;
grant execute on function uploads_required() to authenticated;

-- grading: "upload at least one graded file before submitting" only when required (otherwise as 0047)
create or replace function tasks_grading_rules() returns trigger language plpgsql set search_path = public as $$
declare o orders; approver boolean := has_perm('grading_approve', 'approve') or is_system() or coalesce(current_setting('app.auto_assign', true), '') = '1';   -- auto-assign (0047) may assign
begin
  if new.kind <> 'grading' then return new; end if;
  select * into o from orders where id = new.order_id;
  if o.type = 'printing_only' then raise exception 'Printing Only orders skip colour grading' using errcode = '23514'; end if;
  if tg_op = 'INSERT' then
    if new.assignee is not null and not (approver or current_app_role() = 'admin') then raise exception 'only an admin assigns grading jobs' using errcode = '42501'; end if;
    new.status := 'pending'; new.rounds := 0;
    return new;
  end if;
  if new.assignee is distinct from old.assignee or new.priority is distinct from old.priority or new.due_at is distinct from old.due_at or new.instructions is distinct from old.instructions then
    if not (approver or current_app_role() = 'admin') then raise exception 'only an admin changes the assignment of a grading job' using errcode = '42501'; end if;
  end if;
  if new.status is distinct from old.status then
    if not (
         (old.status = 'pending'     and new.status = 'in_progress')
      or (old.status = 'in_progress' and new.status = 'submitted')
      or (old.status = 'submitted'   and new.status in ('approved', 'revision'))
      or (old.status = 'approved'    and new.status = 'revision')                     -- QC or admin sends approved work back
      or (old.status = 'revision'    and new.status = 'in_progress')) then
      raise exception 'grading job cannot go from % to %', old.status, new.status using errcode = '23514';
    end if;
    if o.on_hold then raise exception 'order is on hold' using errcode = '23514'; end if;
    if new.status = 'in_progress' and old.status = 'pending' then new.started_at := coalesce(new.started_at, now()); end if;
    if new.status = 'in_progress' and old.status = 'revision' then new.revision_ack := true; end if;
    if new.status = 'submitted' then
      if uploads_required() and not exists (select 1 from order_files where order_id = new.order_id and category = 'graded' and not archived) then
        raise exception 'upload at least one graded file before submitting' using errcode = '23514';
      end if;
      new.rounds := old.rounds + 1; new.submitted_at := now(); new.revision_note := null; new.revision_ack := null;
    end if;
    if new.status in ('approved', 'revision') then       -- graders cannot approve or reject their own work (§21)
      if old.status = 'submitted' and not approver then raise exception 'only an admin can approve or reject grading' using errcode = '42501'; end if;
      if old.status = 'approved' and not (approver or has_perm('qc', 'write')) then raise exception 'only admin or QC can send approved grading back' using errcode = '42501'; end if;
      if new.status = 'revision' then
        if btrim(coalesce(new.revision_note, '')) = '' then raise exception 'a revision reason is required' using errcode = '23514'; end if;
        new.revision_ack := false;
      end if;
    end if;
  elsif new.status = 'in_progress' and old.status = 'in_progress' then
    null;   -- saving a draft / note
  elsif old.status in ('submitted', 'approved') and (new.draft is distinct from old.draft or new.internal_note is distinct from old.internal_note) then
    raise exception 'submitted grading is read-only' using errcode = '23514';
  end if;
  if new.rounds is distinct from old.rounds and new.status is not distinct from old.status then new.rounds := old.rounds; end if;   -- rounds only move on submit
  return new;
end $$;

-- advance_order: "a print-ready file is required before printing" only when required (otherwise unchanged)
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
    if not sysc and not (r = any(t.allowed_roles)) then raise exception 'role % may not move % -> %', r, o.stage, p_to using errcode = '42501'; end if;
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
