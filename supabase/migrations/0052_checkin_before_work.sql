-- Attendance comes first: staff must be checked in (and not on a break) to work on jobs.
-- Settings › Workflow › "Staff Must Check In Before Working" (settings 'workflow'.wf_require_checkin, on by default).
-- Admins are never blocked; neither are the client's proof link (no staff role) and server jobs.
-- why the signed-in person may not work right now, or null when they may
create or replace function duty_block_reason() returns text language sql stable security definer set search_path = public as $$
  select case
    when current_app_role() is null or current_app_role() = 'admin' then null
    when not coalesce((select (value->>'wf_require_checkin')::boolean from settings where key = 'workflow'), true) then null
    else (select case coalesce(max(k), '') when 'check_in' then null when 'break_end' then null
                   when 'break_start' then 'you are on a break: end your break (Attendance › My day) to continue working'
                   when 'check_out' then 'you have checked out for today: check in again (Attendance › My day) to continue working'
                   else 'check in first: you are not checked in for today (Attendance › My day)' end
          from (select e.kind k from attendance_events e
                 where e.user_id = auth.uid() and e.work_date = (now() at time zone 'Asia/Kolkata')::date and e.superseded_at is null
                 order by e.at desc, e.seq desc limit 1) last)
  end
$$;
create or replace function on_duty() returns boolean language sql stable security definer set search_path = public as $$ select duty_block_reason() is null $$;
revoke execute on function duty_block_reason() from public, anon;
grant execute on function duty_block_reason() to authenticated;
revoke execute on function on_duty() from public, anon;
grant execute on function on_duty() to authenticated;

create or replace function require_on_duty() returns trigger language plpgsql set search_path = public as $$
declare r text;
begin
  if tg_table_name = 'orders' then                                       -- on orders, only stage moves count as work
    if tg_op <> 'UPDATE' then return new; end if;
    if new.stage is not distinct from old.stage then return new; end if;
  end if;
  r := duty_block_reason();
  if r is not null then raise exception '%', r using errcode = '42501'; end if;
  return coalesce(new, old);
end $$;

do $$
declare t text;
begin
  foreach t in array array['orders', 'tasks', 'order_files', 'print_jobs', 'print_stage_log', 'qc_inspections', 'proofs', 'deliveries'] loop
    execute format('drop trigger if exists %I on %I', t || '_on_duty_t', t);
    execute format('create trigger %I before insert or update on %I for each row execute function require_on_duty()', t || '_on_duty_t', t);
  end loop;
end $$;

-- on by default (the admin can switch it off in Settings › Workflow)
insert into settings(key, value) values ('workflow', '{"wf_require_checkin": true}')
  on conflict (key) do update set value = settings.value || jsonb_build_object('wf_require_checkin', coalesce((settings.value->>'wf_require_checkin')::boolean, true));
