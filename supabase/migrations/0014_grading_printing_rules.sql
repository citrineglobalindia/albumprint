-- AlbumPro — production rules, part 1: colour grading (§8) and printing (§12) enforced in the database.

-- ───────── colour grading ─────────
-- Admin (or the system) assigns/creates the job. Graders may open a blank job for an order that is at Colour Grading.
create or replace function upsert_grading_task(p_order uuid, p_assignee uuid default null, p_priority priority_level default 'normal',
                                               p_due timestamptz default null, p_instructions text default null)
returns tasks language plpgsql set search_path = public as $$
declare t tasks;
begin
  insert into tasks(order_id, kind, assignee, priority, due_at, instructions)
  values (p_order, 'grading', p_assignee, p_priority, p_due, nullif(btrim(coalesce(p_instructions, '')), ''))
  on conflict (order_id) where kind = 'grading' do update set
    assignee = coalesce(excluded.assignee, tasks.assignee), priority = excluded.priority, due_at = coalesce(excluded.due_at, tasks.due_at),
    instructions = coalesce(excluded.instructions, tasks.instructions)
  returning * into t;
  return t;
end $$;
revoke execute on function upsert_grading_task(uuid, uuid, priority_level, timestamptz, text) from public, anon;
grant execute on function upsert_grading_task(uuid, uuid, priority_level, timestamptz, text) to authenticated;

create or replace function tasks_grading_rules() returns trigger language plpgsql set search_path = public as $$
declare o orders; approver boolean := has_perm('grading_approve', 'approve') or is_system();
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
      if not exists (select 1 from order_files where order_id = new.order_id and category = 'graded' and not archived) then
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
create trigger tasks_grading_rules_t before insert or update on tasks for each row execute function tasks_grading_rules();

-- Graded file states follow the job: submit → Submitted, approve → Approved, send back → Rejected.
create or replace function tasks_sync_graded_files() returns trigger language plpgsql security definer set search_path = public as $$
declare prev text := coalesce(current_setting('app.via_fn', true), '');
begin
  if new.kind <> 'grading' or new.status is not distinct from old.status then return new; end if;
  perform set_config('app.via_fn', '1', true);
  if new.status = 'submitted' then
    update order_files set state = 'submitted' where order_id = new.order_id and category = 'graded' and not archived and state in ('draft', 'rejected');
  elsif new.status = 'approved' then
    update order_files set state = 'approved' where order_id = new.order_id and category = 'graded' and not archived and state = 'submitted';
  elsif new.status = 'revision' then
    update order_files set state = 'rejected' where order_id = new.order_id and category = 'graded' and not archived and state = 'submitted';
  end if;
  perform set_config('app.via_fn', prev, true);
  return new;
end $$;
create trigger tasks_sync_files_t after update on tasks for each row execute function tasks_sync_graded_files();
revoke execute on function tasks_grading_rules(), tasks_sync_graded_files() from public, anon, authenticated;

-- ───────── printing ─────────
create or replace function print_jobs_rules() returns trigger language plpgsql set search_path = public as $$
declare o orders; stages print_stage[] := enum_range(null::print_stage); oi int; ni int;
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then new.released_by := coalesce(new.released_by, auth.uid()); new.reprints := 0; return new; end if;
  oi := array_position(stages, old.stage); ni := array_position(stages, new.stage);
  select * into o from orders where id = new.order_id;
  if new.reprints is distinct from old.reprints then
    if new.reprints <> old.reprints + 1 then raise exception 'reprints are counted one at a time' using errcode = '23514'; end if;
    if oi < 3 then raise exception 'nothing to reprint yet' using errcode = '23514'; end if;
    if new.stage <> 'printing' then raise exception 'a reprint restarts the job at Printing' using errcode = '23514'; end if;
  elsif new.stage is distinct from old.stage then
    if ni <> oi + 1 then raise exception 'production stages must be completed in order' using errcode = '23514'; end if;
    if o.on_hold then raise exception 'order is on hold: resolve the hold first' using errcode = '23514'; end if;
    if exists (select 1 from print_exceptions where order_id = new.order_id and not resolved and kind <> 'delay') then
      raise exception 'resolve the open exception first' using errcode = '23514';
    end if;
    if ni > 3 and exists (select 1 from print_vendor_jobs where order_id = new.order_id and status not in ('received', 'planned')) then
      raise exception 'vendor job is not back yet: mark it received first' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger print_jobs_rules_t before insert or update on print_jobs for each row execute function print_jobs_rules();
create trigger print_jobs_closed before insert or update on print_jobs for each row execute function guard_child_of_closed();

-- stage timestamps + keep orders.print_status truthful
create or replace function print_jobs_after() returns trigger language plpgsql security definer set search_path = public as $$
declare prev text := coalesce(current_setting('app.via_fn', true), '');
begin
  if tg_op = 'INSERT' or new.stage is distinct from old.stage or new.reprints is distinct from old.reprints then
    insert into print_stage_log(order_id, stage, reprint_no, by) values (new.order_id, new.stage, new.reprints, auth.uid());
    perform set_config('app.via_fn', '1', true);
    update orders set print_status = new.stage where id = new.order_id and stage <> 'closed' and print_status is distinct from new.stage;
    perform set_config('app.via_fn', prev, true);
  end if;
  return new;
end $$;
create trigger print_jobs_after_t after insert or update on print_jobs for each row execute function print_jobs_after();

create or replace function print_exceptions_rules() returns trigger language plpgsql set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.resolved and new.kind <> 'reprint' then raise exception 'an exception starts unresolved' using errcode = '23514'; end if;
    new.raised_by := coalesce(new.raised_by, auth.uid());
    return new;
  end if;
  if new.order_id is distinct from old.order_id or new.kind is distinct from old.kind or new.note is distinct from old.note or new.raised_at is distinct from old.raised_at then
    raise exception 'exceptions cannot be edited; resolve them' using errcode = '23514';
  end if;
  if old.resolved and not new.resolved then raise exception 'a resolved exception cannot be reopened' using errcode = '23514'; end if;
  if new.resolved and not old.resolved then new.resolved_at := now(); new.resolved_by := auth.uid(); end if;
  return new;
end $$;
create trigger print_exceptions_rules_t before insert or update on print_exceptions for each row execute function print_exceptions_rules();
create trigger print_exceptions_closed before insert or update on print_exceptions for each row execute function guard_child_of_closed();

create or replace function print_vendor_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  update print_jobs set outsourced_to = new.vendor_name where order_id = new.order_id and outsourced_to is distinct from new.vendor_name;
  return new;
end $$;
create trigger print_vendor_after_t after insert or update on print_vendor_jobs for each row execute function print_vendor_after();
create or replace function print_vendor_stamp() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := coalesce(auth.uid(), new.updated_by); return new; end $$;
create trigger print_vendor_stamp_t before insert or update on print_vendor_jobs for each row execute function print_vendor_stamp();
create trigger print_vendor_closed before insert or update on print_vendor_jobs for each row execute function guard_child_of_closed();
revoke execute on function print_jobs_rules(), print_jobs_after(), print_exceptions_rules(), print_vendor_after(), print_vendor_stamp() from public, anon, authenticated;
