-- Designer-side state that used to live only in the browser: album layout, review flags/notes, admin corrections.
create table design_docs (
  order_id uuid primary key references orders(id),
  layout jsonb not null default '{}',     -- {tpl, spreads:[{id, bg, overlays:[…]}]}
  meta jsonb not null default '{}',       -- {submitted, adminApproved, submittedAt, notes:[{text,by,when}]}
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
create table design_corrections (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id),
  code text not null,                      -- COR-001 …
  page int not null check (page >= 1),
  text text not null check (char_length(text) between 1 and 2000),
  by_name text not null default 'Admin',
  assignee text not null default '',
  status text not null default 'Open' check (status in ('Open','In Progress','Resolved')),
  created_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index design_corrections_order_idx on design_corrections(order_id);

create or replace function design_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_table_name = 'design_docs' then new.updated_by := coalesce(auth.uid(), new.updated_by);
  elsif tg_op = 'INSERT' then new.created_by := coalesce(auth.uid(), new.created_by); end if;
  return new;
end $$;
create trigger design_docs_stamp before insert or update on design_docs for each row execute function design_stamp();
create trigger design_corr_stamp before insert or update on design_corrections for each row execute function design_stamp();
create trigger design_docs_closed before insert or update on design_docs for each row execute function guard_child_of_closed();
create trigger design_corr_closed before insert or update on design_corrections for each row execute function guard_child_of_closed();
revoke execute on function design_stamp() from public, anon, authenticated;

alter table design_docs enable row level security;
alter table design_corrections enable row level security;
grant select, insert, update on design_docs, design_corrections to authenticated;
create policy dd_read  on design_docs for select to authenticated using (has_perm('design','view'));
create policy dd_ins   on design_docs for insert to authenticated with check (has_perm('design','write'));
create policy dd_upd   on design_docs for update to authenticated using (has_perm('design','write')) with check (has_perm('design','write'));
create policy dc_read  on design_corrections for select to authenticated using (has_perm('client_correction','view') or has_perm('design','view'));
create policy dc_ins   on design_corrections for insert to authenticated with check (has_perm('client_correction','write') or has_perm('design','write'));
create policy dc_upd   on design_corrections for update to authenticated using (has_perm('client_correction','write') or has_perm('design','write'))
                                                                       with check (has_perm('client_correction','write') or has_perm('design','write'));
