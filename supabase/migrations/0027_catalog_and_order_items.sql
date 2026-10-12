-- Product catalog (name path, SKU, unit, sell price, cost) that the admin maintains, and the items on an order priced from it.
create table catalog_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  category text not null check (char_length(btrim(category)) between 1 and 100),
  sku text,
  unit text not null default 'Nos' check (char_length(btrim(unit)) between 1 and 20),
  sell_price numeric(12,2) not null default 0 check (sell_price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index catalog_items_name_key on catalog_items (lower(btrim(name)));
-- the purchase cost is the shop's margin: admin only, in its own table
create table catalog_costs (
  item_id uuid primary key references catalog_items(id) on delete cascade,
  cost_price numeric(12,2) not null check (cost_price >= 0)
);
alter table catalog_items enable row level security;
alter table catalog_costs enable row level security;
revoke all on catalog_items, catalog_costs from anon;
grant select, insert, update on catalog_items to authenticated;
grant select, insert, update on catalog_costs to authenticated;
create policy catalog_read  on catalog_items for select to authenticated using (current_app_role() is not null);
create policy catalog_write on catalog_items for insert to authenticated with check (current_app_role() = 'admin');
create policy catalog_upd   on catalog_items for update to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create policy costs_admin   on catalog_costs for all    to authenticated using (current_app_role() = 'admin') with check (current_app_role() = 'admin');
create or replace function catalog_items_stamp() returns trigger language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;
create trigger catalog_items_stamp_t before insert or update on catalog_items for each row execute function catalog_items_stamp();
revoke execute on function catalog_items_stamp() from public, anon, authenticated;
create trigger catalog_items_audit after insert or update on catalog_items for each row execute function audit_admin_row();

-- items on an order: a catalog item is priced by the server (the client cannot choose the price); a custom item carries a typed price
create table order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  position int not null check (position >= 1),
  item_id uuid references catalog_items(id),
  name text not null check (char_length(btrim(name)) between 1 and 200),
  unit text not null default 'Nos',
  qty numeric(10,2) not null check (qty > 0),
  sell_price numeric(12,2) not null default 0 check (sell_price >= 0),
  remarks text,
  created_at timestamptz not null default now(),
  unique (order_id, position)
);
alter table order_items enable row level security;
revoke all on order_items from anon;
grant select, insert, update on order_items to authenticated;
create policy oitems_read  on order_items for select to authenticated using (has_perm('order', 'view'));
create policy oitems_write on order_items for insert to authenticated with check (has_perm('order', 'write'));
create policy oitems_upd   on order_items for update to authenticated using (has_perm('order', 'write')) with check (has_perm('order', 'write'));
create or replace function order_items_price() returns trigger language plpgsql security definer set search_path = public as $$
declare c catalog_items;
begin
  if new.item_id is not null then
    select * into c from catalog_items where id = new.item_id;
    if not found or not c.active then raise exception 'that product is not available' using errcode = '23514'; end if;
    new.name := c.name; new.unit := c.unit; new.sell_price := c.sell_price;      -- the catalog decides the price
  end if;
  return new;
end $$;
create trigger order_items_price_t before insert on order_items for each row execute function order_items_price();
revoke execute on function order_items_price() from public, anon, authenticated;
create trigger order_items_closed before insert or update on order_items for each row execute function guard_child_of_closed();
create trigger order_items_audit after insert or update on order_items for each row execute function audit_row();
