-- Attendance (check-in / check-out ledger).
--  * attendance_events is an APPEND-ONLY ledger. Staff can only add a row through attendance_punch(), which stamps the server clock
--    (no back-dating) and enforces the in → (break) → out sequence. Rows are never edited or deleted; an admin correction supersedes the
--    day's old rows (kept for the record) and writes new ones with the reason. Day totals, late/half-day status and the running hours
--    balance are derived from the ledger by the app.
--  * attendance_leaves: requests with admin approval.   * attendance_settings: shift, grace, weekly off and holidays.
create table attendance_settings (
  id boolean primary key default true check (id),
  shift_start time not null default '09:30',
  shift_end time not null default '18:30',
  grace_minutes int not null default 15 check (grace_minutes between 0 and 180),
  half_day_hours numeric(4,2) not null default 4 check (half_day_hours between 0 and 24),
  full_day_hours numeric(4,2) not null default 8 check (full_day_hours between 0 and 24),
  weekly_off int[] not null default '{0}' check (weekly_off <@ array[0,1,2,3,4,5,6]),
  holidays jsonb not null default '[]' check (jsonb_typeof(holidays) = 'array'),
  updated_at timestamptz not null default now(),
  updated_by uuid references profiles(id) default auth.uid(),
  check (half_day_hours <= full_day_hours)
);
insert into attendance_settings default values;
alter table attendance_settings enable row level security;
revoke all on attendance_settings from anon;
grant select, insert, update on attendance_settings to authenticated;
create policy att_settings_read  on attendance_settings for select to authenticated using (current_app_role() is not null);
create policy att_settings_write on attendance_settings for update to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create trigger attendance_settings_audit after update on attendance_settings for each row execute function audit_admin_row();

create table attendance_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  user_id uuid not null references profiles(id),
  kind text not null check (kind in ('check_in', 'check_out', 'break_start', 'break_end')),
  at timestamptz not null default now(),
  work_date date not null default ((now() at time zone 'Asia/Kolkata')::date),
  note text check (note is null or char_length(note) <= 300),
  source text not null default 'web' check (source in ('web', 'admin')),
  reason text,
  created_by uuid references profiles(id) default auth.uid(),
  superseded_at timestamptz,
  superseded_by uuid references profiles(id)
);
create index attendance_events_user_day on attendance_events(user_id, work_date, at, seq);
create index attendance_events_day on attendance_events(work_date);
alter table attendance_events enable row level security;
revoke all on attendance_events from anon, authenticated;
grant select on attendance_events to authenticated;                         -- no insert/update/delete: only the functions below write
create policy att_events_read on attendance_events for select to authenticated using (current_app_role() is not null and (user_id = auth.uid() or current_app_role() = 'admin'));

-- the ledger is immutable: the only change ever allowed is stamping a row as superseded by an admin correction
create or replace function attendance_events_immutable() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'attendance records cannot be deleted'; end if;
  if (to_jsonb(new) - 'superseded_at' - 'superseded_by') is distinct from (to_jsonb(old) - 'superseded_at' - 'superseded_by') or old.superseded_at is not null
    then raise exception 'attendance records cannot be edited'; end if;
  return new;
end $$;
create trigger attendance_events_immutable_t before update or delete on attendance_events for each row execute function attendance_events_immutable();
create trigger attendance_events_audit after insert or update on attendance_events for each row when (new.source = 'admin') execute function audit_admin_row();

-- Staff punch: check_in / break_start / break_end / check_out, in sequence, stamped with the server clock.
create or replace function attendance_punch(p_kind text, p_note text default null) returns attendance_events
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); today date := (now() at time zone 'Asia/Kolkata')::date; last_kind text; r attendance_events;
begin
  if uid is null or current_app_role() is null then raise exception 'not allowed'; end if;
  if p_kind not in ('check_in', 'check_out', 'break_start', 'break_end') then raise exception 'unknown attendance action'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text || today::text));
  select kind into last_kind from attendance_events where user_id = uid and work_date = today and superseded_at is null order by at desc, seq desc limit 1;
  if p_kind = 'check_in' and last_kind in ('check_in', 'break_start', 'break_end') then raise exception 'You are already checked in'; end if;
  if p_kind in ('check_out', 'break_start') and last_kind is null then raise exception 'Check in first'; end if;
  if p_kind in ('check_out', 'break_start') and last_kind = 'check_out' then raise exception 'You are already checked out'; end if;
  if p_kind = 'check_out' and last_kind = 'break_start' then raise exception 'End your break before checking out'; end if;
  if p_kind = 'break_start' and last_kind = 'break_start' then raise exception 'You are already on a break'; end if;
  if p_kind = 'break_end' and last_kind is distinct from 'break_start' then raise exception 'You are not on a break'; end if;
  insert into attendance_events(user_id, kind, note, work_date) values (uid, p_kind, nullif(btrim(p_note), ''), today) returning * into r;
  return r;
end $$;

-- Admin correction for one person and day (IST). Old rows of that day are marked superseded (kept); p_in/p_out null with nothing else = mark no attendance.
create or replace function attendance_adjust(p_user uuid, p_date date, p_in time, p_out time, p_reason text) returns int
language plpgsql security definer set search_path = public as $$
declare n int := 0; who uuid := auth.uid();
begin
  if current_app_role() <> 'admin' then raise exception 'Only an administrator can correct attendance'; end if;
  if p_reason is null or char_length(btrim(p_reason)) < 3 then raise exception 'Give a reason for the correction'; end if;
  if p_date > (now() at time zone 'Asia/Kolkata')::date then raise exception 'Cannot record attendance for a future date'; end if;
  if p_out is not null and p_in is null then raise exception 'Enter the check-in time too'; end if;
  if p_in is not null and p_out is not null and p_out <= p_in then raise exception 'Check-out must be after check-in'; end if;
  if not exists (select 1 from profiles where id = p_user) then raise exception 'Unknown employee'; end if;
  perform pg_advisory_xact_lock(hashtext(p_user::text || p_date::text));
  update attendance_events set superseded_at = now(), superseded_by = who where user_id = p_user and work_date = p_date and superseded_at is null;
  if p_in is not null then
    insert into attendance_events(user_id, kind, at, work_date, source, reason) values (p_user, 'check_in', (p_date + p_in) at time zone 'Asia/Kolkata', p_date, 'admin', btrim(p_reason)); n := n + 1;
  end if;
  if p_out is not null then
    insert into attendance_events(user_id, kind, at, work_date, source, reason) values (p_user, 'check_out', (p_date + p_out) at time zone 'Asia/Kolkata', p_date, 'admin', btrim(p_reason)); n := n + 1;
  end if;
  return n;
end $$;

-- ───────── leave ─────────
create table attendance_leaves (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) default auth.uid(),
  from_date date not null,
  to_date date not null,
  kind text not null check (kind in ('Casual', 'Sick', 'Earned', 'Comp-off', 'Unpaid', 'Half day')),
  reason text not null check (char_length(btrim(reason)) between 3 and 500),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  decided_by uuid references profiles(id),
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  check (to_date >= from_date and to_date - from_date <= 90),
  check (kind <> 'Half day' or from_date = to_date)
);
create index attendance_leaves_user on attendance_leaves(user_id, from_date);
alter table attendance_leaves enable row level security;
revoke all on attendance_leaves from anon, authenticated;
grant select, insert on attendance_leaves to authenticated;
create policy att_leaves_read on attendance_leaves for select to authenticated using (current_app_role() is not null and (user_id = auth.uid() or current_app_role() = 'admin'));
create policy att_leaves_add  on attendance_leaves for insert to authenticated with check (current_app_role() is not null and user_id = auth.uid() and status = 'pending' and decided_by is null);

create or replace function attendance_leave_check() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from attendance_leaves l where l.user_id = new.user_id and l.status in ('pending', 'approved') and l.from_date <= new.to_date and l.to_date >= new.from_date) then
    raise exception 'You already have a leave request covering these dates';
  end if;
  insert into notifications(user_id, title, body, link)
    select p.id, 'Leave request: ' || (select full_name from profiles where id = new.user_id), new.kind || ' leave ' || new.from_date || case when new.to_date <> new.from_date then ' to ' || new.to_date else '' end || ' — ' || btrim(new.reason), '/attendance'
    from profiles p where p.active and p.role = 'admin' and p.id <> new.user_id;
  return new;
end $$;
create trigger attendance_leave_check_t before insert on attendance_leaves for each row execute function attendance_leave_check();
create trigger attendance_leaves_audit after insert or update on attendance_leaves for each row execute function audit_admin_row();

create or replace function attendance_leave_decide(p_id uuid, p_approve boolean, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
declare l attendance_leaves;
begin
  if current_app_role() <> 'admin' then raise exception 'Only an administrator can decide leave'; end if;
  select * into l from attendance_leaves where id = p_id for update;
  if not found then raise exception 'Leave request not found'; end if;
  if l.status <> 'pending' then raise exception 'This request was already %', l.status; end if;
  update attendance_leaves set status = case when p_approve then 'approved' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = nullif(btrim(p_note), '') where id = p_id;
  insert into notifications(user_id, title, body, link) values (l.user_id, 'Leave ' || case when p_approve then 'approved' else 'rejected' end,
    l.kind || ' leave ' || l.from_date || case when l.to_date <> l.from_date then ' to ' || l.to_date else '' end || coalesce(' — ' || nullif(btrim(p_note), ''), ''), '/attendance');
end $$;

create or replace function attendance_leave_cancel(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update attendance_leaves set status = 'cancelled', decided_at = now() where id = p_id and user_id = auth.uid() and status = 'pending';
  if not found then raise exception 'Only your own pending request can be cancelled'; end if;
end $$;

revoke execute on function attendance_punch(text, text), attendance_adjust(uuid, date, time, time, text), attendance_leave_decide(uuid, boolean, text), attendance_leave_cancel(uuid) from public, anon;
grant execute on function attendance_punch(text, text), attendance_adjust(uuid, date, time, time, text), attendance_leave_decide(uuid, boolean, text), attendance_leave_cancel(uuid) to authenticated;
revoke execute on function attendance_events_immutable(), attendance_leave_check() from public, anon, authenticated;
