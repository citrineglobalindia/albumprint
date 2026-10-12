-- An order can contain several albums, each with its own specification. order_specs keeps album #1 (printing, proofs and QC read it);
-- order_albums holds every album, in order, with its own specification. couple_name is the name of the couple on the order.
alter table orders add column if not exists couple_name text;

create table order_albums (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  position int not null check (position >= 1),
  album_type text not null, album_size text not null,
  orientation text not null check (orientation in ('landscape','portrait','square')),
  pages int not null check (pages > 0), copies int not null default 1 check (copies >= 1),
  paper_type text not null, paper_gsm int,
  cover_type text not null, lamination text, binding text not null,
  box_type text, finishes text[] not null default '{}', name_printing text,
  created_at timestamptz not null default now(),
  unique (order_id, position)
);
alter table order_albums enable row level security;
revoke all on order_albums from anon;
grant select, insert, update on order_albums to authenticated;
create policy albums_read  on order_albums for select to authenticated using (has_perm('print_spec', 'view'));
create policy albums_write on order_albums for insert to authenticated with check (has_perm('print_spec', 'write'));
create policy albums_upd   on order_albums for update to authenticated using (has_perm('print_spec', 'write')) with check (has_perm('print_spec', 'write'));
create trigger order_albums_closed before insert or update on order_albums for each row execute function guard_child_of_closed();
create trigger order_albums_audit after insert or update on order_albums for each row execute function audit_row();
