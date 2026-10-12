-- Scheduled reports (SRS 19.3) are stored in the database, shared by every admin, and checked by a job. When one comes due, its recipients get an
-- in-app notification (with a link to download it). Email delivery is added when a messaging provider is connected.
create table report_schedules (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 120),
  report text not null default 'Custom Report',
  metrics text[] not null default '{}',
  group_by text,
  filters jsonb not null default '{}',
  freq text not null check (freq in ('Daily', 'Weekly', 'Monthly')),
  day text,
  run_time text not null check (run_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  format text not null default 'CSV' check (format in ('CSV', 'Excel', 'PDF')),
  recipients text[] not null check (cardinality(recipients) between 1 and 20),
  active boolean not null default true,
  last_run_at timestamptz not null default now(),          -- a new schedule starts counting from now
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now()
);
alter table report_schedules enable row level security;
revoke all on report_schedules from anon;
grant select, insert, update, delete on report_schedules to authenticated;
create policy rsched_admin on report_schedules for all to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create trigger report_schedules_audit after insert or update on report_schedules for each row execute function audit_admin_row();

-- The most recent moment (Asia/Kolkata) this schedule should have run.
create or replace function report_schedule_due(s report_schedules, p_now timestamptz default now()) returns timestamptz
language plpgsql stable set search_path = public as $$
declare ln timestamp := p_now at time zone 'Asia/Kolkata'; t time := s.run_time::time; d date; due timestamp; target int; dom int;
begin
  if s.freq = 'Daily' then
    due := ln::date + t; if due > ln then due := due - interval '1 day'; end if;
  elsif s.freq = 'Weekly' then
    target := case s.day when 'Monday' then 1 when 'Tuesday' then 2 when 'Wednesday' then 3 when 'Thursday' then 4 when 'Friday' then 5 when 'Saturday' then 6 else 7 end;
    d := ln::date - ((extract(isodow from ln)::int - target + 7) % 7);
    due := d + t; if due > ln then due := due - interval '7 days'; end if;
  else
    for i in 0..1 loop
      d := (date_trunc('month', ln) - make_interval(months => i))::date;
      dom := case s.day when 'Last day' then extract(day from (d + interval '1 month - 1 day'))::int else coalesce(nullif(regexp_replace(coalesce(s.day, '1'), '[^0-9]', '', 'g'), '')::int, 1) end;
      due := (d + (least(dom, extract(day from (d + interval '1 month - 1 day'))::int) - 1)) + t;
      exit when due <= ln;
    end loop;
  end if;
  return due at time zone 'Asia/Kolkata';
end $$;
revoke execute on function report_schedule_due(report_schedules, timestamptz) from public, anon, authenticated;

-- Called by the scheduler job: notifies the recipients of every schedule that came due since it last ran.
create or replace function run_report_schedules() returns int language plpgsql security definer set search_path = public as $$
declare s report_schedules; n int := 0;
begin
  for s in select * from report_schedules where active loop
    if report_schedule_due(s) > s.last_run_at then
      insert into notifications(user_id, title, body, link)
        select p.id, 'Scheduled report ready: ' || s.name, s.freq || ' report "' || s.name || '" (' || s.format || ') is due. Open Reports to download it.', '/reports'
        from profiles p where p.active and (p.role = 'admin' or lower(p.email) = any (select lower(r) from unnest(s.recipients) r));
      update report_schedules set last_run_at = now() where id = s.id;
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
revoke execute on function run_report_schedules() from public, anon, authenticated;

-- run it every 15 minutes where pg_cron exists (Supabase); plain Postgres (tests) skips this
do $$ begin
  create extension if not exists pg_cron;
  perform cron.schedule('albumpro-report-schedules', '*/15 * * * *', 'select public.run_report_schedules()');
exception when others then raise notice 'pg_cron not available: %', sqlerrm;
end $$;
