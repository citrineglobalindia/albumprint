-- Colour grading split between graders: the admin divides an order's photos (e.g. 100 = 40 to one grader + 60 to another),
-- can add extra photos later, and can move a grader's pending photos to another (or a new) grader.
-- Each share keeps the photos assigned and the photos that grader has done. The order's grading count (job_progress) is
-- the sum of the shares' done counts, so the existing "every photo graded → sent to the admin" rule keeps working.
create table if not exists grading_shares (
  order_id uuid not null references orders(id) on delete cascade,
  grader uuid not null references profiles(id) on delete cascade,
  assigned int not null default 0 check (assigned >= 0),
  done int not null default 0 check (done >= 0),
  updated_by uuid references profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (order_id, grader),
  check (done <= assigned)
);
alter table grading_shares enable row level security;

drop policy if exists grading_shares_read on grading_shares;
drop policy if exists grading_shares_admin on grading_shares;
drop policy if exists grading_shares_own on grading_shares;
create policy grading_shares_read  on grading_shares for select to authenticated using (has_perm('grading', 'view') or grader = auth.uid());
create policy grading_shares_admin on grading_shares for all    to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create policy grading_shares_own   on grading_shares for update to authenticated using (grader = auth.uid()) with check (grader = auth.uid());
grant select, insert, update, delete on grading_shares to authenticated;

-- a grader may only change their own done count; who gets how many photos is the admin's call
create or replace function grading_shares_guard() returns trigger language plpgsql set search_path = public as $$
begin
  if current_app_role() is distinct from 'admin' and (new.assigned <> old.assigned or new.grader <> old.grader or new.order_id <> old.order_id) then
    raise exception 'only an admin changes how the photos are divided' using errcode = '42501';
  end if;
  new.updated_at := now(); new.updated_by := auth.uid();
  return new;
end $$;
drop trigger if exists grading_shares_guard_t on grading_shares;
create trigger grading_shares_guard_t before update on grading_shares for each row execute function grading_shares_guard();
drop trigger if exists grading_shares_audit on grading_shares;
create trigger grading_shares_audit after insert or update or delete on grading_shares for each row execute function audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'grading_shares') then
    alter publication supabase_realtime add table public.grading_shares;
  end if;
end $$;

notify pgrst, 'reload schema';
