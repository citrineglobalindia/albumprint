-- Auto-assign: when an order reaches a department's stage, the admin's rule for that stage picks the person.
-- settings 'auto_assign' = {"colour_grading": {"mode": "least_busy"}, "designing": {"mode": "person", "person": "<profile id>"}, "printing": {"mode": "off"}, ...}
--   least_busy — the active staff member of that department with the fewest open orders (ties: by name)
--   person     — always that staff member (when active and in that department)
-- The order's assignee is set as the stage changes; at Colour Grading the grading job is assigned too. Manual assignment still works.

create or replace function auto_assign_role(p_stage stage_key) returns app_role language sql immutable set search_path = public as $$
  select case p_stage when 'colour_grading' then 'colour' when 'designing' then 'designer' when 'printing' then 'printing' when 'qc' then 'qc' end::app_role
$$;

create or replace function auto_assign_pick(p_stage stage_key) returns uuid language plpgsql stable security definer set search_path = public as $$
declare r jsonb; mode text; who uuid; rl app_role := auto_assign_role(p_stage);
begin
  if rl is null then return null; end if;
  select value -> p_stage::text into r from settings where key = 'auto_assign';
  mode := coalesce(r->>'mode', 'off');
  if mode = 'person' then
    select id into who from profiles where id = nullif(r->>'person', '')::uuid and active and role = rl;
    return who;
  elsif mode = 'least_busy' then
    select p.id into who from profiles p
      where p.active and p.role = rl
      order by (select count(*) from orders o where o.assignee = p.id and o.stage not in ('ready_for_delivery', 'delivered', 'closed', 'cancelled')), p.full_name, p.id
      limit 1;
    return who;
  end if;
  return null;
end $$;
revoke execute on function auto_assign_pick(stage_key) from public, anon, authenticated;
revoke execute on function auto_assign_role(stage_key) from public, anon, authenticated;

create or replace function orders_auto_assign() returns trigger language plpgsql security definer set search_path = public as $$
declare who uuid;
begin
  if tg_op = 'UPDATE' and new.stage is not distinct from old.stage then return new; end if;
  who := auto_assign_pick(new.stage);
  if who is not null then new.assignee := who; end if;
  return new;
end $$;
revoke execute on function orders_auto_assign() from public, anon, authenticated;
-- named to run after the other "before" checks on orders (they fire in name order)
drop trigger if exists orders_zz_auto_assign_t on orders;
create trigger orders_zz_auto_assign_t before insert or update of stage on orders for each row execute function orders_auto_assign();

create or replace function orders_auto_assign_task() returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- at Colour Grading the grading job follows an automatic assignment
  if new.stage = 'colour_grading' and new.type <> 'printing_only' and new.assignee is not null
     and (tg_op = 'INSERT' or new.stage is distinct from old.stage) and auto_assign_pick(new.stage) = new.assignee then
    perform set_config('app.auto_assign', '1', true);
    perform upsert_grading_task(new.id, new.assignee, new.priority);
    perform set_config('app.auto_assign', '', true);
  end if;
  return null;
end $$;
revoke execute on function orders_auto_assign_task() from public, anon, authenticated;
drop trigger if exists orders_zz_auto_assign_task_t on orders;
create trigger orders_zz_auto_assign_task_t after insert or update of stage on orders for each row execute function orders_auto_assign_task();

-- the grading-job rules accept the automatic assignment (same function as 0014 otherwise)
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

insert into settings(key, value) values ('auto_assign', '{}'::jsonb) on conflict (key) do nothing;
