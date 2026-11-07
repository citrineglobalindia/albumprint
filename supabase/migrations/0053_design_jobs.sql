-- Design jobs, like grading jobs: one 'design' task per order records who is designing, when they started, when they sent it,
-- how many rounds, and an internal note. The order's stage and proofs still drive the workflow; this is the designer's job card.
create unique index if not exists tasks_one_design_per_order on tasks(order_id) where kind = 'design';

alter table production_events drop constraint if exists production_events_area_check;
alter table production_events add constraint production_events_area_check check (area in ('grading', 'printing', 'qc', 'delivery', 'design'));

-- p_action: 'start' (begin or resume after corrections), 'submit' (the proof went to the client), 'note' (save the internal note)
create or replace function design_task(p_order uuid, p_action text, p_note text default null) returns tasks
language plpgsql security definer set search_path = public as $$
declare o orders; t tasks;
begin
  if not (has_perm('design', 'write') or current_app_role() = 'admin') then raise exception 'only designers and admins work on design jobs' using errcode = '42501'; end if;
  if p_action not in ('start', 'submit', 'note') then raise exception 'unknown design action %', p_action using errcode = '22023'; end if;
  select * into o from orders where id = p_order;
  if not found then raise exception 'order not found' using errcode = 'P0002'; end if;
  if o.type <> 'design_printing' then raise exception 'Printing Only orders have no design job' using errcode = '23514'; end if;
  if o.stage = 'closed' then raise exception 'order is closed' using errcode = '23514'; end if;
  select * into t from tasks where order_id = o.id and kind = 'design';
  if not found then
    insert into tasks(order_id, kind, assignee, status, priority, due_at)
      values (o.id, 'design', coalesce(o.assignee, auth.uid()), 'pending', o.priority, o.due_date::timestamptz) returning * into t;
  end if;
  if p_action = 'start' then
    update tasks set status = 'in_progress', started_at = coalesce(started_at, now()), assignee = coalesce(assignee, auth.uid()) where id = t.id returning * into t;
    insert into production_events(order_id, area, text) values (o.id, 'design', case when t.rounds > 0 then 'Design resumed (corrections)' else 'Design started' end);
  elsif p_action = 'submit' then
    update tasks set status = 'submitted', started_at = coalesce(started_at, now()), submitted_at = now(), rounds = rounds + 1 where id = t.id returning * into t;
    insert into production_events(order_id, area, text) values (o.id, 'design', 'Proof sent to the client (round ' || t.rounds || ')');
  else
    update tasks set internal_note = nullif(btrim(coalesce(p_note, '')), '') where id = t.id returning * into t;
  end if;
  return t;
end $$;
revoke execute on function design_task(uuid, text, text) from public, anon;
grant execute on function design_task(uuid, text, text) to authenticated;
