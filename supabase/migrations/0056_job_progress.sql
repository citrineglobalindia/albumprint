-- Work counts and status updates, per order and department, kept by the people doing the work:
--   order    : photos given by the customer (optional, at order time)
--   grading  : photos graded so far
--   design   : sheets designed so far
--   printing / qc / delivery : status only
-- status is the person's own update (working, waiting for files, waiting for client, paused, done) with an optional note.
create table if not exists job_progress (
  order_id uuid not null references orders(id) on delete cascade,
  dept text not null check (dept in ('order', 'grading', 'design', 'printing', 'qc', 'delivery')),
  count int check (count is null or count >= 0),
  status text check (status is null or status in ('not_started', 'working', 'waiting_files', 'waiting_client', 'paused', 'done')),
  note text check (note is null or length(note) <= 300),
  updated_by uuid references profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (order_id, dept)
);
alter table job_progress enable row level security;
create or replace function job_progress_can_write(p_dept text) returns boolean language sql stable security definer set search_path = public as $$
  select current_app_role() = 'admin' or case p_dept
    when 'order' then has_perm('order', 'write')
    when 'grading' then has_perm('grading', 'write')
    when 'design' then has_perm('design', 'write')
    when 'printing' then has_perm('printing', 'write')
    when 'qc' then has_perm('qc', 'write')
    when 'delivery' then has_perm('delivery', 'write')
    else false end
$$;
revoke execute on function job_progress_can_write(text) from public, anon;
grant execute on function job_progress_can_write(text) to authenticated;
drop policy if exists job_progress_read on job_progress; drop policy if exists job_progress_write on job_progress;
create policy job_progress_read on job_progress for select to authenticated using (has_perm('order', 'view'));
create policy job_progress_write on job_progress for all to authenticated using (job_progress_can_write(dept)) with check (job_progress_can_write(dept));
grant select, insert, update, delete on job_progress to authenticated;
create or replace function job_progress_stamp() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists job_progress_stamp_t on job_progress;
create trigger job_progress_stamp_t before insert or update on job_progress for each row execute function job_progress_stamp();
drop trigger if exists job_progress_audit on job_progress;
create trigger job_progress_audit after insert or update or delete on job_progress for each row execute function audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'job_progress') then
    alter publication supabase_realtime add table public.job_progress;
  end if;
end $$;
