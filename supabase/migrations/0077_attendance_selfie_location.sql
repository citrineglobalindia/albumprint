-- Attendance: an optional selfie and the location with each punch (check in / out, breaks). Neither is required —
-- if the camera or location is refused the punch still goes through. Attendance records stay unchangeable, so both are
-- saved with the punch itself. Selfies live in the private bucket `attendance-selfies` under <user id>/…; a person sees
-- their own, the admin sees everyone's (the same rule as the attendance records).

alter table attendance_events
  add column if not exists selfie_path text,
  add column if not exists lat double precision check (lat is null or lat between -90 and 90),
  add column if not exists lng double precision check (lng is null or lng between -180 and 180),
  add column if not exists accuracy_m real check (accuracy_m is null or accuracy_m >= 0);

insert into storage.buckets (id, name, public, file_size_limit) values ('attendance-selfies', 'attendance-selfies', false, 5242880)
  on conflict (id) do nothing;
drop policy if exists att_selfie_upload on storage.objects;
drop policy if exists att_selfie_read on storage.objects;
create policy att_selfie_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'attendance-selfies' and current_app_role() is not null and name like auth.uid()::text || '/%');
create policy att_selfie_read on storage.objects for select to authenticated
  using (bucket_id = 'attendance-selfies' and (name like auth.uid()::text || '/%' or current_app_role() = 'admin'));

-- the punch, now with the optional selfie and location (the old two-argument calls keep working through the defaults)
drop function if exists attendance_punch(text, text);
create function attendance_punch(p_kind text, p_note text default null, p_selfie text default null,
                                 p_lat double precision default null, p_lng double precision default null, p_accuracy real default null) returns attendance_events
language plpgsql security definer set search_path = public as $$
declare uid uuid := auth.uid(); today date := (now() at time zone 'Asia/Kolkata')::date; last_kind text; r attendance_events;
begin
  if uid is null or current_app_role() is null then raise exception 'not allowed'; end if;
  if p_kind not in ('check_in', 'check_out', 'break_start', 'break_end') then raise exception 'unknown attendance action'; end if;
  if p_selfie is not null and p_selfie not like uid::text || '/%' then raise exception 'that selfie is not yours'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text || today::text));
  select kind into last_kind from attendance_events where user_id = uid and work_date = today and superseded_at is null order by at desc, seq desc limit 1;
  if p_kind = 'check_in' and last_kind in ('check_in', 'break_start', 'break_end') then raise exception 'You are already checked in'; end if;
  if p_kind in ('check_out', 'break_start') and last_kind is null then raise exception 'Check in first'; end if;
  if p_kind in ('check_out', 'break_start') and last_kind = 'check_out' then raise exception 'You are already checked out'; end if;
  if p_kind = 'check_out' and last_kind = 'break_start' then raise exception 'End your break before checking out'; end if;
  if p_kind = 'break_start' and last_kind = 'break_start' then raise exception 'You are already on a break'; end if;
  if p_kind = 'break_end' and last_kind is distinct from 'break_start' then raise exception 'You are not on a break'; end if;
  insert into attendance_events(user_id, kind, note, work_date, selfie_path, lat, lng, accuracy_m)
    values (uid, p_kind, nullif(btrim(p_note), ''), today, p_selfie,
            case when p_lat between -90 and 90 then p_lat end, case when p_lng between -180 and 180 then p_lng end, case when p_accuracy >= 0 then p_accuracy end)
    returning * into r;
  return r;
end $$;
revoke execute on function attendance_punch(text, text, text, double precision, double precision, real) from public, anon;
grant execute on function attendance_punch(text, text, text, double precision, double precision, real) to authenticated;

notify pgrst, 'reload schema';
