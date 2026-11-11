-- Purchase rates per lab and catalog item: what each lab charges us for an item (per sheet / per piece / per album, the item's own unit).
-- An album's purchase cost is worked out from its priced lines × the rates of the album's lab, so purchase vs sales (profit) is known
-- without typing an amount per order; a purchase amount typed on the order (album_purchases, 0055) still wins.
-- Finance data, like purchase amounts: only admin and accounts (invoices: approve) read or change them.
create table if not exists lab_item_rates (
  lab_id uuid not null references labs(id) on delete cascade,
  item_id uuid not null references cat_items(id) on delete cascade,
  rate numeric(12, 2) not null check (rate >= 0),
  updated_by uuid references profiles(id) default auth.uid(),
  updated_at timestamptz not null default now(),
  primary key (lab_id, item_id)
);
alter table lab_item_rates enable row level security;
drop policy if exists lab_item_rates_rw on lab_item_rates;
create policy lab_item_rates_rw on lab_item_rates for all to authenticated using (has_perm('invoices', 'approve')) with check (has_perm('invoices', 'approve'));
grant select, insert, update, delete on lab_item_rates to authenticated;
drop trigger if exists lab_item_rates_stamp_t on lab_item_rates;
create trigger lab_item_rates_stamp_t before insert or update on lab_item_rates for each row execute function album_purchases_stamp();
drop trigger if exists lab_item_rates_audit on lab_item_rates;
create trigger lab_item_rates_audit after insert or update or delete on lab_item_rates for each row execute function audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'lab_item_rates') then
    alter publication supabase_realtime add table public.lab_item_rates;
  end if;
end $$;
