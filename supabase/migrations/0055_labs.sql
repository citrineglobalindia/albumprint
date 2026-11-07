-- Printing labs: outside labs that print albums for us.
--   labs            the admin's list of labs (name, contact)
--   album_labs      which lab prints each album, and its progress there: not sent → sent to lab → received back (who, when)
--   album_purchases what the lab charges us for each album (the purchase amount) — for profit = selling price − purchase.
-- Purchase amounts and profit are finance data: only admin and accounts (invoices: full) read or change them.
create table if not exists labs (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (length(btrim(name)) between 1 and 120),
  contact text, phone text, notes text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table if not exists album_labs (
  order_id uuid not null references orders(id) on delete cascade,
  position int not null check (position >= 1),
  lab_id uuid references labs(id),
  status text not null default 'not_sent' check (status in ('not_sent', 'sent', 'received')),
  sent_at timestamptz, sent_by uuid references profiles(id),
  received_at timestamptz, received_by uuid references profiles(id),
  note text check (note is null or length(note) <= 300),
  updated_at timestamptz not null default now(),
  primary key (order_id, position)
);
create table if not exists album_purchases (
  order_id uuid not null references orders(id) on delete cascade,
  position int not null check (position >= 1),
  amount numeric(12, 2) not null check (amount >= 0),
  updated_by uuid references profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (order_id, position)
);
alter table labs enable row level security;
alter table album_labs enable row level security;
alter table album_purchases enable row level security;
drop policy if exists labs_read on labs; drop policy if exists labs_write on labs;
create policy labs_read on labs for select to authenticated using (has_perm('order', 'view'));
create policy labs_write on labs for all to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
drop policy if exists album_labs_read on album_labs; drop policy if exists album_labs_write on album_labs;
create policy album_labs_read on album_labs for select to authenticated using (has_perm('order', 'view'));
create policy album_labs_write on album_labs for all to authenticated using (has_perm('order', 'write') or has_perm('printing', 'write')) with check (has_perm('order', 'write') or has_perm('printing', 'write'));
drop policy if exists album_purchases_rw on album_purchases;
create policy album_purchases_rw on album_purchases for all to authenticated using (has_perm('invoices', 'approve')) with check (has_perm('invoices', 'approve'));
grant select, insert, update, delete on labs, album_labs, album_purchases to authenticated;

-- the lab steps stamp who and when (server clock)
create or replace function album_labs_stamp() returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'sent' and (tg_op = 'INSERT' or old.status is distinct from 'sent') then new.sent_at := now(); new.sent_by := auth.uid(); new.received_at := null; new.received_by := null; end if;
  if new.status = 'received' and (tg_op = 'INSERT' or old.status is distinct from 'received') then
    if new.sent_at is null then new.sent_at := now(); new.sent_by := auth.uid(); end if;
    new.received_at := now(); new.received_by := auth.uid();
  end if;
  if new.status = 'not_sent' then new.sent_at := null; new.sent_by := null; new.received_at := null; new.received_by := null; end if;
  return new;
end $$;
drop trigger if exists album_labs_stamp_t on album_labs;
create trigger album_labs_stamp_t before insert or update on album_labs for each row execute function album_labs_stamp();
create or replace function album_purchases_stamp() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
drop trigger if exists album_purchases_stamp_t on album_purchases;
create trigger album_purchases_stamp_t before insert or update on album_purchases for each row execute function album_purchases_stamp();

do $$ declare t text; begin
  foreach t in array array['labs', 'album_labs', 'album_purchases'] loop
    execute format('drop trigger if exists %I on %I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on %I for each row execute function audit_row()', t || '_audit', t);
    if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
