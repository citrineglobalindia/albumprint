-- Purchase bills and standard purchase costs, for profit = what the customer is billed − what we pay.
--   album_purchases.bill_no / bill_date   the lab's (supplier's) bill number and date for an album's purchase amount
--   item_purchase_costs                    a standard purchase cost per catalog item, used for any lab that has no
--                                          rate of its own for the item (lab_item_rates still win when present)
-- Admin and accounts only (the same rule as purchase amounts and lab rates).

alter table album_purchases
  add column if not exists bill_no text,
  add column if not exists bill_date date;

create table if not exists item_purchase_costs (
  item_id uuid primary key references cat_items(id) on delete cascade,
  rate numeric(12, 2) not null check (rate >= 0),
  updated_by uuid references profiles(id) default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table item_purchase_costs enable row level security;
drop policy if exists item_purchase_costs_rw on item_purchase_costs;
create policy item_purchase_costs_rw on item_purchase_costs for all to authenticated using (has_perm('invoices', 'approve')) with check (has_perm('invoices', 'approve'));
grant select, insert, update, delete on item_purchase_costs to authenticated;
drop trigger if exists item_purchase_costs_stamp_t on item_purchase_costs;
create trigger item_purchase_costs_stamp_t before insert or update on item_purchase_costs for each row execute function album_purchases_stamp();
drop trigger if exists item_purchase_costs_audit on item_purchase_costs;
create trigger item_purchase_costs_audit after insert or update or delete on item_purchase_costs for each row execute function audit_row();
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'item_purchase_costs') then
    alter publication supabase_realtime add table public.item_purchase_costs;
  end if;
end $$;

notify pgrst, 'reload schema';
