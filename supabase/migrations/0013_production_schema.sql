-- AlbumPro — production module schema: colour grading jobs, printing (stages, exceptions, vendor outsourcing), QC rounds, delivery proof.
-- Rules that guard these tables live in 0014; file rules in 0015.

-- ───────── colour grading (§8): a grading job is a `tasks` row of kind 'grading' ─────────
alter table tasks add column if not exists priority priority_level not null default 'normal';
alter table tasks add column if not exists instructions text;
alter table tasks add column if not exists internal_note text;
alter table tasks add column if not exists draft text;
alter table tasks add column if not exists revision_note text;          -- why admin sent the work back
alter table tasks add column if not exists revision_ack boolean;        -- grader acknowledged the revision request
alter table tasks add column if not exists rounds int not null default 0;   -- submission version: 1 = first submit, 2 = first resubmit …
-- one grading job per order (the app upserts through upsert_grading_task)
create unique index if not exists tasks_one_grading_per_order on tasks (order_id) where kind = 'grading';

-- ───────── shared, append-only activity timeline for the four production pages ─────────
create table production_events (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  area text not null check (area in ('grading','printing','qc','delivery')),
  text text not null check (char_length(btrim(text)) > 0),
  actor uuid references profiles(id) default auth.uid(),
  actor_name text,
  created_at timestamptz not null default now()
);
create index production_events_order_idx on production_events (order_id, area, created_at desc);

-- ───────── printing (§12) ─────────
alter table print_jobs add column if not exists reprints int not null default 0 check (reprints >= 0);
alter table print_jobs add column if not exists cover text;
alter table print_jobs add column if not exists lamination text;
alter table print_jobs add column if not exists box text;
alter table print_jobs add column if not exists finishing text;
alter table print_jobs add column if not exists released_by uuid references profiles(id);
alter table print_jobs add column if not exists created_at timestamptz not null default now();
alter table print_jobs add constraint print_jobs_counts check (coalesce(sheets, 0) >= 0 and coalesce(copies, 1) between 1 and 50) not valid;

-- when each stage was reached, by whom (written by a trigger, never by the client). reprint_no separates a job's passes through the press.
create table print_stage_log (
  id bigint generated always as identity primary key,
  order_id uuid not null references orders(id),
  stage print_stage not null,
  reprint_no int not null default 0,
  at timestamptz not null default now(),
  by uuid references profiles(id) default auth.uid()
);
create index print_stage_log_order_idx on print_stage_log (order_id, at);

create table print_exceptions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  kind text not null check (kind in ('machine_fault','material_shortage','file_issue','customer_hold','delay','reprint')),
  note text not null check (char_length(btrim(note)) > 0),
  raised_by uuid references profiles(id) default auth.uid(),
  raised_at timestamptz not null default now(),
  resolved boolean not null default false,
  resolved_at timestamptz,
  resolved_by uuid references profiles(id)
);
create index print_exceptions_order_idx on print_exceptions (order_id);

create table print_vendor_jobs (                 -- outsourcing to an external printer (one active vendor job per order)
  order_id uuid primary key references orders(id),
  vendor_name text not null check (char_length(btrim(vendor_name)) > 0),
  sent_date date not null,
  expected_back date not null,
  tracking text,
  cost numeric(12,2) not null default 0 check (cost >= 0),
  status text not null default 'planned' check (status in ('planned','sent','in_progress','received')),
  updated_by uuid references profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  check (expected_back >= sent_date)
);

-- ───────── quality control (§13) ─────────
alter table qc_inspections add column if not exists return_to text check (return_to in ('printing','designing','colour_grading'));
alter table qc_inspections add column if not exists reason text;
alter table qc_inspections add column if not exists pending_admin boolean not null default false;   -- return to design/grading awaits an admin override

create table rework_tasks (                      -- QC cannot move an order back to design/grading itself: it files a task for admin
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  dept text not null check (dept in ('printing','designing','colour_grading')),
  reason text not null check (char_length(btrim(reason)) > 0),
  defect_codes text[] not null default '{}',
  created_by uuid references profiles(id) default auth.uid(),
  created_at timestamptz not null default now(),
  status text not null default 'open' check (status in ('open','done')),
  done_by uuid references profiles(id),
  done_at timestamptz
);
create index rework_tasks_order_idx on rework_tasks (order_id);

-- ───────── delivery (§14) ─────────
alter table deliveries add column if not exists contact text;
alter table deliveries add column if not exists pod_note text;
alter table deliveries add column if not exists override_reason text;        -- admin dispatched with dues outstanding
alter table deliveries add column if not exists created_at timestamptz not null default now();

-- ───────── security: grants + row level security + audit ─────────
alter table production_events enable row level security;
alter table print_stage_log   enable row level security;
alter table print_exceptions  enable row level security;
alter table print_vendor_jobs enable row level security;
alter table rework_tasks      enable row level security;

grant select, insert on production_events to authenticated;      -- append-only
grant select on print_stage_log to authenticated;
grant select, insert, update on print_exceptions, print_vendor_jobs, rework_tasks to authenticated;
grant usage, select on all sequences in schema public to authenticated;
revoke all on production_events, print_stage_log, print_exceptions, print_vendor_jobs, rework_tasks from anon;

create policy pev_read   on production_events for select to authenticated using (has_perm('order','view'));
create policy pev_ins    on production_events for insert to authenticated with check (
  has_perm(case area when 'grading' then 'grading' when 'printing' then 'printing' when 'qc' then 'qc' else 'delivery' end, 'write'));
create policy pslog_read on print_stage_log for select to authenticated using (has_perm('printing','view'));
-- stage log rows are written by the print_jobs trigger (security definer), not by clients

create policy pexc_read  on print_exceptions for select to authenticated using (has_perm('printing','view'));
create policy pexc_ins   on print_exceptions for insert to authenticated with check (has_perm('printing','write'));
create policy pexc_upd   on print_exceptions for update to authenticated using (has_perm('printing','write')) with check (has_perm('printing','write'));
create policy pvend_read on print_vendor_jobs for select to authenticated using (has_perm('printing','view'));
create policy pvend_ins  on print_vendor_jobs for insert to authenticated with check (has_perm('printing','write'));
create policy pvend_upd  on print_vendor_jobs for update to authenticated using (has_perm('printing','write')) with check (has_perm('printing','write'));

create policy rw_read    on rework_tasks for select to authenticated using (has_perm('qc','view'));
create policy rw_ins     on rework_tasks for insert to authenticated with check (has_perm('qc','write'));
create policy rw_upd     on rework_tasks for update to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');

do $$ declare t text; begin
  foreach t in array array['tasks','print_exceptions','print_vendor_jobs','rework_tasks'] loop
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', t || '_audit', t);
  end loop; end $$;
